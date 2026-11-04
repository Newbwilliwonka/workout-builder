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
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.start(t); o.stop(t + 0.18);
    });
    S && (S.beeps = (S.beeps || 0) + 1);
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
    if (ex.mode === 'intervals') return M.fmtTime(c.workSec) + ' work · ' + M.repsText(c);
    if (ex.mode === 'timer') return M.fmtTime(c.workSec) + ' work · ' + M.fmtTime(c.restSec) + ' rest · ' + M.repsText(c);
    return c.lapsEnabled ? c.lapCount + (c.lapCount === 1 ? ' lap' : ' laps') : 'Stopwatch';
  }
  function weightTxt(ex) { return ex.weight.unit === 'bodyweight' ? 'Bodyweight' : ex.weight.value != null ? ex.weight.value + ' ' + ex.weight.unit : ex.weight.unit; }

  // ---------- state machine ----------
  // phase: ready | work | rest | complete ; countdown phases have a duration, count-up phases don't
  function phaseDur() {
    var ex = exOf(S.idx), c = ex.modeConfig;
    if (S.phase === 'rest') return (ex.mode === 'timer' ? c.restSec : c.restSec || 0) * 1000;
    if (S.phase === 'work' && (ex.mode === 'intervals' || ex.mode === 'timer')) return c.workSec * 1000;
    return null;
  }
  function enterStep(i) {
    S.idx = i; S.running = false; S.acc = 0; S.rep = 1;
    var ex = exOf(i);
    S.phase = ex.mode === 'reps' && ex.modeConfig.repsType !== 'static' ? 'work' : 'ready';
    res(i); render();
  }
  function startTimer(phase) { S.phase = phase; S.acc = 0; S.t0 = now(); S.running = true; lockScreen(); }
  function log(i) { var r = res(i); r.logged = true; r.at = Date.now(); }
  function startRest() {
    var c = cfg(S.idx);
    if (c.restSec > 0 && S.idx < S.queue.length - 1) { startTimer('rest'); render(); } else advance();
  }
  function advance() { if (S.idx < S.queue.length - 1) enterStep(S.idx + 1); else finish(); }
  function togglePause() {
    if (!(S.phase === 'work' || S.phase === 'rest') || (S.phase === 'work' && exOf(S.idx).mode === 'reps' && cfg(S.idx).repsType !== 'static')) return;
    if (S.running) { S.acc += now() - S.t0; S.running = false; } else { S.t0 = now(); S.running = true; }
    render();
  }
  function primary() {
    ensureAudio();
    var ex = exOf(S.idx), c = ex.modeConfig, r = res(S.idx);
    if (S.phase === 'rest') return advance();                    // skip rest
    if (S.phase === 'complete') return advance();
    if (ex.mode === 'reps') {
      if (c.repsType === 'static' && S.phase === 'ready') { startTimer('work'); return render(); }
      if (c.repsType === 'static') { r.holdSec = Math.round(elapsed() / 1000); S.running = false; }
      log(S.idx); return startRest();
    }
    if (S.phase === 'ready') {
      if (ex.mode === 'stopwatch') { r.laps = []; r.durationMs = 0; }
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
    togglePause(); // intervals / timer: primary acts as pause/resume while running
  }
  function phaseEnd(over) {
    var ex = exOf(S.idx), c = ex.modeConfig, r = res(S.idx);
    beep();
    if (S.phase === 'rest') return advance();
    if (ex.mode === 'intervals') {
      log(S.idx); return advance();
    }
    if (ex.mode === 'timer') {
      log(S.idx);
      if (c.restSec > 0 && S.idx < S.queue.length - 1) { startTimer('rest'); S.acc = over; return render(); }
      return advance();
    }
  }
  function select(i) { if (i === S.idx) return; enterStep(i); }

  function finish() {
    S.running = false; cancelAnimationFrame(S.raf);
    var logged = Object.keys(S.results).map(function (k) { return S.results[k]; }).filter(function (r) { return r.logged; }).sort(function (a, b) { return a.step - b.step; });
    var sess = { id: M.uid('ses'), workoutId: S.w.id, workoutName: S.w.name, startedAt: S.startedAt, endedAt: Date.now(), results: logged };
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
  function renderSummary() {
    var s = S.done, mins = Math.round((s.endedAt - s.startedAt) / 1000);
    var h = '<div class="pl-done"><div class="pl-check">✓</div><h2>Workout complete</h2><p class="mute">' + esc(s.workoutName) + ' · ' + M.fmtTime(mins) + ' total · ' +
      s.results.length + ' of ' + S.queue.length + ' sets logged</p><div class="card pl-sum">';
    if (!S.saved) h += '<p class="mute">' + (s.results.length ? 'Session not saved (history is off for now).' : 'Nothing was logged.') + '</p>';
    s.results.forEach(function (r) {
      h += '<div class="pl-row"><div class="grow"><b>' + esc(r.name) + '</b> <span class="mute">set ' + r.set + '/' + r.of + '</span><div class="mute">' + esc(resultLine(r)) + '</div>' +
        (r.laps && r.laps.length ? '<div class="pl-laps sm">' + r.laps.map(function (l, k) { return '<span>L' + (k + 1) + ' ' + M.formatStopwatch(l.lapMs) + '</span>'; }).join('') + '</div>' : '') + '</div></div>';
    });
    h += '</div><button class="pri" style="width:100%" data-p="exit">Done</button></div>';
    S.root.innerHTML = h;
  }

  // ---------- rendering ----------
  function letters() { var m = {}, n = 0; M.blocks(S.w).forEach(function (b) { if (b.groupId) m[b.groupId] = String.fromCharCode(65 + n++ % 26); }); return m; }
  function stepper(f, label, val, step) {
    return '<div class="pl-f"><span>' + label + '</span><div class="pl-step"><button data-st="' + f + '" data-d="-' + step + '" aria-label="Decrease ' + label + '">−</button>' +
      '<input type="number" inputmode="decimal" min="0" data-f="' + f + '" value="' + (val == null ? '' : val) + '"><button data-st="' + f + '" data-d="' + step + '" aria-label="Increase ' + label + '">+</button></div></div>';
  }
  function primaryLabel(ex) {
    var c = ex.modeConfig;
    if (S.phase === 'rest') return 'Skip rest';
    if (S.phase === 'complete') return S.idx < S.queue.length - 1 ? 'Next exercise' : 'Finish workout';
    if (ex.mode === 'reps') return c.repsType === 'static' && S.phase === 'ready' ? 'Start hold' : 'Log set';
    if (S.phase === 'ready') return 'Start';
    if (ex.mode === 'stopwatch') return !S.running ? 'Resume' : c.lapsEnabled ? 'Lap ' + (res(S.idx).laps.length + 1) + ' / ' + c.lapCount : 'Finish';
    return S.running ? 'Pause' : 'Resume';
  }
  function render() {
    var i = S.idx, st = S.queue[i], ex = exOf(i), c = ex.modeConfig, r = res(i), L = letters();
    var chip = S.phase === 'rest' ? 'Rest' : S.phase === 'complete' ? 'Set complete' : S.phase === 'work' && ex.mode !== 'reps' ? 'Work' : S.phase === 'ready' ? 'Ready' : 'Set ' + st.set;
    var showRO = S.phase === 'rest' || !(ex.mode === 'reps' && c.repsType !== 'static');
    var h = '<div class="pl">';
    // stage: visual screen + side carousel
    h += '<div class="pl-stage"><div class="pl-screen ' + (S.phase === 'rest' ? 'is-rest' : '') + '">' +
      '<div class="pl-media" aria-hidden="true"><svg viewBox="0 0 24 24" width="34" height="34"><path fill="currentColor" d="M8 5v14l11-7z"/></svg><span>Exercise media coming soon</span></div>' +
      '<div class="pl-top"><span class="pl-chip">' + chip + '</span>' + (st.groupId ? '<span class="pl-chip ss">Superset ' + L[st.groupId] + '</span>' : '') + '</div>' +
      (showRO ? '<div class="pl-ro" id="ro">' + readout() + '</div>' : '<div class="pl-ro pl-target">' + esc(ex.modeConfig.repsType === 'range' ? c.min + '–' + c.max : c.count) + '<small>reps</small></div>') +
      '<div class="pl-info">' + (S.phase === 'rest' && i < S.queue.length - 1 ? '<div class="pl-next">Up next · ' + esc(exOf(i + 1).name) + '</div>' : '') +
      '<div class="pl-name">' + esc(ex.name) + '</div><div class="pl-meta"><span>' + esc(weightTxt(ex)) + '</span><span>' + (ex.mode === 'intervals' ? 'Interval ' : 'Set ') + st.set + ' of ' + st.of + '</span><span>' + esc(target(ex)) + '</span></div></div>' +
      '<div class="pl-bar"><i id="pg"></i></div></div>';
    h += '<div class="pl-car" aria-label="Up next"><div class="pl-car-h">Next</div>';
    for (var j = i + 1; j < S.queue.length; j++) {
      var q = S.queue[j], e2 = exOf(j);
      h += '<button class="pl-ci" data-sel="' + j + '">' + (q.groupId ? '<em>' + L[q.groupId] + '</em>' : '') + '<b>' + esc(e2.name) + '</b><span>Set ' + q.set + '/' + q.of + '</span></button>';
    }
    if (i === S.queue.length - 1) h += '<div class="pl-ci end">Last set</div>';
    h += '</div></div>';
    // tracking bar
    h += '<div class="pl-track"><div class="pl-th"><span><b>' + esc(ex.name) + '</b> · ' + (ex.mode === 'intervals' ? 'Interval ' : 'Set ') + st.set + '/' + st.of + '</span>' + (r.logged ? '<span class="pl-ok">✓ Logged</span>' : '<span class="mute">Tracking</span>') + '</div><div class="pl-fields">';
    if (r.reps !== undefined) h += stepper('reps', 'Reps', r.reps, 1);
    if (r.holdSec !== undefined) h += stepper('holdSec', 'Hold (s)', r.holdSec, 5);
    if (r.rounds !== undefined) h += stepper('rounds', 'Rounds', r.rounds, 1);
    if (r.workSec !== undefined) h += stepper('workSec', 'Work (s)', r.workSec, 5);
    if (r.unit !== 'bodyweight') h += stepper('weight', 'Weight (' + r.unit + ')', r.weight, r.unit === 'kg' ? 2.5 : 5);
    else h += '<div class="pl-f"><span>Weight</span><div class="pl-bw">Bodyweight</div></div>';
    h += '</div>';
    if (r.laps && r.laps.length) h += '<div class="pl-laps">' + r.laps.map(function (l, k) { return '<span><b>Lap ' + (k + 1) + '</b> ' + M.formatStopwatch(l.lapMs) + ' <i>' + M.formatStopwatch(l.totalMs) + '</i></span>'; }).join('') + '</div>';
    h += '<button class="pl-go ' + (S.phase === 'rest' ? 'alt' : '') + '" data-p="primary">' + primaryLabel(ex) + '</button></div>';
    // controls
    var canPause = (S.phase === 'work' || S.phase === 'rest') && showRO;
    h += '<div class="pl-ctl"><button data-p="back"' + (i === 0 ? ' disabled' : '') + ' aria-label="Previous">⏮&#xFE0E;<small>Back</small></button>' +
      '<button data-p="pause"' + (canPause ? '' : ' disabled') + '>' + (S.running ? '❚❚' : '▶') + '<small>' + (S.running ? 'Pause' : 'Resume') + '</small></button>' +
      '<button data-p="skip" aria-label="Skip">⏭&#xFE0E;<small>Skip</small></button><button data-p="end" class="end">■<small>End</small></button></div>';
    // summary list
    var done = {}; Object.keys(S.results).forEach(function (k) { var x = S.results[k]; if (x.logged) done[x.exerciseId] = (done[x.exerciseId] || 0) + 1; });
    h += '<div class="pl-list"><div class="pl-car-h">Workout</div>';
    S.w.items.forEach(function (it) {
      var cur = it.id === ex.id, n = done[it.id] || 0;
      h += '<button class="pl-li' + (cur ? ' cur' : '') + (n >= it.sets ? ' fin' : '') + '" data-ex="' + it.id + '">' + (it.groupId ? '<em>' + L[it.groupId] + '</em>' : '<em class="o"></em>') +
        '<span class="grow"><b>' + esc(it.name) + '</b><small>' + esc(target(it)) + '</small></span><span class="pl-cnt">' + n + '/' + it.sets + '</span></button>';
    });
    h += '</div></div>';
    S.root.innerHTML = h;
    S.root.querySelector('.pl-car').scrollTop = 0;
    tick(true);
  }
  function readout() {
    var d = phaseDur(), el = elapsed();
    return d != null ? M.fmtTime(Math.ceil(Math.max(0, d - el) / 1000)) : M.formatStopwatch(el);
  }
  function tick(once) {
    if (!S || S.done) return;
    var d = phaseDur();
    if (S.running && d != null && elapsed() >= d) { var over = elapsed() - d; S.running = false; phaseEnd(over); }
    var ro = document.getElementById('ro'), pg = document.getElementById('pg');
    if (ro) ro.textContent = readout();
    if (pg) pg.style.width = (d ? Math.min(100, elapsed() / d * 100) : 0) + '%';
    if (!once) S.raf = requestAnimationFrame(function () { tick(); });
  }

  // ---------- events ----------
  function onClick(e) {
    var b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.dataset.sel) return select(+b.dataset.sel);
    if (b.dataset.ex) { // first unlogged set of that exercise, else its first set
      var id = b.dataset.ex, first = -1, open = -1;
      S.queue.forEach(function (q, k) { if (q.exerciseId === id) { if (first < 0) first = k; if (open < 0 && !(S.results[k] && S.results[k].logged)) open = k; } });
      return select(open >= 0 ? open : first);
    }
    if (b.dataset.st) { var f = b.dataset.st, r = res(S.idx); r[f] = Math.max(0, Math.round(((+r[f] || 0) + +b.dataset.d) * 10) / 10); var inp = S.root.querySelector('[data-f="' + f + '"]'); if (inp) inp.value = r[f]; return; }
    var a = b.dataset.p;
    if (a === 'primary') primary();
    else if (a === 'pause') { ensureAudio(); togglePause(); }
    else if (a === 'skip') advance();
    else if (a === 'back') enterStep(S.idx - 1);
    else if (a === 'end') api.requestEnd();
    else if (a === 'exit') S.onExit();
  }
  function onInput(e) { var f = e.target.dataset.f; if (!f) return; var v = M.num(e.target.value); res(S.idx)[f] = v === null || isNaN(v) ? null : Math.max(0, v); }

  var api = {
    mount: function (root, w, data, persist, onExit) {
      S = { root: root, w: w, data: data, persist: persist, onExit: onExit, queue: M.buildPlayQueue(w), results: {}, startedAt: Date.now(), acc: 0, running: false };
      document.body.classList.add('playing');
      root.onclick = onClick; root.oninput = onInput; root.onchange = onInput;
      document.addEventListener('visibilitychange', onVis);
      enterStep(0); tick();
      window.__wbPlayer = S; // for tests / debugging
    },
    unmount: function () { if (!S) return; cancelAnimationFrame(S.raf); S.running = false; document.removeEventListener('visibilitychange', onVis); if (wake) wake.release().catch(function () {}); S = null; },
    requestEnd: function () {
      if (!S) return; if (S.done) return S.onExit();
      if (confirm('End workout? Logged sets will be saved.')) finish();
    }
  };
  window.WBPlayer = api;
})();
