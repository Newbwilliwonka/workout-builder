// Every media-window clock shares one vertical spot. Logging is not involved.
// node tests/interval-position.test.js [url]
const assert = require('assert'); const M = require('../model.js'); const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const mk = o => M.normalizeExercise(M.newExercise(o));

(async () => {
  const b = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  await require('./allow.js')(p);
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const click = async s => { await p.click(s); await wait(80); };
  const adv = async ms => { await p.evaluate(ms => { window.__wbClockOffset = (window.__wbClockOffset || 0) + ms; }, ms); await wait(160); };
  const w = M.newWorkout('Positions');
  w.items = [
    mk({ name: 'Bike sprints', sets: 2, weight: { unit: 'bodyweight', value: null }, mode: 'intervals', modeConfig: { workSec: 20, repsType: 'number', count: 12 } }),
    mk({ name: 'Jump rope', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'intervals', modeConfig: { workSec: 8, repsType: 'static' } }),
    mk({ name: 'Wall sit', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'timer', modeConfig: { workSec: 20, restSec: 10, repsType: null } }),
    mk({ name: 'Shuttle', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'stopwatch', modeConfig: { lapsEnabled: false } }),
    mk({ name: 'Dead hang', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'reps', modeConfig: { repsType: 'static', restSec: 10 } }),
  ];
  const data = M.emptyData(); data.workouts.push(w);
  function geom() {
    const screen = document.querySelector('.pl-screen');
    const sr = screen.getBoundingClientRect();
    const ro = document.getElementById('ro').getBoundingClientRect();
    const rs = getComputedStyle(document.getElementById('ro'));
    const hint = document.querySelector('.pl-hint');
    const chip = document.querySelector('.pl-chip');
    const bar = document.querySelector('.pl-bar');
    function hit(el) {
      if (!el) return false;
      const b = el.getBoundingClientRect();
      if (el.classList && el.classList.contains('pl-hint') && !el.textContent.trim()) return false;
      return ro.bottom > b.top + 1 && ro.top < b.bottom - 1 && ro.right > b.left + 1 && ro.left < b.right - 1;
    }
    const S = window.__wbPlayer;
    return {
      pct: +(((ro.top + ro.bottom) / 2 - sr.top) / sr.height * 100).toFixed(1),
      text: document.getElementById('ro').textContent,
      color: rs.color, font: rs.fontSize, cls: screen.className,
      overlap: hit(hint) || hit(chip) || hit(bar),
      logged: !!(S.results[S.idx] && S.results[S.idx].logged),
    };
  }
  const viewports = [
    { name: 'phone', width: 390, height: 844, isMobile: true, hasTouch: true },
    { name: 'narrow', width: 320, height: 568, isMobile: true, hasTouch: true },
    { name: 'tablet', width: 768, height: 1024, isMobile: true, hasTouch: true },
    { name: 'desktop', width: 1280, height: 800, isMobile: false, hasTouch: false },
  ];
  for (const vp of viewports) {
    await p.setViewport(vp);
    await p.goto(URL);
    await p.evaluate((k, v) => localStorage.setItem(k, v), M.STORAGE_KEY, JSON.stringify(data));
    await p.goto(URL + '#/w/' + w.id); await p.reload();
    await p.waitForSelector('[data-a=play]');
    await p.evaluate(() => { window.__wbClockOffset = 0; });
    await click('[data-a=play]');
    const ready = await p.evaluate(geom);
    assert.strictEqual(ready.pct, 52, vp.name + ' ready ' + ready.pct);
    assert.strictEqual(ready.color, 'rgb(37, 99, 235)', vp.name + ' ready color');
    assert.strictEqual(ready.logged, false);
    assert.ok(/is-interval/.test(ready.cls) && !/is-work/.test(ready.cls));
    assert.strictEqual(ready.overlap, false, vp.name + ' ready overlap');
    await click('[data-p=primary]');
    const getReady = await p.evaluate(geom);
    assert.strictEqual(getReady.pct, 52, vp.name + ' get-ready');
    assert.strictEqual(getReady.color, 'rgb(37, 99, 235)');
    assert.strictEqual(getReady.font, ready.font, vp.name + ' size changed');
    assert.strictEqual(getReady.logged, false);
    assert.strictEqual(getReady.overlap, false, vp.name + ' get-ready overlap');
    await adv(5200);
    const work = await p.evaluate(geom);
    assert.strictEqual(work.pct, 52, vp.name + ' work');
    assert.strictEqual(work.color, 'rgb(37, 99, 235)', vp.name + ' work color');
    assert.strictEqual(work.font, ready.font);
    assert.strictEqual(work.logged, false); // countdown start does not log the interval
    assert.ok(/is-work/.test(work.cls) && /is-interval/.test(work.cls));
    assert.strictEqual(work.overlap, false, vp.name + ' work overlap');
    await click('[data-p=primary]');
    const paused = await p.evaluate(geom);
    assert.strictEqual(paused.pct, 52);
    assert.strictEqual(paused.logged, false);
    assert.strictEqual(paused.overlap, false, vp.name + ' paused overlap');
    await p.evaluate(() => WBPlayer.selectStep(3)); await wait(80);
    const timerReady = await p.evaluate(geom);
    assert.strictEqual(timerReady.pct, 52, vp.name + ' timer ready ' + timerReady.pct);
    assert.strictEqual(timerReady.text, '0:20');
    assert.strictEqual(timerReady.color, 'rgb(37, 99, 235)', vp.name + ' timer ready color');
    assert.strictEqual(timerReady.font, ready.font, vp.name + ' timer ready size');
    assert.strictEqual(timerReady.overlap, false, vp.name + ' timer ready overlap');
    assert.strictEqual(timerReady.logged, false);
    await click('[data-p=primary]');
    const timerReadyGo = await p.evaluate(geom);
    assert.strictEqual(timerReadyGo.pct, 52, vp.name + ' timer get-ready');
    assert.ok(/^0:0[1-5]$/.test(timerReadyGo.text), timerReadyGo.text);
    assert.strictEqual(timerReadyGo.color, 'rgb(37, 99, 235)');
    assert.strictEqual(timerReadyGo.font, ready.font);
    assert.strictEqual(timerReadyGo.overlap, false, vp.name + ' timer get-ready overlap');
    await click('[data-p=primary]'); // pause, so the tap hint is on screen with the countdown
    const timerPaused = await p.evaluate(geom);
    assert.strictEqual(timerPaused.pct, 52, vp.name + ' timer get-ready paused');
    assert.strictEqual(timerPaused.overlap, false, vp.name + ' timer get-ready paused overlap');
    assert.strictEqual(timerPaused.logged, false);
    await click('[data-p=primary]');
    await adv(5200);
    const timerWork = await p.evaluate(geom);
    assert.strictEqual(timerWork.pct, 52);
    assert.strictEqual(timerWork.color, 'rgb(37, 99, 235)');
    await adv(20100);
    const rest = await p.evaluate(geom);
    assert.strictEqual(rest.pct, 52);
    assert.strictEqual(rest.color, 'rgb(37, 99, 235)');
    assert.strictEqual(rest.overlap, false, vp.name + ' rest overlap');
    await p.evaluate(() => WBPlayer.selectStep(4)); await wait(80);
    await click('.pl-go'); await wait(80);
    const sw = await p.evaluate(geom);
    assert.strictEqual(sw.pct, 52, vp.name + ' stopwatch');
    assert.strictEqual(sw.color, 'rgb(37, 99, 235)');
    assert.strictEqual(sw.font, work.font, vp.name + ' size drifted');
    assert.ok(/^\d\d:\d\d\.\d\d$/.test(sw.text), vp.name + ' stopwatch format ' + sw.text);
    await p.evaluate(() => WBPlayer.selectStep(5)); await wait(80);
    const holdReady = await p.evaluate(geom);
    assert.strictEqual(holdReady.pct, 52, vp.name + ' hold ready ' + holdReady.pct);
    assert.strictEqual(holdReady.text, '0:00');
    assert.strictEqual(holdReady.color, 'rgb(37, 99, 235)');
    assert.strictEqual(holdReady.font, ready.font, vp.name + ' hold size');
    assert.strictEqual(holdReady.overlap, false, vp.name + ' hold ready overlap');
    assert.strictEqual(holdReady.logged, false);
    await click('[data-p=primary]');
    await p.evaluate(() => {
      const S = window.__wbPlayer;
      S.running = false;
      S.acc = 65000;
      WBPlayer.step();
    });
    await wait(40);
    const holdRun = await p.evaluate(geom);
    assert.strictEqual(holdRun.pct, 52, vp.name + ' hold count');
    assert.strictEqual(holdRun.text, '1:05');
    assert.strictEqual(holdRun.color, 'rgb(37, 99, 235)');
    assert.strictEqual(holdRun.font, ready.font);
    assert.strictEqual(holdRun.overlap, false, vp.name + ' hold count overlap');
    assert.strictEqual(holdRun.logged, false);
    assert.strictEqual(await p.evaluate(() => window.__wbPlayer.results[5].holdSec), 0); // display freeze does not log
    await p.evaluate(() => { window.__wbPlayer.acc = 65400; window.__wbPlayer.running = false; });
    await click('[data-p=primary]');
    const holdRest = await p.evaluate(geom);
    assert.strictEqual(holdRest.pct, 52, vp.name + ' hold rest');
    assert.strictEqual(holdRest.text, '0:10');
    assert.strictEqual(holdRest.color, 'rgb(37, 99, 235)');
    assert.strictEqual(holdRest.overlap, false, vp.name + ' hold rest overlap');
    const logged = await p.evaluate(() => {
      const r = window.__wbPlayer.results[5];
      return { hold: r.holdSec, logged: r.logged, phase: window.__wbPlayer.phase };
    });
    assert.strictEqual(logged.hold, 65); // still rounded milliseconds, not the floored clock
    assert.strictEqual(logged.logged, true);
    assert.strictEqual(logged.phase, 'rest');
  }
  // Finished screens use the countdown shape. The stopwatch keeps hundredths.
  async function loadFormat(items) {
    const wf = M.newWorkout('Formats');
    wf.items = items.map(mk);
    const dataF = M.emptyData();
    dataF.workouts.push(wf);
    await p.setViewport(viewports[0]);
    await p.goto(URL);
    await p.evaluate((k, v) => localStorage.setItem(k, v), M.STORAGE_KEY, JSON.stringify(dataF));
    await p.goto(URL + '#/w/' + wf.id);
    await p.reload();
    await p.waitForSelector('[data-a=play]');
    await p.evaluate(() => { window.__wbClockOffset = 0; });
    await click('[data-a=play]');
  }
  function clockNow() {
    return p.evaluate(() => {
      const ro = document.getElementById('ro');
      const S = window.__wbPlayer;
      const ex = S.w.items.filter(x => x.id === S.queue[S.idx].exerciseId)[0];
      const rs = ro ? getComputedStyle(ro) : null;
      return { text: ro && ro.textContent, phase: S.phase, mode: ex.mode, prompt: !!document.querySelector('.pl-modal'), color: rs && rs.color };
    });
  }
  await loadFormat([
    { name: 'Wall sit', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'timer', modeConfig: { workSec: 10, restSec: 5, repsType: null } },
  ]);
  let fin = await clockNow();
  assert.strictEqual(fin.text, '0:10');
  await click('[data-p=primary]');
  fin = await clockNow();
  assert.ok(/^0:0[1-5]$/.test(fin.text), 'timer get-ready ' + fin.text);
  await p.evaluate(() => { window.__wbClockOffset = 7000; });
  await wait(250);
  fin = await clockNow();
  assert.strictEqual(fin.phase, 'work');
  assert.ok(/^\d+:\d\d$/.test(fin.text) && fin.text.indexOf('.') < 0, 'timer work ' + fin.text);
  await p.evaluate(() => { window.__wbClockOffset = 22000; });
  await wait(400);
  fin = await clockNow();
  assert.strictEqual(fin.phase, 'complete');
  assert.strictEqual(fin.prompt, true);
  assert.strictEqual(fin.text, '0:00');
  assert.strictEqual(fin.color, 'rgb(37, 99, 235)');
  await loadFormat([
    { name: 'Bike sprints', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'intervals', modeConfig: { workSec: 8, repsType: null } },
  ]);
  fin = await clockNow();
  assert.strictEqual(fin.text, '0:08');
  await click('[data-p=primary]');
  await p.evaluate(() => { window.__wbClockOffset = 20000; });
  await wait(400);
  fin = await clockNow();
  assert.strictEqual(fin.phase, 'complete');
  assert.strictEqual(fin.mode, 'intervals');
  assert.strictEqual(fin.text, '0:00');
  assert.strictEqual(fin.color, 'rgb(37, 99, 235)');
  await loadFormat([
    { name: 'Shuttle', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'stopwatch', modeConfig: { lapsEnabled: false } },
  ]);
  fin = await clockNow();
  assert.strictEqual(fin.text, '00:00.00');
  await click('.pl-go');
  await p.evaluate(() => {
    const S = window.__wbPlayer;
    S.acc = 3250;
    S.running = true;
    S.t0 = performance.now() + (window.__wbClockOffset || 0);
    WBPlayer.step();
  });
  await click('.pl-go');
  fin = await clockNow();
  assert.strictEqual(fin.phase, 'complete');
  assert.strictEqual(fin.mode, 'stopwatch');
  assert.strictEqual(fin.color, 'rgb(37, 99, 235)');
  assert.ok(/^00:03\.\d\d$/.test(fin.text) || /^\d\d:\d\d\.\d\d$/.test(fin.text), 'stopwatch complete ' + fin.text);
  assert.ok(/\.\d\d$/.test(fin.text), fin.text);
  assert.deepStrictEqual(errs, []);
  console.log('INTERVAL POSITION OK');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
