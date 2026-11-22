// Pre-filled numbers clear on focus and stay empty. Required blanks block save.
// node tests/clear-fields.test.js [url]
const assert = require('assert');
const M = require('../model.js');
const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';

function ex(over) {
  return M.normalizeExercise(M.newExercise(over));
}

(async () => {
  const browser = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', function (err) { errors.push(String(err)); });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await require('./allow.js').stubAuth(page, {
    profile: { id: 'allow-test', email: 'kinisiathletics@gmail.com', membership: 'enthusiast', intended_plan: 'enthusiast' },
    session: { user: { id: 'allow-test', email: 'kinisiathletics@gmail.com' } }
  });
  const good = M.newWorkout('Morning lift');
  const squat = ex({
    name: 'Goblet squat', sets: 3, weight: { unit: 'lb', value: 25 },
    mode: 'reps', modeConfig: { repsType: 'number', count: 10, min: 8, max: 12, restSec: 90 }
  });
  const plank = ex({
    name: 'Plank', sets: 2, weight: { unit: 'bodyweight', value: null },
    mode: 'timer', modeConfig: { workSec: 45, restSec: 15, repsType: null }
  });
  good.items = [squat, plank];
  const bad = M.newWorkout('Broken');
  bad.items = [ex({
    name: 'Oops', sets: 1, weight: { unit: 'lb', value: 10 },
    mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 0 }
  })];
  bad.items[0].sets = null;
  const data = M.emptyData();
  data.workouts.push(good, bad);
  await page.goto(URL);
  await page.evaluate(function (key, raw) { localStorage.setItem(key, raw); }, M.STORAGE_KEY, JSON.stringify(data));
  await page.goto(URL + '#/w/' + good.id + '/ex/' + squat.id);
  await page.reload();
  await page.waitForSelector('[data-b=sets]');

  const before = await page.evaluate(function () {
    function v(sel) { return document.querySelector(sel).value; }
    return {
      sets: v('[data-b=sets]'),
      reps: v('[data-b="cfg.count"]'),
      weight: v('[data-b=wval]'),
      min: v('[data-b="cfg.rm"]'),
      sec: v('[data-b="cfg.rs"]'),
      mode: document.querySelector('[data-b=sets]').getAttribute('inputmode')
    };
  });
  assert.deepStrictEqual(before, { sets: '3', reps: '10', weight: '25', min: '1', sec: '30', mode: 'numeric' });

  await page.tap('[data-b=sets]');
  await page.waitForFunction(function () { return document.querySelector('[data-b=sets]').value === ''; });
  assert.strictEqual(await page.$eval('[data-b="cfg.count"]', function (el) { return el.value; }), '10');
  await page.tap('[data-b=name]');
  await new Promise(function (r) { setTimeout(r, 350); });
  assert.strictEqual(await page.$eval('[data-b=sets]', function (el) { return el.value; }), '');

  await page.tap('[data-b="cfg.count"]');
  await page.waitForFunction(function () { return document.querySelector('[data-b="cfg.count"]').value === ''; });
  assert.strictEqual(await page.$eval('[data-b=sets]', function (el) { return el.value; }), '');
  await page.tap('[data-b=wval]');
  await page.waitForFunction(function () { return document.querySelector('[data-b=wval]').value === ''; });
  await page.tap('[data-b=name]');
  await new Promise(function (r) { setTimeout(r, 350); });
  assert.strictEqual(await page.$eval('[data-b=wval]', function (el) { return el.value; }), '');
  assert.strictEqual(await page.$eval('[data-b="cfg.rm"]', function (el) { return el.value; }), '1');
  assert.strictEqual(await page.$eval('[data-b="cfg.rs"]', function (el) { return el.value; }), '30');

  await page.tap('[data-a=save]');
  await page.waitForSelector('#errs');
  const blocked = await page.evaluate(function () {
    function bad(sel) { return document.querySelector(sel).classList.contains('is-empty'); }
    return {
      text: document.getElementById('errs').textContent,
      sets: bad('[data-b=sets]'),
      reps: bad('[data-b="cfg.count"]'),
      weight: bad('[data-b=wval]'),
      rest: bad('[data-b="cfg.rm"]'),
      outline: getComputedStyle(document.querySelector('[data-b=sets]')).borderColor
    };
  });
  assert.ok(blocked.text.indexOf('Fill in the highlighted fields.') !== -1, blocked.text);
  assert.strictEqual(blocked.sets, true);
  assert.strictEqual(blocked.reps, true);
  assert.strictEqual(blocked.weight, false);
  assert.strictEqual(blocked.rest, false);
  assert.strictEqual(blocked.outline, 'rgb(220, 38, 38)');
  const storedSets = await page.evaluate(function (key) {
    return JSON.parse(localStorage.getItem(key)).workouts[0].items[0].sets;
  }, M.STORAGE_KEY);
  assert.strictEqual(storedSets, 3);

  await page.tap('[data-b=sets]');
  await page.keyboard.type('4');
  await page.waitForFunction(function () {
    var el = document.querySelector('[data-b=sets]');
    return el.value === '4' && !el.classList.contains('is-empty');
  });
  await page.tap('[data-b="cfg.count"]');
  await page.keyboard.type('8');
  await page.waitForFunction(function () {
    var el = document.querySelector('[data-b="cfg.count"]');
    return el.value === '8' && !el.classList.contains('is-empty');
  });
  await page.tap('[data-a=save]');
  await page.waitForFunction(function () { return location.hash.indexOf('/ex/') === -1; });
  const saved = await page.evaluate(function (key) {
    return JSON.parse(localStorage.getItem(key)).workouts[0].items[0];
  }, M.STORAGE_KEY);
  assert.strictEqual(saved.sets, 4);
  assert.strictEqual(saved.modeConfig.count, 8);
  assert.strictEqual(saved.weight.value, null);
  assert.strictEqual(saved.modeConfig.restSec, 90);

  await page.goto(URL + '#/w/' + good.id + '/ex/' + plank.id);
  await page.reload();
  await page.waitForSelector('[data-b="cfg.wm"]');
  assert.deepStrictEqual(await page.evaluate(function () {
    function v(sel) { return document.querySelector(sel).value; }
    return { wm: v('[data-b="cfg.wm"]'), ws: v('[data-b="cfg.ws"]'), rm: v('[data-b="cfg.rm"]'), rs: v('[data-b="cfg.rs"]') };
  }), { wm: '0', ws: '45', rm: '0', rs: '15' });
  await page.tap('[data-b="cfg.wm"]');
  await page.waitForFunction(function () { return document.querySelector('[data-b="cfg.wm"]').value === ''; });
  assert.strictEqual(await page.$eval('[data-b="cfg.ws"]', function (el) { return el.value; }), '45');
  await page.tap('h1');
  await new Promise(function (r) { setTimeout(r, 350); });
  assert.strictEqual(await page.$eval('[data-b="cfg.wm"]', function (el) { return el.value; }), '');
  await page.tap('[data-a=save]');
  await page.waitForSelector('input.is-empty');
  assert.strictEqual(await page.$eval('[data-b="cfg.wm"]', function (el) { return el.classList.contains('is-empty'); }), true);
  assert.strictEqual(await page.$eval('[data-b="cfg.ws"]', function (el) { return el.classList.contains('is-empty'); }), false);
  assert.ok((await page.$eval('#errs', function (el) { return el.textContent; })).indexOf('Fill in the highlighted fields.') !== -1);
  await page.tap('[data-b="cfg.wm"]');
  await page.keyboard.type('0');
  await page.waitForFunction(function () { return !document.querySelector('[data-b="cfg.wm"]').classList.contains('is-empty'); });
  await page.tap('[data-b="cfg.rs"]');
  await page.waitForFunction(function () { return document.querySelector('[data-b="cfg.rs"]').value === ''; });
  assert.strictEqual(await page.$eval('[data-b="cfg.rm"]', function (el) { return el.value; }), '0');
  await page.tap('[data-a=save]');
  await page.waitForFunction(function () { return document.querySelector('[data-b="cfg.rs"]').classList.contains('is-empty'); });
  assert.strictEqual(await page.evaluate(function (key) {
    return JSON.parse(localStorage.getItem(key)).workouts[0].items[1].modeConfig.restSec;
  }, M.STORAGE_KEY), 15);

  await page.goto(URL + '#/programs');
  await page.reload();
  await page.waitForSelector('.pv-day');
  await page.tap('.pv-day:not(.today) .pv-day-h');
  await page.waitForSelector('[data-sheet=add-day]');
  await page.tap('[data-sheet=add-day]');
  await page.waitForSelector('#pv-start-h');
  assert.deepStrictEqual(await page.evaluate(function () {
    return {
      h: document.getElementById('pv-start-h').value,
      m: document.getElementById('pv-start-m').value,
      eh: document.getElementById('pv-end-h').value,
      em: document.getElementById('pv-end-m').value,
      native: document.querySelectorAll('#pv-sheet input[type="time"]').length
    };
  }), { h: '09', m: '00', eh: '10', em: '00', native: 0 });
  await page.tap('#pv-start-m');
  await page.waitForFunction(function () { return document.getElementById('pv-start-m').value === ''; });
  assert.strictEqual(await page.$eval('#pv-start-h', function (el) { return el.value; }), '09');
  await page.tap('#pv-sheet h3');
  await new Promise(function (r) { setTimeout(r, 350); });
  assert.strictEqual(await page.$eval('#pv-start-m', function (el) { return el.value; }), '');
  assert.strictEqual(await page.$eval('#pv-start-h', function (el) { return el.value; }), '09');
  await page.tap('#pv-sheet .pv-pick');
  await page.waitForFunction(function () { return document.querySelector('#pv-sheet .pv-pick.on'); });
  assert.strictEqual(await page.$eval('#pv-start-m', function (el) { return el.value; }), '');
  await page.tap('[data-sheet=save]');
  await page.waitForSelector('#pv-sheet-error');
  const sheet = await page.evaluate(function () {
    return {
      text: document.getElementById('pv-sheet-error').textContent,
      minute: document.getElementById('pv-start-m').classList.contains('is-empty'),
      hour: document.getElementById('pv-start-h').classList.contains('is-empty'),
      end: document.getElementById('pv-end-h').classList.contains('is-empty')
    };
  });
  assert.ok(sheet.text.indexOf('Fill in the highlighted fields.') !== -1, sheet.text);
  assert.strictEqual(sheet.minute, true);
  assert.strictEqual(sheet.hour, false);
  assert.strictEqual(sheet.end, false);
  await page.tap('[data-ampm="start"][data-ap="PM"]');
  await page.tap('#pv-sheet .pv-pick.on');
  await page.tap('#pv-sheet .pv-presence input[value="solo"]');
  const kept = await page.evaluate(function () {
    var err = document.getElementById('pv-sheet-error');
    return {
      text: err ? err.textContent : '',
      minute: document.getElementById('pv-start-m').classList.contains('is-empty'),
      minuteValue: document.getElementById('pv-start-m').value,
      hour: document.getElementById('pv-start-h').classList.contains('is-empty'),
      hourValue: document.getElementById('pv-start-h').value
    };
  });
  assert.ok(kept.text.indexOf('Fill in the highlighted fields.') !== -1, kept.text);
  assert.strictEqual(kept.minute, true);
  assert.strictEqual(kept.minuteValue, '');
  assert.strictEqual(kept.hour, false);
  assert.strictEqual(kept.hourValue, '09');
  await page.tap('[data-ampm="start"][data-ap="AM"]');
  await page.tap('#pv-start-m');
  await page.keyboard.type('00');
  await page.waitForFunction(function () { return !document.getElementById('pv-start-m').classList.contains('is-empty'); });
  await page.tap('#pv-sheet .pv-presence input[value="solo"]');
  await page.tap('[data-sheet=save]');
  await page.waitForFunction(function () {
    return (JSON.parse(localStorage.getItem('wb.data.v1')).programs || []).length === 1;
  });

  await page.goto(URL + '#/w/' + bad.id);
  await page.reload();
  await page.waitForSelector('[data-a=play]');
  await page.tap('[data-a=play]');
  await page.waitForFunction(function () { return document.getElementById('toast').textContent.indexOf('Fill in every number') !== -1; });
  assert.strictEqual(await page.$('.pl-screen'), null);
  assert.ok(page.url().indexOf('/play/') === -1);

  await page.goto(URL + '#/w/' + good.id);
  await page.reload();
  await page.waitForSelector('[data-a=play]');
  await page.tap('[data-a=play]');
  await page.waitForSelector('.pl-screen');

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('CLEAR FIELDS OK');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
