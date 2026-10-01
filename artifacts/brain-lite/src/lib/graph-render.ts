import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import { Briefcase, Hash, Layers3, Plane, User, type LucideIcon } from 'lucide-react';
import type { GraphEdge, GraphNode, MemoryType } from '@workspace/api-client-react';
import { typeMeta } from '@/lib/memory';
import { edgeWeight, initials } from '@/lib/graph-model';

export interface SimNode extends SimulationNodeDatum {
  id: string;
  node: GraphNode;
  r: number;
  appear: number;
  /** When the new-memory pulse began; -Infinity for none. */
  pulseAt: number;
}
export interface SimLink extends SimulationLinkDatum<SimNode> {
  source: SimNode;
  target: SimNode;
  edge: GraphEdge;
}
export interface Camera { k: number; x: number; y: number }

export interface Palette {
  bg: string; card: string; fg: string; muted: string; border: string; surface: string; goldSoft: string;
  gold300: string; gold400: string; gold500: string; gold700: string; goldText: string;
  success: string; warning: string; danger: string; dark: boolean;
  raw: Record<string, string>;
}

const TOKENS = ['background', 'card', 'foreground', 'muted-foreground', 'border', 'surface-alt', 'gold-soft', 'gold-300', 'gold-400', 'gold-500', 'gold-700', 'gold-text', 'success', 'warning', 'danger'];

export function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const raw: Record<string, string> = {};
  for (const t of TOKENS) raw[t] = cs.getPropertyValue(`--${t}`).trim() || '42 59% 45%';
  const h = (t: string) => `hsl(${raw[t]})`;
  return {
    bg: h('background'), card: h('card'), fg: h('foreground'), muted: h('muted-foreground'), border: h('border'), surface: h('surface-alt'), goldSoft: h('gold-soft'),
    gold300: h('gold-300'), gold400: h('gold-400'), gold500: h('gold-500'), gold700: h('gold-700'), goldText: h('gold-text'),
    success: h('success'), warning: h('warning'), danger: h('danger'), dark: document.documentElement.classList.contains('dark'), raw,
  };
}
export const alpha = (p: Palette, token: string, a: number) => `hsl(${p.raw[token]} / ${a})`;

const SPACE_ICONS: Record<string, LucideIcon> = { project: Briefcase, person: User, trip: Plane, topic: Hash };
function iconFor(n: GraphNode): LucideIcon {
  if (n.kind === 'space') return SPACE_ICONS[n.type] ?? Layers3;
  return typeMeta[n.type as MemoryType]?.icon ?? typeMeta.other.icon;
}
function toneToken(n: GraphNode) {
  if (n.kind !== 'memory') return 'gold-text';
  switch (n.type) {
    case 'receipt': return 'success';
    case 'task': return 'warning';
    case 'other': return 'danger';
    case 'document': case 'note': return 'muted-foreground';
    default: return 'gold-text';
  }
}

const iconCache = new Map<string, HTMLImageElement>();
export function clearIconCache() { iconCache.clear(); }
function iconImage(n: GraphNode, color: string, onLoad: () => void) {
  const Icon = iconFor(n);
  const key = `${n.kind}:${n.type}:${color}`;
  let img = iconCache.get(key);
  if (!img) {
    const svg = renderToStaticMarkup(createElement(Icon, { size: 48, color, strokeWidth: 1.9 }));
    img = new Image();
    img.onload = onLoad;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    iconCache.set(key, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

let patternTile: { key: string; canvas: HTMLCanvasElement } | null = null;
/** Faint eight-point star lattice, the same motif as the app's .pattern-star surfaces. */
function patternFor(ctx: CanvasRenderingContext2D, p: Palette, dpr: number) {
  const key = `${p.raw['gold-500']}:${p.dark}:${dpr}`;
  if (!patternTile || patternTile.key !== key) {
    const s = 56 * dpr;
    const c = document.createElement('canvas');
    c.width = s; c.height = s;
    const g = c.getContext('2d')!;
    g.strokeStyle = alpha(p, 'gold-500', p.dark ? 0.09 : 0.12);
    g.lineWidth = 0.8 * dpr;
    const star = (cx: number, cy: number, r: number) => {
      g.beginPath();
      g.rect(cx - r, cy - r, r * 2, r * 2);
      g.save(); g.translate(cx, cy); g.rotate(Math.PI / 4); g.rect(-r, -r, r * 2, r * 2); g.restore();
      g.stroke();
    };
    star(s / 2, s / 2, s * 0.17);
    for (const [x, y] of [[0, 0], [s, 0], [0, s], [s, s]]) star(x, y, s * 0.17);
    patternTile = { key, canvas: c };
  }
  return ctx.createPattern(patternTile.canvas, 'repeat');
}

export interface Scene {
  nodes: SimNode[];
  links: SimLink[];
  camera: Camera;
  width: number;
  height: number;
  dpr: number;
  selected: string | null;
  highlight: Set<string> | null;
  now: number;
  reduced: boolean;
  palette: Palette;
  fontFamily: string;
  onIconLoad: () => void;
}

const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
export const APPEAR_MS = 420;
export const PULSE_MS = 5200;

export function sceneNeedsAnimation(s: Scene) {
  if (s.reduced) return false;
  return s.nodes.some((n) => s.now - n.appear < APPEAR_MS || s.now - n.pulseAt < PULSE_MS);
}

export function drawScene(ctx: CanvasRenderingContext2D, s: Scene) {
  const { camera: cam, palette: p, dpr } = s;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, s.width, s.height);
  const pat = patternFor(ctx, p, dpr);
  if (pat) {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = pat; ctx.fillRect(0, 0, s.width * dpr, s.height * dpr);
    ctx.restore();
  }
  ctx.setTransform(dpr * cam.k, 0, 0, dpr * cam.k, dpr * cam.x, dpr * cam.y);
  const k = cam.k;
  const dim = (id: string) => (s.highlight && !s.highlight.has(id) ? 0.13 : 1);
  const appearT = (n: SimNode) => (s.reduced ? 1 : easeOut((s.now - n.appear) / APPEAR_MS));

  // Edges
  for (const l of s.links) {
    const a = l.source, b = l.target;
    if (a.x == null || b.x == null) continue;
    const e = l.edge;
    const on = !s.highlight || (s.highlight.has(a.id) && s.highlight.has(b.id));
    const vis = Math.min(appearT(a), appearT(b)) * (on ? 1 : 0.1);
    if (vis <= 0.01) continue;
    const base = e.kind === 'connection' ? (e.suggested ? 0.75 : 0.7) : e.kind === 'membership' ? 0.38 : 0.32;
    ctx.globalAlpha = base * vis;
    ctx.strokeStyle = e.kind === 'mention' ? p.muted : e.kind === 'membership' ? p.gold400 : p.gold500;
    ctx.lineWidth = (edgeWeight(e) * (s.selected && (a.id === s.selected || b.id === s.selected) ? 1.5 : 1)) / Math.sqrt(k);
    ctx.setLineDash(e.suggested ? [5 / k, 4 / k] : e.kind === 'mention' ? [1.5 / k, 3 / k] : []);
    ctx.beginPath(); ctx.moveTo(a.x, a.y!); ctx.lineTo(b.x!, b.y!); ctx.stroke();
  }
  ctx.setLineDash([]);

  // Nodes
  for (const n of s.nodes) {
    if (n.x == null || n.y == null) continue;
    const t = appearT(n);
    if (t <= 0) continue;
    const r = n.r * (0.55 + 0.45 * t);
    const d = dim(n.id);
    ctx.globalAlpha = t * d;
    const x = n.x, y = n.y;
    const g = n.node;
    if (!s.reduced && s.now >= n.pulseAt && s.now - n.pulseAt < PULSE_MS && d === 1) {
      const ph = ((s.now - n.pulseAt) % 1600) / 1600;
      ctx.save();
      ctx.globalAlpha = (1 - ph) * 0.55;
      ctx.strokeStyle = p.gold400; ctx.lineWidth = 2 / k;
      ctx.beginPath(); ctx.arc(x, y, r + 2 + ph * 16, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = t * d;
    }
    if (g.kind === 'space') {
      ctx.fillStyle = p.goldSoft;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = p.gold400; ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = alpha(p, 'gold-700', 0.45); ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(x, y, r - 4.5, 0, Math.PI * 2); ctx.stroke();
      if (g.pinned) { ctx.fillStyle = p.gold500; ctx.beginPath(); ctx.arc(x + r * 0.72, y - r * 0.72, 3.6, 0, Math.PI * 2); ctx.fill(); }
    } else if (g.kind === 'person') {
      ctx.fillStyle = p.surface;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = alpha(p, 'gold-500', 0.35); ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = p.goldText;
      ctx.font = `600 ${Math.round(r * 0.78)}px ${s.fontFamily}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(initials(g.title), x, y + 0.5);
    } else {
      const tone = toneToken(g);
      ctx.fillStyle = p.card;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = alpha(p, tone, 0.7); ctx.lineWidth = 1.6; ctx.stroke();
      if (g.status === 'needs_review') { ctx.fillStyle = p.warning; ctx.beginPath(); ctx.arc(x + r * 0.7, y - r * 0.7, 2.6, 0, Math.PI * 2); ctx.fill(); }
    }
    if (g.kind !== 'person' && r * k >= 8) {
      const img = iconImage(g, `hsl(${p.raw[toneToken(g)]})`, s.onIconLoad);
      const sz = g.kind === 'space' ? r * 0.95 : r * 1.05;
      if (img) ctx.drawImage(img, x - sz / 2, y - sz / 2, sz, sz);
    }
    if (s.selected === n.id) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = p.gold400; ctx.lineWidth = 2.2 / k;
      ctx.beginPath(); ctx.arc(x, y, r + 5 / k + 2, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // Labels — only what is legible now; this is exactly what a snapshot exports.
  ctx.globalAlpha = 1;
  const fs = 11.5 / k;
  ctx.font = `500 ${fs}px ${s.fontFamily}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const n of s.nodes) {
    if (n.x == null || n.y == null) continue;
    const screenR = n.r * k;
    const inFocus = s.highlight?.has(n.id);
    const show = s.selected === n.id || (s.highlight ? inFocus && screenR > 7 : n.node.kind === 'space' ? screenR > 12 : screenR > 15);
    if (!show || appearT(n) < 0.9) continue;
    const label = n.node.title.length > 26 ? `${n.node.title.slice(0, 25)}\u2026` : n.node.title;
    const w = ctx.measureText(label).width;
    const y = n.y + n.r + 4 / k;
    ctx.fillStyle = alpha(p, 'card', 0.86);
    const pad = 4 / k;
    ctx.beginPath();
    ctx.roundRect(n.x - w / 2 - pad, y - pad / 2, w + pad * 2, fs + pad * 1.4, 6 / k);
    ctx.fill();
    ctx.fillStyle = s.selected === n.id ? p.goldText : p.fg;
    ctx.fillText(label, n.x, y + 0.5 / k);
  }
  ctx.globalAlpha = 1;
}

const LOGO_PATHS = [
  'M24 15.5c-2.6 0-4.4 1.7-4.6 3.9-1.9.3-3.3 1.9-3.3 3.9 0 1 .3 1.8.9 2.5-.6.7-.9 1.5-.9 2.5 0 2.2 1.8 3.9 4 3.9.7 1.6 2.2 2.3 3.9 2.3M24 15.5c2.6 0 4.4 1.7 4.6 3.9 1.9.3 3.3 1.9 3.3 3.9 0 1-.3 1.8-.9 2.5.6.7.9 1.5.9 2.5 0 2.2-1.8 3.9-4 3.9-.7 1.6-2.2 2.3-3.9 2.3',
];
const LOGO_STAR = 'M24 20.2l1.25 3.55L28.8 25l-3.55 1.25L24 29.8l-1.25-3.55L19.2 25l3.55-1.25z';

/** Brain Lite mark + wordmark, drawn natively so the exported PNG never taints. */
export function drawWatermark(ctx: CanvasRenderingContext2D, p: Palette, w: number, h: number, displayFont: string, rtl: boolean) {
  const size = 34;
  const text = 'Brain Lite';
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `600 20px ${displayFont}`;
  const tw = ctx.measureText(text).width;
  const boxW = size + 10 + tw + 24, boxH = size + 14;
  const bx = rtl ? 14 : w - boxW - 14, by = h - boxH - 14;
  ctx.fillStyle = alpha(p, 'card', 0.9);
  ctx.strokeStyle = alpha(p, 'gold-400', 0.5);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 12); ctx.fill(); ctx.stroke();
  ctx.translate(bx + 10, by + 7);
  ctx.scale(size / 48, size / 48);
  ctx.save(); ctx.translate(24, 24); ctx.rotate(Math.PI / 4);
  ctx.fillStyle = p.goldSoft; ctx.strokeStyle = p.gold500; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.roundRect(-14, -14, 28, 28, 7); ctx.fill(); ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = p.gold500; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
  for (const d of LOGO_PATHS) ctx.stroke(new Path2D(d));
  ctx.fillStyle = p.gold400; ctx.fill(new Path2D(LOGO_STAR));
  ctx.restore();
  ctx.save();
  ctx.font = `600 20px ${displayFont}`;
  ctx.fillStyle = p.fg; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText(text, bx + 10 + size + 10, by + boxH / 2 + 1);
  ctx.restore();
}
