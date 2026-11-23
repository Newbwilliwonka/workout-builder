// Group circuits: trainer home button, list, and the set-up grid.
// node tests/circuits-ui.test.js [url]
const assert = require('assert');
const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const path = require('path');
const fs = require('fs');

const ADA = '22222222-2222-4222-8222-222222222222';
const BEN = '33333333-3333-4333-8333-333333333333';
const BLANK = '44444444-4444-4444-8444-444444444444';
const MAIL = '55555555-5555-4555-8555-555555555555';
const OUT = process.env.CIRCUIT_SHOTS || '/tmp/circuit-shots';

function profile(membership) {
  return {
    id: 'allow-test',
    email: 'coach@example.com',
    membership: membership,
    intended_plan: membership,
    display_name: 'Coach Lee'
  };
}

async function stub(page, membership) {
  await require('./allow.js').stubAuth(page, {
    profile: profile(membership),
    session: { user: { id: 'allow-test', email: 'coach@example.com' } }
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
              { id: ids.mail, name: 'hidden@example.com' }
            ]
          });
        };
        api.circuits = function () { return Promise.resolve(circuits.map(function (row) { return JSON.parse(JSON.stringify(row)); })); };
        api.saveCircuit = function (row) {
          var saved = {
            id: row.id || '11111111-1111-4111-8111-111111111111',
            name: row.name,
            data: row.data,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          var at = -1;
          circuits.forEach(function (item, i) { if (item.id === saved.id) at = i; });
          if (at >= 0) circuits[at] = saved;
          else circuits.unshift(saved);
          window.__circuits = circuits;
          return Promise.resolve(saved);
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
  }, { ada: ADA, ben: BEN, blank: BLANK, mail: MAIL });
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
  await enthusiast.waitForSelector('#programs-open');
  assert.strictEqual(await enthusiast.$('#circuits-open'), null);
  await shot(enthusiast, 'home-before.png');

  const page = await browser.newPage();
  const dialogs = [];
  page.on('pageerror', function (err) { errors.push(String(err)); });
  page.on('dialog', function (dialog) {
    dialogs.push(dialog.message());
    if (dialog.message().indexOf('Delete') === 0) dialog.accept();
    else dialog.dismiss();
  });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await stub(page, 'trainer');
  await page.goto(URL + '#/');
  await page.waitForSelector('#circuits-open');
  const home = await page.$eval('#circuits-open', function (el) {
    return { text: el.textContent, action: el.getAttribute('data-a'), type: el.type };
  });
  assert.deepStrictEqual(home, { text: 'Group Circuits', action: 'circuits', type: 'button' });
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
    return document.querySelectorAll('.circuit-arrows line').length === 6;
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
    return document.querySelectorAll('.circuit-arrows line').length === 6;
  });

  await page.click('[data-act=client][data-id="' + ADA + '"]');
  await page.click('[data-act=client][data-id="' + BEN + '"]');
  await page.click('[data-act=client][data-id="' + BLANK + '"]');
  await page.click('[data-act=client][data-id="' + MAIL + '"]');
  await page.click('[data-act=manual-open]');
  await page.waitForSelector('#circuit-client-name');
  await page.type('#circuit-client-name', 'Walk-in');
  await page.click('[data-act=manual-add]');
  await page.waitForFunction(function () {
    return Array.prototype.some.call(document.querySelectorAll('.circuit-person'), function (el) {
      return el.textContent.indexOf('Walk-in') >= 0 && el.textContent.indexOf('manual') >= 0;
    });
  });
  const body = await page.$eval('#app', function (el) { return el.innerText; });
  assert.ok(body.indexOf('Tap stations in order to draw the loop.') >= 0);
  assert.ok(body.indexOf('Tracking: time per station (automatic)') >= 0);
  assert.ok(!/Rest|Reps|Weight|@/.test(body));
  assert.ok(body.indexOf('Client') >= 0);
  const clipped = await page.$$eval('.circuit-name', function (nodes) {
    return nodes.map(function (el) { return { text: el.textContent, cut: el.scrollWidth > el.clientWidth + 1 }; });
  });
  clipped.forEach(function (item) { assert.strictEqual(item.cut, false, item.text); });
  await page.addStyleTag({ content: '.bar{position:static !important}' });
  await shot(page, 'circuits-setup.png');

  await page.click('[data-act=save]');
  await page.waitForSelector('#circuit-new');
  await page.waitForFunction(function () {
    var card = document.querySelector('[data-circuit]');
    return card && card.innerText.indexOf('Saturday class') >= 0 && card.innerText.indexOf('6 stations') >= 0 && card.innerText.indexOf('5 clients') >= 0;
  });
  const saved = await page.evaluate(function () { return window.__circuits && window.__circuits[0]; });
  assert.strictEqual(saved.name, 'Saturday class');
  assert.strictEqual(saved.data.stations.length, 6);
  assert.strictEqual(saved.data.order.length, 6);
  assert.strictEqual(saved.data.clock.workSec, 45);
  assert.strictEqual(saved.data.clock.moveSec, 15);
  assert.strictEqual(saved.data.clock.rounds, 6);
  assert.strictEqual(saved.data.clients.filter(function (c) { return c.source === 'linked'; }).length, 4);
  assert.deepStrictEqual(saved.data.clients.filter(function (c) { return c.source === 'manual'; }), [{ source: 'manual', name: 'Walk-in' }]);
  assert.ok(saved.data.clients.every(function (c) { return String(c.name).indexOf('@') < 0; }));
  assert.ok(JSON.stringify(saved.data).indexOf('hidden@') < 0);
  assert.ok(!('reps' in saved.data) && !('weight' in saved.data));
  await shot(page, 'circuits-list-after.png');

  await page.click('[data-act=open]');
  await page.waitForSelector('#circuit-name');
  assert.strictEqual(await page.$eval('#circuit-name', function (el) { return el.value; }), 'Saturday class');
  assert.strictEqual(await page.$$eval('.circuit-num:not(.is-open)', function (nodes) { return nodes.length; }), 6);
  await page.click('#back');
  await page.waitForSelector('#circuit-new');

  await page.click('[data-act=del]');
  await page.waitForFunction(function () { return !!document.getElementById('circuit-empty'); });
  assert.ok(dialogs.some(function (msg) { return msg.indexOf('Delete') === 0; }));

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
