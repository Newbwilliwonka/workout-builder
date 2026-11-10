// Interval mode: log each interval when it starts, and keep its media timer
// on the same spot as rest, work, and the stopwatch. node tests/interval-start.test.js [url]
const assert = require('assert'); const M = require('../model.js'); const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const mk = o => M.normalizeExercise(M.newExercise(o));

function workout(name, items, link) {
  const w = M.newWorkout(name);
  w.items = items.map(mk);
  if (link) M.linkSuperset(w, [w.items[0].id, w.items[1].id]);
  const data = M.emptyData(); data.workouts.push(w);
  return { w, data };
}

(async () => {
  const b = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  await require('./allow.js')(p);
  const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('dialog', d => d.accept());
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const click = async s => { await p.click(s); await wait(80); };
  const adv = async ms => { await p.evaluate(ms => { window.__wbClockOffset = (window.__wbClockOffset || 0) + ms; }, ms); await wait(160); };
  async function boot(built, vp) {
    await p.setViewport(vp || { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await p.goto(URL);
    await p.evaluate((k, v) => localStorage.setItem(k, v), M.STORAGE_KEY, JSON.stringify(built.data));
    await p.goto(URL + '#/w/' + built.w.id); await p.reload();
    await p.waitForSelector('[data-a=play]');
    await p.evaluate(() => { window.__wbClockOffset = 0; });
    await click('[data-a=play]');
  }
  const st = () => p.evaluate(() => {
    const S = window.__wbPlayer;
    const logged = Object.keys(S.results).filter(k => S.results[k].logged).map(k => +k).sort((a, b) => a - b);
    const track = document.querySelector('.pl-th');
    return {
      idx: S.idx, phase: S.phase, running: S.running,
      logged, reps: S.results[S.idx] && S.results[S.idx].reps,
      at: logged.map(k => S.results[k].at),
      track: track ? track.textContent : '',
      hint: (document.querySelector('.pl-hint') || {}).textContent || '',
      chip: (document.querySelector('.pl-chip') || {}).textContent || '',
      ro: (document.getElementById('ro') || {}).textContent || '',
      checks: document.querySelectorAll('.pl-ci.done .pl-ck').length,
    };
  });

  // --- ending during get-ready does not log the interval ---
  const early = workout('Early end', [
    { name: 'Bike sprints', sets: 2, weight: { unit: 'bodyweight', value: null }, mode: 'intervals', modeConfig: { workSec: 10, repsType: 'number', count: 12 } },
  ]);
  await boot(early);
  await click('[data-p=primary]');
  let s = await st(); assert.strictEqual(s.phase, 'standoff'); assert.deepStrictEqual(s.logged, []);
  await click('[data-p=primary]'); // pause
  await adv(20000); await click('[data-p=primary]'); // resume; the pause must not count as a start
  s = await st(); assert.strictEqual(s.phase, 'standoff'); assert.deepStrictEqual(s.logged, []);
  await p.evaluate(() => WBPlayer.selectStep(1)); await wait(80);
  s = await st(); assert.strictEqual(s.phase, 'ready'); assert.deepStrictEqual(s.logged, []); // jump during get-ready logs nothing
  await p.evaluate(() => WBPlayer.selectStep(0)); await wait(80);
  await click('[data-p=primary]');
  s = await st(); assert.strictEqual(s.phase, 'standoff'); assert.deepStrictEqual(s.logged, []);
  await click('.pl-endw'); await wait(200);
  assert.strictEqual(await p.evaluate(() => window.__wbPlayer.done.results.length), 0);

  // --- each interval logs at the start of its countdown; edits, pause, summary, saved session ---
  const run = workout('Interval run', [
    { name: 'Bike sprints', sets: 3, weight: { unit: 'bodyweight', value: null }, mode: 'intervals', modeConfig: { workSec: 10, repsType: 'number', count: 12 } },
    { name: 'Wall sit', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'timer', modeConfig: { workSec: 10, restSec: 5, repsType: null } },
    { name: 'Row', sets: 1, weight: { unit: 'lb', value: 25 }, mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 10 } },
    { name: 'Shuttle', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'stopwatch', modeConfig: { lapsEnabled: true, lapCount: 2 } },
  ]);
  await boot(run);
  s = await st(); assert.strictEqual(s.phase, 'ready'); assert.strictEqual(s.ro, '0:10'); assert.deepStrictEqual(s.logged, []);
  assert.ok(/Tracking/.test(s.track));
  const sched = await p.evaluate(() => WBPlayer.toneSchedule(10, 3).map(x => x.t + x.kind[0]).join(' '));
  assert.strictEqual(sched, '0t 1t 2t 3t 4t 5g 12t 13t 14t 15g 22t 23t 24t 25g 32t 33t 34t 35d');
  await click('[data-p=primary]');
  s = await st(); assert.strictEqual(s.phase, 'standoff'); assert.strictEqual(s.chip, 'Get ready'); assert.deepStrictEqual(s.logged, []);
  await adv(5100);
  s = await st(); assert.strictEqual(s.phase, 'work'); assert.strictEqual(s.idx, 0); assert.deepStrictEqual(s.logged, [0]);
  assert.ok(/Logged/.test(s.track), s.track); assert.strictEqual(s.checks, 1);
  const at0 = s.at[0];
  await click('[data-p=primary]'); s = await st(); assert.strictEqual(s.running, false); assert.deepStrictEqual(s.logged, [0]); assert.strictEqual(s.at[0], at0);
  assert.strictEqual(s.hint, 'Tap to resume'); // still the pause hint, not a second log
  await click('[data-st=reps][data-d="-1"]');
  s = await st(); assert.strictEqual(s.reps, 11); assert.deepStrictEqual(s.logged, [0]); assert.strictEqual(s.at[0], at0);
  await click('[data-p=primary]');
  await adv(10100);
  s = await st(); assert.strictEqual(s.idx, 1); assert.strictEqual(s.phase, 'work'); assert.deepStrictEqual(s.logged, [0, 1]);
  assert.ok(s.at[0] === at0 && s.at[1] >= at0);
  await adv(10100);
  s = await st(); assert.strictEqual(s.idx, 2); assert.strictEqual(s.phase, 'work'); assert.deepStrictEqual(s.logged, [0, 1, 2]);
  assert.ok(/fin/.test(await p.$eval('.pl-li', e => e.className))); // list follows the same logged count; layout is unchanged
  await p.evaluate(() => { window.WB.SAVE_SESSIONS = true; });
  await click('.pl-endw'); await wait(250);
  const saved = await p.evaluate(k => {
    const done = window.__wbPlayer.done.results.map(r => r.step + ':' + r.name + ':' + r.reps);
    const store = JSON.parse(localStorage.getItem(k));
    const ses = store.sessions[0];
    return { done, n: ses.results.length, steps: ses.results.map(r => r.step), dup: ses.results.length !== new Set(ses.results.map(r => r.step)).size, reps0: ses.results[0].reps };
  }, M.STORAGE_KEY);
  assert.deepStrictEqual(saved.done, ['0:Bike sprints:11', '1:Bike sprints:12', '2:Bike sprints:12']);
  assert.strictEqual(saved.n, 3); assert.deepStrictEqual(saved.steps, [0, 1, 2]); assert.strictEqual(saved.dup, false);
  assert.strictEqual(saved.reps0, 11);
  const summary = await p.evaluate(() => document.body.innerText);
  assert.ok(/3 of 5 sets logged/.test(summary), summary);
  assert.ok(/0 of 1 attempt logged/.test(summary), summary);

  // --- redo and skipping ahead do not double-log or log an interval that has not started ---
  await boot(run);
  await click('[data-p=primary]'); await adv(5100);
  s = await st(); assert.deepStrictEqual(s.logged, [0]);
  await p.evaluate(() => WBPlayer.selectStep(2)); await wait(80);
  s = await st(); assert.strictEqual(s.idx, 2); assert.strictEqual(s.phase, 'ready'); assert.deepStrictEqual(s.logged, [0]);
  await p.evaluate(() => WBPlayer.selectStep(0)); await wait(80);
  s = await st(); assert.strictEqual(s.hint, 'Logged · tap to redo'); assert.deepStrictEqual(s.logged, [0]);
  await click('[data-p=primary]');
  s = await st(); assert.strictEqual(s.phase, 'standoff'); assert.deepStrictEqual(s.logged, [0]);
  await adv(5100);
  s = await st(); assert.strictEqual(s.phase, 'work'); assert.strictEqual(s.idx, 0); assert.deepStrictEqual(s.logged, [0]);
  await adv(10100); await adv(10100);
  s = await st(); assert.strictEqual(s.idx, 2); assert.deepStrictEqual(s.logged, [0, 1, 2]); // redo did not add a second copy of interval 1

  // timer, reps, and stopwatch still log on their own rules
  await p.evaluate(() => WBPlayer.selectStep(3)); await wait(80);
  await click('[data-p=primary]'); await adv(5100);
  s = await st(); assert.strictEqual(s.phase, 'work'); assert.strictEqual(s.idx, 3); assert.ok(s.logged.indexOf(3) < 0);
  await adv(10100);
  s = await st(); assert.strictEqual(s.phase, 'rest'); assert.ok(s.logged.indexOf(3) >= 0); // timer still logs when rest starts
  const loggedBeforeSkip = (await st()).logged.length;
  await click('[data-p=primary]'); // skip rest
  s = await st(); assert.strictEqual(s.logged.length, loggedBeforeSkip);
  await click('[data-p=primary]'); // reps -> rest
  s = await st(); assert.strictEqual(s.phase, 'rest'); assert.ok(s.logged.indexOf(4) >= 0);
  await p.evaluate(() => WBPlayer.selectStep(5)); await wait(80);
  await click('.pl-go'); await wait(80);
  s = await st(); assert.strictEqual(s.phase, 'work'); assert.ok(s.logged.indexOf(5) < 0); // stopwatch still logs when the attempt finishes

  // superset: the interval logs at its start; the partner stays unlogged until its own rule
  const ss = workout('Interval pair', [
    { name: 'Sprint', sets: 2, weight: { unit: 'bodyweight', value: null }, mode: 'intervals', modeConfig: { workSec: 8, repsType: null } },
    { name: 'Walk back', sets: 2, weight: { unit: 'bodyweight', value: null }, mode: 'reps', modeConfig: { repsType: 'number', count: 1, restSec: 6 } },
  ], true);
  await boot(ss);
  await click('[data-p=primary]'); await adv(5100);
  s = await st(); assert.strictEqual(s.idx, 0); assert.strictEqual(s.phase, 'work'); assert.deepStrictEqual(s.logged, [0]);
  await adv(8100);
  s = await st(); assert.strictEqual(s.idx, 1); assert.strictEqual(s.phase, 'work'); assert.deepStrictEqual(s.logged, [0]); // partner not logged early
  await click('[data-p=primary]');
  s = await st(); assert.strictEqual(s.phase, 'rest'); assert.deepStrictEqual(s.logged, [0, 1]);
  await adv(6100);
  s = await st(); assert.strictEqual(s.idx, 2); assert.strictEqual(s.phase, 'ready'); assert.deepStrictEqual(s.logged, [0, 1]);
  await click('[data-p=primary]');
  s = await st(); assert.strictEqual(s.phase, 'standoff'); assert.deepStrictEqual(s.logged, [0, 1]);
  await adv(5100);
  s = await st(); assert.strictEqual(s.idx, 2); assert.strictEqual(s.phase, 'work'); assert.deepStrictEqual(s.logged, [0, 1, 2]);

  // --- position: interval ready, get-ready, and work share the rest / stopwatch spot ---
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
    return {
      phase: window.__wbPlayer.phase,
      pct: +(((ro.top + ro.bottom) / 2 - sr.top) / sr.height * 100).toFixed(1),
      color: rs.color, font: rs.fontSize, top: rs.top,
      cls: screen.className,
      overlap: hit(hint) || hit(chip) || hit(bar),
    };
  }
  const viewports = [
    { name: 'phone', width: 390, height: 844, isMobile: true, hasTouch: true },
    { name: 'narrow', width: 320, height: 568, isMobile: true, hasTouch: true },
    { name: 'tablet', width: 768, height: 1024, isMobile: true, hasTouch: true },
    { name: 'desktop', width: 1280, height: 800, isMobile: false, hasTouch: false },
  ];
  const positioned = workout('Positions', [
    { name: 'Bike sprints', sets: 2, weight: { unit: 'bodyweight', value: null }, mode: 'intervals', modeConfig: { workSec: 20, repsType: 'number', count: 12 } },
    { name: 'Jump rope', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'intervals', modeConfig: { workSec: 8, repsType: 'static' } },
    { name: 'Wall sit', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'timer', modeConfig: { workSec: 20, restSec: 10, repsType: null } },
    { name: 'Shuttle', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'stopwatch', modeConfig: { lapsEnabled: false } },
  ]);
  for (const vp of viewports) {
    await boot(positioned, vp);
    const ready = await p.evaluate(geom);
    assert.strictEqual(ready.pct, 52, vp.name + ' ready ' + ready.pct);
    assert.strictEqual(ready.color, 'rgb(37, 99, 235)', vp.name + ' ready color');
    assert.ok(/is-interval/.test(ready.cls) && !/is-work/.test(ready.cls));
    assert.strictEqual(ready.overlap, false, vp.name + ' ready overlap');
    await click('[data-p=primary]');
    const getReady = await p.evaluate(geom);
    assert.strictEqual(getReady.pct, 52, vp.name + ' get-ready');
    assert.strictEqual(getReady.color, 'rgb(37, 99, 235)');
    assert.strictEqual(getReady.font, ready.font, vp.name + ' size changed');
    assert.strictEqual(getReady.overlap, false, vp.name + ' get-ready overlap');
    await adv(5200);
    const work = await p.evaluate(geom);
    assert.strictEqual(work.pct, 52, vp.name + ' work');
    assert.strictEqual(work.color, 'rgb(56, 189, 248)', vp.name + ' work color ' + work.color);
    assert.strictEqual(work.font, ready.font);
    assert.ok(/is-work/.test(work.cls) && /is-interval/.test(work.cls));
    assert.strictEqual(work.overlap, false, vp.name + ' work overlap');
    await click('[data-p=primary]'); // pause, hint is on screen
    const paused = await p.evaluate(geom);
    assert.strictEqual(paused.pct, 52);
    assert.strictEqual(paused.overlap, false, vp.name + ' paused overlap');
    await p.evaluate(() => WBPlayer.selectStep(2)); await wait(80); // static-hold interval, still a countdown
    await click('[data-p=primary]'); await adv(5200);
    const hold = await p.evaluate(geom);
    assert.strictEqual(hold.pct, 52, vp.name + ' static interval');
    assert.strictEqual(hold.color, 'rgb(56, 189, 248)');
    assert.strictEqual(hold.overlap, false);
    await p.evaluate(() => WBPlayer.selectStep(3)); await wait(80);
    const timerReady = await p.evaluate(geom);
    assert.strictEqual(timerReady.pct, 40, vp.name + ' timer ready moved'); // timer mode stays where PR 22 left it
    await click('[data-p=primary]');
    const timerReady2 = await p.evaluate(geom);
    assert.strictEqual(timerReady2.pct, 40, vp.name + ' timer get-ready moved');
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
    assert.strictEqual(sw.font, work.font, vp.name + ' interval size drifted from stopwatch');
  }

  assert.deepStrictEqual(errs, []);
  console.log('INTERVAL START OK');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
