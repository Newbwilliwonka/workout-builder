// Replaced images, duplicated images, deleted workouts, library search toggles, and Back.
// node tests/image-lifecycle.test.js [url]
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const M = require('../model.js');

function quoted(src) {
  var out = [], re = /'([^'\\]|\\.)*'/g, m;
  while ((m = re.exec(src))) out.push(m[0]);
  return out;
}
['app.js', 'player.js', 'media.js'].forEach(function (file) {
  var src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.ok(!/Type a name|type a name/.test(src), file);
  quoted(src).forEach(function (s) {
    if (s.indexOf('ex-photo') >= 0 || s.indexOf('clearphoto') >= 0) return;
    assert.ok(!/photo/i.test(s), file + ' still says photo: ' + s);
  });
});
assert.ok(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8').includes('Enter manually'));
assert.ok(fs.readFileSync(path.join(__dirname, '../player.js'), 'utf8').includes('No image on this device'));

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const pp = require('puppeteer-core');
const pngA = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const pngB = Buffer.concat([pngA, Buffer.from('second-image')]);
assert.notStrictEqual(pngA.length, pngB.length);
const fileA = '/tmp/wb-image-a.png';
const fileB = '/tmp/wb-image-b.png';
fs.writeFileSync(fileA, pngA);
fs.writeFileSync(fileB, pngB);

(async function () {
  const b = await pp.launch({ executablePath: process.env.CHROME || '/usr/local/bin/google-chrome', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true });
  await require('./allow.js')(p);
  await p.evaluateOnNewDocument(function () {
    var desc = Object.getOwnPropertyDescriptor(window, 'WBAuth');
    var current;
    function patch(api) {
      if (!api || api.__imgStub) return api;
      api.__imgStub = true;
      api.searchExercises = function (q, filters, limit, offset) {
        window.__libCalls = window.__libCalls || [];
        var query = String(q || '');
        window.__libCalls.push({ q: query, filters: filters || {}, limit: limit, offset: offset });
        if (window.__libHold) {
          return new Promise(function (resolve) {
            (window.__libHoldQueue = window.__libHoldQueue || []).push({ q: query, resolve: resolve });
          });
        }
        if (query.trim().length < 2) return Promise.resolve([]);
        return Promise.resolve([{ id: '0099', name: 'Found ' + query.trim(), body_part: 'chest', equipment: 'barbell', target: 'pectorals' }]);
      };
      api.exerciseFilters = function () {
        return Promise.resolve({ bodyParts: ['chest'], equipment: ['barbell'], targets: ['pectorals'] });
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
  var nextName = 'Original';
  p.on('dialog', function (d) { d.type() === 'prompt' ? d.accept(nextName) : d.accept(); });
  const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function idbSize(key) {
    return p.evaluate(function (key) {
      return new Promise(function (resolve, reject) {
        var req = indexedDB.open('wb.exercise-images');
        req.onerror = function () { reject(req.error); };
        req.onsuccess = function () {
          var db = req.result;
          var get = db.transaction('images', 'readonly').objectStore('images').get(key);
          get.onsuccess = function () { var blob = get.result; db.close(); resolve(blob ? blob.size : 0); };
          get.onerror = function () { reject(get.error); };
        };
      });
    }, key);
  }
  async function waitIdb(key, expected) {
    var last = -1;
    for (var i = 0; i < 40; i++) {
      last = await idbSize(key);
      if (last === expected) return last;
      await wait(50);
    }
    throw new Error('IndexedDB size for ' + key + ' stayed ' + last + ', expected ' + expected);
  }
  async function shown(sel) {
    await p.waitForSelector(sel);
    return p.evaluate(function (sel) {
      var img = document.querySelector(sel);
      return fetch(img.src).then(function (r) { return r.blob(); }).then(function (blob) { return { size: blob.size, src: img.src }; });
    }, sel);
  }
  function workouts() {
    return p.evaluate(function (k) { return JSON.parse(localStorage.getItem(k)).workouts; }, M.STORAGE_KEY);
  }
  async function clickCard(name, action) {
    await p.waitForFunction(function (name) {
      return Array.prototype.some.call(document.querySelectorAll('.card .name'), function (n) { return n.textContent === name; });
    }, {}, name);
    await p.evaluate(function (name, action) {
      var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
      var card = cards.filter(function (c) {
        var n = c.querySelector('.name');
        return n && n.textContent === name;
      })[0];
      card.querySelector('button[data-a="' + action + '"]').click();
    }, name, action);
  }
  async function home() {
    await p.evaluate(function () { location.hash = '#/'; });
    await p.waitForSelector('[data-a=new]');
  }

  await p.goto(URL);
  await p.evaluate(function (k) {
    localStorage.removeItem(k);
    return new Promise(function (resolve) {
      var req = indexedDB.deleteDatabase('wb.exercise-images');
      req.onsuccess = req.onerror = req.onblocked = function () { resolve(); };
    });
  }, M.STORAGE_KEY);
  await p.goto(URL + '#/');
  await p.reload();
  await p.waitForSelector('[data-a=new]');
  await p.evaluate(function () {
    window.__revoked = [];
    var orig = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = function (u) { window.__revoked.push(String(u)); return orig(u); };
  });

  const cache = await p.evaluate(function (sizeA, sizeB) {
    var a = new Blob([new Uint8Array(sizeA)], { type: 'image/png' });
    var b = new Blob([new Uint8Array(sizeB)], { type: 'image/png' });
    return WBMedia.put('cache-key', a).then(function () {
      return WBMedia.url('cache-key');
    }).then(function (first) {
      return fetch(first).then(function (r) { return r.blob(); }).then(function (blob) {
        return WBMedia.put('cache-key', b).then(function () {
          return { firstSize: blob.size, firstUrl: first, peeked: WBMedia.peek('cache-key') };
        });
      });
    }).then(function (mid) {
      return WBMedia.url('cache-key').then(function (second) {
        return fetch(second).then(function (r) { return r.blob(); }).then(function (blob) {
          mid.secondSize = blob.size;
          mid.secondUrl = second;
          return WBMedia.copy('cache-key', 'copy-key').then(function () {
            return WBMedia.put('copy-key', a);
          }).then(function () {
            return WBMedia.get('cache-key');
          }).then(function (kept) {
            mid.keptSize = kept ? kept.size : 0;
            return WBMedia.remove('cache-key').then(function () { return WBMedia.remove('copy-key'); }).then(function () { return mid; });
          });
        });
      });
    });
  }, 10, 25);
  assert.strictEqual(cache.firstSize, 10);
  assert.strictEqual(cache.secondSize, 25);
  assert.strictEqual(cache.peeked, '');
  assert.notStrictEqual(cache.firstUrl, cache.secondUrl);
  assert.strictEqual(cache.keptSize, 25, 'copying an image gives the copy its own file');

  await p.click('[data-a=new]');
  await p.waitForSelector('[data-a=add]');
  await p.click('[data-a=add]');
  await p.waitForSelector('[data-b=name]');
  await p.type('[data-b=name]', 'Press');
  const labels = await p.$eval('#app', function (el) { return el.innerText; });
  assert.ok(labels.includes('Enter manually'));
  assert.ok(labels.includes('Exercise library'));
  assert.ok(labels.includes('Optional image'));
  assert.ok(labels.includes('Add an image'));
  assert.ok(labels.includes('Stays on this device only'));
  assert.ok(!/type a name/i.test(labels));
  assert.ok(!/\bphoto/i.test(labels));
  fs.mkdirSync('/opt/cursor/artifacts', { recursive: true });
  await p.screenshot({ path: '/opt/cursor/artifacts/exercise_editor_enter_manually.png', fullPage: true });

  const inputA = await p.$('#ex-photo');
  await inputA.uploadFile(fileA);
  await p.waitForSelector('.media img');
  const pending = await p.$eval('.media img', function (el) { return el.src; });
  await p.click('#back');
  await p.waitForSelector('[data-a=add]');
  const revoked = await p.evaluate(function () { return window.__revoked; });
  assert.ok(revoked.indexOf(pending) >= 0, 'Back releases the unsaved image');
  assert.strictEqual((await workouts())[0].items.length, 0);

  await p.click('[data-a=add]');
  await p.waitForSelector('#ex-photo');
  await (await p.$('#ex-photo')).uploadFile(fileA);
  await p.waitForSelector('.media img');
  const pendingCancel = await p.$eval('.media img', function (el) { return el.src; });
  await p.click('[data-a=cancel]');
  await p.waitForSelector('[data-a=add]');
  const revokedCancel = await p.evaluate(function () { return window.__revoked; });
  assert.ok(revokedCancel.indexOf(pendingCancel) >= 0, 'Cancel still releases the unsaved image');
  assert.strictEqual((await workouts())[0].items.length, 0);

  await p.click('[data-a=add]');
  await p.waitForSelector('[data-b=name]');
  await p.type('[data-b=name]', 'Press');
  await (await p.$('#ex-photo')).uploadFile(fileA);
  await p.waitForSelector('.media img');
  await p.click('[data-a=save]');
  await p.waitForSelector('[data-a=add]');
  await p.click('[data-a=edit]');
  const firstView = await shown('.media img');
  assert.strictEqual(firstView.size, pngA.length);
  await (await p.$('#ex-photo')).uploadFile(fileB);
  await p.waitForFunction(function (n) {
    var img = document.querySelector('.media img');
    return img && fetch(img.src).then(function (r) { return r.blob(); }).then(function (b) { return b.size === n; });
  }, {}, pngB.length);
  await p.click('[data-a=save]');
  await p.waitForSelector('[data-a=add]');
  await p.click('[data-a=edit]');
  const replaced = await shown('.media img');
  assert.strictEqual(replaced.size, pngB.length, 'the editor shows the replaced image without a reload');
  assert.notStrictEqual(replaced.src, firstView.src);
  await p.click('#back');
  await p.waitForSelector('[data-a=play]');
  await p.click('[data-a=play]');
  const played = await shown('.pl-media img');
  assert.strictEqual(played.size, pngB.length, 'the player shows the replaced image without a reload');
  await p.evaluate(function () { location.hash = '#/'; });
  await p.waitForSelector('[data-a=dup]');

  const beforeDup = (await workouts())[0].items[0].media.imageKey;
  await clickCard('Original', 'dup');
  await p.waitForFunction(function () {
    return Array.prototype.some.call(document.querySelectorAll('.card .name'), function (n) { return n.textContent === 'Original (copy)'; });
  });
  const saved = await workouts();
  const original = saved.filter(function (w) { return w.name === 'Original'; })[0];
  const copy = saved.filter(function (w) { return w.name === 'Original (copy)'; })[0];
  const originalKey = original.items[0].media.imageKey;
  const copyKey = copy.items[0].media.imageKey;
  assert.strictEqual(originalKey, beforeDup);
  assert.notStrictEqual(copyKey, originalKey);
  assert.strictEqual(await waitIdb(originalKey, pngB.length), pngB.length);
  assert.strictEqual(await waitIdb(copyKey, pngB.length), pngB.length);
  await clickCard('Original (copy)', 'open');
  await p.waitForSelector('[data-a=edit]');
  await p.click('[data-a=edit]');
  await p.waitForSelector('#ex-photo');
  await (await p.$('#ex-photo')).uploadFile(fileA);
  await p.waitForFunction(function (n) {
    var img = document.querySelector('.media img');
    return img && fetch(img.src).then(function (r) { return r.blob(); }).then(function (b) { return b.size === n; });
  }, {}, pngA.length);
  await p.click('[data-a=save]');
  await p.waitForSelector('[data-a=add]');
  assert.strictEqual(await waitIdb(originalKey, pngB.length), pngB.length, 'replacing the copy leaves the original image');
  assert.strictEqual(await waitIdb(copyKey, pngA.length), pngA.length);
  await home();
  await clickCard('Original', 'open');
  await p.waitForSelector('[data-a=edit]');
  await p.click('[data-a=edit]');
  const stillOriginal = await shown('.media img');
  assert.strictEqual(stillOriginal.size, pngB.length);
  await home();

  await clickCard('Original (copy)', 'del');
  await p.waitForFunction(function () {
    return !Array.prototype.some.call(document.querySelectorAll('.card .name'), function (n) { return n.textContent === 'Original (copy)'; });
  });
  assert.strictEqual(await waitIdb(copyKey, 0), 0, 'deleting the copy removes its image');
  assert.strictEqual(await idbSize(originalKey), pngB.length);

  await p.evaluate(function (storageKey, imageKey) {
    var data = JSON.parse(localStorage.getItem(storageKey));
    var src = data.workouts.filter(function (w) { return w.name === 'Original'; })[0];
    var extra = JSON.parse(JSON.stringify(src));
    extra.id = 'wo_shares';
    extra.name = 'Shares image';
    extra.items[0].id = 'ex_shares';
    extra.items[0].media.imageKey = imageKey;
    data.workouts.push(extra);
    localStorage.setItem(storageKey, JSON.stringify(data));
  }, M.STORAGE_KEY, originalKey);
  await p.reload();
  await p.waitForSelector('[data-a=new]');
  await clickCard('Original', 'del');
  await p.waitForFunction(function () {
    return !Array.prototype.some.call(document.querySelectorAll('.card .name'), function (n) { return n.textContent === 'Original'; });
  });
  await wait(200);
  assert.strictEqual(await idbSize(originalKey), pngB.length, 'deleting one workout keeps an image another workout still uses');
  await clickCard('Shares image', 'del');
  await p.waitForFunction(function () {
    return !Array.prototype.some.call(document.querySelectorAll('.card .name'), function (n) { return n.textContent === 'Shares image'; });
  });
  assert.strictEqual(await waitIdb(originalKey, 0), 0, 'deleting the last workout removes its image');

  nextName = 'Search';
  await p.click('[data-a=new]');
  await p.waitForSelector('[data-a=add]');
  await p.click('[data-a=add]');
  await p.waitForSelector('[data-b=name]');
  await p.type('[data-b=name]', 'Manual');
  await p.click('[data-seg=source][data-v=library]');
  await p.waitForSelector('#lib-q');
  await p.click('[data-a=save]');
  await p.waitForSelector('#errs');
  const errText = await p.$eval('#errs', function (el) { return el.textContent; });
  assert.ok(/enter one manually/i.test(errText), errText);
  assert.ok(!/type a name/i.test(errText), errText);

  await p.evaluate(function () {
    window.__libCalls = [];
    var input = document.getElementById('lib-q');
    input.value = 'alpha';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.click('[data-seg=source][data-v=custom]');
  await wait(450);
  await p.click('[data-seg=source][data-v=library]');
  await p.waitForFunction(function () { return document.body.innerText.indexOf('Found alpha') >= 0; });
  const afterToggle = await p.$eval('#lib-results', function (el) { return el.innerText; });
  assert.ok(afterToggle.indexOf('Found alpha') >= 0, afterToggle);
  assert.ok(afterToggle.indexOf('No exercises match') < 0, afterToggle);
  assert.ok(afterToggle.indexOf('Searching') < 0, afterToggle);

  await p.evaluate(function () {
    window.__libHold = true;
    window.__libHoldQueue = [];
    var input = document.getElementById('lib-q');
    input.value = 'beta';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForFunction(function () {
    return (window.__libHoldQueue || []).length >= 1 && document.body.innerText.indexOf('Searching') >= 0;
  });
  await p.click('[data-seg=source][data-v=custom]');
  await p.click('[data-seg=source][data-v=library]');
  await p.waitForFunction(function () { return (window.__libHoldQueue || []).length >= 2; });
  await p.evaluate(function () {
    window.__libHoldQueue[0].resolve([{ id: 'bad', name: 'Poison result', body_part: 'chest', equipment: 'barbell', target: 'pectorals' }]);
  });
  await wait(300);
  assert.ok((await p.$eval('#app', function (el) { return el.innerText; })).indexOf('Poison result') < 0);
  await p.evaluate(function () {
    var last = window.__libHoldQueue[window.__libHoldQueue.length - 1];
    last.resolve([{ id: 'ok', name: 'Fresh result', body_part: 'chest', equipment: 'barbell', target: 'pectorals' }]);
  });
  await p.waitForFunction(function () { return document.body.innerText.indexOf('Fresh result') >= 0; });
  const fresh = await p.$eval('#lib-results', function (el) { return el.innerText; });
  assert.ok(fresh.indexOf('Fresh result') >= 0, fresh);
  assert.ok(fresh.indexOf('Poison result') < 0, fresh);
  assert.ok(fresh.indexOf('Searching') < 0, fresh);

  await p.click('[data-seg=source][data-v=custom]');
  await (await p.$('#ex-photo')).uploadFile(fileA);
  await p.waitForSelector('.media img');
  await p.click('[data-a=save]');
  await p.waitForSelector('[data-a=add]');
  const wordingKey = (await workouts()).filter(function (w) { return w.name === 'Search'; })[0].items[0].media.imageKey;
  await p.evaluate(function (key) { return WBMedia.remove(key); }, wordingKey);
  await waitIdb(wordingKey, 0);
  await p.click('[data-a=play]');
  await p.waitForSelector('.pl-media');
  const playerText = await p.$eval('.pl-media', function (el) { return el.innerText; });
  assert.ok(playerText.indexOf('No image on this device') >= 0, playerText);
  assert.ok(!/\bphoto/i.test(playerText), playerText);

  assert.deepStrictEqual(errs, []);
  console.log('IMAGE LIFECYCLE OK');
  await b.close();
})().catch(function (e) { console.error(e); process.exit(1); });
