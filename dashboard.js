/* Standard tracking dashboard. No network. No sample people.
   Browser: window.WBDashboard. Node: require.
   Numbers come from the signed-in person's saved sessions and sets.
   The standard set, and what Reset restores, is Hit the plan, Workouts
   and streak, Total volume, Strength and Capacity, Consistency, and
   Static holds. Recent personal records and Stopwatch stay off that set.
   Stopwatch pass rate is intentionally not rendered. It stays off this
   dashboard until a trainer can choose to add it. A saved layout or a
   frozen share keeps whatever cards it already stored. */
(function (root) {
  'use strict';
  var LB_TO_KG = 0.45359237;
  var RECENT_LIMIT = 8;
  // A 10% increase fills the bar. Anything larger stays full.
  var GAIN_FULL = 10;
  var RATINGS = [
    { min: 90, label: 'Elite', color: '#0F766E' },
    { min: 80, label: 'Excellent', color: '#16A34A' },
    { min: 70, label: 'Good', color: '#2563EB' },
    { min: 50, label: 'Keep trying', color: '#D97706' },
    { min: 0, label: 'On vacation?', color: '#DC2626' }
  ];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var DOW_LETTER = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  function historyApi() {
    if (root.WBHistory) return root.WBHistory;
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      try { return require('./history.js'); } catch (e) { return null; }
    }
    return null;
  }
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
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDay(value) {
    var parts = String(value || '').slice(0, 10).split('-');
    if (parts.length < 3) return null;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (!isFinite(d.getTime())) return null;
    return d;
  }
  function isDay(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').slice(0, 10)); }
  function dayText(value) { return isDay(value) ? String(value).slice(0, 10) : ''; }
  function weekStart(value) {
    var d = value instanceof Date ? new Date(value.getFullYear(), value.getMonth(), value.getDate()) : parseDay(value);
    if (!d) return null;
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }
  function monthKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
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
  function formatKg(n) {
    var rounded = Math.round(Number(n) * 10) / 10;
    if (!isFinite(rounded) || rounded < 0) rounded = 0;
    var whole = Math.abs(rounded - Math.round(rounded)) < 0.05;
    var text = whole ? String(Math.round(rounded)) : rounded.toFixed(1);
    var parts = text.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }
  function formatStopwatch(ms) {
    var cs = Math.floor(Math.min(Math.max(0, ms || 0), 5999990) / 10);
    var m = Math.floor(cs / 6000), sec = Math.floor(cs / 100) % 60, h = cs % 100;
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return p2(m) + ':' + p2(sec) + '.' + p2(h);
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function shortDate(isoDay, now) {
    var day = dayText(isoDay);
    if (!day) return '';
    var text = MONTHS_SHORT[Number(day.slice(5, 7)) - 1] + ' ' + Number(day.slice(8, 10));
    if (now && Number(day.slice(0, 4)) !== now.getFullYear()) text += ', ' + day.slice(0, 4);
    return text;
  }
  function longDate(isoDay) {
    var day = dayText(isoDay);
    if (!day) return '';
    return MONTHS[Number(day.slice(5, 7)) - 1] + ' ' + Number(day.slice(8, 10)) + ', ' + day.slice(0, 4);
  }
  function allowed(profile) {
    var id = profile && profile.membership;
    return id === 'enthusiast' || id === 'trainer' || id === 'master_trainer';
  }
  function ratingFor(pct) {
    var i;
    for (i = 0; i < RATINGS.length; i++) if (pct >= RATINGS[i].min) return RATINGS[i];
    return RATINGS[RATINGS.length - 1];
  }
  function atLeast(actual, planned) {
    var got = num(actual), want = num(planned);
    return got != null && want != null && got + 1e-6 >= want;
  }
  // A finished set hits when every target that was planned was met or beaten.
  // Skipped sets and removed sets miss. Rest is not a target. A set with no
  // target still counts, because there was nothing to miss.
  function hitPlan(set) {
    if (!set || set.status === 'skipped' || set.removed === true || set.removed === 'true') return false;
    var ok = true;
    var checked = false;
    function need(pass) {
      checked = true;
      if (!pass) ok = false;
    }
    if (num(set.plannedReps) != null) need(atLeast(set.actualReps, set.plannedReps));
    else if (num(set.plannedRepsMin) != null) need(atLeast(set.actualReps, set.plannedRepsMin));
    if (!set.plannedBodyweight && num(set.plannedWeightKg) != null) {
      need(!set.actualBodyweight && set.displayUnit !== 'bodyweight' && atLeast(set.actualWeightKg, set.plannedWeightKg));
    }
    if (num(set.plannedHoldSec) != null) need(atLeast(set.actualHoldSec, set.plannedHoldSec));
    if (num(set.plannedWorkSec) != null) need(atLeast(set.actualWorkSec, set.plannedWorkSec));
    if (num(set.plannedRounds) != null) need(atLeast(set.actualRounds, set.plannedRounds));
    if (num(set.plannedTotalSec) != null) {
      var actual = num(set.actualTotalSec);
      var planned = num(set.plannedTotalSec);
      need(actual != null && actual > 0 && actual <= planned + 1e-6);
    }
    if (num(set.plannedLapCount) != null) {
      var laps = Array.isArray(set.actualLaps) ? set.actualLaps.length : 0;
      need(laps >= Number(set.plannedLapCount));
    }
    var events = Array.isArray(set.actualEvents) ? set.actualEvents : [];
    var plannedEvents = Array.isArray(set.plannedEvents) ? set.plannedEvents : [];
    if (plannedEvents.length) {
      need(plannedEvents.every(function (ev) {
        if (!ev) return false;
        return events.some(function (got) {
          if (!got || got.result !== 'pass' || Number(got.lap) !== Number(ev.lap)) return false;
          if (ev.name && got.name && got.name !== ev.name) return false;
          return true;
        });
      }));
    } else if (events.length) {
      need(events.every(function (ev) { return ev && ev.result === 'pass'; }));
    }
    if (!checked) return set.status !== 'skipped';
    return ok;
  }
  function exerciseKey(set) {
    if (set.key) return String(set.key);
    if (set.libraryExerciseId) return 'lib-' + set.libraryExerciseId;
    if (set.personalExerciseId) return 'own-' + set.personalExerciseId;
    return '';
  }
  function usableSet(row) {
    if (!row || row.removed === true || row.removed === 'true') return null;
    var date = dayText(row.localDate || row.local_date);
    if (!date) return null;
    var set = row.localDate === date ? row : null;
    if (!set) {
      set = {};
      Object.keys(row).forEach(function (k) { set[k] = row[k]; });
      set.localDate = date;
    }
    var key = exerciseKey(set);
    var sessionId = String(set.sessionId || set.session_id || '');
    if (!key || !sessionId) return null;
    if (set.key === key && set.sessionId === sessionId && Array.isArray(set.actualLaps) && Array.isArray(set.actualEvents)) return set;
    var copy = {};
    Object.keys(set).forEach(function (k) { copy[k] = set[k]; });
    copy.key = key;
    copy.sessionId = sessionId;
    copy.localDate = date;
    copy.exerciseName = String(set.exerciseName || set.exercise_name || 'Exercise');
    copy.status = set.status === 'skipped' ? 'skipped' : 'completed';
    if (!Array.isArray(copy.actualLaps)) copy.actualLaps = [];
    if (!Array.isArray(copy.actualEvents)) copy.actualEvents = [];
    if (!Array.isArray(copy.plannedEvents)) copy.plannedEvents = [];
    return copy;
  }
  function usableSession(row) {
    if (!row) return null;
    var status = row.status || 'completed';
    if (status === 'in_progress') return null;
    var date = dayText(row.localDate || row.local_date);
    var id = String(row.id || row.sessionId || row.session_id || '');
    if (!date || !id) return null;
    return {
      id: id,
      localDate: date,
      status: status === 'ended_early' ? 'ended_early' : 'completed',
      workoutId: String(row.workoutId || row.workout_id || ''),
      programId: String(row.programId || row.program_id || '')
    };
  }
  function usableEntry(row) {
    if (!row) return null;
    var date = dayText(row.date || row.day);
    var id = String(row.id && row.date ? row.id : (row.local_id || row.localId || row.id || ''));
    if (!date || !id) return null;
    return {
      id: id,
      date: date,
      workoutId: String(row.workoutId || row.workout_local_id || row.workout_id || '')
    };
  }
  function entryDone(entry, sessions) {
    var i;
    for (i = 0; i < sessions.length; i++) {
      var session = sessions[i];
      if (session.programId && session.programId === entry.id) return true;
      if (session.workoutId && session.workoutId === entry.workoutId && session.localDate === entry.date) return true;
    }
    return false;
  }
  // Scheduled workout days completed in a row, walking back from today.
  // A day with nothing scheduled is rest and does not break the run.
  // Today stays open until it is done, so an unfinished today is not a miss.
  // Null means there is no schedule to score.
  function streakCount(entries, sessions, today) {
    if (!entries.length) return null;
    var byDay = {};
    var earliest = '';
    entries.forEach(function (entry) {
      byDay[entry.date] = byDay[entry.date] || [];
      byDay[entry.date].push(entry);
      if (!earliest || entry.date < earliest) earliest = entry.date;
    });
    var cursor = parseDay(today);
    if (!cursor) return 0;
    var todayIso = iso(cursor);
    var count = 0;
    var guard = 0;
    while (guard < 4000) {
      guard++;
      var date = iso(cursor);
      if (earliest && date < earliest) break;
      var dayEntries = byDay[date] || [];
      if (dayEntries.length) {
        var done = true;
        var i;
        for (i = 0; i < dayEntries.length; i++) {
          if (!entryDone(dayEntries[i], sessions)) { done = false; break; }
        }
        if (done) count++;
        else if (date !== todayIso) break;
      }
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  }
  function planBlock(sets, now) {
    var key = monthKey(now);
    var total = 0;
    var hits = 0;
    sets.forEach(function (set) {
      if (set.localDate.slice(0, 7) !== key) return;
      total++;
      if (hitPlan(set)) hits++;
    });
    if (!total) return { total: 0, hits: 0, pct: null, rating: null };
    var pct = Math.round((hits / total) * 100);
    var rating = ratingFor(pct);
    return { total: total, hits: hits, pct: pct, rating: rating };
  }
  // Workouts on the same calendar the streak uses, for the Monday–Sunday
  // week that contains now. A removed day is already absent from entries.
  function scheduledThisWeek(entries, now) {
    var start = weekStart(now);
    if (!start) return 0;
    var end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
    var startIso = iso(start);
    var endIso = iso(end);
    var n = 0;
    var seen = {};
    (entries || []).forEach(function (entry) {
      if (!entry || !entry.date || entry.date < startIso || entry.date >= endIso) return;
      var token = entry.id + '@' + entry.date;
      if (seen[token]) return;
      seen[token] = 1;
      n++;
    });
    return n;
  }
  function workoutBlock(sessions, entries, now) {
    var today = iso(now);
    var start = weekStart(now);
    var end = new Date(start.getTime());
    end.setDate(start.getDate() + 7);
    var month = monthKey(now);
    var week = 0;
    var monthCount = 0;
    var seen = {};
    sessions.forEach(function (session) {
      if (seen[session.id]) return;
      seen[session.id] = true;
      var day = parseDay(session.localDate);
      if (!day) return;
      if (session.localDate.slice(0, 7) === month) monthCount++;
      if (day >= start && day < end) week++;
    });
    return {
      week: week,
      month: monthCount,
      goal: scheduledThisWeek(entries, now),
      streak: streakCount(entries, sessions, today)
    };
  }
  // History groups a library exercise by its library id, otherwise by the
  // typed-in exercise id. The same rule decides one exercise here.
  function historyKey(set) {
    if (!set) return '';
    if (set.libraryExerciseId) return 'lib-' + set.libraryExerciseId;
    if (set.personalExerciseId) return 'own-' + set.personalExerciseId;
    return '';
  }
  function gainColor(label) {
    var i;
    for (i = 0; i < RATINGS.length; i++) if (RATINGS[i].label === label) return RATINGS[i].color;
    return '#0F766E';
  }
  // >0 up to 1 Good, >1 up to 5 Excellent, >5 up to 10 Elite, above 10 Alien.
  // Alien uses the Elite color. A zero or a drop is not a rating.
  function gainRating(pct) {
    if (!(pct > 0)) return null;
    if (pct <= 1) return { label: 'Good', color: gainColor('Good') };
    if (pct <= 5) return { label: 'Excellent', color: gainColor('Excellent') };
    if (pct <= 10) return { label: 'Elite', color: gainColor('Elite') };
    return { label: 'Alien', color: gainColor('Elite') };
  }
  function pctRound(pct) { return Math.round(Number(pct) * 10000) / 10000; }
  function readNum(set, camel, snake) {
    if (!set) return null;
    if (set[camel] != null && set[camel] !== '') return num(set[camel]);
    if (set[snake] != null && set[snake] !== '') return num(set[snake]);
    return null;
  }
  function readFlag(set, camel, snake) {
    if (!set) return false;
    return set[camel] === true || set[camel] === 'true' || set[snake] === true || set[snake] === 'true';
  }
  function displayUnitOf(set) {
    var unit = set && (set.displayUnit || set.display_unit);
    if (unit === 'lb' || unit === 'bodyweight') return unit;
    return 'kg';
  }
  function loggedWeight(set) {
    if (!set || set.status !== 'completed') return null;
    if (displayUnitOf(set) === 'bodyweight' || readFlag(set, 'actualBodyweight', 'actual_bodyweight')) return null;
    var kg = readNum(set, 'actualWeightKg', 'actual_weight_kg');
    return kg > 0 ? kg : null;
  }
  function loggedReps(set) {
    if (!set || set.status !== 'completed') return null;
    var reps = readNum(set, 'actualReps', 'actual_reps');
    return reps > 0 ? reps : null;
  }
  function plannedWeight(set) {
    if (!set || displayUnitOf(set) === 'bodyweight') return null;
    if (readFlag(set, 'plannedBodyweight', 'planned_bodyweight') || readFlag(set, 'actualBodyweight', 'actual_bodyweight')) return null;
    var kg = readNum(set, 'plannedWeightKg', 'planned_weight_kg');
    return kg > 0 ? kg : null;
  }
  // An exact count is the plan. A range leaves that empty and stores min and max,
  // so extra reps have to clear the top. A floor with no top uses the floor.
  function plannedRepsCount(set) {
    if (!set) return null;
    var reps = readNum(set, 'plannedReps', 'planned_reps');
    if (reps > 0) return reps;
    var max = readNum(set, 'plannedRepsMax', 'planned_reps_max');
    if (max > 0) return max;
    var min = readNum(set, 'plannedRepsMin', 'planned_reps_min');
    return min > 0 ? min : null;
  }
  // The card's window is the calendar month it already titles as "this month".
  function inStrengthWindow(set, now) {
    return String(set && set.localDate || '').slice(0, 7) === monthKey(now);
  }
  function laterSet(a, b) {
    if ((a.localDate || '') !== (b.localDate || '')) return (a.localDate || '') > (b.localDate || '');
    return timeOf(a) >= timeOf(b);
  }
  function gainAmount(actual, planned, unit) {
    var delta = actual - planned;
    if (unit === 'lb') delta = delta / LB_TO_KG;
    var text = trim(delta);
    if (!text || text === '0') return '';
    if (unit === 'reps') {
      var n = Number(text);
      return '+' + text + (n === 1 ? ' rep' : ' reps');
    }
    return '+' + text + ' ' + (unit === 'lb' ? 'lb' : 'kg');
  }
  // One line per exercise. The best actual set is compared with that set's plan.
  // A weight above the designed weight is Strength. Reps above the designed count,
  // or above the top of a range, are Capacity. Any mode counts when that plan is
  // present. Nothing at or under the plan is a gain.
  function leaders(sets, now, readActual, readPlanned, unitOf) {
    var groups = {};
    var order = [];
    (sets || []).forEach(function (set) {
      if (!set || set.status !== 'completed' || set.removed === true || set.removed === 'true') return;
      if (!inStrengthWindow(set, now)) return;
      var actual = readActual(set);
      var planned = readPlanned(set);
      if (!(actual > 0) || !(planned > 0)) return;
      var key = historyKey(set);
      if (!key) return;
      if (!groups[key]) {
        groups[key] = [];
        order.push(key);
      }
      groups[key].push({ set: set, actual: actual, planned: planned });
    });
    var rows = [];
    order.forEach(function (key) {
      var best = null;
      groups[key].forEach(function (row) {
        var better = !best || row.actual > best.actual + 1e-9;
        var tied = best && Math.abs(row.actual - best.actual) <= 1e-9 && laterSet(row.set, best.set);
        if (better || tied) best = row;
      });
      if (!best || !(best.actual > best.planned)) return;
      var pct = pctRound(((best.actual - best.planned) / best.planned) * 100);
      var rating = gainRating(pct);
      if (!rating) return;
      var detail = gainAmount(best.actual, best.planned, unitOf(best.set));
      if (!detail) return;
      var named = best.set;
      rows.push({
        key: key,
        name: named && (named.exerciseName || named.exercise_name) ? (named.exerciseName || named.exercise_name) : 'Exercise',
        pct: pct,
        rating: rating,
        detail: detail
      });
    });
    rows.sort(function (a, b) {
      if (a.pct !== b.pct) return a.pct > b.pct ? -1 : 1;
      if (a.name !== b.name) return a.name < b.name ? -1 : 1;
      if (a.key !== b.key) return a.key < b.key ? -1 : 1;
      return 0;
    });
    return rows;
  }
  function strengthBlock(sets, now) {
    return {
      weight: leaders(sets, now, loggedWeight, plannedWeight, displayUnitOf),
      reps: leaders(sets, now, loggedReps, plannedRepsCount, function () { return 'reps'; })
    };
  }
  function setVolume(set) {
    if (!set || set.status === 'skipped') return 0;
    if (set.actualBodyweight || set.displayUnit === 'bodyweight') return 0;
    var kg = num(set.actualWeightKg);
    var reps = num(set.actualReps);
    if (!(kg > 0) || !(reps > 0)) return 0;
    return kg * reps;
  }
  function volumeBlock(sets, now) {
    var start = weekStart(now);
    var weeks = [];
    var i;
    for (i = 7; i >= 0; i--) {
      var d = new Date(start.getTime());
      d.setDate(start.getDate() - i * 7);
      weeks.push({ start: iso(d), label: MONTHS_SHORT[d.getMonth()] + ' ' + d.getDate(), kg: 0 });
    }
    var index = {};
    weeks.forEach(function (week, n) { index[week.start] = n; });
    sets.forEach(function (set) {
      var begin = weekStart(set.localDate);
      if (!begin) return;
      var at = index[iso(begin)];
      if (at == null) return;
      weeks[at].kg += setVolume(set);
    });
    return { weekKg: weeks[weeks.length - 1].kg, weeks: weeks };
  }
  function weightText(set) {
    var kg = num(set.actualWeightKg);
    if (kg == null) return '';
    var unit = set.displayUnit === 'lb' ? 'lb' : 'kg';
    var n = unit === 'lb' ? kg / LB_TO_KG : kg;
    var text = trim(n);
    return text ? text + ' ' + unit : '';
  }
  function timeOf(set) {
    var t = set && set.startedAt;
    if (typeof t === 'number' && isFinite(t)) return t;
    var n = Date.parse(t || '');
    return isFinite(n) ? n : 0;
  }
  function recordValue(badge, set) {
    if (badge === 'Heaviest') return weightText(set);
    if (badge === 'Most reps') {
      var reps = num(set.actualReps);
      return reps == null ? '' : trim(reps) + (Number(reps) === 1 ? ' rep' : ' reps');
    }
    if (badge === 'Fastest') {
      var total = num(set.actualTotalSec);
      return total == null ? '' : formatStopwatch(total * 1000);
    }
    if (badge === 'Most passes') {
      var n = 0;
      (set.actualEvents || []).forEach(function (ev) { if (ev && ev.result === 'pass') n++; });
      if (!n) return '';
      return n + (n === 1 ? ' pass' : ' passes');
    }
    if (badge === 'Longest hold') {
      var hold = num(set.actualHoldSec);
      return hold == null ? '' : fmtTime(hold) + ' hold';
    }
    return '';
  }
  function recordBlock(sets, now) {
    var H = historyApi();
    if (!H || typeof H.records !== 'function') return [];
    var groups = {};
    var order = [];
    sets.forEach(function (set) {
      if (set.status !== 'completed') return;
      if (!groups[set.key]) { groups[set.key] = []; order.push(set.key); }
      groups[set.key].push(set);
    });
    var rows = [];
    order.forEach(function (key) {
      var mine = groups[key];
      var marks = H.records(mine);
      Object.keys(marks.set || {}).forEach(function (idx) {
        var set = mine[Number(idx)];
        if (!set) return;
        (marks.set[idx] || []).forEach(function (badge) {
          var value = recordValue(badge, set);
          if (!value) return;
          rows.push({
            name: set.exerciseName,
            badge: badge,
            value: value,
            date: set.localDate,
            dateLabel: shortDate(set.localDate, now),
            startedAt: timeOf(set)
          });
        });
      });
      Object.keys(marks.lap || {}).forEach(function (idx) {
        var set = mine[Number(idx)];
        if (!set) return;
        var laps = marks.lap[idx] || {};
        Object.keys(laps).forEach(function (n) {
          var found = null;
          (set.actualLaps || []).forEach(function (lap) {
            if (Number(lap.n) === Number(n)) found = lap;
          });
          var sec = found ? num(found.lapSec != null ? found.lapSec : found.lap_sec) : null;
          if (sec == null) return;
          rows.push({
            name: set.exerciseName,
            badge: 'Best lap',
            value: formatStopwatch(sec * 1000),
            date: set.localDate,
            dateLabel: shortDate(set.localDate, now),
            startedAt: timeOf(set)
          });
        });
      });
    });
    rows.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? 1 : -1;
      if (a.name !== b.name) return a.name < b.name ? -1 : 1;
      if (a.badge !== b.badge) return a.badge < b.badge ? -1 : 1;
      return 0;
    });
    return rows.slice(0, RECENT_LIMIT);
  }
  // A tie keeps the earlier set: that is the day the best time was first set.
  function newerSet(a, b) {
    if ((a.localDate || '') !== (b.localDate || '')) return (a.localDate || '') > (b.localDate || '');
    var at = timeOf(a), bt = timeOf(b);
    if (at !== bt) return at > bt;
    return Number(a.setNumber || 0) > Number(b.setNumber || 0);
  }
  function bestRows(sets, now, mode, read, better, format) {
    var groups = {};
    var order = [];
    var want = typeof mode === 'function' ? mode : function (set) { return set.mode === mode; };
    sets.forEach(function (set) {
      if (!set || set.status !== 'completed' || !want(set)) return;
      if (read(set) == null) return;
      if (!groups[set.key]) { groups[set.key] = []; order.push(set.key); }
      groups[set.key].push(set);
    });
    var rows = [];
    order.forEach(function (key) {
      var best = null;
      groups[key].forEach(function (set) {
        var value = read(set);
        if (value == null) return;
        var ahead = best && better(value, best.value);
        var tied = best && !better(value, best.value) && !better(best.value, value);
        if (!best || ahead || (tied && !newerSet(set, best.set))) best = { value: value, set: set };
      });
      if (!best) return;
      rows.push({
        name: best.set.exerciseName || 'Exercise',
        value: format(best.value),
        date: best.set.localDate,
        dateLabel: shortDate(best.set.localDate, now),
        startedAt: timeOf(best.set)
      });
    });
    rows.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? 1 : -1;
      if (a.name !== b.name) return a.name < b.name ? -1 : 1;
      return 0;
    });
    return rows;
  }
  // A timer or interval with a rep count is not a hold. Static and time-only
  // sets both omit reps, so the rep columns alone cannot separate them.
  function hasRepTarget(set) {
    return num(set.plannedReps) != null || num(set.plannedRepsMin) != null || num(set.plannedRepsMax) != null || num(set.actualReps) != null;
  }
  function itemsOf(workout) {
    if (!workout) return [];
    var items = workout.items;
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch (e) { return []; }
    }
    return Array.isArray(items) ? items : [];
  }
  // Saved workouts still say which exercise is Static. A custom exercise matches
  // on its id (the set's stable key). A library exercise matches on the animation
  // plus the name, and on the animation alone only when every saved use is Static.
  // A mix, or a missing exercise, is left out: those rows cannot be told from a
  // time-only timer.
  function schemaOf(workout, fallback) {
    var raw = workout && workout.version != null && workout.version !== '' ? workout.version : fallback;
    var n = Number(raw);
    return isFinite(n) ? n : 4;
  }
  function staticIndex(workouts, fallbackVersion) {
    var byId = {};
    var byLib = {};
    var byLibName = {};
    function add(map, key, isStatic) {
      if (!key) return;
      var bucket = map[key] || (map[key] = { yes: 0, no: 0 });
      if (isStatic) bucket.yes++;
      else bucket.no++;
    }
    (Array.isArray(workouts) ? workouts : []).forEach(function (workout) {
      // Before schema v4, Static on a timer or interval was the default for
      // time only. migrate() clears it. Skip that old list entirely. Voting
      // it as "not Static" would cancel a current copy of the same exercise.
      var version = schemaOf(workout, fallbackVersion);
      if (version < 4) return;
      itemsOf(workout).forEach(function (it) {
        if (!it || (it.mode !== 'timer' && it.mode !== 'intervals')) return;
        var isStatic = !!(it.modeConfig && it.modeConfig.repsType === 'static');
        add(byId, it.id ? String(it.id) : '', isStatic);
        var media = it.media;
        var lib = media && media.kind === 'library' ? String(media.libraryId || '').trim() : '';
        if (!lib) return;
        add(byLib, lib, isStatic);
        var name = String(it.name || '').replace(/^\s+|\s+$/g, '').toLowerCase();
        if (name) add(byLibName, lib + '\n' + name, isStatic);
      });
    });
    function yes(bucket) { return !!(bucket && bucket.yes && !bucket.no); }
    return {
      match: function (set) {
        if (!set) return false;
        var stable = String(set.stableKey || set.stable_key || '');
        if (stable) return yes(byId[stable]);
        var lib = String(set.libraryExerciseId || set.library_exercise_id || '');
        if (!lib) return false;
        var name = String(set.exerciseName || set.exercise_name || '').replace(/^\s+|\s+$/g, '').toLowerCase();
        if (name && byLibName[lib + '\n' + name]) return yes(byLibName[lib + '\n' + name]);
        return yes(byLib[lib]);
      }
    };
  }
  function holdSet(set, known) {
    if (!set) return false;
    if (set.mode === 'static_hold') return true;
    if (set.mode !== 'timer' && set.mode !== 'intervals') return false;
    if (hasRepTarget(set)) return false;
    // New saves copy the logged work time into actual hold seconds.
    if (num(set.actualHoldSec) > 0) return true;
    return !!(known && known.match(set));
  }
  // Logged work is the hold for a timer or interval. The player stores that
  // clock time in actual_work_sec (the planned length if they finish, the
  // elapsed seconds if they stop early). Planned work is only the target, so
  // a set with no logged time stays off the card. Older static_hold rows use
  // actual_hold_sec, and a new save copies the work time there too.
  function holdSeconds(set) {
    if (!set) return null;
    if (set.mode === 'timer' || set.mode === 'intervals') {
      var work = num(set.actualWorkSec);
      if (work != null && work > 0) return work;
      var copied = num(set.actualHoldSec);
      return copied != null && copied > 0 ? copied : null;
    }
    var n = num(set.actualHoldSec);
    return n != null && n > 0 ? n : null;
  }
  function speedSeconds(set) {
    var n = num(set.actualTotalSec);
    return n != null && n > 0 ? n : null;
  }
  function longer(a, b) { return a > b + 1e-9; }
  function faster(a, b) { return a < b - 1e-9; }
  function holdsBlock(sets, now, workouts, schemaVersion) {
    var known = staticIndex(workouts, schemaVersion);
    return bestRows(sets, now, function (set) { return holdSet(set, known); }, holdSeconds, longer, function (sec) { return fmtTime(sec); });
  }
  function stopwatchBlock(sets, now) {
    return bestRows(sets, now, 'stopwatch', speedSeconds, faster, function (sec) { return formatStopwatch(sec * 1000); });
  }
  function calendarBlock(sessions, now) {
    var year = now.getFullYear();
    var month = now.getMonth();
    var key = monthKey(now);
    var today = iso(now);
    var trained = {};
    sessions.forEach(function (session) {
      if (session.localDate.slice(0, 7) !== key) return;
      if (session.localDate > today) return;
      trained[session.localDate] = true;
    });
    var first = new Date(year, month, 1);
    var lead = (first.getDay() + 6) % 7;
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var cells = [];
    var i;
    for (i = 0; i < lead; i++) cells.push(null);
    for (i = 1; i <= daysInMonth; i++) {
      var date = year + '-' + pad(month + 1) + '-' + pad(i);
      cells.push({
        day: i,
        date: date,
        trained: !!trained[date],
        future: date > today,
        today: date === today,
        dow: DOW[(lead + i - 1) % 7]
      });
    }
    var count = 0;
    Object.keys(trained).forEach(function () { count++; });
    return {
      title: 'Consistency · ' + MONTHS[month] + ' ' + year,
      monthLabel: MONTHS[month] + ' ' + year,
      count: count,
      cells: cells
    };
  }
  function build(input) {
    input = input || {};
    var now = input.now instanceof Date ? new Date(input.now.getTime()) : new Date(input.now || Date.now());
    if (!isFinite(now.getTime())) now = new Date();
    var sets = [];
    (input.sets || []).forEach(function (row) {
      var set = usableSet(row);
      if (set) sets.push(set);
    });
    var sessions = [];
    var seen = {};
    (input.sessions || []).forEach(function (row) {
      var session = usableSession(row);
      if (!session || seen[session.id]) return;
      seen[session.id] = true;
      sessions.push(session);
    });
    if (!sessions.length) {
      sets.forEach(function (set) {
        if (seen[set.sessionId]) return;
        seen[set.sessionId] = true;
        sessions.push({ id: set.sessionId, localDate: set.localDate, status: 'completed', workoutId: '', programId: '' });
      });
    }
    var entries = [];
    var seenEntry = {};
    (input.entries || []).forEach(function (row) {
      var entry = usableEntry(row);
      if (!entry) return;
      var token = entry.id + '@' + entry.date;
      if (seenEntry[token]) return;
      seenEntry[token] = true;
      entries.push(entry);
    });
    // layout keeps the cards when a trainer is arranging a share, including a
    // client who has not finished a workout yet. The live dashboard still
    // uses the short empty state.
    if (!sessions.length && !input.layout) return { empty: true };
    return {
      empty: false,
      plan: planBlock(sets, now),
      workouts: workoutBlock(sessions, entries, now),
      volume: volumeBlock(sets, now),
      strength: strengthBlock(sets, now),
      records: recordBlock(sets, now),
      calendar: calendarBlock(sessions, now),
      holds: holdsBlock(sets, now, input.workouts, input.schemaVersion),
      stopwatch: stopwatchBlock(sets, now),
      pass: passBlock(sets, now)
    };
  }
  function passBlock(sets, now) {
    var key = monthKey(now);
    var passes = 0;
    var total = 0;
    sets.forEach(function (set) {
      if (!set || String(set.localDate || '').slice(0, 7) !== key) return;
      if (set.mode !== 'stopwatch' || set.status === 'skipped') return;
      (set.actualEvents || []).forEach(function (ev) {
        if (!ev) return;
        if (ev.result === 'pass') { passes++; total++; }
        else if (ev.result === 'fail') total++;
      });
    });
    if (!total) return { passes: 0, total: 0, pct: null };
    return { passes: passes, total: total, pct: Math.round((passes / total) * 100) };
  }
  function ring(plan) {
    var size = 96;
    var stroke = 8;
    var r = (size - stroke) / 2;
    var c = 2 * Math.PI * r;
    var pct = plan && plan.pct != null ? plan.pct : 0;
    var dash = (Math.max(0, Math.min(100, pct)) / 100) * c;
    var mid = size / 2;
    var color = plan && plan.rating ? plan.rating.color : '#6b7280';
    var label = plan && plan.pct != null
      ? (plan.pct + ' percent' + (plan.rating ? ', ' + plan.rating.label : ''))
      : 'No sets logged this month';
    var shown = plan && plan.pct != null ? plan.pct + '%' : '—';
    var h = '<svg class="db-ring" width="96" height="96" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="' + esc(label) + '">';
    h += '<circle cx="' + mid + '" cy="' + mid + '" r="' + r + '" fill="none" stroke="rgba(17,24,39,0.14)" stroke-width="' + stroke + '"></circle>';
    if (plan && plan.pct != null) {
      h += '<circle cx="' + mid + '" cy="' + mid + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="' + stroke + '" stroke-linecap="round"';
      h += ' stroke-dasharray="' + dash + ' ' + c + '" transform="rotate(-90 ' + mid + ' ' + mid + ')"></circle>';
    }
    h += '<text class="db-pct" x="50%" y="52%" text-anchor="middle" dominant-baseline="central" font-size="22" font-weight="700">' + esc(shown) + '</text>';
    h += '</svg>';
    return h;
  }
  function planHtml(plan) {
    var h = '<section class="db-sec" id="dashboard-plan" aria-labelledby="dashboard-plan-title">';
    h += '<h2 class="db-label" id="dashboard-plan-title">Hit the plan</h2>';
    h += '<div class="db-plan">' + ring(plan);
    h += '<div class="db-plan-copy">';
    if (plan && plan.rating) {
      h += '<div class="db-rate" id="dashboard-rating" data-rating="' + esc(plan.rating.label) + '" style="color:' + plan.rating.color + '">' + esc(plan.rating.label) + '</div>';
      var noun = plan.total === 1 ? 'set' : 'sets';
      h += '<p class="db-note" id="dashboard-plan-note">' + plan.hits + ' of ' + plan.total + ' ' + noun + ' met or beat the plan this month</p>';
    } else {
      h += '<p class="db-note" id="dashboard-plan-note">No sets logged this month.</p>';
    }
    h += '</div></div>';
    h += '<ul class="db-legend" aria-label="Hit the plan ratings">';
    RATINGS.forEach(function (row) {
      h += '<li><span class="db-dot" style="background:' + row.color + '" aria-hidden="true"></span>' + esc(row.label) + '</li>';
    });
    h += '</ul></section>';
    return h;
  }
  function workoutsHtml(block, opts) {
    var h = '<section class="db-sec" id="dashboard-workouts" aria-labelledby="dashboard-workouts-title">';
    h += '<h2 class="db-label" id="dashboard-workouts-title">Workouts and streak</h2>';
    h += '<div class="db-stats">';
    h += '<div class="db-stat"><b id="dashboard-week">' + block.week + '</b><span>This week</span></div>';
    h += '<div class="db-stat"><b id="dashboard-month">' + block.month + '</b><span>This month</span></div>';
    if (block.streak != null) {
      h += '<div class="db-stat" id="dashboard-streak"><b>' + block.streak + '</b><span>Scheduled streak</span></div>';
    }
    h += '</div>';
    if (block.goal > 0) {
      var done = Math.min(block.week, block.goal);
      h += '<p class="db-note" id="dashboard-goal">This week\'s goal: ' + block.goal + ' workouts</p>';
      h += '<div class="db-bars" id="dashboard-goal-bars" role="img" aria-label="' + block.week + ' workouts this week. Goal is ' + block.goal + '.">';
      var i;
      for (i = 0; i < block.goal; i++) h += '<span class="db-bar' + (i < done ? ' on' : '') + '"></span>';
      h += '</div>';
    }
    if (block.streak != null) {
      var days = block.streak === 1 ? '1 scheduled workout day' : block.streak + ' scheduled workout days';
      h += '<p class="db-note" id="dashboard-streak-note">' + days + ' in a row. Rest days do not break this streak.</p>';
    } else if (opts && opts.scheduleNote) {
      h += '<p class="db-note" id="dashboard-schedule-note">Schedule workouts in the program calendar.</p>';
    }
    h += '</section>';
    return h;
  }
  function volumeTable(weeks) {
    var h = '<table class="db-sr" id="dashboard-volume-table"><caption>Kilograms lifted by week, last eight weeks</caption><thead><tr><th scope="col">Week of</th><th scope="col">Kilograms</th></tr></thead><tbody>';
    weeks.forEach(function (week) {
      h += '<tr><th scope="row">' + esc(week.label) + '</th><td>' + esc(formatKg(week.kg)) + '</td></tr>';
    });
    return h + '</tbody></table>';
  }
  function volumeSvg(weeks) {
    var width = 320;
    var height = 108;
    var padL = 8;
    var padR = 8;
    var padT = 12;
    var padB = 22;
    var max = 0;
    var i;
    for (i = 0; i < weeks.length; i++) if (weeks[i].kg > max) max = weeks[i].kg;
    var scale = max > 0 ? max : 1;
    var innerW = width - padL - padR;
    var innerH = height - padT - padB;
    var n = weeks.length;
    var xs = [];
    var ys = [];
    for (i = 0; i < n; i++) {
      xs.push(padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW));
      ys.push(padT + innerH - (weeks[i].kg / scale) * innerH);
    }
    var points = xs.map(function (x, idx) { return x + ',' + ys[idx]; }).join(' ');
    var h = '<svg class="db-chart" id="dashboard-chart" viewBox="0 0 ' + width + ' ' + height + '" aria-hidden="true" focusable="false">';
    h += '<polyline points="' + points + '"></polyline>';
    for (i = 0; i < n; i++) {
      h += '<circle cx="' + xs[i] + '" cy="' + ys[i] + '" r="' + (i === n - 1 ? 4 : 3) + '"></circle>';
      if (i % 2 === 0) {
        h += '<text x="' + xs[i] + '" y="' + (height - 4) + '" text-anchor="middle">' + esc(weeks[i].label) + '</text>';
      }
    }
    return h + '</svg>';
  }
  function pctText(pct) {
    var rounded = Math.round(Number(pct) * 10) / 10;
    if (!isFinite(rounded)) return '0';
    if (Math.abs(rounded - Math.round(rounded)) < 0.001) return String(Math.round(rounded));
    return rounded.toFixed(1);
  }
  function barWidth(pct) {
    var w = (Math.min(Math.max(Number(pct) || 0, 0), GAIN_FULL) / GAIN_FULL) * 100;
    return Math.round(w * 10) / 10;
  }
  function gainRows(rows, section) {
    if (!rows || !rows.length) {
      return '<p class="db-note" id="dashboard-' + section + '-empty">No gains yet this month</p>';
    }
    var h = '<ul class="db-gains" id="dashboard-' + section + '-list">';
    rows.forEach(function (row) {
      var rating = row.rating || gainRating(row.pct) || { label: '', color: '#6b7280' };
      var width = barWidth(row.pct);
      var label = row.name + (row.detail ? ', ' + row.detail : '') + ', ' + pctText(row.pct) + ' percent, ' + (rating.label || '');
      h += '<li class="db-gain" data-rating="' + esc(rating.label) + '" data-pct="' + esc(pctText(row.pct)) + '">';
      h += '<div class="db-gain-top"><span class="name">' + esc(row.name) + '</span>';
      h += '<span class="db-gain-pct" style="color:' + esc(rating.color) + '">' + esc(pctText(row.pct)) + '% · ' + esc(rating.label) + '</span></div>';
      if (row.detail) h += '<p class="db-gain-meta">' + esc(row.detail) + '</p>';
      h += '<div class="db-gain-track" role="img" aria-label="' + esc(label) + '">';
      h += '<span class="db-gain-fill" style="width:' + width + '%;background:' + esc(rating.color) + '"></span></div></li>';
    });
    return h + '</ul>';
  }
  function strengthHtml(block) {
    block = block || { weight: [], reps: [] };
    var h = '<section class="db-sec" id="dashboard-strength" aria-labelledby="dashboard-strength-title">';
    h += '<h2 class="db-label" id="dashboard-strength-title">Strength and Capacity</h2>';
    h += '<h3 class="db-sub" id="dashboard-strength-weight-title">Strength</h3>';
    h += gainRows(block.weight, 'strength-weight');
    h += '<h3 class="db-sub" id="dashboard-strength-reps-title">Capacity</h3>';
    h += gainRows(block.reps, 'strength-reps');
    return h + '</section>';
  }
  function volumeHtml(block) {
    var h = '<section class="db-sec" id="dashboard-volume" aria-labelledby="dashboard-volume-title">';
    h += '<h2 class="db-label" id="dashboard-volume-title">Total volume</h2>';
    h += '<div class="db-vol" id="dashboard-volume-now">' + esc(formatKg(block.weekKg)) + ' kg this week</div>';
    h += '<p class="db-note" id="dashboard-volume-note">Kilograms lifted, last eight weeks</p>';
    h += volumeSvg(block.weeks);
    h += volumeTable(block.weeks);
    h += '</section>';
    return h;
  }
  function recordsHtml(rows) {
    var h = '<section class="db-sec" id="dashboard-records" aria-labelledby="dashboard-records-title">';
    h += '<h2 class="db-label" id="dashboard-records-title">Recent personal records</h2>';
    if (!rows || !rows.length) {
      h += '<p class="db-note">No records yet.</p></section>';
      return h;
    }
    h += '<ul class="db-records">';
    rows.forEach(function (row) {
      h += '<li class="db-rec"><div class="db-rec-name"><div class="name">' + esc(row.name) + '</div>';
      h += '<div class="db-note">' + esc(row.badge) + ' · ' + esc(row.dateLabel) + '</div></div>';
      h += '<div class="db-rec-val">' + esc(row.value) + '</div></li>';
    });
    h += '</ul></section>';
    return h;
  }
  function bestHtml(id, title, rows, empty) {
    var h = '<section class="db-sec" id="dashboard-' + id + '" aria-labelledby="dashboard-' + id + '-title">';
    h += '<h2 class="db-label" id="dashboard-' + id + '-title">' + esc(title) + '</h2>';
    if (!rows || !rows.length) {
      h += '<p class="db-note" id="dashboard-' + id + '-empty">' + esc(empty) + '</p></section>';
      return h;
    }
    h += '<ul class="db-records">';
    rows.forEach(function (row) {
      h += '<li class="db-rec"><div class="db-rec-name"><div class="name">' + esc(row.name) + '</div>';
      h += '<div class="db-note">' + esc(row.dateLabel) + '</div></div>';
      h += '<div class="db-rec-val">' + esc(row.value) + '</div></li>';
    });
    h += '</ul></section>';
    return h;
  }
  function holdsHtml(rows) {
    return bestHtml('holds', 'Static holds', rows, 'No holds yet.');
  }
  function stopwatchHtml(rows) {
    return bestHtml('stopwatch', 'Stopwatch', rows, 'No times yet.');
  }
  function calendarHtml(block) {
    var h = '<section class="db-sec" id="dashboard-calendar" aria-labelledby="dashboard-calendar-title">';
    h += '<h2 class="db-label" id="dashboard-calendar-title">' + esc(block.title) + '</h2>';
    h += '<div class="db-cal" role="grid" aria-label="Training days in ' + esc(block.monthLabel) + '">';
    h += '<div class="db-cal-row" role="row">';
    DOW.forEach(function (name, i) {
      h += '<div role="columnheader" aria-label="' + name + '">' + DOW_LETTER[i] + '</div>';
    });
    h += '</div>';
    var row = [];
    function flush() {
      if (!row.length) return;
      h += '<div class="db-cal-row" role="row">' + row.join('') + '</div>';
      row = [];
    }
    block.cells.forEach(function (cell) {
      if (!cell) {
        row.push('<div role="gridcell" class="db-day is-pad" aria-hidden="true"></div>');
      } else {
        var cls = 'db-day';
        if (cell.trained) cls += ' is-train';
        else if (cell.future) cls += ' is-future';
        var label = cell.dow + ', ' + longDate(cell.date);
        if (cell.today) label += ', today';
        label += cell.trained ? ', trained' : (cell.future ? '' : ', not trained');
        var current = cell.today ? ' aria-current="date"' : '';
        row.push('<div role="gridcell" class="' + cls + '"' + current + ' aria-label="' + esc(label) + '">' + cell.day + '</div>');
      }
      if (row.length === 7) flush();
    });
    flush();
    h += '</div>';
    var countLine = block.count === 0
      ? 'No training days so far this month'
      : block.count + ' training day' + (block.count === 1 ? '' : 's') + ' so far this month';
    h += '<p class="db-note" id="dashboard-calendar-note">' + countLine + '</p></section>';
    return h;
  }
  function html(model) {
    if (!model || model.empty) {
      return '<div id="dashboard"><div class="empty db-empty" id="dashboard-empty"><div class="name">Finish a workout and your dashboard will fill in.</div></div></div>';
    }
    var sections = STANDARD.map(function (id) { return cardSection(id, model); }).join('');
    return '<div id="dashboard"><div class="db-sheet" id="dashboard-sheet">' + sections + '</div></div>';
  }
  function unavailableHtml() {
    return '<div id="dashboard"><div class="empty db-empty" id="dashboard-unavailable"><div class="name">Saved sessions are not available yet.</div></div></div>';
  }
  var CARD_LABEL = {
    plan: 'Hit the plan',
    workouts: 'Workouts and streak',
    strength: 'Strength and Capacity',
    volume: 'Total volume',
    records: 'Recent personal records',
    calendar: 'Consistency',
    holds: 'Static holds',
    stopwatch: 'Stopwatch',
    pass: 'Stopwatch pass rate'
  };
  var STANDARD = ['plan', 'workouts', 'volume', 'strength', 'calendar', 'holds'];
  var CARD_ALL = ['plan', 'workouts', 'volume', 'strength', 'records', 'calendar', 'holds', 'stopwatch', 'pass'];
  function keptOrder(order) {
    var seen = {};
    var out = [];
    (order || []).forEach(function (id) {
      if (!CARD_LABEL[id] || seen[id]) return;
      seen[id] = 1;
      out.push(id);
    });
    return out;
  }
  function cardSection(id, model, opts) {
    model = model || {};
    if (id === 'plan') return planHtml(model.plan || { total: 0, hits: 0, pct: null, rating: null });
    if (id === 'workouts') return workoutsHtml(model.workouts || { week: 0, month: 0, goal: 0, streak: null }, opts);
    if (id === 'strength') return strengthHtml(model.strength || { weight: [], reps: [] });
    if (id === 'volume') return volumeHtml(model.volume || { weekKg: 0, weeks: [] });
    if (id === 'records') return recordsHtml(model.records || []);
    if (id === 'calendar') return model.calendar && Array.isArray(model.calendar.cells) ? calendarHtml(model.calendar) : '';
    if (id === 'holds') return holdsHtml(model.holds || []);
    if (id === 'stopwatch') return stopwatchHtml(model.stopwatch || []);
    if (id === 'pass') return passHtml(model.pass || { passes: 0, total: 0, pct: null });
    return '';
  }
  function passHtml(block) {
    block = block || { passes: 0, total: 0, pct: null };
    var h = '<section class="db-sec" id="dashboard-pass" aria-labelledby="dashboard-pass-title">';
    h += '<h2 class="db-label" id="dashboard-pass-title">Stopwatch pass rate</h2>';
    if (block.pct == null) {
      h += '<p class="db-note" id="dashboard-pass-note">No stopwatch events this month.</p></section>';
      return h;
    }
    var noun = block.total === 1 ? 'event' : 'events';
    h += '<div class="db-vol" id="dashboard-pass-pct">' + esc(String(block.pct)) + '%</div>';
    h += '<p class="db-note" id="dashboard-pass-note">' + esc(String(block.passes)) + ' of ' + esc(String(block.total)) + ' stopwatch ' + noun + ' passed this month</p></section>';
    return h;
  }
  function copyPlan(plan) {
    plan = plan || { total: 0, hits: 0, pct: null, rating: null };
    return {
      total: plan.total || 0,
      hits: plan.hits || 0,
      pct: plan.pct == null ? null : plan.pct,
      rating: plan.rating ? { label: plan.rating.label, color: plan.rating.color } : null
    };
  }
  function copyWeeks(weeks) {
    return (weeks || []).map(function (week) {
      return { start: week.start, label: week.label, kg: week.kg };
    });
  }
  function copyGains(rows) {
    return (rows || []).map(function (row) {
      return {
        name: row.name,
        pct: row.pct,
        rating: row.rating ? { label: row.rating.label, color: row.rating.color } : null,
        detail: row.detail || ''
      };
    });
  }
  function copyBests(rows) {
    return (rows || []).map(function (row) {
      return {
        name: row.name,
        value: row.value,
        date: row.date,
        dateLabel: row.dateLabel
      };
    });
  }
  function copyRecords(rows) {
    return (rows || []).map(function (row) {
      return {
        name: row.name,
        badge: row.badge,
        value: row.value,
        date: row.date,
        dateLabel: row.dateLabel
      };
    });
  }
  function copyCells(cells) {
    return (cells || []).map(function (cell) {
      if (!cell) return null;
      return {
        day: cell.day,
        date: cell.date,
        trained: !!cell.trained,
        future: !!cell.future,
        today: !!cell.today,
        dow: cell.dow
      };
    });
  }
  // Frozen card values. Later workouts do not change a snapshot built from this.
  // A saved "from" line may be an email from an older share. Show the name, or Trainer.
  function trainerLabel(name) {
    var n = String(name || '').replace(/^\s+|\s+$/g, '').slice(0, 80);
    if (!n || n.indexOf('@') !== -1) return 'Trainer';
    return n;
  }
  function freeze(model, order, meta) {
    model = model || {};
    meta = meta || {};
    var name = trainerLabel(meta.trainerName);
    var asOf = String(meta.asOf || '').slice(0, 10);
    var cards = [];
    keptOrder(order).forEach(function (id) {
      if (id === 'plan') cards.push({ type: 'plan', plan: copyPlan(model.plan) });
      else if (id === 'workouts') {
        var block = model.workouts || { week: 0, month: 0, goal: 0, streak: null };
        cards.push({
          type: 'workouts',
          scheduleNote: block.streak == null,
          workouts: {
            week: block.week || 0,
            month: block.month || 0,
            goal: block.goal > 0 ? block.goal : 0,
            streak: block.streak == null ? null : block.streak
          }
        });
      } else if (id === 'strength') {
        var gained = model.strength || { weight: [], reps: [] };
        cards.push({ type: 'strength', strength: { weight: copyGains(gained.weight), reps: copyGains(gained.reps) } });
      } else if (id === 'volume') {
        var volume = model.volume || { weekKg: 0, weeks: [] };
        cards.push({ type: 'volume', volume: { weekKg: volume.weekKg || 0, weeks: copyWeeks(volume.weeks) } });
      } else if (id === 'records') cards.push({ type: 'records', records: copyRecords(model.records) });
      else if (id === 'holds') cards.push({ type: 'holds', holds: copyBests(model.holds) });
      else if (id === 'stopwatch') cards.push({ type: 'stopwatch', stopwatch: copyBests(model.stopwatch) });
      else if (id === 'calendar' && model.calendar) {
        cards.push({
          type: 'calendar',
          calendar: {
            title: model.calendar.title,
            monthLabel: model.calendar.monthLabel,
            count: model.calendar.count || 0,
            cells: copyCells(model.calendar.cells)
          }
        });
      } else if (id === 'pass') {
        var pass = model.pass || { passes: 0, total: 0, pct: null };
        cards.push({ type: 'pass', pass: { passes: pass.passes || 0, total: pass.total || 0, pct: pass.pct == null ? null : pass.pct } });
      }
    });
    return { asOf: asOf, trainerName: name, cards: cards };
  }
  function stampText(snap) {
    snap = snap || {};
    var day = longDate(snap.asOf || snap.as_of);
    var name = trainerLabel(snap.trainerName || snap.trainer_name);
    if (!day) return 'From ' + name;
    return 'As of ' + day + ' from ' + name;
  }
  function snapshotModel(card) {
    var model = {};
    if (!card) return model;
    if (card.type === 'plan') model.plan = card.plan;
    if (card.type === 'workouts') model.workouts = card.workouts;
    if (card.type === 'strength') model.strength = card.strength;
    if (card.type === 'volume') model.volume = card.volume;
    if (card.type === 'records') model.records = card.records;
    if (card.type === 'holds') model.holds = card.holds;
    if (card.type === 'stopwatch') model.stopwatch = card.stopwatch;
    if (card.type === 'calendar') model.calendar = card.calendar;
    if (card.type === 'pass') model.pass = card.pass;
    return model;
  }
  function snapshotHtml(snap) {
    snap = snap || {};
    var cards = snap.cards;
    if (typeof cards === 'string') {
      try { cards = JSON.parse(cards); } catch (e) { cards = []; }
    }
    if (!Array.isArray(cards)) cards = [];
    var inner = cards.map(function (card) {
      if (!card || !CARD_LABEL[card.type]) return '';
      var opts = card.type === 'workouts' && card.scheduleNote ? { scheduleNote: true } : null;
      return cardSection(card.type, snapshotModel(card), opts);
    }).join('');
    return '<p class="db-stamp" id="dashboard-stamp">' + esc(stampText(snap)) + '</p>' +
      '<div id="dashboard"><div class="db-sheet" id="dashboard-sheet">' + inner + '</div></div>';
  }
  function toolRow(id, index, total) {
    var label = CARD_LABEL[id] || 'card';
    return '<div class="db-tools">' +
      '<button type="button" class="sm" data-card-up="' + id + '" aria-label="Move ' + esc(label) + ' up"' + (index === 0 ? ' disabled' : '') + '>▲</button>' +
      '<button type="button" class="sm" data-card-down="' + id + '" aria-label="Move ' + esc(label) + ' down"' + (index === total - 1 ? ' disabled' : '') + '>▼</button>' +
      '<button type="button" class="sm danger" data-card-remove="' + id + '" aria-label="Remove ' + esc(label) + '">Delete</button>' +
      '</div>';
  }
  function withEdit(section, id, index, total) {
    return section
      .replace('<section class="db-sec"', '<section class="db-sec db-edit" data-card="' + id + '"')
      .replace('>', '>' + toolRow(id, index, total));
  }
  function editorHtml(model, order, opts) {
    opts = opts || {};
    var ids = keptOrder(order);
    var editing = !!opts.editing;
    var self = !!opts.self;
    var sections = ids.map(function (id, index) {
      var cardOpts = id === 'workouts' ? { scheduleNote: !model || !model.workouts || model.workouts.streak == null } : null;
      var section = cardSection(id, model, cardOpts);
      return editing ? withEdit(section, id, index, ids.length) : section;
    }).join('');
    if (!sections) sections = '<p class="db-note" id="dashboard-no-cards">' + (self ? 'Add a card.' : 'Add a card to share.') + '</p>';
    var missing = CARD_ALL.filter(function (id) { return ids.indexOf(id) < 0; });
    var add = '';
    if (editing && missing.length) {
      add = '<div id="dash-add"><p class="db-note" id="dash-add-label">Add a card</p><div class="actions">';
      missing.forEach(function (id) {
        add += '<button type="button" data-card-add="' + id + '">' + esc(CARD_LABEL[id]) + '</button>';
      });
      add += '</div></div>';
    }
    var canShare = !self && opts.share !== false;
    var bar = '<div id="dash-editor"><div class="dash-actions">';
    bar += '<button type="button" id="dash-edit" aria-pressed="' + (editing ? 'true' : 'false') + '">Edit</button>';
    bar += '<button type="button" id="dash-reset">Reset</button>';
    if (canShare) bar += '<button type="button" class="pri" id="dash-share"' + (ids.length ? '' : ' disabled') + '>Share</button>';
    bar += '</div>';
    if (!self && opts.share === false) bar += '<p class="db-note" id="dash-share-none">This client keeps their own live dashboard.</p>';
    bar += '</div>';
    var save = editing ? '<button type="button" class="pri" id="dash-save">Save</button>' : '';
    return bar + add +
      '<div id="dashboard"><div class="db-sheet" id="dashboard-sheet">' + sections + '</div>' + save + '</div>';
  }

  var api = {
    allowed: allowed,
    hitPlan: hitPlan,
    ratingFor: ratingFor,
    gainRating: gainRating,
    build: build,
    html: html,
    unavailableHtml: unavailableHtml,
    freeze: freeze,
    snapshotHtml: snapshotHtml,
    editorHtml: editorHtml,
    stampText: stampText,
    STANDARD: STANDARD,
    CARDS: CARD_ALL,
    CARD_LABEL: CARD_LABEL,
    RATINGS: RATINGS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WBDashboard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
