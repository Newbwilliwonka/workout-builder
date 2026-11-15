/* History for one person's own sets. No network.
   Browser: window.WBHistory. Node: require.
   Sample rows are a test account for the preview screens. They are not saved. */
(function (root) {
  'use strict';
  var LB_TO_KG = 0.45359237;
  var FARMER_PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHAAAABwCAIAAABJgmMcAAAD8ElEQVR42u3by5LaMBAFUH1IFlllHQb8EMbjYR7JPqss8/9fEdv4IcsyMOPuVpu6VXeN0amrtjBg0sNPhDAGBAAFKEARgAL0UUGzZIcQBqAABShAEYDqAc3TJ4QwAAUoQAGKAFQPqM32CGEAClCABvPt+w/uABSgAJ2DHvNDlAiARlkXQAEK0DtBtb0gQAEKUIDeBi1sEiXz9Wt7wa8FoAAF6DzBkUcOWl/l8UGv3EM4QC95WNBhhcGHI+Sg9VXkTc3pmMqkN02WGrry9Zcb2i1VZplGjPJmQ8lBgw3dPKinabPD0vNQDtA2oqYmimaePgmA1leRNzUic3PUzFtNMdAmIdNNgl7RzBIJ0Poq8qamLDKOzO/sNxu68or3NXSy5TkWboQ089sNJQf1G5pLmPKCHu2oaR3NLNmJgO4GU+uabgs0NEAvmvtBMz3sBL5Tqq/imHZf887H6AZAC5v6o1Ncc9nU3fjqQb16uqMzS1vNRE6zM738nWA2TJlKap5POWGWtvxgKqzZDVNHM7jlCQUMrebkjjTb8lE0nSOUv+XdeioFPR2zxS2fxATtxmh4y6sEDR+Y+npmUevpbHynpJalpPSg/S1+Oj2v1vPP339LYSqpM0kVg/r7/b7peUWT3NSbpBy73lSlXZ+FkibdDE33X9akNe00Q+fQyxLWUxCDBku6UpPW9Ho99YION6V8AfRTmoSmeeCmpBK0LPLgIZSkntQlDR5F1YH2A3QCulcJuh8/zk+PTSpB+2OTVQxqF45N2kHXnJZYz0+MoC/Px/UJ35fyRC2oM0And6T1FAAFKEABSgRqk+uriqXZgNpHBJX/LC8Beq6K9WlNO9ayZy1Cv+aI+7Rp/C1qT1mOnzgbjvUUZKDznt6/PGHN/pc/gW4qBO0O+af2kB/9Kf2yZnoan9pZvaDegxLNoN4DEV2g/Ri13hhVDOoNUEuiSQzqj9FCMWjBMkAb0NeXE0nGnjrDVC3oMDorh5LEgQz0Yjr2tFQPOh2dVAjEoN6ZVDOod/bUCDovqV5QnnqygE5LalXW0zLVkx7UK2mlsqQVWz0b0LdzSZuRtZVVCNpQOsWkXT496MX0XI1VVafZ7XR6TUZQd55qAz2z1ZMLVK0ptyYjqGeqBJRbkxdUm6mAphRoa6oCtD/cMIK+vz6zppNtcSNqNo79mlnXyw46mNaJCPomoikE6rJG1JRZphxoLFNJTWlQeVNhzQigA6uMpvzSzMdbFSusmrEWFROUzzTiiiKDkrNGX4sKUCpTDQvRArqSVc8SdIF+VlbhOze/3l82kZpvE+9zM6BbCUABClCAIitAf3+cEcIAFKAABSgCUDX5D018RjLka8+LAAAAAElFTkSuQmCC';

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
    return folder + '/still/' + id + '.jpg';
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
      actualEvents: pick(row, 'actualEvents', 'actual_events')
    };
    if (set.displayUnit !== 'lb' && set.displayUnit !== 'kg' && set.displayUnit !== 'bodyweight') set.displayUnit = 'kg';
    if (!Array.isArray(set.actualLaps)) set.actualLaps = [];
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
  function effortLine(mode, work, rest, rounds, reps, min, max, weight) {
    var parts = [];
    if (mode === 'timer' && (work != null || rest != null)) parts.push(fmtTime(work) + ' work / ' + fmtTime(rest) + ' rest');
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
      return effortLine(
        mode,
        actual ? set.actualWorkSec : set.plannedWorkSec,
        actual ? set.actualRestSec : set.plannedRestSec,
        actual ? set.actualRounds : set.plannedRounds,
        actual ? set.actualReps : set.plannedReps,
        actual ? null : set.plannedRepsMin,
        actual ? null : set.plannedRepsMax,
        weightPart(actual ? set.actualWeightKg : set.plannedWeightKg, set.displayUnit, actual ? set.actualBodyweight : set.plannedBodyweight)
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
  function plannedDiffers(set, actualText) {
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
    if (set.mode === 'reps' || set.mode === 'intervals' || set.mode === 'timer') {
      var reps = num(set.actualReps);
      var inRange = set.plannedReps == null && set.plannedRepsMin != null && set.plannedRepsMax != null && reps != null && reps >= set.plannedRepsMin && reps <= set.plannedRepsMax;
      var sameWeight = weightPart(set.actualWeightKg, set.displayUnit, set.actualBodyweight) === weightPart(set.plannedWeightKg, set.displayUnit, set.plannedBodyweight);
      if (inRange && sameWeight) return '';
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
  function filter(rows, query) {
    var q = String(query || '').replace(/^\s+|\s+$/g, '').toLowerCase();
    if (!q) return (rows || []).slice();
    return (rows || []).filter(function (row) {
      return String(row.name || '').toLowerCase().indexOf(q) >= 0;
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
        session = { id: view.sessionId, name: view.workoutName, time: clock(view.startedAt), sets: [] };
        day.sessions.push(session);
      }
      session.sets.push(view);
    });
    return { key: key, name: name || 'Exercise', days: days };
  }
  function sampleNote() {
    return '<p class="note" id="history-sample">Test account · Alex Rivera · sample data</p>';
  }
  function emptyHtml(opts) {
    opts = opts || {};
    var title = opts.unavailable ? 'History is not available yet' : 'No history yet';
    var body = opts.unavailable ? 'Saved sessions are not available yet.' : 'Finish a workout and your sets will show up here.';
    return (opts.sample ? sampleNote() : '') +
      '<div class="empty hx-empty" id="history-empty"><div class="name">' + esc(title) + '</div>' + esc(body) + '</div>';
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
  function listHtml(sets, opts) {
    opts = opts || {};
    var rows = decorate(list(sets), opts);
    if (!rows.length) return emptyHtml(opts);
    return (opts.sample ? sampleNote() : '') +
      '<input id="history-q" type="search" aria-label="Search exercises" placeholder="Search exercises" autocomplete="off">' +
      '<div id="history-list">' + itemsHtml(rows) + '</div>';
  }
  function detailHtml(view, opts) {
    opts = opts || {};
    if (!view || !view.days || !view.days.length) return emptyHtml(opts);
    var h = opts.sample ? sampleNote() : '';
    view.days.forEach(function (day) {
      h += '<h2 class="hx-date">' + esc(day.label) + '</h2>';
      day.sessions.forEach(function (session) {
        h += '<article class="card hx-session"><div class="row"><div class="name grow">' + esc(session.name) + '</div>';
        if (session.time) h += '<div class="mute">' + esc(session.time) + '</div>';
        h += '</div>';
        session.sets.forEach(function (set) {
          h += '<div class="hx-set' + (set.skipped ? ' is-skip' : '') + '"><div class="hx-set-top"><span class="hx-set-no">' + esc(set.label) + '</span>';
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
          h += '</div>';
        });
        h += '</article>';
      });
    });
    return h;
  }
  function at(y, m, d, hh, mm) { return new Date(y, m - 1, d, hh, mm).getTime(); }
  function kg(lb) { return Math.round(lb * LB_TO_KG * 1000000) / 1000000; }
  function lap(n, lapSec, totalSec) { return { n: n, lapSec: lapSec, totalSec: totalSec }; }
  function sampleSets() {
    var farmer = 'c0ffee00-0000-4000-8000-000000000001';
    var sprint = 'c0ffee00-0000-4000-8000-000000000002';
    var plank = 'c0ffee00-0000-4000-8000-000000000003';
    function row(over) {
      return Object.assign({
        removed: false, status: 'completed', displayUnit: 'lb', workoutName: 'Workout',
        plannedBodyweight: false, actualBodyweight: false, actualLaps: [], actualEvents: []
      }, over);
    }
    return [
      row({ sessionId: 'sq-1112', localDate: '2026-11-12', startedAt: at(2026, 11, 12, 18, 40), workoutName: 'Lower strength', exerciseName: 'Barbell squat', libraryExerciseId: '0101', mode: 'reps', setNumber: 1, plannedReps: 5, plannedWeightKg: kg(205), actualReps: 3, actualWeightKg: kg(225) }),
      row({ sessionId: 'sq-1112', localDate: '2026-11-12', startedAt: at(2026, 11, 12, 18, 40), workoutName: 'Lower strength', exerciseName: 'Barbell squat', libraryExerciseId: '0101', mode: 'reps', setNumber: 2, plannedReps: 6, plannedWeightKg: kg(185), actualReps: 8, actualWeightKg: kg(185) }),
      row({ sessionId: 'sq-1112', localDate: '2026-11-12', startedAt: at(2026, 11, 12, 18, 40), workoutName: 'Lower strength', exerciseName: 'Barbell squat', libraryExerciseId: '0101', mode: 'reps', setNumber: 3, status: 'skipped', plannedReps: 5, plannedWeightKg: kg(225), actualReps: null, actualWeightKg: null }),
      row({ sessionId: 'sq-1112', localDate: '2026-11-12', startedAt: at(2026, 11, 12, 18, 40), workoutName: 'Lower strength', exerciseName: 'Barbell squat', libraryExerciseId: '0101', mode: 'reps', setNumber: 4, removed: true, plannedReps: 1, plannedWeightKg: kg(300), actualReps: 1, actualWeightKg: kg(300) }),
      row({ sessionId: 'sq-1108', localDate: '2026-11-08', startedAt: at(2026, 11, 8, 19, 5), workoutName: 'Lower strength', exerciseName: 'Barbell squat', libraryExerciseId: '0101', mode: 'reps', setNumber: 1, plannedReps: 6, plannedWeightKg: kg(185), actualReps: 6, actualWeightKg: kg(185) }),
      row({ sessionId: 'sq-1108', localDate: '2026-11-08', startedAt: at(2026, 11, 8, 19, 5), workoutName: 'Lower strength', exerciseName: 'Barbell squat', libraryExerciseId: '0101', mode: 'reps', setNumber: 2, plannedReps: 5, plannedWeightKg: kg(185), actualReps: 5, actualWeightKg: kg(205) }),
      row({ sessionId: 'sq-1101', localDate: '2026-11-01', startedAt: at(2026, 11, 1, 8, 15), workoutName: 'Lower strength', exerciseName: 'Barbell squat', libraryExerciseId: '0101', mode: 'reps', setNumber: 1, plannedReps: 5, plannedWeightKg: kg(185), actualReps: 5, actualWeightKg: kg(185) }),
      row({ sessionId: 'sq-1101', localDate: '2026-11-01', startedAt: at(2026, 11, 1, 8, 15), workoutName: 'Lower strength', exerciseName: 'Barbell squat', libraryExerciseId: '0101', mode: 'reps', setNumber: 2, plannedReps: 5, plannedWeightKg: kg(185), actualReps: 5, actualWeightKg: kg(175) }),
      row({ sessionId: 'sq-1022', localDate: '2026-10-22', startedAt: at(2026, 10, 22, 18, 10), workoutName: 'Lower strength', exerciseName: 'Barbell squat', libraryExerciseId: '0101', mode: 'reps', setNumber: 1, plannedReps: 8, plannedWeightKg: kg(135), actualReps: 8, actualWeightKg: kg(135) }),
      row({ sessionId: 'sq-1022', localDate: '2026-10-22', startedAt: at(2026, 10, 22, 18, 10), workoutName: 'Lower strength', exerciseName: 'Barbell squat', libraryExerciseId: '0101', mode: 'reps', setNumber: 2, plannedReps: 8, plannedWeightKg: kg(135), actualReps: 8, actualWeightKg: kg(135) }),

      row({
        sessionId: 'sp-1114', localDate: '2026-11-14', startedAt: at(2026, 11, 14, 17, 15), workoutName: 'Conditioning', exerciseName: 'Court sprint', personalExerciseId: sprint, stableKey: 'ex_sprint', mode: 'stopwatch', displayUnit: 'bodyweight', setNumber: 1, plannedBodyweight: true, actualBodyweight: true, plannedLapCount: 5, actualTotalSec: 72.4,
        actualLaps: [lap(1, 18.4, 18.4), lap(2, 17.55, 35.95), lap(3, 19.1, 55.05), lap(4, 17.35, 72.4)],
        actualEvents: [
          { lap: 1, name: 'First cone', result: 'pass' },
          { lap: 2, name: 'Turn', result: 'pass' },
          { lap: 3, name: 'Drop', result: 'fail' },
          { lap: 4, name: 'Finish', result: 'pass' }
        ]
      }),
      row({
        sessionId: 'sp-1107', localDate: '2026-11-07', startedAt: at(2026, 11, 7, 17, 20), workoutName: 'Conditioning', exerciseName: 'Court sprint', personalExerciseId: sprint, stableKey: 'ex_sprint', mode: 'stopwatch', displayUnit: 'bodyweight', setNumber: 1, plannedBodyweight: true, actualBodyweight: true, plannedLapCount: 4, actualTotalSec: 92.3,
        actualLaps: [lap(1, 22.1, 22.1), lap(2, 23.4, 45.5), lap(3, 24, 69.5), lap(4, 22.8, 92.3)],
        actualEvents: [
          { lap: 1, name: 'First cone', result: 'pass' },
          { lap: 2, name: 'Turn', result: 'fail' },
          { lap: 3, name: 'Drop', result: 'fail' },
          { lap: 4, name: 'Finish', result: 'pass' }
        ]
      }),
      row({
        sessionId: 'sp-1030', localDate: '2026-10-30', startedAt: at(2026, 10, 30, 17, 5), workoutName: 'Conditioning', exerciseName: 'Court sprint', personalExerciseId: sprint, stableKey: 'ex_sprint', mode: 'stopwatch', displayUnit: 'bodyweight', setNumber: 1, plannedBodyweight: true, actualBodyweight: true, plannedLapCount: 4, actualTotalSec: 100.2,
        actualLaps: [lap(1, 24.2, 24.2), lap(2, 25.1, 49.3), lap(3, 26.4, 75.7), lap(4, 24.5, 100.2)],
        actualEvents: [{ lap: 4, name: 'Finish', result: 'pass' }]
      }),

      row({ sessionId: 'fa-1111', localDate: '2026-11-11', startedAt: at(2026, 11, 11, 7, 30), workoutName: 'Strongman', exerciseName: 'Farmer carry', personalExerciseId: farmer, stableKey: 'ex_farmer', imageUrl: FARMER_PHOTO, mode: 'reps', setNumber: 1, plannedReps: 16, plannedWeightKg: kg(50), actualReps: 20, actualWeightKg: kg(50) }),
      row({ sessionId: 'fa-1104', localDate: '2026-11-04', startedAt: at(2026, 11, 4, 7, 30), workoutName: 'Strongman', exerciseName: 'Farmer carry', personalExerciseId: farmer, stableKey: 'ex_farmer', imageUrl: FARMER_PHOTO, mode: 'reps', setNumber: 1, plannedReps: 16, plannedWeightKg: kg(50), actualReps: 16, actualWeightKg: kg(50) }),

      row({ sessionId: 'fp-1110', localDate: '2026-11-10', startedAt: at(2026, 11, 10, 12, 10), workoutName: 'Upper pump', exerciseName: 'Face pull', libraryExerciseId: '0201', mode: 'timer', displayUnit: 'kg', setNumber: 1, plannedWorkSec: 40, plannedRestSec: 15, plannedReps: 12, plannedWeightKg: 15, actualWorkSec: 40, actualRestSec: 20, actualReps: 12, actualWeightKg: 15 }),
      row({ sessionId: 'fp-1103', localDate: '2026-11-03', startedAt: at(2026, 11, 3, 12, 10), workoutName: 'Upper pump', exerciseName: 'Face pull', libraryExerciseId: '0201', mode: 'timer', displayUnit: 'kg', setNumber: 1, plannedWorkSec: 40, plannedRestSec: 15, plannedReps: 12, plannedWeightKg: 15, actualWorkSec: 40, actualRestSec: 15, actualReps: 12, actualWeightKg: 15 }),

      row({ sessionId: 'bu-1109', localDate: '2026-11-09', startedAt: at(2026, 11, 9, 18, 0), workoutName: 'Lower strength', exerciseName: 'Bulgarian split squat', libraryExerciseId: '1001', mode: 'reps', displayUnit: 'bodyweight', setNumber: 1, plannedBodyweight: true, actualBodyweight: true, plannedReps: 10, actualReps: 12 }),
      row({ sessionId: 'bu-1103b', localDate: '2026-11-03', startedAt: at(2026, 11, 3, 18, 0), workoutName: 'Lower strength', exerciseName: 'Bulgarian split squat', libraryExerciseId: '1001', mode: 'reps', displayUnit: 'bodyweight', setNumber: 1, plannedBodyweight: true, actualBodyweight: true, plannedReps: 10, actualReps: 10 }),

      row({ sessionId: 'cr-1106', localDate: '2026-11-06', startedAt: at(2026, 11, 6, 6, 45), workoutName: 'Core', exerciseName: 'Crunch', libraryExerciseId: '0001', mode: 'intervals', displayUnit: 'bodyweight', setNumber: 1, plannedBodyweight: true, actualBodyweight: true, plannedWorkSec: 30, plannedRounds: 10, actualWorkSec: 30, actualRounds: 8 }),
      row({ sessionId: 'cr-1030', localDate: '2026-10-30', startedAt: at(2026, 10, 30, 6, 45), workoutName: 'Core', exerciseName: 'Crunch', libraryExerciseId: '0001', mode: 'intervals', displayUnit: 'bodyweight', setNumber: 1, plannedBodyweight: true, actualBodyweight: true, plannedWorkSec: 30, plannedRounds: 8, actualWorkSec: 30, actualRounds: 8 }),

      row({ sessionId: 'pl-1105', localDate: '2026-11-05', startedAt: at(2026, 11, 5, 6, 50), workoutName: 'Core', exerciseName: 'Plank', personalExerciseId: plank, stableKey: 'ex_plank', mode: 'static_hold', displayUnit: 'bodyweight', setNumber: 1, plannedBodyweight: true, actualBodyweight: true, plannedHoldSec: 60, actualHoldSec: 75 }),
      row({ sessionId: 'pl-1028', localDate: '2026-10-28', startedAt: at(2026, 10, 28, 6, 50), workoutName: 'Core', exerciseName: 'Plank', personalExerciseId: plank, stableKey: 'ex_plank', mode: 'static_hold', displayUnit: 'bodyweight', setNumber: 1, plannedBodyweight: true, actualBodyweight: true, plannedHoldSec: 60, actualHoldSec: 45 })
    ];
  }

  var api = {
    exerciseKey: exerciseKey,
    fromRows: fromRows,
    list: list,
    filter: filter,
    decorate: decorate,
    detail: detail,
    listHtml: listHtml,
    itemsHtml: itemsHtml,
    detailHtml: detailHtml,
    emptyHtml: emptyHtml,
    sampleSets: sampleSets,
    stillUrl: stillUrl,
    formatDay: formatDay,
    clock: clock
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WBHistory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
