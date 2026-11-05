// Stopwatch Start/Lap button: node tests/stopwatch-button.test.js [url]
const assert = require('assert'); const M = require('../model.js'); const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const w = M.newWorkout('SW'); const mk = o => M.normalizeExercise(M.newExercise(o));
w.items = [
  mk({ name: 'Cone shuttle down the hall and back', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'stopwatch', modeConfig: { lapsEnabled: true, lapCount: 3 } }),
  mk({ name: 'Sprint', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'stopwatch', modeConfig: { lapsEnabled: false } }),
  mk({ name: 'Curl', sets: 1, weight: { unit: 'lb', value: 25 }, mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 20 } }),
  mk({ name: 'Press', sets: 1, weight: { unit: 'lb', value: 40 }, mode: 'reps', modeConfig: { repsType: 'number', count: 6, restSec: 15 } }),
];
M.linkSuperset(w, [w.items[2].id, w.items[3].id]);
const data = M.emptyData(); data.workouts.push(w);
(async () => {
  const b = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage(); await p.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(URL); await p.evaluate((k, v) => localStorage.setItem(k, v), M.STORAGE_KEY, JSON.stringify(data));
  await p.goto(URL + '#/w/' + w.id); await p.reload(); await p.waitForSelector('[data-a=play]');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const click = async s => { await p.click(s); await wait(80); };
  const adv = async ms => { await p.evaluate(ms => { window.__wbClockOffset = (window.__wbClockOffset || 0) + ms; }, ms); await wait(120); };
  const st = () => p.evaluate(() => { const S = window.__wbPlayer; return { phase: S.phase, running: S.running, laps: (S.results[S.idx] && S.results[S.idx].laps || []).length, logged: !!(S.results[S.idx] && S.results[S.idx].logged) }; });
  await click('[data-a=play]');
  assert.strictEqual(await p.$eval('.pl-go', e => e.textContent), 'Start');
  assert.strictEqual(await p.$eval('.pl-screen', e => e.getAttribute('data-p')), null);
  assert.ok(await p.$('.pl-screen.is-static'));
  assert.strictEqual(await p.$('.pl-hint'), null);
  const box = () => p.evaluate(() => {
    const g = document.querySelector('.pl-go').getBoundingClientRect();
    const t = document.querySelector('.pl-track').getBoundingClientRect();
    const s = document.querySelector('.pl-stage').getBoundingClientRect();
    return { gw: +g.width.toFixed(1), tw: +t.width.toFixed(1), gl: +g.left.toFixed(1), tl: +t.left.toFixed(1), gapAbove: +(g.top - s.bottom).toFixed(1), gapBelow: +(t.top - g.bottom).toFixed(1) };
  });
  let lay = await box();
  assert.strictEqual(lay.gw, lay.tw); assert.strictEqual(lay.gl, lay.tl);
  assert.ok(lay.gapAbove > 0 && lay.gapBelow > 0, JSON.stringify(lay));
  await p.click('.pl-screen'); await wait(80);
  assert.deepStrictEqual(await st(), { phase: 'ready', running: false, laps: 0, logged: false });
  await click('.pl-go');
  assert.strictEqual(await p.$eval('.pl-go', e => e.textContent), 'Lap 1 / 3');
  assert.deepStrictEqual(await st(), { phase: 'work', running: true, laps: 0, logged: false });
  await adv(1500); await click('.pl-go');
  assert.strictEqual((await st()).laps, 1);
  assert.strictEqual(await p.$eval('.pl-go', e => e.textContent), 'Lap 2 / 3');
  // no-lap stopwatch: same button finishes the set
  await p.evaluate(() => [...document.querySelectorAll('.pl-ci')].find(e => e.textContent.includes('Sprint')).click());
  await wait(80);
  assert.strictEqual(await p.$eval('.pl-go', e => e.textContent), 'Start');
  await click('.pl-go');
  assert.strictEqual(await p.$eval('.pl-go', e => e.textContent), 'Finish');
  await adv(800); await click('.pl-go');
  let s = await st(); assert.strictEqual(s.phase, 'complete'); assert.ok(s.logged); assert.strictEqual(s.running, false);
  // reps media control unchanged
  await click('.pl-go'); // Next exercise -> Curl
  assert.strictEqual(await p.$('.pl-go'), null);
  assert.strictEqual(await p.$eval('.pl-screen', e => e.getAttribute('data-p')), 'primary');
  assert.ok(await p.$('.pl-hint'));
  await click('[data-p=primary]');
  s = await p.evaluate(() => ({ phase: window.__wbPlayer.phase, name: document.querySelector('.pl-info .pl-name').textContent }));
  assert.strictEqual(s.phase, 'work'); assert.strictEqual(s.name, 'Press'); // non-final superset skips rest
  // stopwatch supersetted with a partner: button still matches the full tracking width
  const sw = M.newWorkout('SSW');
  sw.items = [
    mk({ name: 'Farmer carry', sets: 1, weight: { unit: 'lb', value: 40 }, mode: 'stopwatch', modeConfig: { lapsEnabled: true, lapCount: 2 } }),
    mk({ name: 'Plank', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'timer', modeConfig: { workSec: 20, restSec: 10, repsType: null } }),
  ];
  M.linkSuperset(sw, [sw.items[0].id, sw.items[1].id]);
  const d2 = M.emptyData(); d2.workouts.push(sw);
  await p.evaluate((k, v) => localStorage.setItem(k, v), M.STORAGE_KEY, JSON.stringify(d2));
  await p.goto(URL + '#/w/' + sw.id); await p.reload(); await p.waitForSelector('[data-a=play]');
  await click('[data-a=play]');
  assert.strictEqual(await p.$eval('.pl-ss-extra .pl-name', e => e.textContent), 'Plank');
  assert.strictEqual(await p.$eval('.pl-screen', e => e.getAttribute('data-p')), null);
  lay = await box();
  assert.strictEqual(lay.gw, lay.tw); assert.strictEqual(lay.gl, lay.tl);
  assert.ok(lay.gapAbove > 0 && lay.gapBelow > 0, JSON.stringify(lay));
  const overlap = await p.evaluate(() => {
    const g = document.querySelector('.pl-go').getBoundingClientRect();
    const parts = ['.pl-stage', '.pl-track', '.pl-ss-extra'].map(sel => document.querySelector(sel).getBoundingClientRect());
    return parts.some(r => !(g.bottom <= r.top + 0.5 || g.top >= r.bottom - 0.5 || g.right <= r.left + 0.5 || g.left >= r.right - 0.5));
  });
  assert.strictEqual(overlap, false);
  await p.click('.pl-screen'); await wait(80);
  assert.strictEqual((await p.evaluate(() => window.__wbPlayer.phase)), 'ready');
  await click('.pl-go');
  assert.strictEqual(await p.evaluate(() => window.__wbPlayer.phase), 'work');
  assert.deepStrictEqual(errs, []); console.log('STOPWATCH BUTTON OK'); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
