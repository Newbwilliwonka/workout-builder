// Stopwatch tracking card: compact weight in the old title slot. Other modes keep the labeled field.
// node tests/stopwatch-weight.test.js [url]
const assert = require('assert'); const M = require('../model.js'); const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const mk = o => M.normalizeExercise(M.newExercise(o));
const w = M.newWorkout('Stopwatch weight');
w.items = [
  mk({ name: 'Cone shuttle', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'stopwatch', modeConfig: { lapsEnabled: true, lapCount: 3 } }),
  mk({ name: 'Sled push', sets: 1, weight: { unit: 'kg', value: 20 }, mode: 'stopwatch', modeConfig: { lapsEnabled: false } }),
  mk({ name: 'Squat', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 20 } }),
  mk({ name: 'Row', sets: 1, weight: { unit: 'kg', value: 20 }, mode: 'reps', modeConfig: { repsType: 'number', count: 10, restSec: 20 } })
];
const data = M.emptyData(); data.workouts.push(w);
(async () => {
  const b = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await require('./allow.js')(p);
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(URL); await p.evaluate((k, v) => localStorage.setItem(k, v), M.STORAGE_KEY, JSON.stringify(data));
  await p.goto(URL + '#/w/' + w.id); await p.reload(); await p.waitForSelector('[data-a=play]');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const click = async s => { await p.click(s); await wait(80); };
  const weight = () => p.evaluate(() => {
    const track = document.querySelector('.pl-track');
    const th = track.querySelector('.pl-th');
    const ctl = track.querySelector('.pl-sw-weight');
      const label = [...track.querySelectorAll('.pl-f > span')].find(e => /^Weight/.test(e.textContent)) || null;
      const field = track.querySelector('.pl-bw:not(.pl-sw-weight)');
    const step = track.querySelector('.pl-step');
    const input = track.querySelector('[data-f="weight"]');
    const tr = track.getBoundingClientRect();
    const hr = th.getBoundingClientRect();
    const cr = ctl && ctl.getBoundingClientRect();
    const fr = field && field.getBoundingClientRect();
    const cs = ctl && getComputedStyle(ctl);
    const fs = field && getComputedStyle(field);
    return {
      labels: [...track.querySelectorAll('.pl-f > span')].map(e => e.textContent),
      text: ctl ? ctl.textContent : '',
      aria: ctl ? ctl.getAttribute('aria-label') : '',
      tag: ctl ? ctl.tagName : '',
      role: ctl ? ctl.getAttribute('role') : null,
      wedit: ctl ? ctl.getAttribute('data-wedit') : null,
      editing: !!track.querySelector('.pl-sw-weight-edit'),
      step: !!step,
      weightStep: !!track.querySelector('[data-st="weight"]'),
      input: input ? input.value : null,
      inputAria: input ? input.getAttribute('aria-label') : null,
      label: label ? label.textContent : '',
      field: field ? field.textContent : '',
      fieldMin: fs ? fs.minHeight : '',
      fieldH: fr ? fr.height : 0,
      left: cr ? Math.abs(cr.left - hr.left) : null,
      gap: cr ? +(cr.top - hr.bottom).toFixed(1) : null,
      h: cr ? cr.height : 0,
      w: cr ? cr.width : 0,
      trackW: tr.width,
      trackH: tr.height,
      bg: cs ? cs.backgroundColor : '',
      color: cs ? cs.color : '',
      font: cs ? cs.fontSize : '',
      fontWeight: cs ? cs.fontWeight : '',
      radius: cs ? cs.borderRadius : '',
      border: cs ? cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor : '',
      pad: cs ? cs.padding : '',
      transform: cs ? cs.textTransform : '',
      rows: track.querySelectorAll('.pl-fields > *').length
    };
  });

  await click('[data-a=play]');
  let box = await weight();
  assert.deepStrictEqual(box.labels, []);
  assert.strictEqual(box.text, 'Bodyweight');
  assert.strictEqual(box.aria, 'Weight, Bodyweight');
  assert.strictEqual(box.tag, 'SPAN');
  assert.strictEqual(box.role, null);
  assert.strictEqual(box.wedit, null);
  assert.strictEqual(box.editing, false);
  assert.strictEqual(box.step, false);
  assert.strictEqual(box.rows, 1);
  assert.ok(box.left < 1, JSON.stringify(box));
  assert.ok(box.gap > 6 && box.gap < 16, JSON.stringify(box));
  assert.ok(box.h > 24 && box.h < 40, JSON.stringify(box));
  assert.ok(box.w < box.trackW * 0.5, JSON.stringify(box));
  assert.ok(box.trackH < 110, JSON.stringify(box));
  assert.strictEqual(box.bg, 'rgb(11, 18, 32)');
  assert.strictEqual(box.color, 'rgb(148, 163, 184)');
  assert.strictEqual(box.font, '15px');
  assert.strictEqual(box.transform, 'none');
  const chipLook = { bg: box.bg, color: box.color, font: box.font, fontWeight: box.fontWeight, radius: box.radius, border: box.border, pad: box.pad, h: box.h };
  await click('.pl-sw-weight');
  box = await weight();
  assert.strictEqual(box.text, 'Bodyweight');
  assert.strictEqual(box.step, false);

  await click('[data-sel="1"]');
  box = await weight();
  assert.deepStrictEqual(box.labels, []);
  assert.strictEqual(box.text, '20 kg');
  assert.strictEqual(box.aria, 'Weight, 20 kg');
  assert.strictEqual(box.tag, 'BUTTON');
  assert.strictEqual(box.step, false);
  assert.deepStrictEqual({ bg: box.bg, color: box.color, font: box.font, fontWeight: box.fontWeight, radius: box.radius, border: box.border, pad: box.pad, h: box.h }, chipLook);
  assert.ok(box.left < 1 && box.h > 24 && box.h < 40 && box.w < box.trackW * 0.5, JSON.stringify(box));
  await click('.pl-sw-weight');
  box = await weight();
  assert.strictEqual(box.editing, true);
  assert.strictEqual(box.text, '');
  assert.deepStrictEqual(box.labels, []);
  assert.strictEqual(box.input, '20');
  assert.strictEqual(box.inputAria, 'Weight');
  assert.deepStrictEqual(await p.$$eval('.pl-sw-weight-edit button', a => a.map(b => b.getAttribute('aria-label'))), ['Decrease Weight (kg)', 'Increase Weight (kg)']);
  await click('[data-st=weight][data-d="2.5"]');
  await click('[data-st=weight][data-d="2.5"]');
  assert.strictEqual(await p.$eval('[data-f=weight]', e => e.value), '25');
  assert.strictEqual(await p.evaluate(() => window.__wbPlayer.results[1].weight), 25);
  await click('.pl-th b');
  await wait(40);
  box = await weight();
  assert.strictEqual(box.text, '25 kg');
  assert.strictEqual(box.aria, 'Weight, 25 kg');
  assert.strictEqual(box.editing, false);
  await click('.pl-sw-weight');
  await p.$eval('[data-f=weight]', e => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.type('[data-f=weight]', '18');
  await click('.pl-ro');
  await wait(40);
  box = await weight();
  assert.strictEqual(box.text, '18 kg');
  assert.strictEqual(box.aria, 'Weight, 18 kg');
  assert.strictEqual(await p.evaluate(() => window.__wbPlayer.results[1].weight), 18);
  await click('.pl-sw-weight');
  await click('.pl-go');
  box = await weight();
  assert.strictEqual(box.editing, false);
  assert.strictEqual(box.text, '18 kg');
  assert.strictEqual(await p.evaluate(() => window.__wbPlayer.phase), 'work');

  await click('[data-sel="0"]');
  box = await weight();
  assert.strictEqual(box.text, 'Bodyweight');
  assert.strictEqual(box.aria, 'Weight, Bodyweight');
  assert.strictEqual(box.tag, 'SPAN');
  assert.strictEqual(box.editing, false);

  await click('[data-sel="2"]');
  box = await weight();
  assert.strictEqual(box.tag, '');
  assert.strictEqual(box.label, 'Weight');
  assert.strictEqual(box.field, 'Bodyweight');
  assert.strictEqual(box.fieldMin, '54px');
  assert.ok(box.fieldH >= 54, JSON.stringify(box));
  assert.strictEqual(box.weightStep, false);
  assert.strictEqual(await p.$('.pl-sw-weight'), null);

  await click('[data-sel="3"]');
  box = await weight();
  assert.strictEqual(box.label, 'Weight (kg)');
  assert.strictEqual(box.input, '20');
  assert.strictEqual(box.inputAria, null);
  assert.strictEqual(box.step, true);
  assert.strictEqual(box.editing, false);
  assert.strictEqual(await p.$('.pl-sw-weight'), null);
  await click('[data-st=weight][data-d="2.5"]');
  assert.strictEqual(await p.$eval('[data-f=weight]', e => e.value), '22.5');
  assert.strictEqual(await p.evaluate(() => window.__wbPlayer.results[3].weight), 22.5);

  assert.deepStrictEqual(errs, []);
  console.log('STOPWATCH WEIGHT OK');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
