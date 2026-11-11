// Library search/select and an image that stays on this device.
// node tests/library-ui.test.js [url]
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const M = require('../model.js');

(function walk(dir) {
  fs.readdirSync(dir).forEach(function (name) {
    if (name === '.git' || name === 'node_modules') return;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) return walk(p);
    if (/exerciseData|starter\.zip/i.test(name)) throw new Error('ExerciseDB raw file in the project: ' + p);
    if (name.endsWith('.gif')) throw new Error('GIF in the project: ' + p);
  });
})(path.join(__dirname, '..'));

const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261109195000_exercises.sql'), 'utf8');
assert.ok(/enable row level security/i.test(sql));
assert.ok(/grant select on public\.exercises to authenticated/i.test(sql));
assert.ok(/to authenticated/.test(sql));
assert.ok(!/for select\s+to anon/i.test(sql));
assert.ok(!/insert into public\.exercises/i.test(sql));
assert.ok(/search_exercises/.test(sql));
assert.ok(/least\(greatest\(coalesce\(p_limit/.test(sql));
assert.ok(!/3\/4 sit-up/.test(sql));
assert.ok(/description text not null default ''/.test(sql));

const searchSql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261110220000_exercise_search_description.sql'), 'utf8');
assert.ok(/drop function if exists public\.search_exercises\(text, text, text, text, integer, integer\)/i.test(searchSql));
assert.ok(/description text/.test(searchSql));
assert.ok(/e\.id, e\.name, e\.body_part, e\.equipment, e\.target, e\.description/.test(searchSql));
assert.ok(/grant execute on function public\.search_exercises\(text, text, text, text, integer, integer\) to authenticated/.test(searchSql));
assert.ok(/revoke all on function public\.search_exercises\(text, text, text, text, integer, integer\) from public, anon/.test(searchSql));
assert.ok(!/insert into public\.exercises/i.test(searchSql));
assert.ok(!/3\/4 sit-up/.test(searchSql));

const PRESS_DESC = 'Lower the bar to your chest, then press it up until your arms are straight.';
const OTHER_DESC = 'Press the dumbbells from shoulder height overhead, then lower them with control.';
assert.ok(PRESS_DESC.length >= 52 && PRESS_DESC.length <= 237, PRESS_DESC.length);
assert.ok(OTHER_DESC.length >= 52 && OTHER_DESC.length <= 237, OTHER_DESC.length);

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const pp = require('puppeteer-core');
const w = M.newWorkout('Library');
const data = M.emptyData();
data.workouts.push(w);

(async () => {
  const b = await pp.launch({ executablePath: process.env.CHROME || '/usr/local/bin/google-chrome', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true });
  await require('./allow.js')(p);
  await p.evaluateOnNewDocument(function (pressDesc, otherDesc) {
    var desc = Object.getOwnPropertyDescriptor(window, 'WBAuth');
    var current;
    function patch(api) {
      if (!api || api.__libStub) return api;
      api.__libStub = true;
      api.gifBase = '';
      api.searchExercises = function (q, filters, limit, offset) {
        window.__libCalls = window.__libCalls || [];
        window.__libCalls.push({ q: q, filters: filters || {}, limit: limit, offset: offset });
        var query = String(q || '').toLowerCase();
        var filtered = filters && (filters.bodyPart || filters.equipment || filters.target);
        if (query.indexOf('press') < 0 && !filtered) return Promise.resolve([]);
        if (offset) return Promise.resolve([]);
        return Promise.resolve([
          { id: '0101', name: 'Test press', body_part: 'chest', equipment: 'barbell', target: 'pectorals', description: pressDesc },
          { id: '0102', name: 'Other press', body_part: 'chest', equipment: 'dumbbell', target: 'pectorals', description: otherDesc },
          { id: '0103', name: 'No cue press', body_part: 'chest', equipment: 'barbell', target: 'pectorals', description: '' }
        ]);
      };
      api.exerciseFilters = function () {
        window.__filterCalls = (window.__filterCalls || 0) + 1;
        return Promise.resolve({ bodyParts: ['chest', 'waist'], equipment: ['barbell', 'dumbbell'], targets: ['pectorals'] });
      };
      return api;
    }
    Object.defineProperty(window, 'WBAuth', {
      configurable: true,
      enumerable: true,
      get: function () { return current; },
      set: function (v) { if (desc && desc.set) desc.set(v); current = patch((desc && desc.get && desc.get()) || v); }
    });
  }, PRESS_DESC, OTHER_DESC);
  const errs = [];
  p.on('pageerror', function (e) { errs.push(e.message); });
  p.on('dialog', function (d) { d.accept(); });
  const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  const notes = function () { return p.$eval('[data-b=notes]', function (el) { return el.value; }); };
  async function setField(sel, value) {
    await p.$eval(sel, function (el, value) {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  }
  async function setNotes(value) { await setField('[data-b=notes]', value); }
  async function setName(value) { await setField('[data-b=name]', value); }
  async function showResults() {
    if (await p.$('.lib-hit')) return;
    await p.evaluate(function () {
      var input = document.getElementById('lib-q');
      input.value = /\s$/.test(input.value) ? input.value.slice(0, -1) : input.value + ' ';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await p.waitForSelector('.lib-hit');
  }
  async function pickNamed(name) {
    await showResults();
    await p.evaluate(function (name) {
      var hits = document.querySelectorAll('.lib-hit');
      for (var i = 0; i < hits.length; i++) {
        var label = hits[i].querySelector('.name');
        if (label && label.textContent === name) { hits[i].click(); return; }
      }
      throw new Error('no library hit named ' + name);
    }, name);
    await p.waitForFunction(function (name) {
      var input = document.querySelector('[data-b=name]');
      return input && input.value === name;
    }, {}, name);
  }
  await p.goto(URL);
  await p.evaluate(function (k, v) { localStorage.setItem(k, v); }, M.STORAGE_KEY, JSON.stringify(data));
  await p.goto(URL + '#/w/' + w.id);
  await p.reload();
  await p.waitForSelector('[data-a=add]');
  await p.click('[data-a=add]');
  await p.waitForSelector('[data-b=name]');
  assert.strictEqual(await p.$('#lib-q'), null, 'a new exercise starts on Enter manually');
  assert.deepStrictEqual(await p.$$eval('[data-seg=source]', function (els) { return els.map(function (el) { return el.textContent; }); }), ['Enter manually', 'Exercise library']);
  assert.strictEqual(await p.$eval('[data-b=name]', function (el) { return el.placeholder; }), 'e.g. Goblet squat');
  assert.strictEqual(await notes(), '', 'a manual exercise starts with empty notes');
  await setNotes('My cue');
  await p.click('[data-seg=source][data-v=library]');
  await p.waitForSelector('#lib-q');
  await wait(400);
  assert.deepStrictEqual(await p.evaluate(function () { return window.__libCalls || []; }), [], 'opening the library does not download it');
  await p.click('[data-seg=source][data-v=custom]');
  assert.strictEqual(await notes(), 'My cue', 'Enter manually keeps notes when no library exercise is selected');
  await p.click('[data-seg=source][data-v=library]');
  await p.waitForSelector('#lib-q');
  await p.type('#lib-q', 'p');
  await wait(450);
  assert.deepStrictEqual(await p.evaluate(function () { return window.__libCalls || []; }), [], 'one letter does not search');
  await p.waitForFunction(function () { return Array.prototype.some.call(document.querySelectorAll('#lib-body option'), function (o) { return o.value === 'chest'; }); });
  await p.select('#lib-body', 'chest');
  await p.waitForFunction(function () { return (window.__libCalls || []).some(function (c) { return c.filters && c.filters.bodyPart === 'chest' && c.q === 'p'; }); });
  await p.type('#lib-q', 'ress');
  await p.waitForFunction(function () { return (window.__libCalls || []).some(function (c) { return c.q === 'press'; }); });
  const call = await p.evaluate(function () { return window.__libCalls.filter(function (c) { return c.q === 'press'; })[0]; });
  assert.strictEqual(call.limit, 21);
  assert.strictEqual(call.offset, 0);
  assert.ok(call.limit <= 30);
  await p.waitForSelector('.lib-hit');
  assert.strictEqual(await p.$$eval('.lib-hit', function (a) { return a.length; }), 3);
  assert.strictEqual(await notes(), 'My cue', 'searching the library does not change typed notes');
  await p.click('.lib-hit');
  assert.strictEqual(await p.$eval('[data-b=name]', function (el) { return el.value; }), 'Test press');
  assert.strictEqual(await p.$eval('#lib-q', function (el) { return el.value; }), 'press', 'picking leaves the search text alone');
  assert.strictEqual(await p.$$eval('.lib-hit', function (a) { return a.length; }), 0, 'picking collapses the library results');
  assert.strictEqual(await notes(), PRESS_DESC, 'picking a library exercise replaces typed notes');
  await p.select('#lib-body', 'waist');
  await p.waitForFunction(function () {
    return (window.__libCalls || []).some(function (c) { return c.filters && c.filters.bodyPart === 'waist'; });
  });
  await wait(50);
  assert.strictEqual(await p.$$eval('.lib-hit', function (a) { return a.length; }), 0, 'a filter change does not reopen collapsed results');
  assert.strictEqual(await notes(), PRESS_DESC, 'changing a library filter does not change notes');
  await setNotes('');
  await pickNamed('Test press');
  assert.strictEqual(await notes(), PRESS_DESC);
  await setNotes('   ');
  await pickNamed('Other press');
  assert.strictEqual(await notes(), OTHER_DESC, 'picking a library exercise replaces whitespace notes');
  await pickNamed('Test press');
  assert.strictEqual(await notes(), PRESS_DESC, 'picking another library exercise replaces the notes');
  await setNotes(PRESS_DESC + ' Stay tight.');
  await pickNamed('Other press');
  assert.strictEqual(await notes(), OTHER_DESC, 'picking a library exercise replaces notes the user edited');
  await setNotes(OTHER_DESC + ' Stay tight.');
  assert.strictEqual(await notes(), OTHER_DESC + ' Stay tight.', 'notes stay editable after a library description is filled');
  await pickNamed('Other press');
  assert.strictEqual(await notes(), OTHER_DESC, 'picking the same library exercise again replaces edited notes');
  await pickNamed('No cue press');
  assert.strictEqual(await notes(), '', 'a library exercise with no description clears the previous notes');
  await pickNamed('Test press');
  assert.strictEqual(await notes(), PRESS_DESC);
  await p.$eval('[data-b=name]', function (el) { el.dispatchEvent(new Event('change', { bubbles: true })); });
  assert.strictEqual(await notes(), PRESS_DESC, 'leaving the library name unchanged keeps its notes');
  await setName('Test press custom');
  assert.strictEqual(await notes(), '', 'typing a name over a library exercise clears its notes');
  assert.strictEqual(await p.$$eval('.lib-hit', function (a) { return a.length; }), 0, 'typing a name does not reopen library results');
  assert.ok(await p.$('#lib-q'), 'typing a name leaves the library search in place');
  await setNotes('After rename');
  await setName('Hip thrust');
  assert.strictEqual(await notes(), 'After rename', 'notes typed for the manual exercise stay while its name is edited');
  await p.click('[data-seg=source][data-v=custom]');
  assert.strictEqual(await p.$('#lib-q'), null);
  assert.strictEqual(await notes(), 'After rename', 'Enter manually keeps notes already written for the manual exercise');
  await p.click('[data-seg=mode][data-v=timer]');
  assert.strictEqual(await notes(), 'After rename', 'notes stay while the same manual exercise is edited');
  await p.click('[data-seg=mode][data-v=reps]');
  await p.click('[data-seg=source][data-v=library]');
  await p.waitForSelector('#lib-q');
  await pickNamed('Test press');
  assert.strictEqual(await notes(), PRESS_DESC);
  assert.ok((await p.$eval('.media', function (el) { return el.textContent; })).includes('once'));
  const shotDir = '/opt/cursor/artifacts';
  fs.mkdirSync(shotDir, { recursive: true });
  await p.screenshot({ path: path.join(shotDir, 'library_exercise_editor.png'), fullPage: true });
  await p.evaluate(function () {
    var field = document.querySelector('[data-b=notes]');
    var top = field.getBoundingClientRect().bottom + window.scrollY - (window.innerHeight - 36);
    window.scrollTo(0, Math.max(0, top));
  });
  await wait(100);
  await p.screenshot({ path: path.join(shotDir, 'editor_notes_filled.png') });
  await p.evaluate(function () { window.scrollTo(0, 0); });
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  await p.setRequestInterception(true);
  p.on('request', function (req) {
    if (/\.gif(\?|$)/.test(req.url())) req.respond({ status: 200, contentType: 'image/gif', body: gif });
    else req.continue();
  });
  await p.evaluate(function () { window.WBAuth.gifBase = 'https://cdn.example.test/exercises'; });
  await p.click('[data-seg=view][data-v="360"]');
  await p.waitForSelector('.media img');
  assert.strictEqual(await p.$eval('.media img', function (el) { return el.src; }), 'https://cdn.example.test/exercises/360/0101.gif');
  await p.waitForFunction(function () {
    var img = document.querySelector('.media img');
    return img && img.complete && img.naturalWidth > 0;
  });
  await p.$eval('[data-a=save]', function (el) { el.scrollIntoView({ block: 'center' }); });
  await p.click('[data-a=save]');
  await p.waitForSelector('[data-a=add]');
  const saved = await p.evaluate(function (k) { return JSON.parse(localStorage.getItem(k)).workouts[0].items[0]; }, M.STORAGE_KEY);
  assert.strictEqual(saved.name, 'Test press');
  assert.strictEqual(saved.notes, PRESS_DESC);
  assert.deepStrictEqual(saved.media, { kind: 'library', libraryId: '0101', view: '360' });
  assert.ok(!JSON.stringify(saved).includes('cdn.example'));
  assert.ok(!JSON.stringify(saved).includes('.gif'));

  await p.click('[data-a=edit]');
  await p.waitForSelector('.media img');
  assert.strictEqual(await notes(), PRESS_DESC);
  await p.click('[data-seg=source][data-v=custom]');
  assert.strictEqual(await notes(), '', 'Enter manually clears notes saved from the previous library exercise');
  await setNotes('Kept for this manual exercise');
  await setName('Renamed press');
  assert.strictEqual(await notes(), 'Kept for this manual exercise', 'manual notes stay while that exercise is renamed');
  await p.click('[data-seg=source][data-v=library]');
  await p.waitForSelector('#lib-q');
  await p.type('#lib-q', 'press');
  await p.waitForSelector('.lib-hit');
  await pickNamed('Other press');
  assert.strictEqual(await notes(), OTHER_DESC, 'picking a library exercise replaces notes saved on this exercise');
  await p.$eval('[data-a=save]', function (el) { el.scrollIntoView({ block: 'center' }); });
  await p.click('[data-a=save]');
  await p.waitForSelector('[data-a=add]');
  const replaced = await p.evaluate(function (k) { return JSON.parse(localStorage.getItem(k)).workouts[0].items[0]; }, M.STORAGE_KEY);
  assert.strictEqual(replaced.name, 'Other press');
  assert.strictEqual(replaced.notes, OTHER_DESC);
  await p.click('[data-a=add]');
  await p.waitForSelector('[data-b=name]');
  await setNotes('Mine');
  await p.type('[data-b=name]', 'My move');
  assert.strictEqual(await notes(), 'Mine', 'typing a manual name keeps notes when no library exercise was chosen');
  await setNotes('');
  assert.strictEqual(await notes(), '', 'a manual exercise does not auto-fill notes');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const photo = '/tmp/wb-tiny-photo.png';
  fs.writeFileSync(photo, png);
  const input = await p.$('#ex-photo');
  await input.uploadFile(photo);
  await p.waitForSelector('.media img');
  await wait(2300);
  await p.screenshot({ path: path.join(shotDir, 'custom_exercise_with_photo.png'), fullPage: true });
  await p.click('[data-a=save]');
  await p.waitForSelector('[data-a=add]');
  const items = await p.evaluate(function (k) { return JSON.parse(localStorage.getItem(k)).workouts[0].items; }, M.STORAGE_KEY);
  const custom = items.find(function (it) { return it.name === 'My move'; });
  assert.strictEqual(custom.notes, '');
  assert.strictEqual(custom.media.kind, 'custom');
  assert.ok(custom.media.imageKey);
  assert.ok(!JSON.stringify(custom).includes('data:image'));
  assert.ok(!JSON.stringify(custom).includes('iVBORw0'));
  const stored = await p.evaluate(function (key) {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('wb.exercise-images');
      req.onerror = function () { reject(req.error); };
      req.onsuccess = function () {
        var db = req.result;
        var tx = db.transaction('images', 'readonly');
        var get = tx.objectStore('images').get(key);
        get.onsuccess = function () {
          var blob = get.result;
          db.close();
          resolve(blob ? blob.size : 0);
        };
        get.onerror = function () { reject(get.error); };
      };
    });
  }, custom.media.imageKey);
  assert.ok(stored > 0, 'image is in IndexedDB');

  await p.evaluate(function () { window.WBAuth.gifBase = ''; });
  await p.click('[data-a=play]');
  await p.waitForSelector('.pl-media');
  assert.ok((await p.$eval('.pl-media', function (el) { return el.textContent; })).includes('connected'));
  await wait(2400);
  await p.screenshot({ path: path.join(shotDir, 'player_demo_waiting.png') });
  await p.click('.pl-list .pl-notes-btn');
  await p.waitForSelector('.pl-notes');
  const opened = await p.evaluate(function () {
    var note = document.querySelector('.pl-notes');
    var row = note.closest('.pl-li');
    return { name: row.querySelector('b').textContent, notes: note.textContent };
  });
  assert.strictEqual(opened.name, 'Other press');
  assert.strictEqual(opened.notes, OTHER_DESC);
  assert.deepStrictEqual(await p.$$eval('.pl-list .pl-notes-btn', function (els) { return els.map(function (el) { return el.disabled; }); }), [false, true]);
  await p.evaluate(function () {
    var list = document.querySelector('.pl-list');
    var top = list.getBoundingClientRect().top + window.scrollY - 8;
    window.scrollTo(0, Math.max(0, top));
  });
  await wait(150);
  await p.screenshot({ path: path.join(shotDir, 'player_workout_notes.png') });
  await p.click('.pl-list .pl-notes-btn');
  await p.waitForFunction(function () { return !document.querySelector('.pl-notes'); });
  await p.evaluate(function () { window.WBAuth.gifBase = 'https://cdn.example.test/exercises'; });
  await p.click('.pl-ci:nth-child(3)');
  await wait(120);
  await p.click('.pl-ci:nth-child(2)');
  await p.waitForSelector('.pl-media img');
  assert.strictEqual(await p.$eval('.pl-media img', function (el) { return el.getAttribute('src'); }), 'https://cdn.example.test/exercises/360/0102.gif');

  await p.click('[data-p=end]');
  await p.waitForSelector('[data-p=exit]');
  await p.click('[data-p=exit]');
  await p.waitForSelector('[data-a=add]');
  const cards = await p.$$('.card [data-a=edit]');
  await cards[1].click();
  await p.waitForSelector('[data-a=clearphoto]');
  await p.click('[data-a=clearphoto]');
  assert.ok((await p.$eval('.media', function (el) { return el.textContent; })).includes('Optional image'));
  assert.ok(!(await p.$eval('#app', function (el) { return el.innerText; })).match(/type a name|photo/i));
  await p.click('[data-a=save]');
  await p.waitForSelector('[data-a=add]');
  const after = await p.evaluate(function (k) { return JSON.parse(localStorage.getItem(k)).workouts[0].items.find(function (it) { return it.name === 'My move'; }); }, M.STORAGE_KEY);
  assert.strictEqual(after.name, 'My move');
  assert.strictEqual(after.media, null);
  const gone = await p.evaluate(function (key) {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('wb.exercise-images');
      req.onsuccess = function () {
        var db = req.result;
        var get = db.transaction('images', 'readonly').objectStore('images').get(key);
        get.onsuccess = function () { db.close(); resolve(get.result ? 1 : 0); };
        get.onerror = function () { reject(get.error); };
      };
      req.onerror = function () { reject(req.error); };
    });
  }, custom.media.imageKey);
  assert.strictEqual(gone, 0, 'removing the image deletes it from this device');

  await p.evaluate(function (k) {
    var data = JSON.parse(localStorage.getItem(k));
    data.workouts[0].items.forEach(function (it) { it.groupId = 'grp_ss'; });
    localStorage.setItem(k, JSON.stringify(data));
  }, M.STORAGE_KEY);
  await p.reload();
  await p.waitForSelector('.ss [data-a=edit]');
  const ssEdits = await p.$$('.ss [data-a=edit]');
  await ssEdits[ssEdits.length - 1].click();
  await p.waitForSelector('[data-b=name]');
  assert.ok((await p.$eval('#app', function (el) { return el.innerText; })).toLowerCase().includes('superset'));
  assert.strictEqual(await p.$eval('[data-b=name]', function (el) { return el.value; }), 'My move');
  await setNotes('Old superset cue');
  await p.click('[data-seg=source][data-v=library]');
  await p.waitForSelector('#lib-q');
  await p.type('#lib-q', 'press');
  await p.waitForSelector('.lib-hit');
  await pickNamed('Other press');
  assert.strictEqual(await p.$eval('[data-b=name]', function (el) { return el.value; }), 'Other press');
  assert.strictEqual(await notes(), OTHER_DESC, 'picking a library exercise replaces notes on a superset exercise');
  assert.strictEqual(await p.$$eval('.lib-hit', function (a) { return a.length; }), 0, 'a superset exercise search collapses after a pick');
  await showResults();
  assert.ok((await p.$$('.lib-hit')).length >= 1, 'typing in a superset exercise search reopens results');

  assert.deepStrictEqual(errs, []);
  console.log('LIBRARY UI OK');
  await b.close();
})().catch(function (e) { console.error(e); process.exit(1); });
