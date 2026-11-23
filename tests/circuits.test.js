// Group circuit rules: loop order, the closed loop, and the save guard.
const assert = require('assert');
const C = require('../circuit-model.js');

const ADA = '22222222-2222-4222-8222-222222222222';
const ROW = '11111111-1111-4111-8111-111111111111';

function build(count, name) {
  let doc = C.blank();
  doc.name = name || 'Morning circuit';
  const ids = [];
  for (let i = 0; i < count; i++) {
    const added = C.addStation(doc);
    assert.strictEqual(added.ok, true, added.error);
    doc = added.circuit;
    const set = C.setExercise(doc, added.station.id, { source: 'manual', name: 'Move ' + (i + 1) });
    assert.strictEqual(set.ok, true, set.error);
    doc = set.circuit;
    ids.push(added.station.id);
  }
  ids.forEach(function (id) {
    doc.order = C.tapStation(doc.stations, doc.order, id);
  });
  doc.clock = C.syncRounds(doc.clock, doc.stations.length, true);
  return doc;
}

assert.strictEqual(C.blank().clock.workSec, 45);
assert.strictEqual(C.blank().clock.moveSec, 15);
assert.strictEqual(C.blank().clock.rounds, 0);
assert.deepStrictEqual(C.splitClock(45), { m: 0, s: 45 });
assert.deepStrictEqual(C.splitClock(15), { m: 0, s: 15 });
assert.strictEqual(C.joinClock('0', '45'), 45);
assert.strictEqual(C.joinClock('0', '15'), 15);
assert.strictEqual(C.joinClock('0', '00'), 0);
assert.strictEqual(C.joinClock('1', '60'), null);
assert.strictEqual(C.joinClock('', '15'), null);

assert.strictEqual(C.publicName('Ada'), 'Ada');
assert.strictEqual(C.publicName('  '), 'Client');
assert.strictEqual(C.publicName('ada@example.com'), 'Client');
assert.strictEqual(C.initial('Ada'), 'A');
assert.strictEqual(C.initial('ada@example.com'), 'C');
assert.strictEqual(C.initial(''), 'C');

const six = build(6, 'Saturday class');
assert.strictEqual(six.stations.length, 6);
assert.deepStrictEqual(six.stations.map(function (s) { return s.col + ',' + s.row; }), ['0,0', '1,0', '2,0', '3,0', '0,1', '1,1']);
assert.strictEqual(C.visibleRows([]), 2);
assert.strictEqual(C.visibleRows(six.stations), 3);
assert.strictEqual(C.visibleRows([{ row: 5 }]), 6);
(function () {
  var narrow = C.blank();
  for (var i = 0; i < 4; i++) {
    var added = C.addStation(narrow, 3);
    assert.strictEqual(added.ok, true);
    narrow = added.circuit;
  }
  assert.deepStrictEqual(narrow.stations.map(function (s) { return s.col + ',' + s.row; }), ['0,0', '1,0', '2,0', '0,1']);
  assert.strictEqual(C.visibleRows(narrow.stations), 3);
})();
assert.strictEqual(C.loopComplete(six.stations, six.order), true);
assert.deepStrictEqual(six.order.map(function (id) { return C.stationNumber(six.order, id); }), [1, 2, 3, 4, 5, 6]);
const edges = C.loopEdges(six.order);
assert.strictEqual(edges.length, 6);
assert.strictEqual(edges[0].close, false);
assert.strictEqual(edges[0].from, six.order[0]);
assert.strictEqual(edges[0].to, six.order[1]);
assert.strictEqual(edges[5].close, true);
assert.strictEqual(edges[5].from, six.order[5]);
assert.strictEqual(edges[5].to, six.order[0]);
assert.strictEqual(six.clock.rounds, 6);

const again = C.tapStation(six.stations, six.order, six.order[2]);
assert.deepStrictEqual(again, six.order);
assert.deepStrictEqual(C.tapStation(six.stations, six.order, 'st_missing1'), six.order);
assert.deepStrictEqual(C.clearOrder(), []);
assert.strictEqual(C.loopComplete(six.stations, C.clearOrder()), false);

const partial = Object.assign({}, six, { order: six.order.slice(0, 5) });
const partialSave = C.guard(partial);
assert.strictEqual(partialSave.ok, false);
assert.ok(partialSave.errors.indexOf('Tap every station to close the loop.') >= 0);

const dupOrder = Object.assign({}, six, { order: six.order.concat([six.order[0]]) });
assert.strictEqual(C.guard(dupOrder).ok, false);

const one = build(1);
assert.strictEqual(C.loopComplete(one.stations, one.order), true);
assert.deepStrictEqual(C.loopEdges(one.order), []);
assert.strictEqual(C.guard(one).ok, true);

let removed = C.removeStation(six, six.stations[1].id);
assert.strictEqual(removed.stations.length, 5);
assert.ok(removed.order.indexOf(six.stations[1].id) < 0);
assert.strictEqual(C.loopComplete(removed.stations, removed.order), true);
assert.strictEqual(C.stationNumber(removed.order, removed.stations[0].id), 1);
removed.clock = C.syncRounds(removed.clock, removed.stations.length, true);
assert.strictEqual(C.guard(removed).ok, true);

const moved = C.moveStation(six, six.stations[5].id, 3, 2);
assert.strictEqual(moved.ok, true);
assert.strictEqual(moved.circuit.stations[5].col, 3);
assert.strictEqual(moved.circuit.stations[5].row, 2);
assert.strictEqual(C.moveStation(moved.circuit, six.stations[5].id, 0, 0).ok, false);
assert.strictEqual(C.moveStation(six, six.stations[0].id, -1, 0).ok, false);
assert.strictEqual(C.moveStation(six, six.stations[0].id, 4, 0).ok, false);
const same = C.moveStation(six, six.stations[0].id, 0, 0);
assert.strictEqual(same.ok, true);

let full = C.blank();
for (let i = 0; i < C.STATION_MAX; i++) {
  const added = C.addStation(full);
  assert.strictEqual(added.ok, true);
  full = added.circuit;
}
assert.strictEqual(C.nextCell(full.stations), null);
assert.strictEqual(C.addStation(full).ok, false);
assert.strictEqual(C.addStation(full).error, 'The grid is full.');

const library = C.setExercise(one, one.stations[0].id, { source: 'library', name: 'Squat', libraryId: 'squat_1' });
assert.strictEqual(library.ok, true);
assert.deepStrictEqual(library.circuit.stations[0].exercise, { source: 'library', name: 'Squat', libraryId: 'squat_1' });
assert.strictEqual(C.setExercise(one, one.stations[0].id, { source: 'library', name: 'Squat', libraryId: '' }).ok, false);
assert.strictEqual(C.setExercise(one, one.stations[0].id, { source: 'manual', name: '  ' }).ok, false);
assert.strictEqual(C.normalizeExercise({ source: 'manual', name: 'Farmer carry', libraryId: 'nope' }).libraryId, null);

let clients = C.toggleLinked([], { id: ADA, name: 'Ada Client', email: 'ada@example.com' });
assert.deepStrictEqual(clients, [{ source: 'linked', id: ADA, name: 'Ada Client' }]);
assert.ok(!('email' in clients[0]));
clients = C.toggleLinked(clients, { id: ADA, name: 'Ada Client' });
assert.deepStrictEqual(clients, []);
clients = C.toggleLinked([], { id: ADA, display_name: 'ada@example.com' });
assert.strictEqual(clients[0].name, 'Client');
const manual = C.addManualClient(clients, ' Walk-in ');
assert.strictEqual(manual.ok, true);
assert.deepStrictEqual(manual.clients[1], { source: 'manual', name: 'Walk-in' });
assert.strictEqual(C.addManualClient(manual.clients, 'walk-in').ok, false);
assert.strictEqual(C.addManualClient(manual.clients, 'guest@gym.com').ok, false);
assert.strictEqual(C.addManualClient(manual.clients, '   ').error, 'Enter a name.');
const without = C.removeManualClient(manual.clients, 'Walk-in');
assert.strictEqual(without.length, 1);

const ready = build(6);
ready.clients = manual.clients;
ready.name = 'Saturday class';
const saved = C.toPayload(ready);
assert.strictEqual(saved.ok, true);
assert.strictEqual(saved.name, 'Saturday class');
assert.strictEqual(saved.data.clock.workSec, 45);
assert.strictEqual(saved.data.clock.moveSec, 15);
assert.strictEqual(saved.data.clock.rounds, 6);
assert.strictEqual(saved.data.stations.length, 6);
assert.ok(!('reps' in saved.data));
assert.ok(!('weight' in saved.data));
saved.data.stations.forEach(function (station) {
  assert.ok(!('reps' in station) && !('weight' in station) && !('sets' in station));
  assert.ok(station.exercise.source === 'manual' || station.exercise.source === 'library');
});
const opened = C.fromRow({ id: ROW, name: saved.name, data: saved.data });
assert.strictEqual(opened.ok, true);
assert.strictEqual(opened.value.id, ROW);
assert.deepStrictEqual(opened.value.stations, saved.data.stations);
assert.deepStrictEqual(opened.value.order, saved.data.order);
assert.deepStrictEqual(C.summary(opened.value), { name: 'Saturday class', stations: 6, clients: 2 });

assert.strictEqual(C.guard(C.blank()).ok, false);
assert.ok(C.guard(Object.assign({}, ready, { name: '' })).errors.indexOf('Name this circuit.') >= 0);
assert.ok(C.guard(Object.assign({}, ready, { name: 'a'.repeat(81) })).errors.indexOf('That name is too long.') >= 0);
assert.ok(C.guard(Object.assign({}, ready, { name: 'coach@gym.com' })).errors.indexOf('Name this circuit.') >= 0);

const overlap = build(2);
overlap.stations[1].col = overlap.stations[0].col;
overlap.stations[1].row = overlap.stations[0].row;
assert.ok(C.guard(overlap).errors.indexOf('Two stations are on the same square.') >= 0);
const off = build(1);
off.stations[0].row = 9;
assert.ok(C.guard(off).errors.indexOf('Move that station onto the grid.') >= 0);

const weighted = build(1);
weighted.stations[0].exercise.weight = 40;
assert.ok(C.guard(weighted).errors.indexOf('Take out reps and weight. Circuits track time only.') >= 0);
const reps = build(1);
reps.clock.reps = 10;
assert.ok(C.guard(reps).errors.indexOf('Take out reps and weight. Circuits track time only.') >= 0);

const badClock = build(1);
badClock.clock = { workSec: 45, moveSec: 15, rounds: 0 };
assert.ok(C.guard(badClock).errors.indexOf('Enter the rounds.') >= 0);
badClock.clock = { workSec: null, moveSec: 15, rounds: 1 };
assert.ok(C.guard(badClock).errors.indexOf('Enter the work time.') >= 0);
badClock.clock = { workSec: 45, moveSec: 3601, rounds: 1 };
assert.ok(C.guard(badClock).errors.indexOf('Enter the move time.') >= 0);
badClock.clock = { workSec: 45, moveSec: 1.5, rounds: 1 };
assert.ok(C.guard(badClock).errors.indexOf('Enter the move time.') >= 0);

const mailed = build(1);
mailed.clients = [{ source: 'manual', name: 'a@b.com' }];
assert.ok(C.guard(mailed).errors.indexOf('Name every client.') >= 0);

const huge = build(1);
huge.blob = 'x'.repeat(C.DATA_MAX + 1);
assert.ok(C.guard(huge).errors.indexOf('This circuit is too large.') >= 0);

const emptyExercise = build(1);
emptyExercise.stations[0].exercise = null;
assert.ok(C.guard(emptyExercise).errors.indexOf('Choose an exercise for every station.') >= 0);

console.log('CIRCUITS OK');
