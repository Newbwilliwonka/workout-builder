// Programs uses real workouts, a real calendar, and the real player.
// node tests/programs-ui.test.js [url]
const assert = require('assert');
const M = require('../model.js');
const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';

function workout(name) {
  const w = M.newWorkout(name);
  w.items = [M.normalizeExercise(M.newExercise({
    name: 'Press', sets: 1, weight: { unit: 'lb', value: 20 },
    mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 0 }
  }))];
  return w;
}

async function stub(page, extra) {
  await require('./allow.js').stubAuth(page, { profile: extra.profile, session: extra.session });
  await page.evaluateOnNewDocument(function (extra) {
    var desc = Object.getOwnPropertyDescriptor(window, 'WBAuth');
    if (!desc || !desc.set) return;
    var prev = desc.set;
    Object.defineProperty(window, 'WBAuth', {
      configurable: true,
      enumerable: true,
      get: desc.get,
      set: function (value) {
        prev(value);
        if (!value) return;
        value.shareSetting = function () { return Promise.resolve(extra.share); };
        value.programEntries = function () { return Promise.resolve([]); };
        value.saveProgramEntry = function () { return Promise.resolve(true); };
        value.roster = function () { return Promise.resolve(extra.roster); };
        value.clientStatus = function (id) { return Promise.resolve(extra.status[id] || { shared: false, enthusiast: false, linked: false }); };
      }
    });
  }, extra);
}

(async () => {
  const browser = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];
  const lift = workout('Morning lift');
  const easy = workout('Easy day');
  const base = M.emptyData();
  base.workouts.push(lift, easy);

  const enthusiast = await browser.newPage();
  enthusiast.on('pageerror', function (err) { errors.push(String(err)); });
  enthusiast.on('dialog', function (dialog) {
    if (dialog.message().indexOf('Nothing is tracked') !== -1 || dialog.message().indexOf('Logged sets will be saved') !== -1) { dialog.accept(); return; }
    errors.push('dialog ' + dialog.message());
    dialog.dismiss();
  });
  await enthusiast.setViewport({ width: 1280, height: 900 });
  await stub(enthusiast, {
    profile: { id: 'allow-test', email: 'kinisiathletics@gmail.com', membership: 'enthusiast', intended_plan: 'enthusiast' },
    session: { user: { id: 'allow-test', email: 'kinisiathletics@gmail.com' } },
    share: { on: true, enthusiast: true, linked: true },
    roster: { role: null, clients: [] },
    status: {}
  });
  await enthusiast.goto(URL);
  await enthusiast.evaluate(function (key, value) {
    const data = JSON.parse(value);
    const now = new Date();
    const day = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    const at = Date.now();
    data.programs = [{
      id: 'pg1', ownerId: 'allow-test', workoutId: data.workouts[0].id, workoutName: 'Morning lift',
      items: data.workouts[0].items, date: day, presence: 'solo', start: '09:00', end: '10:30', updatedAt: at - 60000
    }];
    data.sessions = [{
      id: 'ses1', workoutId: data.workouts[0].id, workoutName: 'Morning lift', programId: 'pg1',
      startedAt: at - 1000, endedAt: at, results: [{ logged: true, name: 'Press' }]
    }];
    localStorage.setItem(key, JSON.stringify(data));
  }, M.STORAGE_KEY, JSON.stringify(base));
  await enthusiast.reload();
  await enthusiast.waitForSelector('#programs-open');
  assert.deepStrictEqual(await enthusiast.$eval('#programs-open', function (el) {
    var row = el.parentElement;
    return {
      text: el.textContent,
      href: el.getAttribute('href'),
      row: row && row.id,
      on: el.classList.contains('on')
    };
  }), {
    text: 'Programs',
    href: '#/programs',
    row: 'nav-links',
    on: false
  });
  assert.strictEqual(await enthusiast.$('#send-nav'), null);
  assert.ok((await enthusiast.$eval('#app', function (el) { return el.innerText; })).indexOf('(preview)') === -1);
  const before = await enthusiast.evaluate(function (key) { return localStorage.getItem(key); }, M.STORAGE_KEY);
  await enthusiast.click('#programs-open');
  await enthusiast.waitForFunction(function () {
    const root = document.getElementById('pv-root');
    return root && root.getAttribute('data-role-now') === 'enthusiast' && document.querySelector('.pv-check');
  });
  const legendColors = await enthusiast.evaluate(function () {
    function read(kind) {
      var el = document.querySelector('.pv-legend .pv-ico.' + kind);
      var style = getComputedStyle(el);
      var path = el.querySelector('path').getAttribute('d');
      return { color: style.color, background: style.backgroundColor, radius: style.borderRadius, path: path.slice(0, 3) };
    }
    return { solo: read('solo'), trainer: read('trainer') };
  });
  assert.strictEqual(legendColors.solo.color, 'rgb(37, 99, 235)');
  assert.strictEqual(legendColors.trainer.color, 'rgb(37, 99, 235)');
  assert.strictEqual(legendColors.solo.background, 'rgba(0, 0, 0, 0)');
  assert.strictEqual(legendColors.trainer.background, 'rgba(0, 0, 0, 0)');
  assert.strictEqual(legendColors.solo.radius, '0px');
  assert.strictEqual(legendColors.trainer.radius, '0px');
  assert.strictEqual(legendColors.solo.path, 'M12');
  assert.strictEqual(legendColors.trainer.path, 'M9 ');
  assert.ok((await enthusiast.$eval('#pv-role-note', function (el) { return el.innerText; })).indexOf('Your trainer can also edit this calendar') !== -1);
  assert.strictEqual(await enthusiast.$('#pv-workouts .actions'), null);
  assert.strictEqual(await enthusiast.$('#pv-workouts button'), null);
  assert.strictEqual(await enthusiast.$('[data-send]'), null);
  assert.strictEqual(await enthusiast.$('[data-open-wo]'), null);
  assert.strictEqual(await enthusiast.$('[data-a=rename]'), null);
  assert.strictEqual(await enthusiast.$('.pv-swipe'), null);
  assert.ok(await enthusiast.$('.pv-day.today .pv-check'));
  const desktop = await enthusiast.evaluate(function () {
    var workouts = document.getElementById('pv-workouts').getBoundingClientRect();
    var cal = document.getElementById('pv-cal').getBoundingClientRect();
    var strip = document.querySelector('.pv-week-scroll');
    return {
      left: workouts.left < cal.left,
      row: Math.abs(workouts.top - cal.top) < 80,
      weekFits: strip.scrollWidth <= strip.clientWidth + 2
    };
  });
  assert.strictEqual(desktop.left, true);
  assert.strictEqual(desktop.row, true);
  assert.strictEqual(desktop.weekFits, true);
  const icon = await enthusiast.evaluate(function () {
    var el = document.querySelector('.pv-session .pv-ico');
    var box = el.getBoundingClientRect();
    var path = el.querySelector('path');
    return { h: Math.round(box.height), w: Math.round(box.width), d: path ? path.getAttribute('d') : '', tag: el.tagName };
  });
  assert.ok(icon.h >= 12 && icon.h <= 16, 'icon height ' + icon.h);
  assert.ok(icon.w >= 12 && icon.w <= 16, 'icon width ' + icon.w);
  assert.ok(icon.d.indexOf('M12') === 0 || icon.d.indexOf('M9') === 0);
  assert.strictEqual(icon.tag, 'BUTTON');
  await enthusiast.click('.pv-day:not(.today) .pv-day-h');
  await enthusiast.waitForSelector('#pv-empty-day');
  assert.strictEqual(await enthusiast.$eval('#pv-empty-day', function (el) { return el.textContent; }), 'No workouts scheduled');
  assert.ok(await enthusiast.$('[data-sheet=add-day]'));
  await enthusiast.click('[data-sheet=add-day]');
  await enthusiast.waitForSelector('#pv-start-h');
  await enthusiast.waitForSelector('#pv-start-m');
  await enthusiast.waitForSelector('#pv-end-h');
  await enthusiast.waitForSelector('#pv-end-m');
  assert.ok(await enthusiast.$('#pv-sheet .pv-pick'));
  assert.strictEqual(await enthusiast.$('#pv-dropped'), null);
  assert.strictEqual(await enthusiast.$eval('#pv-start-h', function (el) { return el.type; }), 'text');
  assert.strictEqual(await enthusiast.$eval('#pv-start-h', function (el) { return el.getAttribute('inputmode'); }), 'numeric');
  assert.strictEqual(await enthusiast.$eval('#pv-start-m', function (el) { return el.getAttribute('inputmode'); }), 'numeric');
  await enthusiast.click('[data-sheet=cancel]');
  await enthusiast.waitForSelector('#pv-empty-day');
  await enthusiast.evaluate(function () { document.getElementById('pv-sheet').click(); });
  await enthusiast.waitForFunction(function () { return !document.getElementById('pv-sheet'); });

  assert.strictEqual(await enthusiast.$('.pv-handle'), null);
  assert.ok(await enthusiast.$('#pv-workouts .pv-pick-card[data-drag]'));
  assert.ok(await enthusiast.$('.pv-session[data-drag]'));
  await enthusiast.evaluate(function () {
    localStorage.setItem('wb.addWorkoutTimes.v1', JSON.stringify({
      'someone-else': { start: '18:00', end: '19:00' }
    }));
  });
  const card = await enthusiast.$('#pv-workouts .pv-pick-card');
  const from = await card.boundingBox();
  const target = await enthusiast.$('.pv-day:not(.today)');
  const to = await target.boundingBox();
  await enthusiast.mouse.move(from.x + from.width / 2, from.y + 24);
  await enthusiast.mouse.down();
  await enthusiast.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 12 });
  await enthusiast.mouse.up();
  await enthusiast.waitForSelector('#pv-sheet');
  assert.strictEqual(await enthusiast.$eval('#pv-dropped', function (el) { return el.tagName + ' ' + el.textContent; }), 'P Morning lift');
  assert.strictEqual(await enthusiast.$('#pv-sheet .pv-pick'), null);
  const clocks = await enthusiast.evaluate(function () {
    function read(id) {
      var el = document.getElementById(id);
      return { type: el.type, mode: el.getAttribute('inputmode'), value: el.value };
    }
    function ap(which) {
      var on = document.querySelector('#pv-sheet [data-ampm="' + which + '"].on');
      return on ? on.textContent : '';
    }
    return {
      startH: read('pv-start-h'),
      startM: read('pv-start-m'),
      endH: read('pv-end-h'),
      endM: read('pv-end-m'),
      startAp: ap('start'),
      endAp: ap('end'),
      native: document.querySelectorAll('#pv-sheet input[type="time"]').length
    };
  });
  assert.strictEqual(clocks.startH.type, 'text');
  assert.strictEqual(clocks.endH.type, 'text');
  assert.strictEqual(clocks.startM.type, 'text');
  assert.strictEqual(clocks.endM.type, 'text');
  assert.strictEqual(clocks.startH.mode, 'numeric');
  assert.strictEqual(clocks.endH.mode, 'numeric');
  assert.strictEqual(clocks.startM.mode, 'numeric');
  assert.strictEqual(clocks.endM.mode, 'numeric');
  assert.strictEqual(clocks.startH.value, '09');
  assert.strictEqual(clocks.startM.value, '00');
  assert.strictEqual(clocks.endH.value, '10');
  assert.strictEqual(clocks.endM.value, '00');
  assert.strictEqual(clocks.startAp, 'AM');
  assert.strictEqual(clocks.endAp, 'AM');
  assert.strictEqual(clocks.native, 0);
  const unchosen = await enthusiast.evaluate(function () {
    var radios = Array.prototype.slice.call(document.querySelectorAll('#pv-sheet .pv-presence input'));
    return {
      values: radios.map(function (node) { return node.value; }),
      labels: radios.map(function (node) { return node.parentElement.textContent.replace(/\s+/g, ' ').trim(); }),
      checked: radios.filter(function (node) { return node.checked; }).length
    };
  });
  assert.deepStrictEqual(unchosen.values, ['solo', 'trainer']);
  assert.strictEqual(unchosen.checked, 0);
  assert.ok(unchosen.labels[0].indexOf('Solo') !== -1);
  assert.ok(unchosen.labels[1].indexOf('Trainer present') !== -1);
  await enthusiast.evaluate(function () {
    document.getElementById('pv-end-h').value = '08';
    document.getElementById('pv-end-m').value = '00';
  });
  await enthusiast.click('[data-sheet=save]');
  await enthusiast.waitForSelector('#pv-sheet-error');
  assert.ok((await enthusiast.$eval('#pv-sheet-error', function (el) { return el.textContent; })).indexOf('after') !== -1);
  await enthusiast.evaluate(function () {
    document.getElementById('pv-end-h').value = '10';
    document.getElementById('pv-end-m').value = '00';
  });
  await enthusiast.click('[data-sheet=save]');
  await enthusiast.waitForFunction(function () {
    var err = document.getElementById('pv-sheet-error');
    return err && err.textContent.indexOf('Solo') !== -1;
  });
  await enthusiast.click('#pv-sheet .pv-presence input[value="trainer"]');
  await enthusiast.waitForFunction(function () {
    var chosen = document.querySelector('#pv-sheet .pv-presence input[value="trainer"]');
    return chosen && chosen.checked;
  });
  await enthusiast.click('[data-sheet=save]');
  await enthusiast.waitForFunction(function () {
    return (JSON.parse(localStorage.getItem('wb.data.v1')).programs || []).length === 2;
  });
  assert.ok((await enthusiast.$eval('#pv-hint', function (el) { return el.textContent; })).indexOf('Saved on this device') !== -1);
  const added = await enthusiast.evaluate(function () {
    return JSON.parse(localStorage.getItem('wb.data.v1')).programs.filter(function (row) { return row.id !== 'pg1'; })[0];
  });
  assert.strictEqual(added.start, '09:00');
  assert.strictEqual(added.end, '10:00');
  assert.strictEqual(added.presence, 'trainer');
  const remembered = await enthusiast.evaluate(function () {
    return JSON.parse(localStorage.getItem('wb.addWorkoutTimes.v1'));
  });
  assert.deepStrictEqual(remembered['allow-test'], { start: '09:00', end: '10:00' });
  assert.deepStrictEqual(remembered['someone-else'], { start: '18:00', end: '19:00' });

  await enthusiast.click('[data-open-session]');
  await enthusiast.waitForSelector('#pv-day-sheet .pv-day-row');
  await enthusiast.click('#pv-day-sheet .pv-day-row');
  await enthusiast.waitForSelector('[data-view-wo]');
  assert.deepStrictEqual(await enthusiast.$$eval('#pv-sheet button', function (nodes) { return nodes.map(function (node) { return node.textContent; }); }), ['View', 'Run', 'Save times', 'Remove workout']);
  await enthusiast.click('[data-view-wo]');
  await enthusiast.waitForSelector('.pl-screen');
  await enthusiast.waitForSelector('#pv-not-tracked');
  assert.strictEqual(await enthusiast.$eval('#pv-not-tracked', function (el) { return el.textContent; }), 'Preview - not tracked');
  assert.strictEqual(await enthusiast.evaluate(function () { return window.__wbPlayer.track; }), false);
  const duringView = await enthusiast.evaluate(function (key) { return localStorage.getItem(key); }, M.STORAGE_KEY);
  await enthusiast.evaluate(function () { document.querySelector('[data-p=end]').click(); });
  await enthusiast.waitForSelector('#pv-root');
  assert.strictEqual(await enthusiast.evaluate(function (key) { return localStorage.getItem(key); }, M.STORAGE_KEY), duringView);
  assert.strictEqual(await enthusiast.evaluate(function () { return (JSON.parse(localStorage.getItem('wb.data.v1')).sessions || []).length; }), 1);

  await enthusiast.click('[data-open-session]');
  await enthusiast.waitForSelector('#pv-day-sheet .pv-day-row');
  await enthusiast.click('#pv-day-sheet .pv-day-row');
  await enthusiast.waitForSelector('[data-run]');
  await enthusiast.click('[data-run]');
  await enthusiast.waitForSelector('.pl-screen');
  assert.strictEqual(await enthusiast.$('#pv-not-tracked'), null);
  assert.ok((await enthusiast.$eval('.pl-track', function (el) { return el.innerText; })).indexOf('Tracking') !== -1);
  await enthusiast.evaluate(function () { document.querySelector('[data-p=end]').click(); });
  await enthusiast.waitForSelector('[data-p=exit]');
  await enthusiast.click('[data-p=exit]');
  await enthusiast.waitForSelector('#pv-root');

  function sheetSig() {
    var card = document.getElementById('pv-day-sheet');
    var start = card.querySelector('[data-time="start"]');
    var end = card.querySelector('[data-time="end"]');
    var when = card.querySelector('.pv-when');
    return {
      buttons: Array.prototype.map.call(card.querySelectorAll('button'), function (node) { return node.textContent; }),
      title: card.querySelector('h3') ? card.querySelector('h3').textContent : '',
      start: start ? start.value : '',
      end: end ? end.value : '',
      when: when ? when.textContent : ''
    };
  }
  function listSig() {
    var card = document.getElementById('pv-day-sheet');
    return {
      title: card.querySelector('h3') ? card.querySelector('h3').textContent : '',
      rows: Array.prototype.map.call(card.querySelectorAll('.pv-day-row'), function (node) {
        return node.innerText.replace(/\s+/g, ' ').trim();
      }),
      add: !!card.querySelector('[data-sheet=add-day]'),
      slots: card.querySelectorAll('[data-client-slot]').length,
      names: card.querySelectorAll('.pv-row-client').length
    };
  }
  await enthusiast.click('.pv-day.today .pv-day-h');
  await enthusiast.waitForSelector('#pv-day-sheet .pv-day-row');
  const fromWeek = await enthusiast.evaluate(listSig);
  await enthusiast.click('#pv-day-sheet .pv-day-row');
  await enthusiast.waitForSelector('#pv-day-sheet [data-time="start"]');
  const fromWeekEdit = await enthusiast.evaluate(sheetSig);
  assert.deepStrictEqual(fromWeekEdit.buttons, ['View', 'Run', 'Save times', 'Remove workout']);
  await enthusiast.evaluate(function () { return window.WBPreview.back(); });
  await enthusiast.waitForSelector('#pv-day-sheet .pv-day-row');
  await enthusiast.evaluate(function () { document.getElementById('pv-sheet').click(); });
  await enthusiast.waitForFunction(function () { return !document.getElementById('pv-sheet'); });

  await enthusiast.click('[data-cal=month]');
  await enthusiast.waitForSelector('.pv-cell.is-out');
  await enthusiast.click('[data-shift="1"][data-unit="month"]');
  await enthusiast.waitForFunction(function () {
    return document.getElementById('pv-range') && document.getElementById('pv-range').textContent.indexOf('December') !== -1;
  });
  await enthusiast.click('[data-cal=week]');
  await enthusiast.waitForFunction(function () {
    const label = document.getElementById('pv-range');
    return label && label.textContent.indexOf('Dec') !== -1;
  });
  await enthusiast.click('[data-cal=month]');
  await enthusiast.waitForSelector('.pv-month');
  await enthusiast.click('[data-shift="-1"][data-unit="month"]');
  await enthusiast.click('.pv-cell.today');
  await enthusiast.waitForSelector('#pv-day-sheet .pv-day-row');
  assert.ok(await enthusiast.$('.pv-month'));
  assert.strictEqual(await enthusiast.$('.pv-week'), null);
  const dayText = await enthusiast.$eval('#pv-day-sheet', function (el) { return el.innerText; });
  assert.ok(dayText.indexOf('Morning lift') !== -1);
  const fromMonth = await enthusiast.evaluate(listSig);
  assert.deepStrictEqual(fromMonth, fromWeek);
  assert.strictEqual(fromMonth.add, true);
  assert.strictEqual(fromMonth.slots, fromMonth.rows.length);
  assert.ok(fromMonth.rows[0].indexOf('9:00') !== -1);
  await enthusiast.click('#pv-day-sheet .pv-day-row');
  await enthusiast.waitForSelector('#pv-day-sheet .pv-presence');
  const fromMonthEdit = await enthusiast.evaluate(sheetSig);
  assert.deepStrictEqual(fromMonthEdit, fromWeekEdit);
  assert.deepStrictEqual(fromMonthEdit.buttons, ['View', 'Run', 'Save times', 'Remove workout']);
  assert.ok(await enthusiast.$('#pv-day-sheet .pv-slot-title .pv-ico.solo'));
  assert.strictEqual(await enthusiast.$eval('#pv-day-sheet .pv-presence input[value="solo"]', function (el) { return el.checked; }), true);
  await enthusiast.click('#pv-day-sheet .pv-presence input[value="trainer"]');
  await enthusiast.waitForFunction(function () {
    var row = JSON.parse(localStorage.getItem('wb.data.v1')).programs.filter(function (item) { return item.id === 'pg1'; })[0];
    return row && row.presence === 'trainer';
  });
  assert.ok(await enthusiast.$('#pv-day-sheet .pv-slot-title .pv-ico.trainer'));
  assert.strictEqual(fromMonthEdit.start, '09:00');
  assert.strictEqual(fromMonthEdit.end, '10:30');
  assert.strictEqual(await enthusiast.$eval('#pv-day-sheet [data-time="start"]', function (el) { return el.type; }), 'time');
  assert.strictEqual(await enthusiast.$eval('#pv-day-sheet [data-time="end"]', function (el) { return el.type; }), 'time');
  await enthusiast.evaluate(function () { return window.WBPreview.back(); });
  await enthusiast.waitForSelector('#pv-day-sheet .pv-day-row');
  await enthusiast.evaluate(function () { return window.WBPreview.back(); });
  await enthusiast.waitForFunction(function () { return !document.getElementById('pv-sheet'); });
  await enthusiast.click('.pv-cell:not(.today):not(.is-out)');
  await enthusiast.waitForSelector('#pv-empty-day');
  assert.strictEqual(await enthusiast.$eval('#pv-empty-day', function (el) { return el.textContent; }), 'No workouts scheduled');
  await enthusiast.click('[data-sheet=add-day]');
  await enthusiast.waitForSelector('#pv-start-h');
  await enthusiast.waitForSelector('#pv-end-h');
  assert.ok(await enthusiast.$('.pv-month'));
  await enthusiast.click('[data-sheet=cancel]');
  await enthusiast.waitForSelector('#pv-empty-day');
  await enthusiast.evaluate(function () { return window.WBPreview.back(); });
  await enthusiast.waitForFunction(function () { return !document.getElementById('pv-sheet'); });
  const monthCard = await enthusiast.$('#pv-workouts .pv-pick-card');
  const monthFrom = await monthCard.boundingBox();
  const monthCell = await enthusiast.$('.pv-cell:not(.today):not(.is-out)');
  const monthTo = await monthCell.boundingBox();
  await enthusiast.mouse.move(monthFrom.x + monthFrom.width / 2, monthFrom.y + 24);
  await enthusiast.mouse.down();
  await enthusiast.mouse.move(monthTo.x + monthTo.width / 2, monthTo.y + monthTo.height / 2, { steps: 12 });
  await enthusiast.mouse.up();
  await enthusiast.waitForSelector('#pv-sheet');
  assert.strictEqual(await enthusiast.$eval('#pv-dropped', function (el) { return el.textContent; }), 'Morning lift');
  assert.strictEqual(await enthusiast.$('#pv-sheet .pv-pick'), null);
  assert.strictEqual(await enthusiast.$eval('#pv-start-h', function (el) { return el.type; }), 'text');
  await enthusiast.click('[data-sheet=cancel]');
  await enthusiast.waitForFunction(function () { return !document.getElementById('pv-sheet'); });

  const blankDate = await enthusiast.evaluate(function (key) {
    var data = JSON.parse(localStorage.getItem(key));
    var now = new Date();
    var day = now.getDate() === 1 ? 2 : 1;
    var date = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    data.programs.push({
      id: 'pg-blank', ownerId: 'allow-test', workoutId: data.workouts[0].id, workoutName: 'Morning lift',
      items: data.workouts[0].items, date: date, presence: 'solo', start: '', end: '', updatedAt: Date.now()
    });
    localStorage.setItem(key, JSON.stringify(data));
    return date;
  }, M.STORAGE_KEY);
  await enthusiast.reload();
  await enthusiast.waitForSelector('[data-cal=month]');
  await enthusiast.click('[data-cal=month]');
  await enthusiast.waitForSelector('.pv-cell[data-date="' + blankDate + '"]');
  await enthusiast.click('.pv-cell[data-date="' + blankDate + '"]');
  await enthusiast.waitForSelector('#pv-day-sheet .pv-day-row');
  await enthusiast.click('#pv-day-sheet .pv-day-row');
  await enthusiast.waitForSelector('#pv-day-sheet [data-time="start"]');
  const blankInputs = await enthusiast.evaluate(function () {
    return {
      start: document.querySelector('#pv-day-sheet [data-time="start"]').value,
      end: document.querySelector('#pv-day-sheet [data-time="end"]').value
    };
  });
  assert.strictEqual(blankInputs.start, '');
  assert.strictEqual(blankInputs.end, '');
  await enthusiast.click('[data-view-wo]');
  await enthusiast.waitForSelector('#pv-not-tracked');
  await enthusiast.evaluate(function () { document.querySelector('[data-p=end]').click(); });
  await enthusiast.waitForSelector('#pv-root');
  const blankSaved = await enthusiast.evaluate(function (key) {
    return JSON.parse(localStorage.getItem(key)).programs.filter(function (row) { return row.id === 'pg-blank'; })[0];
  }, M.STORAGE_KEY);
  assert.strictEqual(blankSaved.start || '', '');
  assert.strictEqual(blankSaved.end || '', '');

  await enthusiast.click('[data-cal=week]');
  await enthusiast.waitForSelector('.pv-day');
  const easyCards = await enthusiast.$$('#pv-workouts .pv-pick-card');
  const easyFrom = await easyCards[1].boundingBox();
  const easyTo = await (await enthusiast.$('.pv-day')).boundingBox();
  await enthusiast.mouse.move(easyFrom.x + easyFrom.width / 2, easyFrom.y + 24);
  await enthusiast.mouse.down();
  await enthusiast.mouse.move(easyTo.x + easyTo.width / 2, easyTo.y + 40, { steps: 12 });
  await enthusiast.mouse.up();
  await enthusiast.waitForSelector('#pv-dropped');
  assert.strictEqual(await enthusiast.$eval('#pv-dropped', function (el) { return el.textContent; }), 'Easy day');
  assert.deepStrictEqual(await enthusiast.evaluate(function () {
    return {
      startH: document.getElementById('pv-start-h').value,
      startM: document.getElementById('pv-start-m').value,
      endH: document.getElementById('pv-end-h').value,
      endM: document.getElementById('pv-end-m').value,
      startAp: document.querySelector('[data-ampm="start"].on').textContent,
      endAp: document.querySelector('[data-ampm="end"].on').textContent
    };
  }), { startH: '09', startM: '00', endH: '10', endM: '00', startAp: 'AM', endAp: 'AM' });
  await enthusiast.$eval('#pv-start-h', function (el) { el.value = '13'; });
  await enthusiast.click('[data-sheet=save]');
  await enthusiast.waitForFunction(function () {
    var err = document.getElementById('pv-sheet-error');
    return err && err.textContent.indexOf('1 to 12') !== -1;
  });
  await enthusiast.click('#pv-start-h');
  await enthusiast.keyboard.type('12');
  assert.strictEqual(await enthusiast.$eval('#pv-start-h', function (el) { return el.value; }), '12');
  assert.strictEqual(await enthusiast.$eval('#pv-start-m', function (el) { return el.value; }), '00');
  await enthusiast.click('#pv-end-h');
  await enthusiast.keyboard.type('01');
  assert.strictEqual(await enthusiast.$eval('#pv-end-h', function (el) { return el.value; }), '01');
  assert.strictEqual(await enthusiast.$eval('#pv-end-m', function (el) { return el.value; }), '00');
  await enthusiast.click('[data-ampm="end"][data-ap="PM"]');
  await enthusiast.waitForFunction(function () {
    var on = document.querySelector('[data-ampm="end"][data-ap="PM"]');
    return on && on.getAttribute('aria-pressed') === 'true' && document.getElementById('pv-end-h').value === '01' && document.getElementById('pv-end-m').value === '00';
  });
  await enthusiast.click('[data-ampm="end"][data-ap="AM"]');
  await enthusiast.waitForFunction(function () {
    var on = document.querySelector('[data-ampm="end"][data-ap="AM"]');
    return on && on.classList.contains('on');
  });
  await enthusiast.click('#pv-sheet .pv-presence input[value="solo"]');
  await enthusiast.click('[data-sheet=save]');
  await enthusiast.waitForFunction(function () {
    var rows = JSON.parse(localStorage.getItem('wb.data.v1')).programs || [];
    return rows.some(function (row) { return row.workoutName === 'Easy day' && row.start === '00:00' && row.end === '01:00'; });
  });
  assert.deepStrictEqual(await enthusiast.evaluate(function () {
    return JSON.parse(localStorage.getItem('wb.addWorkoutTimes.v1'))['allow-test'];
  }), { start: '00:00', end: '01:00' });
  const againFrom = await (await enthusiast.$('#pv-workouts .pv-pick-card:nth-child(2)')).boundingBox();
  const againTo = await (await enthusiast.$('.pv-day:nth-child(3)')).boundingBox();
  await enthusiast.mouse.move(againFrom.x + againFrom.width / 2, againFrom.y + 24);
  await enthusiast.mouse.down();
  await enthusiast.mouse.move(againTo.x + againTo.width / 2, againTo.y + 40, { steps: 12 });
  await enthusiast.mouse.up();
  await enthusiast.waitForSelector('#pv-dropped');
  assert.deepStrictEqual(await enthusiast.evaluate(function () {
    return {
      name: document.getElementById('pv-dropped').textContent,
      startH: document.getElementById('pv-start-h').value,
      startM: document.getElementById('pv-start-m').value,
      endH: document.getElementById('pv-end-h').value,
      endM: document.getElementById('pv-end-m').value,
      startAp: document.querySelector('[data-ampm="start"].on').textContent,
      endAp: document.querySelector('[data-ampm="end"].on').textContent,
      picks: document.querySelectorAll('#pv-sheet .pv-pick').length,
      native: document.querySelectorAll('#pv-sheet input[type="time"]').length
    };
  }), { name: 'Easy day', startH: '12', startM: '00', endH: '01', endM: '00', startAp: 'AM', endAp: 'AM', picks: 0, native: 0 });
  await enthusiast.click('[data-sheet=cancel]');
  await enthusiast.waitForFunction(function () { return !document.getElementById('pv-sheet'); });

  const client = await browser.newPage();
  client.on('pageerror', function (err) { errors.push(String(err)); });
  await client.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await stub(client, {
    profile: { id: 'allow-test', email: 'kinisiathletics@gmail.com', membership: 'free_client' },
    session: { user: { id: 'allow-test', email: 'kinisiathletics@gmail.com' } },
    share: null,
    roster: { role: null, clients: [] },
    status: {}
  });
  await client.goto(URL);
  await client.evaluate(function (key, value) { localStorage.setItem(key, value); }, M.STORAGE_KEY, before);
  await client.reload();
  await client.click('#programs-open');
  await client.waitForFunction(function () {
    const note = document.getElementById('pv-role-note');
    return note && note.innerText.indexOf('Your trainer schedules your program') !== -1;
  });
  assert.strictEqual(await client.$('#pv-workouts .actions'), null);
  assert.strictEqual(await client.$('#pv-workouts button'), null);
  assert.strictEqual(await client.$('.pv-handle'), null);
  assert.strictEqual(await client.$('[data-drag]'), null);
  assert.strictEqual(await client.$('.pv-swipe'), null);
  assert.strictEqual(await client.$('[data-send]'), null);
  assert.strictEqual(await client.$('[data-open-wo]'), null);
  const mobile = await client.evaluate(function () {
    var cal = document.getElementById('pv-cal').getBoundingClientRect();
    var workouts = document.getElementById('pv-workouts').getBoundingClientRect();
    var strip = document.querySelector('.pv-week-scroll');
    var port = strip.getBoundingClientRect();
    var days = Array.prototype.map.call(document.querySelectorAll('.pv-day'), function (day) {
      return day.getBoundingClientRect();
    });
    var name = document.querySelector('.pv-day.today .name');
    var card = document.querySelector('#pv-rail .card');
    var style = name ? getComputedStyle(name) : null;
    return {
      calFirst: cal.top < workouts.top,
      scrolls: strip.scrollWidth > strip.clientWidth + 8,
      monFits: days[0].left >= port.left - 2 && days[4].right <= port.right + 4,
      weekendHidden: days[5].left >= port.right - 8,
      dayWide: days[0].width >= 60,
      name: name ? name.textContent : '',
      wraps: style ? style.webkitLineClamp === '2' && style.whiteSpace !== 'nowrap' : false,
      cardWidth: card ? card.getBoundingClientRect().width : 0
    };
  });
  assert.strictEqual(mobile.calFirst, true);
  assert.strictEqual(mobile.scrolls, true);
  assert.strictEqual(mobile.monFits, true);
  assert.strictEqual(mobile.weekendHidden, true);
  assert.strictEqual(mobile.dayWide, true);
  assert.strictEqual(mobile.name, 'Morning lift');
  assert.strictEqual(mobile.wraps, true);
  assert.ok(mobile.cardWidth >= 140 && mobile.cardWidth <= 200);
  await client.evaluate(function () {
    var strip = document.querySelector('.pv-week-scroll');
    strip.scrollLeft = strip.scrollWidth;
  });
  const weekend = await client.evaluate(function () {
    var port = document.querySelector('.pv-week-scroll').getBoundingClientRect();
    var days = document.querySelectorAll('.pv-day');
    var sat = days[5].getBoundingClientRect();
    var sun = days[6].getBoundingClientRect();
    return sat.right <= port.right + 4 && sun.right <= port.right + 4 && sat.left >= port.left - 2;
  });
  assert.strictEqual(weekend, true);
  await client.evaluate(function () { document.querySelector('.pv-week-scroll').scrollLeft = 0; });
  await client.click('.pv-day:not(.today) .pv-day-h');
  await client.waitForSelector('#pv-empty-day');
  assert.strictEqual(await client.$eval('#pv-empty-day', function (el) { return el.textContent; }), 'No workouts scheduled');
  assert.strictEqual(await client.$('[data-sheet=add-day]'), null);
  await client.evaluate(function () { document.getElementById('pv-sheet').click(); });
  await client.waitForFunction(function () { return !document.getElementById('pv-sheet'); });
  await client.click('.pv-day.today .pv-day-h');
  await client.waitForSelector('#pv-day-sheet .pv-day-row');
  const clientWeek = await client.evaluate(listSig);
  assert.strictEqual(clientWeek.add, false);
  assert.ok(clientWeek.rows[0].indexOf('Morning lift') !== -1);
  assert.ok(clientWeek.rows[0].indexOf('9:00') !== -1);
  assert.ok(await client.$('#pv-day-sheet .pv-day-row .pv-ico.solo'));
  assert.strictEqual(await client.$('#pv-day-sheet .pv-presence'), null);
  assert.strictEqual(await client.$('[data-sheet=remove]'), null);
  assert.strictEqual(await client.$('[data-sheet=add-day]'), null);
  await client.click('#pv-day-sheet .pv-day-row');
  const clientEdit = await client.evaluate(sheetSig);
  assert.deepStrictEqual(clientEdit.buttons, ['View', 'Run']);
  assert.strictEqual(clientEdit.when.indexOf('9:00') !== -1, true);
  assert.ok(await client.$('#pv-day-sheet .pv-slot-title .pv-ico.solo'));
  await client.evaluate(function () { return window.WBPreview.back(); });
  await client.waitForSelector('#pv-day-sheet .pv-day-row');
  await client.evaluate(function () { document.getElementById('pv-sheet').click(); });
  await client.waitForFunction(function () { return !document.getElementById('pv-sheet'); });
  await client.click('[data-cal=month]');
  await client.waitForSelector('.pv-month');
  await client.click('.pv-cell.today');
  await client.waitForSelector('#pv-day-sheet .pv-day-row');
  const clientMonth = await client.evaluate(listSig);
  assert.deepStrictEqual(clientMonth, clientWeek);
  assert.ok((await client.$eval('#pv-day-sheet', function (el) { return el.innerText; })).indexOf('Morning lift') !== -1);
  assert.strictEqual(await client.$('#pv-day-sheet [data-sheet=add-day]'), null);
  await client.click('#pv-day-sheet .pv-day-row');
  assert.deepStrictEqual(await client.evaluate(sheetSig), clientEdit);
  await client.evaluate(function () { return window.WBPreview.back(); });
  await client.waitForSelector('#pv-day-sheet .pv-day-row');
  await client.evaluate(function () { document.getElementById('pv-sheet').click(); });
  await client.waitForFunction(function () { return !document.getElementById('pv-sheet'); });
  await client.click('.pv-cell:not(.today):not(.is-out)');
  await client.waitForSelector('#pv-empty-day');
  assert.strictEqual(await client.$eval('#pv-empty-day', function (el) { return el.textContent; }), 'No workouts scheduled');
  assert.strictEqual(await client.$('[data-sheet=add-day]'), null);
  assert.strictEqual(await client.$('#pv-start'), null);

  await client.evaluate(function (key) {
    var data = JSON.parse(localStorage.getItem(key));
    var day = data.programs[0].date;
    var wo = data.workouts[1];
    data.programs.push({
      id: 'pg-trainer', ownerId: 'allow-test', workoutId: wo.id, workoutName: wo.name,
      items: wo.items, date: day, presence: 'trainer', start: '12:00', end: '13:00', updatedAt: Date.now()
    });
    localStorage.setItem(key, JSON.stringify(data));
  }, M.STORAGE_KEY);
  await client.reload();
  await client.waitForSelector('.pv-day.today .pv-ico.solo');
  await client.waitForSelector('.pv-day.today .pv-ico.trainer');
  const mobileWeekIcons = await client.evaluate(function () {
    function read(sel) {
      var style = getComputedStyle(document.querySelector(sel));
      return { color: style.color, background: style.backgroundColor };
    }
    return { solo: read('.pv-day.today .pv-ico.solo'), trainer: read('.pv-day.today .pv-ico.trainer') };
  });
  assert.strictEqual(mobileWeekIcons.solo.color, 'rgb(37, 99, 235)');
  assert.strictEqual(mobileWeekIcons.trainer.color, 'rgb(37, 99, 235)');
  assert.strictEqual(mobileWeekIcons.solo.background, 'rgba(0, 0, 0, 0)');
  assert.strictEqual(mobileWeekIcons.trainer.background, 'rgba(0, 0, 0, 0)');
  await client.click('[data-cal=month]');
  await client.waitForSelector('.pv-cell.today .pv-ico.solo');
  await client.waitForSelector('.pv-cell.today .pv-ico.trainer');
  await client.click('.pv-cell.today');
  await client.waitForSelector('#pv-day-sheet .pv-ico.solo');
  await client.waitForSelector('#pv-day-sheet .pv-ico.trainer');
  assert.strictEqual(await client.$('#pv-day-sheet .pv-presence'), null);

  const trainer = await browser.newPage();
  trainer.on('pageerror', function (err) { errors.push(String(err)); });
  await trainer.setViewport({ width: 1100, height: 900 });
  await stub(trainer, {
    profile: { id: 'trainer-1', email: 'kinisiathletics@gmail.com', membership: 'master_trainer' },
    session: { user: { id: 'trainer-1', email: 'kinisiathletics@gmail.com' } },
    share: null,
    roster: {
      role: 'master_trainer',
      clients: [
        { id: 'ada', email: 'ada@example.com', plan: 'Free Client' },
        { id: 'jo', name: 'Jo Park', email: 'jo@example.com', plan: 'Enthusiast' },
        { id: 'sam', name: 'sam@example.com', email: 'sam@example.com', plan: 'Enthusiast' }
      ]
    },
    status: {
      ada: { shared: false, enthusiast: false, linked: true, plan: 'Free Client' },
      jo: { shared: false, enthusiast: true, linked: true, plan: 'Enthusiast' },
      sam: { shared: true, enthusiast: true, linked: true, plan: 'Enthusiast' }
    }
  });
  await trainer.goto(URL);
  await trainer.evaluate(function (key, value) { localStorage.setItem(key, value); }, M.STORAGE_KEY, JSON.stringify(base));
  await trainer.reload();
  await trainer.click('#programs-open');
  await trainer.waitForSelector('#pv-client');
  await trainer.waitForSelector('#pv-workouts [data-drag]');
  assert.strictEqual(await trainer.$('.pv-handle'), null);
  assert.strictEqual(await trainer.$eval('#pv-client', function (el) { return el.value; }), 'all');
  assert.strictEqual(await trainer.$eval('#pv-client option:checked', function (el) { return el.textContent; }), 'All clients');
  assert.deepStrictEqual(await trainer.$$eval('#pv-client option', function (els) {
    return els.map(function (el) { return el.textContent; });
  }), ['All clients', 'My calendar', 'Client · Free Client', 'Jo Park · Enthusiast', 'Enthusiast · Enthusiast']);
  assert.ok((await trainer.$eval('#pv-client', function (el) { return el.innerHTML; })).indexOf('@') === -1);
  assert.strictEqual(await trainer.$('#pv-workouts .actions'), null);
  assert.strictEqual(await trainer.$('#pv-workouts button'), null);
  assert.strictEqual(await trainer.$('[data-send]'), null);
  await trainer.select('#pv-client', 'jo');
  await trainer.waitForSelector('#pv-private');
  assert.strictEqual(await trainer.$('.pv-week'), null);
  assert.strictEqual(await trainer.$('[data-send]'), null);
  await trainer.select('#pv-client', 'sam');
  await trainer.waitForFunction(function () {
    const note = document.getElementById('pv-role-note');
    return note && note.innerText.indexOf('Sharing is on') !== -1 && document.querySelector('[data-drag]');
  });
  assert.strictEqual(await trainer.$('[data-send]'), null);
  assert.ok(await trainer.$('#pv-schedule-hint'));

  await trainer.evaluate(function (key) {
    var data = JSON.parse(localStorage.getItem(key));
    var now = new Date();
    var day = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    var wo = data.workouts[0];
    data.programs = [
      { id: 'own1', ownerId: 'trainer-1', workoutId: 'own-wo', workoutName: 'My lift', items: wo.items, date: day, presence: 'solo', start: '07:00', end: '08:00', updatedAt: Date.now() },
      { id: 'ada1', ownerId: 'ada', workoutId: 'ada-wo', workoutName: 'Ada lift', items: wo.items, date: day, presence: 'trainer', start: '09:00', end: '10:00', updatedAt: Date.now() }
    ];
    localStorage.setItem(key, JSON.stringify(data));
  }, M.STORAGE_KEY);
  await trainer.reload();
  await trainer.waitForSelector('#pv-client');
  await trainer.waitForFunction(function () {
    var sel = document.getElementById('pv-client');
    return sel && sel.value === 'all' && document.body.innerText.indexOf('Self') !== -1 && document.body.innerText.indexOf('ada@example.com') === -1 && document.querySelector('.pv-day.today .pv-ico.solo') && document.querySelector('.pv-day.today .pv-ico.trainer');
  });
  await trainer.select('#pv-client', '');
  await trainer.waitForFunction(function () {
    var sel = document.getElementById('pv-client');
    return sel && sel.value === '' && sel.options[sel.selectedIndex].textContent === 'My calendar' && document.body.innerText.indexOf('My lift') !== -1;
  });
  assert.strictEqual((await trainer.$eval('#pv-cal', function (el) { return el.innerText; })).indexOf('Ada lift'), -1);
  assert.strictEqual(await trainer.$('#pv-private'), null);
  assert.ok(await trainer.$('#pv-schedule-hint'));
  assert.strictEqual(await trainer.$('#pv-role-note'), null);
  await trainer.click('.pv-day.today .pv-day-h');
  await trainer.waitForSelector('#pv-day-sheet .pv-day-row');
  await trainer.click('#pv-day-sheet .pv-day-row');
  await trainer.waitForSelector('#pv-day-sheet .pv-presence');
  await trainer.click('#pv-day-sheet .pv-presence input[value="trainer"]');
  await trainer.waitForFunction(function () {
    var row = JSON.parse(localStorage.getItem('wb.data.v1')).programs.filter(function (item) { return item.id === 'own1'; })[0];
    return row && row.presence === 'trainer' && row.ownerId === 'trainer-1';
  });
  await trainer.select('#pv-client', 'ada');
  await trainer.waitForFunction(function () {
    return document.getElementById('pv-client').value === 'ada' && document.body.innerText.indexOf('Ada lift') !== -1;
  });
  assert.strictEqual((await trainer.$eval('#pv-cal', function (el) { return el.innerText; })).indexOf('My lift'), -1);

  const lone = await browser.newPage();
  lone.on('pageerror', function (err) { errors.push(String(err)); });
  await lone.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await stub(lone, {
    profile: { id: 'trainer-2', email: 'kinisiathletics@gmail.com', membership: 'trainer' },
    session: { user: { id: 'trainer-2', email: 'kinisiathletics@gmail.com' } },
    share: null,
    roster: { role: 'trainer', clients: [] },
    status: {}
  });
  await lone.goto(URL);
  await lone.evaluate(function (key, value) { localStorage.setItem(key, value); }, M.STORAGE_KEY, JSON.stringify(base));
  await lone.reload();
  await lone.click('#programs-open');
  await lone.waitForSelector('#pv-cal');
  await lone.waitForSelector('#pv-schedule-hint');
  assert.strictEqual(await lone.$('#pv-client'), null);
  assert.ok((await lone.$eval('#app', function (el) { return el.innerText; })).indexOf('No clients yet') !== -1);
  await lone.click('.pv-day.today .pv-day-h');
  await lone.waitForSelector('#pv-empty-day');
  await lone.click('[data-sheet=add-day]');
  await lone.waitForSelector('#pv-sheet .pv-presence input[value="solo"]');
  assert.strictEqual(await lone.evaluate(function () {
    return document.querySelectorAll('#pv-sheet .pv-presence input:checked').length;
  }), 0);
  await lone.click('#pv-sheet .pv-pick');
  await lone.click('#pv-sheet .pv-presence input[value="solo"]');
  await lone.waitForFunction(function () {
    var chosen = document.querySelector('#pv-sheet .pv-presence input[value="solo"]');
    return chosen && chosen.checked;
  });
  await lone.click('[data-sheet=save]');
  await lone.waitForFunction(function () {
    var rows = JSON.parse(localStorage.getItem('wb.data.v1')).programs || [];
    return rows.some(function (row) { return row.ownerId === 'trainer-2' && row.presence === 'solo'; });
  });

  const link = await browser.newPage();
  link.on('pageerror', function (err) { errors.push(String(err)); });
  await stub(link, {
    profile: { id: 'allow-test', email: 'kinisiathletics@gmail.com', membership: 'enthusiast' },
    session: { user: { id: 'allow-test', email: 'kinisiathletics@gmail.com' } },
    share: { on: false, enthusiast: true, linked: false },
    roster: { role: null, clients: [] },
    status: {}
  });
  await link.goto(URL + '?preview=programs');
  await link.waitForSelector('#pv-root');
  assert.strictEqual(await link.evaluate(function () { return location.hash; }), '#/programs');
  assert.ok((await link.evaluate(function () { return location.search; })).indexOf('preview=') === -1);
  assert.ok((await link.$eval('#app', function (el) { return el.innerText; })).indexOf('Sample:') === -1);

  assert.deepStrictEqual(errors, []);
  console.log('PROGRAMS UI OK');
  await browser.close();
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
