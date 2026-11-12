/* Program calendar rules. No network. Browser: window.WBPrograms. Node: require.
   A program is a workout placed on a day. Completion comes from tracked sessions. */
(function (root) {
  'use strict';

  function roleOf(profile) {
    if (!profile) return 'none';
    var m = profile.membership;
    var plan = profile.intended_plan;
    if (m === 'master_trainer') return 'master_trainer';
    if (m === 'trainer') return 'trainer';
    if (m === 'enthusiast') return 'enthusiast';
    if (m === 'free_client') return 'free_client';
    if (plan === 'master_trainer') return 'master_trainer';
    if (plan === 'trainer') return 'trainer';
    if (plan === 'enthusiast') return 'enthusiast';
    return 'none';
  }
  function isTrainer(role) { return role === 'trainer' || role === 'master_trainer'; }
  function buttons(role) {
    if (isTrainer(role)) return ['run', 'view', 'open', 'send'];
    if (role === 'free_client') return ['run', 'view'];
    return ['run', 'view', 'open'];
  }
  function ownerPlanOf(client) {
    if (!client) return 'free_client';
    if (client.enthusiast === true || client.ownerPlan === 'enthusiast') return 'enthusiast';
    var plan = String(client.plan || '').toLowerCase();
    if (plan.indexOf('enthusiast') >= 0) return 'enthusiast';
    return 'free_client';
  }
  function viewingSelf(ctx) {
    return !ctx || !ctx.ownerId || ctx.ownerId === ctx.self || ctx.ownerId === 'self';
  }
  // ctx: { role, self, ownerId, ownerPlan, linked, shareOn }
  function canSee(ctx) {
    ctx = ctx || {};
    if (viewingSelf(ctx)) return !isTrainer(ctx.role);
    if (!isTrainer(ctx.role) || ctx.linked !== true) return false;
    if (ownerPlanOf(ctx) === 'enthusiast') return ctx.shareOn === true;
    return true;
  }
  function canEdit(ctx) {
    ctx = ctx || {};
    if (viewingSelf(ctx)) {
      if (ctx.role === 'free_client' || isTrainer(ctx.role)) return false;
      return true;
    }
    if (!canSee(ctx)) return false;
    return isTrainer(ctx.role);
  }
  function isUuid(id) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ''));
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDate(value) {
    var parts = String(value || '').split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }
  function isDay(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')); }
  function weekStart(value) {
    var d = parseDate(value);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }
  function localDay(ts) {
    var t = typeof ts === 'number' ? ts : Date.parse(ts);
    if (!isFinite(t)) return '';
    return iso(new Date(t));
  }
  function presence(value) { return value === 'trainer' ? 'trainer' : 'solo'; }
  function copyItems(items) {
    if (!Array.isArray(items)) return [];
    try { return JSON.parse(JSON.stringify(items)); } catch (e) { return []; }
  }
  function forOwner(programs, ownerId) {
    return (programs || []).filter(function (row) { return row && row.ownerId === ownerId; });
  }
  function place(programs, entry) {
    var list = Array.isArray(programs) ? programs.slice() : [];
    if (!entry || !entry.workoutId) return { programs: list, created: null, duplicate: false, error: 'Pick a workout.' };
    if (!isDay(entry.date)) return { programs: list, created: null, duplicate: false, error: 'Pick a day.' };
    var start = '';
    var end = '';
    if (entry.start || entry.end) {
      var times = validTimes(entry.start, entry.end);
      if (!times.ok) return { programs: list, created: null, duplicate: false, error: times.error };
      start = times.start;
      end = times.end;
    }
    var date = String(entry.date);
    var ownerId = entry.ownerId || 'self';
    var workoutId = String(entry.workoutId);
    var duplicate = list.some(function (row) {
      return row && row.ownerId === ownerId && row.workoutId === workoutId && row.date === date;
    });
    if (duplicate) return { programs: list, created: null, duplicate: true, error: '' };
    var row = {
      id: entry.id,
      ownerId: ownerId,
      workoutId: workoutId,
      workoutName: entry.workoutName || 'Workout',
      items: copyItems(entry.items),
      date: date,
      start: start,
      end: end,
      presence: presence(entry.presence),
      updatedAt: entry.updatedAt || Date.now(),
      pending: true
    };
    list.push(row);
    return { programs: list, created: row, duplicate: false, error: '' };
  }
  function move(programs, id, date) {
    var list = programs || [];
    if (!isDay(date)) return { programs: list, moved: null, duplicate: false, error: 'Pick a day.' };
    var current = null;
    list.forEach(function (row) { if (row && row.id === id) current = row; });
    if (!current || current.date === date) return { programs: list, moved: null, duplicate: false, error: '' };
    var duplicate = list.some(function (row) {
      return row && row.id !== id && row.ownerId === current.ownerId && row.workoutId === current.workoutId && row.date === date;
    });
    if (duplicate) return { programs: list, moved: null, duplicate: true, error: '' };
    var moved = null;
    var next = list.map(function (row) {
      if (!row || row.id !== id) return row;
      moved = Object.assign({}, row, { date: date, updatedAt: Date.now(), pending: true });
      return moved;
    });
    return { programs: next, moved: moved, duplicate: false, error: '' };
  }
  function setPresence(programs, id, value) {
    var next = presence(value);
    var changed = null;
    var list = (programs || []).map(function (row) {
      if (!row || row.id !== id || row.presence === next) return row;
      changed = Object.assign({}, row, { presence: next, updatedAt: Date.now(), pending: true });
      return changed;
    });
    return { programs: list, changed: changed };
  }
  function remove(programs, id) {
    var removed = null;
    var list = (programs || []).filter(function (row) {
      if (row && row.id === id) { removed = row; return false; }
      return true;
    });
    return { programs: list, removed: removed };
  }
  // Scheduled-workout menu. Editors get remove and add. Everyone who can see the day gets Run and View.
  function entryMenu(ctx) {
    if (!canSee(ctx)) return [];
    if (canEdit(ctx)) return ['run', 'view', 'remove', 'add'];
    return ['run', 'view'];
  }
  function parseClock(value) {
    var m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value == null ? '' : value).trim());
    if (!m) return null;
    var h = Number(m[1]);
    var min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return h * 60 + min;
  }
  function clockFromMinutes(mins) {
    return pad(Math.floor(mins / 60)) + ':' + pad(mins % 60);
  }
  function validTimes(start, end) {
    var a = parseClock(start);
    var b = parseClock(end);
    if (a == null || b == null) return { ok: false, start: '', end: '', error: 'Pick a start and an end time.' };
    if (b <= a) return { ok: false, start: '', end: '', error: 'End time has to be after the start time.' };
    return { ok: true, start: clockFromMinutes(a), end: clockFromMinutes(b), error: '' };
  }
  function formatClock(mins) {
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    var ap = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return { text: h12 + ':' + pad(m), ap: ap };
  }
  function formatRange(start, end) {
    var a = parseClock(start);
    var b = parseClock(end);
    if (a == null || b == null) return '';
    var left = formatClock(a);
    var right = formatClock(b);
    if (left.ap === right.ap) return left.text + '–' + right.text + ' ' + left.ap;
    return left.text + ' ' + left.ap + '–' + right.text + ' ' + right.ap;
  }
  function byStart(rows) {
    return (rows || []).slice().sort(function (a, b) {
      var as = parseClock(a && a.start);
      var bs = parseClock(b && b.start);
      if (as == null && bs == null) return String(a && a.id || '').localeCompare(String(b && b.id || ''));
      if (as == null) return 1;
      if (bs == null) return -1;
      if (as !== bs) return as - bs;
      return String(a && a.id || '').localeCompare(String(b && b.id || ''));
    });
  }
  function clockOrBlank(value) {
    var mins = parseClock(value);
    return mins == null ? '' : clockFromMinutes(mins);
  }
  function setTimes(programs, id, start, end) {
    var list = programs || [];
    var times = validTimes(start, end);
    if (!times.ok) return { programs: list, changed: null, error: times.error };
    var found = false;
    var changed = null;
    var next = list.map(function (row) {
      if (!row || row.id !== id) return row;
      found = true;
      if (row.start === times.start && row.end === times.end) return row;
      changed = Object.assign({}, row, { start: times.start, end: times.end, updatedAt: Date.now(), pending: true });
      return changed;
    });
    if (!found) return { programs: list, changed: null, error: 'That workout is no longer on this day.' };
    return { programs: changed ? next : list, changed: changed, error: '' };
  }
  function loggedSession(session) {
    if (!session) return false;
    var results = session.results;
    if (!Array.isArray(results) || !results.length) return false;
    return results.some(function (row) { return row && row.logged !== false; });
  }
  function entryDone(entry, sessions) {
    if (!entry) return false;
    return (sessions || []).some(function (session) {
      if (!loggedSession(session)) return false;
      if (session.programId && session.programId === entry.id) return true;
      return session.workoutId === entry.workoutId && localDay(session.endedAt || session.startedAt) === entry.date;
    });
  }
  function dayDone(entries, sessions) {
    return !!(entries && entries.length) && entries.every(function (entry) { return entryDone(entry, sessions); });
  }
  function fromRemote(row) {
    if (!row) return null;
    var date = String(row.day || row.date || '').slice(0, 10);
    var id = row.local_id || row.localId;
    if (!id || !isDay(date)) return null;
    return {
      id: String(id),
      ownerId: row.owner_id || row.ownerId,
      workoutId: String(row.workout_local_id || row.workoutId || ''),
      workoutName: row.workout_name || row.workoutName || 'Workout',
      items: copyItems(row.items),
      date: date,
      start: clockOrBlank(row.starts_at != null ? row.starts_at : row.start),
      end: clockOrBlank(row.ends_at != null ? row.ends_at : row.end),
      presence: presence(row.presence),
      updatedAt: Date.parse(row.updated_at || row.updatedAt) || 0
    };
  }
  function dropTime(dropped, id) {
    var value = dropped && dropped[id];
    if (value == null || value === '') return 0;
    return typeof value === 'number' ? value : (value.at || 0);
  }
  // A remote snapshot is the shared list for this owner. A row that was already on the
  // server and is missing from that list was removed, so it stays removed. A row that
  // only exists on this device (pending, or saved before sync existed) is kept.
  function merge(local, remote, ownerId, opts) {
    var keepTimes = !!(opts && opts.keepLocalTimes);
    var dropped = (opts && opts.dropped) || {};
    var map = {};
    (remote || []).forEach(function (row) {
      var cur = fromRemote(row);
      if (!cur || cur.ownerId !== ownerId) return;
      if (dropTime(dropped, cur.id) && (cur.updatedAt || 0) <= dropTime(dropped, cur.id)) return;
      cur.synced = true;
      map[cur.id] = cur;
    });
    (local || []).forEach(function (row) {
      if (!row || row.ownerId !== ownerId || !row.id) return;
      if (dropTime(dropped, row.id) && (row.updatedAt || 0) <= dropTime(dropped, row.id)) return;
      var incoming = map[row.id];
      if (!incoming) {
        if (row.synced && !row.pending) return;
        map[row.id] = Object.assign({}, row, { pending: true });
        return;
      }
      if ((row.updatedAt || 0) > (incoming.updatedAt || 0)) {
        map[row.id] = Object.assign({}, row, { pending: true, synced: true });
        return;
      }
      var timesMissing = (!!row.start && !incoming.start) || (!!row.end && !incoming.end);
      if (keepTimes || timesMissing) {
        if (row.start) incoming.start = row.start;
        if (row.end) incoming.end = row.end;
      }
      if (row.pending && timesMissing) incoming.pending = true;
    });
    var rest = (local || []).filter(function (row) { return row && row.ownerId !== ownerId; });
    return rest.concat(Object.keys(map).map(function (key) { return map[key]; }));
  }
  function settleDrops(dropped, remoteRows, merged, ownerId) {
    var remoteIds = {};
    (remoteRows || []).forEach(function (row) {
      var id = row && (row.local_id || row.localId || row.id);
      if (id) remoteIds[String(id)] = true;
    });
    var next = {};
    Object.keys(dropped || {}).forEach(function (id) {
      var value = dropped[id];
      var owner = value && typeof value === 'object' ? value.ownerId : '';
      if (owner && owner !== ownerId) { next[id] = value; return; }
      var alive = (merged || []).some(function (row) { return row && row.id === id && row.ownerId === ownerId; });
      if (!alive && remoteIds[id]) next[id] = value;
    });
    return next;
  }

  var api = {
    roleOf: roleOf,
    isTrainer: isTrainer,
    buttons: buttons,
    ownerPlanOf: ownerPlanOf,
    canSee: canSee,
    canEdit: canEdit,
    isUuid: isUuid,
    iso: iso,
    parseDate: parseDate,
    isDay: isDay,
    weekStart: weekStart,
    localDay: localDay,
    presence: presence,
    forOwner: forOwner,
    place: place,
    move: move,
    setPresence: setPresence,
    remove: remove,
    entryMenu: entryMenu,
    validTimes: validTimes,
    formatRange: formatRange,
    byStart: byStart,
    setTimes: setTimes,
    entryDone: entryDone,
    dayDone: dayDone,
    fromRemote: fromRemote,
    merge: merge,
    settleDrops: settleDrops
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WBPrograms = api;
})(typeof window !== 'undefined' ? window : this);
