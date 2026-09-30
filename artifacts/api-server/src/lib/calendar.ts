type CalendarMemory = {
  id: number;
  type: string;
  title: string;
  summary: string | null;
  event_date: string | null;
};

export function validEventDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hours, minutes, seconds, offset] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  if (y < 1000 || m < 1 || m > 12 || d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return false;
  if (hours !== undefined && (Number(hours) > 23 || Number(minutes) > 59 || Number(seconds ?? 0) > 59)) return false;
  if (offset && offset !== "Z" && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59)) return false;
  return true;
}

export function escapeCalendarText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

// RFC 5545 limits physical lines to 75 octets, not JavaScript characters.
export function foldCalendarLine(line: string): string {
  const chunks: string[] = [];
  let current = "";
  let bytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character);
    if (bytes + size > 75) {
      chunks.push(current);
      current = " ";
      bytes = 1;
    }
    current += character;
    bytes += size;
  }
  chunks.push(current);
  return chunks.join("\r\n");
}

export function createCalendarEvent(memory: CalendarMemory, now = new Date()): string {
  if (memory.type !== "appointment" || !memory.event_date || !validEventDate(memory.event_date)) {
    throw new Error("An appointment with a valid date is required");
  }
  const date = memory.event_date;
  let start: string;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    start = `DTSTART;VALUE=DATE:${date.replaceAll("-", "")}`;
  } else if (/(Z|[+-]\d{2}:\d{2})$/.test(date)) {
    start = `DTSTART:${new Date(date).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`;
  } else {
    // Unknown timezone stays a floating local time; never silently assume UTC.
    const [day, time] = date.split("T");
    start = `DTSTART:${day.replaceAll("-", "")}T${time.split(".")[0].replaceAll(":", "").padEnd(6, "0")}`;
  }
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Brain Lite//Memory Calendar//EN",
    "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    `UID:memory-${memory.id}@brain-lite`, `DTSTAMP:${stamp}`, start,
    `SUMMARY:${escapeCalendarText(memory.title)}`,
    ...(memory.summary ? [`DESCRIPTION:${escapeCalendarText(memory.summary)}`] : []),
    "END:VEVENT", "END:VCALENDAR",
  ].map(foldCalendarLine).join("\r\n") + "\r\n";
}