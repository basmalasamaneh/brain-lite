import fs from 'node:fs';

/**
 * Browser-local graph touch journey. The caller supplies a Playwright Chromium
 * context factory; no app test hooks, API server or persistent fixtures involved.
 * Usage: runGraphTouchJourney(appUrl, options => browser.newContext(options)).
 */
export async function runGraphTouchJourney(appUrl, makeContext, evidencePath = '/tmp/brain-lite-graph-touch-evidence.json') {
  const results = [];
  const openContexts = [];
  let activePage = null;
  let activeApiLog = [];
  const fixtureTitles = (lang) => lang === 'ar'
    ? ['عقدة تجريبية أ','عقدة تجريبية ب','عقدة تجريبية ج','عقدة تجريبية د','عقدة تجريبية هـ']
    : ['Synthetic EN node A','Synthetic EN node B','Synthetic EN node C','Synthetic EN node D','Synthetic EN node E'];
  const fixtureNode = (title, i) => ({
    id: `memory:${91001+i}`, kind: 'memory', title, type: 'note',
    date: '2025-01-15', status: 'confirmed', memory_id: 91001+i,
    space_id: null, count: 0, pinned: false, memory_ids: [91001+i],
  });
  const check = (ok, message, details = {}) => {
    results.push({ assertion: message, passed: !!ok, ...details });
    if (!ok) throw new Error(`ASSERTION FAILED: ${message} ${JSON.stringify(details)}`);
  };
  const settle = async (page, reducedMotion) => {
    await page.getByTestId('canvas-graph').waitFor({ state: 'visible' });
    // The real d3 force alpha takes about 3.5s to decay; initial camera fit
    // then animates for 600ms. Do not mistake its initial 0.8 camera for settle.
    if (!reducedMotion) await page.waitForTimeout(5200);
    let previous = null, stable = 0, last = null;
    for (let i = 0; i < 35 && stable < 5; i++) {
      last = await currentState(page);
      if (last && previous && Math.abs(last.camera.k - previous.camera.k) < 0.01 &&
          Math.abs(last.camera.x - previous.camera.x) < 0.5 && Math.abs(last.camera.y - previous.camera.y) < 0.5 &&
          Math.hypot(last.node.x-previous.node.x,last.node.y-previous.node.y) < 0.5) stable++;
      else stable = 0;
      previous = last;
      await page.waitForTimeout(180);
    }
    check(stable >= 5, 'canvas and camera layout settled before touch', { stable, last });
  };
  const currentState = (page, expectedPoint = null) => page.evaluate((expected) => {
    const canvas = document.querySelector('[data-testid="canvas-graph"]');
    const r = canvas.getBoundingClientRect(), m = window.__graphTransform;
    const dpr = canvas.width / r.width;
    const groups = new Map();
    for (const p of (window.__graphArcs || []).slice(-160)) {
      if (p.radius < 8 || p.radius > 16) continue;
      const x=Math.round(p.x*2)/2,y=Math.round(p.y*2)/2,key=`${x},${y}`;
      groups.set(key,(groups.get(key)||0)+1);
    }
    const points=[...groups.entries()].map(([key,samples])=>({x:+key.split(',')[0],y:+key.split(',')[1],samples}));
    const aim=expected||{x:r.width/2,y:r.height/2};
    const node=points.filter(p=>p.samples>0).sort((a,b)=>Math.hypot(a.x-aim.x,a.y-aim.y)-Math.hypot(b.x-aim.x,b.y-aim.y))[0]||{x:NaN,y:NaN,samples:0};
    return {
      rect: { x:r.x, y:r.y, width:r.width, height:r.height }, dpr,
      camera: { k:m.a/dpr, x:m.e/dpr, y:m.f/dpr },
      node, points,
      scrollY: window.scrollY, viewportScale: window.visualViewport?.scale ?? 1,
    };
  }, expectedPoint);
  const touch = async (cdp, type, p) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{
      id: 1, x: p.x, y: p.y, radiusX: 2, radiusY: 2, force: 1,
    }],
  });
  const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const endpoint = (raw) => {
    const u = new URL(raw);
    if (!u.pathname.endsWith('/graph')) u.pathname = `${u.pathname.replace(/\/+$/, '')}/graph`;
    return u.href;
  };
  try {
    for (const lang of ['en', 'ar']) {
      const context = await makeContext({
        viewport: { width: 390, height: 844 },
        screen: { width: 390, height: 844 },
        isMobile: true, hasTouch: true, deviceScaleFactor: 1,
        reducedMotion: lang === 'ar' ? 'reduce' : 'no-preference',
        locale: lang === 'ar' ? 'ar' : 'en-US',
        timezoneId: 'UTC',
      });
      openContexts.push(context);
      const apiLog = [];
      activeApiLog = apiLog;
      const page = await context.newPage();
      activePage = page;
      page.setDefaultTimeout(12000);
      const pageErrors = [];
      page.on('pageerror', e => pageErrors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`); });
      await page.addInitScript(() => {
        window.__graphArcs = [];
        window.__graphTransform = null;
        const set = CanvasRenderingContext2D.prototype.setTransform;
        CanvasRenderingContext2D.prototype.setTransform = function(...args) {
          if (this.canvas?.dataset?.testid === 'canvas-graph') {
            const [a,b,c,d,e,f] = args.length === 1
              ? [args[0].a,args[0].b,args[0].c,args[0].d,args[0].e,args[0].f]
              : args;
            window.__graphTransform = {a,b,c,d,e,f};
            // drawScene applies its translated camera after clearing the canvas;
            // reset here so arc coordinates represent the current render only.
            if (e !== 0 || f !== 0) window.__graphArcs = [];
          }
          return set.apply(this,args);
        };
        const arc = CanvasRenderingContext2D.prototype.arc;
        CanvasRenderingContext2D.prototype.arc = function(x,y,r,...rest) {
          if (this.canvas?.dataset?.testid === 'canvas-graph') {
            const m = this.getTransform(), rect = this.canvas.getBoundingClientRect();
            const dpr = this.canvas.width / rect.width;
            const list = window.__graphArcs;
            list.push({x:(m.a*x+m.c*y+m.e)/dpr,y:(m.b*x+m.d*y+m.f)/dpr,radius:r,t:performance.now()});
            if (list.length > 2400) list.splice(0,1200);
          }
          return arc.call(this,x,y,r,...rest);
        };
      });
      await context.route('**/api/**', async route => {
        const req = route.request(), u = new URL(req.url()), path = u.pathname.replace(/^\/api/, '');
        apiLog.push({ method:req.method(), path, query:u.search });
        let body = {};
        if (path === '/auth/me') body = { user: {
          id:`synthetic-graph-${lang}`, email:`graph-${lang}@fixture.invalid`,
          name:lang === 'ar' ? 'مستخدم تجريبي' : 'Synthetic Graph User',
          firstName:lang === 'ar' ? 'تجريبي' : 'Synthetic', lastName:'Fixture',
          language:lang, theme:'light', onboardingCompleted:true,
        } };
        else if (path === '/graph') body = {
          nodes:fixtureTitles(lang).map(fixtureNode),
          edges:[], truncated:false,total_memory_count:5,filtered_memory_count:5,
        };
        else if (path === '/spaces') body = { spaces:[] };
        else if (path === '/reminders') body = { reminders:[] };
        else if (path === '/notifications') body = { notifications:[],unread_count:0 };
        else if (path === '/notifications/devices') body = { devices:[] };
        else if (path === '/notifications/push-config') body = { public_key:null,configured:false };
        else if (path === '/notifications/settings') body = {
          timezone:'UTC',timezone_initialized:true,push_enabled:false,email_enabled:false,
          daily_brief_enabled:false,daily_brief_time:'09:00',quiet_hours_start:null,
          quiet_hours_end:null,remind_appointments:false,remind_tasks:false,
          remind_expiries:false,remind_suggestions:false,default_lead_days:1,hide_details:false,
        };
        else if (/^\/memories\/91001$/.test(path)) body = { id:91001,summary:'Synthetic fixture summary.' };
        const status = req.method() === 'GET' || path === '/notifications/settings' ? 200 : 204;
        await route.fulfill({ status, contentType:'application/json', body:status === 204 ? '' : JSON.stringify(body) });
      });
      const targetUrl = endpoint(appUrl);
      await page.goto(targetUrl, { waitUntil:'domcontentloaded' });
      await page.getByTestId('panel-graph-canvas').waitFor({ state:'visible' });
      await settle(page,lang === 'ar');
      const canvas = page.getByTestId('canvas-graph');
      const accessibility = await canvas.getAttribute('aria-label');
      const touchAction = await canvas.evaluate(el => getComputedStyle(el).touchAction);
      check(lang === 'en' ? accessibility?.startsWith('Interactive graph') : accessibility?.startsWith('خريطة تفاعلية'),
        `${lang}: localized canvas accessible label`, { accessibility });
      check(touchAction === 'none', `${lang}: canvas disables native touch gestures`, { touchAction });
      const cdp = await context.newCDPSession(page);
      const titles = fixtureTitles(lang);
      let before = await currentState(page);
      check(Number.isFinite(before.node.x) && before.node.samples > 0, `${lang}: instrumented a visible fixture node`, { node:before.node,camera:before.camera });
      const visibleMaxY = Math.min(before.rect.height-20,844-before.rect.y-18);
      let candidate = null;
      for (let radius=30; radius<=92 && !candidate; radius+=4) {
        for (let y=22; y<=visibleMaxY && !candidate; y+=6) for (let x=22; x<=before.rect.width-22; x+=6) {
          const minClearance=Math.min(...before.points.map(p=>Math.hypot(p.x-x,p.y-y)));
          const afterX=x+2*(before.node.x-x),afterY=y+2*(before.node.y-y);
          const distance=Math.hypot(before.node.x-x,before.node.y-y);
          if (minClearance>=30 && distance>=radius && distance<=radius+6 &&
              afterX>8 && afterX<before.rect.width-8 && afterY>8 && afterY<visibleMaxY) candidate={x,y};
        }
      }
      check(!!candidate,`${lang}: found a blank double-tap point clear of all fixture nodes and retaining target onscreen`,{points:before.points,visibleMaxY});
      const blank = {
        x: before.rect.x + candidate.x,
        y: before.rect.y + candidate.y,
      };
      check(blank.x > before.rect.x + 8 && blank.x < before.rect.x+before.rect.width-8 &&
        blank.y > before.rect.y+8 && blank.y < before.rect.y+before.rect.height-8 &&
        Math.hypot(blank.x-(before.rect.x+before.node.x),blank.y-(before.rect.y+before.node.y)) > 30,
        `${lang}: blank double-tap point is inside canvas and clear of node`, { blank,node:before.node,rect:before.rect });
      await touch(cdp,'touchStart',blank); await pause(55); await touch(cdp,'touchEnd',blank);
      await pause(105);
      await touch(cdp,'touchStart',blank); await pause(55); await touch(cdp,'touchEnd',blank);
      await page.waitForTimeout(420);
      const zoomedCamera = await page.evaluate(() => {
        const c=document.querySelector('[data-testid="canvas-graph"]'),r=c.getBoundingClientRect(),m=window.__graphTransform,d=c.width/r.width;
        return {k:m.a/d,x:m.e/d,y:m.f/d};
      });
      const expectedAfterZoom = {
        x:zoomedCamera.x+((before.node.x-before.camera.x)/before.camera.k)*zoomedCamera.k,
        y:zoomedCamera.y+((before.node.y-before.camera.y)/before.camera.k)*zoomedCamera.k,
      };
      let zoomed = await currentState(page,expectedAfterZoom);
      const ratio = zoomed.camera.k / before.camera.k;
      const anchorDrift = Math.hypot(
        (zoomed.camera.k*((blank.x-before.rect.x-before.camera.x)/before.camera.k)+zoomed.camera.x) - (blank.x-before.rect.x),
        (zoomed.camera.k*((blank.y-before.rect.y-before.camera.y)/before.camera.k)+zoomed.camera.y) - (blank.y-before.rect.y),
      );
      check(ratio > 1.9 && ratio < 2.1 && zoomed.camera.k <= 4.001,
        `${lang}: two native taps zoom camera by about 2x within max scale 4`, { before:before.camera,after:zoomed.camera,ratio });
      check(anchorDrift < 2, `${lang}: zoom keeps the graph point under the tap anchored`, { anchorDrift });
      check(zoomed.scrollY === before.scrollY && Math.abs(zoomed.viewportScale-before.viewportScale)<0.01,
        `${lang}: no native page scroll or pinch/page zoom`, { before:{scrollY:before.scrollY,scale:before.viewportScale},after:{scrollY:zoomed.scrollY,scale:zoomed.viewportScale} });
      check(!(await page.getByTestId('sheet-graph-node').isVisible().catch(()=>false)),
        `${lang}: blank double-tap opens no node details sheet`);
      const movedFrom = zoomed.node;
      const start = { x:before.rect.x+movedFrom.x,y:before.rect.y+movedFrom.y };
      const end = { x:start.x+24,y:start.y+20 };
      const camBeforeDrag = zoomed.camera;
      await touch(cdp,'touchStart',start);
      await page.waitForTimeout(560);
      await touch(cdp,'touchMove',end);
      await page.waitForTimeout(140);
      await touch(cdp,'touchEnd',end);
      await page.waitForTimeout(250);
      let dragged = await currentState(page,{x:end.x-before.rect.x,y:end.y-before.rect.y});
      const displacement = Math.hypot(dragged.node.x-movedFrom.x,dragged.node.y-movedFrom.y);
      const cameraDelta = Math.max(Math.abs(dragged.camera.k-camBeforeDrag.k),Math.abs(dragged.camera.x-camBeforeDrag.x),Math.abs(dragged.camera.y-camBeforeDrag.y));
      check(displacement > 12, `${lang}: long-press drag moves the visible node`, { from:movedFrom,to:dragged.node,displacement });
      check(cameraDelta < 0.04, `${lang}: node drag leaves camera stable`, { cameraDelta,before:camBeforeDrag,after:dragged.camera });
      check(!(await page.getByTestId('sheet-graph-node').isVisible().catch(()=>false)),
        `${lang}: long-press drag/release does not open details sheet`);
      const movedPoint = { x:dragged.rect.x+dragged.node.x,y:dragged.rect.y+dragged.node.y };
      await touch(cdp,'touchStart',movedPoint); await pause(60); await touch(cdp,'touchEnd',movedPoint);
      const sheet = page.getByTestId('sheet-graph-node');
      await sheet.waitFor({state:'visible'});
      const sheetTitle = await page.getByTestId('text-graph-sheet-title').textContent();
      check(titles.includes(sheetTitle),
        `${lang}: tapping moved node opens the correct synthetic fixture detail sheet`, {sheetTitle,fixtureTitles:titles});
      check(page.url().endsWith('/graph'), `${lang}: graph remains open after selection`, {url:page.url()});
      check(apiLog.length > 0 && apiLog.every(x=>x.path), `${lang}: all API calls intercepted by synthetic browser-local fixture`, {apiRequests:apiLog});
      check(pageErrors.length === 0, `${lang}: no unexpected browser/console errors`, {pageErrors});
      results.push({ journey:lang, title:sheetTitle, accessibility, touchAction, apiRequests:apiLog,
        cameraBefore:before.camera,cameraAfterZoom:zoomed.camera,cameraAfterDrag:dragged.camera,
        zoomRatio:ratio,anchorDrift,dragDisplacement:displacement, pageErrors });
      if (lang === 'ar') await page.screenshot({ path: `${evidencePath}.png` });
    }
    const report = { appUrl:endpoint(appUrl), viewport:{width:390,height:844}, browser:'Chromium via Playwright CDP touch input',
      journeys:results.filter(x=>x.journey), assertions:results, cleanup:'All disposable contexts closed in finally, including failure paths.' };
    await fs.promises.writeFile(evidencePath,JSON.stringify(report,null,2));
    return { report,evidencePath,screenshotPath:`${evidencePath}.png` };
  } catch (error) {
    let debug = null;
    try {
      debug = activePage ? {
        url:activePage.url(),
        body:await activePage.locator('body').innerText({timeout:2000}).catch(()=>null),
      } : null;
    } catch {}
    const failure = { appUrl,results,error:String(error),apiRequests:activeApiLog,debug,cleanup:'Disposable contexts closed after failure.' };
    await fs.promises.writeFile(evidencePath,JSON.stringify(failure,null,2));
    throw error;
  } finally {
    for (const c of openContexts) { try { await c.close(); } catch {} }
  }
}