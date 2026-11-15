/* Save a finished workout. One session, one row per set. Browser: window.WBTracking. Node: require.
   Preview runs are not saved. Weight is converted to kilograms for storage; the display unit is kept.
   A missing table or a signed-out visit resolves as not saved and does not throw. */
(function (root) {
  'use strict';
  var LB_TO_KG = 0.45359237;

  function isUuid(id) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ''));
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function localDate(ts) {
    var t = typeof ts === 'number' ? ts : Date.parse(ts);
    if (!isFinite(t)) return '';
    var d = new Date(t);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function timeZone() {
    try {
      var zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (zone && /^[A-Za-z0-9_+\-/]{1,64}$/.test(zone)) return zone;
    } catch (e) {}
    return 'UTC';
  }
  function toKg(value, unit) {
    if (unit === 'bodyweight' || value == null || value === '') return null;
    var n = Number(value);
    if (!isFinite(n) || n < 0) return null;
    if (unit === 'kg') return n;
    if (unit === 'lb') return n * LB_TO_KG;
    return null;
  }
  function num(value) {
    if (value == null || value === '') return null;
    var n = Number(value);
    if (!isFinite(n) || n < 0) return null;
    return n;
  }
  function resultAt(results, i) {
    if (!results) return null;
    if (Array.isArray(results)) return results[i] || null;
    return results[i] || results[String(i)] || null;
  }
  function exerciseOf(workout, id) {
    var items = workout && workout.items || [];
    var i;
    for (i = 0; i < items.length; i++) if (items[i] && items[i].id === id) return items[i];
    return null;
  }
  function libraryId(media) {
    if (!media || media.kind !== 'library') return null;
    var id = String(media.libraryId || '').trim();
    return /^[A-Za-z0-9_-]{1,32}$/.test(id) ? id : null;
  }
  function stableKey(id) {
    var key = String(id || '').trim();
    return /^[A-Za-z0-9_-]{1,80}$/.test(key) ? key : null;
  }
  function storedMode(ex) {
    var mode = ex && ex.mode;
    var reps = ex && ex.modeConfig && ex.modeConfig.repsType;
    if (mode === 'reps' && reps === 'static') return 'static_hold';
    if (mode === 'reps' || mode === 'intervals' || mode === 'timer' || mode === 'stopwatch') return mode;
    return null;
  }
  function unitOf(ex, result) {
    var unit = result && result.unit ? result.unit : (ex.weight && ex.weight.unit);
    if (unit === 'lb' || unit === 'kg' || unit === 'bodyweight') return unit;
    return 'kg';
  }
  function shownName(result, ex) {
    var name = result && result.name ? String(result.name) : String(ex && ex.name || '');
    name = name.replace(/^\s+|\s+$/g, '');
    if (!name) name = 'Exercise';
    return name.slice(0, 200);
  }
  function secFromMs(ms) {
    var n = Number(ms);
    if (!isFinite(n) || n < 0) return null;
    return Math.round(n) / 1000;
  }
  function plannedEvents(events) {
    var out = [];
    (events || []).forEach(function (ev) {
      if (!ev || ev.name == null) return;
      var name = String(ev.name).replace(/^\s+|\s+$/g, '');
      var lap = Number(ev.lap);
      if (!name || !isFinite(lap) || lap < 1) return;
      out.push({ lap: lap, name: name.slice(0, 80) });
    });
    return out.length ? out : null;
  }
  function actualEvents(events, marks) {
    var out = [];
    (events || []).forEach(function (ev) {
      if (!ev || ev.name == null) return;
      var mark = marks && (marks[ev.lap] || marks[String(ev.lap)]);
      if (mark !== 'pass' && mark !== 'fail') return;
      var name = String(ev.name).replace(/^\s+|\s+$/g, '');
      if (!name) return;
      out.push({ lap: Number(ev.lap), name: name.slice(0, 80), result: mark });
    });
    return out.length ? out : null;
  }
  function lapsOf(laps) {
    var out = [];
    (laps || []).forEach(function (lap, i) {
      if (!lap) return;
      var lapSec = secFromMs(lap.lapMs);
      var totalSec = secFromMs(lap.totalMs);
      if (lapSec == null || totalSec == null) return;
      out.push({ n: i + 1, lapSec: lapSec, totalSec: totalSec });
    });
    return out.length ? out : null;
  }
  function blankMeasures() {
    return {
      plannedReps: null, plannedRepsMin: null, plannedRepsMax: null,
      plannedWeight: null, actualReps: null, actualWeight: null,
      plannedHoldSec: null, actualHoldSec: null,
      plannedWorkSec: null, actualWorkSec: null, plannedRestSec: null, actualRestSec: null,
      plannedRounds: null, actualRounds: null, plannedTotalSec: null, actualTotalSec: null,
      plannedLapCount: null, actualLaps: null, plannedEvents: null, actualEvents: null
    };
  }
  // Planned values come from the exercise. Actual values come from the last logged attempt.
  function measures(ex, result, completed) {
    var c = ex.modeConfig || {};
    var mode = storedMode(ex);
    var unit = unitOf(ex, result);
    var row = blankMeasures();
    row.mode = mode;
    row.displayUnit = unit;
    row.plannedBodyweight = unit === 'bodyweight';
    row.actualBodyweight = unit === 'bodyweight';
    if (unit !== 'bodyweight') {
      row.plannedWeight = ex.weight && ex.weight.value != null ? num(ex.weight.value) : null;
      if (completed && result && result.weight != null) row.actualWeight = num(result.weight);
    }
    if (mode === 'reps') {
      if (c.repsType === 'number') row.plannedReps = num(c.count);
      if (c.repsType === 'range') { row.plannedRepsMin = num(c.min); row.plannedRepsMax = num(c.max); }
      if (completed && result) row.actualReps = num(result.reps);
    } else if (mode === 'static_hold') {
      if (completed && result) row.actualHoldSec = num(result.holdSec);
    } else if (mode === 'intervals' || mode === 'timer') {
      row.plannedWorkSec = num(c.workSec);
      if (mode === 'timer') row.plannedRestSec = num(c.restSec);
      if (c.repsType === 'number') row.plannedReps = num(c.count);
      if (c.repsType === 'range') { row.plannedRepsMin = num(c.min); row.plannedRepsMax = num(c.max); }
      if (completed && result) {
        row.actualWorkSec = num(result.workSec);
        row.actualReps = num(result.reps);
        row.actualRounds = num(result.rounds);
      }
    } else if (mode === 'stopwatch') {
      if (c.lapsEnabled !== false) row.plannedLapCount = num(c.lapCount);
      row.plannedEvents = plannedEvents(c.events);
      if (completed && result) {
        row.actualTotalSec = secFromMs(result.durationMs);
        row.actualLaps = lapsOf(result.laps);
        row.actualEvents = actualEvents(c.events, result.eventResults);
      }
    }
    return row;
  }
  function build(input) {
    if (!input || input.track === false) return null;
    var workout = input.workout;
    var queue = input.queue || [];
    if (!workout || !queue.length) return null;
    var id = String(input.id || '').trim();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return null;
    var started = Number(input.startedAt);
    var ended = Number(input.endedAt);
    if (!isFinite(started) || !isFinite(ended) || ended < started) return null;
    var sets = [];
    var logged = 0;
    var i, q, ex, result, completed, row, key, lib, mode;
    for (i = 0; i < queue.length; i++) {
      q = queue[i];
      if (!q) return null;
      ex = exerciseOf(workout, q.exerciseId);
      if (!ex) return null;
      mode = storedMode(ex);
      if (!mode) return null;
      result = resultAt(input.results, i);
      completed = !!(result && result.logged);
      if (completed) logged++;
      lib = libraryId(ex.media);
      key = lib ? null : stableKey(ex.id);
      if (!lib && !key) return null;
      row = measures(ex, result, completed);
      row.step = i;
      row.setNumber = q.set;
      row.groupTag = q.groupId ? String(q.groupId).slice(0, 80) : null;
      row.status = completed ? 'completed' : 'skipped';
      row.exerciseName = shownName(result, ex);
      row.libraryExerciseId = lib;
      row.stableKey = key;
      sets.push(row);
    }
    if (!logged) return null;
    var workoutId = workout.id ? String(workout.id).trim() : '';
    var programId = input.programId ? String(input.programId).trim() : '';
    return {
      session: {
        localId: id,
        workoutId: /^[A-Za-z0-9_-]{1,80}$/.test(workoutId) ? workoutId : null,
        workoutName: String(workout.name || '').trim().slice(0, 120) || null,
        origin: input.ownWork === false ? 'trainer' : 'own',
        startedAt: new Date(started).toISOString(),
        endedAt: new Date(ended).toISOString(),
        timeZone: input.timeZone || timeZone(),
        localDate: localDate(ended),
        status: logged === queue.length ? 'completed' : 'ended_early',
        programId: /^[A-Za-z0-9_-]{1,80}$/.test(programId) ? programId : null
      },
      sets: sets
    };
  }
  function note(sess, remoteSaved) {
    var n = sess && sess.results ? sess.results.length : 0;
    if (!n) return 'Nothing was logged.';
    if (remoteSaved === true) return 'Session saved.';
    if (remoteSaved === false) return 'Session not saved.';
    return '';
  }
  function save(input) {
    var payload;
    try { payload = build(input); } catch (e) { return Promise.resolve({ ok: false }); }
    if (!payload) return Promise.resolve({ ok: false });
    var auth = root.WBAuth;
    if (!auth || typeof auth.session !== 'function' || typeof auth.saveTrackedSession !== 'function') {
      return Promise.resolve({ ok: false });
    }
    return Promise.resolve().then(function () {
      return auth.session();
    }).then(function (session) {
      var userId = session && session.user && session.user.id;
      if (!isUuid(userId)) return { ok: false };
      return auth.saveTrackedSession(payload);
    }, function () {
      return { ok: false };
    }).then(function (res) {
      return res && res.ok ? { ok: true, id: res.id || null } : { ok: false };
    }, function () {
      return { ok: false };
    });
  }

  var api = {
    LB_TO_KG: LB_TO_KG,
    isUuid: isUuid,
    localDate: localDate,
    timeZone: timeZone,
    toKg: toKg,
    build: build,
    note: note,
    save: save
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WBTracking = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
