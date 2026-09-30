import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { CalendarClock, CalendarDays, Hourglass, Lightbulb, Plus, Sparkle } from 'lucide-react';
import { useAuth } from '@workspace/replit-auth-web';
import { useListMemories } from '@workspace/api-client-react';
import { useI18n, type TKey } from '@/lib/i18n';
import { buildDailyBrief, type BriefItem, type ExpiringItem } from '@/lib/daily-brief';
import { fmt } from '@/lib/ask-session';
import { ErrorState, InfoTip, Skeleton, Surface, TypeIcon, btnPrimary } from '@/components/kit';
import { CornerFlourishes, IconCircle, OrnamentDivider } from '@/components/brand';
import { CountUp, Stagger, StaggerItem } from '@/components/motion';
import { cn } from '@/lib/utils';

function useLocaleFmt() {
  const { lang, t } = useI18n();
  const loc = lang === 'ar' ? 'ar' : 'en';
  const day = (d: Date) => d.toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'short' });
  const time = (d: Date) => d.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' });
  const n = (x: number) => x.toLocaleString(loc);
  const rel = (days: number) => (days === 1 ? t('briefTomorrow') : fmt(t('briefInDays'), { n: n(days) }));
  return { day, time, n, rel };
}

function Row({ item, mode }: { item: BriefItem; mode: 'today' | 'coming' }) {
  const { t } = useI18n();
  const f = useLocaleFmt();
  const m = item.memory;
  return (
    <Link href={`/memories/${m.id}`} data-testid={`link-brief-${mode}-${m.id}`} className="group flex min-h-12 items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-gold-soft/70">
      <TypeIcon type={m.type} className="h-9 w-9" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium group-hover:text-gold">{m.title}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {mode === 'today' ? (item.dateOnly ? t('briefAllDay') : f.time(item.date)) : `${f.day(item.date)}${item.dateOnly ? '' : ' · ' + f.time(item.date)}`}
        </p>
      </div>
      {mode === 'coming' && <span className="shrink-0 rounded-full bg-surface-alt px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">{f.rel(item.days)}</span>}
    </Link>
  );
}

function ExpRow({ item }: { item: ExpiringItem }) {
  const { t } = useI18n();
  const f = useLocaleFmt();
  return (
    <Link href={`/memories/${item.memory.id}`} data-testid={`link-brief-expiring-${item.memory.id}`}
      className="group flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5 transition hover:border-warning/60">
      <Hourglass className="h-4 w-4 shrink-0 text-warning-ink" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.memory.title}</p>
        <p className="text-xs text-muted-foreground">{t(`kind_${item.kind}` as TKey)} · {f.day(item.date)}</p>
      </div>
      <span className="shrink-0 rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-semibold text-warning-ink tabular-nums">
        {item.days === 0 ? t('briefExpiresToday') : fmt(t('briefExpiresIn'), { n: f.n(item.days) })}
      </span>
    </Link>
  );
}

function Block({ title, hint, icon: Icon, children, className, testid }: { title: string; hint?: string; icon: typeof CalendarDays; children: React.ReactNode; className?: string; testid: string }) {
  return (
    <Surface className={cn('lift h-full min-w-0 p-4 sm:p-5', className)} data-testid={testid}>
      <div className="mb-3 flex items-center gap-3">
        <IconCircle icon={Icon} size="sm" />
        <h2 className="font-display text-xl">{title}</h2>
      </div>
      {hint && <p className="-mt-1 mb-2 text-xs text-muted-foreground">{hint}</p>}
      {children}
    </Surface>
  );
}

const Empty = ({ text }: { text: string }) => <p className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground"><span className="h-1.5 w-1.5 shrink-0 rotate-45 bg-gold-400/70" aria-hidden />{text}</p>;

export function DailyBriefSkeleton() {
  return (
    <div className="mb-10 space-y-4" data-testid="status-brief-loading">
      <Skeleton className="h-56 rounded-3xl" />
      <div className="grid gap-4 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
    </div>
  );
}

export function DailyBriefSection() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const list = useListMemories();
  const f = useLocaleFmt();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const brief = useMemo(() => buildDailyBrief(list.data ?? [], now), [list.data, now]);

  if (list.isLoading) return <DailyBriefSkeleton />;
  if (list.isError) return <div className="mb-10"><ErrorState onRetry={() => list.refetch()} /></div>;

  const greet = t(brief.greeting === 'morning' ? 'greetMorning' : brief.greeting === 'afternoon' ? 'greetAfternoon' : 'greetEvening');
  const ins = brief.insight;
  const insText = fmt(t(`ins_${ins.kind}` as TKey), { n: 'count' in ins ? f.n(ins.count) : '' });
  const dateLine = new Date().toLocaleDateString(lang === 'ar' ? 'ar' : 'en', { weekday: 'long', day: 'numeric', month: 'long' });
  const sums: { k: TKey; v: number }[] = [
    { k: 'sumTotal', v: brief.summary.total }, { k: 'sumTasks', v: brief.summary.tasks }, { k: 'sumUpcoming', v: brief.summary.upcoming },
  ];

  return (
    <section className="mb-10 space-y-4" data-testid="section-daily-brief">
      <div className="rise gold-frame pattern-star relative overflow-hidden rounded-3xl p-6 lux-shadow sm:p-9">
        <CornerFlourishes />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0">
            <p className="eyebrow text-gold">{t('homeEyebrow')}</p>
            <h1 className="font-display mt-2 text-4xl leading-tight sm:text-5xl" data-testid="text-page-title">{greet}{user?.firstName ? `, ${user.firstName}` : ''}</h1>
            <p className="mt-1 text-sm text-muted-foreground" data-testid="text-date">{dateLine}</p>
          </div>
          <Link href="/capture" className={cn(btnPrimary, 'w-full sm:w-auto')} data-testid="link-hero-capture">
            <Plus className="h-4 w-4" />{t('captureSomething')}
          </Link>
        </div>
        <div className="relative mt-7 grid grid-cols-3 divide-x divide-border rounded-2xl border border-border bg-background/60 rtl:divide-x-reverse">
          {sums.map(({ k, v }) => (
            <div key={k} className="min-w-0 px-3 py-3 text-center sm:px-5">
              <CountUp value={v} format={f.n} className="block font-display text-3xl font-semibold text-gold sm:text-4xl" data-testid={`text-${k}`} />
              <span className="block truncate text-xs text-muted-foreground">{t(k)}</span>
            </div>
          ))}
        </div>
        <div className="relative mt-5 flex items-start gap-3 rounded-2xl border border-gold-400/40 bg-gold-soft/70 p-4" data-testid="text-insight">
          <IconCircle icon={Lightbulb} size="sm" className="bg-card" />
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg leading-snug sm:text-xl">{insText}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{t('insightRule')}</p>
          </div>
          <InfoTip text={t('tipInsight')} />
        </div>
      </div>

      <OrnamentDivider className="py-2" />

      <Stagger className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <StaggerItem>
        <Block title={t('briefToday')} icon={CalendarDays} testid="section-brief-today">
          {brief.today.length ? brief.today.map((i) => <Row key={i.memory.id} item={i} mode="today" />) : <Empty text={t('briefNothingToday')} />}
        </Block>
        </StaggerItem>
        <StaggerItem>
        <Block title={t('briefComingUp')} hint={t('briefComingUpHint')} icon={CalendarClock} testid="section-brief-coming">
          {brief.comingUp.length ? brief.comingUp.slice(0, 6).map((i) => <Row key={i.memory.id} item={i} mode="coming" />) : <Empty text={t('briefNothingComing')} />}
        </Block>
        </StaggerItem>
        <StaggerItem>
        <Block title={t('briefExpiring')} hint={t('briefExpiringHint')} icon={Hourglass} testid="section-brief-expiring" className={brief.expiring.length ? 'border-warning/40' : ''}>
          <div className="space-y-2">{brief.expiring.length ? brief.expiring.slice(0, 5).map((i, idx) => <ExpRow key={`${i.memory.id}-${idx}`} item={i} />) : <Empty text={t('briefNothingExpiring')} />}</div>
        </Block>
        </StaggerItem>
        <StaggerItem>
        <Block title={t('briefRecent')} icon={Sparkle} testid="section-brief-recent">
          {brief.recent.length ? brief.recent.map((m) => (
            <Link key={m.id} href={`/memories/${m.id}`} data-testid={`link-brief-recent-${m.id}`} className="group flex min-h-12 items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-gold-soft/70">
              <TypeIcon type={m.type} className="h-9 w-9" />
              <p className="min-w-0 flex-1 truncate text-sm font-medium group-hover:text-gold">{m.title}</p>
            </Link>
          )) : <Empty text={t('emptyBody')} />}
          {brief.recent.length > 0 && <Link href="/memories" className="mt-1 inline-flex min-h-11 items-center px-2 text-sm font-semibold text-gold underline-offset-4 hover:underline" data-testid="link-see-all">{t('seeAll')}</Link>}
        </Block>
        </StaggerItem>
      </Stagger>
    </section>
  );
}
