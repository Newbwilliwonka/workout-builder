// Interval ready time and get-ready sit with the other clocks. Logging is not involved.
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
    assert.strictEqual(work.color, 'rgb(56, 189, 248)', vp.name + ' work color');
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
    assert.strictEqual(timerReady.pct, 40, vp.name + ' timer ready moved');
    await click('[data-p=primary]');
    assert.strictEqual((await p.evaluate(geom)).pct, 40, vp.name + ' timer get-ready moved');
    await adv(5200);
    const timerWork = await p.evaluate(geom);
    assert.strictEqual(timerWork.pct, 52);
    assert.strictEqual(timerWork.color, 'rgb(56, 189, 248)');
    await adv(20100);
    const rest = await p.evaluate(geom);
    assert.strictEqual(rest.pct, 52);
    assert.strictEqual(rest.color, 'rgb(110, 231, 183)');
    assert.strictEqual(rest.overlap, false, vp.name + ' rest overlap');
    await p.evaluate(() => WBPlayer.selectStep(4)); await wait(80);
    await click('.pl-go'); await wait(80);
    const sw = await p.evaluate(geom);
    assert.strictEqual(sw.pct, 52, vp.name + ' stopwatch');
    assert.strictEqual(sw.color, 'rgb(37, 99, 235)');
    assert.strictEqual(sw.font, work.font, vp.name + ' size drifted');
  }
  assert.deepStrictEqual(errs, []);
  console.log('INTERVAL POSITION OK');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
