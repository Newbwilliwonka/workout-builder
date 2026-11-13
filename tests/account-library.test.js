// Local-to-account copy and latest-edit sync. No network and no live database.
const assert = require('assert');
const L = require('../library.js');

function wo(id, name, at, extra) {
  return Object.assign({
    id: id,
    name: name,
    items: [{ name: name, sets: 3 }],
    createdAt: at,
    updatedAt: at
  }, extra || {});
}
function remote(id, name, at, extra) {
  return Object.assign({
    localId: id,
    name: name,
    items: [{ name: name, sets: 3 }],
    revisedAt: at,
    deleted: false,
    createdAt: at
  }, extra || {});
}

// A program day points at the workout id. Sync must keep that id.
const program = { id: 'pg1', ownerId: 'self', workoutId: 'wo_leg', workoutName: 'Legs', items: [] };

(function copyOnce() {
  const local = [wo('wo_leg', 'Legs', 1000), wo('wo_push', 'Push', 2000), wo('from_trainer', 'Sent', 3000, { sourceTrainerId: 't1' })];
  const first = L.pendingImports(local, {}, {});
  assert.deepStrictEqual(first.map(function (w) { return w.id; }), ['wo_leg', 'wo_push']);

  const server = {};
  const pass = L.absorbImports(local, {}, {}, function (w) {
    assert.ok(!server[w.id], 'duplicate insert');
    server[w.id] = w.name;
    return { ok: true, localId: w.id };
  });
  assert.deepStrictEqual(pass.saved, ['wo_leg', 'wo_push']);
  assert.deepStrictEqual(pass.pending, []);
  assert.strictEqual(server.wo_leg, 'Legs');
  assert.strictEqual(Object.keys(server).length, 2);

  const again = L.absorbImports(local, pass.claimed, {}, function () {
    throw new Error('signed in again and tried to copy');
  });
  assert.deepStrictEqual(again.saved, []);
  assert.strictEqual(again.stopped, false);
  assert.deepStrictEqual(again.pending, []);
  assert.strictEqual(Object.keys(server).length, 2);
})();

(function copyStopsPartway() {
  const local = [wo('wo_a', 'A', 1), wo('wo_b', 'B', 2), wo('wo_c', 'C', 3)];
  const server = {};
  const mid = L.absorbImports(local, {}, {}, function (w, index) {
    if (index === 1) throw new Error('network');
    server[w.id] = w.name;
    return { ok: true, localId: w.id };
  });
  assert.deepStrictEqual(mid.saved, ['wo_a']);
  assert.strictEqual(mid.stopped, true);
  assert.deepStrictEqual(mid.pending, ['wo_b', 'wo_c']);
  assert.deepStrictEqual(Object.keys(server), ['wo_a']);

  const retry = L.absorbImports(local, mid.claimed, {}, function (w) {
    assert.notStrictEqual(w.id, 'wo_a');
    if (server[w.id]) throw new Error('duplicate on retry');
    server[w.id] = w.name;
    return { ok: true, localId: w.id };
  });
  assert.deepStrictEqual(retry.saved, ['wo_b', 'wo_c']);
  assert.deepStrictEqual(retry.pending, []);
  assert.deepStrictEqual(Object.keys(server).sort(), ['wo_a', 'wo_b', 'wo_c']);
})();

(function failedResponseDoesNotClaim() {
  const local = [wo('wo_a', 'A', 1), wo('wo_b', 'B', 2)];
  const mid = L.absorbImports(local, {}, {}, function (w, index) {
    if (index === 0) return { ok: false };
    return { ok: true, localId: w.id };
  });
  assert.deepStrictEqual(mid.saved, []);
  assert.deepStrictEqual(mid.pending, ['wo_a', 'wo_b']);
})();

(function latestEditWinsAndKeepsProgramId() {
  const local = [
    wo('wo_leg', 'Legs local', 5000),
    wo('wo_old', 'Older local', 1000),
    wo('wo_sent', 'From coach', 9000, { sourceTrainerId: 't1' })
  ];
  const rows = [
    remote('wo_leg', 'Legs server', 4000),
    remote('wo_old', 'Older server', 3000),
    remote('wo_new', 'From the other phone', 8000),
    remote('wo_gone', 'Deleted there', 7000, { deleted: true })
  ];
  const merged = L.mergeAccount(local, rows, { wo_skip: 6000 });
  const leg = merged.workouts.filter(function (w) { return w.id === 'wo_leg'; })[0];
  const older = merged.workouts.filter(function (w) { return w.id === 'wo_old'; })[0];
  const sent = merged.workouts.filter(function (w) { return w.id === 'wo_sent'; })[0];
  const added = merged.workouts.filter(function (w) { return w.id === 'wo_new'; })[0];
  assert.strictEqual(leg.name, 'Legs local');
  assert.strictEqual(leg.id, program.workoutId);
  assert.strictEqual(older.name, 'Older server');
  assert.strictEqual(older.id, 'wo_old');
  assert.strictEqual(sent.name, 'From coach');
  assert.strictEqual(sent.sourceTrainerId, 't1');
  assert.strictEqual(added.name, 'From the other phone');
  assert.ok(!merged.workouts.some(function (w) { return w.id === 'wo_gone'; }));
  assert.strictEqual(merged.ack.wo_old, 3000);
  assert.ok(!merged.ack.wo_leg);

  const found = merged.workouts.filter(function (w) { return w.id === program.workoutId; })[0];
  assert.ok(found, 'scheduled workout id still resolves');
})();

(function deleteIsAnEdit() {
  const local = [wo('wo_keep', 'Keep', 2000), wo('wo_edit', 'Edited here', 9000)];
  const rows = [
    remote('wo_keep', 'Keep', 2000, { deleted: true }),
    remote('wo_edit', 'Edited here', 4000, { deleted: true }),
    remote('wo_back', 'Comes back', 1000)
  ];
  const merged = L.mergeAccount(local, rows, { wo_back: 5000 });
  assert.ok(!merged.workouts.some(function (w) { return w.id === 'wo_keep'; }));
  assert.strictEqual(merged.tombstones.wo_keep, 2000);
  const edited = merged.workouts.filter(function (w) { return w.id === 'wo_edit'; })[0];
  assert.strictEqual(edited.name, 'Edited here');
  assert.ok(!merged.workouts.some(function (w) { return w.id === 'wo_back'; }));
  assert.strictEqual(merged.tombstones.wo_back, 5000);
})();

(function pushOnlyWhatTheServerDoesNotHave() {
  const local = [wo('wo_same', 'Same', 1000), wo('wo_new', 'New', 3000)];
  const changes = L.pushChanges(local, { wo_drop: 4000, wo_old: 1000 }, { wo_same: 1000, wo_old: 1000 });
  assert.deepStrictEqual(changes.map(function (c) { return c.localId + (c.deleted ? ':del' : ''); }), ['wo_new', 'wo_drop:del']);
  const second = L.pushChanges(local, { wo_drop: 4000 }, { wo_same: 1000, wo_new: 3000, wo_drop: 4000 });
  assert.deepStrictEqual(second, []);
})();

(function tombstoneBlocksImport() {
  const local = [wo('wo_live', 'Live', 1000), wo('wo_dead', 'Dead', 1000)];
  const pending = L.pendingImports(local, {}, { wo_dead: 2000 });
  assert.deepStrictEqual(pending.map(function (w) { return w.id; }), ['wo_live']);
})();

(function clientQueueReplacesTheSameWorkout() {
  let queue = [];
  queue = L.queueUpsert(queue, { ownerId: 'ada', kind: 'account', localId: 'wo_1', name: 'First' });
  queue = L.queueUpsert(queue, { ownerId: 'ada', kind: 'account', localId: 'wo_1', name: 'Second' });
  queue = L.queueUpsert(queue, { ownerId: 'ada', kind: 'sent', localId: 'wo_1', name: 'Copy' });
  assert.strictEqual(queue.length, 2);
  assert.strictEqual(queue[0].name, 'Second');
  queue = L.queueDrop(queue, { ownerId: 'ada', kind: 'account', localId: 'wo_1' });
  assert.strictEqual(queue.length, 1);
  assert.strictEqual(queue[0].kind, 'sent');
  queue = L.queueUpsert(queue, { ownerId: 'ada', kind: 'account', localId: 'wo_2', gen: 2, name: 'Newer' });
  queue = L.queueDrop(queue, { ownerId: 'ada', kind: 'account', localId: 'wo_2', gen: 1 });
  assert.strictEqual(queue.filter(function (row) { return row.localId === 'wo_2'; })[0].name, 'Newer');
})();

(function statusAndGuestAccess() {
  assert.strictEqual(L.statusText('saved'), 'Saved');
  assert.strictEqual(L.statusText('offline'), 'Offline, will sync');
  assert.strictEqual(L.statusText(''), '');
  const view = L.guestFromAccount(remote('wo_e', 'Easy', 10), 'fan', 'view');
  assert.strictEqual(view.remoteLocked, true);
  assert.strictEqual(view.id, 'wo_e');
  const edit = L.guestFromAccount(remote('wo_f', 'Free', 10), 'ada', 'edit');
  assert.strictEqual(edit.remoteEditable, true);
  assert.ok(!edit.remoteLocked);
  const html = L.clientToolsHtml({
    permission: 'edit',
    workouts: [remote('wo_f', 'Free', 10)],
    sent: [{ id: 'copy-1', name: 'Sent day', items: [] }]
  });
  assert.ok(html.indexOf('id="client-account"') > -1);
  assert.ok(html.indexOf('You can view, run, and edit these workouts.') > -1);
  assert.ok(html.indexOf('data-client-open="wo_f"') > -1);
  assert.ok(html.indexOf('data-client-del="copy-1"') > -1);
  const hidden = L.clientToolsHtml({ permission: 'hidden', workouts: [remote('wo_e', 'Easy', 10)], sent: [] });
  assert.strictEqual(hidden, '');
  const sentOnly = L.clientToolsHtml({ permission: 'hidden', workouts: [], sent: [{ id: 'copy-1', name: 'Sent day', items: [{ name: 'Squat' }] }] });
  assert.ok(sentOnly.indexOf('Workouts you sent') > -1);
  assert.ok(sentOnly.indexOf('Easy') === -1);
})();

(function equalTimeKeepsTheOpenWorkout() {
  const open = wo('wo_open', 'Typing', 1000);
  const same = L.mergeAccount([open], [remote('wo_open', 'From the server', 1000)], {});
  assert.strictEqual(same.workouts[0], open);
  assert.strictEqual(open.name, 'Typing');
  assert.strictEqual(same.ack.wo_open, 1000);
  const newer = L.mergeAccount([open], [remote('wo_open', 'Newer phone', 2000)], {});
  assert.strictEqual(newer.workouts[0], open);
  assert.strictEqual(open.name, 'Newer phone');
})();

(function seedDoesNotImportWorkoutsCreatedLater() {
  const first = [wo('wo_old', 'Old', 1000)];
  const seed = L.seedIds(null, first);
  const later = first.concat([wo('wo_new', 'New', 3000)]);
  const pending = L.importsForSeed(later, {}, {}, seed);
  assert.deepStrictEqual(pending.map(function (w) { return w.id; }), ['wo_old']);
  assert.deepStrictEqual(L.seedIds(seed, later), ['wo_old']);
})();

(function anotherAccountDoesNotReceiveTheLibrary() {
  const ada = [wo('wo_ada', 'Ada', 1000)];
  const first = L.libraryForAccount('', 'ada', ada, null);
  assert.strictEqual(first.switched, false);
  assert.strictEqual(first.workouts[0].id, 'wo_ada');
  const bob = L.libraryForAccount('ada', 'bob', ada, null);
  assert.strictEqual(bob.switched, true);
  assert.deepStrictEqual(bob.workouts, []);
  const back = L.libraryForAccount('bob', 'ada', [], { workouts: ada });
  assert.strictEqual(back.workouts[0].name, 'Ada');
})();

console.log('ACCOUNT LIBRARY OK');
