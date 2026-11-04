/* Workout Builder data model (pure logic, no DOM). Works in browser (window.WB) and Node (require). */
(function (root) {
  'use strict';
  var SCHEMA_VERSION = 3;
  var SAVE_SESSIONS = false; // set true to store finished workout sessions in data.sessions
  var STORAGE_KEY = 'wb.data.v1';
  var MODES = ['reps', 'intervals', 'timer', 'stopwatch'];
  var REPS_TYPES = ['number', 'range', 'static'];   // timer + intervals
  var REPS_MODE_TYPES = ['number', 'range'];          // reps mode (no static since v3)
  var UNITS = ['lb', 'kg', 'bodyweight'];

  function uid(p) { return (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function num(v) { if (v === '' || v === null || v === undefined) return null; var n = Number(v); return isFinite(n) ? n : NaN; }

  // ---- time helpers (seconds <-> mm:ss) ----
  function fmtTime(sec) { sec = Math.max(0, Math.round(sec || 0)); var m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  // Stopwatch display MM:SS.hh (00:00.00 .. 99:59.99) from elapsed ms, e.g. performance.now() - start.
  function formatStopwatch(ms) {
    var cs = Math.floor(Math.min(Math.max(0, ms || 0), 5999990) / 10); // hundredths, capped at 99:59.99
    var m = Math.floor(cs / 6000), sec = Math.floor(cs / 100) % 60, h = cs % 100;
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return p2(m) + ':' + p2(sec) + '.' + p2(h);
  }
  function toSec(min, sec) { var m = num(min) || 0, s = num(sec) || 0; return m * 60 + s; }

  // Default config for each mode. Every exercise stores ONLY its active mode's config in `modeConfig`.
  function defaultModeConfig(mode) {
    switch (mode) {
      case 'reps': return { repsType: 'number', count: 10, min: 8, max: 12, restSec: 0 };
      case 'intervals': return { workSec: 30, repsType: 'static', count: 10, min: 8, max: 12 }; // # of intervals = sets; no rest by design
      case 'timer': return { workSec: 45, restSec: 15, repsType: 'static', count: 10, min: 8, max: 12 };
      case 'stopwatch': return { lapsEnabled: true, lapCount: 1 };          // counts up; laps recorded in sessions
      default: throw new Error('Unknown mode ' + mode);
    }
  }

  function newExercise(over) {
    var ex = {
      id: uid('ex'), name: '', sets: 3,
      weight: { unit: 'lb', value: null },
      mode: 'reps', modeConfig: defaultModeConfig('reps'),
      notes: '',
      groupId: null,   // superset link: 2+ exercises sharing a groupId (kept contiguous)
      media: null      // future: { type: 'image'|'video', src, thumb }
    };
    return Object.assign(ex, over || {});
  }
  function newWorkout(name) {
    var t = Date.now();
    return { id: uid('wo'), name: name || 'New workout', items: [], createdAt: t, updatedAt: t };
  }
  function emptyData() {
    // `sessions` reserved for the Start Workout player (history, stopwatch laps, etc.)
    return { version: SCHEMA_VERSION, workouts: [], sessions: [] };
  }

  // ---- validation: returns array of error strings (empty = valid) ----
  function validateExercise(ex) {
    var e = [];
    if (!ex.name || !String(ex.name).trim()) e.push('Name is required.');
    if (!Number.isInteger(ex.sets) || ex.sets < 1) e.push('Sets must be a whole number of 1 or more.');
    if (UNITS.indexOf(ex.weight && ex.weight.unit) < 0) e.push('Invalid weight unit.');
    else if (ex.weight.unit !== 'bodyweight') {
      var w = ex.weight.value;
      if (w !== null && (typeof w !== 'number' || isNaN(w) || w < 0)) e.push('Weight cannot be negative.');
    }
    var c = ex.modeConfig || {};
    if (MODES.indexOf(ex.mode) < 0) e.push('Invalid mode.');
    if (ex.mode === 'reps' || ex.mode === 'intervals' || ex.mode === 'timer') {
      if ((ex.mode === 'reps' ? REPS_MODE_TYPES : REPS_TYPES).indexOf(c.repsType) < 0) e.push('Invalid reps type.');
      if (c.repsType === 'number' && !(Number.isInteger(c.count) && c.count >= 1)) e.push('Reps must be a whole number of 1 or more.');
      if (c.repsType === 'range') {
        if (!(Number.isInteger(c.min) && c.min >= 1) || !(Number.isInteger(c.max) && c.max >= 1)) e.push('Range min and max must be whole numbers of 1 or more.');
        else if (c.min > c.max) e.push('Range min must be less than or equal to max.');
      }
      if (c.restSec != null && !(c.restSec >= 0)) e.push('Rest time cannot be negative.');
    }
    if (ex.mode === 'intervals') {
      if (!(c.workSec > 0)) e.push('Work time must be more than 0:00.');
    }
    if (ex.mode === 'timer') {
      if (!(c.workSec > 0)) e.push('Work time must be more than 0:00.');
      if (!(c.restSec >= 0)) e.push('Rest time cannot be negative.');
    }
    if (ex.mode === 'stopwatch' && c.lapsEnabled !== false && !(Number.isInteger(c.lapCount) && c.lapCount >= 1)) e.push('Lap quantity must be a whole number of 1 or more.');
    return e;
  }

  // Strip fields that don't belong to the active mode / unit, so stored data stays clean.
  function normalizeExercise(ex) {
    var out = newExercise({ id: ex.id || uid('ex') });
    out.name = String(ex.name || '').trim();
    out.sets = ex.sets;
    out.weight = { unit: ex.weight.unit, value: ex.weight.unit === 'bodyweight' ? null : ex.weight.value };
    out.mode = ex.mode;
    var c = ex.modeConfig || {}, d = {};
    if (ex.mode === 'reps' || ex.mode === 'intervals' || ex.mode === 'timer') {
      d.repsType = c.repsType;
      if (c.repsType === 'number') d.count = c.count;
      if (c.repsType === 'range') { d.min = c.min; d.max = c.max; }
    }
    if (ex.mode === 'reps') d.restSec = c.restSec || 0;
    else if (ex.mode === 'intervals') d.workSec = c.workSec;
    else if (ex.mode === 'timer') { d.workSec = c.workSec; d.restSec = c.restSec; }
    else if (ex.mode === 'stopwatch') { d.lapsEnabled = c.lapsEnabled !== false; if (d.lapsEnabled) d.lapCount = c.lapCount; }
    out.modeConfig = d;
    out.notes = String(ex.notes || '');
    out.groupId = ex.groupId || null;
    out.media = ex.media || null;
    return out;
  }

  // Human-readable summary line for list views.
  function summarize(ex) {
    var c = ex.modeConfig || {}, iv = ex.mode === 'intervals', p = [ex.sets + (iv ? (ex.sets === 1 ? ' interval' : ' intervals') : (ex.sets === 1 ? ' set' : ' sets'))];
    if (ex.mode !== 'stopwatch') p.push(repsText(c));
    if (ex.mode === 'reps' && c.restSec > 0) p.push(fmtTime(c.restSec) + ' rest');
    if (iv) p.push(fmtTime(c.workSec) + ' work');
    if (ex.mode === 'timer') p.push(fmtTime(c.workSec) + ' work / ' + fmtTime(c.restSec) + ' rest');
    if (ex.mode === 'stopwatch') p.push('stopwatch' + (c.lapsEnabled ? ' · ' + c.lapCount + (c.lapCount === 1 ? ' lap' : ' laps') : ''));
    if (ex.weight.unit === 'bodyweight') p.push('bodyweight');
    else if (ex.weight.value !== null && ex.weight.value !== undefined) p.push(ex.weight.value + ' ' + ex.weight.unit);
    return p.join(' · ');
  }

  function repsText(c) { return c.repsType === 'number' ? c.count + ' reps' : c.repsType === 'range' ? c.min + '–' + c.max + ' reps' : 'static hold'; }

  // ---- workout operations (mutate workout in place, return it) ----
  function touch(w) { w.updatedAt = Date.now(); return w; }
  function findIdx(w, id) { for (var i = 0; i < w.items.length; i++) if (w.items[i].id === id) return i; return -1; }

  // Groups as contiguous runs: returns [{groupId|null, items:[...]}]
  function blocks(w) {
    var out = [];
    w.items.forEach(function (it) {
      var last = out[out.length - 1];
      if (it.groupId && last && last.groupId === it.groupId) last.items.push(it);
      else out.push({ groupId: it.groupId || null, items: [it] });
    });
    return out;
  }
  // Clear groupIds that have fewer than 2 members; make groups contiguous.
  function cleanGroups(w) {
    var counts = {};
    w.items.forEach(function (it) { if (it.groupId) counts[it.groupId] = (counts[it.groupId] || 0) + 1; });
    w.items.forEach(function (it) { if (it.groupId && counts[it.groupId] < 2) it.groupId = null; });
    // gather group members to first occurrence
    var seen = {}, res = [];
    w.items.forEach(function (it) {
      if (!it.groupId) { res.push(it); return; }
      if (seen[it.groupId]) return;
      seen[it.groupId] = true;
      w.items.forEach(function (o) { if (o.groupId === it.groupId) res.push(o); });
    });
    w.items = res;
    return w;
  }

  function upsertExercise(w, ex) {
    var n = normalizeExercise(ex), i = findIdx(w, n.id);
    if (i >= 0) w.items[i] = n; else w.items.push(n);
    return touch(w);
  }
  function deleteExercise(w, id) { w.items = w.items.filter(function (it) { return it.id !== id; }); cleanGroups(w); return touch(w); }

  // Move an exercise up/down. Inside a superset it swaps within the group;
  // a standalone exercise or a whole group jumps over neighbouring blocks.
  function moveExercise(w, id, dir) {
    var i = findIdx(w, id); if (i < 0) return w;
    var it = w.items[i], j = i + dir;
    if (it.groupId && w.items[j] && w.items[j].groupId === it.groupId) {
      w.items[i] = w.items[j]; w.items[j] = it; return touch(w);
    }
    var bl = blocks(w), bi = -1;
    bl.forEach(function (b, k) { if (b.items.indexOf(it) >= 0) bi = k; });
    var bj = bi + dir; if (bj < 0 || bj >= bl.length) return w;
    var tmp = bl[bi]; bl[bi] = bl[bj]; bl[bj] = tmp;
    w.items = [].concat.apply([], bl.map(function (b) { return b.items; }));
    return touch(w);
  }
  function moveGroup(w, groupId, dir) {
    var bl = blocks(w), bi = -1;
    bl.forEach(function (b, k) { if (b.groupId === groupId) bi = k; });
    var bj = bi + dir; if (bi < 0 || bj < 0 || bj >= bl.length) return w;
    var tmp = bl[bi]; bl[bi] = bl[bj]; bl[bj] = tmp;
    w.items = [].concat.apply([], bl.map(function (b) { return b.items; }));
    return touch(w);
  }

  // Link 2+ exercises into one superset. Selected items already in groups are merged.
  function linkSuperset(w, ids) {
    if (!ids || ids.length < 2) throw new Error('Select at least 2 exercises to make a superset.');
    var gid = uid('grp'), groupsHit = {};
    w.items.forEach(function (it) { if (ids.indexOf(it.id) >= 0 && it.groupId) groupsHit[it.groupId] = 1; });
    w.items.forEach(function (it) { if (ids.indexOf(it.id) >= 0 || groupsHit[it.groupId]) it.groupId = gid; });
    cleanGroups(w);
    return touch(w);
  }
  function unlinkGroup(w, groupId) { w.items.forEach(function (it) { if (it.groupId === groupId) it.groupId = null; }); return touch(w); }
  function unlinkExercise(w, id) { var i = findIdx(w, id); if (i >= 0) w.items[i].groupId = null; cleanGroups(w); return touch(w); }

  function duplicateWorkout(w) {
    var c = clone(w), map = {};
    c.id = uid('wo'); c.name = w.name + ' (copy)'; c.createdAt = c.updatedAt = Date.now();
    c.items.forEach(function (it) {
      it.id = uid('ex');
      if (it.groupId) { map[it.groupId] = map[it.groupId] || uid('grp'); it.groupId = map[it.groupId]; }
    });
    return c;
  }

  // For the future player: flatten a workout into an ordered list of steps.
  // Supersets rotate one set at a time: A1 B1 A2 B2 ... (exercises with fewer sets drop out).
  function buildPlayQueue(w) {
    var steps = [];
    blocks(w).forEach(function (b) {
      var maxSets = Math.max.apply(null, b.items.map(function (x) { return x.sets; }));
      for (var s = 1; s <= maxSets; s++) b.items.forEach(function (x) {
        if (s <= x.sets) steps.push({ exerciseId: x.id, set: s, of: x.sets, groupId: b.groupId });
      });
    });
    return steps;
  }

  // ---- persistence ----
  function load(storage) {
    try {
      var raw = storage.getItem(STORAGE_KEY);
      if (!raw) return emptyData();
      var d = JSON.parse(raw);
      if (!d || !Array.isArray(d.workouts)) return emptyData();
      d.sessions = d.sessions || [];
      return migrate(d);
    } catch (e) { return emptyData(); }
  }
  // Upgrade older saved data in place. v1 -> v2: reps.restSec (0), stopwatch.lapCount (1).
  function migrate(d) {
    var v = d.version || 1;
    if (v < 2) d.workouts.forEach(function (w) {
      (w.items || []).forEach(function (it) {
        var c = it.modeConfig = it.modeConfig || {};
        if (it.mode === 'reps' && typeof c.restSec !== 'number') c.restSec = 0;
        if (it.mode === 'stopwatch' && c.lapsEnabled !== false && !(c.lapCount >= 1)) c.lapCount = 1;
      });
    });
    // v2 -> v3: intervals.repetitions merged into sets (# of intervals = sets × repetitions); reps 'static' -> 'number';
    //           timer/intervals gain reps options (default 'static' = time only, same as before).
    if (v < 3) d.workouts.forEach(function (w) {
      (w.items || []).forEach(function (it) {
        var c = it.modeConfig = it.modeConfig || {};
        if (it.mode === 'intervals') { it.sets = (it.sets || 1) * (c.repetitions || 1); delete c.repetitions; }
        if (it.mode === 'reps' && c.repsType === 'static') { c.repsType = 'number'; c.count = c.count >= 1 ? c.count : 10; }
        if ((it.mode === 'intervals' || it.mode === 'timer') && REPS_TYPES.indexOf(c.repsType) < 0) c.repsType = 'static';
      });
    });
    d.version = SCHEMA_VERSION;
    return d;
  }
  function save(storage, data) { storage.setItem(STORAGE_KEY, JSON.stringify(data)); }

  var api = {
    SCHEMA_VERSION: SCHEMA_VERSION, STORAGE_KEY: STORAGE_KEY, MODES: MODES, REPS_TYPES: REPS_TYPES, UNITS: UNITS,
    SAVE_SESSIONS: SAVE_SESSIONS, REPS_MODE_TYPES: REPS_MODE_TYPES, repsText: repsText, uid: uid, clone: clone, formatStopwatch: formatStopwatch, migrate: migrate, num: num, fmtTime: fmtTime, toSec: toSec,
    defaultModeConfig: defaultModeConfig, newExercise: newExercise, newWorkout: newWorkout, emptyData: emptyData,
    validateExercise: validateExercise, normalizeExercise: normalizeExercise, summarize: summarize,
    blocks: blocks, cleanGroups: cleanGroups, upsertExercise: upsertExercise, deleteExercise: deleteExercise,
    moveExercise: moveExercise, moveGroup: moveGroup, linkSuperset: linkSuperset, unlinkGroup: unlinkGroup,
    unlinkExercise: unlinkExercise, duplicateWorkout: duplicateWorkout, buildPlayQueue: buildPlayQueue,
    load: load, save: save
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.WB = api;
})(this);
