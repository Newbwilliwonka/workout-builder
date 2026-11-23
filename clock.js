/* Shared audio and timing. Player and the group-circuit session both use this.
   No DOM. Browser: window.WBClock. Node: require('./clock.js'). */
(function (root) {
  'use strict';

  var audio = null;
  var wake = null;
  var STANDOFF = 5;

  function ensureAudio() {
    try {
      var Ctx = root.AudioContext || root.webkitAudioContext;
      if (!Ctx) return;
      audio = audio || new Ctx();
      if (audio.state === 'suspended') audio.resume();
    } catch (e) {}
  }
  function beep(sink) {
    var nav = root.navigator;
    if (nav && nav.vibrate) try { nav.vibrate([180, 90, 180]); } catch (e) {}
    if (!audio) return;
    [0, 0.22].forEach(function (d) {
      var o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + d;
      o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.start(t); o.stop(t + 0.18);
    });
    if (sink) sink.beeps = (sink.beeps || 0) + 1;
  }
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
  // Timer mode: back-to-back run (work -> rest -> work ...). Rest only when restSec > 0.
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
  function tone(at, f, dur, nodes) {
    if (!audio) return;
    var o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = f; o.connect(g); g.connect(audio.destination);
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(1, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.start(at); o.stop(at + dur + 0.02);
    if (nodes) nodes.push(o);
  }
  // sink: { toneLog, nodes, phase, vis, at }. The log is written before any oscillator starts.
  function fireTone(kind, sink) {
    if (sink && sink.toneLog) sink.toneLog.push({ kind: kind, vis: sink.vis, phase: sink.phase, at: sink.at });
    if (!audio) return;
    try {
      var t = audio.currentTime;
      var nodes = sink && sink.nodes;
      if (kind === 'tick') tone(t, 660, 0.12, nodes);
      else if (kind === 'go') { tone(t, 1320, 0.1, nodes); tone(t + 0.15, 1320, 0.1, nodes); }
      else { tone(t, 880, 0.15, nodes); tone(t + 0.18, 1100, 0.15, nodes); tone(t + 0.36, 1320, 0.35, nodes); }
    } catch (e) {}
  }
  function lockScreen() {
    var nav = root.navigator;
    if (nav && nav.wakeLock && !wake) {
      nav.wakeLock.request('screen').then(function (l) {
        wake = l;
        l.addEventListener('release', function () { wake = null; });
      }).catch(function () {});
    }
  }
  function unlockScreen() {
    if (wake) wake.release().catch(function () {});
  }

  var api = {
    STANDOFF: STANDOFF,
    ensureAudio: ensureAudio,
    beep: beep,
    tone: tone,
    fireTone: fireTone,
    lockScreen: lockScreen,
    unlockScreen: unlockScreen,
    toneSchedule: toneSchedule,
    timerSchedule: timerSchedule
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WBClock = api;
})(typeof window !== 'undefined' ? window : globalThis);
