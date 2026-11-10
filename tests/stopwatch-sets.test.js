// Stopwatch counts are labeled Attempts; the stored number still plays once each.
// node tests/stopwatch-sets.test.js [url]
const assert = require('assert'); const M = require('../model.js'); const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const mk = o => M.normalizeExercise(M.newExercise(o));
const sw3 = mk({ name: 'Shuttle', sets: 3, mode: 'stopwatch', modeConfig: { lapsEnabled: true, lapCount: 2 } });
const sw1 = mk({ name: 'Once', sets: 1, mode: 'stopwatch', modeConfig: { lapsEnabled: false } });
assert.strictEqual(M.buildPlayQueue({ items: [sw3] }).length, 3); // stored count still repeats
assert.ok(/3 attempts/.test(M.summarize(sw3))); assert.ok(/2 laps/.test(M.summarize(sw3))); assert.ok(!/\bsets?\b/.test(M.summarize(sw3)));
assert.ok(/1 attempt\b/.test(M.summarize(sw1)));
assert.ok(/3 sets/.test(M.summarize(mk({ name: 'Row', sets: 3, mode: 'reps', modeConfig: { repsType: 'number', count: 8 } }))));

const w = M.newWorkout('Mix');
w.items = [
  mk({ name: 'Cone shuttle down the hall', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'stopwatch', modeConfig: { lapsEnabled: true, lapCount: 3 } }),
  mk({ name: 'Dumbbell row', sets: 2, weight: { unit: 'lb', value: 40 }, mode: 'reps', modeConfig: { repsType: 'number', count: 10, restSec: 30 } }),
];
const kept = mk({ name: 'Keep sets', sets: 4, weight: { unit: 'lb', value: 20 }, mode: 'reps', modeConfig: { repsType: 'number', count: 5, restSec: 0 } });
const data = M.emptyData(); data.workouts.push(w); const editW = M.newWorkout('Edit'); editW.items = [kept]; data.workouts.push(editW);
(async () => {
  const b = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const p = await b.newPage(); await p.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true });
  await require('./allow.js')(p);
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(URL); await p.evaluate((k, v) => localStorage.setItem(k, v), M.STORAGE_KEY, JSON.stringify(data));
  await p.goto(URL + '#/w/' + editW.id + '/ex/' + kept.id); await p.reload(); await p.waitForSelector('[data-b=sets]');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const click = async s => { await p.click(s); await wait(80); };
  assert.ok((await p.$eval('label', () => [...document.querySelectorAll('label')].some(l => l.textContent === 'Sets'))));
  await click('[data-v=stopwatch]');
  assert.strictEqual(await p.$eval('[data-b=sets]', e => e.value), '4');
  assert.ok((await p.$$eval('label', ls => ls.map(l => l.textContent))).includes('Attempts'));
  assert.ok(!(await p.$$eval('label', ls => ls.map(l => l.textContent))).some(t => t === 'Sets' || t === '# of intervals'));
  await click('[data-v=reps]');
  assert.ok(await p.$('[data-b=sets]'));
  assert.strictEqual(await p.$eval('[data-b=sets]', e => e.value), '4');
  await click('[data-v=intervals]');
  assert.ok((await p.$$eval('label', ls => ls.map(l => l.textContent))).includes('# of intervals'));
  await click('[data-v=stopwatch]');
  await click('[data-a=save]');
  await p.waitForSelector('[data-a=play]');
  const saved = await p.evaluate(k => JSON.parse(localStorage.getItem(k)), M.STORAGE_KEY);
  const ex = saved.workouts.find(x => x.id === editW.id).items[0];
  assert.strictEqual(ex.mode, 'stopwatch'); assert.strictEqual(ex.sets, 4); // Attempts field keeps the stored number
  await p.goto(URL + '#/play/' + w.id); await p.reload(); await p.waitForSelector('.pl-go');
  assert.strictEqual(await p.$eval('.pl-go', e => e.textContent), 'Start');
  assert.strictEqual(await p.$eval('.pl-go', e => getComputedStyle(e).minHeight), '99px');
  assert.strictEqual(await p.$('.pl-info'), null); // stopwatch media has no exercise info frame
  assert.strictEqual(await p.$eval('.pl-chip', e => e.textContent), '3 Laps');
  assert.strictEqual(await p.$eval('.pl-ci.cur span', e => e.textContent), 'Attempt 1/1');
  assert.ok(/Attempt 1\/1/.test(await p.$eval('.pl-th', e => e.textContent)));
  assert.strictEqual(await p.$('.pl-car .pl-car-h'), null); // carousel has no Sets / Attempts / Steps title
  assert.strictEqual(await p.$eval('.pl-list .pl-car-h', e => e.textContent), 'Workout');
  assert.strictEqual(await p.$eval('.pl-li b', e => e.textContent), 'Cone shuttle down the hall');
  assert.strictEqual(await p.$$eval('.pl-li.cur, .pl-li.fin', a => a.length), 0);
  assert.strictEqual(await p.$('.pl-cnt'), null);
  await click('.pl-go');
  assert.strictEqual(await p.$eval('.pl-go', e => e.textContent), 'Lap 1 / 3');
  assert.strictEqual(await p.$eval('.pl-chip', e => e.textContent), '3 Laps'); // lap total stays for the whole attempt
  await p.evaluate(() => document.querySelectorAll('.pl-ci')[1].click()); await wait(80);
  assert.strictEqual(await p.$('.pl-go'), null);
  assert.ok(/Set 1\/2/.test(await p.$eval('.pl-ci.cur span', e => e.textContent)));
  const rowInfo = await p.$eval('.pl-info', e => e.textContent);
  assert.ok(rowInfo.includes('10 reps'), rowInfo);
  assert.ok(!/Set \d+ of/.test(rowInfo), rowInfo);
  assert.strictEqual(await p.$eval('.pl-chip', e => e.textContent), '10 Reps');
  const dbRow = await p.evaluate(() => [...document.querySelectorAll('.pl-li')].find(e => e.querySelector('b').textContent === 'Dumbbell row').innerText);
  assert.ok(dbRow.includes('Dumbbell row'), dbRow);
  assert.ok(!/reps|0\/2/.test(dbRow), dbRow);
  assert.strictEqual(await p.$$eval('.pl-li.cur, .pl-li.fin', a => a.length), 0);
  async function summaryOf(items) {
    const ww = M.newWorkout('Sum'); ww.items = items;
    const dd = M.emptyData(); dd.workouts.push(ww);
    await p.evaluate((k, v) => localStorage.setItem(k, v), M.STORAGE_KEY, JSON.stringify(dd));
    await p.goto(URL + '#/play/' + ww.id); await p.reload(); await p.waitForSelector('.pl-endw');
    await click('.pl-endw'); await p.waitForSelector('.pl-done .mute');
    return p.$eval('.pl-done .mute', e => e.textContent);
  }
  const swOnly = await summaryOf([mk({ name: 'Shuttle', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'stopwatch', modeConfig: { lapsEnabled: false } })]);
  assert.ok(/0 of 1 attempt logged/.test(swOnly), swOnly); assert.ok(!/sets/.test(swOnly), swOnly);
  const setsOnly = await summaryOf([mk({ name: 'Row', sets: 2, weight: { unit: 'lb', value: 40 }, mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 0 } })]);
  assert.ok(/0 of 2 sets logged/.test(setsOnly), setsOnly); assert.ok(!/attempt/.test(setsOnly), setsOnly);
  const mixed = await summaryOf([
    mk({ name: 'Shuttle', sets: 2, weight: { unit: 'bodyweight', value: null }, mode: 'stopwatch', modeConfig: { lapsEnabled: false } }),
    mk({ name: 'Row', sets: 2, weight: { unit: 'lb', value: 40 }, mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 0 } })
  ]);
  assert.ok(/0 of 2 sets logged/.test(mixed), mixed);
  assert.ok(/0 of 2 attempts logged/.test(mixed), mixed);
  assert.ok(!/sets and attempts/.test(mixed), mixed);
  assert.ok(!/ of 4 /.test(mixed), mixed);
  const oneEach = await summaryOf([
    mk({ name: 'Shuttle', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'stopwatch', modeConfig: { lapsEnabled: false } }),
    mk({ name: 'Row', sets: 1, weight: { unit: 'lb', value: 40 }, mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 0 } })
  ]);
  assert.ok(/0 of 1 set logged/.test(oneEach), oneEach);
  assert.ok(/0 of 1 attempt logged/.test(oneEach), oneEach);
  assert.ok(!/sets and attempts/.test(oneEach), oneEach);
  assert.deepStrictEqual(errs, []); console.log('STOPWATCH SETS UI OK'); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
