export const EMBEDDING_DIMENSIONS = 768;
export const SIMILARITY_THRESHOLD = 0.55;

export type EmbeddableMemory = {
  title: string; summary?: string | null; raw_text?: string; transcript?: string | null;
  type: string; tags: string[]; people: string[]; event_date?: string | null;
  amount?: number | null; currency?: string | null; extra?: unknown;
};

const small = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
export function numberWords(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (n < 0) return `minus ${numberWords(-n)}`;
  if (!Number.isInteger(n)) {
    const [whole, fractional] = String(n).split(".");
    return fractional ? `${numberWords(Number(whole))} point ${fractional.split("").map((digit) => small[Number(digit)]).join(" ")}` : String(n);
  }
  if (n < 20) return small[n];
  if (n < 100) return `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${small[n % 10]}` : ""}`;
  if (n < 1000) return `${small[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberWords(n % 100)}` : ""}`;
  for (const [scale, name] of [[1e12, "trillion"], [1e9, "billion"], [1e6, "million"], [1e3, "thousand"]] as const) {
    if (n >= scale) return `${numberWords(Math.floor(n / scale))} ${name}${n % scale ? ` ${numberWords(n % scale)}` : ""}`;
  }
  return String(n);
}

export function buildEmbeddingText(memory: EmbeddableMemory): string {
  let dateWords = "";
  if (memory.event_date) {
    const day = new Date(`${memory.event_date.slice(0, 10)}T12:00:00Z`);
    if (!Number.isNaN(day.getTime())) dateWords = `${new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).format(day)}; ${new Intl.DateTimeFormat("ar", { dateStyle: "long", timeZone: "UTC" }).format(day)}`;
  }
  // Keep all structured facts and cap very long transcripts within provider limits.
  return [
    `Title: ${memory.title.slice(0, 500)}`, `Type: ${memory.type}`, `Summary: ${(memory.summary ?? "").slice(0, 3000)}`,
    `Tags: ${memory.tags.join(", ").slice(0, 2000)}`, `People: ${memory.people.join(", ").slice(0, 2000)}`,
    `Date: ${memory.event_date ?? ""} ${dateWords}`,
    `Amount: ${memory.amount ?? ""} ${memory.amount != null ? numberWords(memory.amount) : ""} ${memory.currency ?? ""}`,
    `Transcript: ${(memory.transcript ?? "").slice(0, 5500)}`, `Raw text: ${(memory.raw_text ?? "").slice(0, 5500)}`,
    `Details: ${JSON.stringify(memory.extra ?? {}).slice(0, 1500)}`,
  ].join("\n").slice(0, 22000);
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? Math.max(-1, Math.min(1, dot / Math.sqrt(aa * bb))) : 0;
}

export function retryDelay(attempt: number, random: () => number = Math.random): number {
  return Math.min(60 * 60 * 1000, 15000 * 2 ** Math.min(attempt, 8) * (0.75 + random() * 0.5));
}

const stopwords = new Set("what when where who how did do does is are was were the a an my me i about find show tell much spend spent total this next last week month year coming what's in on at to of for with and anything memories memory هل ما ماذا متى أين كيف كم انا أنا لي عن في من على هذا هذه الأسبوع الشهر القادم القادمة الماضي صرفت أنفقت مجموع".split(" "));
function normalizeDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
}
export function queryTokens(query: string): string[] {
  return [...new Set(normalizeDigits(query.toLocaleLowerCase()).match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter((token) => !stopwords.has(token) && (token.length >= 2 || /^\d+$/.test(token))).slice(0, 30);
}

export function exactBoost(memory: EmbeddableMemory, query: string): number {
  const haystack = normalizeDigits(`${memory.title} ${memory.tags.join(" ")} ${memory.people.join(" ")} ${memory.amount ?? ""}`.toLocaleLowerCase());
  const tokens = new Set(haystack.match(/[\p{L}\p{N}]+/gu) ?? []);
  const wanted = queryTokens(query);
  const matches = wanted.filter((token) => tokens.has(token)).length;
  return matches ? Math.min(1, 0.76 + 0.24 * matches / wanted.length) : 0;
}

export function validDateFilter(value?: string): boolean {
  if (!value) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function validTimezone(value: string): boolean {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}

export function localCalendarDate(now: Date, timezone = "UTC"): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((value) => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

// Conservative lexical scope: every remaining merchant/category term MUST
// match a receipt. Unknown terms produce no matches, never a global fallback.
const financeScopeStopwords = new Set(`how much many did do does have has had i my me we our you your
what is are was were the a an all any of on at in for from to with and or about
spend spent spending paid pay payment payments receipt receipts expense expenses
cost costs amount amounts total totals sum money purchase purchases buying bought
this next last coming previous current today tomorrow yesterday week weeks month months year years
between during since until date dates day days over above more than less under
january february march april may june july august september october november december
report every currency currencies separately separate including include unknown unspecified recorded
كم ما ماذا هل عندي لدي لي أنا انا نحن لنا صرفت دفعت أنفقت انفقت صرف إنفاق انفاق
مجموع إجمالي اجمالي مبلغ المبلغ مبالغ إيصال ايصال إيصالات ايصالات فواتير مشتريات تكلفة تكاليف
على في من إلى الى عن مع لدى عند لكل كل هذا هذه الحالي الحالية القادم القادمة الماضي الماضية
اليوم غدا غداً أمس امس أسبوع اسبوع الأسبوع الاسبوع أسابيع شهر الشهر شهور سنة السنة عام العام
يناير فبراير مارس أبريل ابريل مايو يونيو يوليو أغسطس اغسطس سبتمبر أكتوبر اكتوبر نوفمبر ديسمبر
كانون الثاني شباط آذار اذار نيسان أيار ايار حزيران تموز آب اب أيلول ايلول تشرين الأول الاول
عملة العملات بشكل منفصل غير معروفة غير محددة`.split(/\s+/));
export function normalizeQualifierText(value: string): string {
  return normalizeDigits(value.toLocaleLowerCase()).replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/[\u064b-\u065f\u0670]/g, "");
}
export function financialQualifiers(question: string): string[] {
  const clean = normalizeQualifierText(question)
    .replace(/\d{4}-\d{2}-\d{2}(?:T[^\s?]+)?/gi, " ")
    .replace(/(?:over|above|more than|under|less than|أكثر من|اكثر من|اكبر من)\s*\d+(?:\.\d+)?/g, " ");
  const normalizedStopwords = new Set([...financeScopeStopwords].map(normalizeQualifierText));
  return [...new Set(clean.match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter((token) => !normalizedStopwords.has(token) && !/^20\d{2}$/.test(token));
}

/** Deterministic date/amount routing: aggregates run over ALL filtered rows, not retrieval's top 8. */
export function structuredIntent(question: string, now = new Date(), timezone = "UTC") {
  const q = normalizeDigits(question.toLowerCase());
  const financial = /\b(?:spend|spent|spending|paid|pay|payment|receipts?|expenses?|costs?|amounts?|money|purchases?)\b|صرفت|دفعت|أنفقت|انفقت|إنفاق|انفاق|إيصال|ايصال|إيصالات|ايصالات|فواتير|مبلغ|المبلغ|تكلفة|تكاليف|مشتريات/.test(q);
  const nonFinancialQuantity = /how much\s+(?:time|effort|water|space|distance)|كم\s+(?:وقت|ساعة|ساعات|يوم|أيام|ايام|مسافة)/.test(q);
  const total = financial && !nonFinancialQuantity && /how much|total|sum\b|spend|spent|spending|paid|كم|مجموع|إجمالي|اجمالي|أنفقت|انفقت|صرفت|دفعت/.test(q);
  const upcoming = /coming|upcoming|scheduled|appointments?|موعد|مواعيد|القادم|القادمة/.test(q);
  const appointmentOnly = /appointments?|موعد|مواعيد/.test(q);
  let from: string | undefined, to: string | undefined;
  const iso = (day: Date) => day.toISOString().slice(0, 10);
  // Calendar arithmetic uses a virtual UTC date containing the user's LOCAL day,
  // so DST shifts do not turn calendar days into 23/25-hour offsets.
  const day = new Date(`${localCalendarDate(now, timezone)}T00:00:00Z`);
  const localYear = day.getUTCFullYear();
  const explicit = q.match(/\d{4}-\d{2}-\d{2}/g)?.filter((value) => validDateFilter(value));
  if (explicit?.length) { from = explicit[0]; to = explicit[1] ?? explicit[0]; }
  else if (/week|أسبوع|اسبوع/.test(q)) {
    const offset = /next\s+week|(?:الأسبوع|الاسبوع|أسبوع|اسبوع)\s+القادم/.test(q) ? 7 :
      /last\s+week|(?:الأسبوع|الاسبوع|أسبوع|اسبوع)\s+الماضي/.test(q) ? -7 : 0;
    day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7 + offset);
    from = iso(day); day.setUTCDate(day.getUTCDate() + 6); to = iso(day);
  } else if (/month|شهر/.test(q)) {
    const offset = /next\s+month|(?:الشهر|شهر)\s+القادم/.test(q) ? 1 : /last\s+month|(?:الشهر|شهر)\s+الماضي/.test(q) ? -1 : 0;
    day.setUTCDate(1); day.setUTCMonth(day.getUTCMonth() + offset);
    from = iso(day); day.setUTCMonth(day.getUTCMonth() + 1); day.setUTCDate(0); to = iso(day);
  } else if (/today|اليوم|tomorrow|غدا|غداً/.test(q)) {
    if (/tomorrow|غدا|غداً/.test(q)) day.setUTCDate(day.getUTCDate() + 1);
    from = to = iso(day);
  } else {
    const months = [
      /january|يناير|كانون الثاني/, /february|فبراير|شباط/, /march|مارس|آذار/,
      /april|أبريل|ابريل|نيسان/, /may\b|مايو|أيار/, /june|يونيو|حزيران/,
      /july|يوليو|تموز/, /august|أغسطس|اغسطس|آب/, /september|سبتمبر|أيلول/,
      /october|أكتوبر|اكتوبر|تشرين الأول/, /november|نوفمبر|تشرين الثاني/, /december|ديسمبر|كانون الأول/,
    ];
    const month = months.findIndex((pattern) => pattern.test(q));
    const year = Number(q.match(/\b20\d{2}\b/)?.[0] ?? localYear);
    if (month >= 0) {
      from = iso(new Date(Date.UTC(year, month, 1)));
      to = iso(new Date(Date.UTC(year, month + 1, 0)));
    } else if (/year|سنة|عام/.test(q)) {
      const offset = /last|الماضي/.test(q) ? -1 : /next|القادم/.test(q) ? 1 : 0;
      from = `${year + offset}-01-01`; to = `${year + offset}-12-31`;
    }
  }
  // Numeric comparisons are parameterized, never interpolated into SQL.
  const amountMatch = q.match(/(?:over|above|more than|أكثر من|اكبر من)\s*(\d+(?:\.\d+)?)/);
  return { total, upcoming, appointmentOnly, from, to, qualifiers: total ? financialQualifiers(question) : [],
    minimumAmount: amountMatch ? Number(amountMatch[1]) : undefined,
    active: total || upcoming && !!from };
}