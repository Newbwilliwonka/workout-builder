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
    data.programs = [{
      id: 'pg1', ownerId: 'allow-test', workoutId: data.workouts[0].id, workoutName: 'Morning lift',
      items: data.workouts[0].items, date: day, presence: 'solo', start: '09:00', end: '10:30', updatedAt: Date.now()
    }];
    data.sessions = [{
      id: 'ses1', workoutId: data.workouts[0].id, workoutName: 'Morning lift', programId: 'pg1',
      startedAt: Date.now() - 1000, endedAt: Date.now(), results: [{ logged: true, name: 'Press' }]
    }];
    localStorage.setItem(key, JSON.stringify(data));
  }, M.STORAGE_KEY, JSON.stringify(base));
  await enthusiast.reload();
  await enthusiast.waitForSelector('#programs-open');
  assert.strictEqual(await enthusiast.$eval('#programs-open', function (el) { return el.textContent; }), 'Programs');
  assert.ok((await enthusiast.$eval('#app', function (el) { return el.innerText; })).indexOf('(preview)') === -1);
  const before = await enthusiast.evaluate(function (key) { return localStorage.getItem(key); }, M.STORAGE_KEY);
  await enthusiast.click('#programs-open');
  await enthusiast.waitForFunction(function () {
    const root = document.getElementById('pv-root');
    return root && root.getAttribute('data-role-now') === 'enthusiast' && document.querySelector('.pv-check');
  });
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
  assert.ok(icon.h >= 18 && icon.h <= 26, 'icon height ' + icon.h);
  assert.ok(icon.w >= 18 && icon.w <= 26, 'icon width ' + icon.w);
  assert.ok(icon.d.indexOf('M12') === 0 || icon.d.indexOf('M9') === 0);
  assert.strictEqual(icon.tag, 'BUTTON');
  await enthusiast.click('.pv-day .pv-day-h');
  await enthusiast.waitForSelector('#pv-start');
  await enthusiast.waitForSelector('#pv-end');
  await enthusiast.click('[data-sheet=cancel]');
  await enthusiast.waitForFunction(function () { return !document.getElementById('pv-sheet'); });

  const handle = await enthusiast.$('#pv-workouts .pv-handle');
  const from = await handle.boundingBox();
  const target = await enthusiast.$('.pv-day:not(.today)');
  const to = await target.boundingBox();
  await enthusiast.mouse.move(from.x + 8, from.y + 8);
  await enthusiast.mouse.down();
  await enthusiast.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 12 });
  await enthusiast.mouse.up();
  await enthusiast.waitForSelector('#pv-sheet');
  assert.strictEqual(await enthusiast.$eval('.pv-pick.on .name', function (el) { return el.textContent; }), 'Morning lift');
  await enthusiast.$eval('#pv-end', function (el) { el.value = '08:00'; });
  await enthusiast.click('[data-sheet=save]');
  await enthusiast.waitForSelector('#pv-sheet-error');
  assert.ok((await enthusiast.$eval('#pv-sheet-error', function (el) { return el.textContent; })).indexOf('after') !== -1);
  await enthusiast.$eval('#pv-end', function (el) { el.value = '10:00'; });
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

  await enthusiast.click('[data-open-session]');
  await enthusiast.waitForSelector('#pv-sheet');
  assert.deepStrictEqual(await enthusiast.$$eval('#pv-sheet button', function (nodes) { return nodes.map(function (node) { return node.textContent; }); }), ['Run', 'View', 'Save times', 'Remove workout', 'Add workout']);
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
  await enthusiast.click('.pv-day.today .pv-day-h');
  await enthusiast.waitForSelector('#pv-day-sheet');
  const fromWeek = await enthusiast.evaluate(sheetSig);
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
  await enthusiast.waitForSelector('#pv-day-sheet');
  assert.ok(await enthusiast.$('.pv-month'));
  assert.strictEqual(await enthusiast.$('.pv-week'), null);
  const dayText = await enthusiast.$eval('#pv-day-sheet', function (el) { return el.innerText; });
  assert.ok(dayText.indexOf('Morning lift') !== -1);
  const fromMonth = await enthusiast.evaluate(sheetSig);
  assert.deepStrictEqual(fromMonth, fromWeek);
  assert.deepStrictEqual(fromMonth.buttons, ['Run', 'View', 'Save times', 'Remove workout', 'Add workout']);
  assert.strictEqual(fromMonth.start, '09:00');
  assert.strictEqual(fromMonth.end, '10:30');
  await enthusiast.evaluate(function () { document.getElementById('pv-sheet').click(); });
  await enthusiast.waitForFunction(function () { return !document.getElementById('pv-sheet'); });
  await enthusiast.click('.pv-cell:not(.today):not(.is-out)');
  await enthusiast.waitForSelector('#pv-start');
  await enthusiast.waitForSelector('#pv-end');
  assert.ok(await enthusiast.$('.pv-month'));
  await enthusiast.click('[data-sheet=cancel]');
  await enthusiast.waitForFunction(function () { return !document.getElementById('pv-sheet'); });
  const monthHandle = await enthusiast.$('#pv-workouts .pv-handle');
  const monthFrom = await monthHandle.boundingBox();
  const monthCell = await enthusiast.$('.pv-cell:not(.today):not(.is-out)');
  const monthTo = await monthCell.boundingBox();
  await enthusiast.mouse.move(monthFrom.x + 8, monthFrom.y + 8);
  await enthusiast.mouse.down();
  await enthusiast.mouse.move(monthTo.x + monthTo.width / 2, monthTo.y + monthTo.height / 2, { steps: 12 });
  await enthusiast.mouse.up();
  await enthusiast.waitForSelector('#pv-sheet');
  assert.strictEqual(await enthusiast.$eval('.pv-pick.on .name', function (el) { return el.textContent; }), 'Morning lift');
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
  assert.strictEqual(await client.$eval('#pv-empty-day', function (el) { return el.textContent; }), 'Nothing scheduled');
  await client.evaluate(function () { document.getElementById('pv-sheet').click(); });
  await client.waitForFunction(function () { return !document.getElementById('pv-sheet'); });
  await client.click('.pv-day.today .pv-day-h');
  await client.waitForSelector('#pv-day-sheet');
  const clientWeek = await client.evaluate(sheetSig);
  assert.deepStrictEqual(clientWeek.buttons, ['Run', 'View']);
  assert.strictEqual(clientWeek.when.indexOf('9:00') !== -1, true);
  assert.strictEqual(await client.$('[data-sheet=remove]'), null);
  assert.strictEqual(await client.$('[data-sheet=add]'), null);
  await client.evaluate(function () { document.getElementById('pv-sheet').click(); });
  await client.waitForFunction(function () { return !document.getElementById('pv-sheet'); });
  await client.click('[data-cal=month]');
  await client.waitForSelector('.pv-month');
  await client.click('.pv-cell.today');
  await client.waitForSelector('#pv-day-sheet');
  const clientMonth = await client.evaluate(sheetSig);
  assert.deepStrictEqual(clientMonth, clientWeek);
  assert.ok((await client.$eval('#pv-day-sheet', function (el) { return el.innerText; })).indexOf('Morning lift') !== -1);
  assert.strictEqual(await client.$('#pv-day-sheet [data-sheet=add-day]'), null);
  assert.deepStrictEqual(clientMonth.buttons, ['Run', 'View']);
  await client.evaluate(function () { document.getElementById('pv-sheet').click(); });
  await client.waitForFunction(function () { return !document.getElementById('pv-sheet'); });
  await client.click('.pv-cell:not(.today):not(.is-out)');
  await client.waitForSelector('#pv-empty-day');
  assert.strictEqual(await client.$eval('#pv-empty-day', function (el) { return el.textContent; }), 'Nothing scheduled');
  assert.strictEqual(await client.$('#pv-start'), null);

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
        { id: 'jo', email: 'jo@example.com', plan: 'Enthusiast' },
        { id: 'sam', email: 'sam@example.com', plan: 'Enthusiast' }
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
  await trainer.waitForSelector('.pv-handle');
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
    return note && note.innerText.indexOf('Sharing is on') !== -1 && document.querySelector('.pv-handle');
  });
  assert.strictEqual(await trainer.$('[data-send]'), null);
  assert.ok(await trainer.$('#pv-schedule-hint'));

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
