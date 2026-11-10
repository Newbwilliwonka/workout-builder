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
  await require('./allow.js')(p);
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(URL); await p.evaluate((k, v) => localStorage.setItem(k, v), M.STORAGE_KEY, JSON.stringify(data));
  await p.goto(URL + '#/w/' + w.id); await p.reload(); await p.waitForSelector('[data-a=play]');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // Builder: chain icon, no A/B letters
  assert.ok(await p.$('.ss-head .chain-ico')); assert.ok(await p.$('.ss-chain .chain-ico'));
  assert.ok(!(await p.$('.badge')));
  assert.ok(!(await p.$eval('.ss-head', e => e.textContent)).match(/\b[A-Z]\b.*Superset/) && !(await p.$('.badge')));
  assert.ok((await p.content()).includes('Tick 2 exercises'));
  await wait(300); await p.screenshot({ path: '/workspace/builder-chain.png' });
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
  assert.ok(await p.$('.pl-list .pl-chain')); assert.ok(!(await p.$('.pl-li em')));
  assert.strictEqual(await p.$eval('.pl-hint', e => e.textContent), 'Tap for next');
  // layout: one info frame for the current exercise, under the media
  assert.strictEqual(await p.$eval('.pl-info .pl-name', e => e.textContent), 'Curl');
  assert.strictEqual(await p.$$eval('.pl-info', a => a.length), 1);
  assert.strictEqual(await p.$('.pl-ss-extra'), null);
  assert.ok(!/Set \d+ of/.test(await p.$eval('.pl-info', e => e.textContent)));
  assert.strictEqual(await p.$eval('.pl-chip', e => e.textContent), '10 Reps');
  await click('[data-p=primary]'); // Curl 1 -> logs Curl, starts Press
  let s = await p.evaluate(() => ({ idx: window.__wbPlayer.idx, logged0: window.__wbPlayer.results[0].logged, phase: window.__wbPlayer.phase, name: document.querySelector('.pl-info .pl-name').textContent }));
  assert.deepStrictEqual(s, { idx: 1, logged0: true, phase: 'work', name: 'Press' }); // previous logged on advance
  assert.strictEqual(await p.$$eval('.pl-info .pl-name', a => a.map(e => e.textContent).join('|')), 'Press');
  assert.strictEqual(await p.$('.pl-ss-extra'), null);
  assert.strictEqual(await p.evaluate(() => getComputedStyle(document.querySelector('.pl-info')).opacity), '1');
  await click('[data-p=primary]'); s = await p.evaluate(() => ({ phase: window.__wbPlayer.phase, ro: document.getElementById('ro').textContent, logged0: window.__wbPlayer.results[0].logged, logged1: !!window.__wbPlayer.results[1]?.logged }));
  assert.strictEqual(s.phase, 'rest'); assert.strictEqual(s.ro, '0:20'); assert.ok(s.logged0); assert.ok(s.logged1); // Press logs when shared rest starts
  assert.strictEqual(await p.$$eval('.pl-ok', a => a.length), 2);
  assert.strictEqual(await p.$('.pl-up'), null);
  assert.strictEqual(await p.$eval('.pl-info .pl-name', e => e.textContent), 'Curl'); // frame switches to the next exercise
  assert.ok(await p.$('#rest-veil'));
  assert.strictEqual(await p.$('.pl-screen.is-rest .pl-media'), null);
  assert.strictEqual(await p.$$eval('.pl-track-g', a => a.length), 2);
  await adv(20100);
  s = await p.evaluate(() => ({ idx: window.__wbPlayer.idx, logged0: window.__wbPlayer.results[0].logged, logged1: window.__wbPlayer.results[1].logged, name: document.querySelector('.pl-info .pl-name').textContent }));
  assert.deepStrictEqual([s.idx, s.logged0, s.logged1, s.name], [2, true, true, 'Curl']); // final logged on rest end
  // End mid-round before rest: started/unlogged members get logged
  await click('[data-p=primary]'); // Curl set 2 -> logs Curl#2, on Press set 2
  s = await p.evaluate(() => ({ idx: window.__wbPlayer.idx, logged2: window.__wbPlayer.results[2].logged, logged3: !!(window.__wbPlayer.results[3] && window.__wbPlayer.results[3].logged), phase: window.__wbPlayer.phase }));
  assert.strictEqual(s.idx, 3); assert.ok(s.logged2); assert.ok(!s.logged3); assert.strictEqual(s.phase, 'work');
  await click('.pl-endw'); await wait(120);
  s = await p.evaluate(() => ({ logged2: window.__wbPlayer.done.results.some(r => r.name === 'Curl' && r.set === 2), logged3: window.__wbPlayer.done.results.some(r => r.name === 'Press' && r.set === 2), n: window.__wbPlayer.done.results.length }));
  assert.ok(s.logged2); assert.ok(s.logged3); // Press was started → logged on End
  assert.deepStrictEqual(errs, []); console.log('SUPERSET OK'); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
