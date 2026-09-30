import { CalendarPlus, ExternalLink } from 'lucide-react';
import type { Memory } from '@workspace/api-client-react';
import { useNotificationSettings } from '@/hooks/use-notifications';
import { useI18n } from '@/lib/i18n';
import { googleCalendarUrl } from '@/lib/google-calendar';
import { btnGhost } from '@/components/kit';
import { cn } from '@/lib/utils';

export function GoogleCalendarButton({ memory }: { memory: Memory }) {
  const { lang } = useI18n();
  const settings = useNotificationSettings();
  const ar = lang === 'ar';
  if (memory.type !== 'appointment') return null;
  const href = settings.data ? googleCalendarUrl(memory, settings.data.timezone) : null;
  const label = ar ? 'أضف إلى تقويم Google' : 'Add to Google Calendar';
  return (
    <div className="space-y-2" data-testid="google-calendar-section">
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
          className={cn(btnGhost, 'min-h-11 w-full border-gold-400/40 text-gold')}
          data-testid="link-google-calendar">
          <CalendarPlus className="h-4 w-4 shrink-0" aria-hidden /><span>{label}</span><ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </a>
      ) : (
        <button type="button" disabled className={cn(btnGhost, 'min-h-11 w-full opacity-50')} data-testid="link-google-calendar-disabled">
          <CalendarPlus className="h-4 w-4 shrink-0" aria-hidden />{label}
        </button>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        {!memory.event_date ? (ar ? 'أضف تاريخ الموعد أولًا.' : 'Add an appointment date first.')
          : settings.isError ? (ar ? 'تعذّر تحميل المنطقة الزمنية. أعد تحميل الصفحة للمحاولة مجددًا.' : 'Could not load your timezone. Reload to try again.')
          : settings.isLoading ? (ar ? 'جارٍ تحميل المنطقة الزمنية…' : 'Loading your timezone…')
          : !href ? (ar ? 'راجع تاريخ الموعد ووقته والمنطقة الزمنية قبل إضافته.' : 'Check the appointment date, time, and timezone before adding it.')
          : ar ? 'تفتح مسودة في Google لمراجعتها وحفظها. مدة المواعيد ذات الوقت المحدد ساعة افتراضيًا. التغييرات هنا لا تُزامن تلقائيًا.'
            : 'Opens a Google draft to review and save. Timed events default to one hour. Later changes here won’t sync automatically.'}
      </p>
    </div>
  );
}