// Headless phone-size player test: node tests/player.test.js [url] [screenshotPath]
const assert = require('assert'); const M = require('../model.js'); const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/', SHOT = process.argv[3] || '/workspace/player-screenshot.png';
const w = M.newWorkout('Agility + Strength'); const mk = o => M.normalizeExercise(M.newExercise(o));
w.items = [
  mk({ name: 'Goblet squat', sets: 2, weight: { unit: 'lb', value: 135 }, mode: 'reps', modeConfig: { repsType: 'number', count: 10, restSec: 30 } }), // rest ignored (non-final)
  mk({ name: 'Plank', sets: 2, weight: { unit: 'bodyweight', value: null }, mode: 'timer', modeConfig: { workSec: 20, restSec: 15, repsType: null } }), // final: rest applies
  mk({ name: 'Bike sprints', sets: 2, weight: { unit: 'bodyweight', value: null }, mode: 'intervals', modeConfig: { workSec: 20, repsType: 'number', count: 15 } }),
  mk({ name: 'Jump rope', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'intervals', modeConfig: { workSec: 10, repsType: null } }),
  mk({ name: 'Kettlebell swings', sets: 1, weight: { unit: 'kg', value: 16 }, mode: 'timer', modeConfig: { workSec: 30, restSec: 10, repsType: 'range', min: 10, max: 15 } }),
  mk({ name: 'Cone shuttle', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'stopwatch', modeConfig: { lapsEnabled: true, lapCount: 3 } }),
  mk({ name: 'Dumbbell row', sets: 1, weight: { unit: 'kg', value: 22.5 }, mode: 'reps', modeConfig: { repsType: 'range', min: 8, max: 12, restSec: 60 } }),
];
M.linkSuperset(w, [w.items[0].id, w.items[1].id]);
const data = M.emptyData(); data.workouts.push(w);
(async () => {
  const b = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage(); await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await require('./allow.js')(p);
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(URL); await p.evaluate((k, v) => localStorage.setItem(k, v), M.STORAGE_KEY, JSON.stringify(data));
  await p.goto(URL + '#/w/' + w.id); await p.reload(); await p.waitForSelector('[data-a=play]');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const click = async s => { await p.click(s); await wait(80); };
  const adv = async ms => { await p.evaluate(ms => { window.__wbClockOffset = (window.__wbClockOffset || 0) + ms; }, ms); await wait(150); };
  const st = () => p.evaluate(() => { const S = window.__wbPlayer; const on = document.querySelector('.pl-info .pl-name') || document.querySelector('.pl-name');
    return { idx: S.idx, phase: S.phase, rep: S.rep, beeps: S.beeps || 0, name: on && on.textContent,
    track: document.querySelector('.pl-th b') && document.querySelector('.pl-th b').textContent, ro: document.getElementById('ro') && document.getElementById('ro').textContent, results: S.results }; });
  await click('[data-a=play]');
  let s = await st(); assert.strictEqual(s.name, 'Goblet squat'); assert.ok((await p.$eval('.pl-info .pl-meta', e => e.textContent)).includes('Set 1 of 2'));
  assert.strictEqual(await p.$eval('.pl-ss-extra .pl-name', e => e.textContent), 'Plank'); // partner below media, not stacked inside
  assert.ok(await p.$('.pl-ss-extra .dim')); // inactive partner is grey in every mode, including reps
  assert.ok(await p.$('.pl-chain')); // chain between supersetted carousel items
  assert.strictEqual(await p.$$eval('.pl-ci', a => a[1].querySelector('b').textContent), 'Plank'); // A1 -> B1 order
  assert.strictEqual(await p.$$eval('.pl-ci', a => a.length), 10); assert.strictEqual(await p.$eval('.pl-ci', e => e.classList.contains('cur')), true);
  assert.strictEqual(await p.$$eval('.pl-ctl,.pl-go', a => a.length), 0); assert.ok(await p.$('.pl-endw')); assert.strictEqual(await p.$eval('.pl-hint', e => e.textContent), 'Tap for next');
  await wait(400); await p.screenshot({ path: '/workspace/player-superset-v3.png' }); await p.screenshot({ path: '/workspace/player-superset.png' });
  await click('[data-sel="1"]'); assert.strictEqual((await st()).name, 'Plank'); // carousel tap jumps
  assert.ok((await p.$eval('.pl-ss-extra .pl-name', e => e.textContent)).includes('Goblet'));
  assert.ok((await p.$eval('.pl-ss-extra .pl-ss-pane', e => e.className)).includes('dim')); // timer current -> partner dim
  await p.evaluate(() => [...document.querySelectorAll('.pl-li')].find(e => e.textContent.includes('Goblet')).click()); await wait(80); assert.strictEqual((await st()).idx, 0);
  // edit tracking bar: reps +2, weight typed 140
  await click('[data-st=reps][data-d="1"]'); await click('[data-st=reps][data-d="1"]');
  await p.$eval('[data-f=weight]', e => e.value = ''); await p.type('[data-f=weight]', '140');
  await click('[data-p=primary]'); s = await st();
  // Goblet is non-final: no rest, logs on advance to Plank
  assert.strictEqual(s.idx, 1); assert.strictEqual(s.name, 'Plank'); assert.ok(s.results[0].logged);
  assert.deepStrictEqual([s.results[0].reps, s.results[0].weight], [12, 140]);
  assert.ok(await p.$('.pl-ci.done .pl-ck')); // Goblet logged in carousel
  // Plank (final): standoff -> work -> rest 15 with Up next
  await click('[data-p=primary]'); s = await st(); assert.strictEqual(s.phase, 'standoff'); assert.strictEqual(s.ro, '0:05');
  assert.ok((await p.evaluate(() => window.__wbPlayer.pending.map(x => x.t + x.kind[0]).join(' '))).includes('5g'));
  await adv(5100); assert.strictEqual((await st()).phase, 'work'); await adv(10000); assert.strictEqual((await st()).ro, '0:10');
  await adv(10100); s = await st(); assert.strictEqual(s.phase, 'rest'); assert.ok(s.results[1].logged); assert.ok(s.results[0].logged); assert.strictEqual(s.ro, '0:15');
  assert.strictEqual(await p.$eval('.pl-up-n', e => e.textContent), 'Goblet squat'); // Up next below Rest chip
  assert.ok((await p.$eval('.pl-up-i', e => e.textContent)).includes('135 lb') || (await p.$eval('.pl-up-i', e => e.textContent)).includes('Set 2'));
  assert.strictEqual(await p.$$eval('.pl-track-g', a => a.length), 2); // stacked tracking during shared rest
  assert.strictEqual(await p.$$eval('.pl-ok', a => a.length), 2); // both sets logged when shared rest starts
  await wait(400); await p.screenshot({ path: '/workspace/player-rest-upnext.png' });
  await adv(15100); s = await st(); assert.strictEqual(s.idx, 2); assert.ok(s.results[0].logged); assert.ok(s.results[1].logged);
  assert.strictEqual(s.name, 'Goblet squat'); // A2
  // A2 tap: non-final logs now and jumps to B2
  await click('[data-p=primary]'); s = await st(); assert.strictEqual(s.idx, 3); assert.ok(s.results[2].logged);
  // carousel keeps every set; round-1 + A2 logged
  assert.strictEqual(await p.$$eval('.pl-ci', a => a.length), 10); assert.strictEqual(await p.$$eval('.pl-ci.done .pl-ck', a => a.length), 3);
  await wait(400); await p.screenshot({ path: '/workspace/player-carousel.png' });
  await click('[data-sel="0"]'); s = await st(); assert.strictEqual(s.idx, 0);
  assert.strictEqual(await p.$eval('[data-f=reps]', e => e.value), '12'); assert.strictEqual(await p.$eval('[data-f=weight]', e => e.value), '140');
  assert.strictEqual(await p.$eval('.pl-hint', e => e.textContent), 'Logged · tap to redo'); // round 1 logged
  await click('[data-st=reps][data-d="-1"]'); assert.strictEqual((await st()).results[0].reps, 11); assert.ok((await st()).results[0].logged);
  await click('[data-sel="1"]'); await click('[data-sel="0"]'); assert.strictEqual(await p.$eval('[data-f=reps]', e => e.value), '11'); // edit kept
  // B2 via carousel, finish Plank (final of round 2) with its rest; A2 already logged from tap
  await click('[data-sel="3"]');
  await click('[data-p=primary]'); await adv(5100); await adv(20100); s = await st(); assert.strictEqual(s.phase, 'rest');
  assert.ok(s.results[2].logged); assert.ok(s.results[3].logged); // final logs when shared rest starts
  await adv(15100); s = await st(); assert.ok(s.results[2].logged); assert.ok(s.results[3].logged);
  assert.strictEqual(s.idx, 4); assert.strictEqual(s.name, 'Bike sprints');
  // intervals: ready shows mm:ss; carousel says Interval; Start -> 5s standoff -> auto-run all intervals -> stop
  assert.ok((await p.$eval('.pl-meta', e => e.textContent)).includes('Interval 1 of 2')); assert.ok((await p.$eval('.pl-meta', e => e.textContent)).includes('15 reps'));
  assert.ok((await p.$eval('.pl-th', e => e.textContent)).includes('Interval 1/2'));
  assert.deepStrictEqual(await p.$$eval('.pl-meta div', a => a.map(d => d.textContent)), ['Bodyweight · 15 reps · 0:20 Interval 1 of 2']);
  assert.strictEqual(await p.$eval('.pl-chip', e => e.textContent), 'Interval');
  await p.screenshot({ path: '/workspace/player-v2.png' });
  assert.strictEqual((await st()).ro, '0:20'); assert.strictEqual(await p.$$eval('.pl-ci', a => a[5].querySelector('span').textContent), 'Interval 2 of 2');
  const sched = await p.evaluate(() => WBPlayer.toneSchedule(20, 2));
  assert.deepStrictEqual(sched.map(x => x.t + x.kind[0]).join(' '), '0t 1t 2t 3t 4t 5g 22t 23t 24t 25g 42t 43t 44t 45d');
  await click('[data-st=reps][data-d="-1"]'); await click('[data-p=primary]'); s = await st();
  assert.strictEqual(s.phase, 'standoff'); assert.strictEqual(s.ro, '0:05');
  assert.deepStrictEqual(await p.evaluate(() => window.__wbPlayer.pending.length), 14);
  await adv(2000); assert.strictEqual((await st()).ro, '0:03');
  await click('[data-p=primary]'); assert.strictEqual(await p.evaluate(() => window.__wbPlayer.nodes.length), 0); // pause cancels tones
  await adv(30000); await click('[data-p=primary]'); assert.strictEqual(await p.evaluate(() => window.__wbPlayer.pending[0].t), 3); // resume reschedules remaining
  await adv(3100); s = await st(); assert.strictEqual(s.phase, 'work'); assert.strictEqual(s.idx, 4);
  await adv(10000); assert.strictEqual((await st()).ro, '0:10');
  await adv(10000); s = await st(); assert.strictEqual(s.idx, 5); assert.strictEqual(s.phase, 'work'); // auto-advanced, no tap
  assert.ok(s.results[4].logged); assert.strictEqual(s.results[4].reps, 14); assert.ok((await p.$eval('.pl-meta', e => e.textContent)).includes('Interval 2 of 2'));
  await adv(20100); s = await st(); assert.strictEqual(s.idx, 6); assert.ok(s.results[5].logged); assert.strictEqual(s.name, 'Jump rope');
  await adv(15000); s = await st(); assert.strictEqual(s.phase, 'ready'); assert.strictEqual(s.ro, '0:10'); // next interval exercise does NOT auto-start
  await click('[data-p=primary]'); assert.strictEqual((await st()).phase, 'standoff'); await adv(5100); await adv(10100);
  s = await st(); assert.ok(s.results[6].logged); assert.strictEqual(s.idx, 7);
  // timer: work then rest
  assert.strictEqual(s.results[7].reps, 15); await p.$eval('[data-f=reps]', e => e.value = ''); await p.type('[data-f=reps]', '11');
  await click('[data-p=primary]'); assert.strictEqual(await p.evaluate(() => window.__wbPlayer.pending.map(x => x.t + x.kind[0]).join(' ')), '0t 1t 2t 3t 4t 5g 32t 33t 34t 35g 42t 43t 44t 45d');
  await adv(5100); await wait(300); await p.screenshot({ path: '/workspace/player-media-v3.png' }); await adv(30050); s = await st(); assert.strictEqual(s.phase, 'rest'); assert.ok(s.results[7].logged); assert.strictEqual(s.results[7].reps, 11); assert.strictEqual(s.track, 'Kettlebell swings');
  await adv(10000); s = await st(); assert.strictEqual(s.name, 'Cone shuttle'); assert.ok(s.results[7].logged);
  // stopwatch with laps
  await click('[data-p=primary]'); await adv(3210); await click('[data-p=primary]'); await adv(2540); await click('[data-p=primary]'); await adv(1234);
  await p.screenshot({ path: SHOT });
  s = await st(); assert.ok(/^00:0[6-8]\.\d\d$/.test(s.ro), s.ro); assert.strictEqual(s.results[8].laps.length, 2);
  await adv(3000); await click('[data-p=primary]'); s = await st();
  assert.strictEqual(s.phase, 'complete'); assert.strictEqual(s.results[8].laps.length, 3); assert.ok(s.results[8].logged);
  const laps = s.results[8].laps; assert.ok(Math.abs(laps[0].lapMs - 3210) < 800 && Math.abs(laps[1].lapMs - 2540) < 800, JSON.stringify(laps));
  assert.strictEqual(await p.$$eval('.pl-laps span', a => a.length), 3);
  await click('[data-p=primary]'); s = await st(); assert.strictEqual(s.name, 'Dumbbell row');
  await click('[data-p=primary]'); s = await st(); assert.strictEqual(s.phase, 'rest'); assert.ok(s.results[9].logged); // reps set logs when rest starts
  await click('[data-st=reps][data-d="1"]'); assert.strictEqual((await st()).results[9].reps, 13); assert.strictEqual((await st()).phase, 'rest');
  await adv(10000); await click('.pl-endw'); await wait(100); // End during rest keeps the already-logged set
  assert.ok((await p.content()).includes('Workout complete'));
  const saved = await p.evaluate(k => JSON.parse(localStorage.getItem(k)), M.STORAGE_KEY);
  assert.strictEqual(saved.sessions.length, 0); assert.strictEqual(saved.workouts.length, 1); // SAVE_SESSIONS=false
  const r = await p.evaluate(() => window.__wbPlayer.done.results);
  assert.strictEqual(r.length, 10); assert.strictEqual(r[0].reps, 11); assert.strictEqual(r[0].weight, 140); assert.strictEqual(r[8].laps.length, 3); assert.strictEqual(r[9].reps, 13);
  console.log('session results:', r.map(x => x.name + '#' + x.set).join(', '));
  assert.deepStrictEqual(errs, []); console.log('PLAYER OK'); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
