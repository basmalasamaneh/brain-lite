// Run: node --test artifacts/brain-lite/src/hooks/use-voice-recorder.test.cjs
// Executes the real hook source compiled in-memory; no browser, audio device or test dependency needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness(options = {}) {
  let now = 0;
  let index = 0;
  let slots = [];
  let effects = [];
  let timers = new Map();
  let nextTimer = 1;
  let permission = options.permission;
  let recorders = [];
  let stoppedTracks = 0;
  let revoked = 0;
  const mime = 'audio/webm';
  const track = () => ({ stop: () => { stoppedTracks++; } });
  const stream = () => ({ getTracks: () => [track(), track()] });
  const dependencyChanged = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => v !== b[i]);
  const react = {
    useRef: (initial) => {
      const at = index++;
      if (!slots[at]) slots[at] = { current: initial };
      return slots[at];
    },
    useState: (initial) => {
      const at = index++;
      if (!slots[at]) slots[at] = { value: initial };
      const set = (value) => {
        slots[at].value = typeof value === 'function' ? value(slots[at].value) : value;
      };
      return [slots[at].value, set];
    },
    useCallback: (fn, deps) => {
      const at = index++;
      if (!slots[at] || dependencyChanged(slots[at].deps, deps)) slots[at] = { value: fn, deps };
      return slots[at].value;
    },
    useEffect: (fn, deps) => {
      const at = index++;
      if (!effects[at] || dependencyChanged(effects[at].deps, deps)) {
        effects[at]?.cleanup?.();
        effects[at] = { deps, cleanup: fn() };
      }
    },
  };
  class Recorder {
    constructor(media, opts) {
      this.stream = media;
      this.mimeType = opts?.mimeType || mime;
      this.state = 'inactive';
      this.stops = 0;
      recorders.push(this);
    }
    static isTypeSupported(format) { return format === 'audio/webm;codecs=opus'; }
    start() { this.state = 'recording'; }
    requestData() {}
    stop() {
      this.stops++;
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['spoken audio'], { type: mime }) });
      this.onstop?.();
    }
  }
  const events = new Map();
  const source = fs.readFileSync(path.join(__dirname, 'use-voice-recorder.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  const sandbox = {
    exports, require: (name) => {
      assert.equal(name, 'react');
      return react;
    },
    Blob, DOMException,
    Date: class extends Date { static now() { return now; } },
    MediaRecorder: Recorder,
    navigator: {
      mediaDevices: { getUserMedia: permission || (async () => stream()) },
      vibrate: () => {},
    },
    window: { AudioContext: null },
    document: {
      visibilityState: 'visible',
      addEventListener: (name, fn) => events.set(name, fn),
      removeEventListener: (name) => events.delete(name),
    },
    URL: { createObjectURL: () => 'blob:voice', revokeObjectURL: () => { revoked++; } },
    setInterval: (fn) => { const id = nextTimer++; timers.set(id, fn); return id; },
    clearInterval: (id) => timers.delete(id),
  };
  vm.runInNewContext(compiled, sandbox, { filename: 'use-voice-recorder.ts' });
  const render = () => { index = 0; return exports.useVoiceRecorder(); };
  return {
    render,
    exports,
    setTime: (ms) => { now = ms; for (const fn of [...timers.values()]) fn(); },
    get recorder() { return recorders.at(-1); },
    get stoppedTracks() { return stoppedTracks; },
    get revoked() { return revoked; },
    get timerCount() { return timers.size; },
    unmount: () => { for (const effect of effects) effect?.cleanup?.(); },
    hide: () => { sandbox.document.visibilityState = 'hidden'; events.get('visibilitychange')?.(); },
    stream,
  };
}

test('denied permission and missing microphone report distinct guidance without starting recorder', async () => {
  for (const [name, expected] of [['NotAllowedError', 'denied'], ['NotFoundError', 'noInput']]) {
    const h = harness({ permission: async () => { throw new DOMException('device error', name); } });
    await h.render().start();
    assert.equal(h.render().error, expected);
    assert.equal(h.render().phase, 'intro');
    assert.equal(h.recorder, undefined);
    h.unmount();
  }
});

test('early stop keeps a playable blob, releases every track and cancel revokes preview', async () => {
  const h = harness();
  await h.render().start();
  assert.equal(h.render().phase, 'recording');
  h.setTime(2000);
  h.render().stop();
  assert.equal(h.render().phase, 'preview');
  assert.ok(h.render().audio instanceof Blob);
  assert.equal(h.stoppedTracks, 2);
  assert.equal(h.timerCount, 0);
  h.render().cancel();
  assert.equal(h.render().audio, null);
  assert.equal(h.revoked, 1);
  h.unmount();
});

test('105-second warning, 120-second limit and delayed interval stop exactly once', async () => {
  for (const lastTick of [120000, 127500]) {
    const h = harness();
    await h.render().start();
    h.setTime(104999);
    assert.equal(h.render().notice, null);
    h.setTime(105000);
    assert.equal(h.render().notice, 'warning');
    assert.equal(h.recorder.stops, 0);
    h.setTime(lastTick);
    assert.equal(h.render().notice, 'limit');
    assert.equal(h.render().phase, 'preview');
    assert.equal(h.recorder.stops, 1);
    assert.equal(h.timerCount, 0);
    h.unmount();
  }
});

test('cancel during permission prompt discards late stream and never starts a recorder', async () => {
  let grant;
  const h = harness({ permission: () => new Promise((resolve) => { grant = resolve; }) });
  const start = h.render().start();
  h.render().cancel();
  grant(h.stream());
  await start;
  assert.equal(h.stoppedTracks, 2);
  assert.equal(h.recorder, undefined);
  assert.equal(h.render().phase, 'intro');
  h.unmount();
});

test('hidden page stops microphone, offline preflight retains exact recording for retry', async () => {
  const h = harness();
  await h.render().start();
  h.hide();
  const audio = h.render().audio;
  assert.equal(h.render().phase, 'preview');
  assert.equal(h.stoppedTracks, 2);
  assert.equal(h.exports.voiceUploadIssue(audio, false), 'offline');
  assert.strictEqual(h.render().audio, audio);
  assert.equal(h.exports.voiceUploadIssue(audio, true), null);
  assert.strictEqual(h.render().audio, audio);
  h.unmount();
});