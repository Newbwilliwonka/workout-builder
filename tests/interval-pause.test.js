// Interval and Timer pause: Skip / Resume, and logging time already done.
// node tests/interval-pause.test.js [url]
const assert = require('assert');
const fs = require('fs');
const M = require('../model.js');
const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const SHOT = '/opt/cursor/artifacts';
fs.mkdirSync(SHOT, { recursive: true });

const mk = o => M.normalizeExercise(M.newExercise(o));
function workout(name, items) {
  const w = M.newWorkout(name);
  w.items = items;
  return w;
}

(async () => {
  const b = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await require('./allow.js')(p);
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const click = async s => { await p.click(s); await wait(80); };

  async function boot(w) {
    const data = M.emptyData();
    data.workouts = [w];
    await p.goto(URL);
    await p.evaluate((k, v) => localStorage.setItem(k, v), M.STORAGE_KEY, JSON.stringify(data));
    await p.goto(URL + '#/play/' + w.id);
    await p.reload();
    await p.waitForSelector('.pl-endw');
    await p.evaluate(() => { window.__wbClockOffset = 0; });
    await wait(40);
  }

  // Freeze the player clock. workMs is how far into the current phase to land, after closing a 5s standoff.
  async function freezeIntoWork(workMs) {
    return p.evaluate(workMs => {
      const orig = performance.now.bind(performance);
      const offset = window.__wbClockOffset || 0;
      window.__wbFreeze = { orig: orig, offset: offset, now: orig() };
      performance.now = function () { return window.__wbFreeze.now; };
      const started = window.__wbPlayer.t0;
      window.__wbFreeze.now = started + 5000 - offset;
      WBPlayer.step();
      window.__wbFreeze.now = window.__wbPlayer.t0 + workMs - offset;
      WBPlayer.step();
      const S = window.__wbPlayer;
      return { phase: S.phase, running: S.running, ro: document.getElementById('ro').textContent };
    }, workMs);
  }

  function snap() {
    return p.evaluate(() => {
      const S = window.__wbPlayer;
      const buttons = [...document.querySelectorAll('.pl-paused button')].map(e => ({
        label: e.getAttribute('aria-label'),
        text: (e.innerText || '').trim()
      }));
      const resume = document.querySelector('.pl-resume');
      const skip = document.querySelector('.pl-skip');
      const screen = document.querySelector('.pl-screen');
      const info = document.querySelector('.pl-info');
      const clock = document.getElementById('ro');
      let place = null;
      if (resume && skip && screen && info && clock) {
        const a = resume.getBoundingClientRect();
        const c = skip.getBoundingClientRect();
        const sc = screen.getBoundingClientRect();
        const inf = info.getBoundingClientRect();
        const ck = clock.getBoundingClientRect();
        place = {
          inMedia: !!(resume.closest('.pl-screen') && skip.closest('.pl-screen')),
          aboveCard: a.bottom <= inf.top + 1 && c.bottom <= inf.top + 1,
          insideScreen: a.top >= sc.top && c.bottom <= sc.bottom + 1 && a.left >= sc.left && c.right <= sc.right + 1,
          clearOfClock: a.top >= ck.bottom - 1 && c.top >= ck.bottom - 1
        };
      }
      return {
        idx: S.idx,
        phase: S.phase,
        running: S.running,
        ro: document.getElementById('ro') && document.getElementById('ro').textContent,
        hint: document.querySelector('.pl-hint') ? document.querySelector('.pl-hint').textContent : null,
        name: document.querySelector('.pl-info .pl-name') && document.querySelector('.pl-info .pl-name').textContent,
        buttons: buttons,
        place: place,
        run: !!S.run,
        pending: (S.pending || []).length,
        nodes: (S.nodes || []).length,
        results: S.results,
        done: S.done && S.done.results,
        sessions: S.data.sessions.length,
        track: S.track,
        previewExit: window.__wbPreviewExit || 0
      };
    });
  }

  const intervals = workout('Intervals', [
    mk({ name: 'Bike sprints', sets: 2, weight: { unit: 'bodyweight', value: null }, mode: 'intervals', modeConfig: { workSec: 20, repsType: 'number', count: 15 } }),
    mk({ name: 'Jump rope', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'intervals', modeConfig: { workSec: 10, repsType: null } })
  ]);

  // Standoff pause stays tap-to-resume. No Skip / Resume symbols.
  await boot(intervals);
  await click('[data-p=primary]');
  await p.evaluate(() => {
    const orig = performance.now.bind(performance);
    const offset = window.__wbClockOffset || 0;
    window.__wbFreeze = { orig: orig, offset: offset, now: orig() };
    performance.now = function () { return window.__wbFreeze.now; };
    window.__wbFreeze.now = window.__wbPlayer.t0 + 2000 - offset;
    WBPlayer.step();
    document.querySelector('[data-p=primary]').click();
  });
  let s = await snap();
  assert.strictEqual(s.phase, 'standoff');
  assert.strictEqual(s.running, false);
  assert.strictEqual(s.hint, 'Tap to resume');
  assert.deepStrictEqual(s.buttons, []);
  assert.strictEqual(s.results[0].logged, false);
  await p.evaluate(() => { document.querySelector('[data-p=primary]').click(); });
  s = await snap();
  assert.strictEqual(s.phase, 'standoff');
  assert.strictEqual(s.running, true);
  assert.deepStrictEqual(s.buttons, []);

  // Into the interval, then pause. Skip and Resume are symbols inside the media window.
  const posed = await p.evaluate(() => {
    const offset = window.__wbFreeze.offset;
    window.__wbFreeze.now = window.__wbPlayer.t0 + 3000 - offset;
    WBPlayer.step();
    window.__wbFreeze.now = window.__wbPlayer.t0 + 8000 - offset;
    WBPlayer.step();
    document.querySelector('[data-p=primary]').click();
    return document.getElementById('ro').textContent;
  });
  assert.strictEqual(posed, '0:12');
  s = await snap();
  assert.strictEqual(s.phase, 'work');
  assert.strictEqual(s.running, false);
  assert.strictEqual(s.hint, '');
  assert.deepStrictEqual(s.buttons, [
    { label: 'Resume', text: '' },
    { label: 'Skip', text: '' }
  ]);
  assert.deepStrictEqual(s.place, {
    inMedia: true, aboveCard: true, insideScreen: true, clearOfClock: true
  });
  assert.strictEqual(s.results[0].logged, false);
  assert.strictEqual(s.results[0].workSec, 20);
  assert.strictEqual(s.results[0].reps, 15);
  const seen = await p.evaluate(() => {
    const skip = document.querySelector('.pl-skip').getBoundingClientRect();
    const clock = document.getElementById('ro').getBoundingClientRect();
    return skip.top < window.innerHeight && clock.top >= 0 && clock.bottom < skip.top;
  });
  assert.strictEqual(seen, true);
  await p.screenshot({ path: SHOT + '/interval-paused-skip-resume.png' });

  // Resume continues this interval. The planned set is not logged.
  await click('.pl-resume');
  const resumed = await p.evaluate(() => {
    const offset = window.__wbFreeze.offset;
    window.__wbFreeze.now = window.__wbPlayer.t0 + 5000 - offset;
    WBPlayer.step();
    const S = window.__wbPlayer;
    return {
      phase: S.phase,
      running: S.running,
      idx: S.idx,
      ro: document.getElementById('ro').textContent,
      logged: !!S.results[0].logged,
      work: S.results[0].workSec,
      reps: S.results[0].reps,
      buttons: document.querySelectorAll('.pl-paused button').length,
      pending: (S.pending || []).length
    };
  });
  assert.strictEqual(resumed.phase, 'work');
  assert.strictEqual(resumed.running, true);
  assert.strictEqual(resumed.idx, 0);
  assert.strictEqual(resumed.ro, '0:07');
  assert.strictEqual(resumed.logged, false);
  assert.strictEqual(resumed.work, 20);
  assert.strictEqual(resumed.reps, 15);
  assert.strictEqual(resumed.buttons, 0);
  assert.ok(resumed.pending > 0);

  // Pause again and Skip: log 13s, keep the planned reps, and start the next interval.
  await p.evaluate(() => { document.querySelector('[data-p=primary]').click(); });
  await click('.pl-skip');
  s = await snap();
  assert.strictEqual(s.idx, 1);
  assert.strictEqual(s.phase, 'work');
  assert.strictEqual(s.running, true);
  assert.strictEqual(s.name, 'Bike sprints');
  assert.strictEqual(s.results[0].logged, true);
  assert.strictEqual(s.results[0].workSec, 13);
  assert.strictEqual(s.results[0].reps, 15);
  assert.strictEqual(s.results[1].logged, false);
  assert.strictEqual(s.results[1].reps, 15);
  assert.strictEqual(s.run, true);
  assert.ok(s.pending > 0);
  assert.deepStrictEqual(s.buttons, []);

  // Last interval of the exercise: Skip logs it and moves to the next exercise, tones cleared.
  await p.evaluate(() => {
    const offset = window.__wbFreeze.offset;
    window.__wbFreeze.now = window.__wbPlayer.t0 + 4000 - offset;
    WBPlayer.step();
    document.querySelector('[data-p=primary]').click();
  });
  await click('.pl-skip');
  s = await snap();
  assert.strictEqual(s.idx, 2);
  assert.strictEqual(s.phase, 'ready');
  assert.strictEqual(s.name, 'Jump rope');
  assert.strictEqual(s.results[1].logged, true);
  assert.strictEqual(s.results[1].workSec, 4);
  assert.strictEqual(s.results[1].reps, 15);
  assert.strictEqual(!!(s.results[2] && s.results[2].logged), false);
  assert.strictEqual(s.run, false);
  assert.strictEqual(s.nodes, 0);

  // Ready set, never started: navigating away leaves it unlogged.
  await click('[data-sel="0"]');
  s = await snap();
  assert.strictEqual(s.idx, 0);
  assert.strictEqual(s.phase, 'ready');
  await click('[data-sel="2"]');
  s = await snap();
  assert.strictEqual(s.name, 'Jump rope');
  assert.strictEqual(s.results[2].logged, false);
  assert.strictEqual(s.results[2].workSec, 10);

  // Standoff is not work. Leaving it logs nothing.
  await click('[data-p=primary]');
  s = await snap();
  assert.strictEqual(s.phase, 'standoff');
  await click('[data-sel="0"]');
  s = await snap();
  assert.strictEqual(!!(s.results[2] && s.results[2].logged), false);

  // Ending mid-interval, paused, logs the seconds done and the planned reps.
  await boot(intervals);
  await click('[data-p=primary]');
  const mid = await freezeIntoWork(9000);
  assert.strictEqual(mid.phase, 'work');
  await p.evaluate(() => { document.querySelector('[data-p=primary]').click(); });
  await click('.pl-endw');
  s = await snap();
  assert.strictEqual(s.done.length, 1);
  assert.strictEqual(s.done[0].name, 'Bike sprints');
  assert.strictEqual(s.done[0].set, 1);
  assert.strictEqual(s.done[0].workSec, 9);
  assert.strictEqual(s.done[0].reps, 15);
  assert.strictEqual(s.done[0].logged, true);
  assert.strictEqual(s.sessions, 1);

  // Not-started workout end: ready screen logs nothing.
  await boot(intervals);
  await click('.pl-endw');
  s = await snap();
  assert.deepStrictEqual(s.done, []);
  assert.strictEqual(s.sessions, 0);

  // Navigating away mid-interval, still running, logs elapsed seconds.
  const leave = workout('Leave', [
    mk({ name: 'Bike sprints', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'intervals', modeConfig: { workSec: 20, repsType: 'number', count: 12 } }),
    mk({ name: 'Squat', sets: 1, weight: { unit: 'lb', value: 45 }, mode: 'reps', modeConfig: { repsType: 'number', count: 5, restSec: 20 } })
  ]);
  await boot(leave);
  await click('[data-p=primary]');
  const runningLeave = await freezeIntoWork(6000);
  assert.strictEqual(runningLeave.phase, 'work');
  assert.strictEqual(runningLeave.running, true);
  await click('[data-sel="1"]');
  s = await snap();
  assert.strictEqual(s.name, 'Squat');
  assert.strictEqual(s.results[0].logged, true);
  assert.strictEqual(s.results[0].workSec, 6);
  assert.strictEqual(s.results[0].reps, 12);
  assert.strictEqual(!!(s.results[1] && s.results[1].logged), false);
  assert.strictEqual(s.run, false);

  // Timer keeps today's tap. No Skip or Resume, including if the hold is paused. A tap still ends the work.
  const timed = workout('Timer', [
    mk({ name: 'Wall sit', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'timer', modeConfig: { workSec: 30, restSec: 10, repsType: 'number', count: 8 } }),
    mk({ name: 'Row', sets: 1, weight: { unit: 'lb', value: 25 }, mode: 'reps', modeConfig: { repsType: 'number', count: 6, restSec: 15 } })
  ]);
  await boot(timed);
  await click('[data-p=primary]');
  await p.evaluate(() => { document.querySelector('[data-p=primary]').click(); });
  s = await snap();
  assert.strictEqual(s.phase, 'standoff');
  assert.strictEqual(s.running, false);
  assert.strictEqual(s.hint, 'Tap to resume');
  assert.deepStrictEqual(s.buttons, []);
  await boot(timed);
  await click('[data-p=primary]');
  const timerWork = await freezeIntoWork(11000);
  assert.strictEqual(timerWork.phase, 'work');
  assert.strictEqual(timerWork.ro, '0:19');
  s = await snap();
  assert.deepStrictEqual(s.buttons, []);
  assert.strictEqual(s.hint, 'Tap to rest');
  await p.evaluate(() => {
    const hold = document.createElement('button');
    hold.dataset.p = 'pause';
    document.getElementById('app').appendChild(hold);
    hold.click();
  });
  s = await snap();
  assert.strictEqual(s.running, false);
  assert.strictEqual(s.phase, 'work');
  assert.deepStrictEqual(s.buttons, []);
  assert.strictEqual(s.hint, 'Tap to rest');
  await click('[data-p=primary]');
  s = await snap();
  assert.strictEqual(s.phase, 'rest');
  assert.strictEqual(s.ro, '0:10');
  assert.strictEqual(s.running, true);
  assert.strictEqual(s.results[0].logged, true);
  assert.strictEqual(s.results[0].workSec, 11);
  assert.strictEqual(s.results[0].reps, 8);
  assert.strictEqual(s.name, 'Row');

  // Timer is unchanged: leaving or ending mid-work drops the set. The planned time stays, and nothing is logged.
  await boot(timed);
  await click('[data-p=primary]');
  await freezeIntoWork(7000);
  await click('[data-sel="1"]');
  s = await snap();
  assert.strictEqual(s.results[0].logged, false);
  assert.strictEqual(s.results[0].workSec, 30);
  assert.strictEqual(s.results[0].reps, 8);
  assert.strictEqual(s.results[1].logged, false);
  await boot(timed);
  await click('[data-p=primary]');
  await freezeIntoWork(4000);
  await click('.pl-endw');
  s = await snap();
  assert.deepStrictEqual(s.done, []);
  assert.strictEqual(s.sessions, 0);

  // Superset rounds still log the way they did. Navigating does not log a reps set early.
  const ss = workout('Superset', [
    mk({ name: 'Curl', sets: 2, weight: { unit: 'lb', value: 30 }, mode: 'reps', modeConfig: { repsType: 'number', count: 10, restSec: 45 } }),
    mk({ name: 'Press', sets: 2, weight: { unit: 'lb', value: 40 }, mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 20 } })
  ]);
  M.linkSuperset(ss, [ss.items[0].id, ss.items[1].id]);
  await boot(ss);
  await click('[data-sel="1"]');
  s = await snap();
  assert.strictEqual(s.results[0].logged, false);
  assert.strictEqual(s.results[0].reps, 10);
  assert.strictEqual(s.name, 'Press');
  await click('[data-sel="0"]');
  await click('[data-p=primary]');
  s = await snap();
  assert.strictEqual(s.idx, 1);
  assert.strictEqual(s.phase, 'work');
  assert.strictEqual(s.results[0].logged, true);
  assert.strictEqual(s.results[0].reps, 10);
  assert.strictEqual(s.results[1].logged, false);
  assert.strictEqual(await p.$('.pl-screen.is-rest'), null);
  await click('.pl-endw');
  s = await snap();
  assert.strictEqual(s.done.length, 2);
  assert.deepStrictEqual(s.done.map(r => r.name + r.set + ':' + r.reps), ['Curl1:10', 'Press1:8']);

  // A superset interval left mid-work logs that set's seconds, not the partner that never started.
  const ssTime = workout('Superset interval', [
    mk({ name: 'Sprint', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'intervals', modeConfig: { workSec: 15, repsType: 'number', count: 10 } }),
    mk({ name: 'Walk back', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'reps', modeConfig: { repsType: 'number', count: 1, restSec: 0 } })
  ]);
  M.linkSuperset(ssTime, [ssTime.items[0].id, ssTime.items[1].id]);
  await boot(ssTime);
  await click('[data-p=primary]');
  await freezeIntoWork(5000);
  await click('.pl-endw');
  s = await snap();
  assert.strictEqual(s.done.length, 1);
  assert.strictEqual(s.done[0].name, 'Sprint');
  assert.strictEqual(s.done[0].workSec, 5);
  assert.strictEqual(s.done[0].reps, 10);

  // Preview runs still save nothing.
  await boot(intervals);
  const before = await p.evaluate(k => JSON.parse(localStorage.getItem(k)).sessions.length, M.STORAGE_KEY);
  await p.evaluate(() => {
    const live = window.__wbPlayer;
    const w = live.w;
    const data = live.data;
    WBPlayer.unmount();
    window.__wbPreviewExit = 0;
    const app = document.getElementById('app');
    app.innerHTML = '';
    WBPlayer.mount(app, w, data, function () {}, function () { window.__wbPreviewExit++; }, { track: false });
  });
  await click('[data-p=primary]');
  await freezeIntoWork(5000);
  await click('[data-sel="2"]');
  s = await snap();
  assert.strictEqual(s.track, false);
  assert.strictEqual(s.results[0].logged, false);
  assert.strictEqual(s.results[0].workSec, 20);
  await click('[data-sel="0"]');
  await click('[data-p=primary]');
  await p.evaluate(() => {
    const offset = window.__wbFreeze.offset;
    window.__wbFreeze.now = window.__wbPlayer.t0 + 5000 - offset;
    WBPlayer.step();
    window.__wbFreeze.now = window.__wbPlayer.t0 + 3000 - offset;
    WBPlayer.step();
    document.querySelector('[data-p=primary]').click();
  });
  s = await snap();
  assert.deepStrictEqual(s.buttons.map(x => x.label), ['Resume', 'Skip']);
  await click('.pl-skip');
  s = await snap();
  assert.strictEqual(s.results[0].logged, false);
  assert.strictEqual(s.results[0].workSec, 20);
  await click('.pl-endw');
  s = await snap();
  assert.strictEqual(s.previewExit, 1);
  assert.ok(!s.done);
  const after = await p.evaluate(k => JSON.parse(localStorage.getItem(k)).sessions.length, M.STORAGE_KEY);
  assert.strictEqual(after, before);

  assert.deepStrictEqual(errs, []);
  console.log('INTERVAL PAUSE OK');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
