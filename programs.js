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
  // A trainer with no client selected is on their own calendar, same as any other account.
  function canSee(ctx) {
    ctx = ctx || {};
    if (viewingSelf(ctx)) return true;
    if (!isTrainer(ctx.role) || ctx.linked !== true) return false;
    if (ownerPlanOf(ctx) === 'enthusiast') return ctx.shareOn === true;
    return true;
  }
  function canEdit(ctx) {
    ctx = ctx || {};
    if (viewingSelf(ctx)) return ctx.role !== 'free_client';
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
  // Stored rows with no designation display as Solo. A new entry has to choose.
  function presence(value) { return value === 'trainer' ? 'trainer' : 'solo'; }
  function chosenPresence(value) { return value === 'trainer' || value === 'solo' ? value : ''; }
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
    var who = chosenPresence(entry.presence);
    if (!who) return { programs: list, created: null, duplicate: false, error: 'Choose Solo or Trainer present.' };
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
      presence: who,
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
  // 24-hour storage ("18:30") shown as a typed 12-hour HH:MM plus AM/PM.
  function clock12(value) {
    var mins = parseClock(value);
    if (mins == null) return null;
    var shown = formatClock(mins);
    var parts = shown.text.split(':');
    var hour = parts[0].length === 1 ? '0' + parts[0] : parts[0];
    return { text: hour + ':' + parts[1], ap: shown.ap };
  }
  // Typed HH:MM (or digits) plus AM/PM, back to the 24-hour HH:MM the calendar stores.
  function clock24(text, ap) {
    var raw = String(text == null ? '' : text).trim();
    var apRaw = String(ap == null ? '' : ap).trim().toUpperCase();
    if (!raw) return { ok: false, empty: true, value: '' };
    var m = /^(\d{1,2}):(\d{2})$/.exec(raw);
    if (!m) {
      var digits = raw.replace(/\D/g, '');
      if (digits.length === 4) m = [digits, digits.slice(0, 2), digits.slice(2)];
      else if (digits.length === 3) {
        var head = Number(digits.slice(0, 2));
        if (head >= 1 && head <= 12) return { ok: false, empty: false, value: '' };
        m = [digits, digits.slice(0, 1), digits.slice(1)];
      }
    }
    if (!m || (apRaw !== 'AM' && apRaw !== 'PM')) return { ok: false, empty: false, value: '' };
    var h = Number(m[1]);
    var min = Number(m[2]);
    if (h < 1 || h > 12 || min > 59) return { ok: false, empty: false, value: '' };
    var h24 = h % 12;
    if (apRaw === 'PM') h24 += 12;
    return { ok: true, empty: false, value: pad(h24) + ':' + pad(min) };
  }
  // Keep a typed time looking like HH:MM while the person is entering digits.
  function shapeClock(value) {
    var raw = String(value == null ? '' : value);
    var colon = raw.indexOf(':');
    if (colon !== -1) {
      var left = raw.slice(0, colon).replace(/\D/g, '').slice(0, 2);
      var right = raw.slice(colon + 1).replace(/\D/g, '').slice(0, 2);
      if (!left && !right) return '';
      return left + ':' + right;
    }
    var digits = raw.replace(/\D/g, '').slice(0, 4);
    if (digits.length <= 2) return digits;
    if (digits.length === 3) {
      var h2 = Number(digits.slice(0, 2));
      if (h2 >= 1 && h2 <= 12) return digits.slice(0, 2) + ':' + digits.slice(2);
      return digits.slice(0, 1) + ':' + digits.slice(1);
    }
    var h = Number(digits.slice(0, 2));
    if (h >= 1 && h <= 12) return digits.slice(0, 2) + ':' + digits.slice(2);
    return digits.slice(0, 1) + ':' + digits.slice(1, 3);
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
    // A row from workout_sessions has no local results list. completed and
    // ended_early are the same finished logs this device already counts.
    if (session.remote) return session.status === 'completed' || session.status === 'ended_early';
    var results = session.results;
    if (!Array.isArray(results) || !results.length) return false;
    return results.some(function (row) { return row && row.logged !== false; });
  }
  function stamp(value) {
    if (typeof value === 'number' && isFinite(value) && value > 0) return value;
    if (typeof value === 'string' && value) {
      var parsed = Date.parse(value);
      if (isFinite(parsed)) return parsed;
    }
    return 0;
  }
  // The day the workout was actually done. A saved local_date wins over the
  // viewer's clock, so a client and their trainer see the same day.
  function sessionDay(session) {
    if (!session) return '';
    var explicit = String(session.localDate || session.local_date || '').slice(0, 10);
    if (isDay(explicit)) return explicit;
    return localDay(session.endedAt || session.startedAt);
  }
  // When the workout started. A row with only a calendar day has no start, so
  // the same-day match still stands.
  function sessionInstant(session) {
    if (!session || session.hasTime === false) return 0;
    return stamp(session.startedAt) || stamp(session.endedAt);
  }
  // The entry has to already be on this day when the workout starts. A later
  // edit or move does not claim a run that already happened. No timestamps
  // means we only know the current day, so a same-day match still counts.
  function scheduledBeforeRun(entry, session) {
    var updated = stamp(entry && entry.updatedAt);
    var when = sessionInstant(session);
    if (!updated || !when) return true;
    return updated <= when;
  }
  // A logged session completes an entry only on the same local day, for the
  // same person. The program id picks that entry, and the same workout on
  // that day counts too. An earlier run does not check the original scheduled
  // day. A database row only counts for the person who logged it. A session
  // saved on this device has no person, so it still counts.
  function sessionMatchesEntry(entry, session) {
    if (!entry || !session) return false;
    if (session.remote || session.clientId) {
      if (!session.clientId || session.clientId !== entry.ownerId) return false;
    }
    if (!loggedSession(session)) return false;
    var day = sessionDay(session);
    if (!day || day !== entry.date) return false;
    if (!scheduledBeforeRun(entry, session)) return false;
    if (session.programId && session.programId === entry.id) return true;
    return !!session.workoutId && session.workoutId === entry.workoutId;
  }
  function entryDone(entry, sessions) {
    if (!entry) return false;
    return (sessions || []).some(function (session) { return sessionMatchesEntry(entry, session); });
  }
  // Finished runs that were not scheduled for the day they were done.
  // scope.owners is who is on screen. A device log with no person shows only
  // on the signed-in person's own calendar.
  function unscheduledOn(date, entries, sessions, scope) {
    if (!isDay(date)) return [];
    scope = scope || {};
    var owners = {};
    (scope.owners || []).forEach(function (id) { if (id) owners[id] = 1; });
    var selfId = scope.selfId || '';
    var seen = {};
    var out = [];
    (sessions || []).forEach(function (session) {
      if (!session || sessionDay(session) !== date || !loggedSession(session)) return;
      var matched = (entries || []).some(function (entry) { return sessionMatchesEntry(entry, session); });
      if (matched) return;
      var owner = session.clientId || '';
      if (session.remote || owner) {
        if (!owner || !owners[owner]) return;
      } else if (!selfId || !owners[selfId]) {
        return;
      } else {
        owner = selfId;
      }
      var id = String(session.id || '');
      if (!id) id = 'log-' + owner + '-' + date + '-' + (session.workoutId || '') + '-' + (session.programId || '');
      if (seen[id]) return;
      seen[id] = 1;
      out.push({
        id: id,
        ownerId: owner,
        workoutId: session.workoutId || '',
        workoutName: session.workoutName || '',
        programId: session.programId || '',
        date: date
      });
    });
    out.sort(function (a, b) {
      var name = String(a.workoutName || '').localeCompare(String(b.workoutName || ''));
      if (name) return name;
      return String(a.id).localeCompare(String(b.id));
    });
    return out;
  }
  // Clients and Enthusiasts get a reschedule note. Trainers move their own
  // workouts by dragging, so a trainer's own run stays quiet.
  function shouldSuggestReschedule(role, session, entries) {
    if (role !== 'free_client' && role !== 'enthusiast') return false;
    if (!loggedSession(session)) return false;
    if (!sessionDay(session)) return false;
    return !(entries || []).some(function (entry) { return sessionMatchesEntry(entry, session); });
  }
  // Turn a workout_sessions row into the shape entryDone already understands.
  // Noon on local_date keeps the same-day match when the row has no clock.
  function sessionFromRemote(row) {
    if (!row || typeof row !== 'object') return null;
    var status = row.status || '';
    if (status !== 'completed' && status !== 'ended_early') return null;
    var day = String(row.local_date || row.localDate || '').slice(0, 10);
    var programId = String(row.program_id || row.programId || '');
    var workoutId = String(row.workout_id || row.workoutId || '');
    var clientId = String(row.client_id || row.clientId || '');
    if (!clientId || (!programId && !workoutId)) return null;
    if (!isDay(day) && !programId) return null;
    var started = stamp(row.started_at || row.startedAt);
    var ended = stamp(row.ended_at || row.endedAt);
    var hasTime = !!(started || ended);
    var when = ended || started;
    if (!when && isDay(day)) {
      var parts = day.split('-');
      when = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0, 0).getTime();
    } else if (!when) {
      when = 0;
    }
    return {
      id: String(row.local_id || row.localId || row.id || ''),
      clientId: clientId,
      programId: programId,
      workoutId: workoutId,
      workoutName: String(row.workout_name || row.workoutName || ''),
      localDate: isDay(day) ? day : '',
      startedAt: started || when,
      endedAt: ended || when,
      hasTime: hasTime,
      status: status,
      remote: true
    };
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
  // A timed save can upsert the row and then reject because the times columns are not
  // on the server yet. That rejection still wrote the row, so a removal must undo it.
  function staleWrite(err, dropped, id, programs) {
    var wrote = !err || !!(err && err.timesLocal);
    if (!wrote || !dropped || !dropped[id]) return false;
    return !(programs || []).some(function (row) { return row && row.id === id; });
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
    clock12: clock12,
    clock24: clock24,
    shapeClock: shapeClock,
    byStart: byStart,
    setTimes: setTimes,
    entryDone: entryDone,
    dayDone: dayDone,
    sessionDay: sessionDay,
    unscheduledOn: unscheduledOn,
    shouldSuggestReschedule: shouldSuggestReschedule,
    sessionFromRemote: sessionFromRemote,
    fromRemote: fromRemote,
    merge: merge,
    settleDrops: settleDrops,
    staleWrite: staleWrite
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WBPrograms = api;
})(typeof window !== 'undefined' ? window : this);
