// Group circuits: trainer home button, list, and the set-up grid.
// node tests/circuits-ui.test.js [url]
const assert = require('assert');
const M = require('../model.js');
const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const path = require('path');
const fs = require('fs');

const ADA = '22222222-2222-4222-8222-222222222222';
const BEN = '33333333-3333-4333-8333-333333333333';
const BLANK = '44444444-4444-4444-8444-444444444444';
const MAIL = '55555555-5555-4555-8555-555555555555';
const JO = '66666666-6666-4666-8666-666666666666';
const OUT = process.env.CIRCUIT_SHOTS || '/tmp/circuit-shots';

function profile(membership, id) {
  return {
    id: id || 'allow-test',
    email: 'coach@example.com',
    membership: membership,
    intended_plan: membership,
    display_name: 'Coach Lee'
  };
}

async function stub(page, membership, userId) {
  var id = userId || 'allow-test';
  await require('./allow.js').stubAuth(page, {
    profile: profile(membership, id),
    session: { user: { id: id, email: 'coach@example.com' } }
  });
  await page.evaluateOnNewDocument(function (ids) {
    var desc = Object.getOwnPropertyDescriptor(window, 'WBAuth');
    if (!desc || !desc.set) return;
    var prev = desc.set;
    Object.defineProperty(window, 'WBAuth', {
      configurable: true,
      enumerable: true,
      get: desc.get,
      set: function (value) {
        prev(value);
        var api = desc.get();
        if (!api) return;
        var circuits = [];
        api.roster = function () {
          return Promise.resolve({
            role: 'trainer',
            clients: [
              { id: ids.ada, name: 'Ada Client' },
              { id: ids.ben, name: 'Ben Ortiz' },
              { id: ids.blank, name: '' },
              { id: ids.mail, name: 'hidden@example.com' },
              { id: ids.jo, name: 'Jo Park', membership: 'enthusiast' }
            ]
          });
        };
        api.circuits = function () { return Promise.resolve(circuits.map(function (row) { return JSON.parse(JSON.stringify(row)); })); };
        api.shareSetting = function () { return Promise.resolve({ on: true, enthusiast: true, linked: false }); };
        api.clientStatus = function () { return Promise.resolve({ shared: true, enthusiast: false, linked: true }); };
        function remotePrograms() { return window.__remotePrograms || []; }
        api.programEntries = function () { return Promise.resolve(remotePrograms().map(function (row) { return JSON.parse(JSON.stringify(row)); })); };
        api.programEntriesFor = function () { return Promise.resolve(remotePrograms().map(function (row) { return JSON.parse(JSON.stringify(row)); })); };
        api.saveProgramEntry = function (entry) {
          window.__calls = window.__calls || [];
          window.__calls.push('entry');
          if (window.__failEntry) return Promise.reject(new Error('Could not save that day.'));
          window.__remotePrograms = remotePrograms().filter(function (row) { return row.local_id !== entry.id; });
          window.__remotePrograms.push({
            local_id: entry.id,
            owner_id: entry.ownerId,
            workout_local_id: entry.workoutId,
            workout_name: entry.workoutName,
            items: entry.items || [],
            day: entry.date,
            starts_at: entry.start,
            ends_at: entry.end,
            presence: entry.presence,
            updated_at: new Date().toISOString()
          });
          return new Promise(function (resolve) { setTimeout(function () { resolve(true); }, 30); });
        };
        api.deleteProgramEntry = function (ownerId, localId) {
          window.__calls = window.__calls || [];
          window.__calls.push('delete');
          window.__remotePrograms = remotePrograms().filter(function (row) { return row.local_id !== localId; });
          return Promise.resolve(true);
        };
        api.saveCircuitInvites = function (entry) {
          window.__calls = window.__calls || [];
          window.__calls.push('invites');
          window.__invites = (entry && entry.invites) || [];
          if (window.__failInvites) return Promise.reject(new Error('invite failed'));
          return Promise.resolve(true);
        };
        api.circuitGuestPlacements = function (clientId) {
          window.__guestCalls = window.__guestCalls || [];
          window.__guestCalls.push(clientId);
          var rows = window.__guestPlacements || [];
          return Promise.resolve(rows.filter(function (row) { return !row.clientId || row.clientId === clientId; }).map(function (row) {
            return {
              placement_id: row.placement_id,
              day: row.day,
              starts_at: row.starts_at,
              ends_at: row.ends_at,
              circuit_name: row.circuit_name,
              trainer_name: row.trainer_name
            };
          }));
        };
        api.saveCircuit = function (row) {
          function store() {
            var saved = {
              id: row.id || '11111111-1111-4111-8111-111111111111',
              name: row.name,
              data: JSON.parse(JSON.stringify(row.data)),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };
            var at = -1;
            circuits.forEach(function (item, i) { if (item.id === saved.id) at = i; });
            if (at >= 0) circuits[at] = saved;
            else circuits.unshift(saved);
            window.__circuits = circuits;
            return saved;
          }
          if (window.__blockSave) {
            return new Promise(function (resolve, reject) {
              window.__releaseSave = function (fail) {
                window.__blockSave = false;
                if (fail) reject(new Error('Could not save that circuit.'));
                else resolve(store());
              };
            });
          }
          return Promise.resolve(store());
        };
        api.deleteCircuit = function (id) {
          circuits = circuits.filter(function (item) { return item.id !== id; });
          window.__circuits = circuits;
          return Promise.resolve(true);
        };
        api.searchExercises = function (query) {
          var q = String(query || '').toLowerCase();
          return Promise.resolve([
            { id: 'squat1', name: 'Squat', body_part: 'Legs', equipment: 'Barbell', target: 'Quads' },
            { id: 'lunge1', name: 'Lunge', body_part: 'Legs', equipment: 'Body weight', target: 'Glutes' }
          ].filter(function (row) { return row.name.toLowerCase().indexOf(q) >= 0; }));
        };
      }
    });
  }, { ada: ADA, ben: BEN, blank: BLANK, mail: MAIL, jo: JO });
}

async function shot(page, name) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, name), fullPage: true });
}

(async () => {
  const browser = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const errors = [];
  const enthusiast = await browser.newPage();
  enthusiast.on('pageerror', function (err) { errors.push('enthusiast ' + err); });
  await enthusiast.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await stub(enthusiast, 'enthusiast');
  await enthusiast.goto(URL + '#/');
  await enthusiast.waitForSelector('#calendar-open');
  assert.strictEqual(await enthusiast.$('#circuits-open'), null);
  await shot(enthusiast, 'home-before.png');

  const page = await browser.newPage();
  const dialogs = [];
  page.on('pageerror', function (err) { errors.push(String(err)); });
  page.on('dialog', function (dialog) {
    dialogs.push(dialog.message());
    if (dialog.message().indexOf('Delete') === 0) dialog.accept();
    else if (dialog.type() === 'prompt') dialog.accept('Walk-in');
    else dialog.dismiss();
  });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await stub(page, 'trainer', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  const seeded = M.emptyData();
  const lift = M.newWorkout('Morning lift');
  lift.items = [M.normalizeExercise(M.newExercise({
    name: 'Press', sets: 1, weight: { unit: 'lb', value: 20 },
    mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 0 }
  }))];
  seeded.workouts.push(lift);
  await page.evaluateOnNewDocument(function (key, raw) { localStorage.setItem(key, raw); }, M.STORAGE_KEY, JSON.stringify(seeded));
  await page.goto(URL + '#/');
  await page.waitForSelector('#circuits-open');
  const home = await page.$eval('#circuits-open', function (el) {
    return { text: el.textContent, action: el.getAttribute('data-a'), type: el.type };
  });
  assert.deepStrictEqual(home, { text: 'Group Circuits', action: 'circuits', type: 'button' });
  assert.deepStrictEqual(await page.$$eval('#home-tiles button', function (nodes) { return nodes.map(function (el) { return el.id; }); }), ['circuits-open', 'calendar-open', 'send-nav']);
  const tileTouch = await page.evaluate(function () { return getComputedStyle(document.body).touchAction; });
  assert.notStrictEqual(tileTouch, 'none');
  await shot(page, 'home-after.png');

  await page.click('#circuits-open');
  await page.waitForSelector('#circuit-new');
  assert.strictEqual(await page.$eval('#title', function (el) { return el.textContent; }), 'Group Circuit Training');
  assert.strictEqual(await page.$eval('#back', function (el) { return el.hidden; }), false);
  assert.ok((await page.$eval('#circuit-empty', function (el) { return el.textContent; })).indexOf('No circuits yet') >= 0);
  assert.strictEqual(await page.$('[data-act=run]'), null);
  await shot(page, 'circuits-list-before.png');

  await page.click('#circuit-new');
  await page.waitForSelector('#circuit-name');
  assert.strictEqual(await page.$eval('#title', function (el) { return el.textContent; }), 'Set up circuit');
  await page.type('#circuit-name', 'Saturday class');
  await page.click('[data-act=add]');
  await page.waitForSelector('#circuit-lib-q');
  await page.type('#circuit-lib-q', 'sq');
  await page.waitForSelector('.lib-hit');
  await page.click('.lib-hit');
  await page.waitForFunction(function () {
    var tile = document.querySelector('.circuit-ex');
    return tile && tile.textContent.indexOf('Squat') >= 0 && tile.textContent.indexOf('manual') < 0;
  });

  const manuals = ['Lunge', 'Row', 'Press', 'Plank', 'Jacks'];
  for (let i = 0; i < manuals.length; i++) {
    await page.click('[data-act=add]');
    await page.waitForSelector('#circuit-ex-name');
    await page.type('#circuit-ex-name', manuals[i]);
    await page.click('[data-act=manual-exercise]');
    await page.waitForFunction(function (name) {
      return Array.prototype.some.call(document.querySelectorAll('.circuit-ex'), function (el) {
        return el.textContent.indexOf(name) >= 0 && el.textContent.indexOf('manual') >= 0;
      });
    }, {}, manuals[i]);
  }
  assert.strictEqual(await page.$$eval('.wb-tile', function (nodes) { return nodes.length; }), 6);
  assert.strictEqual(await page.$eval('.wb-grid', function (el) {
    return getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length;
  }), 3);
  assert.strictEqual(await page.$$eval('.wb-cell', function (nodes) { return nodes.length; }), 9);
  assert.strictEqual(await page.$eval('#circuit-rounds', function (el) { return el.value; }), '6');
  assert.strictEqual(await page.$eval('#circuit-work-s', function (el) { return el.value; }), '45');
  assert.strictEqual(await page.$eval('#circuit-move-s', function (el) { return el.value; }), '15');
  assert.strictEqual(await page.$eval('.circuit-phase.work .kicker', function (el) { return el.textContent; }), 'Work');
  assert.strictEqual(await page.$eval('.circuit-phase.move .kicker', function (el) { return el.textContent; }), 'Move');
  const touch = await page.$eval('.wb-tile', function (el) { return getComputedStyle(el).touchAction; });
  const gridTouch = await page.$eval('.wb-grid', function (el) { return getComputedStyle(el).touchAction; });
  assert.strictEqual(touch, 'none');
  assert.notStrictEqual(gridTouch, 'none');

  for (let i = 0; i < 6; i++) {
    await page.evaluate(function (index) {
      var names = document.querySelectorAll('.circuit-ex');
      var rect = names[index].getBoundingClientRect();
      var x = rect.left + Math.min(12, rect.width / 2);
      var y = rect.top + Math.min(8, rect.height / 2);
      var tile = names[index].closest('.wb-tile');
      tile.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0 }));
      tile.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0 }));
    }, i);
    await page.waitForFunction(function (n) {
      return document.querySelectorAll('.circuit-num:not(.is-open)').length === n;
    }, {}, i + 1);
  }
  await page.waitForFunction(function () {
    return document.querySelectorAll('.circuit-arrows polyline').length === 6;
  });

  const from = await page.evaluate(function () {
    var tiles = document.querySelectorAll('.wb-tile');
    var el = tiles[tiles.length - 1];
    el.scrollIntoView({ block: 'center' });
    var rect = el.getBoundingClientRect();
    return { x: rect.left + 24, y: rect.top + 36, id: el.getAttribute('data-grid-id') };
  });
  const target = await page.evaluate(function () {
    var cell = Array.prototype.find.call(document.querySelectorAll('.wb-cell'), function (item) {
      return !item.querySelector('.wb-tile');
    });
    var rect = cell.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, col: cell.getAttribute('data-col'), row: cell.getAttribute('data-row') };
  });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 24, from.y + 18, { steps: 4 });
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(function (id, col, row) {
    var tile = document.querySelector('.wb-tile[data-grid-id="' + id + '"]');
    var cell = tile && tile.closest('.wb-cell');
    return cell && cell.getAttribute('data-col') === col && cell.getAttribute('data-row') === row;
  }, {}, from.id, target.col, target.row);
  await page.waitForFunction(function () {
    return document.querySelectorAll('.circuit-arrows polyline').length === 6;
  });

  const body = await page.$eval('#app', function (el) { return el.innerText; });
  assert.ok(body.indexOf('Create and name your stations, then tap each station to set up the order of flow.') >= 0);
  assert.ok(body.indexOf('Tracking: time per station (editable)') >= 0);
  assert.ok(!/Rest|Reps|Weight|@/.test(body));
  assert.strictEqual(await page.$('#circuit-start'), null);
  assert.strictEqual(await page.$('[data-act=client]'), null);
  assert.strictEqual(await page.$('.circuit-clients'), null);
  assert.deepStrictEqual(await page.$$eval('.circuit-actions button', function (nodes) {
    return nodes.map(function (el) { return el.textContent; });
  }), ['Save', 'Cancel']);
  const setupOrder = await page.evaluate(function () {
    var root = document.querySelector('.circuit-setup');
    return Array.prototype.map.call(root.children, function (el) {
      if (el.id) return el.id;
      if (el.classList.contains('circuit-section')) return 'stations';
      if (el.classList.contains('circuit-hint')) return 'hint';
      if (el.classList.contains('circuit-board')) return 'grid';
      if (el.classList.contains('circuit-clock')) return 'clock';
      if (el.classList.contains('circuit-actions')) return 'actions';
      return el.className;
    });
  });
  assert.ok(setupOrder.indexOf('circuit-name') < setupOrder.indexOf('stations'), setupOrder.join('>'));
  assert.ok(setupOrder.indexOf('stations') < setupOrder.indexOf('circuit-hint'), setupOrder.join('>'));
  assert.ok(setupOrder.indexOf('circuit-hint') < setupOrder.indexOf('circuit-board'), setupOrder.join('>'));
  assert.ok(setupOrder.indexOf('circuit-board') < setupOrder.indexOf('clock'), setupOrder.join('>'));
  assert.ok(setupOrder.indexOf('clock') < setupOrder.indexOf('circuit-track'), setupOrder.join('>'));
  assert.ok(setupOrder.indexOf('circuit-track') < setupOrder.indexOf('actions'), setupOrder.join('>'));
  await page.click('[data-act=add]');
  await page.click('[data-act=save]');
  await page.waitForFunction(function () {
    var err = document.getElementById('circuit-err');
    return err && err.textContent.indexOf('Name every station before saving.') !== -1;
  });
  await page.evaluate(function () {
    var tiles = document.querySelectorAll('.wb-tile');
    for (var i = 0; i < tiles.length; i++) {
      if (tiles[i].textContent.indexOf('Choose exercise') !== -1) {
        tiles[i].querySelector('.circuit-x').click();
        return;
      }
    }
  });
  await page.waitForFunction(function () { return document.querySelectorAll('.wb-tile').length === 6; });
  const clipped = await page.$$eval('.circuit-name', function (nodes) {
    return nodes.map(function (el) { return { text: el.textContent, cut: el.scrollWidth > el.clientWidth + 1 }; });
  });
  clipped.forEach(function (item) { assert.strictEqual(item.cut, false, item.text); });
  const covered = await page.evaluate(function () {
    function inside(x, y, rect) {
      return x > rect.left + 1 && x < rect.right - 1 && y > rect.top + 1 && y < rect.bottom - 1;
    }
    var tiles = Array.prototype.map.call(document.querySelectorAll('.wb-tile, .circuit-change, .circuit-name, .circuit-x'), function (el) {
      return el.getBoundingClientRect();
    });
    var bad = 0;
    Array.prototype.forEach.call(document.querySelectorAll('.circuit-arrows polyline'), function (line) {
      var svg = line.ownerSVGElement.getBoundingClientRect();
      var pts = line.getAttribute('points').trim().split(/\s+/).map(function (pair) {
        var xy = pair.split(',');
        return { x: svg.left + Number(xy[0]), y: svg.top + Number(xy[1]) };
      });
      for (var i = 1; i < pts.length; i++) {
        for (var step = 1; step <= 4; step++) {
          var t = step / 4;
          var sx = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t;
          var sy = pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t;
          tiles.forEach(function (rect) { if (inside(sx, sy, rect)) bad++; });
        }
      }
    });
    return bad;
  });
  assert.strictEqual(covered, 0);
  await page.addStyleTag({ content: '.bar{position:static !important}' });
  await shot(page, 'circuits-setup.png');

  await page.evaluate(function () { window.__blockSave = true; });
  await page.click('[data-act=save]');
  await page.waitForFunction(function () { return document.getElementById('circuit-name').disabled === true; });
  const lockedTiles = await page.$$eval('.wb-tile', function (nodes) { return nodes.length; });
  assert.strictEqual(await page.$eval('[data-act=add]', function (el) { return el.disabled; }), true);
  assert.strictEqual(await page.$eval('.circuit-board', function (el) { return el.classList.contains('is-busy'); }), true);
  await page.evaluate(function () {
    var button = document.querySelector('[data-act=add]');
    button.disabled = false;
    button.click();
  });
  assert.strictEqual(await page.$$eval('.wb-tile', function (nodes) { return nodes.length; }), lockedTiles);
  await page.evaluate(function () { window.__releaseSave(true); });
  await page.waitForFunction(function () {
    return document.getElementById('circuit-name') && document.getElementById('circuit-name').disabled === false && document.getElementById('circuit-err');
  });
  assert.strictEqual(await page.$$eval('.wb-tile', function (nodes) { return nodes.length; }), lockedTiles);

  await page.click('[data-act=save]');
  await page.waitForSelector('#circuit-new');
  await page.waitForFunction(function () {
    var card = document.querySelector('[data-circuit]');
    return card && card.innerText.indexOf('Saturday class') >= 0 && card.innerText.indexOf('6 stations') >= 0 && card.innerText.indexOf('client') === -1;
  });
  const saved = await page.evaluate(function () { return window.__circuits && window.__circuits[0]; });
  assert.strictEqual(saved.name, 'Saturday class');
  assert.strictEqual(saved.data.stations.length, 6);
  assert.strictEqual(saved.data.order.length, 6);
  assert.strictEqual(saved.data.clock.workSec, 45);
  assert.strictEqual(saved.data.clock.moveSec, 15);
  assert.strictEqual(saved.data.clock.rounds, 6);
  assert.ok(!saved.data.clients);
  assert.ok(JSON.stringify(saved.data).indexOf('hidden@') < 0);
  assert.ok(!('reps' in saved.data) && !('weight' in saved.data));
  await shot(page, 'circuits-list-after.png');

  await page.evaluate(function () { location.hash = '#/'; });
  await page.waitForSelector('#calendar-open');
  await page.click('#calendar-open');
  await page.waitForSelector('#pv-client');
  await page.select('#pv-client', '');
  await page.waitForFunction(function () {
    var title = document.getElementById('title');
    var heading = document.querySelector('#pv-cal h2');
    var rail = document.getElementById('pv-rail');
    return title && title.textContent === 'Calendar' && heading && heading.textContent === 'Calendar' && rail && rail.innerText.indexOf('Saturday class') !== -1 && rail.innerText.indexOf('Morning lift') !== -1;
  });
  await page.click('.pv-day.today .pv-day-h');
  await page.waitForSelector('[data-sheet=add-day]');
  await page.click('[data-sheet=add-day]');
  await page.waitForFunction(function () {
    var names = Array.prototype.map.call(document.querySelectorAll('.pv-pick .name'), function (el) { return el.textContent; });
    var box = document.querySelector('.pv-picks');
    return names.indexOf('Morning lift') !== -1 && names.indexOf('Saturday class') !== -1 && box && box.innerText.indexOf('Circuits') === -1;
  });
  await page.evaluate(function () {
    var picks = document.querySelectorAll('.pv-pick');
    for (var i = 0; i < picks.length; i++) {
      if (picks[i].textContent.indexOf('Saturday class') !== -1) { picks[i].click(); return; }
    }
  });
  await page.waitForSelector('.pv-pick.on');
  await page.waitForFunction(function () {
    var box = document.getElementById('pv-invites');
    if (!box || box.innerText.indexOf('Jo Park') === -1) return false;
    if (box.innerText.indexOf('@') !== -1) return false;
    var labels = Array.prototype.map.call(box.querySelectorAll('[data-invite]'), function (el) { return el.textContent; });
    return labels.indexOf('Client') !== -1 && labels.indexOf('Ada Client') !== -1;
  });
  await page.click('[data-invite="' + ADA + '"]');
  await page.click('[data-invite="' + BEN + '"]');
  await page.click('#pv-sheet .pv-presence input[value="solo"]');
  await page.evaluate(function () {
    document.getElementById('pv-start-h').value = '09';
    document.getElementById('pv-start-m').value = '00';
    document.getElementById('pv-end-h').value = '10';
    document.getElementById('pv-end-m').value = '00';
  });
  await page.click('[data-sheet=save]');
  await page.waitForFunction(function () {
    var rows = JSON.parse(localStorage.getItem('wb.data.v1')).programs || [];
    var calls = window.__calls || [];
    return rows.some(function (row) {
      return row.workoutName === 'Saturday class' && row.items && row.items[0] && row.items[0].source === 'circuit'
        && row.invites && row.invites.indexOf('22222222-2222-4222-8222-222222222222') !== -1
        && row.invites.indexOf('33333333-3333-4333-8333-333333333333') !== -1;
    }) && calls.indexOf('entry') !== -1 && calls.indexOf('entry') < calls.indexOf('invites');
  });
  await page.evaluate(function () { window.__failEntry = true; window.__calls = []; });
  await page.evaluate(function (skip) {
    var days = document.querySelectorAll('.pv-day');
    var today = document.querySelector('.pv-day.today');
    var n = 0;
    for (var i = 0; i < days.length; i++) {
      if (days[i] === today) continue;
      if (n === skip) { days[i].querySelector('.pv-day-h').click(); return; }
      n++;
    }
  }, 0);
  await page.waitForSelector('[data-sheet=add-day]');
  await page.click('[data-sheet=add-day]');
  await page.waitForSelector('.pv-pick');
  await page.evaluate(function () {
    var picks = document.querySelectorAll('.pv-pick');
    for (var i = 0; i < picks.length; i++) {
      if (picks[i].textContent.indexOf('Saturday class') !== -1) { picks[i].click(); return; }
    }
  });
  await page.waitForSelector('[data-invite="' + ADA + '"]');
  await page.click('[data-invite="' + ADA + '"]');
  await page.click('#pv-sheet .pv-presence input[value="solo"]');
  await page.evaluate(function () {
    document.getElementById('pv-start-h').value = '09';
    document.getElementById('pv-start-m').value = '00';
    document.getElementById('pv-end-h').value = '10';
    document.getElementById('pv-end-m').value = '00';
  });
  await page.click('[data-sheet=save]');
  await page.waitForFunction(function () {
    var calls = window.__calls || [];
    var text = document.getElementById('app').innerText;
    return calls.join(',') === 'entry' && calls.indexOf('invites') === -1 && text.indexOf('Could not save that day.') !== -1;
  });
  await page.evaluate(function () { window.__failEntry = false; window.__failInvites = true; window.__calls = []; });
  await page.evaluate(function (skip) {
    var days = document.querySelectorAll('.pv-day');
    var today = document.querySelector('.pv-day.today');
    var n = 0;
    for (var i = 0; i < days.length; i++) {
      if (days[i] === today) continue;
      if (n === skip) { days[i].querySelector('.pv-day-h').click(); return; }
      n++;
    }
  }, 1);
  await page.waitForSelector('[data-sheet=add-day]');
  await page.click('[data-sheet=add-day]');
  await page.waitForSelector('.pv-pick');
  await page.evaluate(function () {
    var picks = document.querySelectorAll('.pv-pick');
    for (var i = 0; i < picks.length; i++) {
      if (picks[i].textContent.indexOf('Saturday class') !== -1) { picks[i].click(); return; }
    }
  });
  await page.waitForSelector('[data-invite="' + ADA + '"]');
  await page.click('[data-invite="' + ADA + '"]');
  await page.click('#pv-sheet .pv-presence input[value="solo"]');
  await page.evaluate(function () {
    document.getElementById('pv-start-h').value = '1';
    document.getElementById('pv-start-m').value = '00';
    document.getElementById('pv-end-h').value = '2';
    document.getElementById('pv-end-m').value = '00';
  });
  await page.click('[data-sheet=save]');
  await page.waitForFunction(function () {
    var text = document.getElementById('app').innerText;
    var calls = window.__calls || [];
    return text.indexOf('This workout is scheduled. The invites did not save.') !== -1
      && calls.indexOf('entry') !== -1 && calls.indexOf('entry') < calls.indexOf('invites');
  });
  await page.evaluate(function () { window.__failInvites = false; window.__calls = []; });
  await page.evaluate(function (skip) {
    var days = document.querySelectorAll('.pv-day');
    var today = document.querySelector('.pv-day.today');
    var n = 0;
    for (var i = 0; i < days.length; i++) {
      if (days[i] === today) continue;
      if (n === skip) { days[i].querySelector('.pv-day-h').click(); return; }
      n++;
    }
  }, 0);
  await page.waitForSelector('#pv-day-sheet .pv-day-row');
  await page.click('#pv-day-sheet .pv-day-row');
  await page.waitForSelector('[data-sheet=remove]');
  await page.click('[data-sheet=remove]');
  await page.waitForFunction(function () {
    var calls = window.__calls || [];
    var text = document.getElementById('app').innerText;
    return calls.indexOf('delete') !== -1 && calls.indexOf('invites') === -1
      && text.indexOf('That placement was not found.') === -1;
  });
  await page.evaluate(function () {
    document.querySelector('.pv-day.today [data-open-session]').closest('[data-day]').querySelector('.pv-day-h').click();
  });
  await page.waitForSelector('#pv-day-sheet .pv-day-row');
  await page.click('#pv-day-sheet .pv-day-row');
  await page.waitForSelector('[data-view-wo]');
  assert.ok(await page.$('#pv-day-sheet .pv-ico.solo'));
  await page.evaluate(function () {
    localStorage.setItem('wb.circuit.live', JSON.stringify({
      circuitId: '11111111-1111-4111-8111-111111111111',
      doc: { id: '11111111-1111-4111-8111-111111111111', name: 'Live class', stations: [], order: [], clients: [], clock: { workSec: 45, moveSec: 15, rounds: 1 } },
      mode: 'place',
      view: 'grid',
      assigned: {},
      running: false
    }));
    document.querySelector('#pv-day-sheet input[data-time="end"]').value = '11:15';
  });
  await page.click('[data-view-wo]');
  await page.waitForFunction(function () { return /#\/circuits\/[^/?]+\/view(?:\?|$)/.test(location.hash); });
  await page.waitForSelector('#circuit-live[data-track="0"] .wb-tile');
  assert.strictEqual(await page.$eval('[data-act=start]', function (el) { return el.disabled; }), true);
  assert.ok((await page.evaluate(function () { return localStorage.getItem('wb.circuit.live') || ''; })).indexOf('Live class') !== -1);
  await page.click('#back');
  await page.waitForSelector('#pv-client');
  assert.strictEqual(await page.evaluate(function () { return location.hash; }), '#/programs');
  assert.strictEqual((await page.evaluate(function () {
    var rows = JSON.parse(localStorage.getItem('wb.data.v1')).programs || [];
    return rows.some(function (item) { return item.workoutName === 'Saturday class' && item.end === '11:15'; });
  })), true);
  assert.ok((await page.evaluate(function () { return localStorage.getItem('wb.circuit.live') || ''; })).indexOf('Live class') !== -1);
  await page.evaluate(function () { localStorage.removeItem('wb.circuit.live'); });
  await page.evaluate(function (ada, ben) {
    var now = new Date();
    var day = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    window.__guestCalls = [];
    window.__guestPlacements = [{
      clientId: ada,
      placement_id: 'g-ada',
      day: day,
      starts_at: '15:00',
      ends_at: '16:00',
      circuit_name: 'Guest only class',
      trainer_name: 'Coach Lee'
    }, {
      clientId: ben,
      placement_id: 'g-ben',
      day: day,
      starts_at: '15:00',
      ends_at: '16:00',
      circuit_name: 'Guest only class',
      trainer_name: 'Coach Lee'
    }];
  }, ADA, BEN);
  await page.select('#pv-client', 'all');
  await page.waitForFunction(function () {
    var rail = document.getElementById('pv-rail');
    var today = document.querySelector('.pv-day.today');
    if (!rail || !today || rail.innerText.indexOf('Morning lift') === -1 || rail.innerText.indexOf('Saturday class') === -1) return false;
    var whos = Array.prototype.map.call(today.querySelectorAll('.pv-who'), function (el) { return el.textContent; });
    return whos.length === 1 && whos[0] === 'Self' && today.innerText.indexOf('Guest only class') === -1 && (window.__guestCalls || []).length === 0;
  });
  await page.select('#pv-client', ADA);
  await page.waitForFunction(function (ada) {
    var cards = document.querySelectorAll('.pv-session');
    var calls = window.__guestCalls || [];
    if (calls.indexOf(ada) === -1) return false;
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (card.innerText.indexOf('Guest only class') === -1) continue;
      if (card.hasAttribute('data-drag')) continue;
      if (!card.querySelector('.pv-ico.trainer')) continue;
      return true;
    }
    return false;
  }, {}, ADA);
  await page.select('#pv-client', 'all');
  await page.waitForFunction(function () {
    var today = document.querySelector('.pv-day.today');
    if (!today) return false;
    var whos = Array.prototype.map.call(today.querySelectorAll('.pv-who'), function (el) { return el.textContent; });
    return whos.length === 1 && whos[0] === 'Self';
  });
  await page.evaluate(function () {
    document.querySelector('.pv-day.today .pv-day-h').click();
  });
  await page.waitForSelector('[data-sheet=add-day]');
  await page.click('[data-sheet=add-day]');
  await page.waitForFunction(function () {
    var names = Array.prototype.map.call(document.querySelectorAll('.pv-pick .name'), function (el) { return el.textContent; });
    return names.indexOf('Saturday class') !== -1 && names.indexOf('Morning lift') !== -1;
  });
  await page.select('#pv-add-who', ADA);
  await page.waitForFunction(function () {
    var names = Array.prototype.map.call(document.querySelectorAll('.pv-pick .name'), function (el) { return el.textContent; });
    return names.indexOf('Morning lift') !== -1 && names.indexOf('Saturday class') === -1;
  });
  await page.click('[data-sheet=cancel]');
  await page.waitForSelector('#pv-day-sheet');
  await page.evaluate(function () { document.getElementById('pv-sheet').click(); });
  await page.waitForFunction(function () { return !document.getElementById('pv-sheet'); });
  await page.select('#pv-client', '');
  await page.waitForSelector('[data-open-session]');
  await page.evaluate(function () {
    document.querySelector('.pv-day.today [data-open-session]').closest('[data-day]').querySelector('.pv-day-h').click();
  });
  await page.waitForSelector('#pv-day-sheet .pv-day-row');
  await page.click('#pv-day-sheet .pv-day-row');
  await page.waitForSelector('[data-run]');
  await page.click('[data-run]');
  await page.waitForFunction(function () { return /#\/circuits\/[^/?]+\/prepare(?:\?|$)/.test(location.hash); });
  await page.waitForFunction(function () {
    var title = document.getElementById('title');
    var hint = document.getElementById('circuit-hint');
    var bench = document.querySelector('[data-bench]');
    if (!title || title.textContent !== 'Prepare Class') return false;
    if (!hint || hint.textContent !== 'Drag your clients to their station.') return false;
    if (!bench || bench.textContent.indexOf('During class, drag a client to the Bench to pull them out of the rotation, or back onto a station to rejoin.') === -1) return false;
    if (document.querySelector('[data-act=add], #circuit-clear, .circuit-x, .circuit-change, input[type=checkbox]')) return false;
    var labels = Array.prototype.map.call(document.querySelectorAll('#circuit-prepare-clients [data-person]'), function (el) {
      return el.getAttribute('aria-label');
    });
    return labels.indexOf('Ada Client') !== -1 && labels.indexOf('Ben Ortiz') !== -1 && labels.indexOf('Client') !== -1;
  });
  assert.strictEqual(await page.$eval('[data-act=start-class]', function (el) { return el.disabled; }), true);
  await page.click('[data-act=manual-open]');
  await page.waitForFunction(function () {
    var chip = document.querySelector('#circuit-prepare-clients [aria-label="Walk-in"]');
    return chip && chip.querySelector('.c-ava.is-manual') && chip.textContent.indexOf('manual') === -1 && chip.textContent.indexOf('Walk-in') === -1;
  });
  const dragged = await page.evaluate(function () {
    var chip = document.querySelector('#circuit-prepare-clients [aria-label="Ada Client"]');
    var station = document.querySelector('#circuit-board [data-station]');
    if (!chip || !station) return null;
    var from = chip.getBoundingClientRect();
    var to = station.getBoundingClientRect();
    return {
      key: chip.getAttribute('data-person'),
      station: station.getAttribute('data-station'),
      x1: from.left + from.width / 2,
      y1: from.top + from.height / 2,
      x2: to.left + to.width / 2,
      y2: to.top + to.height / 2
    };
  });
  await page.mouse.move(dragged.x1, dragged.y1);
  await page.mouse.down();
  await page.mouse.move(dragged.x2, dragged.y2, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(function (key) {
    var tile = document.querySelector('#circuit-board [data-person="' + key + '"]');
    return !!tile;
  }, {}, dragged.key);
  await page.evaluate(function () {
    window.__setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'wb.circuit.class') throw new Error('full');
      return window.__setItem.call(this, key, value);
    };
  });
  await page.click('[data-act=start-class]');
  await page.waitForFunction(function (key) {
    var err = document.getElementById('circuit-err');
    return location.hash.indexOf('/prepare') !== -1
      && err && err.textContent.indexOf('Could not start the class. Your placements are still here.') !== -1
      && document.querySelector('#circuit-board [data-person="' + key + '"]');
  }, {}, dragged.key);
  await page.evaluate(function () { Storage.prototype.setItem = window.__setItem; });
  await page.click('[data-act=start-class]');
  await page.waitForFunction(function () { return /#\/circuits\/[^/?]+\/run(?:\?|$)/.test(location.hash); });
  await page.waitForSelector('#circuit-live:not([data-track])');
  await page.waitForFunction(function () {
    var bench = document.querySelector('.circuit-bench');
    return bench && bench.innerText.indexOf('Ben') !== -1;
  });
  await page.evaluate(function () {
    localStorage.setItem('wb.circuit.class', JSON.stringify({
      circuitId: '11111111-1111-4111-8111-111111111111',
      clients: [],
      assigned: {}
    }));
    location.hash = '#/circuits/11111111-1111-4111-8111-111111111111/run';
  });
  await page.waitForFunction(function () {
    return location.hash.indexOf('/prepare') !== -1 && document.getElementById('circuit-prepare')
      && document.getElementById('app').innerText.indexOf('Loading') === -1;
  });
  await page.evaluate(function () { location.hash = '#/circuits'; });
  await page.waitForSelector('#circuit-new');

  await page.evaluate(function () {
    var row = (window.__circuits || [])[0];
    row.data.stations[0].col = 3;
  });
  await page.click('[data-act=open]');
  await page.waitForSelector('#circuit-name');
  assert.strictEqual(await page.$eval('#circuit-name', function (el) { return el.value; }), 'Saturday class');
  assert.strictEqual(await page.$$eval('.circuit-num:not(.is-open)', function (nodes) { return nodes.length; }), 6);
  assert.strictEqual(await page.$$eval('.wb-tile', function (nodes) { return nodes.length; }), 6);
  await page.click('#back');
  await page.waitForSelector('#circuit-new');
  assert.strictEqual(await page.evaluate(function () {
    return (window.__circuits || [])[0].data.stations[0].col;
  }), 3);

  await page.click('[data-act=del]');
  await page.waitForFunction(function () { return !!document.getElementById('circuit-empty'); });
  assert.ok(dialogs.some(function (msg) { return msg.indexOf('Delete') === 0; }));

  await enthusiast.evaluate(function (key) {
    var raw = localStorage.getItem(key);
    var data = raw ? JSON.parse(raw) : { version: 4, workouts: [], programs: [], sessions: [] };
    var now = new Date();
    var day = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    data.programs = [{
      id: 'pg-circuit',
      ownerId: 'allow-test',
      workoutId: '11111111-1111-4111-8111-111111111111',
      workoutName: 'Saturday class',
      items: [{ source: 'circuit', circuitId: '11111111-1111-4111-8111-111111111111' }],
      date: day,
      presence: 'solo',
      start: '09:00',
      end: '10:00',
      updatedAt: Date.now()
    }];
    localStorage.setItem(key, JSON.stringify(data));
  }, M.STORAGE_KEY);
  await enthusiast.evaluate(function () {
    var now = new Date();
    var day = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    window.__guestPlacements = [{
      placement_id: 'pg-sat',
      day: day,
      starts_at: '09:00',
      ends_at: '10:00',
      circuit_name: 'Saturday class',
      trainer_name: 'Coach Lee'
    }, {
      placement_id: 'pg-eve',
      day: day,
      starts_at: '18:00',
      ends_at: '19:00',
      circuit_name: 'Evening class',
      trainer_name: 'Coach Lee'
    }];
    location.hash = '#/';
  });
  await enthusiast.waitForSelector('#calendar-open');
  await enthusiast.evaluate(function () { location.hash = '#/programs'; });
  await enthusiast.waitForFunction(function () {
    var root = document.getElementById('pv-root');
    return root && root.getAttribute('data-role-now') === 'enthusiast' && !document.getElementById('pv-loading');
  });
  await enthusiast.waitForFunction(function () {
    var text = document.getElementById('app').innerText;
    if (text.indexOf('Saturday class') === -1 || text.indexOf('Evening class') === -1) return false;
    if (text.indexOf('@') !== -1) return false;
    var found = { sat: false, eve: false };
    var cards = document.querySelectorAll('.pv-session');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (card.hasAttribute('data-drag') || !card.querySelector('.pv-ico.trainer')) continue;
      if (card.innerText.indexOf('Saturday class') !== -1) found.sat = true;
      if (card.innerText.indexOf('Evening class') !== -1) found.eve = true;
    }
    return found.sat && found.eve;
  });
  await enthusiast.evaluate(function () {
    document.querySelector('.pv-day.today .pv-day-h').click();
  });
  await enthusiast.waitForFunction(function () {
    var sheet = document.getElementById('pv-day-sheet');
    var text = sheet ? sheet.innerText : '';
    return text.indexOf('Saturday class') !== -1 && text.indexOf('Evening class') !== -1;
  });
  await enthusiast.evaluate(function () {
    var rows = document.querySelectorAll('#pv-day-sheet .pv-day-row');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].innerText.indexOf('Evening class') !== -1) { rows[i].click(); return; }
    }
  });
  await enthusiast.waitForFunction(function () {
    var sheet = document.getElementById('pv-day-sheet');
    var text = sheet ? sheet.innerText : '';
    return text.indexOf('Evening class') !== -1 && text.indexOf('Saturday class') === -1 && text.indexOf('6:00') !== -1
      && !sheet.querySelector('[data-run], [data-view-wo], [data-sheet=remove], [data-time]');
  });
  await enthusiast.evaluateOnNewDocument(function () {
    var now = new Date();
    var day = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    window.__guestPlacements = [{
      placement_id: 'pg-sat',
      day: day,
      starts_at: '09:00',
      ends_at: '10:00',
      circuit_name: 'Saturday class',
      trainer_name: 'Coach Lee'
    }, {
      placement_id: 'pg-eve',
      day: day,
      starts_at: '18:00',
      ends_at: '19:00',
      circuit_name: 'Evening class',
      trainer_name: 'Coach Lee'
    }];
  });
  await enthusiast.evaluate(function (key) {
    var now = new Date();
    var day = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    var data = JSON.parse(localStorage.getItem(key));
    data.programs = [{
      id: 'pg-done',
      ownerId: 'allow-test',
      workoutId: 'w-done',
      workoutName: 'Morning lift',
      items: [],
      date: day,
      presence: 'solo',
      start: '07:00',
      end: '08:00',
      updatedAt: 1,
      dateSetAt: 1
    }];
    data.sessions = [{
      id: 'ses-done',
      workoutId: 'w-done',
      programId: 'pg-done',
      workoutName: 'Morning lift',
      startedAt: 2,
      endedAt: 3,
      localDate: day,
      results: [{ logged: true, name: 'Press' }]
    }];
    localStorage.setItem(key, JSON.stringify(data));
  }, M.STORAGE_KEY);
  await enthusiast.reload({ waitUntil: 'domcontentloaded' });
  await enthusiast.waitForFunction(function () {
    var today = document.querySelector('.pv-day.today');
    var text = document.getElementById('app').innerText;
    return today && today.querySelector('.pv-check') && text.indexOf('Morning lift') !== -1
      && text.indexOf('Saturday class') !== -1 && text.indexOf('Evening class') !== -1;
  });
  await enthusiast.evaluate(function (key) {
    var now = new Date();
    var day = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    var data = JSON.parse(localStorage.getItem(key));
    data.programs = [{
      id: 'pg-circuit',
      ownerId: 'allow-test',
      workoutId: '11111111-1111-4111-8111-111111111111',
      workoutName: 'Saturday class',
      items: [{ source: 'circuit', circuitId: '11111111-1111-4111-8111-111111111111' }],
      date: day,
      presence: 'solo',
      start: '09:00',
      end: '10:00',
      updatedAt: Date.now()
    }];
    data.sessions = [];
    localStorage.setItem(key, JSON.stringify(data));
  }, M.STORAGE_KEY);
  await enthusiast.evaluate(function () { location.hash = '#/programs'; });
  await enthusiast.reload({ waitUntil: 'domcontentloaded' });
  await enthusiast.waitForSelector('.pv-day.today');
  await enthusiast.evaluate(function () {
    document.querySelector('.pv-day.today .pv-day-h').click();
  });
  await enthusiast.waitForSelector('#pv-day-sheet .pv-day-row');
  await enthusiast.evaluate(function () {
    var rows = document.querySelectorAll('#pv-day-sheet .pv-day-row');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].querySelector('.pv-ico.solo')) { rows[i].click(); return; }
    }
  });
  await enthusiast.waitForSelector('[data-view-wo]');
  await enthusiast.evaluate(function () { document.querySelector('[data-view-wo]').click(); });
  await enthusiast.waitForSelector('#pv-open-error');
  assert.strictEqual(await enthusiast.evaluate(function () { return location.hash; }), '#/programs');
  assert.strictEqual(await enthusiast.$('#level-note'), null);
  await enthusiast.goto(URL + '#/circuits');
  await enthusiast.waitForSelector('#level-note');
  assert.strictEqual(await enthusiast.$('#circuit-new'), null);

  assert.deepStrictEqual(errors, []);
  console.log('CIRCUITS UI OK');
  await browser.close();
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
