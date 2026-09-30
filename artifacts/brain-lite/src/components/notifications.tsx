import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Bell, BellRing, Check, Clock, Loader2, Smartphone, Trash2 } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useAuth } from '@workspace/replit-auth-web';
import { useSubscribePush, useSendTestNotification, useReadAllNotifications, useReadNotification, useDeleteNotification } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n';
import { useToast } from '@/hooks/use-toast';
import { useMemoryReminderSettings, useNotices, useNotificationAction, useNotificationDevices, useNotificationSettings, usePushConfig, useReminders } from '@/hooks/use-notifications';
import { dateInTimezone, disconnectCurrentPush, isHomeReminderDue, localTimeToUtc, safeNotificationPath, type Notice, type Notices, type NotificationSettings, type ReminderSettings } from '@/lib/notifications';
import { ErrorState, Skeleton, Surface, btnGhost, btnPrimary, fieldCls } from '@/components/kit';
import { IconCircle } from '@/components/brand';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

function useWords() {
  const { lang } = useI18n();
  return { lang, w: (en: string, ar: string) => lang === 'ar' ? ar : en };
}

function NotificationToggle({ id, checked, disabled, onChange }: { id: string; checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return <button id={id} role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className="grid h-11 w-14 shrink-0 place-items-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 disabled:opacity-50">
    <span className={cn('flex h-6 w-11 items-center rounded-full p-1 transition-colors', checked ? 'justify-end bg-gold-500' : 'justify-start bg-input')}><span className="h-4 w-4 rounded-full bg-background shadow-sm" /></span>
  </button>;
}

export function NotificationBell() {
  const { user } = useAuth();
  const q = useNotices();
  const { w } = useWords();
  if (!user) return null;
  return <Link href="/notifications" aria-label={`${w('Notifications', 'الإشعارات')}${q.data?.unread_count ? ` (${q.data.unread_count})` : ''}`} data-testid="button-notifications" className="relative grid h-11 w-11 shrink-0 place-items-center rounded-xl text-gold transition hover:bg-gold-soft">
    <Bell className="h-[18px] w-[18px]" />
    {!!q.data?.unread_count && <span className="absolute end-0 top-0 flex h-5 min-w-5 items-center justify-center rounded-full gold-gradient px-1 text-[10px] font-bold text-gold-ink">{q.data.unread_count > 99 ? '99+' : q.data.unread_count}</span>}
    {q.isError && <span aria-label={w('Unavailable', 'غير متاح')} className="absolute end-1 top-1 h-2 w-2 rounded-full bg-destructive" />}
  </Link>;
}

export function PushPermission({ onLater, onEnabled }: { onLater?: () => void; onEnabled?: () => void }) {
  const { user } = useAuth();
  const { w } = useWords();
  const { toast } = useToast();
  const action = useNotificationAction();
  const config = usePushConfig();
  const subscribe = useSubscribePush({ request: { credentials: 'include' } });
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | null>(() => typeof Notification !== 'undefined' ? Notification.permission : null);
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const safari = /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
  const needsInstall = ios && !standalone;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined' && window.isSecureContext;
  const production = import.meta.env.PROD;
  const unavailable = !production || needsInstall || !supported || permission === 'denied' || !config.data?.configured || !config.data.public_key;

  const enable = () => {
    // IMPORTANT: invoke synchronously in the click gesture, before any network await.
    if (unavailable || busy) return;
    const requested = Notification.permission === 'granted' ? Promise.resolve('granted' as NotificationPermission) : Notification.requestPermission();
    setBusy(true);
    void requested.then(async granted => {
      setPermission(granted);
      if (granted !== 'granted') return;
      const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
      if (!registration?.active) throw new Error(w('The app worker is not ready. Reload the installed app and try again.', 'عامل التطبيق غير جاهز. أعد تحميل التطبيق المثبّت وحاول مجددًا.'));
      const key = config.data!.public_key!;
      const bytes = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - key.length % 4) % 4)), c => c.charCodeAt(0));
      let sub = await registration.pushManager.getSubscription();
      if (!sub) sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
      try {
        const json = sub.toJSON();
        if (!json.endpoint || !json.keys?.auth || !json.keys?.p256dh) throw new Error(w('The browser returned an invalid subscription.', 'أعاد المتصفح اشتراكًا غير صالح.'));
        const device = await subscribe.mutateAsync({ data: { endpoint: json.endpoint, expirationTime: json.expirationTime, keys: { auth: json.keys.auth, p256dh: json.keys.p256dh } } });
        localStorage.setItem('brain-lite-push-device', JSON.stringify({ owner: user?.id, id: device.id }));
        await action.mutateAsync({ path: '/notifications/settings', method: 'PATCH', data: { push_enabled: true } });
      } catch (error) { await sub.unsubscribe(); throw error; }
      toast({ title: w('Notifications enabled on this device', 'تم تفعيل الإشعارات على هذا الجهاز') });
      onEnabled?.();
    }).catch(error => toast({ variant: 'destructive', title: w('Could not enable notifications', 'تعذّر تفعيل الإشعارات'), description: error.message })).finally(() => setBusy(false));
  };

  return <div className="space-y-4 rounded-2xl border border-gold-400/40 bg-gold-soft/40 p-4" data-testid="push-prepermission">
    <div className="flex items-start gap-3"><IconCircle icon={BellRing} size="sm" /><div><h3 className="font-display text-xl">{w('A gentle nudge, right on time', 'تذكير لطيف في الوقت المناسب')}</h3><p className="mt-1 text-sm text-muted-foreground">{w('Get reminders for appointments, deadlines and expiring essentials, plus an optional morning brief. You choose what reaches you.', 'احصل على تذكيرات بالمواعيد والمهام والأشياء التي توشك صلاحيتها على الانتهاء، مع ملخص صباحي اختياري. أنت تختار ما يصلك.')}</p></div></div>
    {needsInstall && <div className="space-y-2 text-sm" role="status"><p className="font-medium">{w('First, add Brain Lite to your Home Screen', 'أضف Brain Lite إلى الشاشة الرئيسية أولًا')}</p><ol className="list-inside list-decimal space-y-2"><li>{w(safari ? 'Tap Share in Safari.' : 'Open this page in Safari, then tap Share.', safari ? 'اضغط على «مشاركة» في Safari.' : 'افتح هذه الصفحة في Safari، ثم اضغط على «مشاركة».')}</li><li>{w('Choose Add to Home Screen, then Add.', 'اختر «إضافة إلى الشاشة الرئيسية»، ثم «إضافة».')}</li><li>{w('Open Brain Lite from its new icon, then enable notifications here. Requires iOS/iPadOS 16.4 or later.', 'افتح Brain Lite من أيقونته الجديدة، ثم فعّل الإشعارات هنا. يتطلب iOS أو iPadOS 16.4 أو أحدث.')}</li></ol></div>}
    {!needsInstall && !supported && <p role="status" className="text-sm">{w('Push is unavailable in this browser. In-app reminders still work. Try a supported browser over HTTPS.', 'الإشعارات الفورية غير متاحة في هذا المتصفح. تظل التذكيرات داخل التطبيق متاحة. جرّب متصفحًا يدعمها عبر HTTPS.')}</p>}
    {permission === 'denied' && <p role="status" className="text-sm">{w('Notifications are blocked. Allow them in your browser site settings or your device notification settings, then reopen the app.', 'الإشعارات محظورة. اسمح بها من إعدادات الموقع في المتصفح أو إعدادات إشعارات الجهاز، ثم أعد فتح التطبيق.')}</p>}
    {!production && <p role="status" className="text-sm">{w('Push requires the deployed production PWA. This development preview does not register a service worker; in-app notifications and reminders remain available.', 'تتطلب الإشعارات الفورية نسخة PWA المنشورة للإنتاج. لا تسجّل المعاينة التطويرية عامل خدمة؛ وتبقى الإشعارات والتذكيرات داخل التطبيق متاحة.')}</p>}
    {config.isLoading ? <Skeleton className="h-5 w-3/4" /> : config.isError ? <p role="alert" className="text-sm text-danger-ink">{w('Could not check push configuration.', 'تعذّر التحقق من إعداد الإشعارات الفورية.')} <button className={btnGhost} onClick={() => config.refetch()}>{w('Retry', 'إعادة المحاولة')}</button></p> : !config.data?.configured && <p role="status" className="text-sm">{w('Push is not configured on the server yet. In-app reminders are available; enabling browser notifications is unavailable until configuration is complete.', 'لم يُعدّ الخادم للإشعارات الفورية بعد. التذكيرات داخل التطبيق متاحة؛ ولا يمكن تفعيل إشعارات المتصفح قبل إكمال الإعداد.')}</p>}
    <div className="flex flex-wrap gap-2"><button className={btnPrimary} onClick={enable} disabled={unavailable || busy} data-testid="button-enable-notifications">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{w('Enable notifications', 'تفعيل الإشعارات')}</button>{onLater && <button className={btnGhost} onClick={onLater}>{w('Not now', 'ليس الآن')}</button>}</div>
  </div>;
}

export function NotificationSettingsSection() {
  const { user } = useAuth();
  const { w, lang } = useWords();
  const q = useNotificationSettings();
  const action = useNotificationAction();
  const devices = useNotificationDevices();
  const testNotification = useSendTestNotification({ request: { credentials: 'include' } });
  const { toast } = useToast();
  const [permissionOpen, setPermissionOpen] = useState(true);
  const [testing, setTesting] = useState(false);
  const [zone, setZone] = useState('');
  useEffect(() => { if (q.data) setZone(q.data.timezone); }, [q.data?.timezone]);
  const data = q.data;
  const save = (patch: Partial<NotificationSettings>) => action.mutate({ path: '/notifications/settings', method: 'PATCH', data: patch }, {
    onSuccess: () => toast({ title: w('Notification preferences saved', 'تم حفظ تفضيلات الإشعارات') }),
    onError: () => { if (q.data) setZone(q.data.timezone); },
  });
  const zones = [...new Set([data?.timezone ?? 'UTC', Intl.DateTimeFormat().resolvedOptions().timeZone, 'UTC', ...((Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['Asia/Riyadh', 'Asia/Dubai', 'Europe/London', 'America/New_York'])])].sort();
  const test = async () => {
    setTesting(true);
    try {
      const result = await testNotification.mutateAsync();
      const success = result.status === 'sent' && result.delivered > 0;
      const failures: Record<string, string> = {
        not_configured: w('The server has no push configuration.', 'لم يُعدّ الخادم للإشعارات الفورية.'),
        no_devices: w('Connect this device first.', 'صِل هذا الجهاز أولًا.'),
        disabled: w('Push notifications are disabled in Settings.', 'الإشعارات الفورية معطّلة في الإعدادات.'),
        failed: w('The push service did not accept the notification.', 'لم تقبل خدمة الإشعارات هذا الإشعار.'),
        limited: w('The daily notification limit was reached. Try tomorrow.', 'تم بلوغ الحد اليومي للإشعارات. حاول غدًا.'),
      };
      toast({ title: success ? w('Test accepted by push service', 'قبلت خدمة الإشعارات الاختبار') : w('Test notification was not sent', 'لم يُرسل إشعار الاختبار'), description: success ? w('Delivery depends on your device and browser. Check the installed app.', 'يعتمد وصول الإشعار على الجهاز والمتصفح. تحقّق من التطبيق المثبّت.') : failures[result.status] ?? w('Check server configuration and connected devices.', 'تحقّق من إعداد الخادم والأجهزة المتصلة.'), ...(success ? {} : { variant: 'destructive' as const }) });
    } catch (error) { toast({ variant: 'destructive', title: w('Test failed', 'فشل الاختبار'), description: (error as Error).message }); }
    finally { setTesting(false); }
  };
  return <Surface className="rise space-y-5 p-5 sm:p-6" data-testid="section-notification-settings">
    <h2 className="flex items-center gap-3 font-display text-2xl"><IconCircle icon={Bell} size="sm" />{w('Notifications', 'الإشعارات')}</h2>
    {q.isLoading ? <Skeleton className="h-40" /> : q.isError || !data ? <ErrorState onRetry={() => q.refetch()} /> : <>
      {permissionOpen ? <PushPermission onLater={() => setPermissionOpen(false)} onEnabled={() => setPermissionOpen(false)} /> : <button className={btnGhost} onClick={() => setPermissionOpen(true)}>{w('Set up this device', 'إعداد هذا الجهاز')}</button>}
      <div className="space-y-1">
        {([
          ['push_enabled', 'Push notifications', 'الإشعارات الفورية'],
          ['email_enabled', 'Email fallback (requires server setup)', 'البريد الإلكتروني البديل (يتطلب إعداد الخادم)'],
          ['remind_appointments', 'Appointments', 'المواعيد'],
          ['remind_tasks', 'Tasks and deadlines', 'المهام ومواعيد التسليم'],
          ['remind_expiries', 'Expiring essentials', 'انتهاء الصلاحية'],
          ['remind_suggestions', 'Connections and Space suggestions', 'اقتراحات الروابط والمساحات'],
          ['daily_brief_enabled', 'Daily morning brief', 'الملخص الصباحي اليومي'],
          ['hide_details', 'Hide details on lock screen', 'إخفاء التفاصيل على شاشة القفل'],
        ] as const).map(([key, en, ar]) => <div key={key} className="flex min-h-12 items-center justify-between gap-4 border-b border-border py-2"><label htmlFor={`notification-${key}`} className="text-sm font-medium">{w(en, ar)}</label><NotificationToggle id={`notification-${key}`} checked={data[key]} disabled={action.isPending} onChange={async value => {
          if (key === 'push_enabled' && value) { setPermissionOpen(true); return; }
          if (key === 'push_enabled' && !value) { try { await disconnectCurrentPush(); } catch (error) { toast({ variant: 'destructive', title: w('Could not disconnect this device', 'تعذّر فصل هذا الجهاز'), description: (error as Error).message }); } }
          save({ [key]: value });
        }} /></div>)}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {([['daily_brief_time', 'Daily brief time', 'وقت الملخص اليومي'], ['quiet_hours_start', 'Quiet hours start', 'بداية ساعات الهدوء'], ['quiet_hours_end', 'Quiet hours end', 'نهاية ساعات الهدوء']] as const).map(([key, en, ar]) => <label key={key} className="block space-y-2 text-sm font-medium"><span>{w(en, ar)}</span><input className={fieldCls} type="time" dir="ltr" defaultValue={data[key].slice(0, 5)} key={data[key]} disabled={action.isPending} onBlur={e => { if (e.target.value && e.target.value !== data[key].slice(0, 5)) save({ [key]: e.target.value }); }} /></label>)}
        <label className="block space-y-2 text-sm font-medium"><span>{w('Timezone', 'المنطقة الزمنية')}</span><select className={fieldCls} dir="ltr" value={zone} disabled={action.isPending} onChange={e => { setZone(e.target.value); save({ timezone: e.target.value }); }}>{zones.map(z => <option key={z} value={z}>{z}</option>)}</select><button type="button" className={btnGhost} disabled={action.isPending} onClick={() => save({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}>{w('Use device timezone', 'استخدام المنطقة الزمنية للجهاز')}</button></label>
      </div>
      <p className="text-xs text-muted-foreground">{w('All times use your selected timezone. Quiet-hour reminders wait until quiet hours end, except appointments within two hours.', 'تُحسب جميع الأوقات وفق منطقتك الزمنية المختارة. تؤجّل التذكيرات خلال ساعات الهدوء حتى نهايتها، باستثناء المواعيد خلال ساعتين.')}</p>
      <fieldset><legend className="mb-2 text-sm font-medium">{w('Default expiry lead days', 'أيام التذكير قبل انتهاء الصلاحية')}</legend><div className="flex flex-wrap gap-2">{[1, 3, 7, 14, 30].map(day => <button key={day} type="button" aria-pressed={data.default_lead_days.includes(day)} disabled={action.isPending} className={cn(btnGhost, data.default_lead_days.includes(day) && 'bg-gold-soft text-gold')} onClick={() => save({ default_lead_days: data.default_lead_days.includes(day) ? data.default_lead_days.filter(d => d !== day) : [...data.default_lead_days, day].sort((a, b) => a - b) })}>{day.toLocaleString(lang)} {w('days', 'أيام')}</button>)}</div></fieldset>
      <button className={btnGhost} onClick={test} disabled={testing || !data.push_enabled}>{testing && <Loader2 className="h-4 w-4 animate-spin" />}{w('Send test notification', 'إرسال إشعار تجريبي')}</button>
    </>}
    <div className="border-t border-border pt-4"><h3 className="mb-3 flex items-center gap-2 font-medium"><Smartphone className="h-4 w-4 text-gold" />{w('Connected devices', 'الأجهزة المتصلة')}</h3>
      {devices.isLoading ? <Skeleton className="h-16" /> : devices.isError ? <ErrorState onRetry={() => devices.refetch()} /> : !devices.data?.devices.length ? <p className="text-sm text-muted-foreground">{w('No devices connected yet.', 'لا توجد أجهزة متصلة بعد.')}</p> : <div className="space-y-3">{devices.data.devices.map(device => <div key={device.id} className="flex items-center gap-3 rounded-xl border border-border p-3"><div className="min-w-0 flex-1"><p className="break-words text-sm [overflow-wrap:anywhere]">{device.user_agent ?? w('Connected browser', 'متصفح متصل')}</p><p className="mt-1 text-xs text-muted-foreground">{w('Last used', 'آخر استخدام')}: {new Date(device.last_used_at ?? device.created_at).toLocaleDateString(lang)}</p></div><button aria-label={w('Remove device', 'إزالة الجهاز')} className={cn(btnGhost, 'shrink-0 px-3')} disabled={action.isPending} onClick={() => action.mutate({ path: `/notifications/devices/${device.id}`, method: 'DELETE' }, { onSuccess: () => {
        try { const current = JSON.parse(localStorage.getItem('brain-lite-push-device') ?? 'null'); if (current?.owner === user?.id && current.id === device.id) void disconnectCurrentPush().catch(() => undefined); } catch { /* No local device registration. */ }
      } })}><Trash2 className="h-4 w-4" /></button></div>)}</div>}
    </div>
  </Surface>;
}

export function HomeReminders() {
  const q = useReminders();
  const settings = useNotificationSettings();
  const { w, lang } = useWords();
  const action = useNotificationAction();
  const [snoozeId, setSnoozeId] = useState<string | null>(null);
  const timezone = settings.data?.timezone;
  const today = timezone ? dateInTimezone(new Date(), timezone) : '';
  // Recently delivered reminders remain actionable, not just pending reminders.
  const items = (q.data?.reminders ?? []).filter(r => timezone && isHomeReminderDue(r, timezone));
  return <section className="rise mb-8" data-testid="home-reminders"><h2 className="mb-3 flex items-center gap-3 font-display text-2xl"><IconCircle icon={Clock} size="sm" />{w('Reminders', 'التذكيرات')}</h2>
    {q.isLoading || settings.isLoading || (q.isFetching && !items.length) ? <Skeleton className="h-32 rounded-2xl" /> : q.isError || settings.isError ? <ErrorState onRetry={() => { q.refetch(); settings.refetch(); }} /> : <Surface className="divide-y divide-border p-4">
      {!items.length && <p className="py-3 text-sm text-muted-foreground">{w('Nothing due today or tomorrow. A little breathing room.', 'لا توجد تذكيرات مستحقة اليوم أو غدًا. فسحة صغيرة للراحة.')}</p>}
      {items.sort((a, b) => a.fire_at.localeCompare(b.fire_at)).map(r => <div key={r.id} className="space-y-3 py-4" data-testid={`reminder-${r.id}`}><Link href={`/memories/${r.memory_id}`} className="block min-h-11"><p className="font-medium">{r.title}</p><p className="mt-1 text-sm text-muted-foreground">{timezone && dateInTimezone(r.fire_at, timezone) === today ? w('Today', 'اليوم') : w('Tomorrow', 'غدًا')} · {new Date(r.fire_at).toLocaleTimeString(lang, { timeZone: timezone, hour: '2-digit', minute: '2-digit' })}</p></Link>
        <div className="flex gap-2"><button className={cn(btnPrimary, 'flex-1')} disabled={action.isPending} onClick={() => action.mutate({ path: `/reminders/${r.id}`, method: 'PATCH', data: { action: 'done' } })}><Check className="h-4 w-4" />{w('Done', 'تم')}</button><button className={cn(btnGhost, 'flex-1')} aria-expanded={snoozeId === r.id} onClick={() => setSnoozeId(snoozeId === r.id ? null : r.id)}><Clock className="h-4 w-4" />{w('Snooze', 'تأجيل')}</button></div>
        {snoozeId === r.id && <div className="flex flex-col gap-2 rounded-xl bg-gold-soft/50 p-2">{([['hour', '1 hour', 'ساعة واحدة'], ['tomorrow', 'Tomorrow morning', 'صباح الغد'], ['week', 'Next week', 'الأسبوع المقبل']] as const).map(([value, en, ar]) => <button key={value} className={btnGhost} disabled={action.isPending} onClick={() => action.mutate({ path: `/reminders/${r.id}`, method: 'PATCH', data: { action: 'snooze', snooze: value } }, { onSuccess: () => setSnoozeId(null) })}>{w(en, ar)}</button>)}</div>}
      </div>)}
    </Surface>}
  </section>;
}

export function MemoryReminderControl({ id }: { id: number }) {
  const q = useMemoryReminderSettings(id);
  const settings = useNotificationSettings();
  const reminders = useReminders(id);
  const action = useNotificationAction();
  const { w, lang } = useWords();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ReminderSettings['mode']>('automatic');
  const [leads, setLeads] = useState<number[]>([]);
  const [specific, setSpecific] = useState('');
  const [customLead, setCustomLead] = useState('');
  const edit = () => {
    if (!q.data) return;
    setMode(q.data.mode); setLeads(q.data.lead_minutes); setSpecific('');
    if (q.data.specific_at && settings.data) {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: settings.data.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(q.data.specific_at)).map(part => [part.type, part.value]));
      setSpecific(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`);
    }
    setOpen(true);
  };
  const save = () => {
    try {
      if (!settings.data) throw new Error(w('Choose a timezone in Settings first.', 'اختر منطقة زمنية في الإعدادات أولًا.'));
      if (mode === 'lead_times' && (!leads.length || leads.length > 20)) throw new Error(w('Choose between 1 and 20 lead times.', 'اختر من وقت تذكير واحد إلى عشرين وقتًا.'));
      const specific_at = mode === 'specific' ? localTimeToUtc(specific, settings.data.timezone) : null;
      if (specific_at && new Date(specific_at) <= new Date()) throw new Error(w('Choose a future time.', 'اختر وقتًا في المستقبل.'));
      action.mutate({ path: `/memories/${id}/reminder-settings`, method: 'PUT', data: { mode, lead_minutes: mode === 'lead_times' ? leads : [], specific_at } }, { onSuccess: () => { setOpen(false); toast({ title: w('Reminder preferences saved', 'تم حفظ تفضيلات التذكير') }); } });
    } catch (error) {
      const message = (error as Error).message;
      toast({ variant: 'destructive', title: lang === 'ar' && /daylight-saving/.test(message) ? 'هذا الوقت غير موجود أو متكرر بسبب تغيير التوقيت الصيفي. اختر وقتًا آخر.' : lang === 'ar' && message === 'Select a date and time.' ? 'اختر تاريخًا ووقتًا.' : message });
    }
  };
  const modes = [['automatic', 'Automatic', 'تلقائي'], ['none', 'No reminders', 'دون تذكيرات'], ['lead_times', 'Custom lead times', 'أوقات تذكير مخصصة'], ['specific', 'Specific date and time', 'تاريخ ووقت محددان']] as const;
  return <Surface className="p-4"><h3 className="mb-2 flex items-center gap-2 font-medium"><Bell className="h-4 w-4 text-gold" />{w('Remind me', 'ذكّرني')}</h3>
    {q.isLoading ? <Skeleton className="h-11" /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : <><p className="mb-2 text-sm text-muted-foreground">{w(modes.find(m => m[0] === q.data?.mode)?.[1] ?? 'Automatic', modes.find(m => m[0] === q.data?.mode)?.[2] ?? 'تلقائي')}</p><button className={cn(btnGhost, 'w-full')} onClick={edit}>{w('Change reminder', 'تغيير التذكير')}</button></>}
    {reminders.isError && <p role="alert" className="mt-3 text-xs text-danger-ink">{w('Upcoming reminders could not be loaded.', 'تعذّر تحميل التذكيرات القادمة.')}</p>}
    {reminders.data?.reminders.filter(r => ['pending', 'snoozed'].includes(r.status)).slice(0, 3).map(r => <p key={r.id} className="mt-3 text-xs text-muted-foreground">{settings.data ? new Date(r.fire_at).toLocaleString(lang, { timeZone: settings.data.timezone }) : ''}</p>)}
    <Dialog open={open} onOpenChange={value => { if (!action.isPending) setOpen(value); }}><DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl [&>button:last-child]:hidden" dir={lang === 'ar' ? 'rtl' : 'ltr'}><DialogHeader><DialogTitle>{w('Remind me', 'ذكّرني')}</DialogTitle><DialogDescription>{w('These preferences apply only to this memory.', 'تنطبق هذه التفضيلات على هذه الذكرى فقط.')}</DialogDescription></DialogHeader>
      <div className="space-y-2" role="radiogroup" aria-label={w('Reminder mode', 'وضع التذكير')}>{modes.map(([value, en, ar]) => <button key={value} role="radio" aria-checked={mode === value} className={cn(btnGhost, 'w-full justify-start', mode === value && 'bg-gold-soft text-gold')} onClick={() => setMode(value)}>{w(en, ar)}</button>)}</div>
      {mode === 'lead_times' && <fieldset className="space-y-3"><legend className="mb-2 text-sm">{w('Before the memory date', 'قبل تاريخ الذكرى')}</legend><div className="flex flex-wrap gap-2">{[120, 1440, 4320, 10080, 20160, 43200].map(minutes => <button key={minutes} className={cn(btnGhost, leads.includes(minutes) && 'bg-gold-soft text-gold')} aria-pressed={leads.includes(minutes)} onClick={() => setLeads(leads.includes(minutes) ? leads.filter(n => n !== minutes) : [...leads, minutes])}>{minutes < 1440 ? w('2 hours', 'ساعتان') : `${minutes / 1440} ${w('days', 'أيام')}`}</button>)}</div><label className="block text-sm">{w('Custom lead time (minutes)', 'وقت مخصص قبل الموعد (بالدقائق)')}<input type="number" min="0" max="525600" value={customLead} onChange={e => setCustomLead(e.target.value)} className={cn(fieldCls, 'mt-2')} /></label><button className={btnGhost} disabled={customLead === '' || !Number.isInteger(+customLead) || +customLead < 0 || +customLead > 525600} onClick={() => { setLeads([...new Set([...leads, +customLead])]); setCustomLead(''); }}>{w('Add lead time', 'إضافة وقت التذكير')}</button><div className="flex flex-wrap gap-2">{leads.filter(n => ![120, 1440, 4320, 10080, 20160, 43200].includes(n)).map(n => <button key={n} className={btnGhost} onClick={() => setLeads(leads.filter(x => x !== n))}>{n} {w('min · Remove', 'دقيقة · إزالة')}</button>)}</div></fieldset>}
      {mode === 'specific' && <label className="block space-y-2 text-sm"><span>{w('Date and time', 'التاريخ والوقت')} · <bdi>{settings.data?.timezone}</bdi></span><input type="datetime-local" dir="ltr" className={fieldCls} value={specific} onChange={e => setSpecific(e.target.value)} /><span className="block text-xs text-muted-foreground">{w('Uses your Settings timezone, not your device timezone. Times skipped or repeated by daylight saving are rejected.', 'يستخدم المنطقة الزمنية في إعداداتك، لا منطقة الجهاز. تُرفض الأوقات المتكررة أو غير الموجودة عند تغيير التوقيت الصيفي.')}</span></label>}
      <button className={btnPrimary} onClick={save} disabled={action.isPending || !settings.data}>{action.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{w('Save reminder', 'حفظ التذكير')}</button>
      <button className={btnGhost} onClick={() => setOpen(false)} disabled={action.isPending}>{w('Cancel', 'إلغاء')}</button>
    </DialogContent></Dialog>
  </Surface>;
}

export function NotificationCenter() {
  const q = useNotices();
  const settings = useNotificationSettings();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { w, lang } = useWords();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const reduce = useReducedMotion();
  const [busy, setBusy] = useState<string | null>(null);
  const request = { request: { credentials: 'include' as const } };
  const readAll = useReadAllNotifications(request);
  const read = useReadNotification(request);
  const dismiss = useDeleteNotification(request);
  const key = ['/api/notifications', user?.id];
  const change = async (notice: Notice | null, method: 'PATCH' | 'DELETE' | 'POST') => {
    if (busy !== null) return false;
    setBusy(notice?.id ?? 'all');
    await qc.cancelQueries({ queryKey: key });
    const previous = qc.getQueryData<Notices>(key);
    qc.setQueryData<Notices>(key, old => {
      if (!old) return old;
      const list = method === 'POST' ? old.notifications.map(n => ({ ...n, read: true })) : method === 'DELETE' ? old.notifications.filter(n => n.id !== notice?.id) : old.notifications.map(n => n.id === notice?.id ? { ...n, read: true } : n);
      return { notifications: list, unread_count: Math.max(0, old.unread_count - (method === 'POST' ? old.unread_count : notice?.read ? 0 : 1)) };
    });
    try {
      if (!notice) await readAll.mutateAsync();
      else if (method === 'DELETE') await dismiss.mutateAsync({ id: notice.id });
      else await read.mutateAsync({ id: notice.id, data: { read: true } });
      return true;
    }
    catch (error) { qc.setQueryData(key, previous); toast({ variant: 'destructive', title: w('Could not update notification', 'تعذّر تحديث الإشعار'), description: (error as Error).message }); return false; }
    finally { setBusy(null); qc.invalidateQueries({ queryKey: key }); }
  };
  const openNotice = async (notice: Notice) => {
    const path = safeNotificationPath(notice.url);
    if (!path) { toast({ variant: 'destructive', title: w('This notification has no safe destination.', 'لا يحتوي هذا الإشعار على وجهة آمنة.') }); return; }
    if (!notice.read && !(await change(notice, 'PATCH'))) return;
    navigate(path);
  };
  const today = settings.data ? dateInTimezone(new Date(), settings.data.timezone) : '';
  return <Dialog open onOpenChange={value => { if (!value) navigate('/'); }}><DialogContent className="left-0 top-0 flex h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:rounded-none [&>button:last-child]:hidden" dir={lang === 'ar' ? 'rtl' : 'ltr'} data-testid="notification-center">
    <DialogDescription className="sr-only">{w('Your reminders and updates. Swipe or use Dismiss to remove an item.', 'تذكيراتك ومستجداتك. اسحب العنصر أو استخدم زر «استبعاد» لإزالته.')}</DialogDescription>
    <header className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-2 border-b border-border pb-3"><DialogTitle asChild><h1 className="flex items-center gap-2 font-display text-2xl"><Bell className="h-5 w-5 text-gold" />{w('Notifications', 'الإشعارات')}</h1></DialogTitle><Link href="/" className={btnGhost}>{w('Close', 'إغلاق')}</Link><button className={cn(btnGhost, 'w-full sm:w-auto')} disabled={busy !== null || !q.data?.unread_count} onClick={() => void change(null, 'POST')}>{w('Mark all as read', 'تحديد الكل كمقروء')}</button></header>
    <div className="mx-auto w-full max-w-2xl flex-1 space-y-6 overflow-y-auto py-5">
      {q.isLoading || settings.isLoading ? <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div> : q.isError || settings.isError ? <ErrorState onRetry={() => { q.refetch(); settings.refetch(); }} /> : !q.data?.notifications.length ? <Surface className="p-8 text-center"><Bell className="mx-auto mb-3 h-8 w-8 text-gold" /><h2 className="font-display text-xl">{w('All caught up', 'أنت مطّلع على كل جديد')}</h2><p className="mt-2 text-sm text-muted-foreground">{w('Your reminders and updates will appear here.', 'ستظهر تذكيراتك ومستجداتك هنا.')}</p></Surface> : (['today', 'earlier'] as const).map(group => {
        const list = q.data.notifications.filter(n => (settings.data && dateInTimezone(n.created_at, settings.data.timezone) === today) === (group === 'today'));
        return list.length ? <section key={group}><h2 className="mb-3 text-sm font-semibold text-gold">{group === 'today' ? w('Today', 'اليوم') : w('Earlier', 'سابقًا')}</h2><div className="space-y-3">{list.map(n => <motion.div key={n.id} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} drag={busy === null ? 'x' : false} dragConstraints={{ left: 0, right: 0 }} dragElastic={0.35} onDragEnd={(_event, info) => { if (Math.abs(info.offset.x) > 90) void change(n, 'DELETE'); }} className="touch-pan-y">
          <Surface className={cn('overflow-hidden', !n.read && 'border-gold-400/60 bg-gold-soft/30')}><button className="block min-h-11 w-full p-4 text-start" disabled={busy !== null} onClick={() => void openNotice(n)}><div className="flex items-start gap-2"><h3 className="min-w-0 flex-1 break-words font-medium">{n.title}</h3>{!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gold-500" aria-label={w('Unread', 'غير مقروء')} />}</div><p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{n.body}</p><p className="mt-2 text-xs text-muted-foreground">{new Date(n.created_at).toLocaleString(lang, { timeZone: settings.data?.timezone, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p></button><div className="flex justify-end border-t border-border px-3 py-1"><button className={cn(btnGhost, 'border-0 text-danger-ink')} disabled={busy !== null} onClick={() => void change(n, 'DELETE')}><Trash2 className="h-4 w-4" />{w('Dismiss', 'استبعاد')}</button></div></Surface>
        </motion.div>)}</div></section> : null;
      })}
    </div>
  </DialogContent></Dialog>;
}