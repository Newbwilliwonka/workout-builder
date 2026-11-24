// Client menu on History and Dashboard. One person at a time.
// Phone width. Rows are fixtures, never the live database.
// node tests/tracking-clients-ui.test.js [url]
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const pp = require('puppeteer-core');
const M = require('../model.js');
const remoteHistory = require('./history-fixture').remoteHistory;

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const OUT = process.argv[3] || '/opt/cursor/artifacts';
const CHROME = process.env.CHROME || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : '/usr/local/bin/google-chrome');
const TRAINER = '11111111-1111-4111-8111-111111111111';
const MIA = '22222222-2222-4222-8222-222222222222';
const NINA = '33333333-3333-4333-8333-333333333333';
const OWEN = '44444444-4444-4444-8444-444444444444';
const GONE = '99999999-9999-4999-8999-999999999999';

function workout() {
  const w = M.newWorkout('Lower strength');
  w.items = [M.normalizeExercise(M.newExercise({
    name: 'Barbell squat', sets: 3, weight: { unit: 'lb', value: 185 },
    mode: 'reps', modeConfig: { repsType: 'number', count: 5, restSec: 90 }
  }))];
  return w;
}

function logged(sessionId, day, name, exercise, libraryId) {
  return {
    sessionId: sessionId, localDate: day, startedAt: Date.parse(day + 'T15:00:00Z'),
    workoutName: name, exerciseName: exercise, libraryExerciseId: libraryId,
    mode: 'reps', setNumber: 1, status: 'completed', displayUnit: 'lb',
    plannedReps: 5, actualReps: 5, plannedWeightKg: 40, actualWeightKg: 40
  };
}

function ownHistory() {
  return remoteHistory([logged('me-1', '2026-11-02', 'Coach day', 'Coach press', '0901')]);
}

function secretHistory() {
  return remoteHistory([logged('owen-1', '2026-11-09', 'Owen secret', 'Owen press', '0902')]);
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, type: 'png' });
  const stat = fs.statSync(file);
  assert.ok(stat.size > 1000, name + ' screenshot is empty');
  return file;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await pp.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const errors = [];
  const miaRows = remoteHistory();
  const ninaRows = remoteHistory();
  const owenRows = secretHistory();
  const own = ownHistory();
  const roster = {
    role: 'trainer',
    clients: [
      { id: OWEN, display_name: 'Owen Blake', name: 'Owen Blake', email: 'owen@example.com', plan: 'Enthusiast', membership: 'enthusiast' },
      { id: MIA, display_name: 'Mia Chen', name: 'Mia Chen', email: 'mia@example.com', plan: 'Free Client', membership: 'free_client' },
      { id: NINA, display_name: 'Nina Shah', name: 'Nina Shah', email: 'nina@example.com', plan: 'Enthusiast', membership: 'none', intended_plan: 'enthusiast' }
    ]
  };
  const status = {
    [MIA]: { shared: false, enthusiast: false, linked: true, plan: 'Free Client' },
    [NINA]: { shared: true, enthusiast: true, linked: true, plan: 'Enthusiast' },
    [OWEN]: { shared: false, enthusiast: true, linked: true, plan: 'Enthusiast' }
  };

  const trainer = await browser.newPage();
  trainer.on('pageerror', function (err) { errors.push(String(err)); });
  trainer.on('request', function (req) {
    if (/supabase\.co/i.test(req.url())) errors.push('live database request ' + req.url());
  });
  await trainer.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await require('./allow.js').stubAuth(trainer, {
    session: { user: { id: TRAINER, email: 'coach@example.com' } },
    profile: {
      id: TRAINER, email: 'coach@example.com', membership: 'trainer',
      intended_plan: 'trainer', display_name: 'Alex Rivera'
    }
  });
  await trainer.evaluateOnNewDocument(function (pack) {
    window.__wbDashboardNow = new Date(2026, 10, 16, 12, 0, 0).getTime();
    window.__trackCalls = { history: 0, tracking: [], schedule: [], workouts: [], status: [] };
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
        value.myHistory = function () {
          window.__trackCalls.history += 1;
          return Promise.resolve(pack.own);
        };
        value.mySchedule = function () { return Promise.resolve({ entries: [] }); };
        value.myDashboardLayout = function () { return Promise.resolve({ cards: null }); };
        value.saveDashboardLayout = function () { return Promise.resolve({ ok: true }); };
        value.resetDashboardLayout = function () { return Promise.resolve({ ok: true }); };
        value.roster = function () { return Promise.resolve(pack.roster); };
        value.clientStatus = function (id) {
          window.__trackCalls.status.push(id);
          return Promise.resolve(pack.status[id] || null);
        };
        value.clientTracking = function (id) {
          window.__trackCalls.tracking.push(id);
          return Promise.resolve(pack.rows[id] || { sets: [], sessions: [], exercises: [] });
        };
        value.clientSchedule = function (id) {
          window.__trackCalls.schedule.push(id);
          return Promise.resolve({ entries: [] });
        };
        value.clientAccountWorkouts = function (id) {
          window.__trackCalls.workouts.push('account:' + id);
          return Promise.resolve({ workouts: [] });
        };
        value.clientWorkouts = function (id) {
          window.__trackCalls.workouts.push('own:' + id);
          return Promise.resolve([]);
        };
        value.clientSentWorkouts = function (id) {
          window.__trackCalls.workouts.push('sent:' + id);
          return Promise.resolve([]);
        };
        ['workoutCopies', 'accountPull', 'accountPush', 'accountImport', 'saveWorkoutCopy', 'deleteWorkoutCopy', 'freshSession', 'myConnection', 'shareSetting', 'myShares'].forEach(function (name) {
          value[name] = function () { return Promise.resolve(null); };
        });
      }
    });
  }, {
    roster: roster,
    status: status,
    own: own,
    rows: { [MIA]: miaRows, [NINA]: ninaRows, [OWEN]: owenRows }
  });
  const data = M.emptyData();
  data.workouts.push(workout());
  await trainer.evaluateOnNewDocument(function (key, value) {
    localStorage.setItem(key, value);
  }, M.STORAGE_KEY, JSON.stringify(data));

  await trainer.goto(URL + '#/tracking', { waitUntil: 'domcontentloaded' });
  await trainer.waitForSelector('#client-pick');
  await trainer.waitForSelector('#history-by-workout.on');
  const menu = await trainer.evaluate(function () {
    var sel = document.getElementById('client-pick');
    return {
      tag: sel.tagName,
      multiple: sel.multiple,
      names: Array.prototype.map.call(sel.options, function (el) { return el.textContent; }),
      values: Array.prototype.map.call(sel.options, function (el) { return el.value; }),
      html: sel.innerHTML,
      selected: sel.value
    };
  });
  assert.strictEqual(menu.tag, 'SELECT');
  assert.strictEqual(menu.multiple, false);
  assert.strictEqual(menu.selected, '');
  assert.deepStrictEqual(menu.names, [
    'Me · Alex Rivera',
    'Mia Chen',
    'Owen Blake · Not shared',
    'Nina Shah'
  ]);
  assert.deepStrictEqual(menu.values, ['', MIA, OWEN, NINA]);
  assert.strictEqual(menu.html.indexOf('@'), -1);
  assert.ok((await trainer.$eval('#app', function (el) { return el.innerText; })).indexOf('Coach day') >= 0);
  assert.ok((await trainer.$eval('#app', function (el) { return el.innerText; })).indexOf('Conditioning') < 0);
  const firstCalls = await trainer.evaluate(function () { return window.__trackCalls; });
  assert.strictEqual(firstCalls.history, 1);
  assert.deepStrictEqual(firstCalls.tracking, []);
  assert.ok(firstCalls.status.indexOf(MIA) < 0);
  assert.ok(firstCalls.status.indexOf(NINA) >= 0 && firstCalls.status.indexOf(OWEN) >= 0);

  await trainer.evaluate(function () {
    var sel = document.getElementById('client-pick');
    sel.size = sel.options.length;
    sel.style.minHeight = '0';
    sel.style.height = 'auto';
  });
  await shot(trainer, 'history-client-menu.png');
  await trainer.evaluate(function () {
    var sel = document.getElementById('client-pick');
    sel.removeAttribute('size');
    sel.style.minHeight = '';
    sel.style.height = '';
  });

  await trainer.evaluate(function () {
    window.__trackCalls.history = 0;
    window.__trackCalls.tracking = [];
    window.__trackCalls.schedule = [];
    window.__trackCalls.workouts = [];
  });
  await trainer.select('#client-pick', MIA);
  await trainer.waitForFunction(function (id) {
    return location.hash === '#/tracking/client/' + id && document.querySelector('.hx-row');
  }, {}, MIA);
  const miaList = await trainer.evaluate(function () {
    return {
      selected: document.getElementById('client-pick').value,
      names: Array.prototype.map.call(document.querySelectorAll('.hx-row .name'), function (el) { return el.textContent; }),
      text: document.getElementById('app').innerText
    };
  });
  assert.strictEqual(miaList.selected, MIA);
  assert.ok(miaList.names.some(function (name) { return name.indexOf('Conditioning') >= 0; }));
  assert.ok(miaList.text.indexOf('Coach day') < 0);
  assert.ok(miaList.text.indexOf('Owen secret') < 0);
  assert.ok(miaList.text.indexOf('@') < 0);
  const miaCalls = await trainer.evaluate(function () { return window.__trackCalls; });
  assert.strictEqual(miaCalls.history, 0);
  assert.deepStrictEqual(miaCalls.tracking, [MIA]);
  assert.deepStrictEqual(miaCalls.schedule, []);
  await shot(trainer, 'history-client-workouts.png');

  await trainer.click('#back');
  await trainer.waitForFunction(function () {
    var pick = document.getElementById('client-pick');
    return location.hash === '#/tracking' && pick && pick.value === '' &&
      document.body.innerText.indexOf('Coach day') >= 0 &&
      document.body.innerText.indexOf('Conditioning') < 0 &&
      document.getElementById('tracking-open').classList.contains('on');
  });

  await trainer.select('#client-pick', MIA);
  await trainer.waitForFunction(function (id) {
    return location.hash === '#/tracking/client/' + id && document.querySelector('.hx-row');
  }, {}, MIA);
  await trainer.click('[data-session="sq-1112"]');
  await trainer.waitForFunction(function (id) {
    return location.hash === '#/history/client/' + id + '/session/sq-1112';
  }, {}, MIA);
  await trainer.waitForSelector('.hx-set');
  const detail = await trainer.evaluate(function () {
    return {
      title: document.getElementById('title').textContent,
      text: document.getElementById('app').innerText,
      fields: document.querySelectorAll('input, textarea, [contenteditable="true"]').length,
      tabs: !!document.getElementById('tracking-tabs')
    };
  });
  assert.strictEqual(detail.title, 'Tracking');
  assert.ok(detail.text.indexOf('Barbell squat') >= 0);
  assert.ok(detail.text.indexOf('225 lb') >= 0);
  assert.ok(detail.text.indexOf('Coach press') < 0);
  assert.strictEqual(detail.fields, 0);
  assert.strictEqual(detail.tabs, false);
  await trainer.reload({ waitUntil: 'domcontentloaded' });
  await trainer.waitForFunction(function (id) {
    var title = document.getElementById('title');
    return location.hash === '#/history/client/' + id + '/session/sq-1112' &&
      title && title.textContent === 'Tracking' &&
      document.body.innerText.indexOf('Barbell squat') >= 0 &&
      document.body.innerText.indexOf('Coach press') < 0 &&
      window.__trackCalls.history === 0 &&
      window.__trackCalls.tracking.indexOf(id) >= 0;
  }, {}, MIA);
  await trainer.click('#back');
  await trainer.waitForFunction(function (id) {
    return location.hash === '#/tracking/client/' + id && document.getElementById('history-by-workout');
  }, {}, MIA);
  await trainer.click('#history-by-exercise');
  await trainer.waitForSelector('[data-history="lib-0101"]');
  await trainer.click('[data-history="lib-0101"]');
  await trainer.waitForFunction(function (id) {
    return location.hash === '#/history/client/' + id + '/lib-0101' &&
      document.getElementById('title').textContent === 'Barbell squat';
  }, {}, MIA);
  await trainer.reload({ waitUntil: 'domcontentloaded' });
  await trainer.waitForFunction(function (id) {
    return location.hash === '#/history/client/' + id + '/lib-0101' &&
      document.getElementById('title').textContent === 'Barbell squat' &&
      document.body.innerText.indexOf('Coach press') < 0 &&
      window.__trackCalls.history === 0 &&
      window.__trackCalls.tracking.indexOf(id) >= 0;
  }, {}, MIA);
  await trainer.click('#back');
  await trainer.waitForSelector('#history-by-workout.on');

  await trainer.click('#tracking-tab-dashboard');
  await trainer.waitForFunction(function (id) {
    var note = document.getElementById('dashboard-plan-note');
    return location.hash === '#/tracking/dashboard/client/' + id &&
      document.getElementById('client-pick').value === id &&
      document.getElementById('dashboard-strength') &&
      note && note.textContent.indexOf('of') >= 0;
  }, {}, MIA);
  const miaDash = await trainer.evaluate(function () {
    return {
      strength: document.getElementById('dashboard-strength').innerText,
      fields: document.querySelectorAll('#dashboard-strength input, #dashboard-strength textarea, #dashboard-records input').length,
      privateNote: !!document.getElementById('tracking-private'),
      calls: window.__trackCalls
    };
  });
  assert.ok(miaDash.strength.indexOf('Barbell squat') >= 0 || miaDash.strength.indexOf('Back squat') >= 0 || miaDash.strength.length > 0);
  assert.ok((await trainer.$eval('#app', function (el) { return el.innerText; })).indexOf('Coach press') < 0);
  assert.ok((await trainer.$eval('#app', function (el) { return el.innerText; })).indexOf('Owen secret') < 0);
  assert.strictEqual(miaDash.fields, 0);
  assert.strictEqual(miaDash.privateNote, false);
  assert.ok(miaDash.calls.tracking.indexOf(MIA) >= 0);
  assert.ok(miaDash.calls.schedule.indexOf(MIA) >= 0);
  assert.ok(miaDash.calls.workouts.some(function (row) { return row.indexOf(MIA) >= 0; }));
  assert.strictEqual(miaDash.calls.tracking.indexOf(OWEN), -1);
  assert.strictEqual(miaDash.calls.schedule.indexOf(OWEN), -1);

  await trainer.click('#tracking-tab-history');
  await trainer.waitForFunction(function (id) {
    return location.hash === '#/tracking/client/' + id &&
      document.getElementById('client-pick').value === id &&
      document.body.innerText.indexOf('Conditioning') >= 0;
  }, {}, MIA);

  await trainer.evaluate(function () {
    window.__trackCalls.tracking = [];
    window.__trackCalls.schedule = [];
    window.__trackCalls.workouts = [];
    window.__trackCalls.history = 0;
  });
  await trainer.select('#client-pick', OWEN);
  await trainer.waitForSelector('#tracking-private');
  const hidden = await trainer.evaluate(function (id) {
    return {
      hash: location.hash,
      selected: document.querySelector('#client-pick option:checked').textContent,
      text: document.getElementById('app').innerText,
      list: !!document.getElementById('history-list'),
      empty: !!document.getElementById('history-empty'),
      sheet: !!document.getElementById('dashboard-sheet'),
      calls: window.__trackCalls,
      value: document.getElementById('client-pick').value
    };
  }, OWEN);
  assert.strictEqual(hidden.hash, '#/tracking/client/' + OWEN);
  assert.strictEqual(hidden.value, OWEN);
  assert.strictEqual(hidden.selected, 'Owen Blake · Not shared');
  assert.ok(hidden.text.indexOf('Not shared') >= 0);
  assert.ok(hidden.text.indexOf('turned off sharing') >= 0);
  assert.ok(hidden.text.indexOf('Owen secret') < 0);
  assert.ok(hidden.text.indexOf('Conditioning') < 0);
  assert.ok(hidden.text.indexOf('Coach day') < 0);
  assert.strictEqual(hidden.list, false);
  assert.strictEqual(hidden.empty, false);
  assert.strictEqual(hidden.sheet, false);
  assert.deepStrictEqual(hidden.calls.tracking, []);
  assert.deepStrictEqual(hidden.calls.schedule, []);
  assert.deepStrictEqual(hidden.calls.workouts, []);
  assert.strictEqual(hidden.calls.history, 0);
  await shot(trainer, 'history-not-shared.png');
  await trainer.goto(URL + '#/history/client/' + OWEN + '/session/owen-1', { waitUntil: 'domcontentloaded' });
  await trainer.waitForSelector('#tracking-private');
  const reloadedPrivate = await trainer.evaluate(function () {
    return {
      hash: location.hash,
      text: document.getElementById('app').innerText,
      calls: window.__trackCalls
    };
  });
  assert.strictEqual(reloadedPrivate.hash, '#/history/client/' + OWEN + '/session/owen-1');
  assert.ok(reloadedPrivate.text.indexOf('Not shared') >= 0);
  assert.ok(reloadedPrivate.text.indexOf('Owen secret') < 0);
  assert.ok(reloadedPrivate.text.indexOf('Coach day') < 0);
  assert.deepStrictEqual(reloadedPrivate.calls.tracking, []);
  assert.strictEqual(reloadedPrivate.calls.history, 0);
  await trainer.click('#back');
  await trainer.waitForFunction(function (id) {
    return location.hash === '#/tracking/client/' + id &&
      document.getElementById('tracking-tab-dashboard') &&
      document.getElementById('tracking-private');
  }, {}, OWEN);

  await trainer.click('#tracking-tab-dashboard');
  await trainer.waitForFunction(function (id) {
    return location.hash === '#/tracking/dashboard/client/' + id &&
      document.getElementById('tracking-private') &&
      !document.getElementById('dashboard-sheet') &&
      !document.getElementById('dashboard-strength');
  }, {}, OWEN);
  const hiddenDash = await trainer.evaluate(function () { return window.__trackCalls; });
  assert.deepStrictEqual(hiddenDash.tracking, []);
  assert.deepStrictEqual(hiddenDash.schedule, []);
  assert.deepStrictEqual(hiddenDash.workouts, []);
  assert.strictEqual(await trainer.$eval('#client-pick', function (el) { return el.value; }), OWEN);

  await trainer.$eval('#tracking-tab-history', function (el) { el.click(); });
  await trainer.waitForSelector('#tracking-tab-history.on');
  await trainer.waitForSelector('#tracking-private');
  assert.strictEqual(await trainer.evaluate(function (id) {
    return location.hash === '#/tracking/client/' + id && document.getElementById('client-pick').value === id;
  }, OWEN), true);

  await trainer.select('#client-pick', NINA);
  await trainer.waitForFunction(function () {
    return document.body.innerText.indexOf('Conditioning') >= 0 && !document.getElementById('tracking-private');
  });
  assert.strictEqual(await trainer.$eval('#client-pick option:checked', function (el) { return el.textContent; }), 'Nina Shah');
  assert.ok((await trainer.evaluate(function () { return window.__trackCalls.tracking; })).indexOf(NINA) >= 0);
  assert.ok((await trainer.evaluate(function () { return window.__trackCalls.tracking; })).indexOf(OWEN) < 0);

  await trainer.select('#client-pick', '');
  await trainer.waitForFunction(function () {
    return location.hash === '#/tracking' && document.body.innerText.indexOf('Coach day') >= 0 &&
      document.body.innerText.indexOf('Conditioning') < 0;
  });
  assert.ok((await trainer.evaluate(function () { return window.__trackCalls.history; })) >= 1);

  await trainer.goto(URL + '#/tracking/client/' + GONE, { waitUntil: 'domcontentloaded' });
  await trainer.waitForSelector('#client-missing');
  assert.ok((await trainer.evaluate(function (id) {
    return window.__trackCalls.tracking.indexOf(id) < 0;
  }, GONE)));
  await trainer.goto(URL + '#/tracking/client/not-an-id', { waitUntil: 'domcontentloaded' });
  await trainer.waitForFunction(function () { return location.hash === '#/tracking' && document.getElementById('client-pick'); });

  const free = await browser.newPage();
  free.on('pageerror', function (err) { errors.push('free ' + err); });
  await free.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await require('./allow.js').stubAuth(free, {
    session: { user: { id: MIA, email: 'mia@example.com' } },
    profile: { id: MIA, email: 'mia@example.com', membership: 'free_client', intended_plan: 'free_client', display_name: 'Mia Chen' }
  });
  await free.evaluateOnNewDocument(function () {
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
        value.myHistory = function () { return Promise.resolve({ sets: [], sessions: [], exercises: [] }); };
        value.myShares = function () { return Promise.resolve({ shares: [] }); };
        value.roster = function () { return Promise.resolve({ role: null, clients: [] }); };
        value.clientTracking = function () { return Promise.resolve({ sets: [], sessions: [], exercises: [] }); };
      }
    });
  });
  await free.goto(URL + '#/tracking/client/' + OWEN, { waitUntil: 'domcontentloaded' });
  await free.waitForFunction(function () { return location.hash === '#/tracking'; });
  await free.waitForSelector('#history-empty');
  assert.strictEqual(await free.$('#client-pick'), null);
  assert.ok((await free.$eval('#app', function (el) { return el.innerText; })).indexOf('Mia Chen') < 0);

  assert.deepStrictEqual(errors, []);
  console.log('TRACKING CLIENTS UI OK');
  await browser.close();
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
