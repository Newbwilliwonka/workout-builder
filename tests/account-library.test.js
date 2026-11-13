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
  assert.strictEqual(merged.tombstones.wo_keep.byUser, false);
  assert.strictEqual(merged.tombstones.wo_keep.at, 2000);
  const edited = merged.workouts.filter(function (w) { return w.id === 'wo_edit'; })[0];
  assert.strictEqual(edited.name, 'Edited here');
  // A bare timestamp is not a Delete. The live account workout stays visible.
  const back = merged.workouts.filter(function (w) { return w.id === 'wo_back'; })[0];
  assert.strictEqual(back.name, 'Comes back');
  assert.ok(!merged.tombstones.wo_back);
})();

(function pushOnlyWhatTheServerDoesNotHave() {
  const local = [wo('wo_same', 'Same', 1000), wo('wo_new', 'New', 3000)];
  const drops = { wo_drop: L.userDrop(4000), wo_old: L.userDrop(1000) };
  const changes = L.pushChanges(local, drops, { wo_same: 1000, wo_old: 1000 });
  assert.deepStrictEqual(changes.map(function (c) { return c.localId + (c.deleted ? ':del' : ''); }), ['wo_new', 'wo_drop:del']);
  const second = L.pushChanges(local, { wo_drop: L.userDrop(4000) }, { wo_same: 1000, wo_new: 3000, wo_drop: 4000 });
  assert.deepStrictEqual(second, []);
  // An old removal mark must not be sent as a delete.
  const legacy = L.pushChanges(local, { wo_drop: 4000 }, {});
  assert.deepStrictEqual(legacy.map(function (c) { return c.localId; }), ['wo_same', 'wo_new']);
  assert.ok(legacy.every(function (c) { return c.deleted === false; }));
})();

(function tombstoneBlocksImport() {
  const local = [wo('wo_live', 'Live', 1000), wo('wo_dead', 'Dead', 1000)];
  const legacy = L.pendingImports(local, {}, { wo_dead: 2000 });
  assert.deepStrictEqual(legacy.map(function (w) { return w.id; }), ['wo_live', 'wo_dead']);
  const pending = L.pendingImports(local, {}, { wo_dead: L.userDrop(2000) });
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
  assert.strictEqual(L.statusText('auth'), 'Sign in again');
  assert.strictEqual(L.statusText('error', 'Your plan includes up to 6 workouts.'), 'Your plan includes up to 6 workouts.');
  assert.strictEqual(L.statusModel('error', 'Your plan includes up to 6 workouts.').plans, true);
  assert.strictEqual(L.statusModel('error', 'Enter a workout name.').plans, false);
  assert.strictEqual(L.statusText(''), '');
  assert.strictEqual(L.syncFailure(new Error('Failed to fetch')), 'offline');
  assert.strictEqual(L.syncFailure(new Error('JWT expired')), 'auth');
  assert.strictEqual(L.syncFailure(new Error('Sign in first.')), 'auth');
  assert.strictEqual(L.syncFailure(new Error('Your plan includes up to 6 workouts.')), 'permanent');
  assert.strictEqual(L.syncFailure(new Error('There is no connection.')), 'permanent');
  assert.strictEqual(L.syncFailure(new Error('Enter a workout name.')), 'permanent');
  assert.strictEqual(L.plainSyncMessage(new Error('Your plan includes up to 6 workouts.')), 'Your plan includes up to 6 workouts.');
  assert.strictEqual(L.plainSyncMessage(new Error('JWT expired')), 'Sign in again');
  const stamp = L.bodyStamp({ name: 'Chest', items: [] });
  assert.strictEqual(L.rejectionHolds({ stamp: stamp, at: 1000 }, stamp, 1000 + L.REJECT_HOLD_MS - 1), true);
  assert.strictEqual(L.rejectionHolds({ stamp: stamp, at: 1000 }, stamp, 1000 + L.REJECT_HOLD_MS), false);
  assert.strictEqual(L.rejectionHolds({ stamp: stamp, at: 1000 }, L.bodyStamp({ name: 'Chest 2', items: [] }), 1000), false);
  assert.deepStrictEqual(L.rowsFromPull('[{"localId":"wo_chest"}]').map(function (row) { return row.localId; }), ['wo_chest']);
  assert.deepStrictEqual(L.rowsFromPull({ workouts: [{ localId: 'wo_chest' }] }).map(function (row) { return row.localId; }), ['wo_chest']);
  assert.deepStrictEqual(L.rowsFromPull({ localId: 'wo_chest' }), []);
  assert.strictEqual(L.preferNotice('Enter a workout name.', 'Your plan includes up to 6 workouts.'), 'Your plan includes up to 6 workouts.');
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

(function phoneAndComputerDoNotDeleteEachOther() {
  const createdAt = Date.parse('2026-11-13T15:44:00.000Z');
  const phone = [wo('wo_new', 'New workout', createdAt, { items: [{ name: 'Press', sets: 1 }] })];
  const server = [remote('wo_new', 'New workout', createdAt, { items: [{ name: 'Press', sets: 1 }] })];
  // Computer signs in while the phone stays signed in. It has no copy yet, and a
  // stale removal mark newer than the workout. That mark must not delete it.
  const signedIn = L.mergeAccount([], server, { wo_new: Date.parse('2026-11-13T16:14:21.612Z') });
  assert.strictEqual(signedIn.workouts.length, 1);
  assert.strictEqual(signedIn.workouts[0].name, 'New workout');
  assert.strictEqual(signedIn.workouts[0].items.length, 1);
  const computerPush = L.pushChanges(signedIn.workouts, signedIn.tombstones, signedIn.ack);
  assert.deepStrictEqual(computerPush, []);

  // The phone already has it. A pull must not turn it into a delete either.
  const phonePull = L.mergeAccount(phone, server, {});
  assert.strictEqual(phonePull.workouts[0], phone[0]);
  assert.deepStrictEqual(L.pushChanges(phonePull.workouts, phonePull.tombstones, phonePull.ack), []);

  // Chest is created on the computer and has never reached the account.
  // The next pull must keep it and still offer it.
  const chestAt = Date.parse('2026-11-13T15:10:00.000Z');
  const withChest = phonePull.workouts.concat([wo('wo_chest', 'Chest - press', chestAt)]);
  const afterPull = L.mergeAccount(withChest, server, { wo_chest: chestAt + 5000 });
  const chest = afterPull.workouts.filter(function (w) { return w.id === 'wo_chest'; })[0];
  assert.strictEqual(chest.name, 'Chest - press');
  const offered = L.pushChanges(afterPull.workouts, afterPull.tombstones, afterPull.ack);
  assert.deepStrictEqual(offered.map(function (c) { return c.localId + (c.deleted ? ':del' : ''); }), ['wo_chest']);

  // A real Delete on this device, newer than the account, is still sent.
  const removed = L.mergeAccount(withChest, server, { wo_chest: L.userDrop(chestAt + 5000) });
  assert.ok(!removed.workouts.some(function (w) { return w.id === 'wo_chest'; }));
  const deletion = L.pushChanges(removed.workouts, removed.tombstones, removed.ack);
  assert.strictEqual(deletion.length, 1);
  assert.strictEqual(deletion[0].localId, 'wo_chest');
  assert.strictEqual(deletion[0].deleted, true);
})();

(function importedWorkoutIsNotHiddenByAnOlderClock() {
  const revised = Date.parse('2026-11-12T10:41:43.209Z');
  const saved = Date.parse('2026-11-13T00:54:58.000Z');
  const row = remote('wo_hollow', 'Hollow Body - Shoulders - Neck', revised, {
    updatedAt: saved,
    items: new Array(10).fill({ name: 'Hold' })
  });
  // Removal mark from the afternoon before the account saved the row.
  const marked = revised + (5 * 60 * 60 * 1000);
  const legacy = L.mergeAccount([], [row], { wo_hollow: marked });
  assert.strictEqual(legacy.workouts.length, 1);
  assert.strictEqual(legacy.workouts[0].name, 'Hollow Body - Shoulders - Neck');
  assert.strictEqual(legacy.workouts[0].items.length, 10);
  assert.deepStrictEqual(L.pushChanges([], legacy.tombstones, {}), []);

  const userBeforeSave = L.mergeAccount([], [row], { wo_hollow: L.userDrop(marked) });
  assert.strictEqual(userBeforeSave.workouts.length, 1);
  assert.deepStrictEqual(L.pushChanges(userBeforeSave.workouts, userBeforeSave.tombstones, userBeforeSave.ack), []);

  const userAfterSave = L.mergeAccount([wo('wo_hollow', 'Hollow Body - Shoulders - Neck', revised)], [row], {
    wo_hollow: L.userDrop(saved + 60 * 1000)
  });
  assert.ok(!userAfterSave.workouts.some(function (w) { return w.id === 'wo_hollow'; }));
  const pushed = L.pushChanges(userAfterSave.workouts, userAfterSave.tombstones, {});
  assert.strictEqual(pushed.length, 1);
  assert.strictEqual(pushed[0].deleted, true);
  assert.strictEqual(pushed[0].revisedAt, saved + 60 * 1000);
})();

(function staleDeviceKeepsAWorkoutTheAccountDoesNotHave() {
  const memory = [wo('wo_old', 'Hollow Body - Shoulders - Neck', 1000)];
  const stored = memory.concat([wo('wo_chest', 'Chest - press', 2000)]);
  const united = L.unionWorkouts(memory, stored);
  assert.deepStrictEqual(united.map(function (w) { return w.id; }), ['wo_old', 'wo_chest']);
  const open = memory[0];
  const same = L.unionWorkouts([open], [wo('wo_old', 'Renamed', 1000)]);
  assert.strictEqual(same[0], open);
  assert.strictEqual(same[0].name, 'Hollow Body - Shoulders - Neck');
  const newer = L.unionWorkouts([open], [wo('wo_old', 'Renamed', 5000, { items: [{ name: 'Press' }] })]);
  assert.strictEqual(newer[0], open);
  assert.strictEqual(open.name, 'Renamed');
  assert.strictEqual(open.updatedAt, 5000);
  assert.strictEqual(open.items[0].name, 'Press');

  const archive = L.rememberWorkouts({}, [wo('wo_chest', 'Chest - press', 2000, { items: [{ name: 'Press' }] })]);
  const restored = L.restoreArchived([], archive, { wo_chest: 3000 }, []);
  assert.strictEqual(restored[0].name, 'Chest - press');
  assert.strictEqual(restored[0].items[0].name, 'Press');
  const blocked = L.restoreArchived([], archive, { wo_chest: L.userDrop(3000) }, []);
  assert.strictEqual(blocked.length, 0);
  const deletedOnAccount = L.restoreArchived([], archive, {}, [
    remote('wo_chest', 'Chest - press', 4000, { deleted: true })
  ]);
  assert.strictEqual(deletedOnAccount.length, 0);

  const unseen = L.unseenWorkouts(
    [wo('wo_chest', 'Chest - press', 2000), wo('wo_hollow', 'Hollow Body - Shoulders - Neck', 1000)],
    [wo('wo_other', 'Other', 1)],
    [remote('wo_hollow', 'Hollow Body - Shoulders - Neck', 1000)]
  );
  assert.deepStrictEqual(unseen.map(function (w) { return w.id; }), ['wo_chest']);
})();

(function otherTabDeleteStaysDeleted() {
  const here = wo('wo_new', 'New workout', 1000);
  const drop = L.userDrop(2000);
  const reconciled = L.reconcileDevice([here], [], { wo_new: drop });
  assert.deepStrictEqual(reconciled, []);
  const merged = L.mergeAccount(reconciled, [remote('wo_new', 'New workout', 1000)], { wo_new: drop });
  assert.ok(!merged.workouts.some(function (w) { return w.id === 'wo_new'; }));
  const pushed = L.pushChanges(merged.workouts, merged.tombstones, {});
  assert.strictEqual(pushed.length, 1);
  assert.strictEqual(pushed[0].localId, 'wo_new');
  assert.strictEqual(pushed[0].deleted, true);

  const storedCopy = wo('wo_new', 'New workout', 1000);
  const notRevived = L.reconcileDevice([here], [storedCopy], { wo_new: drop });
  assert.deepStrictEqual(notRevived, []);

  const chest = wo('wo_chest', 'Chest - press', 3000);
  const kept = L.reconcileDevice([chest, here], [], { wo_new: drop });
  assert.strictEqual(kept.length, 1);
  assert.strictEqual(kept[0], chest);

  const open = wo('wo_hollow', 'Old name', 1000, { items: [{ name: 'Hold' }] });
  const fromOther = L.reconcileDevice([open], [wo('wo_hollow', 'Hollow Body', 4000, { items: [{ name: 'Hold' }, { name: 'Press' }] })], {});
  assert.strictEqual(fromOther[0], open);
  assert.strictEqual(open.name, 'Hollow Body');
  assert.strictEqual(open.items.length, 2);

  // A newer account copy keeps the object on screen. The Delete is older than that save.
  const editing = wo('wo_live', 'Old', 1000, { items: [{ name: 'Hold' }] });
  const account = remote('wo_live', 'Hollow Body', 4000, { items: [{ name: 'Hold' }, { name: 'Press' }] });
  const stillOpen = L.reconcileDevice([editing], [], { wo_live: L.userDrop(2000) }, [account]);
  assert.strictEqual(stillOpen[0], editing);
  const keptOpen = L.mergeAccount(stillOpen, [account], { wo_live: L.userDrop(2000) });
  assert.strictEqual(keptOpen.workouts[0], editing);
  assert.strictEqual(editing.name, 'Hollow Body');
  assert.strictEqual(editing.items.length, 2);
  assert.strictEqual(editing.updatedAt, 4000);
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
