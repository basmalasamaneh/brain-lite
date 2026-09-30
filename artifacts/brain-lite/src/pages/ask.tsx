import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { ArrowUp, ChevronRight, Lock, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { useAuth } from '@workspace/replit-auth-web';
import { useAskBrain, type Memory } from '@workspace/api-client-react';
import { useI18n, usePageTitle, type TKey } from '@/lib/i18n';
import { askSession, useAskTurns, type ChatTurn } from '@/lib/ask-session';
import { formatDateTime } from '@/lib/memory';
import { Surface, TypeChip, btnGhost, btnPrimary , Skeleton } from '@/components/kit';
import { LogoMark, Medallion } from '@/components/brand';
import { PulseStar } from '@/components/motion';
import { cn } from '@/lib/utils';

const uid = () => Math.random().toString(36).slice(2);

function classifyError(err: unknown): 'generic' | 'auth' | 'config' {
  const status = (err as { status?: number } | null)?.status;
  if (status === 401 || status === 403) return 'auth';
  if (status === 501) return 'config'; // 503 is often transient (e.g. Gemini high demand) -> generic, retryable
  return 'generic';
}

function SourceCard({ m }: { m: Memory }) {
  const { lang } = useI18n();
  return (
    <Link href={`/memories/${m.id}`} data-testid={`link-source-${m.id}`}
      className="lift group flex min-w-0 items-center gap-3 rounded-xl border border-card-border bg-background/60 p-3 hover:border-gold-400/40">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><TypeChip type={m.type} />{m.event_date && <span className="truncate text-xs text-muted-foreground">{formatDateTime(m.event_date, lang)}</span>}</div>
        <p className="mt-1.5 truncate text-sm font-medium">{m.title}</p>
        {m.summary && <p className="truncate text-xs text-muted-foreground">{m.summary}</p>}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-gold rtl:-scale-x-100" />
    </Link>
  );
}

function Thinking() {
  const { t } = useI18n();
  return (
    <div className="rise flex items-start gap-3" data-testid="status-ask-loading" aria-live="polite">
      <PulseStar className="h-9 w-9 shrink-0" />
      <div className="w-full max-w-md rounded-2xl rounded-ss-md border border-card-border bg-card p-4">
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-gold-500/80" style={{ animationDelay: `${i * 140}ms` }} />)}
          <span className="ms-2 text-sm text-muted-foreground">{t('askThinking')}</span>
        </div>
        <div className="mt-3 space-y-2"><Skeleton className="h-3 w-4/5 rounded-md" /><Skeleton className="h-3 w-3/5 rounded-md" /></div>
      </div>
    </div>
  );
}

function Turn({ turn, onRetry, busy }: { turn: ChatTurn; onRetry: (q: string, id: string) => void; busy: boolean }) {
  const { t } = useI18n();
  if (turn.role === 'user') return (
    <div className="rise flex justify-end" data-testid={`msg-user-${turn.id}`}>
      <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-se-md gold-gradient px-4 py-2.5 text-gold-ink soft-shadow">{turn.text}</p>
    </div>
  );
  if (turn.role === 'error') {
    const key: TKey = turn.message === 'auth' ? 'askErrorAuth' : turn.message === 'config' ? 'askErrorConfig' : 'askError';
    return (
      <div role="alert" className="rise flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm" data-testid={`msg-error-${turn.id}`}>
        <span className="flex-1 text-danger-ink">{t(key)}</span>
        {turn.message !== 'config' && (
          <button disabled={busy} onClick={() => onRetry(turn.question, turn.id)} className={btnGhost} data-testid="button-ask-retry"><RotateCcw className="h-4 w-4" />{t('retry')}</button>
        )}
      </div>
    );
  }
  return (
    <div className="rise flex items-start gap-3" data-testid={`msg-answer-${turn.id}`}>
      <LogoMark className="h-9 w-9 shrink-0" />
      <div className="min-w-0 flex-1 space-y-3">
        <div className="gold-frame rounded-2xl rounded-ss-md p-4 leading-relaxed soft-shadow whitespace-pre-wrap">{turn.text}</div>
        {turn.sources.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('askSources')} · {turn.sources.length}</p>
            <div className="grid gap-2 sm:grid-cols-2">{turn.sources.map((m) => <SourceCard key={m.id} m={m} />)}</div>
          </div>
        ) : <p className="text-xs text-muted-foreground">{t('askNoSources')}</p>}
      </div>
    </div>
  );
}

export default function AskPage() {
  const { t, lang } = useI18n();
  usePageTitle(t('askTitle'));
  const { user, isAuthenticated, isLoading, login } = useAuth();
  const turns = useAskTurns();
  const ask = useAskBrain();
  const [q, setQ] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!isLoading) askSession.setOwner(user?.id ?? null); }, [user?.id, isLoading]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [turns.length, ask.isPending]);

  const send = (question: string, retryOf?: string) => {
    const text = question.trim();
    if (!text || ask.isPending) return;
    if (retryOf) askSession.removeById(retryOf);
    else askSession.push({ id: uid(), role: 'user', text });
    setQ('');
    const ownerAtSend = user?.id ?? null;
    ask.mutate({ data: { question: text, language: lang } }, {
      onSuccess: (res) => {
        if ((user?.id ?? null) !== ownerAtSend) return;
        askSession.push({ id: uid(), role: 'assistant', text: res.answer, sources: res.sources ?? [] });
      },
      onError: (err) => askSession.push({ id: uid(), role: 'error', question: text, message: classifyError(err) }),
    });
  };
  const onSubmit = (e: FormEvent) => { e.preventDefault(); send(q); };

  if (isLoading) return (
    <div className="mx-auto max-w-2xl space-y-4 pt-4"><Skeleton className="h-9 w-40" /><Skeleton className="h-40 rounded-2xl" /></div>
  );

  if (!isAuthenticated) return (
    <div className="mx-auto max-w-xl pt-4 md:pt-10">
      <Surface className="rise pattern-star relative overflow-hidden p-8 text-center sm:p-12">
        <Medallion className="mb-6"><Lock className="h-7 w-7" strokeWidth={1.5} /></Medallion>
        <h1 className="relative font-display text-3xl" data-testid="text-page-title">{t('askLoginTitle')}</h1>
        <p className="relative mx-auto mt-3 max-w-sm text-muted-foreground">{t('askLoginBody')}</p>
        <button onClick={login} className={cn(btnPrimary, 'relative mt-6')} data-testid="button-ask-login">{t('login')}</button>
      </Surface>
    </div>
  );

  const suggestions: TKey[] = ['askQ1', 'askQ2', 'askQ3'];
  return (
    <div className="mx-auto flex max-w-2xl flex-col">
      <header className="rise mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow mb-2 text-gold">{t('askEyebrow')}</p>
          <h1 className="font-display text-4xl sm:text-5xl" data-testid="text-page-title">{t('askTitle')}</h1>
          <p className="mt-1 text-muted-foreground">{t('askLead')}</p>
        </div>
        {turns.length > 0 && <button onClick={() => askSession.clear()} disabled={ask.isPending} className={btnGhost} data-testid="button-ask-clear"><Trash2 className="h-4 w-4" /><span className="hidden sm:inline">{t('askClear')}</span></button>}
      </header>

      {turns.length === 0 && !ask.isPending && (
        <div className="rise mb-6" data-testid="section-suggestions">
          <p className="mb-3 text-sm font-medium text-muted-foreground">{t('askSuggest')}</p>
          <div className="grid gap-2">
            {suggestions.map((k, i) => (
              <button key={k} onClick={() => send(t(k))} style={{ animationDelay: `${i * 70}ms` }} data-testid={`button-suggest-${i}`}
                className="rise lift flex items-center justify-between gap-3 rounded-2xl border border-card-border bg-card p-4 text-start soft-shadow hover:border-gold-400/40">
                <span className="min-w-0 font-display text-lg">{t(k)}</span><ArrowUp className="h-4 w-4 rotate-45 shrink-0 text-gold rtl:-rotate-45" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-5" aria-live="polite">
        {turns.map((turn) => <Turn key={turn.id} turn={turn} onRetry={(qq, id) => send(qq, id)} busy={ask.isPending} />)}
        {ask.isPending && <Thinking />}
        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} className="sticky bottom-24 z-20 -mx-2 mt-6 rounded-3xl bg-background/90 px-2 pb-1 pt-2 backdrop-blur md:bottom-6">
        <div className="flex items-end gap-2 rounded-2xl border border-card-border bg-card/95 p-2 soft-shadow backdrop-blur focus-within:border-gold-500">
          <textarea value={q} onChange={(e) => setQ(e.target.value)} rows={1} maxLength={1000} placeholder={t('askPlaceholder')} data-testid="input-ask"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(q); } }}
            className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground/70" />
          <button type="submit" disabled={!q.trim() || ask.isPending} aria-label={t('askSend')} data-testid="button-ask-send"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full gold-gradient text-gold-ink transition hover:brightness-110 active:scale-95 disabled:opacity-40">
            <ArrowUp className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-2 flex items-start gap-1.5 px-1 text-xs text-muted-foreground" data-testid="text-ask-privacy"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t('askPrivacy')}</p>
      </form>
    </div>
  );
}
