// Superset rest skipping + builder disable: node tests/superset.test.js [url]
const assert = require('assert'); const M = require('../model.js'); const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const w = M.newWorkout('SS'); const mk = o => M.normalizeExercise(M.newExercise(o));
w.items = [
  mk({ name: 'Curl', sets: 2, weight: { unit: 'lb', value: 30 }, mode: 'reps', modeConfig: { repsType: 'number', count: 10, restSec: 45 } }),
  mk({ name: 'Press', sets: 2, weight: { unit: 'lb', value: 40 }, mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 20 } }),
];
M.linkSuperset(w, [w.items[0].id, w.items[1].id]);
const data = M.emptyData(); data.workouts.push(w);
(async () => {
  const b = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage(); await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(URL); await p.evaluate((k, v) => localStorage.setItem(k, v), M.STORAGE_KEY, JSON.stringify(data));
  await p.goto(URL + '#/w/' + w.id); await p.reload(); await p.waitForSelector('[data-a=play]');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const click = async s => { await p.click(s); await wait(80); };
  const adv = async ms => { await p.evaluate(ms => { window.__wbClockOffset = (window.__wbClockOffset || 0) + ms; }, ms); await wait(150); };
  // Builder: non-final rest disabled + warning
  await p.evaluate(() => [...document.querySelectorAll('.card')].find(e => e.querySelector('.name') && e.querySelector('.name').textContent === 'Curl').querySelector('[data-a=edit]').click());
  await wait(100);
  assert.ok((await p.content()).includes('Only the final rest period will function'));
  assert.ok(await p.$('.time.is-off input[disabled]'));
  await click('[data-a=cancel]');
  await p.evaluate(() => [...document.querySelectorAll('.card')].find(e => e.querySelector('.name') && e.querySelector('.name').textContent === 'Press').querySelector('[data-a=edit]').click());
  await wait(100);
  assert.ok((await p.content()).includes('Only the final rest period will function'));
  assert.strictEqual(await p.$$eval('.time.is-off', a => a.length), 0); // final member: rest editable
  await click('[data-a=cancel]');
  // Player: Curl (non-final) skips its 45s rest; Press (final) takes 20s rest
  await click('[data-a=play]');
  await click('[data-p=primary]'); // Curl 1
  let s = await p.evaluate(() => ({ idx: window.__wbPlayer.idx, logged: window.__wbPlayer.results[0].logged, phase: window.__wbPlayer.phase, name: document.querySelector('.pl-ss-pane.on .pl-name').textContent }));
  assert.deepStrictEqual(s, { idx: 1, logged: true, phase: 'work', name: 'Press' }); // skipped rest, now Press set 1
  await click('[data-p=primary]'); s = await p.evaluate(() => ({ phase: window.__wbPlayer.phase, ro: document.getElementById('ro').textContent, logged: !!window.__wbPlayer.results[1]?.logged }));
  assert.strictEqual(s.phase, 'rest'); assert.strictEqual(s.ro, '0:20'); assert.ok(!s.logged);
  assert.strictEqual(await p.$eval('.pl-up-n', e => e.textContent), 'Curl');
  assert.strictEqual(await p.$$eval('.pl-track-g', a => a.length), 2);
  await adv(20100);
  s = await p.evaluate(() => ({ idx: window.__wbPlayer.idx, logged: window.__wbPlayer.results[1].logged, name: document.querySelector('.pl-ss-pane.on .pl-name').textContent }));
  assert.deepStrictEqual([s.idx, s.logged, s.name], [2, true, 'Curl']);
  assert.deepStrictEqual(errs, []); console.log('SUPERSET OK'); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
