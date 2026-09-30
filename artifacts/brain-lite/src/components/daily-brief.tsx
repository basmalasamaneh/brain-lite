import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { CalendarClock, CalendarDays, Hourglass, Lightbulb, Plus, Sparkle } from 'lucide-react';
import { useAuth } from '@workspace/replit-auth-web';
import { useListMemories } from '@workspace/api-client-react';
import { useI18n, type TKey } from '@/lib/i18n';
import { buildDailyBrief, type BriefItem, type ExpiringItem } from '@/lib/daily-brief';
import { fmt } from '@/lib/ask-session';
import { ErrorState, Surface, TypeIcon } from '@/components/kit';
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
    <Link href={`/memories/${m.id}`} data-testid={`link-brief-${mode}-${m.id}`} className="group flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-lavender">
      <TypeIcon type={m.type} className="h-8 w-8 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium group-hover:text-primary">{m.title}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {mode === 'today' ? (item.dateOnly ? t('briefAllDay') : f.time(item.date)) : `${f.day(item.date)}${item.dateOnly ? '' : ' · ' + f.time(item.date)}`}
        </p>
      </div>
      {mode === 'coming' && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{f.rel(item.days)}</span>}
    </Link>
  );
}

function ExpRow({ item }: { item: ExpiringItem }) {
  const { t } = useI18n();
  const f = useLocaleFmt();
  return (
    <Link href={`/memories/${item.memory.id}`} data-testid={`link-brief-expiring-${item.memory.id}`}
      className="group flex items-center gap-3 rounded-xl border border-amber/30 bg-amber/10 px-3 py-2.5 transition hover:border-amber/60">
      <Hourglass className="h-4 w-4 shrink-0 text-amber" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.memory.title}</p>
        <p className="text-xs text-muted-foreground">{t(`kind_${item.kind}` as TKey)} · {f.day(item.date)}</p>
      </div>
      <span className="shrink-0 rounded-full bg-amber/20 px-2 py-0.5 text-[11px] font-semibold text-amber tabular-nums">
        {item.days === 0 ? t('briefExpiresToday') : fmt(t('briefExpiresIn'), { n: f.n(item.days) })}
      </span>
    </Link>
  );
}

function Block({ title, hint, icon: Icon, children, className, testid }: { title: string; hint?: string; icon: typeof CalendarDays; children: React.ReactNode; className?: string; testid: string }) {
  return (
    <Surface className={cn('rise min-w-0 p-4 sm:p-5', className)} data-testid={testid}>
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h2 className="font-display text-base font-semibold">{title}</h2>
      </div>
      {hint && <p className="-mt-1 mb-2 text-xs text-muted-foreground">{hint}</p>}
      {children}
    </Surface>
  );
}

const Empty = ({ text }: { text: string }) => <p className="px-2 py-3 text-sm text-muted-foreground">{text}</p>;

export function DailyBriefSkeleton() {
  return (
    <div className="mb-10 space-y-4" data-testid="status-brief-loading">
      <div className="h-40 animate-pulse rounded-3xl bg-muted" />
      <div className="grid gap-4 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-36 animate-pulse rounded-2xl bg-muted" />)}</div>
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
      <div className="rise relative overflow-hidden rounded-3xl bg-primary p-6 text-primary-foreground sm:p-8">
        <div className="breathe pointer-events-none absolute -end-16 -top-20 h-64 w-64 rounded-full bg-white/15 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-24 end-24 h-48 w-48 rounded-full bg-amber/30 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-primary-foreground/75" data-testid="text-date">{dateLine}</p>
            <h1 className="font-display mt-1 text-3xl font-bold leading-tight sm:text-4xl" data-testid="text-page-title">{greet}{user?.firstName ? `, ${user.firstName}` : ''}</h1>
          </div>
          <Link href="/capture" className="inline-flex items-center gap-2 rounded-xl bg-card px-4 py-2.5 text-sm font-semibold text-primary transition hover:gap-3 active:scale-95" data-testid="link-hero-capture">
            <Plus className="h-4 w-4" />{t('captureSomething')}
          </Link>
        </div>
        <div className="relative mt-5 flex flex-wrap gap-x-6 gap-y-2">
          {sums.map(({ k, v }) => (
            <p key={k} className="text-sm text-primary-foreground/80"><span className="font-display text-2xl font-bold text-primary-foreground tabular-nums" data-testid={`text-${k}`}>{f.n(v)}</span> {t(k)}</p>
          ))}
        </div>
        <div className="relative mt-5 flex items-start gap-2.5 rounded-2xl bg-white/12 p-3 text-sm backdrop-blur-sm" data-testid="text-insight">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" />
          <div><p>{insText}</p><p className="mt-0.5 text-[11px] text-primary-foreground/60">{t('insightRule')}</p></div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Block title={t('briefToday')} icon={CalendarDays} testid="section-brief-today">
          {brief.today.length ? brief.today.map((i) => <Row key={i.memory.id} item={i} mode="today" />) : <Empty text={t('briefNothingToday')} />}
        </Block>
        <Block title={t('briefComingUp')} hint={t('briefComingUpHint')} icon={CalendarClock} testid="section-brief-coming">
          {brief.comingUp.length ? brief.comingUp.slice(0, 6).map((i) => <Row key={i.memory.id} item={i} mode="coming" />) : <Empty text={t('briefNothingComing')} />}
        </Block>
        <Block title={t('briefExpiring')} hint={t('briefExpiringHint')} icon={Hourglass} testid="section-brief-expiring" className={brief.expiring.length ? 'border-amber/40' : ''}>
          <div className="space-y-2">{brief.expiring.length ? brief.expiring.slice(0, 5).map((i, idx) => <ExpRow key={`${i.memory.id}-${idx}`} item={i} />) : <Empty text={t('briefNothingExpiring')} />}</div>
        </Block>
        <Block title={t('briefRecent')} icon={Sparkle} testid="section-brief-recent">
          {brief.recent.length ? brief.recent.map((m) => (
            <Link key={m.id} href={`/memories/${m.id}`} data-testid={`link-brief-recent-${m.id}`} className="group flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-lavender">
              <TypeIcon type={m.type} className="h-8 w-8 shrink-0 rounded-lg" />
              <p className="min-w-0 flex-1 truncate text-sm font-medium group-hover:text-primary">{m.title}</p>
            </Link>
          )) : <Empty text={t('emptyBody')} />}
          {brief.recent.length > 0 && <Link href="/memories" className="mt-1 inline-block px-2 text-sm font-medium text-primary" data-testid="link-see-all">{t('seeAll')}</Link>}
        </Block>
      </div>
    </section>
  );
}
