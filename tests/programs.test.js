// Program permissions, scheduling, and completion. No browser, no database.
const assert = require('assert');
const P = require('../programs.js');
const M = require('../model.js');

assert.strictEqual(P.roleOf({ membership: 'master_trainer' }), 'master_trainer');
assert.strictEqual(P.roleOf({ membership: 'trainer' }), 'trainer');
assert.strictEqual(P.roleOf({ membership: 'none', intended_plan: 'trainer' }), 'trainer');
assert.strictEqual(P.roleOf({ membership: 'enthusiast', intended_plan: 'trainer' }), 'enthusiast');
assert.strictEqual(P.roleOf({ membership: 'free_client' }), 'free_client');
assert.strictEqual(P.roleOf(null), 'none');

assert.deepStrictEqual(P.buttons('free_client'), ['run', 'view']);
assert.deepStrictEqual(P.buttons('enthusiast'), ['run', 'view', 'open']);
assert.deepStrictEqual(P.buttons('none'), ['run', 'view', 'open']);
assert.deepStrictEqual(P.buttons('trainer'), ['run', 'view', 'open', 'send']);
assert.deepStrictEqual(P.buttons('master_trainer'), ['run', 'view', 'open', 'send']);
assert.ok(P.buttons('enthusiast').indexOf('send') < 0);

const self = 'me';
assert.strictEqual(P.canEdit({ role: 'enthusiast', self: self, ownerId: self }), true);
assert.strictEqual(P.canEdit({ role: 'free_client', self: self, ownerId: self }), false);
assert.strictEqual(P.canEdit({ role: 'none', self: self, ownerId: self }), true);
assert.strictEqual(P.canSee({ role: 'free_client', self: self, ownerId: self }), true);
assert.strictEqual(P.canEdit({ role: 'trainer', self: 't', ownerId: 'ada', ownerPlan: 'free_client', linked: true }), true);
assert.strictEqual(P.canEdit({ role: 'master_trainer', self: 'm', ownerId: 'ada', ownerPlan: 'free_client', linked: true }), true);
assert.strictEqual(P.canEdit({ role: 'trainer', self: 't', ownerId: 'jo', ownerPlan: 'enthusiast', linked: true, shareOn: true }), true);
assert.strictEqual(P.canSee({ role: 'trainer', self: 't', ownerId: 'jo', ownerPlan: 'enthusiast', linked: true, shareOn: true }), true);
assert.strictEqual(P.canEdit({ role: 'trainer', self: 't', ownerId: 'jo', ownerPlan: 'enthusiast', linked: true, shareOn: false }), false);
assert.strictEqual(P.canSee({ role: 'trainer', self: 't', ownerId: 'jo', ownerPlan: 'enthusiast', linked: true, shareOn: false }), false);
assert.strictEqual(P.canEdit({ role: 'trainer', self: 't', ownerId: 'ada', ownerPlan: 'free_client', linked: false }), false);
assert.strictEqual(P.canEdit({ role: 'enthusiast', self: self, ownerId: 'ada', ownerPlan: 'free_client', linked: true }), false);
assert.strictEqual(P.canSee({ role: 'trainer', self: 't', ownerId: 't' }), true);
assert.strictEqual(P.canEdit({ role: 'trainer', self: 't', ownerId: 't' }), true);
assert.strictEqual(P.canSee({ role: 'master_trainer', self: 'm', ownerId: 'm' }), true);
assert.strictEqual(P.canEdit({ role: 'master_trainer', self: 'm', ownerId: 'm' }), true);
assert.strictEqual(P.canSee({ role: 'trainer', self: 't', ownerId: '' }), true);
assert.strictEqual(P.canEdit({ role: 'trainer', self: 't', ownerId: '' }), true);

const placed = P.place([], {
  id: 'pg1', ownerId: self, workoutId: 'push', workoutName: 'Push', items: [{ name: 'Press' }], date: '2026-11-11', presence: 'solo'
});
assert.strictEqual(placed.created.presence, 'solo');
assert.strictEqual(placed.programs.length, 1);
const missingWho = P.place([], { id: 'pg0', ownerId: self, workoutId: 'push', date: '2026-11-11', start: '09:00', end: '10:00' });
assert.strictEqual(missingWho.created, null);
assert.strictEqual(missingWho.programs.length, 0);
assert.ok(missingWho.error.indexOf('Solo') !== -1);
const again = P.place(placed.programs, { id: 'pg2', ownerId: self, workoutId: 'push', date: '2026-11-11', presence: 'solo' });
assert.strictEqual(again.duplicate, true);
assert.strictEqual(again.programs.length, 1);
const parked = P.place(placed.programs, { id: 'pg9', ownerId: self, workoutId: 'push', date: '2026-11-12', presence: 'solo' });
const blocked = P.move(parked.programs, 'pg1', '2026-11-12');
assert.strictEqual(blocked.duplicate, true);
assert.strictEqual(blocked.moved, null);
assert.strictEqual(blocked.programs.filter(function (row) { return row.id === 'pg1' && row.date === '2026-11-11'; }).length, 1);
const moved = P.move(placed.programs, 'pg1', '2026-11-12');
assert.strictEqual(moved.moved.date, '2026-11-12');
assert.strictEqual(moved.duplicate, false);
const marked = P.setPresence(moved.programs, 'pg1', 'trainer');
assert.strictEqual(marked.changed.presence, 'trainer');

const entry = marked.programs[0];
const day = new Date(2026, 10, 12, 15, 0, 0).getTime();
entry.updatedAt = day - 60000;
entry.dateSetAt = day - 60000;
assert.strictEqual(P.entryDone(entry, []), false);
assert.strictEqual(P.entryDone(entry, [{ workoutId: 'push', endedAt: day, results: [] }]), false);
assert.strictEqual(P.entryDone(entry, [{ workoutId: 'push', endedAt: day, results: [{ logged: true }] }]), true);
assert.strictEqual(P.entryDone(entry, [{ workoutId: 'other', programId: 'pg1', endedAt: day, results: [{ logged: true }] }]), true);
assert.strictEqual(P.entryDone(entry, [{ workoutId: 'push', endedAt: new Date(2026, 10, 13).getTime(), results: [{ logged: true }] }]), false);
assert.strictEqual(P.dayDone(marked.programs, [{ workoutId: 'push', endedAt: day, results: [{ logged: true }] }]), true);
// A database session completes only that person's entry on the same local day.
// An earlier run does not check the original scheduled day. Moving a workout
// keeps its owner.
const adaEntry = { id: 'pg-ada', ownerId: 'ada', workoutId: 'push', date: '2026-11-12', updatedAt: Date.parse('2026-11-01T12:00:00Z') };
const remoteAda = P.sessionFromRemote({
  id: 's-ada', client_id: 'ada', local_date: '2026-11-12', workout_id: 'push', program_id: 'pg-ada', status: 'completed',
  workout_name: 'Push'
});
const remoteEarly = P.sessionFromRemote({
  id: 's-early', client_id: 'ada', local_date: '2026-11-10', workout_id: 'push', program_id: 'pg-ada', status: 'ended_early',
  workout_name: 'Push', started_at: '2026-11-10T15:00:00Z', ended_at: '2026-11-10T16:00:00Z'
});
const remoteOtherDay = P.sessionFromRemote({
  id: 's-other', client_id: 'ada', local_date: '2026-11-13', workout_id: 'push', status: 'completed'
});
assert.strictEqual(P.localDay(remoteAda.endedAt), '2026-11-12');
assert.strictEqual(P.sessionDay(remoteAda), '2026-11-12');
assert.strictEqual(remoteAda.workoutName, 'Push');
assert.strictEqual(P.entryDone(adaEntry, [remoteAda]), true);
assert.strictEqual(P.entryDone(entry, [remoteAda]), false);
assert.strictEqual(P.entryDone(adaEntry, [remoteEarly]), false);
assert.strictEqual(P.entryDone(adaEntry, [remoteOtherDay]), false);
assert.strictEqual(P.sessionFromRemote({ client_id: 'ada', local_date: '2026-11-12', workout_id: 'push', status: 'in_progress' }), null);
assert.strictEqual(P.entryDone(adaEntry, [{ workoutId: 'push', endedAt: day, results: [{ logged: true }] }]), true);
const movedBefore = { id: 'pg-ada', ownerId: 'ada', workoutId: 'push', date: '2026-11-10', dateSetAt: Date.parse('2026-11-10T08:00:00Z'), updatedAt: Date.parse('2026-11-10T20:00:00Z') };
assert.strictEqual(P.entryDone(movedBefore, [remoteEarly]), true);
const movedAfter = { id: 'pg-ada', ownerId: 'ada', workoutId: 'push', date: '2026-11-10', dateSetAt: Date.parse('2026-11-10T18:00:00Z'), updatedAt: Date.parse('2026-11-10T08:00:00Z') };
assert.strictEqual(P.entryDone(movedAfter, [remoteEarly]), false);
const touched = P.setPresence([Object.assign({}, movedBefore, { id: 'pg-ada', presence: 'solo' })], 'pg-ada', 'trainer');
assert.strictEqual(touched.changed.dateSetAt, movedBefore.dateSetAt);
assert.ok(touched.changed.updatedAt > movedBefore.updatedAt);
assert.strictEqual(P.entryDone(touched.changed, [remoteEarly]), true);
const retimed = P.setTimes([touched.changed], 'pg-ada', '09:00', '10:00');
assert.strictEqual(retimed.changed.dateSetAt, movedBefore.dateSetAt);
assert.strictEqual(P.entryDone(retimed.changed, [remoteEarly]), true);
const relocated = P.move([retimed.changed], 'pg-ada', '2026-11-18');
assert.ok(relocated.moved.dateSetAt > retimed.changed.dateSetAt);
assert.strictEqual(relocated.moved.date, '2026-11-18');
const adaScope = { owners: ['ada'], selfId: 'ada' };
assert.strictEqual(P.unscheduledOn('2026-11-10', [adaEntry], [remoteEarly], adaScope).length, 1);
assert.strictEqual(P.unscheduledOn('2026-11-10', [adaEntry], [remoteEarly], adaScope)[0].workoutName, 'Push');
assert.strictEqual(P.unscheduledOn('2026-11-12', [adaEntry], [remoteEarly], adaScope).length, 0);
assert.strictEqual(P.unscheduledOn('2026-11-10', [movedBefore], [remoteEarly], adaScope).length, 0);
assert.strictEqual(P.unscheduledOn('2026-11-10', [movedAfter], [remoteEarly], adaScope).length, 1);
assert.strictEqual(P.unscheduledOn('2026-11-10', [adaEntry], [remoteEarly], { owners: ['trainer'], selfId: 'trainer' }).length, 0);
const deviceRun = { id: 'ses-me', workoutId: 'push', workoutName: 'Push', startedAt: day, endedAt: day, results: [{ logged: true }] };
assert.strictEqual(P.unscheduledOn('2026-11-12', [], [deviceRun], { owners: ['ada'], selfId: 'trainer' }).length, 0);
assert.strictEqual(P.unscheduledOn('2026-11-12', [], [deviceRun], { owners: ['trainer'], selfId: 'trainer' }).length, 1);
assert.strictEqual(P.unscheduledOn('2026-11-12', [], [deviceRun, Object.assign({}, deviceRun, { remote: true, clientId: 'trainer' })], { owners: ['trainer'], selfId: 'trainer' }).length, 1);
const earlyLocal = { id: 'ses-early', workoutId: 'push', workoutName: 'Push', programId: 'pg-ada', localDate: '2026-11-10', startedAt: Date.parse('2026-11-10T15:00:00Z'), endedAt: Date.parse('2026-11-10T16:00:00Z'), results: [{ logged: true }] };
assert.strictEqual(P.shouldSuggestReschedule('enthusiast', earlyLocal, [adaEntry]), true);
assert.strictEqual(P.shouldSuggestReschedule('free_client', earlyLocal, [adaEntry]), true);
assert.strictEqual(P.shouldSuggestReschedule('trainer', earlyLocal, [adaEntry]), false);
assert.strictEqual(P.shouldSuggestReschedule('master_trainer', earlyLocal, [adaEntry]), false);
assert.strictEqual(P.shouldSuggestReschedule('enthusiast', earlyLocal, [movedBefore]), false);
assert.strictEqual(P.shouldSuggestReschedule('enthusiast', { workoutId: 'push', results: [] }, [adaEntry]), false);
const keptOwner = P.move([adaEntry], 'pg-ada', '2026-11-18');
assert.strictEqual(keptOwner.moved.ownerId, 'ada');
assert.strictEqual(keptOwner.moved.date, '2026-11-18');
const sameDay = [{ id: 'pg1', ownerId: self, workoutId: 'push', workoutName: 'Push', date: '2026-11-12', presence: 'solo', dateSetAt: 1000, updatedAt: 1000, synced: true }];
const timeEdit = P.merge(sameDay, [{
  local_id: 'pg1', owner_id: self, workout_local_id: 'push', workout_name: 'Push', day: '2026-11-12', presence: 'trainer', updated_at: new Date(5000).toISOString()
}], self, {});
const keptStamp = timeEdit.filter(function (row) { return row.id === 'pg1'; })[0];
assert.strictEqual(keptStamp.presence, 'trainer');
assert.strictEqual(keptStamp.dateSetAt, 1000);
const dayMove = P.merge(sameDay, [{
  local_id: 'pg1', owner_id: self, workout_local_id: 'push', workout_name: 'Push', day: '2026-11-10', presence: 'solo', updated_at: new Date(9000).toISOString()
}], self, {});
const movedStamp = dayMove.filter(function (row) { return row.id === 'pg1'; })[0];
assert.strictEqual(movedStamp.date, '2026-11-10');
assert.strictEqual(movedStamp.dateSetAt, 9000);

assert.strictEqual(P.validTimes('10:00', '09:00').ok, false);
assert.strictEqual(P.validTimes('10:00', '10:00').ok, false);
assert.strictEqual(P.validTimes('9:60', '10:00').ok, false);
assert.strictEqual(P.validTimes('', '10:00').ok, false);
assert.ok(P.validTimes('10:00', '09:00').error.indexOf('after') !== -1);
const okTimes = P.validTimes('9:00', '10:30');
assert.strictEqual(okTimes.ok, true);
assert.strictEqual(okTimes.start, '09:00');
assert.strictEqual(okTimes.end, '10:30');
assert.strictEqual(P.formatRange('09:00', '10:30'), '9:00–10:30 AM');
assert.strictEqual(P.formatRange('09:00', '13:00'), '9:00 AM–1:00 PM');
assert.strictEqual(P.formatRange('13:15', '14:45'), '1:15–2:45 PM');

assert.deepStrictEqual(P.clock12('00:00'), { text: '12:00', ap: 'AM' });
assert.deepStrictEqual(P.clock12('00:15'), { text: '12:15', ap: 'AM' });
assert.deepStrictEqual(P.clock12('09:05'), { text: '09:05', ap: 'AM' });
assert.deepStrictEqual(P.clock12('12:00'), { text: '12:00', ap: 'PM' });
assert.deepStrictEqual(P.clock12('13:05'), { text: '01:05', ap: 'PM' });
assert.deepStrictEqual(P.clock12('18:30'), { text: '06:30', ap: 'PM' });
assert.deepStrictEqual(P.clock12('23:59'), { text: '11:59', ap: 'PM' });
assert.strictEqual(P.clock12(''), null);
assert.strictEqual(P.clock12('24:00'), null);

assert.strictEqual(P.clock24('12:00', 'AM').value, '00:00');
assert.strictEqual(P.clock24('12:30', 'am').value, '00:30');
assert.strictEqual(P.clock24('1:05', 'AM').value, '01:05');
assert.strictEqual(P.clock24('9:00', 'AM').value, '09:00');
assert.strictEqual(P.clock24('09:00', 'AM').value, '09:00');
assert.strictEqual(P.clock24('12:00', 'PM').value, '12:00');
assert.strictEqual(P.clock24('1:15', 'PM').value, '13:15');
assert.strictEqual(P.clock24('6:30', 'PM').value, '18:30');
assert.strictEqual(P.clock24('10:30', 'pm').value, '22:30');
assert.strictEqual(P.clock24('11:59', 'PM').value, '23:59');
assert.strictEqual(P.clock24('0800', 'PM').value, '20:00');
assert.strictEqual(P.clock24('930', 'AM').value, '09:30');
assert.strictEqual(P.clock24('', 'AM').empty, true);
assert.strictEqual(P.clock24('', 'AM').ok, false);
assert.strictEqual(P.clock24('13:00', 'PM').ok, false);
assert.strictEqual(P.clock24('0:30', 'AM').ok, false);
assert.strictEqual(P.clock24('00:30', 'AM').ok, false);
assert.strictEqual(P.clock24('9:60', 'AM').ok, false);
assert.strictEqual(P.clock24('9:5', 'AM').ok, false);
assert.strictEqual(P.clock24('10:0', 'AM').ok, false);
assert.strictEqual(P.clock24('9:00', '').ok, false);
assert.strictEqual(P.clock24('9:00', 'NO').ok, false);
assert.strictEqual(P.clock24('100', 'AM').ok, false);
const evening = P.validTimes(P.clock24('6:30', 'PM').value, P.clock24('7:45', 'PM').value);
assert.strictEqual(evening.ok, true);
assert.strictEqual(evening.start, '18:30');
assert.strictEqual(evening.end, '19:45');
const overnight = P.validTimes(P.clock24('11:00', 'PM').value, P.clock24('1:00', 'AM').value);
assert.strictEqual(overnight.ok, false);
const afternoon = P.clock24('4:00', 'PM');
assert.strictEqual(afternoon.value, '16:00');
assert.strictEqual(P.validTimes(afternoon.value, '17:00').start, '16:00');
assert.strictEqual(P.shapeClock('630'), '6:30');
assert.strictEqual(P.shapeClock('0630'), '06:30');
assert.strictEqual(P.shapeClock('1000'), '10:00');
assert.strictEqual(P.shapeClock('100'), '10:0');
assert.strictEqual(P.shapeClock('130'), '1:30');
assert.strictEqual(P.shapeClock('930'), '9:30');
assert.strictEqual(P.shapeClock('9:00'), '9:00');
assert.strictEqual(P.shapeClock('12:345'), '12:34');
assert.strictEqual(P.shapeClock(''), '');
assert.strictEqual(P.shapeClock('abc'), '');

const badTime = P.place([], { id: 'bad', ownerId: self, workoutId: 'push', date: '2026-11-11', start: '18:00', end: '17:00' });
assert.strictEqual(badTime.created, null);
assert.strictEqual(badTime.programs.length, 0);
assert.ok(badTime.error);
const timed = P.place(placed.programs, {
  id: 'pg3', ownerId: self, workoutId: 'legs', workoutName: 'Legs', date: '2026-11-11', start: '14:00', end: '15:00', presence: 'solo'
});
assert.strictEqual(timed.created.start, '14:00');
assert.strictEqual(timed.created.end, '15:00');
const early = P.place(timed.programs, {
  id: 'pg4', ownerId: self, workoutId: 'core', workoutName: 'Core', date: '2026-11-11', start: '07:30', end: '08:00', presence: 'trainer'
});
const ordered = P.byStart(early.programs.filter(function (row) { return row.date === '2026-11-11'; }));
assert.deepStrictEqual(ordered.map(function (row) { return row.id; }), ['pg4', 'pg3', 'pg1']);
const shifted = P.setTimes(early.programs, 'pg3', '6:00', '7:00');
assert.strictEqual(shifted.changed.start, '06:00');
assert.strictEqual(shifted.changed.end, '07:00');
assert.deepStrictEqual(P.byStart(shifted.programs.filter(function (row) { return row.date === '2026-11-11'; })).map(function (row) { return row.id; }), ['pg3', 'pg4', 'pg1']);
const rejected = P.setTimes(shifted.programs, 'pg3', '12:00', '11:00');
assert.strictEqual(rejected.changed, null);
assert.strictEqual(rejected.programs.filter(function (row) { return row.id === 'pg3'; })[0].start, '06:00');
const sameTimes = P.setTimes(shifted.programs, 'pg3', '06:00', '07:00');
assert.strictEqual(sameTimes.changed, null);
assert.strictEqual(sameTimes.error, '');
const removed = P.remove(shifted.programs, 'pg4');
assert.strictEqual(removed.removed.id, 'pg4');
assert.strictEqual(removed.programs.some(function (row) { return row.id === 'pg4'; }), false);

assert.deepStrictEqual(P.entryMenu({ role: 'free_client', self: self, ownerId: self }), ['run', 'view']);
assert.ok(P.entryMenu({ role: 'free_client', self: self, ownerId: self }).indexOf('remove') < 0);
assert.ok(P.entryMenu({ role: 'free_client', self: self, ownerId: self }).indexOf('add') < 0);
assert.deepStrictEqual(P.entryMenu({ role: 'enthusiast', self: self, ownerId: self }), ['run', 'view', 'remove', 'add']);
assert.deepStrictEqual(P.entryMenu({ role: 'trainer', self: 't', ownerId: 'ada', ownerPlan: 'free_client', linked: true }), ['run', 'view', 'remove', 'add']);
assert.deepStrictEqual(P.entryMenu({ role: 'master_trainer', self: 'm', ownerId: 'ada', ownerPlan: 'free_client', linked: true }), ['run', 'view', 'remove', 'add']);
assert.deepStrictEqual(P.entryMenu({ role: 'trainer', self: 't', ownerId: 'jo', ownerPlan: 'enthusiast', linked: true, shareOn: true }), ['run', 'view', 'remove', 'add']);
assert.deepStrictEqual(P.entryMenu({ role: 'master_trainer', self: 'm', ownerId: 'jo', ownerPlan: 'enthusiast', linked: true, shareOn: true }), ['run', 'view', 'remove', 'add']);
assert.deepStrictEqual(P.entryMenu({ role: 'trainer', self: 't', ownerId: 'jo', ownerPlan: 'enthusiast', linked: true, shareOn: false }), []);
assert.deepStrictEqual(P.entryMenu({ role: 'enthusiast', self: self, ownerId: 'ada', linked: true }), []);
assert.deepStrictEqual(P.entryMenu({ role: 'trainer', self: 't', ownerId: 't' }), ['run', 'view', 'remove', 'add']);
assert.deepStrictEqual(P.entryMenu({ role: 'master_trainer', self: 'm', ownerId: 'm' }), ['run', 'view', 'remove', 'add']);

const keptTimes = P.merge(shifted.programs, [{
  local_id: 'pg3', owner_id: self, workout_local_id: 'legs', workout_name: 'Legs', items: [], day: '2026-11-20', presence: 'solo', updated_at: new Date(Date.now() + 120000).toISOString()
}], self, { keepLocalTimes: true });
const keptRow = keptTimes.filter(function (row) { return row.id === 'pg3'; })[0];
assert.strictEqual(keptRow.date, '2026-11-20');
assert.strictEqual(keptRow.start, '06:00');
assert.strictEqual(keptRow.end, '07:00');
const remoteTimes = P.merge(shifted.programs, [{
  local_id: 'pg3', owner_id: self, workout_local_id: 'legs', workout_name: 'Legs', items: [], day: '2026-11-21', presence: 'solo', starts_at: '11:00:00', ends_at: '12:15:00', updated_at: new Date(Date.now() + 180000).toISOString()
}], self);
const remoteRow = remoteTimes.filter(function (row) { return row.id === 'pg3'; })[0];
assert.strictEqual(remoteRow.start, '11:00');
assert.strictEqual(remoteRow.end, '12:15');

const remote = P.merge(marked.programs, [{
  local_id: 'pg1', owner_id: self, workout_local_id: 'push', workout_name: 'Push', items: [], day: '2026-11-13', presence: 'solo', updated_at: new Date(Date.now() + 60000).toISOString()
}], self);
assert.strictEqual(remote[0].date, '2026-11-13');
const blankPresence = P.fromRemote({ local_id: 'old', owner_id: self, workout_local_id: 'push', day: '2026-11-11' });
assert.strictEqual(blankPresence.presence, 'solo');
assert.strictEqual(P.isUuid('11111111-1111-4111-8111-111111111111'), true);
assert.strictEqual(P.isUuid('allow-test'), false);

const syncedOnly = [{ id: 'pg1', ownerId: self, workoutId: 'push', workoutName: 'Push', date: '2026-11-11', start: '09:00', end: '10:00', presence: 'solo', synced: true, updatedAt: 10 }];
const pendingOnly = [{ id: 'pg2', ownerId: self, workoutId: 'legs', workoutName: 'Legs', date: '2026-11-12', presence: 'solo', pending: true, updatedAt: 20 }];
const someoneElse = [{ id: 'pgX', ownerId: 'ada', workoutId: 'push', workoutName: 'Push', date: '2026-11-11', presence: 'solo', synced: true, updatedAt: 10 }];
const afterDelete = P.merge(syncedOnly.concat(pendingOnly).concat(someoneElse), [], self, {});
assert.strictEqual(afterDelete.some(function (row) { return row.id === 'pg1'; }), false);
assert.strictEqual(afterDelete.some(function (row) { return row.id === 'pg2'; }), true);
assert.strictEqual(afterDelete.some(function (row) { return row.id === 'pgX'; }), true);
const tombstoned = P.merge(syncedOnly, [{
  local_id: 'pg1', owner_id: self, workout_local_id: 'push', workout_name: 'Push', items: [], day: '2026-11-11', presence: 'solo', updated_at: new Date(5).toISOString()
}], self, { dropped: { pg1: 50 } });
assert.strictEqual(tombstoned.some(function (row) { return row.id === 'pg1'; }), false);
const revived = P.merge([], [{
  local_id: 'pg1', owner_id: self, workout_local_id: 'push', workout_name: 'Push', items: [], day: '2026-11-11', presence: 'solo', updated_at: new Date(80).toISOString()
}], self, { dropped: { pg1: 50 } });
assert.strictEqual(revived.some(function (row) { return row.id === 'pg1' && row.synced === true; }), true);
const legacy = P.merge([{ id: 'old', ownerId: self, workoutId: 'push', workoutName: 'Push', date: '2026-11-11', presence: 'solo', updatedAt: 1 }], [], self, {});
assert.strictEqual(legacy.length, 1);
assert.strictEqual(legacy[0].pending, true);
assert.deepStrictEqual(P.settleDrops({ pg1: 50 }, [{ local_id: 'pg1' }], [], self), { pg1: 50 });
assert.deepStrictEqual(P.settleDrops({ pg1: 50 }, [], [], self), {});
const otherOwner = { pgAda: { at: 50, ownerId: 'ada' }, pg1: { at: 50, ownerId: self } };
assert.deepStrictEqual(P.settleDrops(otherOwner, [], [], self), { pgAda: { at: 50, ownerId: 'ada' } });
const pendingTimes = [{
  id: 'pg1', ownerId: self, workoutId: 'push', workoutName: 'Push', date: '2026-11-11',
  start: '09:00', end: '10:30', presence: 'solo', pending: true, synced: true, updatedAt: 1000
}];
const serverWithoutTimes = [{
  local_id: 'pg1', owner_id: self, workout_local_id: 'push', workout_name: 'Push', items: [],
  day: '2026-11-11', presence: 'solo', starts_at: null, ends_at: null, updated_at: new Date(5000).toISOString()
}];
const keptPending = P.merge(pendingTimes, serverWithoutTimes, self, { keepLocalTimes: true }).filter(function (row) { return row.id === 'pg1'; })[0];
assert.strictEqual(keptPending.pending, true);
assert.strictEqual(keptPending.start, '09:00');
assert.strictEqual(keptPending.end, '10:30');
const afterSql = P.merge([keptPending], serverWithoutTimes, self, {}).filter(function (row) { return row.id === 'pg1'; })[0];
assert.strictEqual(afterSql.pending, true);
assert.strictEqual(afterSql.start, '09:00');
assert.strictEqual(afterSql.end, '10:30');
const inviteLocal = [{
  id: 'pg9', ownerId: self, workoutId: 'circuit', workoutName: 'Saturday class', date: '2026-11-12',
  presence: 'trainer', synced: true, updatedAt: 10,
  invites: ['22222222-2222-4222-8222-222222222222'], invitesPending: true
}];
const inviteRemote = [{
  local_id: 'pg9', owner_id: self, workout_local_id: 'circuit', workout_name: 'Saturday class', items: [],
  day: '2026-11-12', presence: 'trainer', updated_at: new Date(50).toISOString()
}];
const inviteKept = P.merge(inviteLocal, inviteRemote, self, {}).filter(function (row) { return row.id === 'pg9'; })[0];
assert.strictEqual(inviteKept.invitesPending, true);
assert.deepStrictEqual(inviteKept.invites, ['22222222-2222-4222-8222-222222222222']);
assert.ok(!inviteKept.pending);
assert.strictEqual(P.staleWrite(null, { pg1: 1 }, 'pg1', []), true);
assert.strictEqual(P.staleWrite({ timesLocal: true }, { pg1: 1 }, 'pg1', []), true);
assert.strictEqual(P.staleWrite(new Error('offline'), { pg1: 1 }, 'pg1', []), false);
assert.strictEqual(P.staleWrite({ timesLocal: true }, { pg1: 1 }, 'pg1', [{ id: 'pg1' }]), false);
assert.strictEqual(P.staleWrite({ timesLocal: true }, {}, 'pg1', []), false);

const stored = M.emptyData();
assert.ok(Array.isArray(stored.programs));
const mem = { s: {}, getItem: function (k) { return this.s[k] || null; }, setItem: function (k, v) { this.s[k] = v; } };
mem.setItem(M.STORAGE_KEY, JSON.stringify({ version: 1, workouts: stored.workouts }));
const loaded = M.load(mem);
assert.ok(Array.isArray(loaded.programs));
assert.strictEqual(loaded.programs.length, 0);

console.log('PROGRAMS OK');
