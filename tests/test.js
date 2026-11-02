const assert = require('assert'); const M = require('../model.js');
// ---- model tests ----
const mem = { s: {}, getItem(k) { return this.s[k] ?? null; }, setItem(k, v) { this.s[k] = String(v); } };
const d = M.emptyData(), w = M.newWorkout('All modes'); d.workouts.push(w);
const mk = o => M.newExercise(o);
const exs = [
  mk({ name: 'Squat', sets: 3, weight: { unit: 'lb', value: 135 }, mode: 'reps', modeConfig: { repsType: 'number', count: 10 } }),
  mk({ name: 'Row', sets: 4, weight: { unit: 'kg', value: 40.5 }, mode: 'reps', modeConfig: { repsType: 'range', min: 8, max: 12 } }),
  mk({ name: 'Plank', sets: 2, weight: { unit: 'bodyweight', value: 99 }, mode: 'reps', modeConfig: { repsType: 'static', count: 5 } }),
  mk({ name: 'Bike', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'intervals', modeConfig: { workSec: 30, repetitions: 8, restSec: 10 } }),
  mk({ name: 'Burpee', sets: 3, weight: { unit: 'bodyweight', value: null }, mode: 'timer', modeConfig: { workSec: 45, restSec: 15 } }),
  mk({ name: 'Cone drill', sets: 3, weight: { unit: 'bodyweight', value: null }, mode: 'stopwatch', modeConfig: { lapsEnabled: true } }),
];
exs.forEach(e => { assert.deepStrictEqual(M.validateExercise(e), [], e.name); M.upsertExercise(w, e); });
assert.strictEqual(w.items[2].weight.value, null); assert.ok(!('count' in w.items[2].modeConfig)); assert.ok(!('restSec' in w.items[3].modeConfig));
M.linkSuperset(w, [w.items[0].id, w.items[4].id]);  // non-adjacent -> made contiguous
assert.deepStrictEqual(w.items.map(x => x.name), ['Squat', 'Burpee', 'Row', 'Plank', 'Bike', 'Cone drill']);
assert.strictEqual(w.items[0].groupId, w.items[1].groupId);
M.save(mem, d); const r = M.load(mem); assert.deepStrictEqual(r, JSON.parse(JSON.stringify(d)));
const q = M.buildPlayQueue(r.workouts[0]).slice(0, 6).map(s => r.workouts[0].items.find(x => x.id === s.exerciseId).name + s.set);
assert.deepStrictEqual(q, ['Squat1', 'Burpee1', 'Squat2', 'Burpee2', 'Squat3', 'Burpee3']);
// validation
assert.ok(M.validateExercise(mk({ name: 'x', mode: 'reps', modeConfig: { repsType: 'range', min: 12, max: 8 } })).some(m => /less than/.test(m)));
assert.ok(M.validateExercise(mk({ name: 'x', sets: -1 })).length);
assert.ok(M.validateExercise(mk({ name: 'x', weight: { unit: 'kg', value: -5 } })).length);
// reorder: move standalone 'Row' up jumps over whole superset
M.moveExercise(w, w.items[2].id, -1); assert.deepStrictEqual(w.items.map(x => x.name).slice(0, 3), ['Row', 'Squat', 'Burpee']);
// delete one superset member -> group dissolves
M.deleteExercise(w, w.items[1].id); assert.strictEqual(w.items.find(x => x.name === 'Burpee').groupId, null);
// duplicate gets fresh ids
const dup = M.duplicateWorkout(w); assert.notStrictEqual(dup.items[0].id, w.items[0].id);
console.log('MODEL OK');

// ---- browser UI test ----
(async () => {
  const pp = require('puppeteer-core');
  const b = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const p = await b.newPage(); await p.setViewport({ width: 390, height: 844, isMobile: true });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', dl => dl.type() === 'prompt' ? dl.accept('UI Test') : dl.accept());
  await p.goto(process.argv[2] || 'http://127.0.0.1:8787/');
  const click = async sel => { await p.click(sel); await new Promise(r => setTimeout(r, 60)); };
  const type = async (b, v) => { await p.$eval(`[data-b="${b}"]`, el => el.value = ''); await p.type(`[data-b="${b}"]`, v); };
  await click('[data-a=new]');
  const add = async (fn) => { await click('[data-a=add]'); await fn(); await click('[data-a=save]'); };
  await add(async () => { await type('name', 'Squat'); await type('wval', '135'); await type('cfg.count', '10'); });
  await add(async () => { await type('name', 'Row'); await click('[data-v=kg]'); await type('wval', '40'); await click('[data-v=range]'); await type('cfg.min', '8'); await type('cfg.max', '12'); });
  await add(async () => { await type('name', 'Plank'); await click('[data-v=bodyweight]'); await click('[data-v=static]'); });
  await add(async () => { await type('name', 'Bike'); await click('[data-v=intervals]'); await type('cfg.wm', '0'); await type('cfg.ws', '30'); await type('cfg.repetitions', '8'); });
  await add(async () => { await type('name', 'Burpee'); await click('[data-v=timer]'); await type('cfg.wm', '1'); await type('cfg.ws', '0'); await type('cfg.rm', '0'); await type('cfg.rs', '20'); });
  await add(async () => { await type('name', 'Cone drill'); await click('[data-v=stopwatch]'); });
  // validation: range min > max should block save
  await click('[data-a=add]'); await type('name', 'Bad'); await click('[data-v=range]'); await type('cfg.min', '12'); await type('cfg.max', '8'); await click('[data-a=save]');
  const e1 = await p.$eval('#errs', el => el.textContent); assert.ok(/less than or equal/.test(e1), e1);
  await type('cfg.min', '-3'); await click('[data-a=save]'); assert.ok(/negative/.test(await p.$eval('#errs', el => el.textContent)));
  await click('[data-a=cancel]');
  const sels = await p.$$('[data-sel]'); await sels[0].click(); await new Promise(r => setTimeout(r, 60));
  await (await p.$$('[data-sel]'))[1].click(); await new Promise(r => setTimeout(r, 60));
  await click('[data-a=link]');
  assert.strictEqual(await p.$$eval('.ss .card', a => a.length), 2);
  await p.reload(); await new Promise(r => setTimeout(r, 200));
  const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('wb.data.v1')));
  const ws = stored.workouts[0]; console.log(ws.items.map(x => x.name + ' | ' + JSON.stringify(x.weight) + ' | ' + x.mode + ' ' + JSON.stringify(x.modeConfig) + ' | grp=' + !!x.groupId).join('\n'));
  assert.strictEqual(ws.items.length, 6); assert.strictEqual(await p.$$eval('.ss .card', a => a.length), 2);
  assert.ok(await p.$eval('.dock button:last-child', b => b.disabled));
  await p.screenshot({ path: '/tmp/wbtest/shot.png' });
  assert.deepStrictEqual(errs, []); console.log('UI OK'); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
