/* Workout player (Stage 3). Exposes window.WBPlayer { mount, unmount, requestEnd }.
   Timing: elapsed = acc + (now - t0) from performance.now(), rendered with requestAnimationFrame (no drift). */
(function () {
  'use strict';
  var M = window.WB, S = null, audio = null, wake = null;
  function now() { return performance.now() + (window.__wbClockOffset || 0); } // offset hook for tests only
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function exOf(i) { var st = S.queue[i]; return S.w.items.filter(function (x) { return x.id === st.exerciseId; })[0]; }
  function cfg(i) { return exOf(i).modeConfig || {}; }
  function elapsed() { return S.acc + (S.running ? now() - S.t0 : 0); }

  // ---------- feedback ----------
  function ensureAudio() { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch (e) {} }
  function beep() {
    if (navigator.vibrate) try { navigator.vibrate([180, 90, 180]); } catch (e) {}
    if (!audio) return;
    [0, 0.22].forEach(function (d) {
      var o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + d;
      o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.start(t); o.stop(t + 0.18);
    });
    S && (S.beeps = (S.beeps || 0) + 1);
  }
  // ---------- interval tones: one schedule per run, played via audio.currentTime ----------
  var STANDOFF = 5;
  // Times in seconds from the moment Start is pressed. tick = single tone, go = double higher, done = completion.
  function toneSchedule(workSec, n) {
    var t = [], k, e, j;
    for (k = 0; k < STANDOFF; k++) t.push({ t: k, kind: 'tick' });
    t.push({ t: STANDOFF, kind: 'go' });
    for (k = 1; k <= n; k++) {
      e = STANDOFF + k * workSec;
      for (j = 3; j >= 1; j--) if (j < workSec) t.push({ t: e - j, kind: 'tick' });
      t.push({ t: e, kind: k < n ? 'go' : 'done' });
    }
    return t;
  }
  // Timer mode: one set per run. Rest only when the set actually rests; next set still waits for a tap.
  // Timer mode: back-to-back run of this exercise's consecutive sets (work -> rest -> work ...).
  function timerSchedule(workSec, restSec, n, endsExercise) {
    var t = toneSchedule(workSec, 1); t.length = STANDOFF + 1; // standoff ticks + go
    var cur = STANDOFF, k, q, j, ph, e, last;
    for (k = 1; k <= n; k++) {
      ph = restSec > 0 ? [workSec, restSec] : [workSec];
      for (q = 0; q < ph.length; q++) {
        e = cur + ph[q]; last = k === n && q === ph.length - 1;
        for (j = 3; j >= 1; j--) if (j < ph[q]) t.push({ t: e - j, kind: 'tick' });
        if (!last) t.push({ t: e, kind: 'go' }); else if (endsExercise) t.push({ t: e, kind: 'done' });
        cur = e;
      }
    }
    return t;
  }
  function tone(at, f, dur) {
    var o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = f; o.connect(g); g.connect(audio.destination);
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(1, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.start(at); o.stop(at + dur + 0.02); S.nodes.push(o);
  }
  function runMs() { // ms since Start of the current interval run (pauses excluded)
    if (!S.run || S.phase === 'standoff') return elapsed();
    if (S.run.timer) return STANDOFF * 1000 + (S.queue[S.idx].set - S.run.firstSet) * (S.run.w + S.run.r) * 1000 + (S.phase === 'rest' ? S.run.w * 1000 : 0) + elapsed();
    return STANDOFF * 1000 + (S.queue[S.idx].set - S.run.firstSet) * S.run.w * 1000 + elapsed();
  }
  function stopTones() { (S.nodes || []).forEach(function (o) { try { o.stop(); } catch (e) {} }); S.nodes = []; }
  function scheduleTones() { // remaining schedule for tests / pause; playback itself follows the visible second
    stopTones(); if (!S.run) return;
    var r = runMs(); S.pending = [];
    S.run.sched.forEach(function (x) {
      var dt = x.t * 1000 - r; if (dt < -20) return;
      S.pending.push({ t: x.t, kind: x.kind });
    });
  }
  function visibleSecond() {
    var d = phaseDur();
    if (d == null) return null;
    return Math.ceil(Math.max(0, d - elapsed()) / 1000);
  }
  // Tones share the display clock. A beep fires on the frame the visible second changes,
  // not from a pre-scheduled audio time that can drift away from the number on screen.
  function fireTone(kind) {
    (S.toneLog = S.toneLog || []).push({ kind: kind, vis: visibleSecond(), phase: S.phase, at: Math.round(runMs()) });
    if (!audio) return;
    try {
      var t = audio.currentTime;
      if (kind === 'tick') tone(t, 660, 0.12);
      else if (kind === 'go') { tone(t, 1320, 0.1); tone(t + 0.15, 1320, 0.1); }
      else { tone(t, 880, 0.15); tone(t + 0.18, 1100, 0.15); tone(t + 0.36, 1320, 0.35); }
    } catch (e) {}
  }
  function playDueTones() {
    if (!S || !S.run || !S.run.sched) return;
    if (S.noBeep) { S.toneMark = runMs(); return; } // skip/pause must not sound boundaries the clock jumped over
    var r = runMs(), prev = S.toneMark == null ? -1 : S.toneMark, due = [];
    S.run.sched.forEach(function (x) {
      var ms = x.t * 1000;
      if (ms > prev && ms <= r) due.push(x);
    });
    S.toneMark = r;
    if (!due.length) return;
    // A clock jump (early rest, or a test fast-forward) can cross several seconds at once.
    // Sound only the latest boundary so the beep matches the second now on screen.
    fireTone(due[due.length - 1].kind);
  }
  function armRun(run) {
    S.toneMark = -1; S.toneLog = []; S.run = run; scheduleTones();
  }
  function lockScreen() { if (navigator.wakeLock && !wake) navigator.wakeLock.request('screen').then(function (l) { wake = l; l.addEventListener('release', function () { wake = null; }); }).catch(function () {}); }
  function onVis() { if (S && document.visibilityState === 'visible') lockScreen(); }

  // ---------- results (one per queue step, prefilled from targets, editable) ----------
  function res(i) {
    if (S.results[i]) return S.results[i];
    var st = S.queue[i], ex = exOf(i), c = ex.modeConfig;
    var r = { step: i, exerciseId: ex.id, name: ex.name, set: st.set, of: st.of, mode: ex.mode, unit: ex.weight.unit,
      weight: ex.weight.unit === 'bodyweight' ? null : ex.weight.value, logged: false };
    if (ex.mode === 'reps') { if (c.repsType === 'number') r.reps = c.count; else if (c.repsType === 'range') r.reps = c.max; else r.holdSec = 0; }
    if (ex.mode === 'intervals' || ex.mode === 'timer') { r.workSec = c.workSec; if (c.repsType === 'number') r.reps = c.count; else if (c.repsType === 'range') r.reps = c.max; }
    if (ex.mode === 'stopwatch') { r.durationMs = 0; r.laps = []; }
    return (S.results[i] = r);
  }
  function target(ex) {
    var c = ex.modeConfig;
    if (ex.mode === 'reps') return (c.repsType === 'number' ? c.count + ' reps' : c.repsType === 'range' ? c.min + '–' + c.max + ' reps' : 'Static hold') + (c.restSec ? ' · ' + M.fmtTime(c.restSec) + ' rest' : '');
    if (ex.mode === 'intervals') return M.fmtTime(c.workSec) + ' interval' + (c.repsType ? ' · ' + M.repsText(c) : '');
    if (ex.mode === 'timer') return M.fmtTime(c.workSec) + ' work · ' + M.fmtTime(c.restSec) + ' rest' + (c.repsType ? ' · ' + M.repsText(c) : '');
    return c.lapsEnabled ? c.lapCount + (c.lapCount === 1 ? ' lap' : ' laps') : 'Stopwatch';
  }
  function infoLines(ex) { // weight, reps/laps, and work/rest — no set or attempt counters
    var c = ex.modeConfig || {}, w = ex.weight.unit === 'bodyweight' ? 'Bodyweight' : ex.weight.value != null ? ex.weight.value + ' ' + ex.weight.unit : '';
    var reps = ex.mode === 'stopwatch' ? (c.lapsEnabled ? c.lapCount + (c.lapCount === 1 ? ' lap' : ' laps') : '') : ex.mode === 'reps' && c.repsType === 'static' ? 'Static hold' : c.repsType ? M.repsText(c) : '';
    var time = '';
    if (ex.mode === 'intervals') time = M.fmtTime(c.workSec);
    else if (ex.mode === 'timer') time = M.fmtTime(c.workSec) + ' work' + (c.restSec ? ' · ' + M.fmtTime(c.restSec) + ' rest' : '');
    else if (ex.mode === 'reps' && c.restSec) time = M.fmtTime(c.restSec) + ' rest';
    return [[w, reps, time].filter(Boolean).join(' · ')];
  }
  // Superset round: consecutive queue items with the same groupId and set number.
  function isFinalInRound(i) {
    var q = S.queue[i]; if (!q.groupId) return true;
    var n = S.queue[i + 1]; return !n || n.groupId !== q.groupId || n.set !== q.set;
  }
  function effectiveRest(i) { return isFinalInRound(i) ? (cfg(i).restSec > 0 ? cfg(i).restSec : 0) : 0; }
  function roundMembers(i) {
    var q = S.queue[i]; if (!q.groupId) return [i];
    var out = []; for (var j = 0; j < S.queue.length; j++) if (S.queue[j].groupId === q.groupId && S.queue[j].set === q.set) out.push(j);
    return out;
  }
  // Reps bubble replaces the old "Set N" chip. Static means a hold with no rep target.
  function repsBubble(ex) {
    var c = ex.modeConfig || {};
    if (c.repsType === 'number') return c.count + (c.count === 1 ? ' Rep' : ' Reps');
    if (c.repsType === 'range') return c.min + '-' + c.max + ' Reps';
    return 'Static';
  }
  function statusChip(ex) {
    if (ex.mode === 'stopwatch') {
      if (S.phase === 'complete') return 'Attempt complete';
      var c = ex.modeConfig || {};
      if (c.lapsEnabled) return c.lapCount + (c.lapCount === 1 ? ' Lap' : ' Laps');
      return 'Stopwatch'; // laps off: no lap total, so the chip stays on the mode instead of Ready/Work
    }
    if (S.phase === 'standoff') return 'Get ready';
    if (S.phase === 'rest') return 'Rest';
    if (S.phase === 'complete') return 'Set complete';
    if (S.phase === 'work' && ex.mode !== 'reps') return ex.mode === 'intervals' ? 'Interval' : 'Work';
    if (S.phase === 'ready') return ex.mode === 'intervals' ? 'Interval' : 'Ready';
    return repsBubble(ex);
  }

  // ---------- state machine ----------
  // phase: ready | work | rest | complete ; countdown phases have a duration, count-up phases don't
  function phaseDur() {
    var ex = exOf(S.idx), c = ex.modeConfig;
    if (S.phase === 'standoff') return STANDOFF * 1000;
    if (S.phase === 'rest') return effectiveRest(S.idx) * 1000;
    if (S.phase === 'work' && (ex.mode === 'intervals' || ex.mode === 'timer')) return c.workSec * 1000;
    return null;
  }
  function logRound(i) { roundMembers(i).forEach(log); } // final rest / interrupt logs remaining members
  function logResting() { if (S.phase === 'rest') logRound(S.idx); } // rest end/interrupt/End-during-rest
  function logOnLeave() {
    // Non-final SS: log this member as the next in the round initiates. Non-SS / final-no-rest unchanged.
    if (S.queue[S.idx].groupId && !isFinalInRound(S.idx)) log(S.idx);
    else logRound(S.idx);
  }
  function logStartedInRound() {
    // End mid-round before rest: log started (have results) unlogged members of this SS round
    var q = S.queue[S.idx]; if (!q || !q.groupId) return;
    roundMembers(S.idx).forEach(function (mi) { if (S.results[mi] && !S.results[mi].logged) log(mi); });
  }
  function enterStep(i) {
    logResting(); S.prompt = false;
    S.idx = i; S.running = false; S.acc = 0; S.rep = 1; if (S.run) { stopTones(); S.run = null; }
    var ex = exOf(i);
    S.phase = ex.mode === 'reps' && ex.modeConfig.repsType !== 'static' ? 'work' : 'ready';
    res(i); render();
  }
  function startTimer(phase) {
    S.phase = phase; S.acc = 0; S.t0 = now(); S.running = true;
    if (phase === 'rest') S.restCue = null;
    lockScreen();
  }
  function log(i) { var r = res(i); if (r.logged) return; r.logged = true; r.at = Date.now(); }
  function startRest() {
    if (effectiveRest(S.idx) > 0) { log(S.idx); startTimer('rest'); render(); } // logged when rest starts
    else {
      logOnLeave(); // no rest: log as the set completes, including a non-final superset tap-through
      advance();
    }
  }
  function advance() { if (S.idx < S.queue.length - 1) enterStep(S.idx + 1); else endPrompt(); }
  function endPrompt() { // last set (incl. rest) complete -> ask; Keep editing leaves logs editable
    logResting(); S.running = false; if (S.run) { S.nodes = []; S.run = null; } S.phase = 'complete'; S.prompt = true; render();
  }
  function togglePause() {
    if (!(S.phase === 'work' || S.phase === 'rest' || S.phase === 'standoff') || (S.phase === 'work' && exOf(S.idx).mode === 'reps' && cfg(S.idx).repsType !== 'static')) return;
    if (S.running) { S.acc += now() - S.t0; S.running = false; stopTones(); }
    else { S.t0 = now(); S.running = true; S.toneMark = runMs(); scheduleTones(); }
    render();
  }
  function primary() {
    ensureAudio();
    var ex = exOf(S.idx), c = ex.modeConfig, r = res(S.idx);
    if (S.phase === 'rest') return skipRest(); // tap skips the rest that is left; logging stays with phaseEnd
    if (S.phase === 'complete') return advance();
    if (ex.mode === 'reps') {
      if (c.repsType === 'static' && S.phase === 'ready') { startTimer('work'); return render(); }
      if (c.repsType === 'static') { r.holdSec = Math.round(elapsed() / 1000); S.running = false; }
      return startRest(); // reps: logged when rest starts, or immediately when there is no rest
    }
    if (S.phase === 'ready') {
      if (ex.mode === 'intervals') { // 5s standoff, then the run continues through this exercise's consecutive intervals
        var n = 1; while (S.idx + n < S.queue.length && S.queue[S.idx + n].exerciseId === ex.id) n++;
        startTimer('standoff');
        armRun({ firstSet: S.queue[S.idx].set, w: c.workSec, n: n, sched: toneSchedule(c.workSec, n) });
        return render();
      }
      if (ex.mode === 'timer') { // back-to-back through consecutive same-exercise sets; rest only when effectiveRest says so
        var tn = 1; while (S.idx + tn < S.queue.length && S.queue[S.idx + tn].exerciseId === ex.id) tn++;
        // tn>1 only happens outside rotated supersets (ungrouped); those sets all take c.restSec.
        var rs = tn === 1 ? effectiveRest(S.idx) : (c.restSec > 0 ? c.restSec : 0), lst = S.queue[S.idx + tn - 1];
        startTimer('standoff');
        armRun({ timer: true, firstSet: S.queue[S.idx].set, w: c.workSec, r: rs, n: tn, sched: timerSchedule(c.workSec, rs, tn, lst.set === lst.of) });
        return render();
      }
      if (ex.mode === 'stopwatch') { r.laps = []; r.durationMs = 0; delete r.eventResults; } // redo starts unmarked
      startTimer('work'); return render();
    }
    if (ex.mode === 'stopwatch' && S.phase === 'work') {
      if (!S.running) { togglePause(); return; }
      var tot = elapsed();
      if (c.lapsEnabled) {
        var prev = r.laps.length ? r.laps[r.laps.length - 1].totalMs : 0;
        r.laps.push({ lapMs: tot - prev, totalMs: tot });
        if (r.laps.length < c.lapCount) return render();
      }
      S.acc = tot; S.running = false; r.durationMs = tot; log(S.idx); beep(); S.phase = 'complete'; return render();
    }
    if (ex.mode === 'timer' && S.phase === 'work') return endTimerWorkEarly();
    togglePause(); // intervals, and timer standoff/rest: pause/resume
  }
  // Timer work tap: the planned hold is a goal. Log the elapsed seconds, drop leftover work, start rest now.
  function endTimerWorkEarly() {
    var ex = exOf(S.idx), r = res(S.idx);
    r.workSec = Math.max(0, Math.round(elapsed() / 1000));
    if (S.run && S.run.r > 0) {
      log(S.idx);
      startTimer('rest'); // elapsed 0 — leftover work does not shorten or delay rest
      scheduleTones();
      return render();
    }
    var tx = S.idx + 1;
    if (S.run && tx < S.queue.length && S.queue[tx].exerciseId === ex.id) {
      log(S.idx); S.idx = tx; res(tx); startTimer('work'); scheduleTones(); return render();
    }
    stopTones();
    if (S.run) { S.nodes = []; S.run = null; }
    logOnLeave(); // no rest, including a non-final superset: log the short hold and move on
    S.flashDone = true; // hold finished and moved on; running is false because the next step has not started
    advance();
  }
  function phaseEnd(over) {
    var ex = exOf(S.idx), c = ex.modeConfig, r = res(S.idx);
    if (S.phase === 'standoff') { startTimer('work'); S.t0 = now() - over; return render(); }
    if (ex.mode === 'intervals' && S.run) {
      var nx = S.idx + 1;
      if (nx < S.queue.length && S.queue[nx].exerciseId === ex.id) { // auto-continue same exercise
        log(S.idx); S.idx = nx; res(nx); startTimer('work'); S.t0 = now() - over; return render();
      }
      if (navigator.vibrate) try { navigator.vibrate([300, 100, 300]); } catch (e) {}
      S.nodes = []; S.run = null; S.beeps = (S.beeps || 0) + 1;
      logOnLeave();
      return advance();
    }
    if (ex.mode === 'timer' && S.run) { // back to back; final rest still logs via logResting/logRound
      if (!S.noBeep) S.beeps = (S.beeps || 0) + 1;
      if (S.phase === 'work' && S.run.r > 0) { log(S.idx); startTimer('rest'); S.t0 = now() - over; return render(); }
      var tx = S.idx + 1;
      if (tx < S.queue.length && S.queue[tx].exerciseId === ex.id) { log(S.idx); S.idx = tx; res(tx); startTimer('work'); S.t0 = now() - over; return render(); }
      S.nodes = []; S.run = null;
      logOnLeave();
      return advance();
    }
    if (S.phase === 'rest') { logRound(S.idx); return advance(); } // end cue already played in tick, unless this is a skip
    beep();
    if (ex.mode === 'intervals') {
      logOnLeave();
      return advance();
    }
    if (ex.mode === 'timer') {
      if (effectiveRest(S.idx) > 0) { log(S.idx); startTimer('rest'); S.acc = over; return render(); }
      logOnLeave();
      return advance();
    }
  }
  function select(i) { if (i === S.idx) return; enterStep(i); }
  // Rest end in seconds from Start, for a timer run. Matches the schedule built by timerSchedule.
  function timerRestEndSec() {
    var set = S.queue[S.idx].set;
    return STANDOFF + (set - S.run.firstSet) * (S.run.w + S.run.r) + S.run.w + S.run.r;
  }
  function restEndCovered() {
    if (!(S.run && S.run.timer && S.run.sched)) return false;
    var end = timerRestEndSec();
    return S.run.sched.some(function (x) { return Math.abs(x.t - end) < 0.05 && (x.kind === 'go' || x.kind === 'done'); });
  }
  // Last 3 seconds of a rest that is not already on a tone schedule (reps, static hold).
  function cueRestTicks() {
    if (!S || S.phase !== 'rest' || !S.running || S.noBeep) return;
    if (S.run && S.run.sched) return;
    var sec = visibleSecond();
    if (sec == null) return;
    if (S.restCue == null) { S.restCue = sec; return; }
    if (sec === S.restCue) return;
    var prev = S.restCue;
    S.restCue = sec;
    if (sec <= 0) return;
    var dur = phaseDur() / 1000, cue = 0, s;
    for (s = prev - 1; s >= sec; s--) if (s >= 1 && s <= 3 && s < dur) cue = s;
    if (cue) fireTone('tick');
  }
  // Double beep at zero. Timer runs that already schedule go/done keep that tone instead.
  function cueRestEnd() {
    if (!S || S.phase !== 'rest' || S.noBeep || restEndCovered()) return;
    if (navigator.vibrate) try { navigator.vibrate([180, 90, 180]); } catch (e) {}
    fireTone('go');
    S.beeps = (S.beeps || 0) + 1;
  }
  function skipRest() {
    if (!S || S.phase !== 'rest') return;
    stopTones();
    S.noBeep = true; // no countdown or end tone after a skip
    S.noFlash = true;
    S.running = false;
    phaseEnd(0);
    if (S) S.noBeep = false;
  }

  function finish() {
    if (S.phase === 'rest') logResting(); else logStartedInRound();
    S.running = false; cancelAnimationFrame(S.raf);
    var logged = Object.keys(S.results).map(function (k) { return S.results[k]; }).filter(function (r) { return r.logged; }).sort(function (a, b) { return a.step - b.step; });
    var sess = { id: M.uid('ses'), workoutId: S.w.id, workoutName: S.w.name, startedAt: S.startedAt, endedAt: Date.now(), results: logged, ownWork: !S.w.sourceTrainerId };
    S.saved = M.SAVE_SESSIONS && logged.length > 0;
    if (S.saved) { S.data.sessions.push(sess); S.persist(); }
    S.done = sess; if (wake) wake.release().catch(function () {});
    renderSummary();
  }
  function resultLine(r) {
    var p = [];
    if (r.reps != null) p.push(r.reps + ' reps');
    if (r.holdSec != null) p.push(M.fmtTime(r.holdSec) + ' hold');
    if (r.rounds != null) p.push(r.rounds + ' rounds');
    if (r.workSec != null) p.push(M.fmtTime(r.workSec) + ' work');
    if (r.mode === 'stopwatch') p.push(M.formatStopwatch(r.durationMs) + (r.laps.length ? ' · ' + r.laps.length + ' laps' : ''));
    p.push(r.unit === 'bodyweight' ? 'BW' : r.weight != null ? r.weight + ' ' + r.unit : '');
    return p.filter(Boolean).join(' · ');
  }
  function loggedLine() {
    var sets = { n: 0, of: 0 }, atts = { n: 0, of: 0 };
    S.queue.forEach(function (q, i) {
      var ex = S.w.items.filter(function (x) { return x.id === q.exerciseId; })[0];
      var bucket = ex && ex.mode === 'stopwatch' ? atts : sets;
      bucket.of++;
      if (S.results[i] && S.results[i].logged) bucket.n++;
    });
    function part(bucket, one, many) {
      return bucket.n + ' of ' + bucket.of + ' ' + (bucket.of === 1 ? one : many) + ' logged';
    }
    var parts = [];
    if (sets.of) parts.push(part(sets, 'set', 'sets'));
    if (atts.of) parts.push(part(atts, 'attempt', 'attempts'));
    return parts.join(' · ');
  }
  function renderSummary() {
    var s = S.done, mins = Math.round((s.endedAt - s.startedAt) / 1000);
    var h = '<div class="pl-done"><div class="pl-check">✓</div><h2>Workout complete</h2><p class="mute">' + esc(s.workoutName) + ' · ' + M.fmtTime(mins) + ' total · ' +
      loggedLine() + '</p><div class="card pl-sum">';
    if (!S.saved) h += '<p class="mute">' + (s.results.length ? 'Session not saved (history is off for now).' : 'Nothing was logged.') + '</p>';
    s.results.forEach(function (r) {
      h += '<div class="pl-row"><div class="grow"><b>' + esc(r.name) + '</b> <span class="mute">' + (r.mode === 'stopwatch' ? 'attempt ' : 'set ') + r.set + '/' + r.of + '</span><div class="mute">' + esc(resultLine(r)) + '</div>' +
        (r.laps && r.laps.length ? '<div class="pl-laps sm">' + r.laps.map(function (l, k) { return '<span>L' + (k + 1) + ' ' + M.formatStopwatch(l.lapMs) + '</span>'; }).join('') + '</div>' : '') +
        eventSummaryHtml(r) + '</div></div>';
    });
    h += '</div><button class="pri" style="width:100%" data-p="exit">Done</button></div>';
    S.root.innerHTML = h;
  }

  // ---------- rendering ----------
  function stepper(f, label, val, step, si) {
    var di = si != null ? ' data-si="' + si + '"' : '';
    return '<div class="pl-f"><span>' + label + '</span><div class="pl-step"><button data-st="' + f + '" data-d="-' + step + '"' + di + ' aria-label="Decrease ' + label + '">−</button>' +
      '<input type="number" inputmode="decimal" min="0" data-f="' + f + '"' + di + ' value="' + (val == null ? '' : val) + '"><button data-st="' + f + '" data-d="' + step + '"' + di + ' aria-label="Increase ' + label + '">+</button></div></div>';
  }
  function primaryLabel(ex) {
    var c = ex.modeConfig;
    if (S.phase === 'rest') return 'Skip rest';
    if (S.phase === 'complete') return S.idx < S.queue.length - 1 ? 'Next exercise' : 'Finish workout';
    if (ex.mode === 'reps') return c.repsType === 'static' && S.phase === 'ready' ? 'Start hold' : 'Rest';
    if (ex.mode === 'timer' && S.phase === 'work') return effectiveRest(S.idx) > 0 ? 'Rest' : 'Next';
    if (S.phase === 'ready') return 'Start';
    if (ex.mode === 'stopwatch') return !S.running ? 'Resume' : c.lapsEnabled ? 'Lap ' + (res(S.idx).laps.length + 1) + ' / ' + c.lapCount : 'Finish';
    return S.running ? 'Pause' : 'Resume';
  }
  function playerMedia(ex) {
    var m = M.cleanMedia(ex && ex.media);
    if (m && m.kind === 'library') {
      var url = M.exerciseGifUrl(m.libraryId, m.view, (window.WBAuth && WBAuth.gifBase) || '');
      if (url) return '<img class="ex-gif" alt="" data-gif="1" src="' + esc(url) + '">';
      return '<span class="media-note">Demo isn\u2019t connected yet</span>';
    }
    if (m && m.kind === 'custom' && m.imageKey) {
      var cached = window.WBMedia && WBMedia.peek(m.imageKey);
      if (cached) return '<img class="ex-gif" alt="" src="' + esc(cached) + '">';
      return '<span class="media-note" data-local-img="' + esc(m.imageKey) + '">No image on this device</span>';
    }
    return '<svg viewBox="0 0 24 24" width="34" height="34"><path fill="currentColor" d="M8 5v14l11-7z"/></svg><span>Exercise media coming soon</span>';
  }
  function render() {
    var i = S.idx, st = S.queue[i], ex = exOf(i), c = ex.modeConfig, r = res(i);
    var chip = statusChip(ex);
    var showRO = S.phase === 'rest' || !(ex.mode === 'reps' && c.repsType !== 'static');
    var h = '<div class="pl">';
    // stage: visual screen + side carousel. Stopwatch taps live on .pl-go, so its media stays display-only.
    var mems = roundMembers(i), sw = ex.mode === 'stopwatch', resting = S.phase === 'rest';
    var interval = ex.mode === 'intervals';
    var timedWork = S.phase === 'work' && (ex.mode === 'timer' || ex.mode === 'intervals'); // countdown only; stopwatch and holds still count up
    var infoEx = ex;
    if (resting && i + 1 < S.queue.length) infoEx = exOf(i + 1); // rest frame is the upcoming exercise, with no "Up next" label
    h += '<div class="pl-stage"><div class="pl-main"><div class="pl-screen ' + (resting ? 'is-rest' : '') + (timedWork ? ' is-work' : '') + (sw ? ' is-static' : '') + (interval ? ' is-interval' : '') + '"' + (sw ? '' : ' data-p="primary" role="button" aria-label="' + esc(primaryLabel(ex)) + '"') + '>' + (sw ? '' : '<div class="pl-hint">' + esc(hint(ex)) + '</div>') +
      (resting ? '' : '<div class="pl-media" aria-hidden="true">' + playerMedia(ex) + '</div>') +
      '<div class="pl-top"><span class="pl-chip">' + esc(chip) + '</span>' + (st.groupId ? '<span class="pl-chip ss">Superset</span>' : '') + '</div>' +
      (showRO ? '<div class="pl-ro" id="ro">' + readout() + '</div>' : '');
    h += '<div class="pl-bar"><i id="pg"></i></div></div>'; // end screen
    if (!sw) {
      h += '<div class="pl-info"><div class="pl-name">' + esc(infoEx.name) + '</div><div class="pl-meta">' + infoLines(infoEx).filter(Boolean).map(function (x) { return '<div>' + esc(x) + '</div>'; }).join('') + '</div>' +
        (resting ? '<div class="pl-rest-veil" id="rest-veil" aria-hidden="true"></div>' : '') + '</div>';
    }
    h += '</div>'; // end pl-main (media column)
    var mixedSw = S.w.items.some(function (it) { return it.mode === 'stopwatch'; }) && S.w.items.some(function (it) { return it.mode !== 'stopwatch'; });
    var carHead = mixedSw ? 'Steps' : (S.w.items.some(function (it) { return it.mode === 'stopwatch'; }) ? 'Attempts' : 'Sets');
    h += '<div class="pl-car" aria-label="All ' + carHead.toLowerCase() + '">';
    for (var j = 0; j < S.queue.length; j++) {
      var q = S.queue[j], e2 = exOf(j), lg = S.results[j] && S.results[j].logged;
      var linked = j > 0 && q.groupId && S.queue[j - 1].groupId === q.groupId && S.queue[j - 1].set === q.set;
      if (linked) h += '<div class="pl-chain" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17 7h-4v2h4a3 3 0 010 6h-4v2h4a5 5 0 000-10zm-6 8H7a3 3 0 010-6h4V7H7a5 5 0 000 10h4v-2zm-3-4h8v2H8v-2z"/></svg></div>';
      var sub = e2.mode === 'stopwatch' ? 'Attempt ' + q.set + '/' + q.of : (e2.mode === 'intervals' ? 'Interval ' + q.set + '/' + q.of : 'Set ' + q.set + '/' + q.of);
      h += '<button class="pl-ci' + (j === i ? ' cur' : '') + (lg ? ' done' : '') + '" data-sel="' + j + '"' + (j === i ? ' aria-current="true"' : '') + '>' + (lg ? '<i class="pl-ck">✓</i>' : '') + '<b>' + esc(e2.name) + '</b>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</button>';
    }
    h += '</div></div>'; // end car + stage
    if (sw) h += '<button class="pl-go" data-p="primary">' + esc(primaryLabel(ex)) + '</button>';
    // tracking bar — during a shared superset rest, stack every round member's fields
    function trackBlock(mi) {
      var exT = exOf(mi), stT = S.queue[mi], rT = res(mi), out = '';
      out += '<div class="pl-th"><span><b>' + esc(exT.name) + '</b> · ' + (exT.mode === 'stopwatch' ? 'Attempt ' : exT.mode === 'intervals' ? 'Interval ' : 'Set ') + stT.set + '/' + stT.of + '</span>' + (rT.logged ? '<span class="pl-ok">✓ Logged</span>' : '<span class="mute">Tracking</span>') + '</div><div class="pl-fields">';
      if (rT.reps !== undefined) out += stepper('reps', 'Reps', rT.reps, 1, mi);
      if (rT.holdSec !== undefined) out += stepper('holdSec', 'Hold (s)', rT.holdSec, 5, mi);
      if (rT.rounds !== undefined) out += stepper('rounds', 'Rounds', rT.rounds, 1, mi);
      if (rT.workSec !== undefined) out += stepper('workSec', exT.mode === 'intervals' ? 'Interval (s)' : 'Work (s)', rT.workSec, 5, mi);
      if (rT.unit !== 'bodyweight') out += stepper('weight', 'Weight (' + rT.unit + ')', rT.weight, rT.unit === 'kg' ? 2.5 : 5, mi);
      else out += '<div class="pl-f"><span>Weight</span><div class="pl-bw">Bodyweight</div></div>';
      out += '</div>';
      if (rT.laps && rT.laps.length) out += '<div class="pl-laps">' + rT.laps.map(function (l, k) { return '<span><b>Lap ' + (k + 1) + '</b> ' + M.formatStopwatch(l.lapMs) + ' <i>' + M.formatStopwatch(l.totalMs) + '</i></span>'; }).join('') + '</div>';
      out += eventRowsHtml(exT, rT, mi);
      return out;
    }
    h += '<div class="pl-track">';
    if (S.phase === 'rest' && st.groupId && mems.length > 1) mems.forEach(function (mi) { h += '<div class="pl-track-g">' + trackBlock(mi) + '</div>'; });
    else h += trackBlock(i);
    h += '</div>';
    // Workout list: name and notes only. Tapping a row does not change the exercise.
    h += '<div class="pl-list"><div class="pl-car-h">Workout</div>';
    S.w.items.forEach(function (it) {
      var note = String(it.notes || ''), canNote = note.trim().length > 0, noteOpen = !!(canNote && S.notesOpen && S.notesOpen[it.id]);
      h += '<div class="pl-li"><div class="pl-li-top"><b>' + esc(it.name) + '</b>' +
        '<button type="button" class="pl-notes-btn" data-notes="' + esc(it.id) + '"' + (canNote ? '' : ' disabled title="No notes" aria-label="No notes"') +
        ' aria-expanded="' + (noteOpen ? 'true' : 'false') + '">Notes</button></div>' +
        (noteOpen ? '<div class="pl-notes">' + esc(note) + '</div>' : '') + '</div>';
    });
    h += '</div><button class="pl-endw" data-p="end">End workout</button></div>';
    if (S.prompt) h += '<div class="pl-modal"><div class="card"><h3>Workout complete</h3><p class="mute">End the workout now, or keep editing your logged sets.</p><button class="pri" data-p="endnow">End workout</button><button data-p="keep">Keep editing</button></div></div>';
    S.root.innerHTML = h;
    if (window.WBMedia) WBMedia.bind(S.root);
    var car = S.root.querySelector('.pl-car'), cu = car.querySelector('.cur');
    if (cu) car.scrollTop += cu.getBoundingClientRect().top - car.getBoundingClientRect().top - 24; // keep current in view
    tick(true);
  }
  function eventSummaryHtml(r) {
    var ex = S.w.items.filter(function (x) { return x.id === r.exerciseId; })[0];
    var laps = r.laps ? r.laps.length : 0;
    var evs = (ex && ex.modeConfig && ex.modeConfig.events || []).filter(function (ev) { return ev.lap <= laps; });
    if (!evs.length) return '';
    return '<div class="pl-events sm">' + evs.map(function (ev) {
      var mark = r.eventResults && r.eventResults[ev.lap];
      var pf = mark === 'pass' ? 'Pass' : mark === 'fail' ? 'Fail' : '';
      return '<div class="pl-ev"><span>Lap ' + ev.lap + ' \u201c' + esc(ev.name) + '\u201d' + (pf ? ' ' + pf : '') + '</span></div>';
    }).join('') + '</div>';
  }
  function eventRowsHtml(ex, r, si) {
    var laps = r.laps ? r.laps.length : 0;
    var evs = (ex.modeConfig && ex.modeConfig.events || []).filter(function (ev) { return ev.lap <= laps; });
    if (!evs.length) return '';
    return '<div class="pl-events">' + evs.map(function (ev) {
      var mark = r.eventResults && r.eventResults[ev.lap];
      function btn(kind, label) {
        return '<button type="button" data-pf="' + kind + '" data-lap="' + ev.lap + '" data-si="' + si + '"' + (mark === kind ? ' class="on"' : '') + '>' + label + '</button>';
      }
      return '<div class="pl-ev"><span>Lap ' + ev.lap + ' \u201c' + esc(ev.name) + '\u201d</span><div class="pl-pf">' + btn('pass', 'Pass') + btn('fail', 'Fail') + '</div></div>';
    }).join('') + '</div>';
  }
  function hint(ex) {
    var l = primaryLabel(ex);
    if (S.phase === 'rest') return 'Tap to Skip';
    if (res(S.idx).logged && (S.phase === 'ready' || (S.phase === 'work' && !S.running && ex.mode === 'reps'))) return 'Logged · tap to redo';
    if (ex.mode === 'reps' && S.queue[S.idx].groupId && !isFinalInRound(S.idx) && (S.phase === 'work' || S.phase === 'ready') && !S.running)
      return 'Tap for next'; // no rest on non-final SS member
    if (ex.mode === 'timer' && S.phase === 'work') return effectiveRest(S.idx) > 0 ? 'Tap to rest' : 'Tap for next';
    return S.running ? '' : 'Tap to ' + l.charAt(0).toLowerCase() + l.slice(1);
  }
  function flash(icon) {
    var sc = S.root.querySelector('.pl-screen'); if (!sc) return;
    var f = document.createElement('div'); f.className = 'pl-flash'; f.textContent = icon; sc.appendChild(f);
    setTimeout(function () { f.remove(); }, 700);
  }
  function readout() {
    var d = phaseDur(), el = elapsed(), ex = exOf(S.idx);
    if (ex.mode === 'stopwatch') return M.formatStopwatch(el); // hundredths stay on the stopwatch only
    if (d == null && S.phase === 'ready' && (ex.mode === 'intervals' || ex.mode === 'timer')) return M.fmtTime(ex.modeConfig.workSec);
    // Count-up holds and finished screens use the countdown shape. Logging still uses the elapsed milliseconds.
    if (d == null) return M.fmtTime(Math.floor(Math.max(0, el) / 1000));
    return M.fmtTime(Math.ceil(Math.max(0, d - el) / 1000));
  }
  function tick(once) {
    if (!S || S.done) return;
    var d = phaseDur();
    if (S.running && d != null && elapsed() >= d) {
      playDueTones(); // go / done on the same frame the next timer appears
      cueRestEnd(); // double beep at zero when the schedule does not already play one
      var over = elapsed() - d; S.running = false; phaseEnd(over);
    } else {
      var ro = document.getElementById('ro'), pg = document.getElementById('pg'), veil = document.getElementById('rest-veil');
      if (ro) ro.textContent = readout();
      if (pg) pg.style.width = (d ? Math.min(100, elapsed() / d * 100) : 0) + '%';
      // Same clock as the rest countdown: full cover at the start, gone at zero, frozen while paused.
      if (veil) veil.style.width = (d ? Math.max(0, 1 - Math.min(1, elapsed() / d)) * 100 : 0) + '%';
      playDueTones(); // countdown ticks share this frame's visible second
      cueRestTicks();
    }
    if (!once && S && !S.done) S.raf = requestAnimationFrame(function () { tick(); });
  }

  // ---------- events ----------
  function onClick(e) {
    var b = e.target.closest('button,[data-p]'); if (!b || b.disabled) return;
    if (b.dataset.pf) { // stopwatch event pass/fail — does not touch the clock or lap times
      var si = b.dataset.si != null ? +b.dataset.si : S.idx, rr = res(si);
      rr.eventResults = rr.eventResults || {};
      rr.eventResults[+b.dataset.lap] = b.dataset.pf;
      var box = b.parentNode;
      Array.prototype.forEach.call(box.querySelectorAll('button'), function (btn) { btn.classList.toggle('on', btn === b); });
      return;
    }
    if (b.dataset.notes != null) { // workout-list notes only — does not move the workout
      var nk = b.dataset.notes;
      S.notesOpen = S.notesOpen || {};
      S.notesOpen[nk] = !S.notesOpen[nk];
      return render();
    }
    if (b.dataset.sel) return select(+b.dataset.sel);
    if (b.dataset.st) { var f = b.dataset.st, si = b.dataset.si != null ? +b.dataset.si : S.idx, r = res(si); r[f] = Math.max(0, Math.round(((+r[f] || 0) + +b.dataset.d) * 10) / 10); var inp = S.root.querySelector('[data-f="' + f + '"]' + (b.dataset.si != null ? '[data-si="' + si + '"]' : '')); if (inp) inp.value = r[f]; return; }
    var a = b.dataset.p;
      if (a === 'primary') {
      var was = S.running;
      primary();
      if (S) {
        var done = S.flashDone; S.flashDone = false;
        var quiet = S.noFlash; S.noFlash = false;
        if (!S.done && !quiet) flash(done ? '✓' : S.running && !was ? '▶' : !S.running && was ? '❚❚' : '✓');
      }
    }
    else if (a === 'pause') { ensureAudio(); togglePause(); }
    else if (a === 'skip') advance();
    else if (a === 'back') enterStep(S.idx - 1);
    else if (a === 'end') api.requestEnd();
    else if (a === 'endnow') finish();
    else if (a === 'keep') { S.prompt = false; render(); }
    else if (a === 'exit') S.onExit();
  }
  function onInput(e) { var f = e.target.dataset.f; if (!f) return; var si = e.target.dataset.si != null ? +e.target.dataset.si : S.idx, v = M.num(e.target.value); res(si)[f] = v === null || isNaN(v) ? null : Math.max(0, v); }

  var api = {
    mount: function (root, w, data, persist, onExit) {
      S = { root: root, w: w, data: data, persist: persist, onExit: onExit, queue: M.buildPlayQueue(w), results: {}, startedAt: Date.now(), acc: 0, running: false, nodes: [] };
      document.body.classList.add('playing');
      root.onclick = onClick; root.oninput = onInput; root.onchange = onInput;
      document.addEventListener('visibilitychange', onVis);
      enterStep(0); tick();
      window.__wbPlayer = S; // for tests / debugging
    },
    toneSchedule: toneSchedule,
    step: function () { if (S) tick(true); },
    selectStep: function (i) { if (S && i >= 0 && i < S.queue.length) select(i); },
    unmount: function () { if (!S) return; stopTones(); cancelAnimationFrame(S.raf); S.running = false; document.removeEventListener('visibilitychange', onVis); if (wake) wake.release().catch(function () {}); S = null; },
    requestEnd: function () {
      if (!S) return; if (S.done) return S.onExit();
      if (confirm('End workout? Logged sets will be saved.')) finish();
    }
  };
  window.WBPlayer = api;
})();
