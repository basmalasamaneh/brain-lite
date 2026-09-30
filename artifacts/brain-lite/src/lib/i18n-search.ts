import type { Lang } from './i18n';

const en = {
  related: 'Related memories', similar: 'Similar memories', keyword: 'Keyword matches',
  submit: 'Find related memories', from: 'From date', to: 'To date',
  voice: 'Ask by voice', voiceTitle: 'Speak your question',
  voicePrivacy: 'Audio is transcribed only. No memory is created and the recording is not kept.',
  voicePermission: 'Tap Start recording to allow microphone access and speak your question.',
  transcribing: 'Transcribing your question…', useQuestion: 'Use question',
  relatedEmpty: 'No related memories yet', relatedEmptyBody: 'Try another question or capture something about this topic.',
  similarEmpty: 'Capture more memories to discover connections.',
  relevance: 'Relevance', indexTitle: 'Memory search index', indexProgress: 'Indexing your memories',
  pending: 'Pending', failed: 'Failed', reindex: 'Re-index', reindexing: 'Queuing memories…',
  indexError: 'Could not load indexing progress. Please retry.',
  reindexError: 'Could not queue re-indexing. Please retry.',
  indexFailed: 'Some memories could not be indexed. Re-index to retry them.',
  indexReady: 'Your memories are ready for smart search.',
  dateError: 'From date must be on or before To date.',
} as const;
const ar: Record<keyof typeof en, string> = {
  related: 'ذكريات ذات صلة', similar: 'ذكريات مشابهة', keyword: 'نتائج الكلمات',
  submit: 'البحث عن ذكريات ذات صلة', from: 'من تاريخ', to: 'إلى تاريخ',
  voice: 'اسأل بصوتك', voiceTitle: 'تحدّث بسؤالك',
  voicePrivacy: 'يُنسخ الصوت فقط. لن تُنشأ ذكرى ولن يُحتفظ بالتسجيل.',
  voicePermission: 'اضغط بدء التسجيل للسماح بالميكروفون ثم تحدّث بسؤالك.',
  transcribing: 'جارٍ نسخ سؤالك…', useQuestion: 'استخدم السؤال',
  relatedEmpty: 'لا توجد ذكريات ذات صلة بعد', relatedEmptyBody: 'جرّب سؤالًا آخر أو احفظ ذكرى عن هذا الموضوع.',
  similarEmpty: 'احفظ المزيد من الذكريات لاكتشاف الروابط بينها.',
  relevance: 'مدى الصلة', indexTitle: 'فهرس البحث في الذكريات', indexProgress: 'جارٍ فهرسة ذكرياتك',
  pending: 'قيد الانتظار', failed: 'فشلت', reindex: 'إعادة الفهرسة', reindexing: 'جارٍ جدولة الذكريات…',
  indexError: 'تعذّر تحميل تقدّم الفهرسة. حاول مجددًا.',
  reindexError: 'تعذّرت جدولة إعادة الفهرسة. حاول مجددًا.',
  indexFailed: 'تعذّرت فهرسة بعض الذكريات. أعد الفهرسة للمحاولة مجددًا.',
  indexReady: 'ذكرياتك جاهزة للبحث الذكي.',
  dateError: 'يجب أن يكون تاريخ البداية قبل تاريخ النهاية أو مساويًا له.',
};
export const searchText = (lang: Lang, key: keyof typeof en): string => lang === 'ar' ? ar[key] : en[key];