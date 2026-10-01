import { Link2, Sparkle, Star, Unlink, Layers3, Users } from 'lucide-react';
import type { Insight } from '@/lib/graph-model';
import { useI18n } from '@/lib/i18n';
import { graphText } from '@/lib/i18n-graph';
import { cn } from '@/lib/utils';

const ICONS = { top: Star, lonely: Unlink, newest: Link2, space: Layers3, person: Users } as const;

export function GraphInsights({ insights, onPick }: { insights: Insight[]; onPick: (id: string) => void }) {
  const { lang } = useI18n();
  const tx = graphText(lang);
  if (!insights.length) return null;
  return (
    <section aria-label={tx.insights} className="-mx-4 min-w-0 md:mx-0" data-testid="strip-graph-insights">
      <ul className="flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:px-0 [&::-webkit-scrollbar]:hidden">
        {insights.map((ins, i) => {
          const Icon = ICONS[ins.id as keyof typeof ICONS] ?? Sparkle;
          const clickable = !!ins.target;
          return (
            <li key={ins.id} className="rise snap-start" style={{ animationDelay: `${120 + i * 70}ms` }}>
              <button type="button" disabled={!clickable} onClick={() => ins.target && onPick(ins.target)}
                className={cn('flex min-h-14 w-[15.5rem] max-w-[75vw] items-center gap-3 rounded-2xl border border-gold-400/25 bg-card px-3.5 py-2 text-start soft-shadow transition', clickable && 'hover:border-gold-400/60 active:scale-[0.98]')}
                data-testid={`insight-${ins.id}`}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gold-soft text-gold"><Icon className="h-4 w-4" strokeWidth={1.75} /></span>
                <span className="min-w-0">
                  <span className="block text-[11px] font-semibold text-gold">{ins.label}</span>
                  <span className="block truncate text-sm font-medium">{ins.value}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
