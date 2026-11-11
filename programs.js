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
      presence: presence(entry.presence),
      updatedAt: entry.updatedAt || Date.now()
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
      moved = Object.assign({}, row, { date: date, updatedAt: Date.now() });
      return moved;
    });
    return { programs: next, moved: moved, duplicate: false, error: '' };
  }
  function setPresence(programs, id, value) {
    var next = presence(value);
    var changed = null;
    var list = (programs || []).map(function (row) {
      if (!row || row.id !== id || row.presence === next) return row;
      changed = Object.assign({}, row, { presence: next, updatedAt: Date.now() });
      return changed;
    });
    return { programs: list, changed: changed };
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
      presence: presence(row.presence),
      updatedAt: Date.parse(row.updated_at || row.updatedAt) || 0
    };
  }
  // Remote rows replace the same id when they are newer. Other owners stay put.
  function merge(local, remote, ownerId) {
    var map = {};
    (local || []).forEach(function (row) {
      if (row && row.ownerId === ownerId && row.id) map[row.id] = row;
    });
    (remote || []).forEach(function (row) {
      var cur = fromRemote(row);
      if (!cur || cur.ownerId !== ownerId) return;
      var prev = map[cur.id];
      if (!prev || (cur.updatedAt || 0) >= (prev.updatedAt || 0)) map[cur.id] = cur;
    });
    var rest = (local || []).filter(function (row) { return row && row.ownerId !== ownerId; });
    return rest.concat(Object.keys(map).map(function (key) { return map[key]; }));
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
    entryDone: entryDone,
    dayDone: dayDone,
    fromRemote: fromRemote,
    merge: merge
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WBPrograms = api;
})(typeof window !== 'undefined' ? window : this);
