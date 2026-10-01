import { useState } from 'react';
import { Info, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { graphText } from '@/lib/i18n-graph';

function Line({ dash, width = 1.4, tone = 'var(--gold-500)', opacity = 0.8 }: { dash?: string; width?: number; tone?: string; opacity?: number }) {
  return <svg width="28" height="10" aria-hidden className="shrink-0"><line x1="1" y1="5" x2="27" y2="5" stroke={`hsl(${tone})`} strokeOpacity={opacity} strokeWidth={width} strokeDasharray={dash} strokeLinecap="round" /></svg>;
}

export function GraphLegend() {
  const { lang } = useI18n();
  const tx = graphText(lang);
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-expanded={false} aria-label={tx.legend}
        className="grid h-11 w-11 place-items-center rounded-full border border-gold-400/40 bg-card/95 text-gold lux-shadow backdrop-blur" data-testid="button-graph-legend">
        <Info className="h-4 w-4" />
      </button>
    );
  }
  return (
    <div className="w-60 rounded-2xl border border-gold-400/30 bg-card/95 p-3 text-xs lux-shadow backdrop-blur" role="region" aria-label={tx.legend} data-testid="panel-graph-legend">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="eyebrow text-gold">{tx.legend}</p>
        <button type="button" onClick={() => setOpen(false)} aria-label={tx.hideLegend} aria-expanded className="-me-2 grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:text-foreground" data-testid="button-graph-legend-close"><X className="h-4 w-4" /></button>
      </div>
      <ul className="space-y-2">
        <li className="flex items-center gap-2.5"><span className="h-4 w-4 rounded-full border-[1.5px] border-gold-500/70 bg-card" />{tx.legendMemory}</li>
        <li className="flex items-center gap-2.5"><span className="h-5 w-5 rounded-full border-[3px] border-gold-400 bg-gold-soft" />{tx.legendSpace}</li>
        <li className="flex items-center gap-2.5"><span className="grid h-5 w-5 place-items-center rounded-full bg-surface-alt text-[9px] font-semibold text-gold ring-1 ring-gold-500/30">AB</span>{tx.legendPerson}</li>
        <li className="flex items-center gap-2.5"><Line />{tx.legendLink}</li>
        <li className="flex items-center gap-2.5"><Line width={2.8} />{tx.legendStrong}</li>
        <li className="flex items-center gap-2.5"><Line dash="4 3" />{tx.legendSuggested}</li>
        <li className="flex items-center gap-2.5"><Line tone="var(--gold-400)" opacity={0.45} width={1} />{tx.legendMember}</li>
        <li className="flex items-center gap-2.5"><Line tone="var(--muted-foreground)" opacity={0.6} width={1} dash="1.5 3" />{tx.legendMention}</li>
      </ul>
    </div>
  );
}
