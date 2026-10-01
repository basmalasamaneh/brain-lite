# Life Graph interaction regressions

## Fast, repeatable gate

From the workspace root:

```sh
pnpm --filter @workspace/brain-lite test:graph
```

The `graph-regressions` validation command runs this same gate. It requires only
the project's existing Node.js and TypeScript installation, not a running server,
credentials, a database, a browser download, or real timers.

- `src/components/graph/graph-canvas.test.cjs` executes the real component with
  deterministic pointer events, timeout and animation-frame clocks, and controlled
  simulation/DOM boundaries.
- `src/lib/graph-render.test.cjs` executes the real render helpers and graph model,
  recording canvas drawing commands. It covers exact appearance/pulse deadlines,
  static reduced-motion rendering, camera/DPR transforms, legible-only labels,
  English/Arabic text, local SVG icons and mirrored watermark placement.
- `src/lib/graph-helpers.test.ts` preserves date, filter and visible-scope checks.

These tests are intentionally **not** a replacement for React/browser integration,
the real d3 physics engine, font rasterization, browser pointer capture, native
touch arbitration or physical-device performance. The controlled simulation lets
the frame-rate probe run with exact frame intervals rather than machine-dependent
timing. Do not weaken timing/coordinate assertions just to make a test pass.

## Targeted browser check

Reusable script: `tests/browser/graph-touch-journey.mjs`. It exports
`runGraphTouchJourney(appUrl, makeContext, evidencePath?)`. In an environment with
Playwright and its Chromium browser installed, run from the workspace root:

```sh
node --input-type=module - "$REPLIT_DEV_DOMAIN" <<'JS'
import { chromium } from 'playwright';
import { runGraphTouchJourney } from './artifacts/brain-lite/tests/browser/graph-touch-journey.mjs';
const browser = await chromium.launch({ headless: true });
try {
  const url = process.argv[2];
  console.log(await runGraphTouchJourney(
    url.startsWith('http') ? url : `https://${url}`,
    options => browser.newContext(options),
  ));
} finally {
  await browser.close();
}
JS
```

Playwright is optional and not installed by the fast Node gate. The runner writes
synthetic-fixture JSON and a PNG under `/tmp` by default, closes every context on
success or failure, and accepts another evidence path. The same journey was
verified in a 390×844 Chromium context with 34 passing assertions (English normal
motion and Arabic reduced motion). Browser emulation is not hardware validation.

Use a fresh 390px touch-enabled Chromium context against the managed frontend,
with disposable browser-local graph/auth API fixtures. Intercept all API requests;
do not read or modify an existing user's memories or create persistent accounts.
Exercise actual browser touch input rather than calling component handlers:

1. Load `/graph` and let the graph settle.
2. Double-tap empty canvas: the graph zooms around that point without scrolling or
   browser page zoom. A single tap must not zoom.
3. Press a visible node for longer than 430ms, drag, then release. The node moves,
   the camera stays fixed, and no details sheet opens as a side effect.
4. Repeat the targeted gestures in Arabic/RTL; the graph remains usable and its
   accessible label is localized.
5. Close the disposable contexts. Retain only synthetic-fixture evidence.

Use the deterministic suite for exact threshold, cancellation, visibility,
reduced-motion and sparse-frame boundaries. A browser check can supplement it,
but must not claim physical-phone validation.

## Physical-device gap

Real iOS Safari and Android Chrome remain a separate hardware check. On a
disposable account, verify pan/pinch, double-tap without native page zoom,
long-press drag without a browser callout, release/cancellation, background/resume
and reduced motion. Record device, OS and browser versions. Emulation cannot
establish haptic feedback, OS interruptions, Safari touch arbitration or actual
low-end-phone performance.