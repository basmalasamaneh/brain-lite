// Deterministic boundary harness for the REAL GraphCanvas TSX, not a gesture reimplementation.
// Limitations: this is not React reconciliation/StrictMode or a browser. It commits refs before
// ordered effects, models listener/capture APIs, and independently advances timers and rAF.
// d3's chain/tick/alpha lifecycle is controlled (no force physics or d3 timer scheduler).
// drawScene records scene inputs/live-pixel identities; it does not rasterize text/icons.
// Real nodeRadius, sceneNeedsAnimation, palette and watermark helpers run; canvas methods,
// Path2D and PNG encoding are recording boundaries, not pixel/encoding validation.
// Fetch is recorded then delegated to Node's real data-url fetch (no network).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const compiled = new Map();
function loadSource(file, requireModule, globals) {
  const filename = path.resolve(__dirname, file);
  if (!compiled.has(filename)) {
    const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      reportDiagnostics: true,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    });
    assert.equal(result.diagnostics?.length ?? 0, 0, `Transpile diagnostics in ${filename}`);
    compiled.set(filename, result.outputText);
  }
  const exports = {};
  vm.runInNewContext(compiled.get(filename), { exports, require: requireModule, ...globals }, { filename });
  return exports;
}

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener(name, fn) {
      listeners.get(name)?.delete(fn);
      if (!listeners.get(name)?.size) listeners.delete(name);
    },
    dispatch(name, event = {}) {
      for (const fn of [...(listeners.get(name) ?? [])]) fn(event);
    },
  };
}

function harness(options = {}) {
  let now = options.now ?? 0, hookIndex = 0, pendingEffects = [];
  let nextId = 1, poorCalls = 0, drawCalls = 0, unmounted = false;
  const slots = [], effects = [], timers = new Map(), rafs = new Map();
  const simulations = [], scenes = [], selections = [], vibrations = [], offscreens = [], fetches = [];
  const observers = [], captures = [];
  const rect = { left: 17, top: 29, width: options.width ?? 640, height: options.height ?? 480 };
  const dependenciesChanged = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => v !== b[i]);
  const queueEffect = (fn, deps) => {
    const at = hookIndex++;
    if (!effects[at] || dependenciesChanged(effects[at].deps, deps)) {
      pendingEffects.push(() => {
        effects[at]?.cleanup?.();
        effects[at] = { deps, cleanup: fn() };
      });
    }
  };
  const react = {
    forwardRef: (fn) => fn,
    useRef(initial) {
      const at = hookIndex++;
      if (!slots[at]) slots[at] = { current: initial };
      return slots[at];
    },
    useEffect: queueEffect,
    useImperativeHandle(ref, fn, deps) {
      queueEffect(() => { ref.current = fn(); return () => { ref.current = null; }; }, deps);
    },
    createElement() { throw new Error('Icon rasterization is outside this harness'); },
  };
  const jsx = (type, props) => ({ type, props });
  function canvasContext(owner) {
    const operations = [];
    const ctx = { operations };
    for (const method of ['save', 'restore', 'setTransform', 'beginPath', 'roundRect', 'fill', 'stroke', 'translate', 'scale', 'rotate']) {
      ctx[method] = (...args) => { operations.push({ method, args }); };
    }
    ctx.measureText = (text) => { operations.push({ method: 'measureText', args: [text] }); return { width: 90 }; };
    ctx.fillText = (...args) => { operations.push({ method: 'fillText', args, font: ctx.font, align: ctx.textAlign }); };
    ctx.drawImage = (source, ...args) => {
      owner.copiedPixels = source.pixels;
      operations.push({ method: 'drawImage', source, args });
    };
    return ctx;
  }
  function canvasElement() {
    const canvas = {
      ...eventTarget(), width: 0, height: 0, style: {}, pixels: 'not drawn',
      getBoundingClientRect: () => ({ ...rect }),
      setPointerCapture: (id) => { captures.push(id); },
      getContext: () => options.noContext ? null : canvas.context,
      toDataURL(type) {
        canvas.dataUrlType = type;
        return `data:${type};base64,${Buffer.from(String(canvas.copiedPixels)).toString('base64')}`;
      },
    };
    canvas.context = canvasContext(canvas);
    return canvas;
  }
  const live = canvasElement();
  const wrap = { getBoundingClientRect: () => ({ ...rect }) };
  const document = {
    ...eventTarget(), visibilityState: options.hidden ? 'hidden' : 'visible',
    documentElement: { classList: { contains: () => false } },
    createElement(type) {
      assert.equal(type, 'canvas');
      const off = canvasElement();
      offscreens.push(off);
      return off;
    },
  };
  class Observer {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const globals = {
    Blob, performance: { now: () => now }, document,
    window: { devicePixelRatio: options.dpr ?? 2 },
    navigator: { vibrate: (ms) => { vibrations.push(ms); } },
    ResizeObserver: Observer, MutationObserver: Observer,
    Path2D: class { constructor(data) { this.data = data; } },
    getComputedStyle: () => ({
      getPropertyValue: (name) => name === '--app-font-display' ? 'Test Display' : name === '--app-font-sans' ? 'Test Sans' : '42 59% 45%',
    }),
    setTimeout: (fn, delay) => { const id = nextId++; timers.set(id, { fn, due: now + delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame: (fn) => { const id = nextId++; rafs.set(id, fn); return id; },
    cancelAnimationFrame: (id) => rafs.delete(id),
    fetch: async (url) => {
      assert.match(url, /^data:image\/png;base64,/);
      fetches.push(url);
      if (options.fetchError) throw options.fetchError;
      return fetch(url);
    },
  };
  function force() {
    const chain = {};
    for (const method of ['distance', 'strength', 'distanceMax', 'theta', 'iterations']) chain[method] = () => chain;
    return chain;
  }
  const d3 = {
    forceLink: force, forceManyBody: force, forceCollide: force, forceX: force, forceY: force,
    forceSimulation(nodes) {
      let alpha = 1, decay = 0.0228, target = 0;
      const handlers = new Map();
      const sim = {
        nodes, running: true, restarts: 0, stops: 0, ticks: [], targets: [],
        force: () => sim,
        alpha(value) { if (value === undefined) return alpha; alpha = value; return sim; },
        alphaMin: () => 0.001,
        alphaDecay(value) { if (value === undefined) return decay; decay = value; return sim; },
        alphaTarget(value) {
          if (value === undefined) return target;
          target = value; sim.targets.push(value); return sim;
        },
        stop() { sim.running = false; sim.stops++; return sim; },
        restart() { sim.running = true; sim.restarts++; return sim; },
        on(name, fn) { handlers.set(name, fn); return sim; },
        tick(n = 1) {
          sim.ticks.push(n);
          for (let i = 0; i < n; i++) alpha += (target - alpha) * decay;
          for (const node of nodes) {
            if (node.fx != null) node.x = node.fx;
            if (node.fy != null) node.y = node.fy;
          }
          return sim;
        },
        emitTick() {
          assert.equal(sim.running, true, 'Only a running d3 simulation emits ticks');
          sim.tick(); handlers.get('tick')?.();
        },
        emitEnd() { sim.alpha(0).stop(); handlers.get('end')?.(); },
      };
      simulations.push(sim);
      return sim;
    },
  };
  const model = loadSource('../../lib/graph-model.ts', (name) => { throw new Error(`Unexpected model import: ${name}`); }, globals);
  const render = loadSource('../../lib/graph-render.ts', (name) => {
    if (name === 'react') return react;
    if (name === '@/lib/graph-model') return model;
    if (name === 'react-dom/server') return { renderToStaticMarkup() { throw new Error('Icons are not rasterized'); } };
    if (name === 'lucide-react') return {};
    if (name === '@/lib/memory') return { typeMeta: { other: {} } };
    throw new Error(`Unexpected renderer import: ${name}`);
  }, globals);
  const renderer = {
    ...render,
    drawScene(ctx, scene) {
      assert.strictEqual(ctx, live.context, 'Scene must draw only to the live canvas');
      drawCalls++;
      live.pixels = `live frame ${drawCalls} at ${scene.now}`;
      scenes.push({
        ...scene, camera: { ...scene.camera },
        nodes: Array.from(scene.nodes, (n) => ({ ...n })),
      });
    },
  };
  const { GraphCanvas } = loadSource('graph-canvas.tsx', (name) => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'd3-force') return d3;
    if (name === '@/lib/graph-model') return model;
    if (name === '@/lib/graph-render') return renderer;
    throw new Error(`Unexpected component import: ${name}`);
  }, globals);
  const ref = { current: null };
  let props = {
    nodes: [], edges: [], selectedId: null, highlight: null, reduced: false,
    newIds: new Set(), sheetOpen: false, ariaLabel: 'Graph',
    onSelect: (id) => { selections.push(id); },
    onPoorPerformance: () => { poorCalls++; },
    ...options.props,
  };
  function commitTree(tree) {
    if (!tree) return;
    if (tree.props.ref) tree.props.ref.current = tree.type === 'canvas' ? live : wrap;
    for (const child of [tree.props.children].flat()) if (child) commitTree(child);
  }
  function rerender(changes = {}) {
    assert.equal(unmounted, false);
    props = { ...props, ...changes };
    hookIndex = 0; pendingEffects = [];
    commitTree(GraphCanvas(props, ref));
    for (const commit of pendingEffects) commit();
  }
  function advance(to) {
    assert.ok(to >= now, `Clock cannot go backwards (${now} -> ${to})`);
    // Timeout tasks fire in deadline/id order, including newly queued tasks due in this window.
    let count = 0;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.due <= to).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!next) break;
      assert.ok(count++ < 1000, 'Endless timeout loop');
      now = next[1].due; timers.delete(next[0]); next[1].fn();
    }
    now = to;
  }
  function frame(at = now) {
    advance(at);
    const callbacks = [...rafs];
    assert.ok(callbacks.length > 0, 'Expected a scheduled animation frame');
    for (const [id, callback] of callbacks) if (rafs.delete(id)) callback(now);
    return scenes.at(-1);
  }
  function pointer(name, x, y, id = 1, pointerType = 'touch') {
    live.dispatch(`pointer${name}`, { pointerId: id, pointerType, clientX: x + rect.left, clientY: y + rect.top });
  }
  function visibility(hidden) {
    document.visibilityState = hidden ? 'hidden' : 'visible';
    document.dispatch('visibilitychange');
  }
  function unmount() {
    if (unmounted) return;
    for (const effect of effects) effect?.cleanup?.();
    for (const slot of slots) if (slot?.current === live || slot?.current === wrap) slot.current = null;
    unmounted = true;
  }
  rerender();
  return {
    render: rerender, advance, frame, pointer, visibility, unmount,
    live, ref, simulations, scenes, selections, vibrations, captures, observers, document, offscreens, fetches,
    get now() { return now; },
    get props() { return props; },
    get sim() { return simulations.at(-1); },
    get scene() { return scenes.at(-1); },
    get camera() { return scenes.at(-1)?.camera; },
    get poorCalls() { return poorCalls; },
    get drawCalls() { return drawCalls; },
    get rafCount() { return rafs.size; },
    get timerCount() { return timers.size; },
    screenNode(id) {
      const n = simulations.at(-1).nodes.find((n) => n.id === id);
      const c = scenes.at(-1).camera;
      return { x: n.x * c.k + c.x, y: n.y * c.k + c.y };
    },
    wheel(x, y, deltaY, ctrlKey = false) {
      let prevented = false;
      live.dispatch('wheel', {
        clientX: x + rect.left, clientY: y + rect.top, deltaY, ctrlKey,
        preventDefault: () => { prevented = true; },
      });
      assert.equal(prevented, true);
    },
  };
}

module.exports = { harness };