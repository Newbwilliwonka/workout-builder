// A saved custom name brings its library animation to the top of search.
// node tests/library-saved-name.test.js [url]
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const M = require('../model.js');

const CATALOG = [
  { id: 'agob', name: 'Ab goblet curl', body_part: 'waist', equipment: 'dumbbell', target: 'abs', description: 'Curl a dumbbell in a goblet grip.' },
  { id: 'cgob', name: 'Cable goblet raise', body_part: 'shoulders', equipment: 'cable', target: 'delts', description: 'Raise the cable from a goblet hold.' },
  { id: 'dsq', name: 'Dumbbell squat', body_part: 'upper legs', equipment: 'dumbbell', target: 'quads', description: 'Squat while holding a dumbbell at your chest.' },
  { id: 'bsq', name: 'Barbell squat', body_part: 'upper legs', equipment: 'barbell', target: 'quads', description: 'Squat with a bar on your back.' },
  { id: 'secret', name: 'Secret move', body_part: 'waist', equipment: 'dumbbell', target: 'abs', description: 'Not yours.' }
];
const SQUAT_DESC = CATALOG[2].description;

function workout(name, at, items, extra) {
  const w = M.newWorkout(name);
  items.forEach(function (item) {
    M.upsertExercise(w, M.newExercise({
      name: item.name,
      sets: 3,
      weight: { unit: 'lb', value: 35 },
      mode: 'reps',
      modeConfig: { repsType: 'number', count: 10, min: 8, max: 12, restSec: 60 },
      notes: item.notes || '',
      media: { kind: 'library', libraryId: item.id, view: '180' }
    }));
  });
  w.updatedAt = at;
  w.createdAt = at;
  if (extra) Object.keys(extra).forEach(function (k) { w[k] = extra[k]; });
  return w;
}

const recent = workout('Arms', 3000, [{ name: 'Slow goblet', id: 'agob', notes: 'Slow down.' }]);
const older = workout('Leg day', 1000, [{ name: 'Goblet squat', id: 'dsq', notes: 'Elbows in.' }]);
const trainer = workout('From coach', 9000, [{ name: 'Secret goblet', id: 'secret' }], { sourceTrainerId: 'tr' });
const data = M.emptyData();
data.workouts.push(older, recent, trainer);
const gobletId = older.items[0].id;

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const pp = require('puppeteer-core');

(async function () {
  const b = await pp.launch({
    executablePath: process.env.CHROME || '/usr/local/bin/google-chrome',
    args: ['--no-sandbox', '--hide-scrollbars']
  });
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await require('./allow.js')(p);
  await p.evaluateOnNewDocument(function (catalog) {
    var desc = Object.getOwnPropertyDescriptor(window, 'WBAuth');
    var current;
    function matches(row, filters, query) {
      filters = filters || {};
      if (filters.bodyPart && row.body_part !== filters.bodyPart) return false;
      if (filters.equipment && row.equipment !== filters.equipment) return false;
      if (filters.target && row.target !== filters.target) return false;
      if (query && String(row.name || '').toLowerCase().indexOf(query) < 0) return false;
      return true;
    }
    function patch(api) {
      if (!api || api.__savedStub) return api;
      api.__savedStub = true;
      api.gifBase = '';
      api.searchExercises = function (q, filters, limit, offset) {
        window.__libCalls = window.__libCalls || [];
        window.__libCalls.push({ q: q, filters: filters || {}, limit: limit, offset: offset });
        var query = String(q || '').trim().toLowerCase();
        var filtered = filters && (filters.bodyPart || filters.equipment || filters.target);
        if (query.length < 2 && !filtered) return Promise.resolve([]);
        var rows = catalog.filter(function (row) { return matches(row, filters, query); });
        rows.sort(function (a, c) { return a.name < c.name ? -1 : a.name > c.name ? 1 : 0; });
        offset = offset || 0;
        limit = limit || 20;
        return Promise.resolve(rows.slice(offset, offset + limit));
      };
      api.exercisesByIds = function (ids) {
        window.__idCalls = window.__idCalls || [];
        window.__idCalls.push((ids || []).map(String));
        var want = {};
        (ids || []).forEach(function (id) { want[String(id)] = 1; });
        return Promise.resolve(catalog.filter(function (row) { return want[String(row.id)]; }));
      };
      api.exerciseFilters = function () {
        return Promise.resolve({
          bodyParts: ['shoulders', 'upper legs', 'waist'],
          equipment: ['barbell', 'cable', 'dumbbell'],
          targets: ['abs', 'delts', 'quads']
        });
      };
      function accountOff() {
        var err = new Error('Workouts stay on this device until the account workout SQL is applied.');
        err.missing = true;
        return Promise.reject(err);
      }
      api.accountPull = accountOff;
      api.accountImport = accountOff;
      api.accountPush = accountOff;
      api.workoutCopies = function () { return Promise.resolve([]); };
      return api;
    }
    Object.defineProperty(window, 'WBAuth', {
      configurable: true,
      enumerable: true,
      get: function () { return current; },
      set: function (v) { if (desc && desc.set) desc.set(v); current = patch((desc && desc.get && desc.get()) || v); }
    });
  }, CATALOG);

  const errs = [];
  p.on('pageerror', function (e) { errs.push(e.message); });
  const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  async function setField(sel, value) {
    await p.$eval(sel, function (el, value) {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  }
  function rows() {
    return p.$$eval('.lib-hit', function (els) {
      return els.map(function (el) {
        var yours = el.querySelector('.lib-yours');
        return {
          id: el.getAttribute('data-id'),
          name: el.querySelector('.name').textContent,
          yours: yours ? yours.textContent : ''
        };
      });
    });
  }
  async function nameState() {
    return p.$eval('[data-b=name]', function (el) {
      return { value: el.value, readOnly: !!el.readOnly, disabled: !!el.disabled };
    });
  }
  async function typeOverName(value) {
    const before = await nameState();
    assert.strictEqual(before.readOnly, false, 'exercise name is read-only');
    assert.strictEqual(before.disabled, false, 'exercise name is disabled');
    await p.click('[data-b=name]');
    await p.evaluate(function () {
      var el = document.querySelector('[data-b=name]');
      el.focus();
      el.setSelectionRange(0, el.value.length);
    });
    await p.keyboard.type(value);
    await p.waitForFunction(function (value) {
      var el = document.querySelector('[data-b=name]');
      return el && el.value === value && !el.readOnly && !el.disabled;
    }, {}, value);
  }
  const gobOrder = [
    { id: 'agob', name: 'Ab goblet curl', yours: 'Your name: Slow goblet' },
    { id: 'dsq', name: 'Dumbbell squat', yours: 'Your name: Goblet squat' },
    { id: 'cgob', name: 'Cable goblet raise', yours: '' }
  ];

  await p.evaluateOnNewDocument(function (key, json) {
    if (!localStorage.getItem(key)) localStorage.setItem(key, json);
  }, M.STORAGE_KEY, JSON.stringify(data));
  await p.goto(URL + '#/w/' + older.id + '/ex/new');
  await p.waitForSelector('[data-b=name]');
  await p.click('[data-seg=source][data-v=library]');
  await p.waitForSelector('#lib-q');
  await p.waitForFunction(function () {
    return Array.prototype.some.call(document.querySelectorAll('#lib-equip option'), function (o) { return o.value === 'dumbbell'; });
  });
  await p.type('#lib-q', 'g');
  await wait(450);
  assert.deepStrictEqual(await p.evaluate(function () { return window.__idCalls || []; }), [], 'one letter does not look up saved animations');
  assert.ok((await p.$eval('#lib-results', function (el) { return el.innerText; })).indexOf('Type at least 2 letters') >= 0);

  await p.type('#lib-q', 'ob');
  await p.waitForFunction(function () { return document.querySelectorAll('.lib-hit').length === 3; });
  assert.deepStrictEqual(await rows(), gobOrder);
  const ids = (await rows()).map(function (row) { return row.id; });
  assert.strictEqual(new Set(ids).size, ids.length, 'a boosted animation is not repeated');
  assert.ok((await p.evaluate(function () { return window.__idCalls || []; })).some(function (ids) { return ids.indexOf('dsq') >= 0; }));
  assert.ok(!(await p.evaluate(function () { return JSON.stringify(window.__idCalls || []); })).includes('secret'), 'another person\'s workout is not searched');
  const newResults = await p.$eval('#lib-results', function (el) { return el.innerText; });
  await wait(200);
  const shotDir = '/opt/cursor/artifacts';
  fs.mkdirSync(shotDir, { recursive: true });
  await p.screenshot({ path: path.join(shotDir, 'after-new-exercise-search.png') });

  await p.select('#lib-equip', 'cable');
  await p.waitForFunction(function () {
    var text = document.querySelector('#lib-results').innerText;
    return text.indexOf('Cable goblet raise') >= 0 && text.indexOf('Dumbbell squat') < 0 && text.indexOf('Ab goblet curl') < 0;
  });
  await p.select('#lib-equip', 'dumbbell');
  await p.waitForFunction(function () { return document.querySelectorAll('.lib-hit').length === 2; });
  assert.deepStrictEqual(await rows(), gobOrder.slice(0, 2));
  await p.select('#lib-equip', '');
  await p.select('#lib-target', 'quads');
  await p.waitForFunction(function () {
    var hits = document.querySelectorAll('.lib-hit');
    return hits.length === 1 && hits[0].getAttribute('data-id') === 'dsq';
  });
  assert.strictEqual((await rows())[0].yours, 'Your name: Goblet squat');
  await p.select('#lib-target', '');
  await p.waitForFunction(function () { return document.querySelectorAll('.lib-hit').length === 3; });
  assert.deepStrictEqual(await rows(), gobOrder);

  await setField('#lib-q', 'squat');
  await p.waitForFunction(function () {
    var hits = document.querySelectorAll('.lib-hit');
    return hits.length === 2 && hits[0].getAttribute('data-id') === 'dsq';
  });
  assert.deepStrictEqual(await rows(), [
    { id: 'dsq', name: 'Dumbbell squat', yours: 'Your name: Goblet squat' },
    { id: 'bsq', name: 'Barbell squat', yours: '' }
  ]);
  await setField('#lib-q', 'gob');
  await p.waitForFunction(function () { return document.querySelectorAll('.lib-hit').length === 3; });
  assert.deepStrictEqual(await rows(), gobOrder);

  await p.click('[data-a=cancel]');
  await p.waitForSelector('[data-a=edit]');
  await p.evaluate(function (id) {
    document.querySelector('[data-a=edit][data-id="' + id + '"]').click();
  }, gobletId);
  await p.waitForSelector('#lib-q');
  await p.waitForFunction(function () {
    return Array.prototype.some.call(document.querySelectorAll('#lib-equip option'), function (o) { return o.value === 'dumbbell'; });
  });
  assert.strictEqual((await nameState()).value, 'Goblet squat');
  assert.strictEqual((await nameState()).readOnly, false);
  await p.type('#lib-q', 'gob');
  await p.waitForFunction(function () { return document.querySelectorAll('.lib-hit').length === 3; });
  assert.deepStrictEqual(await rows(), gobOrder);
  assert.strictEqual(await p.$eval('#lib-results', function (el) { return el.innerText; }), newResults, 'edit search matches new exercise search');
  await wait(200);
  await p.screenshot({ path: path.join(shotDir, 'after-edit-exercise-search.png') });
  await p.click('#back');
  await p.waitForSelector('[data-a=add]');
  await p.click('[data-a=add]');
  await p.waitForSelector('[data-b=name]');
  await p.click('[data-seg=source][data-v=library]');
  await p.waitForSelector('#lib-q');
  await p.type('#lib-q', 'gob');
  await p.waitForFunction(function () { return document.querySelectorAll('.lib-hit').length === 3; });

  await p.evaluate(function () {
    var hits = document.querySelectorAll('.lib-hit');
    for (var i = 0; i < hits.length; i++) {
      if (hits[i].getAttribute('data-saved-name') === 'Goblet squat') { hits[i].click(); return; }
    }
    throw new Error('missing Goblet squat result');
  });
  await p.waitForFunction(function () {
    var input = document.querySelector('[data-b=name]');
    return input && input.value === 'Goblet squat' && !input.readOnly && !input.disabled;
  });
  assert.strictEqual(await p.$eval('[data-b=notes]', function (el) { return el.value; }), SQUAT_DESC);
  assert.strictEqual(await p.$$eval('.lib-hit', function (els) { return els.length; }), 0, 'picking still collapses the list');
  await typeOverName('Front squat');
  assert.strictEqual((await nameState()).value, 'Front squat');
  await p.keyboard.press('Backspace');
  await p.keyboard.press('Backspace');
  await p.keyboard.press('Backspace');
  await p.keyboard.press('Backspace');
  await p.keyboard.press('Backspace');
  await p.keyboard.type('squat');
  assert.strictEqual((await nameState()).value, 'Front squat');
  await p.keyboard.press('Tab');
  await wait(50);
  assert.strictEqual((await nameState()).value, 'Front squat', 'leaving the field keeps the edited name');
  assert.strictEqual(await p.$eval('[data-b=notes]', function (el) { return el.value; }), SQUAT_DESC, 'editing the prefilled name keeps the library notes');
  await p.click('[data-seg=mode][data-v=timer]');
  assert.strictEqual((await nameState()).value, 'Front squat', 'switching mode keeps the edited name');
  assert.strictEqual((await nameState()).readOnly, false);
  assert.strictEqual(await p.$eval('[data-b=notes]', function (el) { return el.value; }), SQUAT_DESC, 'switching mode keeps the library notes');
  await p.click('[data-seg=mode][data-v=reps]');
  assert.strictEqual((await nameState()).value, 'Front squat');
  assert.strictEqual(await p.$eval('[data-b=notes]', function (el) { return el.value; }), SQUAT_DESC);
  await p.$eval('[data-b=name]', function (el) { el.scrollIntoView({ block: 'center' }); });
  await wait(100);
  await p.screenshot({ path: path.join(shotDir, 'after-name-edited.png') });
  await p.$eval('[data-a=save]', function (el) { el.scrollIntoView({ block: 'center' }); });
  await p.click('[data-a=save]');
  await p.waitForSelector('[data-a=add]');
  const added = await p.evaluate(function (k) {
    var items = JSON.parse(localStorage.getItem(k)).workouts.filter(function (w) { return w.name === 'Leg day'; })[0].items;
    return items.filter(function (it) { return it.name === 'Front squat'; })[0];
  }, M.STORAGE_KEY);
  assert.strictEqual(added.name, 'Front squat');
  assert.strictEqual(added.notes, SQUAT_DESC, 'saving a renamed new exercise keeps the library description');
  assert.deepStrictEqual(added.media, { kind: 'library', libraryId: 'dsq', view: '180' });

  await p.evaluate(function (id) {
    document.querySelector('[data-a=edit][data-id="' + id + '"]').click();
  }, gobletId);
  await p.waitForSelector('#lib-q');
  await p.type('#lib-q', 'gob');
  await p.waitForFunction(function () {
    return Array.prototype.some.call(document.querySelectorAll('.lib-hit'), function (hit) {
      return hit.getAttribute('data-saved-name') === 'Goblet squat';
    });
  });
  await p.evaluate(function () {
    var hits = document.querySelectorAll('.lib-hit');
    for (var i = 0; i < hits.length; i++) {
      if (hits[i].getAttribute('data-saved-name') === 'Goblet squat') { hits[i].click(); return; }
    }
    throw new Error('missing Goblet squat result on edit');
  });
  await p.waitForFunction(function () {
    var input = document.querySelector('[data-b=name]');
    return input && input.value === 'Goblet squat';
  });
  await typeOverName('Tempo squat');
  await p.click('[data-seg=mode][data-v=stopwatch]');
  assert.strictEqual((await nameState()).value, 'Tempo squat');
  assert.strictEqual((await nameState()).disabled, false);
  assert.strictEqual(await p.$eval('[data-b=notes]', function (el) { return el.value; }), SQUAT_DESC, 'editing the name on an existing exercise keeps the library notes');
  await p.click('[data-seg=mode][data-v=reps]');
  assert.strictEqual(await p.$eval('[data-b=notes]', function (el) { return el.value; }), SQUAT_DESC);
  await p.$eval('[data-a=save]', function (el) { el.scrollIntoView({ block: 'center' }); });
  await p.click('[data-a=save]');
  await p.waitForSelector('[data-a=add]');
  const edited = await p.evaluate(function (k, id) {
    var items = JSON.parse(localStorage.getItem(k)).workouts.filter(function (w) { return w.name === 'Leg day'; })[0].items;
    return items.filter(function (it) { return it.id === id; })[0];
  }, M.STORAGE_KEY, gobletId);
  assert.strictEqual(edited.name, 'Tempo squat');
  assert.strictEqual(edited.notes, SQUAT_DESC, 'saving a renamed existing exercise keeps the library description');
  assert.deepStrictEqual(edited.media, { kind: 'library', libraryId: 'dsq', view: '180' });

  await p.evaluate(function (id) {
    document.querySelector('[data-a=edit][data-id="' + id + '"]').click();
  }, gobletId);
  await p.waitForSelector('[data-b=name]');
  assert.strictEqual((await nameState()).value, 'Tempo squat');
  assert.strictEqual(await p.$eval('[data-b=notes]', function (el) { return el.value; }), SQUAT_DESC);
  await typeOverName('Easy squat');
  assert.strictEqual(await p.$eval('[data-b=notes]', function (el) { return el.value; }), SQUAT_DESC, 'renaming a saved library exercise keeps its notes');
  await p.$eval('[data-a=save]', function (el) { el.scrollIntoView({ block: 'center' }); });
  await p.click('[data-a=save]');
  await p.waitForSelector('[data-a=add]');
  const renamed = await p.evaluate(function (k, id) {
    var items = JSON.parse(localStorage.getItem(k)).workouts.filter(function (w) { return w.name === 'Leg day'; })[0].items;
    return items.filter(function (it) { return it.id === id; })[0];
  }, M.STORAGE_KEY, gobletId);
  assert.strictEqual(renamed.name, 'Easy squat');
  assert.strictEqual(renamed.notes, SQUAT_DESC, 'saving after a later name edit keeps the library notes');
  assert.deepStrictEqual(renamed.media, { kind: 'library', libraryId: 'dsq', view: '180' });

  assert.deepStrictEqual(errs, []);
  console.log('SAVED NAME SEARCH OK');
  await b.close();
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
