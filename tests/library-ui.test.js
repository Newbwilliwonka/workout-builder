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
  await p.evaluateOnNewDocument(function () {
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
          { id: '0101', name: 'Test press', body_part: 'chest', equipment: 'barbell', target: 'pectorals' },
          { id: '0102', name: 'Other press', body_part: 'chest', equipment: 'dumbbell', target: 'pectorals' }
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
  });
  const errs = [];
  p.on('pageerror', function (e) { errs.push(e.message); });
  p.on('dialog', function (d) { d.accept(); });
  const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
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
  await p.click('[data-seg=source][data-v=library]');
  await p.waitForSelector('#lib-q');
  await wait(400);
  assert.deepStrictEqual(await p.evaluate(function () { return window.__libCalls || []; }), [], 'opening the library does not download it');
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
  assert.strictEqual(await p.$$eval('.lib-hit', function (a) { return a.length; }), 2);
  await p.click('.lib-hit');
  assert.strictEqual(await p.$eval('[data-b=name]', function (el) { return el.value; }), 'Test press');
  assert.ok((await p.$eval('.media', function (el) { return el.textContent; })).includes('once'));
  const shotDir = '/opt/cursor/artifacts';
  fs.mkdirSync(shotDir, { recursive: true });
  await p.screenshot({ path: path.join(shotDir, 'library_exercise_editor.png'), fullPage: true });
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
  await p.click('[data-a=save]');
  await p.waitForSelector('[data-a=add]');
  const saved = await p.evaluate(function (k) { return JSON.parse(localStorage.getItem(k)).workouts[0].items[0]; }, M.STORAGE_KEY);
  assert.strictEqual(saved.name, 'Test press');
  assert.deepStrictEqual(saved.media, { kind: 'library', libraryId: '0101', view: '360' });
  assert.ok(!JSON.stringify(saved).includes('cdn.example'));
  assert.ok(!JSON.stringify(saved).includes('.gif'));

  await p.click('[data-a=edit]');
  await p.waitForSelector('.media img');
  await p.click('#back');
  await p.waitForSelector('[data-a=add]');
  await p.click('[data-a=add]');
  await p.waitForSelector('[data-b=name]');
  await p.type('[data-b=name]', 'My move');
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
  await p.evaluate(function () { window.WBAuth.gifBase = 'https://cdn.example.test/exercises'; });
  await p.evaluate(function () { WBPlayer.selectStep(1); });
  await wait(120);
  await p.evaluate(function () { WBPlayer.selectStep(0); });
  await p.waitForSelector('.pl-media img');
  assert.strictEqual(await p.$eval('.pl-media img', function (el) { return el.getAttribute('src'); }), 'https://cdn.example.test/exercises/360/0101.gif');

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

  assert.deepStrictEqual(errs, []);
  console.log('LIBRARY UI OK');
  await b.close();
})().catch(function (e) { console.error(e); process.exit(1); });
