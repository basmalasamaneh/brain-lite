import { Link } from 'wouter';
import { ArrowUpRight } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { graphText } from '@/lib/i18n-graph';

/** Home entry to the Life Graph: a gold card with a quiet constellation ornament. */
export function ExploreGraphCard() {
  const { lang } = useI18n();
  const tx = graphText(lang);
  const pts: [number, number, number][] = [[40, 44, 9], [92, 26, 6], [120, 62, 11], [74, 84, 7], [150, 30, 5], [20, 86, 5]];
  return (
    <section className="rise mb-10" data-testid="section-explore-graph">
      <Link href="/graph" className="group relative block overflow-hidden rounded-3xl gold-gradient p-5 text-gold-ink lux-shadow transition active:scale-[0.99] sm:p-6" data-testid="link-explore-graph">
        <svg viewBox="0 0 170 110" className="pointer-events-none absolute -end-4 -top-2 h-32 w-48 opacity-70 transition-transform duration-700 group-hover:scale-105 rtl:-scale-x-100" aria-hidden>
          {[[0, 1], [1, 2], [0, 3], [2, 3], [2, 4], [0, 5]].map(([a, b], i) => (
            <line key={i} x1={pts[a][0]} y1={pts[a][1]} x2={pts[b][0]} y2={pts[b][1]} stroke="hsl(var(--ink))" strokeOpacity={0.35} strokeWidth={1} strokeDasharray={i === 4 ? '3 3' : undefined} />
          ))}
          {pts.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill="hsl(var(--gold-100))" fillOpacity={0.55} stroke="hsl(var(--ink))" strokeOpacity={0.45} strokeWidth={i === 2 ? 2.2 : 1} />)}
        </svg>
        <p className="eyebrow relative opacity-80">{tx.eyebrow}</p>
        <h2 className="relative mt-1 max-w-[70%] font-display text-3xl leading-tight">{tx.exploreTitle}</h2>
        <p className="relative mt-1 max-w-[80%] text-sm opacity-80">{tx.exploreBody}</p>
        <span className="relative mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-card/85 px-4 text-sm font-semibold text-foreground">
          {tx.exploreCta}<ArrowUpRight className="h-4 w-4 text-gold transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100" />
        </span>
      </Link>
    </section>
  );
}
