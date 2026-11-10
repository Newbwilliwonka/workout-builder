// 3+ member supersets: builder link/merge, player rotation, rest, tracking order, and the gap above the workout list.
// node tests/superset-size.test.js [url]
const assert = require('assert'); const M = require('../model.js'); const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const mk = o => M.normalizeExercise(M.newExercise(o));
function ex(name, sets, rest, count) {
  return mk({ name: name, sets: sets, weight: { unit: 'lb', value: 20 + count }, mode: 'reps', modeConfig: { repsType: 'number', count: count, restSec: rest } });
}
const pair = M.newWorkout('Pair');
pair.items = [ex('A Curl', 2, 45, 10), ex('B Press', 2, 10, 8)];
M.linkSuperset(pair, pair.items.map(i => i.id));
const solo = M.newWorkout('Solo');
solo.items = [ex('Solo curl', 1, 10, 10)];
const triple = M.newWorkout('Triple');
triple.items = [ex('A Curl', 2, 45, 10), ex('B Press', 2, 20, 8), ex('C Row', 1, 12, 6)];
const quad = M.newWorkout('Quad');
quad.items = [ex('A Curl', 2, 40, 10), ex('B Press', 2, 30, 8), ex('C Row', 1, 25, 6), ex('D Fly', 2, 15, 4)];
const data = M.emptyData();
data.workouts.push(solo, pair, triple, quad);

(async () => {
  const b = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await require('./allow.js')(p);
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(URL);
  await p.evaluate((k, v) => localStorage.setItem(k, v), M.STORAGE_KEY, JSON.stringify(data));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const click = async s => { await p.click(s); await wait(80); };
  const adv = async ms => { await p.evaluate(ms => { window.__wbClockOffset = (window.__wbClockOffset || 0) + ms; }, ms); await wait(150); };
  async function open(id) {
    await p.goto(URL + '#/w/' + id); await p.reload(); await p.waitForSelector('[data-a=play]'); await wait(150);
  }
  async function tick(indexes) {
    for (const i of indexes) {
      const boxes = await p.$$('[data-sel]');
      await boxes[i].click();
      await wait(80);
    }
  }
  async function play() { await click('[data-a=play]'); await p.waitForSelector('.pl-screen'); await wait(80); }
  const state = () => p.evaluate(() => {
    const S = window.__wbPlayer, q = S.queue[S.idx];
    const ex = S.w.items.find(x => x.id === q.exerciseId);
    const info = document.querySelector('.pl-info .pl-name');
    return {
      idx: S.idx, phase: S.phase, current: ex.name, set: q.set,
      info: info && info.textContent, infos: document.querySelectorAll('.pl-info').length,
      ro: document.getElementById('ro') && document.getElementById('ro').textContent,
      logged: S.queue.map(function (_, i) { return !!(S.results[i] && S.results[i].logged); }),
      reps: S.queue.map(function (_, i) { return S.results[i] && S.results[i].reps; })
    };
  });
  async function gap() {
    return p.evaluate(() => {
      const title = document.querySelector('.pl-list .pl-car-h').getBoundingClientRect();
      const list = document.querySelector('.pl-list').getBoundingClientRect();
      const track = document.querySelector('.pl-track').getBoundingClientRect();
      const blocks = [...document.querySelectorAll('.pl-track-g')];
      const lastEl = blocks.length ? blocks[blocks.length - 1] : document.querySelector('.pl-track .pl-fields');
      const last = lastEl.getBoundingClientRect();
      const rounds = blocks.map((g, i) => {
        const box = g.getBoundingClientRect();
        const prev = i ? blocks[i - 1].getBoundingClientRect() : null;
        return { top: box.top, bottom: box.bottom, overlap: !!(prev && box.top < prev.bottom - 0.5) };
      });
      return {
        names: blocks.map(g => g.querySelector('b').textContent),
        blockToTitle: Math.round((title.top - last.bottom) * 10) / 10,
        trackToList: Math.round((list.top - track.bottom) * 10) / 10,
        trackPadBottom: getComputedStyle(document.querySelector('.pl-track')).paddingBottom,
        lastMarginBottom: getComputedStyle(lastEl).marginBottom,
        flexGap: getComputedStyle(document.querySelector('.pl')).gap,
        titleAboveLast: title.top + 0.5 < last.bottom,
        blockOverlap: rounds.some(r => r.overlap)
      };
    });
  }
  async function toRest(names) {
    for (let i = 0; i < names.length; i++) {
      let s = await state();
      assert.strictEqual(s.current, names[i], 'expected ' + names[i] + ' got ' + s.current);
      assert.strictEqual(s.phase, 'work');
      assert.strictEqual(s.infos, 1);
      assert.strictEqual(s.info, names[i]);
      assert.strictEqual(await p.$('.pl-ss-extra'), null);
      assert.strictEqual(await p.$('#rest-veil'), null);
      if (i < names.length - 1) assert.strictEqual(await p.$eval('.pl-hint', e => e.textContent), 'Tap for next');
      await click('[data-p=primary]');
      s = await state();
      assert.ok(s.logged[i], names[i] + ' should be logged');
      if (i < names.length - 1) {
        assert.strictEqual(s.phase, 'work'); // non-final: no rest
        assert.strictEqual(s.current, names[i + 1]);
      }
    }
    const s = await state();
    assert.strictEqual(s.phase, 'rest');
    assert.strictEqual(s.current, names[names.length - 1]);
    assert.strictEqual(s.infos, 1);
    assert.strictEqual(await p.$('.pl-ss-extra'), null);
    assert.ok(await p.$('#rest-veil'));
    assert.strictEqual(await p.$('.pl-screen.is-rest .pl-media'), null);
    names.forEach((n, i) => assert.ok(s.logged[i], n));
    return s;
  }

  // ---- baseline gap: one exercise, then a 2-exercise superset ----
  await open(solo.id); await play();
  await click('[data-p=primary]');
  let s = await state(); assert.strictEqual(s.phase, 'rest'); assert.strictEqual(s.ro, '0:10');
  const soloGap = await gap();
  assert.strictEqual(soloGap.names.length, 0);
  assert.strictEqual(soloGap.flexGap, '12px');
  assert.ok(Math.abs(soloGap.trackToList - 12) < 1, JSON.stringify(soloGap));
  assert.ok(soloGap.blockToTitle > 0, JSON.stringify(soloGap));

  await open(pair.id); await play();
  await toRest(['A Curl', 'B Press']);
  assert.strictEqual((await state()).ro, '0:10'); // final member's rest only
  assert.deepStrictEqual(await p.$$eval('.pl-track-g .pl-th b', a => a.map(e => e.textContent)), ['A Curl', 'B Press']);
  assert.strictEqual(await p.$$eval('.pl-ok', a => a.length), 2);
  assert.strictEqual(await p.$$eval('.pl-car .pl-chain', a => a.length), 2); // one link per round
  const pairGap = await gap();
  assert.strictEqual(pairGap.trackToList, soloGap.trackToList);
  assert.ok(Math.abs(pairGap.blockToTitle - soloGap.blockToTitle) < 1, JSON.stringify({ soloGap, pairGap }));
  assert.ok(!pairGap.blockOverlap && !pairGap.titleAboveLast);

  // ---- builder: 3 exercises, minimum of 2, then the player ----
  await open(triple.id);
  assert.ok((await p.content()).includes('Tick 2 or more exercises'));
  await tick([0]);
  assert.ok(await p.$eval('[data-a=link]', b => b.disabled));
  await tick([1, 2]);
  assert.ok(!(await p.$eval('[data-a=link]', b => b.disabled)));
  assert.ok((await p.$eval('[data-a=link]', b => b.textContent)).includes('(3)'));
  await click('[data-a=link]');
  assert.ok((await p.$eval('#toast', t => t.textContent)).includes('Superset linked'));
  assert.ok((await p.$eval('.ss-head', e => e.textContent)).includes('3 exercises'));
  assert.strictEqual(await p.$$eval('.ss', a => a.length), 1);
  assert.deepStrictEqual(await p.$$eval('.ss .name', a => a.map(e => e.textContent)), ['A Curl', 'B Press', 'C Row']);
  assert.strictEqual(await p.$$eval('.ss-chain', a => a.length), 2);
  await wait(2400); // let the link toast clear so the three exercises are unobstructed
  await p.screenshot({ path: '/opt/cursor/artifacts/builder_3_exercise_superset.png' });
  async function restOf(name, disabled) {
    await p.evaluate(n => [...document.querySelectorAll('.ss .card')].find(e => e.querySelector('.name').textContent === n).querySelector('[data-a=edit]').click(), name);
    await wait(100);
    assert.ok((await p.content()).includes('Only the final rest period will function'));
    assert.strictEqual(await p.$$eval('.time.is-off', a => a.length), disabled ? 1 : 0, name);
    await click('[data-a=cancel]');
  }
  await restOf('A Curl', true);
  await restOf('B Press', true);
  await restOf('C Row', false);
  await play();
  s = await toRest(['A Curl', 'B Press', 'C Row']);
  assert.strictEqual(s.ro, '0:12');
  assert.strictEqual(s.info, 'A Curl'); // single frame shows the next exercise, not a combined card
  assert.strictEqual(await p.$eval('.pl-ci.cur b', e => e.textContent), 'C Row');
  assert.deepStrictEqual(await p.$$eval('.pl-chip', a => a.map(e => e.textContent)), ['Rest', 'Superset']);
  assert.deepStrictEqual(await p.$$eval('.pl-track-g .pl-th b', a => a.map(e => e.textContent)), ['A Curl', 'B Press', 'C Row']);
  assert.strictEqual(await p.$$eval('.pl-track-g', a => a.length), 3);
  assert.strictEqual(await p.$$eval('.pl-ok', a => a.length), 3);
  assert.deepStrictEqual(await p.$eval('.pl-car', el => [...el.children].map(n => n.classList.contains('pl-chain') ? '·' : n.querySelector('b').textContent)),
    ['A Curl', '·', 'B Press', '·', 'C Row', 'A Curl', '·', 'B Press']);
  await p.evaluate(() => document.querySelectorAll('.pl-track-g')[2].querySelector('[data-st=reps][data-d="1"]').click());
  await wait(40);
  s = await state();
  assert.deepStrictEqual(s.reps.slice(0, 3), [10, 8, 7]); // edit stays on C Row
  const tripleGap = await gap();
  assert.deepStrictEqual(tripleGap.names, ['A Curl', 'B Press', 'C Row']);
  assert.strictEqual(tripleGap.trackToList, soloGap.trackToList);
  assert.ok(Math.abs(tripleGap.blockToTitle - soloGap.blockToTitle) < 1, JSON.stringify({ soloGap, tripleGap }));
  assert.ok(!tripleGap.blockOverlap && !tripleGap.titleAboveLast, JSON.stringify(tripleGap));
  await wait(800); // rest-start flash
  await p.screenshot({ path: '/opt/cursor/artifacts/player_3_exercise_superset_rest.png', fullPage: true });
  await adv(12100);
  s = await state();
  assert.strictEqual(s.idx, 3); assert.strictEqual(s.current, 'A Curl'); assert.strictEqual(s.set, 2); assert.strictEqual(s.phase, 'work');
  await click('[data-p=primary]'); await click('[data-p=primary]');
  s = await state();
  assert.strictEqual(s.phase, 'rest'); assert.strictEqual(s.ro, '0:20'); assert.strictEqual(s.current, 'B Press');
  assert.deepStrictEqual(await p.$$eval('.pl-track-g .pl-th b', a => a.map(e => e.textContent)), ['A Curl', 'B Press']); // C Row dropped out

  // ---- builder merge of two pairs into one group of 4, then the player ----
  await open(quad.id);
  await tick([0, 1]); await click('[data-a=link]');
  assert.strictEqual(await p.$$eval('.ss .card', a => a.length), 2);
  await tick([2, 3]); await click('[data-a=link]');
  assert.strictEqual(await p.$$eval('.ss', a => a.length), 2);
  await tick([0, 2]); // one member of each group
  assert.ok((await p.$eval('[data-a=link]', b => b.textContent)).includes('(2)'));
  await click('[data-a=link]');
  assert.strictEqual(await p.$$eval('.ss', a => a.length), 1);
  assert.ok((await p.$eval('.ss-head', e => e.textContent)).includes('4 exercises'));
  assert.deepStrictEqual(await p.$$eval('.ss .name', a => a.map(e => e.textContent)), ['A Curl', 'B Press', 'C Row', 'D Fly']);
  const stored = await p.evaluate(k => JSON.parse(localStorage.getItem(k)).workouts.find(w => w.name === 'Quad'), M.STORAGE_KEY);
  assert.strictEqual(new Set(stored.items.map(i => i.groupId)).size, 1);
  await play();
  s = await toRest(['A Curl', 'B Press', 'C Row', 'D Fly']);
  assert.strictEqual(s.ro, '0:15');
  assert.strictEqual(s.info, 'A Curl');
  assert.strictEqual(await p.$$eval('.pl-info', a => a.length), 1);
  assert.deepStrictEqual(await p.$$eval('.pl-track-g .pl-th b', a => a.map(e => e.textContent)), ['A Curl', 'B Press', 'C Row', 'D Fly']);
  assert.strictEqual(await p.$$eval('.pl-ok', a => a.length), 4);
  assert.deepStrictEqual(await p.$eval('.pl-car', el => [...el.children].map(n => n.classList.contains('pl-chain') ? '·' : n.querySelector('b').textContent + ' ' + n.querySelector('span').textContent)),
    ['A Curl Set 1/2', '·', 'B Press Set 1/2', '·', 'C Row Set 1/1', '·', 'D Fly Set 1/2', 'A Curl Set 2/2', '·', 'B Press Set 2/2', '·', 'D Fly Set 2/2']);
  await p.evaluate(() => document.querySelector('.pl-track-g [data-st=reps][data-d="1"]').click());
  await wait(40);
  s = await state();
  assert.strictEqual(s.reps[0], 11);
  assert.deepStrictEqual(s.reps.slice(1, 4), [8, 6, 4]);
  const quadGap = await gap();
  assert.deepStrictEqual(quadGap.names, ['A Curl', 'B Press', 'C Row', 'D Fly']);
  assert.strictEqual(quadGap.trackToList, soloGap.trackToList);
  assert.ok(Math.abs(quadGap.blockToTitle - soloGap.blockToTitle) < 1, JSON.stringify({ soloGap, quadGap }));
  assert.ok(!quadGap.blockOverlap && !quadGap.titleAboveLast, JSON.stringify(quadGap));
  console.log('GAP', JSON.stringify({ solo: soloGap, pair: pairGap, triple: tripleGap, quad: quadGap }));
  await p.evaluate(() => document.getElementById('toast').classList.remove('show'));
  await wait(800); // rest-start flash, and the builder toast from linking
  await p.screenshot({ path: '/opt/cursor/artifacts/player_4_exercise_superset_rest.png', fullPage: true });
  await adv(15100);
  s = await state();
  assert.strictEqual(s.current, 'A Curl'); assert.strictEqual(s.set, 2); assert.strictEqual(s.phase, 'work');
  await click('[data-p=primary]'); // A2 -> B2
  await click('[data-p=primary]'); // B2 -> D2, C dropped out
  s = await state();
  assert.strictEqual(s.phase, 'work'); assert.strictEqual(s.current, 'D Fly'); assert.strictEqual(s.set, 2);
  await click('[data-p=primary]');
  s = await state();
  assert.strictEqual(s.phase, 'rest'); assert.strictEqual(s.ro, '0:15');
  assert.deepStrictEqual(await p.$$eval('.pl-track-g .pl-th b', a => a.map(e => e.textContent)), ['A Curl', 'B Press', 'D Fly']);
  assert.deepStrictEqual(errs, []);
  console.log('SUPERSET SIZE OK');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
