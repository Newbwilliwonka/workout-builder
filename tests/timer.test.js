// Timer back-to-back, final rest never skipped, end-of-workout prompt: node tests/timer.test.js [url]
const assert = require('assert'); const M = require('../model.js'); const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const w = M.newWorkout('Timer run'); const mk = o => M.normalizeExercise(M.newExercise(o));
w.items = [
  mk({ name: 'Wall sit', sets: 2, weight: { unit: 'bodyweight', value: null }, mode: 'timer', modeConfig: { workSec: 10, restSec: 5, repsType: null } }),
  mk({ name: 'Step ups', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'timer', modeConfig: { workSec: 10, restSec: 5, repsType: null } }),
];
const data = M.emptyData(); data.workouts.push(w);
(async () => {
  const b = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage(); await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.evaluate((k, v) => localStorage.setItem(k, v), M.STORAGE_KEY, JSON.stringify(data));
  await p.goto(URL + '#/w/' + w.id); await p.reload(); await p.waitForSelector('[data-a=play]');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const click = async s => { await p.click(s); await wait(80); };
  const adv = async ms => { await p.evaluate(ms => { window.__wbClockOffset = (window.__wbClockOffset || 0) + ms; }, ms); await wait(150); };
  const st = () => p.evaluate(() => { const S = window.__wbPlayer; return { idx: S.idx, phase: S.phase, prompt: !!S.prompt, logged: Object.values(S.results).filter(r => r.logged).length, pending: (S.pending || []).map(x => x.t + x.kind[0]).join(' ') }; });
  await click('[data-a=play]'); await click('[data-p=primary]');
  let s = await st(); assert.strictEqual(s.phase, 'standoff');
  assert.strictEqual(s.pending, '0t 1t 2t 3t 4t 5g 12t 13t 14t 15g 17t 18t 19t 20g 27t 28t 29t 30g 32t 33t 34t 35d');
  await adv(5100); s = await st(); assert.deepStrictEqual([s.idx, s.phase], [0, 'work']);
  await adv(10000); s = await st(); assert.deepStrictEqual([s.idx, s.phase, s.logged], [0, 'rest', 0]);  // auto work -> rest, not yet logged
  await adv(5000); s = await st(); assert.deepStrictEqual([s.idx, s.phase, s.logged], [1, 'work', 1]);  // auto rest -> set 2 work, set 1 logged
  await adv(10000); await adv(5000); s = await st(); assert.deepStrictEqual([s.idx, s.phase, s.logged], [2, 'ready', 2]); // next exercise waits
  await adv(20000); assert.strictEqual((await st()).phase, 'ready');
  await click('[data-p=primary]'); s = await st(); assert.strictEqual(s.pending, '0t 1t 2t 3t 4t 5g 12t 13t 14t 15g 17t 18t 19t 20d');
  await adv(5100); await adv(10000); s = await st(); assert.deepStrictEqual([s.phase, s.prompt], ['rest', false]); // last set's rest NOT skipped
  await click('[data-st=workSec][data-d="5"]');                                       // edit during final rest
  await adv(5000); s = await st(); assert.deepStrictEqual([s.prompt, s.logged], [true, 3]);   // rest done -> logged + prompt
  assert.ok(await p.$('.pl-modal [data-p=endnow]'));
  await click('[data-p=keep]'); s = await st(); assert.strictEqual(s.prompt, false); assert.ok(!(await p.content()).includes('Workout complete</h2>'));
  await click('[data-st=workSec][data-d="5"]'); assert.strictEqual(await p.evaluate(() => window.__wbPlayer.results[2].workSec), 20); // still editable
  await click('[data-p=primary]'); assert.ok((await st()).prompt); await click('[data-p=endnow]');
  assert.ok((await p.content()).includes('Workout complete'));
  assert.strictEqual(await p.evaluate(() => window.__wbPlayer.done.results.length), 3);
  assert.deepStrictEqual(errs, []); console.log('TIMER OK'); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
