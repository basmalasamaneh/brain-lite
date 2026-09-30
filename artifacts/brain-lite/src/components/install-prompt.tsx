import { useEffect, useRef, useState } from 'react';
import { Download, Share2, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const storageKey = 'brain-lite-install-hint-seen';

export function InstallPrompt() {
  const { lang } = useI18n();
  const [platform, setPlatform] = useState<'ios' | 'android' | null>(null);
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const dismissRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches ||
        ('standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone) ||
        !window.matchMedia('(pointer: coarse) and (max-width: 767px)').matches) return;
    try { if (localStorage.getItem(storageKey)) return; } catch { /* private browsing */ }
    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const safari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
    const android = /Android/i.test(ua);
    if (!((ios && safari) || android)) return;
    const kind = ios ? 'ios' : 'android';
    let timer: ReturnType<typeof setTimeout>;
    const show = () => {
      setPlatform(kind);
      setVisible(true);
      try { localStorage.setItem(storageKey, '1'); } catch { /* private browsing */ }
    };
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallEvent);
      clearTimeout(timer);
      timer = setTimeout(show, 1200);
    };
    const onInstalled = () => { setVisible(false); setInstallEvent(null); };
    window.addEventListener('beforeinstallprompt', onInstall);
    window.addEventListener('appinstalled', onInstalled);
    timer = setTimeout(show, ios ? 2200 : 4500);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', onInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!visible || !platform) return null;
  const ar = lang === 'ar';
  const dismiss = () => {
    setVisible(false);
    // The hint is in document flow, not a modal; return focus only if a control
    // inside the hint had focus, without stealing it from a form.
    if (document.activeElement === dismissRef.current) document.getElementById('main')?.focus({ preventScroll: true });
  };
  const install = async () => {
    if (!installEvent) return;
    setVisible(false);
    try {
      await installEvent.prompt();
      await installEvent.userChoice;
    } catch (error) {
      console.warn('Install prompt unavailable:', error);
    }
    setInstallEvent(null);
  };
  return (
    <section className="install-hint mx-4 mt-3 rounded-2xl border border-gold-400/30 bg-card p-4 soft-shadow sm:mx-8 md:hidden" aria-label={ar ? 'تثبيت التطبيق' : 'Install app'}>
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gold-soft text-gold" aria-hidden>
          {platform === 'ios' ? <Share2 className="h-5 w-5" /> : <Download className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{ar ? 'أضف Brain Lite إلى شاشتك الرئيسية' : 'Add Brain Lite to your home screen'}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {platform === 'ios'
              ? ar ? 'في Safari، اضغط مشاركة ثم «إضافة إلى الشاشة الرئيسية».' : 'In Safari, tap Share, then “Add to Home Screen”.'
              : ar ? 'ثبّت التطبيق للوصول السريع. إذا لم يظهر خيار التثبيت، افتح قائمة المتصفح واختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».'
                : 'Install for quick access. If Install is unavailable, open your browser menu and choose “Install app” or “Add to Home Screen”.'}
          </p>
          {installEvent && <button type="button" onClick={install} className="btn-gold mt-3 min-h-11 rounded-xl px-4 text-sm font-semibold">{ar ? 'تثبيت التطبيق' : 'Install app'}</button>}
        </div>
        <button ref={dismissRef} type="button" onClick={dismiss} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-gold-soft" aria-label={ar ? 'إغلاق تلميح التثبيت' : 'Dismiss install tip'}><X className="h-5 w-5" /></button>
      </div>
    </section>
  );
}