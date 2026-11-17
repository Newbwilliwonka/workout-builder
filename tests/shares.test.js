// Shared dashboard order, frozen cards, and unread count.
// Sample rows stay in this test. No database.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const D = require('../dashboard.js');
const H = require('../history.js');
const S = require('../shares.js');
global.WBDashboard = D;

const NOW = new Date(2026, 10, 16, 12, 0, 0);
const appSrc = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const authSrc = fs.readFileSync(path.join(__dirname, '../auth.js'), 'utf8');
const dashSrc = fs.readFileSync(path.join(__dirname, '../dashboard.js'), 'utf8');
const shareSrc = fs.readFileSync(path.join(__dirname, '../shares.js'), 'utf8');
const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261116150000_shared_dashboards.sql'), 'utf8');

assert.deepStrictEqual(S.standard(), ['plan', 'workouts', 'strength', 'volume', 'records', 'calendar', 'holds', 'stopwatch']);
assert.deepStrictEqual(S.orderOf(['pass', 'plan', 'plan', 'nope', 'holds']), ['pass', 'plan', 'holds']);
assert.deepStrictEqual(S.addCard(S.standard(), 'pass'), S.standard().concat(['pass']));
assert.deepStrictEqual(S.addCard(S.standard().concat(['pass']), 'pass').length, 9);
assert.deepStrictEqual(S.removeCard(['plan', 'records', 'pass'], 'records'), ['plan', 'pass']);
assert.deepStrictEqual(S.moveCard(['plan', 'volume', 'records'], 'volume', -1), ['volume', 'plan', 'records']);
assert.deepStrictEqual(S.moveCard(['plan'], 'plan', -1), ['plan']);
assert.deepStrictEqual(S.moveBefore(['plan', 'volume', 'records'], 'records', 'plan'), ['records', 'plan', 'volume']);

const shares = [
  { id: 'b', created_at: '2026-11-10T12:00:00.000Z', viewed_at: null },
  { id: 'a', created_at: '2026-11-16T12:00:00.000Z', viewed_at: null },
  { id: 'c', created_at: '2026-11-16T12:00:00.000Z', viewed_at: '2026-11-16T13:00:00.000Z' }
];
assert.deepStrictEqual(S.byNewest(shares).map(function (row) { return row.id; }), ['c', 'a', 'b']);
assert.strictEqual(S.unread(shares), 2);
shares.push({ id: 'd', created_at: '2026-11-17T12:00:00.000Z' });
assert.strictEqual(S.unread(shares), 3, 'each new unopened share raises the count');

const remote = require('./history-fixture').remoteHistory();
const sets = H.fromRows(remote.sessions, remote.sets, remote.exercises);
const live = D.build({ sets: sets, sessions: remote.sessions, entries: [], now: NOW, layout: true });
assert.strictEqual(live.pass.passes, 5);
assert.strictEqual(live.pass.total, 8);
assert.strictEqual(live.pass.pct, 63);
assert.strictEqual(live.workouts.streak, null);

const frozen = D.freeze(live, S.addCard(S.standard(), 'pass'), { asOf: '2026-11-16', trainerName: 'Coach Lee' });
live.plan.pct = 1;
live.plan.rating = { label: 'Changed', color: '#000000' };
live.pass.pct = 1;
assert.strictEqual(frozen.cards[0].plan.pct, 65);
assert.strictEqual(frozen.cards[0].plan.rating.label, 'Keep trying');
assert.strictEqual(frozen.cards[8].pass.pct, 63);
assert.strictEqual(frozen.cards[6].type, 'holds');
assert.strictEqual(frozen.cards[7].type, 'stopwatch');
assert.strictEqual(frozen.cards[2].type, 'strength');
assert.strictEqual(frozen.cards[1].scheduleNote, true);
assert.strictEqual(D.stampText(frozen), 'As of November 16, 2026 from Coach Lee');
assert.strictEqual(D.stampText({ asOf: '2026-11-16', trainerName: 'coach@example.com' }), 'As of November 16, 2026 from Trainer');
assert.strictEqual(D.stampText({ trainerName: 'ada@example.com' }), 'From Trainer');
const leaked = D.freeze(live, ['plan'], { asOf: '2026-11-16', trainerName: 'coach@example.com' });
assert.strictEqual(leaked.trainerName, 'Trainer');
assert.ok(D.snapshotHtml(leaked).indexOf('@') < 0);
assert.ok(D.snapshotHtml({ asOf: '2026-11-16', trainerName: 'sam@example.com', cards: [] }).indexOf('sam@') < 0);

const page = D.snapshotHtml(frozen);
assert.ok(page.indexOf('As of November 16, 2026 from Coach Lee') >= 0);
assert.ok(page.indexOf('id="dashboard-pass-pct"') >= 0);
assert.ok(page.indexOf('Schedule workouts in the program calendar.') >= 0);
assert.ok(page.indexOf('<button') < 0);
assert.ok(page.indexOf('<input') < 0);
assert.ok(page.indexOf('Changed') < 0);

const editor = D.editorHtml(live, S.standard());
assert.ok(editor.indexOf('id="dash-share"') >= 0);
assert.ok(editor.indexOf('id="dash-edit"') >= 0);
assert.ok(editor.indexOf('id="dash-reset"') >= 0);
assert.ok(editor.indexOf('>Reset<') >= 0);
assert.ok(editor.indexOf('Reset to standard') < 0);
assert.ok(editor.indexOf('id="dash-add"') < 0);
assert.ok(editor.indexOf('id="dash-save"') < 0);
assert.ok(editor.indexOf('data-drag') < 0);
assert.ok(editor.indexOf('>Drag<') < 0);
const held = D.editorHtml(live, S.standard(), { share: false });
assert.ok(held.indexOf('id="dash-share"') < 0);
assert.ok(held.indexOf('This client keeps their own live dashboard.') >= 0);
const selfEdit = D.editorHtml(live, ['plan'], { self: true });
assert.ok(selfEdit.indexOf('id="dash-reset"') >= 0);
assert.ok(selfEdit.indexOf('id="dash-share"') < 0);
assert.ok(selfEdit.indexOf('data-card-add="strength"') < 0);
assert.ok(selfEdit.indexOf('This client keeps their own live dashboard.') < 0);
assert.ok(selfEdit.indexOf('>Reset<') >= 0);
assert.ok(selfEdit.indexOf('Reset to standard') < 0);
const editing = D.editorHtml(live, S.standard(), { editing: true });
assert.ok(editing.indexOf('id="dash-save"') >= 0);
assert.ok(editing.indexOf('id="dash-add"') >= 0);
assert.ok(editing.indexOf('Stopwatch pass rate') >= 0);
assert.ok(editing.indexOf('data-card-up="volume"') >= 0);
assert.ok(editing.indexOf('data-card-remove="plan"') >= 0);
assert.ok(editing.indexOf('data-drag') < 0);
assert.ok(editing.indexOf('>Drag<') < 0);
assert.ok(/data-card-up="plan"[^>]*disabled/.test(editing));
assert.ok(/data-card-down="stopwatch"[^>]*disabled/.test(editing));
assert.ok(!/data-card-down="calendar"[^>]*disabled/.test(editing));
assert.ok(!/data-card-up="volume"[^>]*disabled/.test(editing));
const selfEditing = D.editorHtml(live, ['plan'], { self: true, editing: true });
assert.ok(selfEditing.indexOf('data-card-add="strength"') >= 0);
assert.ok(selfEditing.indexOf('id="dash-save"') >= 0);
assert.ok(/data-card-up="plan"[^>]*disabled/.test(selfEditing));
assert.ok(/data-card-down="plan"[^>]*disabled/.test(selfEditing));
assert.ok(editor.indexOf('Schedule workouts in the program calendar.') >= 0);
assert.ok(editor.indexOf('id="dashboard-pass"') < 0);
assert.ok(editing.indexOf('id="dashboard-pass"') < 0);
const own = D.html(D.build({ sets: sets, sessions: remote.sessions, now: NOW }));
assert.ok(own.indexOf('Schedule workouts in the program calendar.') < 0);
assert.ok(own.indexOf('pass rate') < 0);
assert.ok(own.indexOf('<button') < 0);

assert.ok(!/Coach Lee|Ada Client|Example data|sampleSets/.test(dashSrc + shareSrc + appSrc));
assert.ok(/Sharing is not available yet/.test(appSrc));
assert.ok(/shareTableMissing/.test(authSrc));
assert.ok(/shared_dashboards/.test(authSrc));
assert.ok(/clientTracking/.test(authSrc));
assert.ok(/MarkShareViewed|markShareViewed/.test(authSrc));
assert.ok(/data-trainer/.test(appSrc));
assert.ok(/#\/subscriptions/.test(appSrc));
assert.ok(/The Trainer Hub is coming soon/.test(appSrc));
assert.ok(/tracking_clear_client/.test(sql));
assert.ok(/delete from public\.workout_sessions/.test(sql));
assert.ok(/delete from public\.workout_sets/.test(sql));
assert.ok(/delete from public\.personal_exercises/.test(sql));
assert.ok(/delete from public\.shared_dashboards/.test(sql));
const clearAt = sql.indexOf('delete from public.workout_sessions');
assert.ok(clearAt < sql.indexOf('delete from public.workout_sets'));
assert.ok(sql.indexOf('delete from public.workout_sets') < sql.indexOf('delete from public.personal_exercises'));
assert.ok(sql.indexOf('delete from public.personal_exercises') < sql.indexOf('delete from public.shared_dashboards'));
assert.ok(/only with a connected client/.test(sql));
assert.ok(/A shared dashboard goes to a free client/.test(sql));
assert.ok(/'membership', p\.membership/.test(sql));
assert.ok(/Shared dashboards could not be loaded/.test(appSrc));
assert.ok(/Only the client can open/.test(sql));

const inboxSql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261116180000_share_inbox_any_client.sql'), 'utf8');
assert.ok(/create or replace function private\.share_inbox\(client uuid\)/.test(inboxSql));
assert.ok(/security definer/.test(inboxSql));
assert.ok(/set search_path = ''/.test(inboxSql));
assert.ok(/from public\.profiles/.test(inboxSql));
assert.ok(/where id = client/.test(inboxSql));
assert.ok(!/free_client/.test(inboxSql));
assert.ok(!/membership in/.test(inboxSql));
assert.ok(/revoke all on function private\.share_inbox\(uuid\) from public, anon, authenticated/.test(inboxSql));
assert.ok(/Shared by your trainer/.test(appSrc));
assert.ok(/Could not share that dashboard/.test(appSrc));
assert.ok(!/This client keeps their own live dashboard/.test(appSrc));
assert.ok(!/membership === 'enthusiast' \|\| membership === 'trainer'/.test(appSrc));

console.log('SHARES OK');
