// Headless phone-size player test: node tests/player.test.js [url] [screenshotPath]
const assert = require('assert'); const M = require('../model.js'); const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/', SHOT = process.argv[3] || '/workspace/player-screenshot.png';
const w = M.newWorkout('Agility + Strength'); const mk = o => M.normalizeExercise(M.newExercise(o));
w.items = [
  mk({ name: 'Goblet squat', sets: 2, weight: { unit: 'lb', value: 135 }, mode: 'reps', modeConfig: { repsType: 'number', count: 10, restSec: 30 } }),
  mk({ name: 'Plank', sets: 2, weight: { unit: 'bodyweight', value: null }, mode: 'timer', modeConfig: { workSec: 20, restSec: 0, repsType: null } }),
  mk({ name: 'Bike sprints', sets: 2, weight: { unit: 'bodyweight', value: null }, mode: 'intervals', modeConfig: { workSec: 20, repsType: 'number', count: 15 } }),
  mk({ name: 'Kettlebell swings', sets: 1, weight: { unit: 'kg', value: 16 }, mode: 'timer', modeConfig: { workSec: 30, restSec: 10, repsType: 'range', min: 10, max: 15 } }),
  mk({ name: 'Cone shuttle', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'stopwatch', modeConfig: { lapsEnabled: true, lapCount: 3 } }),
  mk({ name: 'Dumbbell row', sets: 1, weight: { unit: 'kg', value: 22.5 }, mode: 'reps', modeConfig: { repsType: 'range', min: 8, max: 12, restSec: 60 } }),
];
M.linkSuperset(w, [w.items[0].id, w.items[1].id]);
const data = M.emptyData(); data.workouts.push(w);
(async () => {
  const b = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage(); await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(URL); await p.evaluate((k, v) => localStorage.setItem(k, v), M.STORAGE_KEY, JSON.stringify(data));
  await p.goto(URL + '#/w/' + w.id); await p.reload(); await p.waitForSelector('[data-a=play]');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const click = async s => { await p.click(s); await wait(80); };
  const adv = async ms => { await p.evaluate(ms => { window.__wbClockOffset = (window.__wbClockOffset || 0) + ms; }, ms); await wait(150); };
  const st = () => p.evaluate(() => { const S = window.__wbPlayer; return { idx: S.idx, phase: S.phase, rep: S.rep, beeps: S.beeps || 0, name: document.querySelector('.pl-name') && document.querySelector('.pl-name').textContent,
    track: document.querySelector('.pl-th b') && document.querySelector('.pl-th b').textContent, ro: document.getElementById('ro') && document.getElementById('ro').textContent, results: S.results }; });
  await click('[data-a=play]');
  let s = await st(); assert.strictEqual(s.name, 'Goblet squat'); assert.ok((await p.$eval('.pl-meta', e => e.textContent)).includes('Set 1 of 2'));
  assert.strictEqual(await p.$eval('.pl-ci b', e => e.textContent), 'Plank'); // superset rotation A1 -> B1
  // edit tracking bar: reps +2, weight typed 140
  await click('[data-st=reps][data-d="1"]'); await click('[data-st=reps][data-d="1"]');
  await p.$eval('[data-f=weight]', e => e.value = ''); await p.type('[data-f=weight]', '140');
  await click('[data-p=primary]'); s = await st();
  assert.strictEqual(s.phase, 'rest'); assert.strictEqual(s.track, 'Goblet squat'); assert.strictEqual(s.ro, '0:30'); // bar stays with exercise during rest
  assert.deepStrictEqual([s.results[0].reps, s.results[0].weight, s.results[0].logged], [12, 140, true]);
  await adv(15000); assert.strictEqual((await st()).ro, '0:15');
  await adv(15100); s = await st(); assert.strictEqual(s.name, 'Plank'); assert.ok(s.beeps >= 1);       // rest ended -> B1
  await click('[data-p=primary]'); await adv(10000); assert.strictEqual((await st()).ro, '0:10');  // timer static hold counts down
  await adv(10100); s = await st(); assert.ok(s.results[1].logged); assert.strictEqual(s.results[1].reps, undefined); assert.ok(!(await p.$$('[data-f=reps]')).length || s.idx !== 1); assert.strictEqual(s.idx, 2); // no rest -> A2
  // pause/resume during rest keeps time
  await click('[data-p=primary]'); await adv(5000); await click('[data-p=pause]'); await adv(60000); assert.strictEqual((await st()).ro, '0:25'); await click('[data-p=pause]');
  // select another exercise from the summary list mid-rest
  await p.evaluate(() => [...document.querySelectorAll('.pl-li')].find(e => e.textContent.includes('Dumbbell row')).click()); await wait(80);
  s = await st(); assert.strictEqual(s.idx, 8); assert.strictEqual(s.track, 'Dumbbell row'); assert.strictEqual(s.results[8].reps, 12);
  await p.evaluate(() => [...document.querySelectorAll('.pl-li')].find(e => e.textContent.includes('Plank')).click()); await wait(80);
  s = await st(); assert.strictEqual(s.idx, 3); // first unlogged Plank set (B2)
  await click('[data-p=primary]'); await adv(20100); s = await st(); assert.strictEqual(s.idx, 4); assert.strictEqual(s.name, 'Bike sprints');
  // intervals: 2 intervals x 0:20, 15 reps each, no rest; 'Interval X of N' label; reps editable
  assert.ok((await p.$eval('.pl-meta', e => e.textContent)).includes('Interval 1 of 2')); assert.ok((await p.$eval('.pl-meta', e => e.textContent)).includes('15 reps'));
  assert.ok((await p.$eval('.pl-th', e => e.textContent)).includes('Interval 1/2'));
  await click('[data-st=reps][data-d="-1"]'); await click('[data-p=primary]'); await adv(10000); assert.strictEqual((await st()).ro, '0:10');
  await adv(10100); s = await st(); assert.strictEqual(s.idx, 5); assert.ok(s.results[4].logged); assert.strictEqual(s.results[4].reps, 14);
  assert.ok((await p.$eval('.pl-meta', e => e.textContent)).includes('Interval 2 of 2'));
  await click('[data-p=primary]'); await adv(20100); s = await st(); assert.strictEqual(s.idx, 6); assert.ok(s.results[5].logged);
  // timer: work then rest
  assert.strictEqual(s.results[6].reps, 15); await p.$eval('[data-f=reps]', e => e.value = ''); await p.type('[data-f=reps]', '11');
  await click('[data-p=primary]'); await adv(30050); s = await st(); assert.strictEqual(s.phase, 'rest'); assert.ok(s.results[6].logged); assert.strictEqual(s.results[6].reps, 11); assert.strictEqual(s.track, 'Kettlebell swings');
  await adv(10000); s = await st(); assert.strictEqual(s.name, 'Cone shuttle');
  // stopwatch with laps
  await click('[data-p=primary]'); await adv(3210); await click('[data-p=primary]'); await adv(2540); await click('[data-p=primary]'); await adv(1234);
  await p.screenshot({ path: SHOT });
  s = await st(); assert.ok(/^00:0[6-8]\.\d\d$/.test(s.ro), s.ro); assert.strictEqual(s.results[7].laps.length, 2);
  await adv(3000); await click('[data-p=primary]'); s = await st();
  assert.strictEqual(s.phase, 'complete'); assert.strictEqual(s.results[7].laps.length, 3); assert.ok(s.results[7].logged);
  const laps = s.results[7].laps; assert.ok(Math.abs(laps[0].lapMs - 3210) < 800 && Math.abs(laps[1].lapMs - 2540) < 800, JSON.stringify(laps));
  assert.strictEqual(await p.$$eval('.pl-laps span', a => a.length), 3);
  await click('[data-p=primary]'); s = await st(); assert.strictEqual(s.name, 'Dumbbell row');
  await click('[data-p=primary]'); // last set -> finish
  assert.ok((await p.content()).includes('Workout complete'));
  const saved = await p.evaluate(k => JSON.parse(localStorage.getItem(k)), M.STORAGE_KEY);
  assert.strictEqual(saved.sessions.length, 0); assert.strictEqual(saved.workouts.length, 1); // SAVE_SESSIONS=false
  const r = await p.evaluate(() => window.__wbPlayer.done.results);
  assert.strictEqual(r.length, 9); assert.strictEqual(r[0].reps, 12); assert.strictEqual(r[0].weight, 140); assert.strictEqual(r[7].laps.length, 3);
  console.log('session results:', r.map(x => x.name + '#' + x.set).join(', '));
  assert.deepStrictEqual(errs, []); console.log('PLAYER OK'); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
