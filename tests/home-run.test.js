// Closed workout list has Run, which opens the same player as Start.
// node tests/home-run.test.js [url]
const assert = require('assert'); const M = require('../model.js'); const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const mk = o => M.normalizeExercise(M.newExercise(o));
const w = M.newWorkout('Morning');
w.items = [mk({ name: 'Curl', sets: 1, weight: { unit: 'lb', value: 20 }, mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 0 } })];
const empty = M.newWorkout('Empty');
const data = M.emptyData(); data.workouts.push(w, empty);
(async () => {
  const b = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const p = await b.newPage(); await p.setViewport({ width: 412, height: 915, isMobile: true });
  await require('./allow.js')(p);
  const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('dialog', d => d.accept());
  await p.goto(URL);
  await p.evaluate((k, v) => localStorage.setItem(k, v), M.STORAGE_KEY, JSON.stringify(data));
  await p.goto(URL + '#/'); await p.reload();
  await p.waitForSelector('[data-a=run]');
  const runs = await p.$$('[data-a=run]');
  assert.strictEqual(runs.length, 2);
  assert.strictEqual(await p.$eval('[data-a=run][data-id="' + w.id + '"]', e => e.textContent), 'Run');
  assert.strictEqual(await p.$eval('[data-a=run][data-id="' + empty.id + '"]', e => e.disabled), true);
  await p.click('[data-a=run][data-id="' + w.id + '"]');
  await p.waitForSelector('.pl-screen');
  assert.strictEqual(await p.$eval('.pl-info .pl-name', e => e.textContent), 'Curl');
  assert.ok(/#\/play\//.test(await p.evaluate(() => location.hash)));
  assert.deepStrictEqual(errs, []);
  console.log('HOME RUN OK');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
