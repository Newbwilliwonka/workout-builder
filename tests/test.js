const assert = require('assert'); const M = require('../model.js');
// ---- model tests ----
const mem = { s: {}, getItem(k) { return this.s[k] ?? null; }, setItem(k, v) { this.s[k] = String(v); } };
const d = M.emptyData(), w = M.newWorkout('All modes'); d.workouts.push(w);
const mk = o => M.newExercise(o);
const exs = [
  mk({ name: 'Squat', sets: 3, weight: { unit: 'lb', value: 135 }, mode: 'reps', modeConfig: { repsType: 'number', count: 10 } }),
  mk({ name: 'Row', sets: 4, weight: { unit: 'kg', value: 40.5 }, mode: 'reps', modeConfig: { repsType: 'range', min: 8, max: 12 } }),
  mk({ name: 'Plank', sets: 2, weight: { unit: 'bodyweight', value: 99 }, mode: 'timer', modeConfig: { workSec: 30, restSec: 0, repsType: 'static', count: 5 } }),
  mk({ name: 'Bike', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'intervals', modeConfig: { workSec: 30, repetitions: 8, restSec: 10, repsType: 'number', count: 12 } }),
  mk({ name: 'Burpee', sets: 3, weight: { unit: 'bodyweight', value: null }, mode: 'timer', modeConfig: { workSec: 45, restSec: 15, repsType: 'static' } }),
  mk({ name: 'Cone drill', sets: 3, weight: { unit: 'bodyweight', value: null }, mode: 'stopwatch', modeConfig: { lapsEnabled: true, lapCount: 3 } }),
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
// v2: stopwatch format, rest, laps, migration
const F = M.formatStopwatch;
assert.strictEqual(F(0), '00:00.00'); assert.strictEqual(F(1234.9), '00:01.23'); assert.strictEqual(F(61010), '01:01.01');
assert.strictEqual(F(5999990), '99:59.99'); assert.strictEqual(F(9e9), '99:59.99'); assert.strictEqual(F(-5), '00:00.00');
const t0 = 1000.25; assert.strictEqual(F(3725.75 + t0 - t0), '00:03.72'); // performance.now()-style elapsed
const sw = M.normalizeExercise(mk({ name: 'Sprint', mode: 'stopwatch', modeConfig: { lapsEnabled: true, lapCount: 4 } }));
assert.deepStrictEqual(sw.modeConfig, { lapsEnabled: true, lapCount: 4 }); assert.ok(/4 laps/.test(M.summarize(sw)));
assert.ok(M.validateExercise(mk({ name: 'x', mode: 'stopwatch', modeConfig: { lapsEnabled: true, lapCount: 0 } })).length);
assert.deepStrictEqual(M.validateExercise(mk({ name: 'x', mode: 'stopwatch', modeConfig: { lapsEnabled: false } })), []);
['number', 'range'].forEach(t => { const e = M.normalizeExercise(mk({ name: 'r', modeConfig: { repsType: t, count: 5, min: 3, max: 6, restSec: 90 } }));
  assert.strictEqual(e.modeConfig.restSec, 90); assert.deepStrictEqual(M.validateExercise(e), []); assert.ok(/1:30 rest/.test(M.summarize(e))); });
assert.ok(M.validateExercise(mk({ name: 'x', modeConfig: { repsType: 'number', count: 5, restSec: -1 } })).length);
const v1 = { version: 1, workouts: [{ id: 'w', name: 'old', items: [
  { id: 'a', name: 'A', sets: 3, weight: { unit: 'lb', value: 50 }, mode: 'reps', modeConfig: { repsType: 'number', count: 10 }, notes: '', groupId: null, media: null },
  { id: 'b', name: 'B', sets: 2, weight: { unit: 'bodyweight', value: null }, mode: 'stopwatch', modeConfig: { lapsEnabled: true }, notes: '', groupId: null, media: null }] }] };
const m2 = { s: { [M.STORAGE_KEY]: JSON.stringify(v1) }, getItem: mem.getItem, setItem: mem.setItem }; const L = M.load(m2);
assert.strictEqual(L.version, M.SCHEMA_VERSION); assert.deepStrictEqual(L.sessions, []); assert.strictEqual(L.workouts[0].items[0].modeConfig.restSec, 0);
assert.strictEqual(L.workouts[0].items[1].modeConfig.lapCount, 1); L.workouts[0].items.forEach(e => assert.deepStrictEqual(M.validateExercise(e), []));
// v3: reps mode has no static; intervals merge repetitions into sets; timer/intervals take reps options
assert.ok(M.validateExercise(mk({ name: 'x', modeConfig: { repsType: 'static' } })).some(m => /reps type/.test(m)));
assert.deepStrictEqual(M.validateExercise(mk({ name: 'x', mode: 'timer', modeConfig: { workSec: 30, restSec: 0, repsType: 'range', min: 8, max: 12 } })), []);
assert.ok(/8 intervals · 12 reps · 0:30 interval/.test(M.summarize(M.normalizeExercise(mk({ name: 'x', sets: 8, mode: 'intervals', modeConfig: { workSec: 30, repsType: 'number', count: 12 } })))));
const v2 = { version: 2, workouts: [{ id: 'w', name: 'v2', items: [
  { id: 'i', name: 'I', sets: 2, weight: { unit: 'lb', value: null }, mode: 'intervals', modeConfig: { workSec: 20, repetitions: 4 }, notes: 'n', groupId: null, media: null },
  { id: 's', name: 'S', sets: 3, weight: { unit: 'kg', value: 20 }, mode: 'reps', modeConfig: { repsType: 'static', restSec: 45 }, notes: 'keep', groupId: null, media: null },
  { id: 't', name: 'T', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'timer', modeConfig: { workSec: 40, restSec: 20 }, notes: '', groupId: null, media: null }] }], sessions: [] };
const L3 = M.load({ s: { [M.STORAGE_KEY]: JSON.stringify(v2) }, getItem: mem.getItem, setItem: mem.setItem }), it3 = L3.workouts[0].items;
assert.strictEqual(L3.version, 4); assert.strictEqual(it3[0].sets, 8); assert.ok(!('repetitions' in it3[0].modeConfig)); assert.strictEqual(it3[0].modeConfig.repsType, null);
assert.deepStrictEqual([it3[1].modeConfig.repsType, it3[1].modeConfig.count, it3[1].modeConfig.restSec, it3[1].weight.value, it3[1].notes], ['number', 10, 45, 20, 'keep']);
assert.strictEqual(it3[2].modeConfig.repsType, null); it3.forEach(e => assert.deepStrictEqual(M.validateExercise(e), [], e.name));
// v4: reps optional in timer/intervals
assert.strictEqual(M.defaultModeConfig('timer').repsType, null); assert.strictEqual(M.defaultModeConfig('intervals').count, null);
const nr = M.normalizeExercise(mk({ name: 'Run in place', mode: 'intervals', modeConfig: { workSec: 30, repsType: null } }));
assert.deepStrictEqual(nr.modeConfig, { repsType: null, workSec: 30 }); assert.deepStrictEqual(M.validateExercise(nr), []); assert.ok(!/reps|hold/.test(M.summarize(nr)));
const v3 = { version: 3, workouts: [{ id: 'w', name: 'v3', items: [{ id: 't', name: 'T', sets: 1, weight: { unit: 'lb', value: null }, mode: 'timer', modeConfig: { workSec: 40, restSec: 20, repsType: 'static', count: 10 }, notes: '', groupId: null, media: null },
  { id: 'n', name: 'N', sets: 1, weight: { unit: 'lb', value: null }, mode: 'timer', modeConfig: { workSec: 40, restSec: 20, repsType: 'number', count: 12 }, notes: '', groupId: null, media: null }] }], sessions: [] };
const L4 = M.load({ s: { [M.STORAGE_KEY]: JSON.stringify(v3) }, getItem: mem.getItem, setItem: mem.setItem }).workouts[0].items;
assert.strictEqual(L4[0].modeConfig.repsType, null); assert.ok(!('count' in L4[0].modeConfig)); assert.deepStrictEqual([L4[1].modeConfig.repsType, L4[1].modeConfig.count], ['number', 12]);
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
  await add(async () => { await type('name', 'Squat'); await type('wval', '135'); await type('cfg.count', '10'); await type('cfg.rm', '1'); await type('cfg.rs', '30'); });
  await add(async () => { await type('name', 'Row'); await click('[data-v=kg]'); await type('wval', '40'); await click('[data-v=range]'); await type('cfg.min', '8'); await type('cfg.max', '12'); });
  await add(async () => { await type('name', 'Plank'); await click('[data-v=bodyweight]'); await click('[data-v=timer]'); await type('cfg.rm', '0'); await type('cfg.rs', '0'); });
  await add(async () => { await type('name', 'Bike'); await click('[data-v=intervals]');
    assert.strictEqual(await p.$$eval('[data-seg=repsType].on', a => a.length), 0); // nothing preselected
    await click('[data-v=number]'); assert.strictEqual(await p.$eval('[data-b="cfg.count"]', e => e.value), ''); // no prefill
    await click('[data-v=number]'); assert.strictEqual(await p.$$eval('[data-seg=repsType].on', a => a.length), 0); // tap again clears
    assert.ok((await p.$$eval('label', a => a.map(l => l.textContent))).includes('Interval time'));
    await type('cfg.wm', '0'); await type('cfg.ws', '30'); await type('sets', '8'); await click('[data-v=range]'); await type('cfg.min', '10'); await type('cfg.max', '15');
    const labels = await p.$$eval('label', a => a.map(l => l.textContent)); assert.strictEqual(labels[1], 'Mode'); assert.strictEqual(labels[2], '# of intervals'); assert.ok(!labels.includes('Sets'));
    await p.screenshot({ path: process.env.EDITOR_SHOT || '/tmp/editor-intervals.png', fullPage: true }); });
  await add(async () => { await type('name', 'Burpee'); await click('[data-v=timer]'); await type('cfg.wm', '1'); await type('cfg.ws', '0'); await type('cfg.rm', '0'); await type('cfg.rs', '20'); });
  await add(async () => { await type('name', 'Cone drill'); await click('[data-v=stopwatch]'); await type('cfg.lapCount', '6'); });
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
  assert.strictEqual(ws.items.length, 6); assert.strictEqual(stored.version, 4); assert.strictEqual(ws.items.find(x => x.name === 'Plank').modeConfig.repsType, null); assert.deepStrictEqual(ws.items.find(x => x.name === 'Bike').modeConfig, { repsType: 'range', min: 10, max: 15, workSec: 30 }); assert.strictEqual(ws.items.find(x => x.name === 'Bike').sets, 8);
  assert.strictEqual(ws.items.find(x => x.name === 'Squat').modeConfig.restSec, 90); assert.strictEqual(ws.items.find(x => x.name === 'Plank').modeConfig.restSec, 0);
  assert.deepStrictEqual(ws.items.find(x => x.name === 'Cone drill').modeConfig, { lapsEnabled: true, lapCount: 6 });
  assert.ok((await p.content()).includes('6 laps')); assert.strictEqual(await p.$$eval('.ss .card', a => a.length), 2);
  assert.ok(!(await p.$eval('[data-a=play]', b => b.disabled))); // Start enabled when workout has exercises
  // home: workout reorder persists (same ▲/▼ style as exercises)
  await p.evaluate(() => { const d = JSON.parse(localStorage.getItem('wb.data.v1')); if (d.workouts.length < 2) { d.workouts.push(JSON.parse(JSON.stringify(d.workouts[0]))); d.workouts[1].id = 'w-copy'; d.workouts[1].name = 'Copy'; localStorage.setItem('wb.data.v1', JSON.stringify(d)); } });
  await p.goto((process.argv[2] || 'http://127.0.0.1:8787/') + '#/'); await p.reload(); await new Promise(r => setTimeout(r, 200));
  const before = await p.evaluate(k => JSON.parse(localStorage.getItem(k)).workouts.map(w => w.id), M.STORAGE_KEY);
  assert.ok(before.length >= 2); assert.ok(await p.$('[data-a=wup]')); assert.ok(await p.$('[data-a=wdown]'));
  await p.click('[data-a=wdown]'); await new Promise(r => setTimeout(r, 100));
  const after = await p.evaluate(k => JSON.parse(localStorage.getItem(k)).workouts.map(w => w.id), M.STORAGE_KEY);
  assert.strictEqual(after[0], before[1]); assert.strictEqual(after[1], before[0]);
  await p.screenshot({ path: '/workspace/home-reorder.png' });
  await p.screenshot({ path: '/tmp/wbtest/shot.png' });
  assert.deepStrictEqual(errs, []); console.log('UI OK'); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
