// Run: node --test artifacts/brain-lite/src/components/graph/graph-canvas.test.cjs
// See graph-canvas.harness.cjs for the controlled boundaries and explicit limitations.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./graph-canvas.harness.cjs');

const node = (id = 'memory:1') => ({ id, kind: 'memory', type: 'note', title: id, count: 1, memory_id: 1, memory_ids: [] });
const near = (actual, expected, label = 'coordinate') => assert.ok(Math.abs(actual - expected) < 1e-8, `${label}: ${actual} != ${expected}`);
const sameCamera = (actual, expected) => { for (const key of ['k', 'x', 'y']) near(actual[key], expected[key], key); };
const world = (camera, p) => ({ x: (p.x - camera.x) / camera.k, y: (p.y - camera.y) / camera.k });
const screen = (camera, p) => ({ x: p.x * camera.k + camera.x, y: p.y * camera.k + camera.y });
function mounted(t, options = {}) {
  const h = harness(options);
  t.after(() => h.unmount());
  if (!options.hidden) h.frame();
  return h;
}
function tap(h, x, y, at, id = 1) {
  h.advance(at);
  h.pointer('down', x, y, id);
  h.pointer('up', x, y, id);
}

test('pan starts strictly beyond 8 CSS pixels, ignores untracked moves and never selects', (t) => {
  const h = mounted(t, { props: { reduced: true, nodes: [node()] } });
  const initial = { ...h.camera };
  h.pointer('move', 400, 400, 99);
  assert.equal(h.rafCount, 0);
  h.pointer('down', 60, 60);
  h.pointer('move', 68, 60);
  assert.equal(h.rafCount, 0, 'Exactly 8 pixels stays a possible tap');
  h.pointer('move', 68.01, 60);
  h.frame();
  near(h.camera.x, initial.x + 0.01);
  near(h.camera.y, initial.y);
  h.pointer('move', 83, 72);
  h.frame();
  near(h.camera.x, initial.x + 15);
  near(h.camera.y, initial.y + 12);
  h.pointer('up', 83, 72);
  assert.deepEqual(h.selections, []);
  assert.deepEqual(h.captures, [1]);
});

test('8-pixel jitter remains a tap; selection uses fresh props and local canvas offsets', (t) => {
  const h = mounted(t, { props: { reduced: true, nodes: [node()] } });
  const p = h.screenNode('memory:1');
  const selected = [];
  h.render({ onSelect: (id) => selected.push(id) });
  assert.equal(h.rafCount, 0, 'Callback-only updates do not need a draw');
  h.pointer('down', p.x, p.y);
  h.pointer('move', p.x + 8, p.y);
  h.pointer('up', p.x + 8, p.y);
  assert.deepEqual(selected, ['memory:1']);
  assert.deepEqual(h.selections, []);
  h.advance(320);
  tap(h, 10, 10, 320);
  assert.deepEqual(selected, ['memory:1', null]);
});

test('pinch preserves the old centroid world anchor at the moving centroid and clamps both scales', (t) => {
  const h = mounted(t);
  const initial = { ...h.camera };
  h.pointer('down', 100, 100, 1);
  h.pointer('down', 200, 100, 2);
  const anchor = world(initial, { x: 150, y: 100 });
  h.pointer('move', 300, 100, 2);
  h.frame();
  near(h.camera.k, 2);
  sameCamera(h.camera, { k: 2, x: 200 - anchor.x * 2, y: 100 - anchor.y * 2 });
  h.pointer('move', 1900, 100, 2);
  h.frame();
  near(h.camera.k, 4, 'Maximum scale');
  near(screen(h.camera, anchor).x, 1000);
  h.pointer('move', 101, 100, 2);
  h.frame();
  near(h.camera.k, 0.2, 'Minimum scale');
  near(screen(h.camera, anchor).x, 100.5);
  near(screen(h.camera, anchor).y, 100);
  const pinched = { ...h.camera };
  h.pointer('up', 101, 100, 2);
  h.pointer('move', 112, 107, 1);
  h.frame();
  sameCamera(h.camera, { ...pinched, x: pinched.x + 12, y: pinched.y + 7 });
  h.pointer('up', 112, 107, 1);
  assert.deepEqual(h.selections, []);
});

test('coincident pinch fingers stay finite; a third finger cannot select or jump the two-finger anchor', (t) => {
  const h = mounted(t);
  h.pointer('down', 50, 50, 1);
  h.pointer('down', 50, 50, 2);
  h.pointer('down', 400, 400, 3);
  h.pointer('move', 50, 50, 3);
  h.frame();
  for (const v of Object.values(h.camera)) assert.ok(Number.isFinite(v));
  near(h.camera.k, 0.2);
  h.pointer('up', 50, 50, 3);
  h.pointer('up', 50, 50, 2);
  h.pointer('up', 50, 50, 1);
  assert.deepEqual(h.selections, []);
});

test('first tap near the origin at clock 0 is not a double; a valid pair zooms once and resets', (t) => {
  const h = mounted(t, { props: { reduced: true } });
  const initial = { ...h.camera };
  tap(h, 1, 1, 0);
  assert.deepEqual(h.selections, [null]);
  assert.equal(h.rafCount, 0, 'First tap must not zoom, even early in performance.now');
  tap(h, 1, 1, 100);
  h.frame();
  near(h.camera.k, initial.k * 2);
  const before = world(initial, { x: 1, y: 1 });
  near(screen(h.camera, before).x, 1);
  near(screen(h.camera, before).y, 1);
  assert.deepEqual(h.selections, [null], 'Double tap suppresses the second selection');
  tap(h, 1, 1, 150);
  assert.deepEqual(h.selections, [null, null], 'A consumed pair cannot make a phantom triple tap');
});

for (const [delay, distance, isDouble] of [
  [319, 31.99, true], [320, 0, false], [321, 0, false],
  [100, 32, false], [100, 32.01, false],
]) {
  test(`double-tap boundaries: ${delay} ms / ${distance} px => ${isDouble ? 'zoom' : 'two taps'}`, (t) => {
    const h = mounted(t, { props: { reduced: true } });
    const initial = { ...h.camera };
    tap(h, 50, 50, 0);
    tap(h, 50 + distance, 50, delay);
    if (isDouble) {
      h.frame();
      near(h.camera.k, initial.k * 2);
      assert.deepEqual(h.selections, [null]);
    } else {
      sameCamera(h.camera, initial);
      assert.deepEqual(h.selections, [null, null]);
      assert.equal(h.rafCount, 0);
    }
  });
}

test('double tap animates in normal motion, reaches its target in 260 ms and stops scheduling', (t) => {
  const h = mounted(t);
  h.sim.alpha(0).stop();
  tap(h, 50, 70, 0);
  tap(h, 50, 70, 100);
  h.frame(230);
  near(h.camera.k, 1.875, 'Cubic ease halfway');
  assert.equal(h.rafCount, 1);
  h.frame(360);
  near(h.camera.k, 2);
  assert.equal(h.rafCount, 0);
});

for (const [pointerType, threshold] of [['touch', 430], ['mouse', 260]]) {
  test(`${pointerType} long press begins exactly at ${threshold} ms, pins and drags in world coordinates`, (t) => {
    const h = mounted(t, { props: { nodes: [node()] } });
    h.wheel(320, 240, -Math.log(2) / 0.0018);
    h.frame();
    near(h.camera.k, 2);
    const p = h.screenNode('memory:1'), n = h.sim.nodes[0];
    const restarts = h.sim.restarts;
    h.pointer('down', p.x, p.y, 1, pointerType);
    h.advance(threshold - 1);
    assert.equal(n.fx, undefined);
    assert.deepEqual(h.vibrations, []);
    h.advance(threshold);
    near(n.fx, n.x); near(n.fy, n.y);
    assert.deepEqual(h.vibrations, [12]);
    near(h.sim.alphaTarget(), 0.22);
    assert.equal(h.sim.restarts, restarts + 1);
    const target = { x: p.x + 50, y: p.y - 30 };
    const expected = world(h.camera, target);
    h.pointer('move', target.x, target.y, 1, pointerType);
    near(n.fx, expected.x); near(n.fy, expected.y);
    assert.equal(n.x, 12, 'Non-reduced coordinates move only on the simulation tick');
    h.sim.emitTick();
    near(n.x, expected.x); near(n.y, expected.y);
    h.pointer('up', target.x, target.y, 1, pointerType);
    near(h.sim.alphaTarget(), 0);
    near(n.fx, expected.x);
    assert.deepEqual(h.selections, []);
  });
}

test('reduced-motion drag updates node coordinates synchronously without restarting d3', (t) => {
  const h = mounted(t, { props: { reduced: true, nodes: [node()] } });
  const p = h.screenNode('memory:1');
  h.pointer('down', p.x, p.y);
  h.pointer('move', p.x + 8, p.y);
  h.advance(430);
  const target = { x: p.x + 45, y: p.y + 27 }, expected = world(h.camera, target);
  h.pointer('move', target.x, target.y);
  const n = h.sim.nodes[0];
  near(n.x, expected.x); near(n.y, expected.y);
  near(n.fx, expected.x); near(n.fy, expected.y);
  assert.equal(h.sim.restarts, 0);
  h.pointer('up', target.x, target.y);
  h.frame();
  assert.equal(h.rafCount, 0);
  assert.deepEqual(h.selections, []);
});

for (const abort of ['movement', 'pinch', 'cancel', 'up', 'unmount']) {
  test(`${abort} aborts a pending long press without a late pin/vibration/restart`, (t) => {
    const h = mounted(t, { props: { nodes: [node()] } });
    const p = h.screenNode('memory:1'), n = h.sim.nodes[0];
    const restarts = h.sim.restarts;
    h.pointer('down', p.x, p.y);
    h.advance(200);
    if (abort === 'movement') h.pointer('move', p.x + 8.01, p.y);
    if (abort === 'pinch') h.pointer('down', p.x + 100, p.y, 2);
    if (abort === 'cancel') h.pointer('cancel', p.x, p.y);
    if (abort === 'up') h.pointer('up', p.x, p.y);
    if (abort === 'unmount') h.unmount();
    h.advance(430);
    assert.equal(n.fx, undefined);
    assert.deepEqual(h.vibrations, []);
    assert.equal(h.sim.restarts, restarts);
    if (abort !== 'up') assert.deepEqual(h.selections, []);
    if (abort === 'unmount') {
      assert.equal(h.timerCount, 0);
      assert.equal(h.rafCount, 0);
      assert.equal(h.live.listeners.size, 0);
      assert.equal(h.document.listeners.size, 0);
      assert.ok(h.observers.every((o) => o.disconnected));
    }
  });
}

for (const abort of ['pinch', 'cancel', 'unmount']) {
  test(`${abort} releases an active long-press simulation target and cannot select`, (t) => {
    const h = mounted(t, { props: { nodes: [node()] } });
    const p = h.screenNode('memory:1'), n = h.sim.nodes[0];
    h.pointer('down', p.x, p.y);
    h.advance(430);
    near(h.sim.alphaTarget(), 0.22);
    if (abort === 'pinch') h.pointer('down', p.x + 100, p.y, 2);
    if (abort === 'cancel') h.pointer('cancel', p.x, p.y);
    if (abort === 'unmount') h.unmount();
    near(h.sim.alphaTarget(), 0);
    const fx = n.fx, fy = n.fy;
    h.pointer('move', p.x + 30, p.y + 30);
    near(n.fx, fx); near(n.fy, fy);
    assert.deepEqual(h.selections, []);
  });
}

test('pointercancel during pinch leaves a tracked finger able to pan, without selection or stale timers', (t) => {
  const h = mounted(t, { props: { reduced: true } });
  h.pointer('down', 100, 100, 1);
  h.pointer('down', 200, 100, 2);
  h.pointer('move', 250, 100, 2);
  h.frame();
  const initial = { ...h.camera };
  h.pointer('cancel', 250, 100, 2);
  h.pointer('move', 120, 110, 1);
  h.frame();
  sameCamera(h.camera, { ...initial, x: initial.x + 20, y: initial.y + 10 });
  h.pointer('up', 120, 110, 1);
  assert.deepEqual(h.selections, []);
  assert.equal(h.timerCount, 0);
});

test('visibility stops simulation and rAF; resume starts a fresh performance window, not a background gap', (t) => {
  const h = mounted(t);
  for (const time of [100, 200, 300]) h.frame(time);
  h.visibility(true);
  assert.equal(h.sim.running, false);
  assert.equal(h.rafCount, 0);
  const draws = h.drawCalls, restarts = h.sim.restarts;
  h.advance(1800);
  h.render({ selectedId: 'memory:1', newIds: new Set(['memory:1']) });
  assert.equal(h.rafCount, 0);
  assert.equal(h.drawCalls, draws);
  h.visibility(false);
  assert.equal(h.sim.restarts, restarts + 1);
  h.frame(1800);
  for (let time = 1816; time <= 3016; time += 16) h.frame(time);
  assert.equal(h.poorCalls, 0, 'Time hidden is excluded from the frame-rate probe');
  h.visibility(true);
  h.visibility(false);
  h.frame(3032);
  assert.equal(h.poorCalls, 0);
});

for (const initiallyHidden of [false, true]) {
  test(`data updates while hidden do not restart or draw (initially hidden: ${initiallyHidden})`, (t) => {
    const h = mounted(t, { hidden: initiallyHidden, props: { nodes: [node()] } });
    if (!initiallyHidden) h.visibility(true);
    assert.equal(h.sim.running, false);
    assert.equal(h.rafCount, 0);
    if (initiallyHidden) assert.equal(h.sim.restarts, 0);
    const old = h.sim;
    h.advance(100);
    h.render({ nodes: [node(), node('memory:2')], edges: [] });
    assert.equal(old.running, false);
    assert.equal(h.sim.running, false);
    assert.equal(h.sim.restarts, 0);
    assert.equal(h.rafCount, 0);
    h.visibility(false);
    assert.equal(h.sim.restarts, 1);
    h.frame(116);
    assert.equal(h.scene.nodes.length, 2);
  });
}

test('data replacement resets an unfinished performance probe and stops the old simulation', (t) => {
  const h = mounted(t, { props: { nodes: [node()] } });
  for (const time of [300, 600, 900]) h.frame(time);
  const old = h.sim;
  h.render({ nodes: [node(), node('memory:2')] });
  assert.equal(old.running, false);
  h.frame(900);
  for (let time = 916; time <= 2116; time += 16) h.frame(time);
  assert.equal(h.poorCalls, 0);
});

test('reduced layout ticks synchronously once, never restarts, and redraws are bounded', (t) => {
  const h = mounted(t, { props: { reduced: true, nodes: [node()], newIds: new Set(['memory:1']) } });
  assert.deepEqual(h.sim.ticks, [213]);
  assert.ok(h.sim.alpha() < h.sim.alphaMin());
  assert.equal(h.sim.restarts, 0);
  assert.equal(h.timerCount, 0);
  assert.equal(h.rafCount, 0);
  h.render({ selectedId: 'memory:1', highlight: new Set(['memory:1']) });
  h.frame();
  assert.equal(h.rafCount, 0);
  h.visibility(true);
  h.visibility(false);
  h.frame();
  assert.equal(h.sim.restarts, 0);
  assert.equal(h.rafCount, 0);
  h.ref.current.zoomBy(2);
  h.frame();
  assert.equal(h.rafCount, 0);
  assert.equal(h.poorCalls, 0);
});

test('initially hidden reduced layouts and hidden data updates remain static when shown', (t) => {
  const h = mounted(t, { hidden: true, props: { reduced: true, nodes: [node()] } });
  assert.deepEqual(h.sim.ticks, [213]);
  assert.equal(h.sim.restarts, 0);
  assert.equal(h.rafCount, 0);
  h.render({ nodes: [node(), node('memory:2')], newIds: new Set(['memory:2']) });
  assert.deepEqual(h.sim.ticks, [213]);
  assert.equal(h.sim.restarts, 0);
  assert.equal(h.timerCount, 0);
  assert.equal(h.rafCount, 0);
  h.visibility(false);
  h.frame();
  assert.equal(h.scene.nodes.length, 2);
  assert.equal(h.sim.restarts, 0);
  assert.equal(h.rafCount, 0);
});

test('switching to reduced motion during a camera animation cancels its old trajectory immediately', (t) => {
  const h = mounted(t, { props: { nodes: [node()] } });
  h.ref.current.zoomBy(3);
  h.frame(100);
  assert.equal(h.rafCount, 1);
  const old = h.sim;
  h.render({ reduced: true });
  const scene = h.frame(100);
  // One node at (12, 0), r=12.6, plus the fitCamera label padding (16).
  sameCamera(scene.camera, { k: 1.8, x: 320 - 12 * 1.8, y: 240 - 8 * 1.8 });
  assert.equal(old.running, false);
  assert.equal(h.sim.restarts, 0);
  assert.equal(h.rafCount, 0, 'No stale camAnim may keep static mode running');
  assert.equal(h.timerCount, 0);
  h.ref.current.recenter();
  h.frame(500);
  sameCamera(h.camera, scene.camera);
  assert.equal(h.rafCount, 0);
});

test('appearance/pulse rAFs end after the real renderer animation window, even after d3 stops', (t) => {
  const h = mounted(t, { props: { nodes: [node()], newIds: new Set(['memory:1']) } });
  h.sim.alpha(0).stop();
  h.frame(420);
  assert.equal(h.rafCount, 1, 'Pulse remains active after appearance finishes');
  h.frame(5199);
  assert.equal(h.rafCount, 1);
  h.frame(5200);
  assert.equal(h.rafCount, 0);
});

test('settle watchdog stops d3 at 4500 ms, animates fit once, and is cleared on unmount', (t) => {
  const h = mounted(t, { props: { nodes: [node()] } });
  h.advance(4499);
  assert.equal(h.sim.running, true);
  h.advance(4500);
  assert.equal(h.sim.running, false);
  near(h.sim.alpha(), 0);
  h.frame(4500);
  assert.equal(h.rafCount, 1);
  h.frame(5100);
  assert.equal(h.rafCount, 0);
  h.unmount();
  assert.equal(h.timerCount, 0);
});

for (const [name, frames, expectedCalls] of [
  ['healthy 16-ms frames', Array.from({ length: 76 }, (_, i) => (i + 1) * 16), 0],
  ['48-ms boundary is healthy', Array.from({ length: 25 }, (_, i) => (i + 1) * 48), 0],
  ['slow 100-ms frames', Array.from({ length: 12 }, (_, i) => (i + 1) * 100), 1],
  ['very sparse (less than three deltas)', [1000, 2000], 1],
]) {
  test(`frame-performance probe: ${name}; reports at most once for the mounted canvas`, (t) => {
    const h = mounted(t);
    for (const time of frames) h.frame(time);
    assert.equal(h.poorCalls, expectedCalls);
    // A completed healthy probe must not later report a slow window; a poor probe is once-only.
    const end = frames.at(-1);
    h.visibility(true);
    h.visibility(false);
    h.render({ nodes: [node()] });
    for (const time of [end + 100, end + 800, end + 1600, end + 2100]) h.frame(time);
    assert.equal(h.poorCalls, expectedCalls);
  });
}

test('slow and sparse probes wait for their respective 1200-ms and 2000-ms windows', (t) => {
  const slow = mounted(t);
  for (let time = 100; time <= 1100; time += 100) slow.frame(time);
  assert.equal(slow.poorCalls, 0);
  slow.frame(1200);
  assert.equal(slow.poorCalls, 1);
  const sparse = mounted(t);
  sparse.frame(1999);
  assert.equal(sparse.poorCalls, 0);
  sparse.frame(2000);
  assert.equal(sparse.poorCalls, 1);
});

for (const rtl of [false, true]) {
  test(`export copies only live pixels, adds real ${rtl ? 'RTL' : 'LTR'} watermark, fetches PNG data URL`, async (t) => {
    const h = mounted(t, { dpr: 3, props: { reduced: true, nodes: [node()] } });
    assert.equal(h.live.width, 1600, 'DPR is capped at 2.5');
    assert.equal(h.live.height, 1200);
    const visiblePixels = h.live.pixels, drawCalls = h.drawCalls, before = { ...h.camera };
    h.ref.current.zoomBy(2); // Change camera WITHOUT drawing; export must still copy readable pixels.
    const blob = await h.ref.current.exportPng(rtl);
    const off = h.offscreens[0], operations = off.context.operations;
    assert.equal(h.drawCalls, drawCalls, 'Export must not call drawScene on a reconstructed scene');
    assert.equal(h.rafCount, 1, 'Export must not consume or trigger extra animation frames');
    sameCamera(h.camera, before);
    assert.equal(off.width, h.live.width);
    assert.equal(off.height, h.live.height);
    assert.strictEqual(operations[0].source, h.live);
    assert.deepEqual(operations[0].args, [0, 0]);
    assert.equal(operations[0].method, 'drawImage');
    assert.equal(off.copiedPixels, visiblePixels);
    assert.equal(operations.filter((op) => op.method === 'drawImage').length, 1);
    const watermarkBox = operations.find((op) => op.method === 'roundRect');
    assert.deepEqual(watermarkBox.args, [rtl ? 14 : 1428, 1138, 158, 48, 12]);
    const text = operations.find((op) => op.method === 'fillText');
    assert.equal(text.args[0], 'Brain Lite');
    assert.equal(text.font, '600 20px Test Display');
    assert.equal(text.align, 'left');
    assert.equal(off.dataUrlType, 'image/png');
    assert.equal(h.fetches.length, 1);
    assert.equal(blob.type, 'image/png');
    assert.equal(await blob.text(), visiblePixels);
  });
}

test('export reports graph-not-ready and data-url fetch errors instead of silently falling back', async (t) => {
  const h = mounted(t, { props: { reduced: true } });
  h.live.width = 0;
  await assert.rejects(h.ref.current.exportPng(false), /Graph not ready/);
  assert.equal(h.fetches.length, 0);
  const failure = new Error('data-url conversion unavailable');
  const badFetch = mounted(t, { fetchError: failure, props: { reduced: true } });
  await assert.rejects(badFetch.ref.current.exportPng(false), (error) => error === failure);
  const noContext = mounted(t, { noContext: true, props: { reduced: true } });
  await assert.rejects(noContext.ref.current.exportPng(false), /Graph not ready/);
  assert.equal(noContext.fetches.length, 0);
});