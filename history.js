/* History for one person's own sets. No network.
   Browser: window.WBHistory. Node: require.
   Rows come from that person's saved sessions. This file has no sample people. */
(function (root) {
  'use strict';
  var LB_TO_KG = 0.45359237;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function trim(n) {
    var x = Number(n);
    if (!isFinite(x)) return '';
    var r = Math.round(x * 100) / 100;
    var nearest = Math.round(r);
    if (Math.abs(r - nearest) < 0.02) return String(nearest);
    var tenth = Math.round(r * 10) / 10;
    if (Math.abs(r - tenth) < 0.001) return String(tenth);
    return String(r);
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function formatStopwatch(ms) {
    var cs = Math.floor(Math.min(Math.max(0, ms || 0), 5999990) / 10);
    var m = Math.floor(cs / 6000), sec = Math.floor(cs / 100) % 60, h = cs % 100;
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return p2(m) + ':' + p2(sec) + '.' + p2(h);
  }
  function formatDay(iso) {
    var s = String(iso || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[Number(s.slice(5, 7)) - 1] + ' ' + Number(s.slice(8, 10)) + ', ' + s.slice(0, 4);
  }
  function sessionDay(iso) {
    var s = String(iso || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
    var d = new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
    if (!isFinite(d.getTime())) return '';
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return days[d.getDay()] + ' ' + months[d.getMonth()] + ' ' + d.getDate();
  }
  function sessionLabel(date, name) {
    var day = sessionDay(date);
    var title = name || 'Workout';
    return day ? day + ' · ' + title : title;
  }
  function sessionDetailTitle(date, name) {
    var s = String(date || '');
    var title = name || 'Workout';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return title;
    var d = new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
    if (!isFinite(d.getTime())) return title;
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return title + ' · ' + days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate();
  }
  function clock(ts) {
    var t = typeof ts === 'number' ? ts : Date.parse(ts);
    if (!isFinite(t)) return '';
    var d = new Date(t);
    var h = d.getHours(), m = d.getMinutes();
    var ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
  }
  function timeOf(s) {
    if (!s) return 0;
    if (typeof s.startedAt === 'number' && isFinite(s.startedAt)) return s.startedAt;
    var n = Date.parse(s.startedAt || '');
    return isFinite(n) ? n : 0;
  }
  function newer(a, b) {
    if ((a.localDate || '') !== (b.localDate || '')) return (a.localDate || '') > (b.localDate || '');
    var at = timeOf(a), bt = timeOf(b);
    if (at !== bt) return at > bt;
    return Number(a.setNumber) > Number(b.setNumber);
  }
  function stillUrl(libraryId, base) {
    var model = root.WB;
    if (model && model.exerciseStillUrl) return model.exerciseStillUrl(libraryId, base);
    var folder = String(base == null ? '' : base).replace(/\/+$/, '');
    var id = String(libraryId || '').trim();
    if (!folder || !/^[A-Za-z0-9_-]{1,32}$/.test(id)) return '';
    return folder + '/still2/' + id + '.jpg';
  }
  function pick(row, camel, snake) {
    if (Object.prototype.hasOwnProperty.call(row, camel) && row[camel] != null) return row[camel];
    if (Object.prototype.hasOwnProperty.call(row, snake) && row[snake] != null) return row[snake];
    return null;
  }
  function exerciseKey(set) {
    if (!set) return '';
    if (set.libraryExerciseId) return 'lib-' + set.libraryExerciseId;
    if (set.personalExerciseId) return 'own-' + set.personalExerciseId;
    return '';
  }
  function clean(row) {
    if (!row || row.removed === true || row.removed === 'true') return null;
    var set = {
      sessionId: String(pick(row, 'sessionId', 'session_id') || ''),
      localDate: String(pick(row, 'localDate', 'local_date') || ''),
      startedAt: pick(row, 'startedAt', 'started_at'),
      workoutName: String(pick(row, 'workoutName', 'workout_name') || 'Workout'),
      origin: String(pick(row, 'origin', 'origin') || ''),
      exerciseName: String(pick(row, 'exerciseName', 'exercise_name') || 'Exercise'),
      libraryExerciseId: String(pick(row, 'libraryExerciseId', 'library_exercise_id') || ''),
      personalExerciseId: String(pick(row, 'personalExerciseId', 'personal_exercise_id') || ''),
      stableKey: String(pick(row, 'stableKey', 'stable_key') || ''),
      imageUrl: String(pick(row, 'imageUrl', 'image_url') || ''),
      mode: String(pick(row, 'mode', 'mode') || ''),
      setNumber: Number(pick(row, 'setNumber', 'set_number') || 0),
      status: pick(row, 'status', 'status') === 'skipped' ? 'skipped' : 'completed',
      displayUnit: pick(row, 'displayUnit', 'display_unit') || 'kg',
      plannedReps: num(pick(row, 'plannedReps', 'planned_reps')),
      plannedRepsMin: num(pick(row, 'plannedRepsMin', 'planned_reps_min')),
      plannedRepsMax: num(pick(row, 'plannedRepsMax', 'planned_reps_max')),
      plannedWeightKg: num(pick(row, 'plannedWeightKg', 'planned_weight_kg')),
      plannedBodyweight: !!(pick(row, 'plannedBodyweight', 'planned_bodyweight')),
      actualReps: num(pick(row, 'actualReps', 'actual_reps')),
      actualWeightKg: num(pick(row, 'actualWeightKg', 'actual_weight_kg')),
      actualBodyweight: !!(pick(row, 'actualBodyweight', 'actual_bodyweight')),
      plannedHoldSec: num(pick(row, 'plannedHoldSec', 'planned_hold_sec')),
      actualHoldSec: num(pick(row, 'actualHoldSec', 'actual_hold_sec')),
      plannedWorkSec: num(pick(row, 'plannedWorkSec', 'planned_work_sec')),
      actualWorkSec: num(pick(row, 'actualWorkSec', 'actual_work_sec')),
      plannedRestSec: num(pick(row, 'plannedRestSec', 'planned_rest_sec')),
      actualRestSec: num(pick(row, 'actualRestSec', 'actual_rest_sec')),
      plannedRounds: num(pick(row, 'plannedRounds', 'planned_rounds')),
      actualRounds: num(pick(row, 'actualRounds', 'actual_rounds')),
      plannedTotalSec: num(pick(row, 'plannedTotalSec', 'planned_total_sec')),
      actualTotalSec: num(pick(row, 'actualTotalSec', 'actual_total_sec')),
      plannedLapCount: num(pick(row, 'plannedLapCount', 'planned_lap_count')),
      actualLaps: pick(row, 'actualLaps', 'actual_laps'),
      plannedEvents: pick(row, 'plannedEvents', 'planned_events'),
      actualEvents: pick(row, 'actualEvents', 'actual_events')
    };
    if (set.displayUnit !== 'lb' && set.displayUnit !== 'kg' && set.displayUnit !== 'bodyweight') set.displayUnit = 'kg';
    if (!Array.isArray(set.actualLaps)) set.actualLaps = [];
    if (!Array.isArray(set.plannedEvents)) set.plannedEvents = [];
    if (!Array.isArray(set.actualEvents)) set.actualEvents = [];
    set.key = exerciseKey(set);
    if (!set.key || !set.sessionId || !/^\d{4}-\d{2}-\d{2}$/.test(set.localDate)) return null;
    return set;
  }
  function prepare(sets) {
    var out = [];
    (sets || []).forEach(function (row) {
      var set = clean(row);
      if (set) out.push(set);
    });
    return out;
  }
  function fromRows(sessions, sets, exercises) {
    var byId = {};
    (sessions || []).forEach(function (s) {
      if (!s || !s.id || s.status === 'in_progress') return;
      byId[s.id] = s;
    });
    var stable = {};
    (exercises || []).forEach(function (ex) {
      if (ex && ex.id) stable[ex.id] = ex.stable_key || ex.stableKey || '';
    });
    var out = [];
    (sets || []).forEach(function (row) {
      if (!row) return;
      var sid = row.session_id || row.sessionId;
      var session = byId[sid];
      if (!session) return;
      var merged = {};
      Object.keys(row).forEach(function (k) { merged[k] = row[k]; });
      merged.sessionId = sid;
      merged.localDate = session.local_date || session.localDate;
      merged.startedAt = session.started_at || session.startedAt;
      merged.workoutName = session.workout_name || session.workoutName || 'Workout';
      merged.origin = session.origin || '';
      if (!merged.stableKey && !merged.stable_key && merged.personal_exercise_id) {
        merged.stableKey = stable[merged.personal_exercise_id] || '';
      }
      var set = clean(merged);
      if (set) out.push(set);
    });
    return out;
  }
  function displayWeight(kg, unit, bodyweight) {
    if (bodyweight || unit === 'bodyweight') return 'Bodyweight';
    var n = num(kg);
    if (n == null) return '';
    if (unit === 'lb') n = n / LB_TO_KG;
    var text = trim(n);
    if (!text) return '';
    return text + ' ' + (unit === 'lb' ? 'lb' : 'kg');
  }
  function repsPart(reps, min, max) {
    if (reps != null) return trim(reps);
    if (min != null && max != null) return trim(min) + '–' + trim(max);
    return '';
  }
  function weightPart(kg, unit, bodyweight) {
    return displayWeight(kg, unit, bodyweight);
  }
  function joinReps(reps, weight) {
    if (reps && weight) return reps + ' × ' + weight;
    if (reps) return reps + ' reps';
    return weight || '';
  }
  function effortLine(mode, work, rest, rounds, reps, min, max, weight, gapWord) {
    var parts = [];
    var gap = gapWord || 'rest';
    if (mode === 'timer' && work != null && rest != null && Number(rest) !== 0) parts.push(fmtTime(work) + ' work / ' + fmtTime(rest) + ' ' + gap);
    else if (mode === 'timer' && work != null) parts.push(fmtTime(work) + ' work');
    else if (mode === 'timer' && rest != null && Number(rest) !== 0) parts.push(fmtTime(rest) + ' ' + gap);
    else if (mode === 'intervals' && work != null) parts.push(fmtTime(work) + ' work');
    if (rounds != null) parts.push(trim(rounds) + (Number(rounds) === 1 ? ' round' : ' rounds'));
    var r = repsPart(reps, min, max);
    if (r) parts.push(r + ' reps');
    if (weight) parts.push(weight);
    return parts.join(' · ');
  }
  function prescription(set, actual) {
    var mode = set.mode;
    if (mode === 'reps') {
      return joinReps(
        repsPart(actual ? set.actualReps : set.plannedReps, actual ? null : set.plannedRepsMin, actual ? null : set.plannedRepsMax),
        weightPart(actual ? set.actualWeightKg : set.plannedWeightKg, set.displayUnit, actual ? set.actualBodyweight : set.plannedBodyweight)
      );
    }
    if (mode === 'static_hold') {
      var hold = actual ? set.actualHoldSec : set.plannedHoldSec;
      return hold == null ? '' : fmtTime(hold) + ' hold';
    }
    if (mode === 'intervals' || mode === 'timer') {
      // A finished timer does not store its own rest. The rest that ran is the planned rest.
      var rest = actual && set.actualRestSec != null ? set.actualRestSec : set.plannedRestSec;
      return effortLine(
        mode,
        actual ? set.actualWorkSec : set.plannedWorkSec,
        rest,
        actual ? set.actualRounds : set.plannedRounds,
        actual ? set.actualReps : set.plannedReps,
        actual ? null : set.plannedRepsMin,
        actual ? null : set.plannedRepsMax,
        weightPart(actual ? set.actualWeightKg : set.plannedWeightKg, set.displayUnit, actual ? set.actualBodyweight : set.plannedBodyweight),
        set.origin === 'circuit' ? 'move' : 'rest'
      );
    }
    if (mode === 'stopwatch') {
      var bits = [];
      if (!actual && set.plannedTotalSec != null) bits.push(formatStopwatch(set.plannedTotalSec * 1000));
      if (actual && set.actualTotalSec != null) bits.push(formatStopwatch(set.actualTotalSec * 1000));
      return bits.join(' · ');
    }
    return '';
  }
  function sameNum(a, b) {
    var x = num(a), y = num(b);
    if (x == null && y == null) return true;
    return x === y;
  }
  function repsMatch(set) {
    var actual = num(set.actualReps);
    if (set.plannedReps != null) return actual === num(set.plannedReps);
    if (set.plannedRepsMin != null && set.plannedRepsMax != null) {
      return actual != null && actual >= Number(set.plannedRepsMin) && actual <= Number(set.plannedRepsMax);
    }
    return actual == null;
  }
  function plannedDiffers(set, actualText) {
    var sameWeight = weightPart(set.actualWeightKg, set.displayUnit, set.actualBodyweight) === weightPart(set.plannedWeightKg, set.displayUnit, set.plannedBodyweight);
    if (set.mode === 'stopwatch') {
      var bits = [];
      if (set.plannedTotalSec != null && set.actualTotalSec != null) {
        var plannedClock = formatStopwatch(set.plannedTotalSec * 1000);
        if (plannedClock !== actualText) bits.push(plannedClock);
      }
      var laps = set.actualLaps.length;
      if (set.plannedLapCount != null && Number(set.plannedLapCount) !== laps) {
        var n = Number(set.plannedLapCount);
        bits.push(trim(n) + (n === 1 ? ' lap' : ' laps'));
      }
      return bits.join(' · ');
    }
    if (set.mode === 'reps' && repsMatch(set) && sameWeight) return '';
    if (set.mode === 'intervals' || set.mode === 'timer') {
      var restSame = set.mode !== 'timer' || set.actualRestSec == null || sameNum(set.actualRestSec, set.plannedRestSec);
      if (sameNum(set.actualWorkSec, set.plannedWorkSec) && restSame && sameNum(set.actualRounds, set.plannedRounds) && repsMatch(set) && sameWeight) return '';
    }
    var planned = prescription(set, false);
    if (!planned || planned === actualText) return '';
    return planned;
  }
  function eventBits(events) {
    var pass = 0, fail = 0, lines = [];
    (events || []).forEach(function (ev) {
      if (!ev) return;
      var result = ev.result === 'pass' ? 'Pass' : ev.result === 'fail' ? 'Fail' : '';
      if (ev.result === 'pass') pass++;
      else if (ev.result === 'fail') fail++;
      if (!result) return;
      lines.push('Lap ' + ev.lap + ' · ' + (ev.name || 'Event') + ' · ' + result);
    });
    var counts = [];
    if (pass) counts.push(pass + (pass === 1 ? ' pass' : ' passes'));
    if (fail) counts.push(fail + (fail === 1 ? ' fail' : ' fails'));
    return { counts: counts.join(' · '), lines: lines, pass: pass };
  }
  function present(set) {
    var laps = (set.actualLaps || []).map(function (lap) {
      var lapSec = num(lap.lapSec != null ? lap.lapSec : lap.lap_sec);
      var totalSec = num(lap.totalSec != null ? lap.totalSec : lap.total_sec);
      return {
        n: Number(lap.n),
        label: 'Lap ' + lap.n,
        time: lapSec == null ? '' : formatStopwatch(lapSec * 1000),
        total: totalSec == null ? '' : formatStopwatch(totalSec * 1000),
        badge: ''
      };
    });
    var events = eventBits(set.status === 'skipped' ? [] : set.actualEvents);
    if (set.status === 'skipped') {
      var planned = prescription(set, false);
      return { skipped: true, actual: 'Skipped', planned: planned, laps: [], counts: '', events: [] };
    }
    var actual = prescription(set, true);
    return {
      skipped: false,
      actual: actual,
      planned: plannedDiffers(set, actual),
      laps: set.mode === 'stopwatch' ? laps : [],
      counts: set.mode === 'stopwatch' ? events.counts : '',
      events: set.mode === 'stopwatch' ? events.lines : []
    };
  }
  function pickNewer(indexes, sets) {
    var best = indexes[0];
    indexes.forEach(function (i) { if (newer(sets[i], sets[best])) best = i; });
    return best;
  }
  function records(sets) {
    var setBadges = {};
    var lapBadges = {};
    function add(i, label) {
      if (i == null) return;
      setBadges[i] = setBadges[i] || [];
      if (setBadges[i].indexOf(label) < 0) setBadges[i].push(label);
    }
    var heavy = [], heavyKg = null;
    var buckets = {};
    var hold = [], holdSec = null;
    var fast = [], fastSec = null;
    var bestLap = null;
    var passes = [], passN = null;
    sets.forEach(function (s, i) {
      if (s.status !== 'completed') return;
      var kg = (!s.actualBodyweight && s.displayUnit !== 'bodyweight') ? num(s.actualWeightKg) : null;
      if (kg != null) {
        if (heavyKg == null || kg > heavyKg + 1e-6) { heavyKg = kg; heavy = [i]; }
        else if (Math.abs(kg - heavyKg) <= 1e-6) heavy.push(i);
      }
      if ((s.mode === 'reps' || s.mode === 'intervals' || s.mode === 'timer') && s.actualReps != null) {
        var bucketKey = (s.actualBodyweight || s.displayUnit === 'bodyweight') ? 'bw' : (kg == null ? '' : String(Math.round(kg * 1000)));
        if (bucketKey) {
          buckets[bucketKey] = buckets[bucketKey] || [];
          buckets[bucketKey].push({ i: i, reps: Number(s.actualReps) });
        }
      }
      if (s.mode === 'static_hold' && s.actualHoldSec != null) {
        var sec = Number(s.actualHoldSec);
        if (holdSec == null || sec > holdSec) { holdSec = sec; hold = [i]; }
        else if (sec === holdSec) hold.push(i);
      }
      if (s.mode === 'stopwatch' && s.actualTotalSec != null && Number(s.actualTotalSec) > 0) {
        var total = Number(s.actualTotalSec);
        if (fastSec == null || total < fastSec) { fastSec = total; fast = [i]; }
        else if (total === fastSec) fast.push(i);
      }
      if (s.mode === 'stopwatch') {
        (s.actualLaps || []).forEach(function (lap) {
          var lapSec = num(lap.lapSec != null ? lap.lapSec : lap.lap_sec);
          if (!(lapSec > 0)) return;
          if (bestLap == null || lapSec < bestLap.sec - 1e-9) bestLap = { sec: lapSec, hits: [{ i: i, n: Number(lap.n) }] };
          else if (Math.abs(lapSec - bestLap.sec) <= 1e-9) bestLap.hits.push({ i: i, n: Number(lap.n) });
        });
        var nPass = 0;
        (s.actualEvents || []).forEach(function (ev) { if (ev && ev.result === 'pass') nPass++; });
        if (nPass > 0) {
          if (passN == null || nPass > passN) { passN = nPass; passes = [i]; }
          else if (nPass === passN) passes.push(i);
        }
      }
    });
    if (heavy.length) add(pickNewer(heavy, sets), 'Heaviest');
    Object.keys(buckets).forEach(function (key) {
      var rows = buckets[key];
      if (rows.length < 2) return;
      var max = rows[0].reps;
      rows.forEach(function (r) { if (r.reps > max) max = r.reps; });
      if (!rows.some(function (r) { return r.reps < max - 1e-9; })) return;
      var idxs = rows.filter(function (r) { return Math.abs(r.reps - max) < 1e-9; }).map(function (r) { return r.i; });
      add(pickNewer(idxs, sets), 'Most reps');
    });
    if (hold.length) add(pickNewer(hold, sets), 'Longest hold');
    if (fast.length) add(pickNewer(fast, sets), 'Fastest');
    if (passes.length) add(pickNewer(passes, sets), 'Most passes');
    if (bestLap) {
      var newest = bestLap.hits[0];
      bestLap.hits.forEach(function (hit) { if (newer(sets[hit.i], sets[newest.i])) newest = hit; });
      bestLap.hits.forEach(function (hit) {
        if (hit.i !== newest.i) return;
        lapBadges[hit.i] = lapBadges[hit.i] || {};
        lapBadges[hit.i][hit.n] = 'Best lap';
      });
    }
    return { set: setBadges, lap: lapBadges };
  }
  function imageOf(sets) {
    var found = null;
    sets.forEach(function (s) {
      if (!s.imageUrl) return;
      if (!found || newer(s, found)) found = s;
    });
    return found ? found.imageUrl : '';
  }
  function list(sets) {
    var groups = {}, order = [];
    prepare(sets).forEach(function (s) {
      if (!groups[s.key]) { groups[s.key] = []; order.push(s.key); }
      groups[s.key].push(s);
    });
    var rows = [];
    order.forEach(function (key) {
      var all = groups[key];
      var done = all.filter(function (s) { return s.status === 'completed'; });
      if (!done.length) return;
      var sessions = {}, last = '', named = done[0];
      done.forEach(function (s) {
        sessions[s.sessionId] = 1;
        if (!last || s.localDate > last) last = s.localDate;
        if (newer(s, named)) named = s;
      });
      rows.push({
        key: key,
        name: named.exerciseName,
        lastDate: last,
        lastLabel: formatDay(last),
        sessions: Object.keys(sessions).length,
        libraryExerciseId: named.libraryExerciseId || '',
        stableKey: named.stableKey || '',
        imageUrl: imageOf(all)
      });
    });
    rows.sort(function (a, b) {
      if (a.lastDate !== b.lastDate) return a.lastDate < b.lastDate ? 1 : -1;
      if (a.name === b.name) return 0;
      return a.name < b.name ? -1 : 1;
    });
    return rows;
  }
  // One row per tracked session, newest first. The same workout on two days is two rows.
  function workouts(sets) {
    var groups = {};
    var order = [];
    prepare(sets).forEach(function (s) {
      if (s.status !== 'completed') return;
      if (!groups[s.sessionId]) {
        groups[s.sessionId] = [];
        order.push(s.sessionId);
      }
      groups[s.sessionId].push(s);
    });
    var rows = [];
    order.forEach(function (id) {
      var all = groups[id];
      var named = all[0];
      all.forEach(function (s) { if (newer(s, named)) named = s; });
      rows.push({
        id: id,
        name: named.workoutName || 'Workout',
        origin: named.origin || '',
        date: named.localDate,
        label: sessionLabel(named.localDate, named.workoutName),
        sets: all.length,
        startedAt: timeOf(named)
      });
    });
    rows.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? 1 : -1;
      if (a.name !== b.name) return a.name < b.name ? -1 : 1;
      if (a.id !== b.id) return a.id < b.id ? -1 : 1;
      return 0;
    });
    return rows;
  }
  function filter(rows, query) {
    var q = String(query || '').replace(/^\s+|\s+$/g, '').toLowerCase();
    if (!q) return (rows || []).slice();
    return (rows || []).filter(function (row) {
      return String(row.name || '').toLowerCase().indexOf(q) >= 0;
    });
  }
  function filterWorkouts(rows, query) {
    var q = String(query || '').replace(/^\s+|\s+$/g, '').toLowerCase();
    if (!q) return (rows || []).slice();
    return (rows || []).filter(function (row) {
      return String(row.label || row.name || '').toLowerCase().indexOf(q) >= 0;
    });
  }
  function decorate(rows, opts) {
    opts = opts || {};
    return (rows || []).map(function (row) {
      var copy = {};
      Object.keys(row).forEach(function (k) { copy[k] = row[k]; });
      copy.still = '';
      copy.uploadKey = '';
      if (!copy.imageUrl && copy.libraryExerciseId && opts.stillBase) copy.still = stillUrl(copy.libraryExerciseId, opts.stillBase);
      if (!copy.imageUrl && !copy.still && copy.stableKey && opts.imageKey) copy.uploadKey = opts.imageKey(copy.stableKey) || '';
      return copy;
    });
  }
  function detail(sets, key) {
    var mine = prepare(sets).filter(function (s) { return s.key === key; });
    var name = '', nameSet = null;
    mine.forEach(function (s) {
      if (s.status !== 'completed') return;
      if (!nameSet || newer(s, nameSet)) { nameSet = s; name = s.exerciseName; }
    });
    if (!name && mine[0]) name = mine[0].exerciseName;
    var marks = records(mine);
    var views = mine.map(function (s, i) {
      var view = present(s);
      view.label = 'Set ' + s.setNumber;
      view.badges = (marks.set[i] || []).slice();
      view.laps.forEach(function (lap) {
        if (marks.lap[i] && marks.lap[i][lap.n]) lap.badge = marks.lap[i][lap.n];
      });
      view.sessionId = s.sessionId;
      view.localDate = s.localDate;
      view.startedAt = s.startedAt;
      view.workoutName = s.workoutName || 'Workout';
      view.origin = s.origin || '';
      view.setNumber = s.setNumber;
      return view;
    });
    views.sort(function (a, b) {
      if (a.localDate !== b.localDate) return a.localDate < b.localDate ? 1 : -1;
      var at = timeOf(a), bt = timeOf(b);
      if (at !== bt) return at < bt ? 1 : -1;
      return a.setNumber - b.setNumber;
    });
    var days = [], day = null, session = null;
    views.forEach(function (view) {
      if (!day || day.date !== view.localDate) {
        day = { date: view.localDate, label: formatDay(view.localDate), sessions: [] };
        days.push(day);
        session = null;
      }
      if (!session || session.id !== view.sessionId) {
        session = { id: view.sessionId, name: view.workoutName, origin: view.origin || '', time: clock(view.startedAt), sets: [] };
        day.sessions.push(session);
      }
      session.sets.push(view);
    });
    return { key: key, name: name || 'Exercise', days: days };
  }
  function viewedSet(set, marks, index) {
    var view = present(set);
    view.label = 'Set ' + set.setNumber;
    view.badges = (index != null && marks.set[index] ? marks.set[index] : []).slice();
    view.laps.forEach(function (lap) {
      if (index != null && marks.lap[index] && marks.lap[index][lap.n]) lap.badge = marks.lap[index][lap.n];
    });
    view.setNumber = set.setNumber;
    return view;
  }
  function sessionDetail(sets, sessionId) {
    var prepared = prepare(sets);
    var id = String(sessionId || '');
    var mine = prepared.filter(function (s) { return s.sessionId === id; });
    if (!mine.length) return { id: id, name: 'Workout', label: '', date: '', exercises: [] };
    var named = mine[0];
    mine.forEach(function (s) { if (newer(s, named)) named = s; });
    var ordered = mine.slice().sort(function (a, b) {
      if (a.setNumber !== b.setNumber) return a.setNumber - b.setNumber;
      return 0;
    });
    var groups = {};
    var order = [];
    ordered.forEach(function (s) {
      if (!groups[s.key]) {
        groups[s.key] = [];
        order.push(s.key);
      }
      groups[s.key].push(s);
    });
    var exercises = order.map(function (key) {
      var rows = groups[key];
      var all = prepared.filter(function (s) { return s.key === key; });
      var marks = records(all);
      var views = rows.map(function (s) { return viewedSet(s, marks, all.indexOf(s)); });
      views.sort(function (a, b) { return a.setNumber - b.setNumber; });
      return { key: key, name: rows[0].exerciseName || 'Exercise', sets: views };
    });
    return {
      id: id,
      name: named.workoutName || 'Workout',
      origin: named.origin || '',
      date: named.localDate,
      label: sessionLabel(named.localDate, named.workoutName),
      exercises: exercises
    };
  }
  function emptyHtml(opts) {
    opts = opts || {};
    var title = opts.unavailable ? 'History is not available yet' : 'No history yet';
    var body = opts.unavailable ? 'Saved sessions are not available yet.' : 'Finish a workout and your sets will show up here.';
    return '<div class="empty hx-empty" id="history-empty"><div class="name">' + esc(title) + '</div>' + esc(body) + '</div>';
  }
  function rowHtml(row) {
    var thumb = '';
    if (row.imageUrl) thumb = '<span class="hx-thumb is-upload"><img alt="" src="' + esc(row.imageUrl) + '"></span>';
    else if (row.still) thumb = '<span class="hx-thumb is-still"><img alt="" src="' + esc(row.still) + '"></span>';
    else if (row.uploadKey) thumb = '<span class="hx-thumb is-upload" data-hx-img="' + esc(row.uploadKey) + '"></span>';
    var sessions = row.sessions === 1 ? '1 session' : row.sessions + ' sessions';
    return '<button type="button" class="hx-row" data-history="' + esc(row.key) + '">' + thumb +
      '<span class="grow"><span class="name">' + esc(row.name) + '</span>' +
      '<span class="mute">Last done ' + esc(row.lastLabel) + ' · ' + sessions + '</span></span></button>';
  }
  function itemsHtml(rows) {
    if (!rows || !rows.length) return '<div class="empty" id="history-none">No exercises match that search.</div>';
    return rows.map(rowHtml).join('');
  }
  function circuitTag(origin) {
    return origin === 'circuit' ? '<span class="hx-tag">Group circuit</span>' : '';
  }
  function workoutRowHtml(row) {
    var count = row.sets === 1 ? '1 set' : row.sets + ' sets';
    return '<button type="button" class="hx-row" data-session="' + esc(row.id) + '">' +
      '<span class="grow"><span class="name">' + esc(row.label) + circuitTag(row.origin) + '</span>' +
      '<span class="mute">' + count + '</span></span></button>';
  }
  function workoutItemsHtml(rows) {
    if (!rows || !rows.length) return '<div class="empty" id="history-none">No workouts match that search.</div>';
    return rows.map(workoutRowHtml).join('');
  }
  function viewToggle(view) {
    var workoutOn = view !== 'exercise';
    function button(id, mode, label, on) {
      return '<button type="button" id="' + id + '" data-history-view="' + mode + '"' +
        (on ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>' + esc(label) + '</button>';
    }
    return '<div class="seg" id="history-views" role="group" aria-label="History list">' +
      button('history-by-workout', 'workout', 'By workout', workoutOn) +
      button('history-by-exercise', 'exercise', 'By exercise', !workoutOn) +
      '</div>';
  }
  function listHtml(sets, opts) {
    opts = opts || {};
    var view = opts.view === 'exercise' ? 'exercise' : 'workout';
    var rows = view === 'exercise' ? decorate(list(sets), opts) : workouts(sets);
    if (!rows.length) return emptyHtml(opts);
    var searchLabel = view === 'exercise' ? 'Search exercises' : 'Search workouts';
    var items = view === 'exercise' ? itemsHtml(rows) : workoutItemsHtml(rows);
    return viewToggle(view) +
      '<input id="history-q" type="search" aria-label="' + searchLabel + '" placeholder="' + searchLabel + '" autocomplete="off">' +
      '<div id="history-list">' + items + '</div>';
  }
  function setBlock(set) {
    var h = '<div class="hx-set' + (set.skipped ? ' is-skip' : '') + '"><div class="hx-set-top"><span class="hx-set-no">' + esc(set.label) + '</span>';
    (set.badges || []).forEach(function (badge) { h += '<span class="hx-badge">' + esc(badge) + '</span>'; });
    h += '</div><div class="hx-actual">' + esc(set.actual) + '</div>';
    if (set.planned) h += '<div class="hx-plan">planned ' + esc(set.planned) + '</div>';
    if (set.laps && set.laps.length) {
      h += '<ul class="hx-laps">';
      set.laps.forEach(function (lap) {
        h += '<li class="hx-lap"><span>' + esc(lap.label) + '</span><b>' + esc(lap.time) + '</b>';
        if (lap.badge) h += '<span class="hx-badge">' + esc(lap.badge) + '</span>';
        if (lap.total) h += '<i>' + esc(lap.total) + '</i>';
        h += '</li>';
      });
      h += '</ul>';
    }
    if (set.counts) h += '<div class="hx-counts">' + esc(set.counts) + '</div>';
    if (set.events && set.events.length) {
      h += '<ul class="hx-events">';
      set.events.forEach(function (line) { h += '<li>' + esc(line) + '</li>'; });
      h += '</ul>';
    }
    return h + '</div>';
  }
  function detailHtml(view, opts) {
    opts = opts || {};
    if (!view || !view.days || !view.days.length) return emptyHtml(opts);
    var h = '';
    view.days.forEach(function (day) {
      h += '<h2 class="hx-date">' + esc(day.label) + '</h2>';
      day.sessions.forEach(function (session) {
        h += '<article class="card hx-session" data-origin="' + esc(session.origin || '') + '"><div class="row"><div class="name grow">' + esc(session.name) + circuitTag(session.origin) + '</div>';
        if (session.time) h += '<div class="mute">' + esc(session.time) + '</div>';
        h += '</div>';
        session.sets.forEach(function (set) { h += setBlock(set); });
        h += '</article>';
      });
    });
    return h;
  }
  function sessionHtml(view, opts) {
    opts = opts || {};
    if (!view || !view.exercises || !view.exercises.length) return emptyHtml(opts);
    var h = '<h2 class="hx-session-title">' + esc(sessionDetailTitle(view.date, view.name || view.label)) + circuitTag(view.origin) + '</h2>';
    view.exercises.forEach(function (exercise) {
      h += '<article class="card hx-session"><div class="row"><div class="name grow">' + esc(exercise.name) + '</div></div>';
      (exercise.sets || []).forEach(function (set) { h += setBlock(set); });
      h += '</article>';
    });
    return h;
  }
  // Read every page. A bare PostgREST select stops at 1000 rows, so fetchPage(after, size)
  // must return the next size rows with id greater than after (after is null on the first page).
  function collectPages(fetchPage, size) {
    size = size || 1000;
    var cap = 50;
    var out = [];
    var seen = {};
    function next(after, n) {
      if (n >= cap) return Promise.resolve({ data: null, error: { message: 'history page limit' } });
      return Promise.resolve().then(function () {
        return fetchPage(after, size);
      }).then(function (res) {
        if (!res || res.error) return { data: null, error: (res && res.error) || { message: 'history read failed' } };
        var rows = res.data || [];
        if (!rows.length) return { data: out, error: null };
        if (rows.length > size) return { data: null, error: { message: 'history page overran its limit' } };
        var i, id;
        for (i = 0; i < rows.length; i++) {
          id = rows[i] && rows[i].id;
          if (!id || seen[id]) return { data: null, error: { message: 'history page did not advance' } };
          seen[id] = true;
        }
        out = out.concat(rows);
        if (rows.length < size) return { data: out, error: null };
        return next(rows[rows.length - 1].id, n + 1);
      }, function () {
        return { data: null, error: { message: 'history read failed' } };
      });
    }
    return next(null, 0);
  }

  var api = {
    exerciseKey: exerciseKey,
    fromRows: fromRows,
    records: records,
    list: list,
    workouts: workouts,
    filter: filter,
    filterWorkouts: filterWorkouts,
    decorate: decorate,
    detail: detail,
    sessionDetail: sessionDetail,
    listHtml: listHtml,
    itemsHtml: itemsHtml,
    workoutItemsHtml: workoutItemsHtml,
    detailHtml: detailHtml,
    sessionHtml: sessionHtml,
    emptyHtml: emptyHtml,
    stillUrl: stillUrl,
    collectPages: collectPages,
    formatDay: formatDay,
    clock: clock
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WBHistory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
