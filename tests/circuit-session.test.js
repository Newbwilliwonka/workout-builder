// Live circuit rotation, benching, and time-per-station. No reps and no weight.
const assert = require('assert');
const C = require('../circuit-model.js');
const Clock = require('../clock.js');

function build(count) {
  let doc = C.blank();
  doc.name = 'Saturday class';
  doc.id = '11111111-1111-4111-8111-111111111111';
  const ids = [];
  for (let i = 0; i < count; i++) {
    const added = C.addStation(doc);
    assert.strictEqual(added.ok, true);
    doc = added.circuit;
    const set = C.setExercise(doc, added.station.id, { source: 'manual', name: 'Station ' + (i + 1) });
    doc = set.circuit;
    ids.push(added.station.id);
  }
  ids.forEach(function (id) { doc.order = C.tapStation(doc.stations, doc.order, id); });
  doc.clock = { workSec: 10, moveSec: 5, rounds: 2 };
  return doc;
}

const doc = build(4);
const ids = doc.order.slice();
assert.deepStrictEqual([0, 1, 2, 3, 0].map(function (r) { return C.stationAt(ids, 0, r + 1); }), [0, 1, 2, 3, 0]);
assert.deepStrictEqual([1, 2, 3, 4].map(function (r) { return C.stationAt(ids, 2, r); }), [2, 3, 0, 1]);
assert.strictEqual(C.stationAt(ids, -1, 1), 3);

const ada = { source: 'manual', name: 'Ada Client' };
const ben = { source: 'manual', name: 'Ben' };
doc.clients = [ada, ben];
assert.strictEqual(C.initials('Ada Client'), 'AC');
assert.strictEqual(C.initials('ada@example.com'), 'C');
assert.strictEqual(C.firstName('Ada Client'), 'Ada');
assert.strictEqual(C.firstName('Walk-in'), 'Walk-in');
assert.ok(C.avatarColor('Ada').charAt(0) === '#');

const keyA = C.personKey(ada);
const keyB = C.personKey(ben);
assert.strictEqual(C.assignmentReady(doc.clients, {}), false);
assert.strictEqual(C.assignmentReady(doc.clients, { [keyA]: { stationId: ids[0] } }), false);
const placed = {};
placed[keyA] = { stationId: ids[0] };
placed[keyB] = { stationId: ids[0] };
assert.strictEqual(C.assignmentReady(doc.clients, placed), true);
const benched = {};
benched[keyA] = { stationId: ids[1] };
benched[keyB] = { bench: true, stationId: ids[2] };
assert.strictEqual(C.assignmentReady(doc.clients, benched), true);

const playerSched = Clock.timerSchedule(10, 5, 2, true);
assert.strictEqual(playerSched.map(function (x) { return x.t + x.kind[0]; }).join(' '),
  '0t 1t 2t 3t 4t 5g 12t 13t 14t 15g 17t 18t 19t 20g 27t 28t 29t 30g 32t 33t 34t 35d');
const trimmed = C.withoutFinalMove(playerSched, 10, 5, 2);
assert.strictEqual(trimmed.map(function (x) { return x.t + x.kind[0]; }).join(' '),
  '0t 1t 2t 3t 4t 5g 12t 13t 14t 15g 17t 18t 19t 20g 27t 28t 29t 30d');
assert.ok(trimmed.every(function (x) { return x.t <= 30; }));

function run(assigned) {
  return C.beginRun(doc, assigned);
}
function secMap(person) {
  const out = {};
  Object.keys(person.ms).forEach(function (id) { out[id] = person.ms[id]; });
  return out;
}

const both = run(placed);
assert.strictEqual(both.phase, 'standoff');
const full = C.advanceSession(both, 30000);
assert.strictEqual(full.phase, 'done');
assert.strictEqual(full.done, true);
full.people.forEach(function (p) {
  assert.deepStrictEqual(secMap(p), { [ids[0]]: 10000, [ids[1]]: 10000 });
  assert.strictEqual(p.slice, null);
});

const early = C.finishSession(run(placed), 8000);
early.people.forEach(function (p) {
  assert.deepStrictEqual(secMap(p), { [ids[0]]: 3000 });
});

const skipped = C.skipPhase(run(placed), 8000);
assert.strictEqual(skipped.phase, 'move');
assert.strictEqual(skipped.elapsedMs, 15000);
skipped.people.forEach(function (p) {
  assert.deepStrictEqual(secMap(p), { [ids[0]]: 3000 });
});
const afterSkip = C.advanceSession(skipped, 30000);
afterSkip.people.forEach(function (p) {
  assert.deepStrictEqual(secMap(p), { [ids[0]]: 3000, [ids[1]]: 10000 });
});

let mid = C.advanceSession(run(placed), 9000);
mid = C.benchPerson(mid, keyA, 9000);
assert.strictEqual(mid.people[0].benched, true);
assert.deepStrictEqual(secMap(mid.people[0]), { [ids[0]]: 4000 });
assert.strictEqual(C.spotStation(mid, mid.people[0]), ids[0]);
mid = C.advanceSession(mid, 20000);
assert.strictEqual(mid.phase, 'work');
assert.strictEqual(mid.round, 2);
assert.strictEqual(C.spotStation(mid, mid.people[0]), ids[1]);
assert.deepStrictEqual(secMap(mid.people[0]), { [ids[0]]: 4000 });
assert.deepStrictEqual(secMap(mid.people[1]), { [ids[0]]: 10000 });
mid = C.rejoinPerson(mid, keyA, 20000);
assert.strictEqual(mid.people[0].benched, false);
assert.strictEqual(mid.people[0].slice.stationId, ids[1]);
mid = C.finishSession(mid, 25000);
assert.deepStrictEqual(secMap(mid.people[0]), { [ids[0]]: 4000, [ids[1]]: 5000 });
assert.deepStrictEqual(secMap(mid.people[1]), { [ids[0]]: 10000, [ids[1]]: 5000 });

const fromBench = run(benched);
const doneBench = C.advanceSession(fromBench, 30000);
assert.deepStrictEqual(secMap(doneBench.people[1]), {});
assert.deepStrictEqual(secMap(doneBench.people[0]), { [ids[1]]: 10000, [ids[2]]: 10000 });

const record = C.sessionRecord(doc, mid, 1000, 2000);
assert.strictEqual(record.circuitId, doc.id);
assert.strictEqual(record.people[0].name, 'Ada Client');
assert.strictEqual(record.people[0].total, 9);
assert.deepStrictEqual(record.people[0].stations.map(function (row) { return row.name + ' ' + row.seconds; }), ['Station 1 4', 'Station 2 5']);
assert.ok(!('reps' in record) && !('weight' in record) && !('rest' in record));
assert.ok(JSON.stringify(record).indexOf('reps') < 0);
assert.ok(JSON.stringify(record).indexOf('weight') < 0);
const info = C.phaseInfo(22000, doc.clock);
assert.strictEqual(info.name, 'work');
assert.strictEqual(info.round, 2);

const noMove = C.phaseInfo(5000 + 10 * 1000, { workSec: 10, moveSec: 0, rounds: 1 });
assert.strictEqual(noMove.name, 'done');

console.log('CIRCUIT SESSION OK');
