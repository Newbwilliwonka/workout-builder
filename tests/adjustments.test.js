// Timer tap-to-rest, superset frame highlight, stopwatch events, timer tone sync.
// node tests/adjustments.test.js [url]
const assert = require('assert'); const M = require('../model.js'); const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const fs = require('fs');
const SHOT = '/opt/cursor/artifacts';
fs.mkdirSync(SHOT, { recursive: true });

const cleaned = M.normalizeExercise(M.newExercise({
  name: 'Shuttle', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'stopwatch',
  modeConfig: { lapsEnabled: true, lapCount: 4, events: [
    { lap: 5, name: 'too far' }, { lap: 1, name: '  catch a pass  ' }, { lap: 1, name: 'duplicate' },
    { lap: 3, name: 'score a goal' }, { lap: 0, name: 'nope' }
  ] }
}));
assert.deepStrictEqual(cleaned.modeConfig.events, [
  { lap: 1, name: 'catch a pass' },
  { lap: 3, name: 'score a goal' }
]);
const plain = M.normalizeExercise(M.newExercise({
  name: 'Plain', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'stopwatch',
  modeConfig: { lapsEnabled: true, lapCount: 2 }
}));
assert.deepStrictEqual(plain.modeConfig, { lapsEnabled: true, lapCount: 2 });
const off = M.normalizeExercise(M.newExercise({
  name: 'Off', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'stopwatch',
  modeConfig: { lapsEnabled: false, events: [{ lap: 1, name: 'x' }] }
}));
assert.deepStrictEqual(off.modeConfig, { lapsEnabled: false });

const mk = o => M.normalizeExercise(M.newExercise(o));
function workout(name, items) {
  const w = M.newWorkout(name); w.items = items; return w;
}

(async () => {
  const b = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 900, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await require('./allow.js')(p);
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const click = async s => { await p.click(s); await wait(80); };

  async function boot(w, hash) {
    const data = M.emptyData(); data.workouts = [w];
    await p.goto(URL);
    await p.evaluate((k, v) => localStorage.setItem(k, v), M.STORAGE_KEY, JSON.stringify(data));
    await p.goto(URL + (hash || ('#/play/' + w.id)));
    await p.reload();
    await p.waitForSelector(hash && hash.indexOf('/ex/') >= 0 ? '[data-b=name]' : '.pl-endw');
    await wait(80);
  }

  // ---------- 1. Timer tap to rest ----------
  const timed = workout('Tap rest', [
    mk({ name: 'Handstand', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'timer', modeConfig: { workSec: 45, restSec: 15, repsType: null } })
  ]);
  await boot(timed);
  await click('[data-p=primary]');
  const posed = await p.evaluate(() => {
    const orig = performance.now.bind(performance);
    const offset = window.__wbClockOffset || 0;
    window.__wbFreeze = { now: orig(), orig: orig };
    performance.now = () => window.__wbFreeze.now;
    const S0 = window.__wbPlayer;
    // Finish the 5s standoff and land 25s into the 45s hold. Leave the clock frozen for the screenshot.
    window.__wbFreeze.now = S0.t0 + 5000 - offset;
    WBPlayer.step();
    window.__wbFreeze.now = window.__wbPlayer.t0 + 25000 - offset;
    WBPlayer.step();
    return {
      hint: document.querySelector('.pl-hint').textContent,
      aria: document.querySelector('.pl-screen').getAttribute('aria-label'),
      ro: document.getElementById('ro').textContent
    };
  });
  assert.strictEqual(posed.hint, 'Tap to rest');
  assert.strictEqual(posed.aria, 'Rest');
  assert.strictEqual(posed.ro, '0:20'); // 45 − 25, still the work countdown
  await (await p.$('.pl-screen')).screenshot({ path: SHOT + '/timer-tap-to-rest.png' });
  const early = await p.evaluate(() => {
    document.querySelector('[data-p=primary]').click();
    const S = window.__wbPlayer;
    const go = (S.toneLog || []).filter(t => t.kind === 'go').pop();
    const offset = window.__wbClockOffset || 0;
    window.__wbFreeze.now = S.t0 + 1000 - offset;
    WBPlayer.step();
    document.querySelector('[data-st=workSec][data-d="5"]').click();
    const out = {
      phase: S.phase,
      ro: document.getElementById('ro').textContent,
      work: S.results[0].workSec,
      logged: S.results[0].logged,
      running: S.running,
      go: go && go.kind
    };
    performance.now = window.__wbFreeze.orig;
    return out;
  });
  assert.strictEqual(early.phase, 'rest');
  assert.strictEqual(early.ro, '0:14'); // full 15s rest, then one second, leftover work not applied
  assert.strictEqual(early.work, 30); // logged 25, then the tracking stepper still edits it
  assert.strictEqual(early.logged, true);
  assert.strictEqual(early.running, true);
  assert.strictEqual(early.go, 'go');
  const edited = early;
  assert.strictEqual(edited.ro, '0:14');
  assert.strictEqual(edited.phase, 'rest');
  assert.strictEqual(edited.work, 30);
  assert.strictEqual(edited.logged, true);

  // Full work still logs the planned time, even if the clock overshoots the boundary.
  const natural = workout('Full hold', [
    mk({ name: 'Wall sit', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'timer', modeConfig: { workSec: 45, restSec: 15, repsType: null } })
  ]);
  await boot(natural);
  await click('[data-p=primary]');
  const full = await p.evaluate(() => {
    const orig = performance.now.bind(performance);
    const offset = window.__wbClockOffset || 0;
    let frozen = orig();
    performance.now = () => frozen;
    frozen = window.__wbPlayer.t0 + 5000 - offset;
    WBPlayer.step();
    frozen = window.__wbPlayer.t0 + 45600 - offset; // 45s + 600ms
    WBPlayer.step();
    const S = window.__wbPlayer;
    const out = { phase: S.phase, work: S.results[0].workSec, logged: !!S.results[0].logged, ro: document.getElementById('ro').textContent };
    performance.now = orig;
    return out;
  });
  assert.strictEqual(full.phase, 'rest');
  assert.strictEqual(full.work, 45);
  assert.strictEqual(full.logged, true);
  assert.strictEqual(full.ro, '0:15');

  // First exercise of a superset: tap still ends the hold, logs the short time, and does not rest.
  const ssTimer = workout('SS timer', [
    mk({ name: 'Handstand', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'timer', modeConfig: { workSec: 45, restSec: 15, repsType: null } }),
    mk({ name: 'Push-up', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 20 } })
  ]);
  M.linkSuperset(ssTimer, [ssTimer.items[0].id, ssTimer.items[1].id]);
  await boot(ssTimer);
  assert.strictEqual(await p.$eval('.pl-hint', e => e.textContent), 'Tap to start');
  await click('[data-p=primary]');
  const ssEarly = await p.evaluate(() => {
    const orig = performance.now.bind(performance);
    const offset = window.__wbClockOffset || 0;
    let frozen = orig();
    performance.now = () => frozen;
    frozen = window.__wbPlayer.t0 + 5030 - offset;
    WBPlayer.step();
    frozen = window.__wbPlayer.t0 + 10000 - offset;
    WBPlayer.step();
    const hint = document.querySelector('.pl-hint').textContent;
    document.querySelector('[data-p=primary]').click();
    const S = window.__wbPlayer;
    const out = {
      hint,
      phase: S.phase,
      name: document.querySelector('.pl-info .pl-name').textContent,
      work: S.results[0].workSec,
      logged0: S.results[0].logged,
      logged1: !!(S.results[1] && S.results[1].logged),
      rest: !!document.querySelector('.pl-screen.is-rest'),
      flash: (document.querySelector('.pl-flash') || {}).textContent || ''
    };
    performance.now = orig;
    return out;
  });
  assert.strictEqual(ssEarly.hint, 'Tap for next');
  assert.strictEqual(ssEarly.phase, 'work');
  assert.strictEqual(ssEarly.name, 'Push-up');
  assert.strictEqual(ssEarly.work, 10);
  assert.strictEqual(ssEarly.logged0, true);
  assert.strictEqual(ssEarly.logged1, false);
  assert.strictEqual(ssEarly.rest, false);
  assert.strictEqual(ssEarly.flash, '✓'); // finished hold advanced; not a pause

  // Rest of 0, not a superset: Tap for next still finishes the hold and flashes the completion mark.
  const noRest = workout('No rest', [
    mk({ name: 'Plank', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'timer', modeConfig: { workSec: 30, restSec: 0, repsType: null } }),
    mk({ name: 'Squat', sets: 1, weight: { unit: 'lb', value: 45 }, mode: 'reps', modeConfig: { repsType: 'number', count: 5, restSec: 20 } })
  ]);
  await boot(noRest);
  await click('[data-p=primary]');
  const paused = await p.evaluate(() => {
    document.querySelector('[data-p=primary]').click();
    const S = window.__wbPlayer;
    return { phase: S.phase, running: S.running, flash: document.querySelector('.pl-flash').textContent };
  });
  assert.strictEqual(paused.phase, 'standoff');
  assert.strictEqual(paused.running, false);
  assert.strictEqual(paused.flash, '❚❚');
  await boot(noRest);
  await click('[data-p=primary]');
  const hopped = await p.evaluate(() => {
    const orig = performance.now.bind(performance);
    const offset = window.__wbClockOffset || 0;
    let frozen = orig();
    performance.now = () => frozen;
    frozen = window.__wbPlayer.t0 + 5000 - offset;
    WBPlayer.step();
    frozen = window.__wbPlayer.t0 + 8000 - offset;
    WBPlayer.step();
    const hint = document.querySelector('.pl-hint').textContent;
    document.querySelector('[data-p=primary]').click();
    const S = window.__wbPlayer;
    const out = {
      hint,
      name: document.querySelector('.pl-info .pl-name').textContent,
      phase: S.phase,
      work: S.results[0].workSec,
      logged: S.results[0].logged,
      flash: (document.querySelector('.pl-flash') || {}).textContent || ''
    };
    performance.now = orig;
    return out;
  });
  assert.strictEqual(hopped.hint, 'Tap for next');
  assert.strictEqual(hopped.name, 'Squat');
  assert.strictEqual(hopped.phase, 'work');
  assert.strictEqual(hopped.work, 8);
  assert.strictEqual(hopped.logged, true);
  assert.strictEqual(hopped.flash, '✓');

  // ---------- 2. A superset shows one info frame, for the current exercise ----------
  function pair(a, b) { const g = [mk(a), mk(b)]; M.linkSuperset({ items: g }, [g[0].id, g[1].id]); return g; }
  const frames = workout('Frames', [].concat(
    pair({ name: 'Curl', sets: 1, weight: { unit: 'lb', value: 20 }, mode: 'reps', modeConfig: { repsType: 'number', count: 10, restSec: 30 } },
      { name: 'Press', sets: 1, weight: { unit: 'lb', value: 30 }, mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 30 } }),
    pair({ name: 'Plank', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'timer', modeConfig: { workSec: 20, restSec: 10, repsType: null } },
      { name: 'Row', sets: 1, weight: { unit: 'lb', value: 25 }, mode: 'reps', modeConfig: { repsType: 'number', count: 12, restSec: 20 } }),
    pair({ name: 'Squat', sets: 1, weight: { unit: 'lb', value: 95 }, mode: 'reps', modeConfig: { repsType: 'number', count: 5, restSec: 20 } },
      { name: 'Wall sit', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'timer', modeConfig: { workSec: 30, restSec: 10, repsType: null } }),
    pair({ name: 'Hollow', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'timer', modeConfig: { workSec: 20, restSec: 10, repsType: null } },
      { name: 'Arch', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'timer', modeConfig: { workSec: 20, restSec: 10, repsType: null } }),
    pair({ name: 'Sprint', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'intervals', modeConfig: { workSec: 15, repsType: null } },
      { name: 'Walk back', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'reps', modeConfig: { repsType: 'number', count: 1, restSec: 0 } }),
    pair({ name: 'Shuttle', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'stopwatch', modeConfig: { lapsEnabled: true, lapCount: 2 } },
      { name: 'Stretch', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'timer', modeConfig: { workSec: 20, restSec: 5, repsType: null } })
  ));
  // linkSuperset on a fake workout above assigned group ids; items are already grouped.
  await boot(frames);
  const names = ['Curl', 'Press', 'Plank', 'Row', 'Squat', 'Wall sit', 'Hollow', 'Arch', 'Sprint', 'Walk back', 'Shuttle', 'Stretch'];
  for (let i = 0; i < names.length; i++) {
    await p.evaluate(i => WBPlayer.selectStep(i), i);
    await wait(40);
    const frame = await p.evaluate(() => {
      const infos = [...document.querySelectorAll('.pl-info')];
      const active = infos[0] || null;
      return {
        count: infos.length,
        partner: !!document.querySelector('.pl-ss-extra'),
        activeName: active ? active.querySelector('.pl-name').textContent : '',
        inMedia: !!(active && active.closest('.pl-screen')),
        setText: active ? /Set \d+ of|Attempt \d+ of|Interval \d+ of/.test(active.textContent) : false
      };
    });
    assert.strictEqual(frame.partner, false, 'partner ' + i);
    assert.strictEqual(frame.setText, false, 'set text ' + i);
    if (names[i] === 'Shuttle') assert.strictEqual(frame.count, 0, 'stopwatch frame ' + i);
    else {
      assert.strictEqual(frame.count, 1, 'one frame ' + i);
      assert.strictEqual(frame.activeName, names[i], 'active ' + i);
      assert.strictEqual(frame.inMedia, false, 'below media ' + i);
    }
    if (i === 4) await (await p.$('.pl-stage')).screenshot({ path: SHOT + '/superset-active-frame.png' });
  }
  // Advancing the round keeps a single frame for the exercise now playing.
  await p.evaluate(() => WBPlayer.selectStep(0));
  await wait(40);
  await click('[data-p=primary]');
  const doneFrame = await p.evaluate(() => ({
    active: document.querySelector('.pl-info .pl-name').textContent,
    frames: document.querySelectorAll('.pl-info').length,
    partner: !!document.querySelector('.pl-ss-extra'),
    logged: window.__wbPlayer.results[0].logged
  }));
  assert.deepStrictEqual(doneFrame, { active: 'Press', frames: 1, partner: false, logged: true });

  // ---------- 3. Builder events + tracking pass/fail ----------
  const builder = workout('Events', [
    mk({ name: 'Cone drill', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'stopwatch', modeConfig: { lapsEnabled: true, lapCount: 1 } })
  ]);
  await boot(builder, '#/w/' + builder.id + '/ex/' + builder.items[0].id);
  await p.waitForSelector('[data-lev="0"]');
  assert.strictEqual(await p.$$eval('[data-lev]', a => a.length), 1);
  const typeNum = async (sel, v) => { await p.$eval(sel, el => el.value = ''); await p.type(sel, v); };
  await typeNum('[data-b="cfg.lapCount"]', '5');
  await wait(40);
  assert.strictEqual(await p.$$eval('.lap-ev', a => a.length), 5);
  assert.strictEqual(await p.$$eval('[data-lev]', a => a.length), 5);
  assert.strictEqual(await p.$$eval('[data-lename]', a => a.length), 0);
  const labels = await p.$$eval('.lap-ev', a => a.map(l => l.textContent.replace(/\s+/g, ' ').trim()));
  assert.deepStrictEqual(labels, ['Lap 1 Event', 'Lap 2 Event', 'Lap 3 Event', 'Lap 4 Event', 'Lap 5 Event']);
  assert.ok((await p.$$eval('.lap-ev label', a => a.every(l => l.textContent.includes('Event')))));
  await click('[data-lev="0"]');
  await p.type('[data-lename="0"]', 'catch a pass');
  await click('[data-lev="0"]'); // uncheck hides the field but keeps the typed name
  assert.strictEqual(await p.$('[data-lename="0"]'), null);
  await click('[data-lev="0"]');
  assert.strictEqual(await p.$eval('[data-lename="0"]', e => e.value), 'catch a pass');
  await click('[data-lev="4"]');
  await p.type('[data-lename="4"]', 'score a goal');
  await (await p.$('.card')).screenshot({ path: SHOT + '/builder-lap-events.png' });
  await typeNum('[data-b="cfg.lapCount"]', '3');
  await wait(40);
  assert.strictEqual(await p.$$eval('.lap-ev', a => a.length), 3);
  assert.strictEqual(await p.$eval('[data-lename="0"]', e => e.value), 'catch a pass');
  assert.strictEqual(await p.$('[data-lev="4"]'), null);
  await typeNum('[data-b="cfg.lapCount"]', '5');
  await wait(40);
  assert.strictEqual(await p.$eval('[data-lename="4"]', e => e.value), 'score a goal');
  await typeNum('[data-b="cfg.lapCount"]', '4');
  await click('[data-a=save]');
  await p.waitForSelector('[data-a=play]');
  const savedCfg = await p.evaluate(k => {
    const d = JSON.parse(localStorage.getItem(k));
    return d.workouts[0].items[0].modeConfig;
  }, M.STORAGE_KEY);
  assert.deepStrictEqual(savedCfg, {
    lapsEnabled: true, lapCount: 4,
    events: [{ lap: 1, name: 'catch a pass' }]
  });

  const tracked = workout('Track events', [
    mk({ name: 'Cone drill', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'stopwatch', modeConfig: {
      lapsEnabled: true, lapCount: 5,
      events: [{ lap: 1, name: 'catch a pass' }, { lap: 5, name: 'score a goal' }]
    } })
  ]);
  await boot(tracked);
  assert.strictEqual(await p.$('.pl-events'), null);
  await click('.pl-go');
  const adv = async ms => { await p.evaluate(ms => { window.__wbClockOffset = (window.__wbClockOffset || 0) + ms; }, ms); await wait(40); };
  await adv(1000); await click('.pl-go'); // lap 1
  assert.deepStrictEqual(await p.$$eval('.pl-events .pl-ev', a => a.map(e => e.querySelector('span').textContent)), ['Lap 1 \u201ccatch a pass\u201d']);
  assert.strictEqual(await p.$$eval('.pl-pf button.on', a => a.length), 0);
  const order = await p.evaluate(() => {
    const laps = document.querySelector('.pl-laps');
    const ev = document.querySelector('.pl-events');
    return !!(laps.compareDocumentPosition(ev) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  assert.strictEqual(order, true);
  const mid = await p.evaluate(() => {
    const S = window.__wbPlayer;
    const before = { laps: JSON.parse(JSON.stringify(S.results[0].laps)), running: S.running, phase: S.phase, acc: S.acc, t0: S.t0, ro: document.getElementById('ro').textContent };
    document.querySelector('[data-pf="pass"]').click();
    const r = S.results[0];
    return { before, after: { laps: r.laps, running: S.running, phase: S.phase, acc: S.acc, t0: S.t0, ro: document.getElementById('ro').textContent, mark: r.eventResults[1] } };
  });
  assert.deepStrictEqual(mid.after.laps, mid.before.laps);
  assert.strictEqual(mid.after.running, true);
  assert.strictEqual(mid.before.running, true);
  assert.strictEqual(mid.after.phase, 'work');
  assert.strictEqual(mid.after.acc, mid.before.acc);
  assert.strictEqual(mid.after.t0, mid.before.t0);
  assert.strictEqual(mid.after.ro, mid.before.ro);
  assert.strictEqual(mid.after.mark, 'pass');
  assert.strictEqual(await p.$eval('[data-pf="pass"]', e => e.classList.contains('on')), true);
  assert.strictEqual(await p.$eval('[data-pf="fail"]', e => e.classList.contains('on')), false);
  for (let n = 2; n <= 4; n++) { await adv(800); await click('.pl-go'); }
  assert.strictEqual(await p.$$eval('.pl-ev', a => a.length), 1); // lap 5 not invented
  await adv(800); await click('.pl-go'); // lap 5, attempt complete
  const rows = await p.$$eval('.pl-ev span', a => a.map(e => e.textContent));
  assert.deepStrictEqual(rows, ['Lap 1 \u201ccatch a pass\u201d', 'Lap 5 \u201cscore a goal\u201d']);
  const doneTap = await p.evaluate(() => {
    const S = window.__wbPlayer;
    const before = { laps: JSON.parse(JSON.stringify(S.results[0].laps)), duration: S.results[0].durationMs, phase: S.phase, running: S.running };
    const fail = document.querySelectorAll('[data-pf="fail"]')[1];
    fail.click();
    const r = S.results[0];
    return { before, after: { laps: r.laps, duration: r.durationMs, phase: S.phase, running: S.running, mark1: r.eventResults[1], mark5: r.eventResults[5] } };
  });
  assert.deepStrictEqual(doneTap.after.laps, doneTap.before.laps);
  assert.strictEqual(doneTap.after.duration, doneTap.before.duration);
  assert.strictEqual(doneTap.after.phase, 'complete');
  assert.strictEqual(doneTap.after.running, false);
  assert.strictEqual(doneTap.after.mark1, 'pass');
  assert.strictEqual(doneTap.after.mark5, 'fail');
  assert.strictEqual(await p.$eval('.pl-ev:nth-child(2) [data-pf="pass"]', e => e.classList.contains('on')), false);
  await (await p.$('.pl-track')).screenshot({ path: SHOT + '/tracking-lap-events.png' });

  // Restarting mid-attempt, or redoing a finished one, leaves pass/fail unset until the next tap.
  const redoW = workout('Redo marks', [
    mk({ name: 'Cone drill', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'stopwatch', modeConfig: {
      lapsEnabled: true, lapCount: 2,
      events: [{ lap: 1, name: 'catch a pass' }]
    } }),
    mk({ name: 'Jog', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'reps', modeConfig: { repsType: 'number', count: 10, restSec: 0 } })
  ]);
  await boot(redoW);
  const marks = () => p.evaluate(() => {
    const r = window.__wbPlayer.results[0];
    const er = r.eventResults || {};
    return {
      phase: window.__wbPlayer.phase,
      laps: r.laps.length,
      duration: r.durationMs,
      mark: er[1],
      on: [...document.querySelectorAll('.pl-pf button.on')].map(b => b.dataset.pf),
      rows: document.querySelectorAll('.pl-ev').length
    };
  });
  await click('.pl-go');
  await adv(400); await click('.pl-go');
  await click('[data-pf="pass"]');
  let m = await marks();
  assert.strictEqual(m.mark, 'pass');
  assert.deepStrictEqual(m.on, ['pass']);
  await p.evaluate(() => WBPlayer.selectStep(1)); await wait(40);
  await p.evaluate(() => WBPlayer.selectStep(0)); await wait(40);
  m = await marks();
  assert.strictEqual(m.phase, 'ready');
  assert.strictEqual(m.mark, 'pass'); // old attempt stays visible until Start
  await click('.pl-go');
  m = await marks();
  assert.strictEqual(m.phase, 'work');
  assert.strictEqual(m.laps, 0);
  assert.strictEqual(m.duration, 0);
  assert.strictEqual(m.mark, undefined);
  assert.strictEqual(m.rows, 0);
  await adv(400); await click('.pl-go');
  m = await marks();
  assert.strictEqual(m.laps, 1);
  assert.strictEqual(m.mark, undefined);
  assert.deepStrictEqual(m.on, []);
  assert.strictEqual(m.rows, 1);
  await click('[data-pf="fail"]');
  await adv(400); await click('.pl-go');
  m = await marks();
  assert.strictEqual(m.phase, 'complete');
  assert.strictEqual(m.mark, 'fail');
  await p.evaluate(() => WBPlayer.selectStep(1)); await wait(40);
  await p.evaluate(() => WBPlayer.selectStep(0)); await wait(40);
  await click('.pl-go');
  m = await marks();
  assert.strictEqual(m.laps, 0);
  assert.strictEqual(m.mark, undefined);
  await adv(300); await click('.pl-go');
  m = await marks();
  assert.strictEqual(m.laps, 1);
  assert.strictEqual(m.mark, undefined);
  assert.deepStrictEqual(m.on, []);
  assert.strictEqual(m.rows, 1);

  // ---------- 4. Timer tones share the visible second ----------
  const tones = workout('Tones', [
    mk({ name: 'Beeps', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'timer', modeConfig: { workSec: 10, restSec: 5, repsType: null } })
  ]);
  await boot(tones);
  await click('[data-p=primary]');
  const tone = await p.evaluate(() => {
    const orig = performance.now.bind(performance);
    const offset = window.__wbClockOffset || 0;
    let frozen = orig();
    performance.now = () => frozen;
    const snaps = [];
    function snap(label) {
      const S = window.__wbPlayer;
      const last = S.toneLog[S.toneLog.length - 1];
      snaps.push({ label, phase: S.phase, ro: document.getElementById('ro') && document.getElementById('ro').textContent, n: S.toneLog.length, kind: last.kind, vis: last.vis, tPhase: last.phase, at: last.at });
    }
    function seek(ms) {
      const S = window.__wbPlayer;
      frozen = S.t0 + ms - offset;
      WBPlayer.step();
    }
    // Restart the opening tick under the frozen clock so the first beep is exact.
    const S = window.__wbPlayer;
    S.toneMark = -1; S.toneLog = [];
    frozen = S.t0 + 20 - offset;
    WBPlayer.step();
    snap('stand-5');
    [1030, 2030, 3030, 4030].forEach(ms => { seek(ms); snap('stand-' + ms); });
    seek(5030); snap('stand-go');
    [7030, 8030, 9030].forEach(ms => { seek(ms); snap('work-' + ms); });
    seek(10030); snap('work-go');
    [2030, 3030, 4030].forEach(ms => { seek(ms); snap('rest-' + ms); });
    seek(5030); snap('rest-done');
    performance.now = orig;
    return snaps;
  });
  function expectTone(row, o) {
    assert.strictEqual(row.kind, o.kind, row.label + ' kind ' + JSON.stringify(row));
    assert.strictEqual(row.vis, o.vis, row.label + ' vis ' + JSON.stringify(row));
    assert.strictEqual(row.tPhase, o.phase, row.label + ' phase ' + JSON.stringify(row));
    assert.strictEqual(row.ro, o.ro, row.label + ' ro ' + JSON.stringify(row));
    assert.ok(Math.abs(row.at - o.at) <= 40, row.label + ' at ' + row.at);
  }
  expectTone(tone[0], { kind: 'tick', vis: 5, phase: 'standoff', ro: '0:05', at: 0 });
  expectTone(tone[1], { kind: 'tick', vis: 4, phase: 'standoff', ro: '0:04', at: 1000 });
  expectTone(tone[2], { kind: 'tick', vis: 3, phase: 'standoff', ro: '0:03', at: 2000 });
  expectTone(tone[3], { kind: 'tick', vis: 2, phase: 'standoff', ro: '0:02', at: 3000 });
  expectTone(tone[4], { kind: 'tick', vis: 1, phase: 'standoff', ro: '0:01', at: 4000 });
  expectTone(tone[5], { kind: 'go', vis: 0, phase: 'standoff', ro: '0:10', at: 5000 });
  assert.strictEqual(tone[5].phase, 'work');
  expectTone(tone[6], { kind: 'tick', vis: 3, phase: 'work', ro: '0:03', at: 12000 });
  expectTone(tone[7], { kind: 'tick', vis: 2, phase: 'work', ro: '0:02', at: 13000 });
  expectTone(tone[8], { kind: 'tick', vis: 1, phase: 'work', ro: '0:01', at: 14000 });
  expectTone(tone[9], { kind: 'go', vis: 0, phase: 'work', ro: '0:05', at: 15000 });
  assert.strictEqual(tone[9].phase, 'rest');
  expectTone(tone[10], { kind: 'tick', vis: 3, phase: 'rest', ro: '0:03', at: 17000 });
  expectTone(tone[11], { kind: 'tick', vis: 2, phase: 'rest', ro: '0:02', at: 18000 });
  expectTone(tone[12], { kind: 'tick', vis: 1, phase: 'rest', ro: '0:01', at: 19000 });
  expectTone(tone[13], { kind: 'done', vis: 0, phase: 'rest', ro: '00:00.00', at: 20000 });
  // Each seek added one tone — no extra beeps from the jump.
  tone.forEach((row, i) => assert.strictEqual(row.n, i + 1, row.label));

  // ---------- 5. Reps rest: ticks at 3, 2, 1, double beep at 0, full gain, pause and skip stay quiet ----------
  const repsRest = workout('Reps rest', [
    mk({ name: 'Curl', sets: 1, weight: { unit: 'lb', value: 20 }, mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 5 }, notes: 'Elbows in' }),
    mk({ name: 'Press', sets: 1, weight: { unit: 'lb', value: 30 }, mode: 'reps', modeConfig: { repsType: 'number', count: 6, restSec: 0 } })
  ]);
  await boot(repsRest);
  const repsCue = await p.evaluate(() => {
    const peaks = [];
    const AC = window.AudioContext || window.webkitAudioContext;
    const origGain = AC.prototype.createGain;
    AC.prototype.createGain = function () {
      const g = origGain.call(this);
      const ramp = g.gain.exponentialRampToValueAtTime.bind(g.gain);
      g.gain.exponentialRampToValueAtTime = function (v, t) { peaks.push(v); return ramp(v, t); };
      return g;
    };
    const orig = performance.now.bind(performance);
    const offset = window.__wbClockOffset || 0;
    let frozen = orig();
    performance.now = () => frozen;
    document.querySelector('[data-p=primary]').click();
    const S = window.__wbPlayer;
    function at(ms) { S.running = true; S.acc = 0; S.t0 = frozen + offset - ms; WBPlayer.step(); }
    function kinds() { return (S.toneLog || []).map(t => t.kind + ':' + t.vis + ':' + t.phase); }
    at(20); at(2000); at(3000); at(4000);
    const mid = kinds();
    S.acc = 4000; S.running = false; // pause on 0:01
    frozen += 2000; WBPlayer.step();
    const paused = kinds();
    S.t0 = frozen + offset; S.running = true; // resume, same second
    WBPlayer.step();
    const resumed = kinds();
    at(5200);
    const ended = { phase: S.phase, idx: S.idx, kinds: kinds(), logged: S.results[0].logged, peaks: peaks.slice() };
    performance.now = orig;
    AC.prototype.createGain = origGain;
    return { mid, paused, resumed, ended };
  });
  assert.deepStrictEqual(repsCue.mid, ['tick:3:rest', 'tick:2:rest', 'tick:1:rest']);
  assert.deepStrictEqual(repsCue.paused, repsCue.mid); // paused clock does not beep
  assert.deepStrictEqual(repsCue.resumed, repsCue.mid);
  assert.strictEqual(repsCue.ended.phase, 'work');
  assert.strictEqual(repsCue.ended.idx, 1);
  assert.strictEqual(repsCue.ended.logged, true);
  assert.deepStrictEqual(repsCue.ended.kinds, ['tick:3:rest', 'tick:2:rest', 'tick:1:rest', 'go:0:rest']);
  assert.ok(repsCue.ended.peaks.includes(1), JSON.stringify(repsCue.ended.peaks));
  assert.ok(repsCue.ended.peaks.every(v => v <= 1), JSON.stringify(repsCue.ended.peaks));
  await boot(repsRest);
  const skipped = await p.evaluate(() => {
    const orig = performance.now.bind(performance);
    const offset = window.__wbClockOffset || 0;
    let frozen = orig();
    performance.now = () => frozen;
    document.querySelector('[data-p=primary]').click();
    const S = window.__wbPlayer;
    frozen = S.t0 + 1000 - offset; // still on 0:04, before the last 3 seconds
    WBPlayer.step();
    const before = (S.toneLog || []).length;
    document.querySelector('[data-p=primary]').click(); // skip
    const out = { before, after: (S.toneLog || []).length, idx: S.idx, phase: S.phase, logged: S.results[0].logged, running: S.running };
    performance.now = orig;
    return out;
  });
  assert.strictEqual(skipped.before, 0);
  assert.strictEqual(skipped.after, 0);
  assert.strictEqual(skipped.idx, 1);
  assert.strictEqual(skipped.phase, 'work');
  assert.strictEqual(skipped.logged, true);

  assert.deepStrictEqual(errs, []);
  console.log('ADJUSTMENTS OK');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
