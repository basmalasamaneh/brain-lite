import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation } from 'd3-force';
import type { GraphEdge, GraphNode } from '@workspace/api-client-react';
import { nodeRadius } from '@/lib/graph-model';
import { clearIconCache, drawScene, drawWatermark, readPalette, sceneNeedsAnimation, type Camera, type Palette, type Scene, type SimLink, type SimNode } from '@/lib/graph-render';

export interface GraphCanvasHandle {
  zoomBy: (factor: number) => void;
  recenter: () => void;
  zoomToNode: (id: string) => void;
  exportPng: (rtl: boolean) => Promise<Blob>;
}

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  highlight: Set<string> | null;
  reduced: boolean;
  newIds: Set<string>;
  sheetOpen: boolean;
  ariaLabel: string;
  onSelect: (id: string | null) => void;
  onPoorPerformance: () => void;
}

const MIN_K = 0.2, MAX_K = 4;
const SETTLE_MS = 4500;
const LONG_PRESS_MS = 430;
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));

export const GraphCanvas = forwardRef<GraphCanvasHandle, Props>(function GraphCanvas(props, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const st = useRef({
    nodes: [] as SimNode[], links: [] as SimLink[], byId: new Map<string, SimNode>(),
    positions: new Map<string, { x: number; y: number; fx?: number | null; fy?: number | null }>(),
    camera: { k: 1, x: 0, y: 0 } as Camera, width: 0, height: 0, dpr: 1,
    palette: null as Palette | null, font: 'system-ui', display: 'Georgia',
    sim: null as Simulation<SimNode, SimLink> | null, settleTimer: 0 as number | ReturnType<typeof setTimeout>,
    raf: 0, camAnim: null as null | { from: Camera; to: Camera; start: number; dur: number },
    userMoved: false, hidden: false, frames: [] as number[], lastFrame: 0, probeStart: 0, perfReported: false, firstLoad: true,
  });

  // ---------- render loop ----------
  const buildScene = (now: number): Scene | null => {
    const s = st.current, p = propsRef.current;
    if (!s.palette || !s.width) return null;
    return {
      nodes: s.nodes, links: s.links, camera: s.camera, width: s.width, height: s.height, dpr: s.dpr,
      selected: p.selectedId, highlight: p.highlight, now, reduced: p.reduced, palette: s.palette, fontFamily: s.font, onIconLoad: requestDraw,
    };
  };

  function frame(now: number) {
    const s = st.current;
    s.raf = 0;
    if (s.hidden) return;
    if (s.camAnim) {
      const a = s.camAnim, t = Math.min(1, (now - a.start) / a.dur), e = 1 - Math.pow(1 - t, 3);
      s.camera = { k: a.from.k + (a.to.k - a.from.k) * e, x: a.from.x + (a.to.x - a.from.x) * e, y: a.from.y + (a.to.y - a.from.y) * e };
      if (t >= 1) s.camAnim = null;
    }
    const ctx = canvasRef.current?.getContext('2d');
    const scene = buildScene(now);
    if (ctx && scene) drawScene(ctx, scene);
    const simActive = !!s.sim && s.sim.alpha() > s.sim.alphaMin() && !propsRef.current.reduced;
    // Frame-rate probe while the simulation is working hardest.
    if (simActive && !s.perfReported) {
      // Time-window probe: works even at very low frame rates, before the sim settles.
      if (!s.probeStart) s.probeStart = now;
      if (s.lastFrame) s.frames.push(now - s.lastFrame);
      s.lastFrame = now;
      const elapsed = now - s.probeStart;
      if (elapsed >= 1200 && s.frames.length >= 3) {
        const avg = s.frames.reduce((a, b) => a + b, 0) / s.frames.length;
        s.perfReported = true;
        if (avg > 48) propsRef.current.onPoorPerformance();
      } else if (elapsed >= 2000) { s.perfReported = true; propsRef.current.onPoorPerformance(); }
    } else { s.lastFrame = 0; s.probeStart = 0; s.frames = []; }
    if (simActive || s.camAnim || (scene && sceneNeedsAnimation(scene))) s.raf = requestAnimationFrame(frame);
  }
  function requestDraw() {
    const s = st.current;
    if (!s.raf && !s.hidden) s.raf = requestAnimationFrame(frame);
  }

  // ---------- camera ----------
  const animateCamera = (to: Camera, dur = 480) => {
    const s = st.current;
    if (propsRef.current.reduced) { s.camera = to; s.camAnim = null; requestDraw(); return; }
    s.camAnim = { from: { ...s.camera }, to, start: performance.now(), dur };
    requestDraw();
  };
  const fitCamera = (): Camera => {
    const s = st.current;
    const pts = s.nodes.filter((n) => n.x != null);
    if (!pts.length || !s.width) return { k: 1, x: s.width / 2, y: s.height / 2 };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of pts) { x0 = Math.min(x0, n.x! - n.r); y0 = Math.min(y0, n.y! - n.r); x1 = Math.max(x1, n.x! + n.r); y1 = Math.max(y1, n.y! + n.r + 16); }
    const pad = 28;
    const k = clampK(Math.min((s.width - pad * 2) / Math.max(1, x1 - x0), (s.height - pad * 2) / Math.max(1, y1 - y0), 1.8));
    return { k, x: s.width / 2 - ((x0 + x1) / 2) * k, y: s.height / 2 - ((y0 + y1) / 2) * k };
  };
  const zoomAt = (factor: number, sx: number, sy: number, animate = false) => {
    const s = st.current, c = s.camera;
    const k = clampK(c.k * factor);
    const to = { k, x: sx - ((sx - c.x) / c.k) * k, y: sy - ((sy - c.y) / c.k) * k };
    s.userMoved = true;
    if (animate) animateCamera(to, 260); else { s.camAnim = null; s.camera = to; requestDraw(); }
  };
  const zoomToNode = (id: string) => {
    const s = st.current, n = s.byId.get(id);
    if (!n || n.x == null) return;
    const k = clampK(Math.max(s.camera.k, 1.5));
    const anchorY = propsRef.current.sheetOpen && s.width < 768 ? 0.3 : 0.5;
    s.userMoved = true;
    animateCamera({ k, x: s.width / 2 - n.x * k, y: s.height * anchorY - n.y! * k });
  };

  useImperativeHandle(ref, () => ({
    zoomBy: (f) => zoomAt(f, st.current.width / 2, st.current.height / 2, true),
    recenter: () => { st.current.userMoved = false; animateCamera(fitCamera()); },
    zoomToNode,
    exportPng: async (rtl) => {
      // Copy the live pixels so the image matches exactly what is readable right now.
      const s = st.current, live = canvasRef.current;
      const off = document.createElement('canvas');
      if (!live || !s.palette || !live.width) throw new Error('Graph not ready');
      off.width = live.width; off.height = live.height;
      const ctx = off.getContext('2d');
      if (!ctx) throw new Error('Graph not ready');
      ctx.drawImage(live, 0, 0);
      drawWatermark(ctx, s.palette, off.width, off.height, s.display, rtl);
      const dataUrl = off.toDataURL('image/png');
      const res = await fetch(dataUrl);
      return res.blob();
    },
  }));

  // ---------- setup: size, palette, visibility, theme ----------
  useEffect(() => {
    const s = st.current;
    const canvas = canvasRef.current!, wrap = wrapRef.current!;
    const readFonts = () => {
      const cs = getComputedStyle(document.documentElement);
      s.font = cs.getPropertyValue('--app-font-sans').trim() || 'system-ui';
      s.display = cs.getPropertyValue('--app-font-display').trim() || 'Georgia';
    };
    s.palette = readPalette(); readFonts();
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const prevW = s.width, prevH = s.height;
      s.width = r.width; s.height = r.height; s.dpr = dpr;
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
      canvas.style.width = `${r.width}px`; canvas.style.height = `${r.height}px`;
      if (prevW) { s.camera = { ...s.camera, x: s.camera.x + (r.width - prevW) / 2, y: s.camera.y + (r.height - prevH) / 2 }; }
      else s.camera = { k: 1, x: r.width / 2, y: r.height / 2 };
      requestDraw();
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(wrap);
    const mo = new MutationObserver(() => { s.palette = readPalette(); clearIconCache(); readFonts(); requestDraw(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'dir', 'lang'] });
    const vis = () => {
      s.hidden = document.visibilityState === 'hidden';
      s.frames = []; s.lastFrame = 0; s.probeStart = 0;
      if (s.hidden) { s.sim?.stop(); if (s.raf) cancelAnimationFrame(s.raf); s.raf = 0; }
      else { if (s.sim && s.sim.alpha() > s.sim.alphaMin() && !propsRef.current.reduced) s.sim.restart(); requestDraw(); }
    };
    document.addEventListener('visibilitychange', vis);
    return () => {
      ro.disconnect(); mo.disconnect(); document.removeEventListener('visibilitychange', vis);
      s.sim?.stop(); clearTimeout(s.settleTimer); if (s.raf) cancelAnimationFrame(s.raf); s.raf = 0;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- data -> simulation ----------
  const { nodes, edges, reduced, newIds } = props;
  const newIdsRef = useRef(newIds);
  newIdsRef.current = newIds;
  useEffect(() => {
    const s = st.current;
    for (const n of s.nodes) if (n.x != null) s.positions.set(n.id, { x: n.x, y: n.y!, fx: n.fx, fy: n.fy });
    s.sim?.stop(); clearTimeout(s.settleTimer);
    s.frames = []; s.lastFrame = 0; s.probeStart = 0;
    const now = performance.now();
    const fresh = s.firstLoad;
    const byId = new Map<string, SimNode>();
    const adjacencyFirst = new Map<string, string>();
    for (const e of edges) { if (!adjacencyFirst.has(e.source)) adjacencyFirst.set(e.source, e.target); if (!adjacencyFirst.has(e.target)) adjacencyFirst.set(e.target, e.source); }
    const ordered = [...nodes].sort((a, b) => (a.kind === 'space' ? -1 : 0) - (b.kind === 'space' ? -1 : 0) || b.count - a.count);
    ordered.forEach((g, i) => {
      const prev = s.positions.get(g.id);
      const sn: SimNode = { id: g.id, node: g, r: nodeRadius(g), appear: prev ? now - 10_000 : now + (reduced ? 0 : Math.min(i * 14, 700)), pulseAt: -Infinity };
      const oldPulse = s.byId.get(g.id)?.pulseAt;
      if (oldPulse != null) sn.pulseAt = oldPulse;
      else if (newIdsRef.current.has(g.id)) sn.pulseAt = sn.appear;
      if (prev) { sn.x = prev.x; sn.y = prev.y; sn.fx = prev.fx ?? undefined; sn.fy = prev.fy ?? undefined; }
      else {
        const anchor = s.positions.get(adjacencyFirst.get(g.id) ?? '');
        const ang = i * 2.399963, rad = anchor ? 30 : 12 * Math.sqrt(i + 1);
        sn.x = (anchor?.x ?? 0) + Math.cos(ang) * rad; sn.y = (anchor?.y ?? 0) + Math.sin(ang) * rad;
      }
      byId.set(g.id, sn);
    });
    s.nodes = [...byId.values()].sort((a, b) => (a.node.kind === 'space' ? 0 : 1) - (b.node.kind === 'space' ? 0 : 1));
    s.byId = byId;
    s.links = edges.flatMap((e) => { const a = byId.get(e.source), b = byId.get(e.target); return a && b ? [{ source: a, target: b, edge: e }] : []; });
    const changed = [...byId.keys()].some((id) => !s.positions.has(id)) || fresh;
    const sim = forceSimulation<SimNode, SimLink>(s.nodes)
      .force('link', forceLink<SimNode, SimLink>(s.links).distance((l) => (l.edge.kind === 'membership' ? 74 : l.edge.kind === 'mention' ? 58 : 64) + l.source.r * 0.4 + l.target.r * 0.4).strength((l) => (l.edge.kind === 'connection' ? 0.55 : 0.28)))
      .force('charge', forceManyBody<SimNode>().strength((n) => -70 - n.r * 5).distanceMax(420).theta(0.95))
      .force('collide', forceCollide<SimNode>((n) => n.r + 7).iterations(2))
      .force('x', forceX<SimNode>(0).strength(0.045))
      .force('y', forceY<SimNode>(0).strength(0.06))
      .alphaDecay(0.032)
      .alpha(changed ? 1 : 0.25)
      .stop();
    s.sim = sim;
    const settle = () => {
      if (s.firstLoad || !s.userMoved) animateCamera(fitCamera(), 600);
      s.firstLoad = false;
    };
    if (reduced) {
      // Static layout: compute synchronously, no motion.
      const ticks = Math.ceil(Math.log(sim.alphaMin()) / Math.log(1 - sim.alphaDecay()));
      sim.tick(Math.min(ticks, 320));
      s.camera = fitCamera(); s.firstLoad = false;
      requestDraw();
    } else {
      sim.on('tick', requestDraw).on('end', settle);
      if (!s.hidden) sim.restart();
      s.settleTimer = setTimeout(() => { if (sim.alpha() > sim.alphaMin()) { sim.alpha(0).stop(); settle(); requestDraw(); } }, SETTLE_MS);
      if (fresh) { s.camera = { k: s.width < 500 ? 0.8 : 1, x: s.width / 2, y: s.height / 2 }; }
      requestDraw();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, reduced]);

  useEffect(() => {
    const now = performance.now();
    for (const n of st.current.nodes) if (newIds.has(n.id) && n.pulseAt === -Infinity) n.pulseAt = Math.max(now, n.appear);
    requestDraw();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newIds]);

  // Redraw on highlight/selection change.
  useEffect(() => { requestDraw(); }, [props.selectedId, props.highlight]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- gestures ----------
  useEffect(() => {
    const canvas = canvasRef.current!;
    const s = st.current;
    const pointers = new Map<number, { x: number; y: number }>();
    let mode: 'none' | 'maybe' | 'pan' | 'pinch' | 'drag' = 'none';
    let start = { x: 0, y: 0, t: 0 };
    let last = { x: 0, y: 0 };
    let pinch = { d: 0, mx: 0, my: 0 };
    let pressNode: SimNode | null = null;
    let dragNode: SimNode | null = null;
    let lpTimer: ReturnType<typeof setTimeout> | undefined;
    let lastTap = { t: 0, x: 0, y: 0 };

    const local = (e: PointerEvent | WheelEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const toWorld = (p: { x: number; y: number }) => ({ x: (p.x - s.camera.x) / s.camera.k, y: (p.y - s.camera.y) / s.camera.k });
    const hit = (p: { x: number; y: number }, touch: boolean) => {
      const w = toWorld(p), slop = (touch ? 12 : 4) / s.camera.k;
      let best: SimNode | null = null, bd = Infinity;
      for (const n of s.nodes) {
        if (n.x == null) continue;
        const d = Math.hypot(n.x - w.x, n.y! - w.y);
        if (d <= n.r + slop && d < bd) { best = n; bd = d; }
      }
      return best;
    };
    const pinchState = () => {
      const [a, b] = [...pointers.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    };

    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      s.camAnim = null;
      if (pointers.size === 2) { clearTimeout(lpTimer); releaseDrag(); mode = 'pinch'; pinch = pinchState(); return; }
      if (pointers.size > 2) return;
      mode = 'maybe'; start = { ...p, t: performance.now() }; last = p;
      pressNode = hit(p, e.pointerType !== 'mouse');
      clearTimeout(lpTimer);
      if (pressNode) {
        const target = pressNode;
        lpTimer = setTimeout(() => {
          if (mode !== 'maybe') return;
          mode = 'drag'; dragNode = target;
          target.fx = target.x; target.fy = target.y;
          navigator.vibrate?.(12);
          if (!propsRef.current.reduced) s.sim?.alphaTarget(0.22).restart();
          requestDraw();
        }, e.pointerType === 'mouse' ? 260 : LONG_PRESS_MS);
      }
    };
    const releaseDrag = () => {
      if (!dragNode) return;
      s.sim?.alphaTarget(0);
      dragNode = null;
    };
    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (mode === 'pinch' && pointers.size >= 2) {
        const np = pinchState();
        const factor = np.d / Math.max(1, pinch.d);
        const c = s.camera, k = clampK(c.k * factor);
        const wx = (pinch.mx - c.x) / c.k, wy = (pinch.my - c.y) / c.k;
        s.camera = { k, x: np.mx - wx * k, y: np.my - wy * k };
        pinch = np; s.userMoved = true; requestDraw();
        return;
      }
      if (mode === 'maybe' && Math.hypot(p.x - start.x, p.y - start.y) > 8) { clearTimeout(lpTimer); mode = 'pan'; }
      if (mode === 'pan') {
        s.camera = { ...s.camera, x: s.camera.x + p.x - last.x, y: s.camera.y + p.y - last.y };
        s.userMoved = true; requestDraw();
      } else if (mode === 'drag' && dragNode) {
        const w = toWorld(p);
        dragNode.fx = w.x; dragNode.fy = w.y;
        if (propsRef.current.reduced) { dragNode.x = w.x; dragNode.y = w.y; }
        requestDraw();
      }
      last = p;
    };
    const up = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      const p = local(e);
      pointers.delete(e.pointerId);
      clearTimeout(lpTimer);
      if (mode === 'pinch') { if (pointers.size === 1) { const [rem] = [...pointers.values()]; mode = 'pan'; last = rem; } else if (!pointers.size) mode = 'none'; return; }
      if (mode === 'maybe') {
        const now = performance.now();
        const isDouble = now - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 32;
        if (isDouble) { zoomAt(2, p.x, p.y, true); lastTap = { t: 0, x: 0, y: 0 }; }
        else {
          lastTap = { t: now, x: p.x, y: p.y };
          propsRef.current.onSelect(pressNode ? pressNode.id : null);
        }
      }
      if (mode === 'drag') releaseDrag();
      mode = pointers.size ? mode : 'none';
      pressNode = null;
    };
    const cancel = (e: PointerEvent) => { pointers.delete(e.pointerId); clearTimeout(lpTimer); releaseDrag(); if (!pointers.size) mode = 'none'; };
    const wheel = (e: WheelEvent) => { e.preventDefault(); const p = local(e); zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), p.x, p.y); };
    const block = (e: TouchEvent) => { if (e.cancelable) e.preventDefault(); };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('touchstart', block, { passive: false });
    canvas.addEventListener('touchmove', block, { passive: false });
    return () => {
      clearTimeout(lpTimer);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('touchstart', block);
      canvas.removeEventListener('touchmove', block);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden overscroll-none" data-testid="graph-canvas-wrap">
      <canvas ref={canvasRef} role="img" aria-label={props.ariaLabel} className="block touch-none select-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent]" data-testid="canvas-graph" />
    </div>
  );
});
