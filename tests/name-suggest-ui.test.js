// Manual exercise-name suggestions. node tests/name-suggest-ui.test.js [url]
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const M = require('../model.js');

function workout(name, at, items, extra) {
  const w = M.newWorkout(name);
  items.forEach(function (item) {
    const ex = M.newExercise({
      name: item.name,
      notes: item.notes || '',
      sets: 3,
      weight: { unit: 'lb', value: 25 },
      mode: 'reps',
      modeConfig: { repsType: 'number', count: 10, min: 8, max: 12, restSec: 60 }
    });
    ex.id = item.id;
    M.upsertExercise(w, ex);
  });
  w.updatedAt = at;
  w.createdAt = at;
  if (extra) Object.keys(extra).forEach(function (k) { w[k] = extra[k]; });
  return w;
}

const legs = workout('Legs', 5000, [
  { id: 'goblet', name: 'Goblet Squat', notes: 'Elbows in' },
  { id: 'push', name: 'Push-up', notes: 'Ribs down' }
]);
const again = workout('Later', 4500, [{ id: 'goblet2', name: 'Goblet Squat' }]);
const account = workout('Account day', 4000, [{ id: 'heavy', name: 'Heavy Goblet Press' }]);
const older = workout('Older', 2000, [
  { id: 'slow', name: 'Slow Goblet' },
  { id: 'push2', name: 'Push up' }
]);
const pulls = workout('Pulls', 3500, [{ id: 'rdl', name: 'Romanian Deadlift', notes: 'Hinge' }]);
const trainer = workout('From coach', 9000, [{ id: 'secret', name: 'Secret Goblet' }], { sourceTrainerId: 'tr' });
const client = workout('Client day', 9000, [{ id: 'client-ex', name: 'Client Goblet' }], { remoteOwnerId: 'c1' });
const data = M.emptyData();
data.workouts.push(legs, again, account, older, pulls, trainer, client);
const GOB = ['Goblet Squat', 'Heavy Goblet Press', 'Slow Goblet'];

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const pp = require('puppeteer-core');

(async function () {
  const b = await pp.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--hide-scrollbars']
  });
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await require('./allow.js')(p);
  const errs = [];
  p.on('pageerror', function (e) { errs.push(e.message); });
  await p.evaluateOnNewDocument(function (key, json) {
    localStorage.setItem(key, json);
  }, M.STORAGE_KEY, JSON.stringify(data));
  const notes = function () { return p.$eval('[data-b=notes]', function (el) { return el.value; }); };
  const hits = function () {
    return p.$$eval('.name-hit', function (els) {
      return els.map(function (el) { return el.querySelector('.name').textContent; });
    });
  };
  async function replaceName(value) {
    await p.click('[data-b=name]');
    await p.evaluate(function () {
      var el = document.querySelector('[data-b=name]');
      el.focus();
      el.setSelectionRange(0, el.value.length);
    });
    await p.keyboard.type(value);
  }

  await p.goto(URL + '#/w/' + legs.id + '/ex/new');
  await p.waitForSelector('[data-b=name]');
  assert.strictEqual(await p.$eval('#title', function (el) { return el.textContent; }), 'New exercise');
  assert.strictEqual(await p.$eval('#name-suggest', function (el) { return el.hidden; }), true);
  await p.$eval('[data-b=notes]', function (el, value) {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, 'Keep this cue');
  await p.click('[data-b=name]');
  await p.keyboard.type('g');
  await p.waitForFunction(function () { return document.getElementById('name-suggest').hidden; });
  assert.deepStrictEqual(await hits(), []);
  await p.keyboard.type('ob');
  await p.waitForFunction(function () { return document.querySelectorAll('.name-hit').length === 3; });
  assert.deepStrictEqual(await hits(), GOB);
  assert.strictEqual(await notes(), 'Keep this cue');
  assert.strictEqual(await p.$('#lib-q'), null);
  const shotDir = '/opt/cursor/artifacts';
  fs.mkdirSync(shotDir, { recursive: true });
  await p.screenshot({ path: path.join(shotDir, 'name-suggestions.png') });

  await p.keyboard.press('Escape');
  await p.waitForFunction(function () { return document.getElementById('name-suggest').hidden; });
  assert.strictEqual(await p.$eval('[data-b=name]', function (el) { return el.value; }), 'gob');
  assert.strictEqual(await notes(), 'Keep this cue');
  await p.click('[data-b=name]');
  assert.strictEqual(await p.$eval('#name-suggest', function (el) { return el.hidden; }), true, 'focusing the field does not reopen the list');

  await replaceName('gob');
  await p.waitForFunction(function () { return document.querySelectorAll('.name-hit').length === 3; });
  await p.evaluate(function () {
    var labels = document.querySelectorAll('label');
    for (var i = 0; i < labels.length; i++) if (labels[i].textContent === 'Notes') labels[i].click();
  });
  await p.waitForFunction(function () { return document.getElementById('name-suggest').hidden; });
  assert.strictEqual(await notes(), 'Keep this cue', 'clicking elsewhere closes the list and leaves notes');

  await replaceName('gob');
  await p.waitForFunction(function () { return document.querySelectorAll('.name-hit').length === 3; });
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('ArrowDown');
  assert.strictEqual(await p.$eval('.name-hit.on .name', function (el) { return el.textContent; }), 'Heavy Goblet Press');
  await p.keyboard.press('Enter');
  await p.waitForFunction(function () {
    var input = document.querySelector('[data-b=name]');
    return input.value === 'Heavy Goblet Press' && document.getElementById('name-suggest').hidden;
  });
  assert.strictEqual(await notes(), 'Keep this cue', 'keyboard select does not change notes');
  const picked = await p.$eval('[data-b=name]', function (el) {
    return { value: el.value, readOnly: el.readOnly, disabled: el.disabled };
  });
  assert.deepStrictEqual(picked, { value: 'Heavy Goblet Press', readOnly: false, disabled: false });
  await p.keyboard.type(' extra');
  assert.strictEqual(await p.$eval('[data-b=name]', function (el) { return el.value; }), 'Heavy Goblet Press extra');
  assert.strictEqual(await notes(), 'Keep this cue', 'typing after a suggestion does not change notes');

  await replaceName('gob');
  await p.waitForFunction(function () { return document.querySelectorAll('.name-hit').length === 3; });
  await p.click('.name-hit');
  await p.waitForFunction(function () {
    var input = document.querySelector('[data-b=name]');
    return input.value === 'Goblet Squat' && document.getElementById('name-suggest').hidden;
  });
  assert.strictEqual(await notes(), 'Keep this cue', 'clicking a suggestion does not change notes');
  assert.strictEqual(await p.$eval('[data-b=name]', function (el) { return el.readOnly || el.disabled; }), false);

  await replaceName('Zebra carry');
  await p.waitForFunction(function () { return document.getElementById('name-suggest').hidden; });
  assert.deepStrictEqual(await hits(), []);
  assert.strictEqual(await p.$eval('[data-b=name]', function (el) { return el.value; }), 'Zebra carry');
  assert.strictEqual(await notes(), 'Keep this cue');

  await p.click('[data-seg=source][data-v=library]');
  await p.waitForSelector('#lib-q');
  assert.strictEqual(await p.$('#name-suggest'), null, 'library source has no saved-name list');
  await p.click('[data-b=name]');
  await p.keyboard.type('gob');
  assert.strictEqual(await p.$('#name-suggest'), null);
  assert.strictEqual(await notes(), 'Keep this cue', 'library name edits still leave manual notes alone');
  await p.click('[data-seg=source][data-v=custom]');
  await p.waitForSelector('#name-suggest');
  assert.strictEqual(await p.$('#lib-q'), null);
  assert.strictEqual(await notes(), 'Keep this cue');

  await p.click('[data-a=cancel]');
  await p.waitForSelector('[data-a=add]');
  await p.click('[data-a=add]');
  await p.waitForSelector('[data-b=name]');
  await p.click('[data-b=name]');
  await p.keyboard.type('dead');
  await p.waitForFunction(function () { return document.querySelectorAll('.name-hit').length === 1; });
  assert.deepStrictEqual(await hits(), ['Romanian Deadlift']);
  await p.click('[data-a=cancel]');
  await p.waitForSelector('[data-a=edit]');

  await p.evaluate(function (id) {
    document.querySelector('[data-a=edit][data-id="' + id + '"]').click();
  }, 'push');
  await p.waitForSelector('[data-b=name]');
  assert.strictEqual(await p.$eval('#title', function (el) { return el.textContent; }), 'Edit exercise');
  assert.strictEqual(await notes(), 'Ribs down');
  await replaceName('gob');
  await p.waitForFunction(function () { return document.querySelectorAll('.name-hit').length === 3; });
  assert.deepStrictEqual(await hits(), GOB, 'edit suggestions match a new exercise');
  assert.strictEqual(await notes(), 'Ribs down');
  await p.keyboard.press('Escape');
  await p.click('#back');
  await p.waitForSelector('[data-a=edit]');

  await p.goto(URL + '#/w/' + pulls.id + '/ex/rdl');
  await p.waitForSelector('[data-b=name]');
  assert.strictEqual(await p.$eval('[data-b=name]', function (el) { return el.value; }), 'Romanian Deadlift');
  assert.strictEqual(await notes(), 'Hinge');
  await replaceName('dead');
  await new Promise(function (r) { setTimeout(r, 150); });
  assert.deepStrictEqual(await hits(), [], 'the exercise being edited is skipped when it is the only source');
  assert.strictEqual(await notes(), 'Hinge');
  await p.click('#back');
  await p.waitForSelector('[data-a=edit]');

  await p.goto(URL + '#/w/' + legs.id + '/ex/goblet');
  await p.waitForSelector('[data-b=name]');
  assert.strictEqual(await notes(), 'Elbows in');
  await replaceName('gob');
  await p.waitForFunction(function () { return document.querySelectorAll('.name-hit').length === 3; });
  assert.deepStrictEqual(await hits(), GOB);
  await p.click('.name-hit');
  await p.waitForFunction(function () { return document.querySelector('[data-b=name]').value === 'Goblet Squat'; });
  assert.strictEqual(await notes(), 'Elbows in', 'picking a name on edit does not change notes');
  await replaceName('Brand new move');
  await p.waitForFunction(function () { return document.getElementById('name-suggest').hidden; });
  assert.strictEqual(await notes(), 'Elbows in', 'a new name on edit does not change notes');
  await p.click('[data-a=save]');
  await p.waitForSelector('[data-a=add]');
  const saved = await p.evaluate(function (key, workoutId) {
    var row = JSON.parse(localStorage.getItem(key)).workouts.filter(function (w) { return w.id === workoutId; })[0];
    var item = row.items.filter(function (it) { return it.id === 'goblet'; })[0];
    return { name: item.name, notes: item.notes };
  }, M.STORAGE_KEY, legs.id);
  assert.deepStrictEqual(saved, { name: 'Brand new move', notes: 'Elbows in' });

  assert.deepStrictEqual(errs, []);
  await b.close();
  console.log('NAME SUGGEST UI OK');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
