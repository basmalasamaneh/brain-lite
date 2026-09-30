import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'ar';

const en = {
  appName: 'Brain Lite',
  tagline: 'A quiet home for life’s details',
  navHome: 'Home', navCapture: 'Capture', navMemories: 'Memories', navAsk: 'Ask',
  login: 'Log in', logout: 'Log out', signedInAs: 'Signed in',
  samplePreview: 'Sample preview',
  sampleBanner: 'You’re looking at five sample memories. Log in to start keeping your own — saving, editing and deleting need an account.',
  loginToSave: 'Log in to save', loginToEdit: 'Log in to edit', loginToDelete: 'Log in to delete',
  theme: 'Theme', themeLight: 'Light', themeDark: 'Dark', themeSystem: 'System', language: 'Language',
  greetMorning: 'Good morning', greetAfternoon: 'Good afternoon', greetEvening: 'Good evening',
  homeLead: 'Here’s what you’ve set down so far.',
  statTotal: 'Memories kept', statReview: 'Waiting for a look', statConfirmed: 'Confirmed',
  recent: 'Recently kept', seeAll: 'See all', captureSomething: 'Capture something',
  emptyTitle: 'Your life is messy. Your second brain doesn’t have to be.',
  emptyBody: 'Drop in a thought, a receipt, an appointment — anything you don’t want to carry around in your head.',
  quickCapture: 'Put it down, let it go.', quickCaptureBody: 'A note, a photo of a receipt, a PDF. Sort it out later.',
  captureTitle: 'Capture', captureLead: 'Write it, snap it, or drop a file. It lands in your memories marked for review.',
  titleLabel: 'Title', titleOptional: 'optional — we’ll use the first line or file name',
  textLabel: 'What’s on your mind?', textPlaceholder: 'Dentist on Thursday at 4:30. Bring the insurance card…',
  fileLabel: 'Attach a file', dropHere: 'Drag a file here, or', browse: 'browse', takePhoto: 'Take photo',
  fileHint: 'JPEG, PNG, WebP, HEIC or PDF · up to 10 MB', removeFile: 'Remove file',
  save: 'Save memory', saving: 'Saving…', uploading: 'Uploading file…',
  savedToast: 'Kept safe', savedToastBody: 'Your memory is waiting in the review pile.', viewIt: 'Open it',
  errNothing: 'Add some text or a file first.', errType: 'That file type isn’t supported. Use JPEG, PNG, WebP, HEIC or PDF.',
  errSize: 'That file is over 10 MB.', errUpload: 'The upload didn’t go through. Please try again.', errSave: 'We couldn’t save that. Please try again.',
  errTitleLong: 'Title must be 200 characters or fewer.', errTitleRequired: 'Title can’t be empty.',
  errAmount: 'Amount must be a number of 0 or more.', errCurrency: 'Currency must be 10 characters or fewer.',
  memoriesTitle: 'Memories', memoriesLead: 'Everything you’ve kept, in one calm place.',
  searchPlaceholder: 'Search titles, text, people…', all: 'All', noResults: 'Nothing matches that yet.', noResultsBody: 'Try another word or clear the filter.', clearFilters: 'Clear filters',
  loadError: 'Something went wrong loading this.', retry: 'Try again',
  type_appointment: 'Appointment', type_receipt: 'Receipt', type_task: 'Task', type_idea: 'Idea', type_document: 'Document', type_note: 'Note', type_other: 'Other',
  status_confirmed: 'Confirmed', status_needs_review: 'Needs review',
  back: 'Back to memories', edit: 'Edit', cancel: 'Cancel', saveChanges: 'Save changes', delete: 'Delete',
  updatedToast: 'Changes saved', deletedToast: 'Memory deleted',
  deleteTitle: 'Delete this memory?', deleteBody: 'This can’t be undone. The memory and its details will be gone for good.', deleting: 'Deleting…',
  fType: 'Type', fStatus: 'Status', fDate: 'Date', fAmount: 'Amount', fCurrency: 'Currency', fPeople: 'People', fTags: 'Tags', fSummary: 'Summary', fRaw: 'Full text',
  commaHint: 'Separate with commas', none: 'None', noSummary: 'No summary yet.', noText: 'No text.',
  attachment: 'Attachment', openFile: 'Open file', created: 'Kept on', markConfirmed: 'Mark confirmed',
  notFound: 'This memory couldn’t be found.', notFoundPage: 'This page wandered off.', goHome: 'Go home',
  askTitle: 'Ask', askHeading: 'Asking is coming later.', askBody: 'Right now Brain Lite is about one thing: giving your details a safe place to land. Asking questions of your memories is planned for a later phase — we’d rather ship it honestly than half-build it.',
  askMeanwhile: 'Meanwhile, you can search your memories.', askSearch: 'Search memories', askPlaceholder: 'Ask about your memories…', later: 'Later',
};
type Dict = typeof en;
export type TKey = keyof Dict;

const ar: Dict = {
  appName: 'برين لايت',
  tagline: 'بيت هادئ لتفاصيل حياتك',
  navHome: 'الرئيسية', navCapture: 'التقاط', navMemories: 'الذكريات', navAsk: 'اسأل',
  login: 'تسجيل الدخول', logout: 'تسجيل الخروج', signedInAs: 'مسجّل الدخول',
  samplePreview: 'معاينة تجريبية',
  sampleBanner: 'أنت تشاهد خمس ذكريات تجريبية. سجّل الدخول لتبدأ بحفظ ذكرياتك — الحفظ والتعديل والحذف تتطلب حسابًا.',
  loginToSave: 'سجّل الدخول للحفظ', loginToEdit: 'سجّل الدخول للتعديل', loginToDelete: 'سجّل الدخول للحذف',
  theme: 'المظهر', themeLight: 'فاتح', themeDark: 'داكن', themeSystem: 'النظام', language: 'اللغة',
  greetMorning: 'صباح الخير', greetAfternoon: 'نهارك سعيد', greetEvening: 'مساء الخير',
  homeLead: 'هذا ما دوّنته حتى الآن.',
  statTotal: 'ذكريات محفوظة', statReview: 'بانتظار المراجعة', statConfirmed: 'مؤكدة',
  recent: 'أحدث الذكريات', seeAll: 'عرض الكل', captureSomething: 'التقط شيئًا',
  emptyTitle: 'حياتك فوضوية. دماغك الثاني ليس مضطرًا لذلك.',
  emptyBody: 'أضف فكرة، إيصالًا، موعدًا — أي شيء لا تريد أن تحمله في رأسك.',
  quickCapture: 'دوّنه، ثم اتركه.', quickCaptureBody: 'ملاحظة، صورة إيصال، ملف PDF. رتّبها لاحقًا.',
  captureTitle: 'التقاط', captureLead: 'اكتبها أو صوّرها أو أرفق ملفًا. ستصل إلى ذكرياتك بعلامة للمراجعة.',
  titleLabel: 'العنوان', titleOptional: 'اختياري — سنستخدم السطر الأول أو اسم الملف',
  textLabel: 'ما الذي يشغل بالك؟', textPlaceholder: 'موعد طبيب الأسنان يوم الخميس الساعة ٤:٣٠. أحضر بطاقة التأمين…',
  fileLabel: 'إرفاق ملف', dropHere: 'اسحب ملفًا إلى هنا، أو', browse: 'تصفّح', takePhoto: 'التقط صورة',
  fileHint: 'JPEG أو PNG أو WebP أو HEIC أو PDF · حتى ١٠ ميغابايت', removeFile: 'إزالة الملف',
  save: 'احفظ الذكرى', saving: 'جارٍ الحفظ…', uploading: 'جارٍ رفع الملف…',
  savedToast: 'حُفظت بأمان', savedToastBody: 'ذكراك بانتظار المراجعة.', viewIt: 'افتحها',
  errNothing: 'أضف نصًا أو ملفًا أولًا.', errType: 'نوع الملف غير مدعوم. استخدم JPEG أو PNG أو WebP أو HEIC أو PDF.',
  errSize: 'حجم الملف يتجاوز ١٠ ميغابايت.', errUpload: 'تعذّر رفع الملف. حاول مرة أخرى.', errSave: 'تعذّر الحفظ. حاول مرة أخرى.',
  errTitleLong: 'يجب ألا يتجاوز العنوان ٢٠٠ حرف.', errTitleRequired: 'لا يمكن ترك العنوان فارغًا.',
  errAmount: 'يجب أن يكون المبلغ رقمًا يساوي ٠ أو أكثر.', errCurrency: 'يجب ألا تتجاوز العملة ١٠ أحرف.',
  memoriesTitle: 'الذكريات', memoriesLead: 'كل ما حفظته، في مكان هادئ واحد.',
  searchPlaceholder: 'ابحث في العناوين والنصوص والأشخاص…', all: 'الكل', noResults: 'لا شيء يطابق ذلك بعد.', noResultsBody: 'جرّب كلمة أخرى أو امسح الفلتر.', clearFilters: 'مسح الفلاتر',
  loadError: 'حدث خطأ أثناء التحميل.', retry: 'حاول مجددًا',
  type_appointment: 'موعد', type_receipt: 'إيصال', type_task: 'مهمة', type_idea: 'فكرة', type_document: 'مستند', type_note: 'ملاحظة', type_other: 'أخرى',
  status_confirmed: 'مؤكدة', status_needs_review: 'تحتاج مراجعة',
  back: 'العودة إلى الذكريات', edit: 'تعديل', cancel: 'إلغاء', saveChanges: 'حفظ التغييرات', delete: 'حذف',
  updatedToast: 'تم حفظ التغييرات', deletedToast: 'تم حذف الذكرى',
  deleteTitle: 'حذف هذه الذكرى؟', deleteBody: 'لا يمكن التراجع عن ذلك. ستُحذف الذكرى وتفاصيلها نهائيًا.', deleting: 'جارٍ الحذف…',
  fType: 'النوع', fStatus: 'الحالة', fDate: 'التاريخ', fAmount: 'المبلغ', fCurrency: 'العملة', fPeople: 'الأشخاص', fTags: 'الوسوم', fSummary: 'الملخص', fRaw: 'النص الكامل',
  commaHint: 'افصل بينها بفواصل', none: 'لا يوجد', noSummary: 'لا يوجد ملخص بعد.', noText: 'لا يوجد نص.',
  attachment: 'مرفق', openFile: 'فتح الملف', created: 'حُفظت في', markConfirmed: 'تأكيد',
  notFound: 'تعذّر العثور على هذه الذكرى.', notFoundPage: 'هذه الصفحة ضلّت طريقها.', goHome: 'العودة للرئيسية',
  askTitle: 'اسأل', askHeading: 'ميزة السؤال قادمة لاحقًا.', askBody: 'حاليًا يركّز برين لايت على أمر واحد: منح تفاصيلك مكانًا آمنًا. طرح الأسئلة على ذكرياتك مخطط لمرحلة لاحقة — نفضّل إطلاقها بصدق على بنائها ناقصة.',
  askMeanwhile: 'في هذه الأثناء، يمكنك البحث في ذكرياتك.', askSearch: 'ابحث في الذكريات', askPlaceholder: 'اسأل عن ذكرياتك…', later: 'لاحقًا',
};

const dicts: Record<Lang, Dict> = { en, ar };
type Ctx = { lang: Lang; dir: 'ltr' | 'rtl'; setLang: (l: Lang) => void; t: (k: TKey) => string };
const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem('bl-lang') === 'ar' ? 'ar' : 'en'));
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);
  const setLang = useCallback((l: Lang) => { localStorage.setItem('bl-lang', l); setLangState(l); }, []);
  const t = useCallback((k: TKey) => dicts[lang][k], [lang]);
  return <I18nContext.Provider value={{ lang, dir, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const c = useContext(I18nContext);
  if (!c) throw new Error('useI18n outside provider');
  return c;
}

export function usePageTitle(title: string) {
  useEffect(() => { document.title = `${title} · Brain Lite`; }, [title]);
}
