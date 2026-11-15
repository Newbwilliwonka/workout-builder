// Stopwatch event-name suggestions. node tests/event-suggest-ui.test.js [url]
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
      sets: item.sets || 1,
      weight: { unit: 'bodyweight', value: null },
      mode: item.mode || 'reps',
      modeConfig: item.modeConfig || { repsType: 'number', count: 10, min: 8, max: 12, restSec: 0 }
    });
    ex.id = item.id;
    M.upsertExercise(w, ex);
  });
  w.updatedAt = at;
  w.createdAt = at;
  if (extra) Object.keys(extra).forEach(function (k) { w[k] = extra[k]; });
  return w;
}

const existing = workout('Tuesday', 5000, [
  {
    id: 'shuttle',
    name: 'Shuttle',
    notes: 'Keep this cue',
    mode: 'stopwatch',
    modeConfig: {
      lapsEnabled: true,
      lapCount: 2,
      events: [
        { lap: 1, name: 'Block a shot' },
        { lap: 2, name: 'Old mark' }
      ]
    }
  },
  {
    id: 'goblet',
    name: 'Goblet Squat',
    notes: 'Elbows in',
    mode: 'reps',
    modeConfig: { repsType: 'number', count: 10, min: 8, max: 12, restSec: 60 }
  }
]);
const mid = workout('Later', 4000, [{
  id: 'again',
  name: 'Again',
  mode: 'stopwatch',
  modeConfig: {
    lapsEnabled: true,
    lapCount: 2,
    events: [
      { lap: 1, name: 'Score a goal' },
      { lap: 2, name: 'Score a try' }
    ]
  }
}]);
const kick = workout('Finish', 3000, [{
  id: 'kick',
  name: 'Finisher',
  mode: 'stopwatch',
  modeConfig: { lapsEnabled: true, lapCount: 1, events: [{ lap: 1, name: 'Goal kick' }] }
}]);
const older = workout('Older', 2000, [{
  id: 'lower',
  name: 'Lower',
  mode: 'stopwatch',
  modeConfig: { lapsEnabled: true, lapCount: 1, events: [{ lap: 1, name: 'score a goal' }] }
}]);
const defend = workout('Defense', 4500, [{
  id: 'defend',
  name: 'Defense',
  mode: 'stopwatch',
  modeConfig: { lapsEnabled: true, lapCount: 1, events: [{ lap: 1, name: 'Defend a pass' }] }
}]);
const trainer = workout('From coach', 9000, [{
  id: 'secret',
  name: 'Secret',
  mode: 'stopwatch',
  modeConfig: { lapsEnabled: true, lapCount: 1, events: [{ lap: 1, name: 'Score a header' }] }
}], { sourceTrainerId: 'tr' });
const fresh = workout('New workout', 1000, []);
const data = M.emptyData();
data.workouts.push(existing, mid, kick, older, defend, trainer, fresh);
const SCO = ['Score a goal', 'Score a try'];

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
    return p.$$eval('.event-suggest .name-hit', function (els) {
      return els.map(function (el) { return el.querySelector('.name').textContent; });
    });
  };
  async function replaceEvent(sel, value) {
    await p.click(sel);
    await p.evaluate(function (sel) {
      var el = document.querySelector(sel);
      el.focus();
      el.setSelectionRange(0, el.value.length);
    }, sel);
    await p.keyboard.type(value);
  }
  async function showNewEventField() {
    await p.waitForSelector('[data-b=name]');
    await p.click('[data-seg=mode][data-v=stopwatch]');
    await p.waitForSelector('[data-lev="0"]');
    const lapsOn = await p.$eval('[data-b="cfg.lapsEnabled"]', function (el) { return el.checked; });
    assert.strictEqual(lapsOn, true);
    if (!await p.$('[data-lename="0"]')) await p.click('[data-lev="0"]');
    await p.waitForSelector('[data-lename="0"]');
    await p.waitForSelector('#event-suggest-0');
  }

  await p.goto(URL + '#/w/' + fresh.id + '/ex/new');
  await showNewEventField();
  assert.strictEqual(await p.$eval('#title', function (el) { return el.textContent; }), 'New exercise');
  assert.strictEqual(await p.$eval('#event-suggest-0', function (el) { return el.hidden; }), true);
  await p.$eval('[data-b=notes]', function (el, value) {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, 'Keep this cue');
  await p.click('[data-lename="0"]');
  await p.keyboard.type('s');
  await p.waitForFunction(function () { return document.getElementById('event-suggest-0').hidden; });
  assert.deepStrictEqual(await hits(), []);
  await p.keyboard.type('co');
  await p.waitForFunction(function () { return document.querySelectorAll('.event-suggest .name-hit').length === 2; });
  const onNewWorkout = await hits();
  assert.deepStrictEqual(onNewWorkout, SCO);
  assert.strictEqual(await notes(), 'Keep this cue');
  assert.strictEqual(await p.$eval('[data-lename="0"]', function (el) { return el.getAttribute('aria-expanded'); }), 'true');
  assert.strictEqual(await p.$eval('[data-lename="0"]', function (el) { return el.hasAttribute('aria-activedescendant'); }), false);
  const shotDir = '/opt/cursor/artifacts';
  fs.mkdirSync(shotDir, { recursive: true });
  await p.screenshot({ path: path.join(shotDir, 'event-name-suggestions.png') });

  await p.keyboard.press('Escape');
  await p.waitForFunction(function () { return document.getElementById('event-suggest-0').hidden; });
  assert.strictEqual(await p.$eval('[data-lename="0"]', function (el) { return el.value; }), 'sco');
  assert.strictEqual(await p.$eval('[data-lename="0"]', function (el) { return el.getAttribute('aria-expanded'); }), 'false');
  assert.strictEqual(await notes(), 'Keep this cue');
  await p.click('[data-lename="0"]');
  assert.strictEqual(await p.$eval('#event-suggest-0', function (el) { return el.hidden; }), true, 'focusing the field does not reopen the list');

  await replaceEvent('[data-lename="0"]', 'sco');
  await p.waitForFunction(function () { return document.querySelectorAll('.event-suggest .name-hit').length === 2; });
  await p.evaluate(function () {
    var labels = document.querySelectorAll('label');
    for (var i = 0; i < labels.length; i++) if (labels[i].textContent === 'Notes') labels[i].click();
  });
  await p.waitForFunction(function () { return document.getElementById('event-suggest-0').hidden; });
  assert.strictEqual(await notes(), 'Keep this cue', 'clicking elsewhere closes the list and leaves notes');

  await replaceEvent('[data-lename="0"]', 'sco');
  await p.waitForFunction(function () { return document.querySelectorAll('.event-suggest .name-hit').length === 2; });
  const imeMoved = await p.evaluate(function () {
    var input = document.querySelector('[data-lename="0"]');
    input.focus();
    var down = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true, isComposing: true });
    var enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true });
    input.dispatchEvent(down);
    input.dispatchEvent(enter);
    return { on: document.querySelectorAll('.event-suggest .name-hit.on').length, value: input.value, downDefault: down.defaultPrevented, enterDefault: enter.defaultPrevented };
  });
  assert.deepStrictEqual(imeMoved, { on: 0, value: 'sco', downDefault: false, enterDefault: false }, 'IME composition keeps the suggestion keys');
  await p.keyboard.press('ArrowDown');
  assert.strictEqual(await p.$eval('[data-lename="0"]', function (el) { return el.getAttribute('aria-activedescendant'); }), 'event-suggest-0-opt-0');
  await p.keyboard.type('r');
  await p.waitForFunction(function () {
    var input = document.querySelector('[data-lename="0"]');
    return input.value === 'scor' && !input.hasAttribute('aria-activedescendant') && !document.querySelector('.event-suggest .name-hit.on');
  });
  await p.keyboard.press('Enter');
  assert.strictEqual(await p.$eval('[data-lename="0"]', function (el) { return el.value; }), 'scor', 'Enter after more typing does not accept a stale highlight');
  assert.strictEqual(await notes(), 'Keep this cue');

  await replaceEvent('[data-lename="0"]', 'sco');
  await p.waitForFunction(function () { return document.querySelectorAll('.event-suggest .name-hit').length === 2; });
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('ArrowDown');
  assert.strictEqual(await p.$eval('.event-suggest .name-hit.on .name', function (el) { return el.textContent; }), 'Score a try');
  await p.keyboard.press('Enter');
  await p.waitForFunction(function () {
    var input = document.querySelector('[data-lename="0"]');
    return input.value === 'Score a try' && document.getElementById('event-suggest-0').hidden;
  });
  assert.strictEqual(await notes(), 'Keep this cue', 'keyboard select does not change notes');
  assert.strictEqual(await p.$eval('[data-b=name]', function (el) { return el.value; }), '', 'picking an event name does not fill the exercise name');
  await p.keyboard.type(' extra');
  assert.strictEqual(await p.$eval('[data-lename="0"]', function (el) { return el.value; }), 'Score a try extra');
  assert.strictEqual(await notes(), 'Keep this cue');

  await replaceEvent('[data-lename="0"]', 'sco');
  await p.waitForFunction(function () { return document.querySelectorAll('.event-suggest .name-hit').length === 2; });
  await p.click('.event-suggest .name-hit');
  await p.waitForFunction(function () {
    var input = document.querySelector('[data-lename="0"]');
    return input.value === 'Score a goal' && document.getElementById('event-suggest-0').hidden;
  });
  assert.strictEqual(await notes(), 'Keep this cue', 'clicking a suggestion does not change notes');

  await replaceEvent('[data-lename="0"]', 'Score a goal');
  await p.waitForFunction(function () { return document.getElementById('event-suggest-0').hidden; });
  assert.deepStrictEqual(await hits(), [], 'the exact saved spelling is not offered again');
  await replaceEvent('[data-lename="0"]', 'score a goal');
  await p.waitForFunction(function () { return document.querySelectorAll('.event-suggest .name-hit').length === 1; });
  assert.deepStrictEqual(await hits(), ['Score a goal'], 'a different case still offers the saved spelling');
  await p.click('.event-suggest .name-hit');
  await p.waitForFunction(function () { return document.querySelector('[data-lename="0"]').value === 'Score a goal'; });
  assert.strictEqual(await notes(), 'Keep this cue');

  await replaceEvent('[data-lename="0"]', 'gob');
  await p.waitForFunction(function () { return document.getElementById('event-suggest-0').hidden; });
  assert.deepStrictEqual(await hits(), [], 'exercise names are not event suggestions');
  await p.click('[data-b=name]');
  await p.keyboard.type('gob');
  await p.waitForFunction(function () { return document.querySelectorAll('#name-suggest .name-hit').length === 1; });
  assert.deepStrictEqual(await p.$$eval('#name-suggest .name-hit .name', function (els) {
    return els.map(function (el) { return el.textContent; });
  }), ['Goblet Squat']);
  assert.strictEqual(await p.$eval('#event-suggest-0', function (el) { return el.hidden; }), true);
  assert.strictEqual(await p.$eval('[data-lename="0"]', function (el) { return el.value; }), 'gob');
  assert.strictEqual(await notes(), 'Keep this cue', 'exercise name suggestions still leave notes alone');

  await p.goto(URL + '#/w/' + existing.id + '/ex/new');
  await showNewEventField();
  assert.strictEqual(await p.$eval('#title', function (el) { return el.textContent; }), 'New exercise');
  await p.click('[data-lename="0"]');
  await p.keyboard.type('sco');
  await p.waitForFunction(function () { return document.querySelectorAll('.event-suggest .name-hit').length === 2; });
  assert.deepStrictEqual(await hits(), onNewWorkout, 'a new exercise on an existing workout matches a new workout');
  await replaceEvent('[data-lename="0"]', 'blo');
  await p.waitForFunction(function () { return document.querySelectorAll('.event-suggest .name-hit').length === 1; });
  const blockHits = await hits();
  assert.deepStrictEqual(blockHits, ['Block a shot']);

  await p.goto(URL + '#/w/' + existing.id + '/ex/shuttle');
  await p.waitForSelector('[data-lename="0"]');
  assert.strictEqual(await p.$eval('#title', function (el) { return el.textContent; }), 'Edit exercise');
  assert.strictEqual(await notes(), 'Keep this cue');
  assert.strictEqual(await p.$eval('[data-lename="0"]', function (el) { return el.value; }), 'Block a shot');
  assert.strictEqual(await p.$eval('[data-lename="1"]', function (el) { return el.value; }), 'Old mark');
  await replaceEvent('[data-lename="0"]', 'sco');
  await p.waitForFunction(function () { return document.querySelectorAll('.event-suggest .name-hit').length === 2; });
  assert.deepStrictEqual(await hits(), onNewWorkout, 'edit workout suggestions match a new workout');
  assert.strictEqual(await notes(), 'Keep this cue');
  assert.strictEqual(await p.$eval('[data-lename="1"]', function (el) { return el.value; }), 'Old mark');
  await replaceEvent('[data-lename="0"]', 'blo');
  await p.waitForFunction(function () { return document.querySelectorAll('.event-suggest .name-hit').length === 1; });
  assert.deepStrictEqual(await hits(), blockHits, 'editing the only saved event still offers that name');
  await p.keyboard.press('Escape');
  await replaceEvent('[data-lename="1"]', 'def');
  await p.waitForFunction(function () { return document.querySelectorAll('#event-suggest-1 .name-hit').length === 1; });
  assert.deepStrictEqual(await hits(), ['Defend a pass']);
  assert.strictEqual(await p.$eval('#event-suggest-0', function (el) { return el.hidden; }), true, 'the other lap list closes');
  assert.strictEqual(await p.$eval('[data-lename="0"]', function (el) { return el.value; }), 'blo');
  await p.keyboard.press('ArrowDown');
  assert.strictEqual(await p.$eval('[data-lename="1"]', function (el) { return el.getAttribute('aria-activedescendant'); }), 'event-suggest-1-opt-0');
  await p.keyboard.press('Enter');
  await p.waitForFunction(function () { return document.querySelector('[data-lename="1"]').value === 'Defend a pass'; });
  assert.strictEqual(await p.$eval('[data-lename="0"]', function (el) { return el.value; }), 'blo');
  assert.strictEqual(await notes(), 'Keep this cue', 'picking on another lap does not change notes');
  await replaceEvent('[data-lename="0"]', 'sco');
  await p.waitForFunction(function () { return document.querySelectorAll('.event-suggest .name-hit').length === 2; });
  await p.click('.event-suggest .name-hit');
  await p.waitForFunction(function () { return document.querySelector('[data-lename="0"]').value === 'Score a goal'; });
  assert.strictEqual(await p.$eval('[data-lename="1"]', function (el) { return el.value; }), 'Defend a pass');
  assert.strictEqual(await notes(), 'Keep this cue');
  await p.click('[data-a=save]');
  await p.waitForSelector('[data-a=add]');
  const saved = await p.evaluate(function (key, workoutId) {
    var row = JSON.parse(localStorage.getItem(key)).workouts.filter(function (w) { return w.id === workoutId; })[0];
    var item = row.items.filter(function (it) { return it.id === 'shuttle'; })[0];
    return { name: item.name, notes: item.notes, events: item.modeConfig.events };
  }, M.STORAGE_KEY, existing.id);
  assert.deepStrictEqual(saved, {
    name: 'Shuttle',
    notes: 'Keep this cue',
    events: [
      { lap: 1, name: 'Score a goal' },
      { lap: 2, name: 'Defend a pass' }
    ]
  });

  assert.deepStrictEqual(errs, []);
  await b.close();
  console.log('EVENT SUGGEST UI OK');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
