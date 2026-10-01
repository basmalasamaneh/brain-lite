// Real renderer, deterministic canvas command recording (not a pixel/browser test).
// Run together with graph-canvas tests: pnpm --filter @workspace/brain-lite test:graph
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports, globals = {}) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    require(name) {
      assert.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`);
      return imports[name];
    },
    ...globals,
  }, { filename: file });
  return exports;
}

function context() {
  const calls = [];
  const ctx = { calls, measureText: (text) => ({ width: text.length * 6 }), createPattern: () => null };
  for (const name of ['setTransform', 'fillRect', 'save', 'restore', 'translate', 'rotate',
    'scale', 'beginPath', 'rect', 'roundRect', 'stroke', 'fill', 'arc', 'setLineDash',
    'moveTo', 'lineTo', 'drawImage', 'fillText']) {
    ctx[name] = (...args) => calls.push({ name, args, alpha: ctx.globalAlpha });
  }
  return ctx;
}

function harness() {
  const images = [];
  const model = load('graph-model.ts', {});
  const renderer = load('graph-render.ts', {
    react: { createElement: () => ({}) },
    'react-dom/server': { renderToStaticMarkup: () => '<svg xmlns="http://www.w3.org/2000/svg"/>' },
    'lucide-react': {},
    '@/lib/memory': { typeMeta: { other: { icon: () => null } } },
    '@/lib/graph-model': model,
  }, {
    document: { createElement: () => ({ getContext: context }) },
    Image: class {
      complete = false;
      naturalWidth = 0;
      constructor() { images.push(this); }
    },
    Path2D: class { constructor(value) { this.value = value; } },
  });
  const palette = { raw: new Proxy({}, { get: () => '42 50% 50%' }) };
  const scene = (over = {}) => ({
    nodes: [], links: [], camera: { k: 1, x: 30, y: 50 }, width: 390, height: 600,
    dpr: 2, selected: null, highlight: null, now: 10000, reduced: false,
    palette, fontFamily: 'system-ui', onIconLoad: () => {}, ...over,
  });
  const node = (over = {}, data = {}) => ({
    id: 'm1', x: 0, y: 0, r: 20, appear: 0, pulseAt: -Infinity,
    node: { id: 'm1', kind: 'memory', title: 'Visible fixture', type: 'other', ...data },
    ...over,
  });
  return { ...renderer, scene, node, palette, images };
}

test('appearance and pulse frame requests stop at exact boundaries, including staggered nodes', () => {
  const h = harness();
  assert.equal(h.sceneNeedsAnimation(h.scene()), false);
  for (const [property, lifetime] of [['appear', h.APPEAR_MS], ['pulseAt', h.PULSE_MS]]) {
    const n = h.node({ appear: -10000, [property]: 1000 });
    for (const now of [999, 1000, 1000 + lifetime - 1]) {
      assert.equal(h.sceneNeedsAnimation(h.scene({ nodes: [n], now })), true);
    }
    for (const now of [1000 + lifetime, 1000 + lifetime + 1]) {
      assert.equal(h.sceneNeedsAnimation(h.scene({ nodes: [n], now })), false);
    }
  }
  assert.equal(h.sceneNeedsAnimation(h.scene({
    nodes: [h.node(), h.node({ appear: 11000 })],
  })), true);
});

test('reduced motion draws complete static nodes immediately, without appearance or pulse loops', () => {
  const h = harness();
  const n = h.node({ appear: 11000, pulseAt: 10000 });
  const s = h.scene({ nodes: [n], reduced: true });
  assert.equal(h.sceneNeedsAnimation(s), false);
  const ctx = context();
  h.drawScene(ctx, s);
  assert.equal(ctx.calls.filter((c) => c.name === 'arc').length, 1, 'no pulse ring');
  assert.equal(ctx.calls.find((c) => c.name === 'arc').args[2], n.r, 'full radius');
  assert.equal(ctx.calls.find((c) => c.name === 'fillText').args[0], 'Visible fixture');
  const animated = context();
  h.drawScene(animated, { ...s, reduced: false });
  assert.equal(animated.calls.filter((c) => c.name === 'arc').length, 0, 'future appearance stays hidden');
});

test('draw commands honor CSS camera coordinates and device-pixel ratio', () => {
  const h = harness();
  const ctx = context();
  h.drawScene(ctx, h.scene({ camera: { k: 1.5, x: 70, y: -20 }, dpr: 2.5 }));
  assert.deepEqual(ctx.calls.filter((c) => c.name === 'setTransform').map((c) => c.args), [
    [2.5, 0, 0, 2.5, 0, 0], [3.75, 0, 0, 3.75, 175, -50],
  ]);
});

test('labels stay limited to legible/focused content, in both English and Arabic', () => {
  const h = harness();
  for (const title of ['Disposable English fixture', 'ذكرى تجريبية مؤقتة']) {
    const n = h.node({}, { title, raw_text: 'PRIVATE RAW TEXT', attachment_url: 'PRIVATE URL' });
    const labels = (over) => {
      const ctx = context();
      h.drawScene(ctx, h.scene({ nodes: [n], ...over }));
      return ctx.calls.filter((c) => c.name === 'fillText').map((c) => c.args[0]);
    };
    assert.deepEqual(labels({}), [title]);
    assert.deepEqual(labels({ camera: { k: 0.2, x: 0, y: 0 } }), []);
    assert.deepEqual(labels({ highlight: new Set(['other']) }), []);
    assert.deepEqual(labels({ highlight: new Set(['m1']) }), [title]);
    assert.deepEqual(labels({ camera: { k: 0.2, x: 0, y: 0 }, selected: 'm1' }), [title]);
  }
  const ctx = context();
  h.drawScene(ctx, h.scene({ nodes: [h.node({}, { title: 'abcdefghijklmnopqrstuvwxyz private tail' })] }));
  assert.deepEqual(ctx.calls.filter((c) => c.name === 'fillText').map((c) => c.args[0]), [
    'abcdefghijklmnopqrstuvwxy…',
  ]);
});

test('icons are local SVG data URLs, request repaint on load and clear on theme changes', () => {
  const h = harness();
  let loaded = 0;
  const s = h.scene({ nodes: [h.node()], onIconLoad: () => loaded++ });
  h.drawScene(context(), s);
  h.drawScene(context(), s);
  assert.equal(h.images.length, 1);
  assert.match(h.images[0].src, /^data:image\/svg\+xml/);
  h.images[0].onload();
  assert.equal(loaded, 1);
  h.clearIconCache();
  h.drawScene(context(), s);
  assert.equal(h.images.length, 2);
});

test('snapshot watermark uses native paths, restores context and mirrors placement for RTL', () => {
  const h = harness();
  for (const rtl of [false, true]) {
    const ctx = context();
    h.drawWatermark(ctx, h.palette, 780, 1200, 'Fixture Font', rtl);
    const box = ctx.calls.find((c) => c.name === 'roundRect').args;
    assert.equal(box[0], rtl ? 14 : 780 - box[2] - 14);
    assert.equal(box[1], 1200 - box[3] - 14);
    assert.deepEqual(ctx.calls.filter((c) => c.name === 'fillText').map((c) => c.args[0]), ['Brain Lite']);
    assert.equal(ctx.calls.filter((c) => c.name === 'drawImage').length, 0);
    assert.equal(ctx.calls.filter((c) => c.name === 'save').length,
      ctx.calls.filter((c) => c.name === 'restore').length);
    assert.equal(h.images.length, 0);
  }
});