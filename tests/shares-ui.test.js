// Trainer sharing and the free-client inbox. Phone width.
// Rows are the history fixture or cards built in this file. No database.
// node tests/shares-ui.test.js [url]
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const pp = require('puppeteer-core');
const M = require('../model.js');
const D = require('../dashboard.js');
const H = require('../history.js');
const remoteHistory = require('./history-fixture').remoteHistory;

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const OUT = process.argv[3] || '/opt/cursor/artifacts';
const CHROME = process.env.CHROME || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : '/usr/local/bin/google-chrome');
const TRAINER = '11111111-1111-4111-8111-111111111111';
const ADA = '22222222-2222-4222-8222-222222222222';
const NEIL = '55555555-5555-4555-8555-555555555555';
const FAN = '99999999-9999-4999-8999-999999999999';
const PAT = '12121212-1212-4212-8212-121212121212';
const KIP = '13131313-1313-4313-8313-131313131313';
const SHARE_NEW = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const SHARE_OLD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const NOW = new Date(2026, 10, 16, 12, 0, 0);

function workout() {
  const w = M.newWorkout('Lower strength');
  w.items = [M.normalizeExercise(M.newExercise({
    name: 'Barbell squat', sets: 3, weight: { unit: 'lb', value: 185 },
    mode: 'reps', modeConfig: { repsType: 'number', count: 5, restSec: 90 }
  }))];
  return w;
}

function frozenCards() {
  const remote = remoteHistory();
  const sets = H.fromRows(remote.sessions, remote.sets, remote.exercises);
  const model = D.build({
    sets: sets,
    sessions: remote.sessions,
    entries: [{ id: 'pg1', date: '2026-11-14', workoutId: 'wo' }],
    now: NOW,
    layout: true
  });
  return D.freeze(model, D.STANDARD, { asOf: '2026-11-16', trainerName: 'Coach Lee' }).cards;
}

function olderCards() {
  return [{ type: 'plan', plan: { total: 2, hits: 2, pct: 100, rating: { label: 'Elite', color: '#0F766E' } } }];
}

async function shot(page, name, full) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, type: 'png', fullPage: !!full });
  const stat = fs.statSync(file);
  assert.ok(stat.size > 1000, name + ' screenshot is empty');
  return file;
}

async function openPage(browser, cfg) {
  const page = await browser.newPage();
  page.__errors = [];
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  page.on('pageerror', function (err) { page.__errors.push(String(err)); });
  page.on('request', function (req) {
    if (/supabase\.co/i.test(req.url())) page.__errors.push('live database request ' + req.url());
  });
  await require('./allow.js').stubAuth(page, {
    session: { user: { id: cfg.id, email: cfg.email } },
    profile: {
      id: cfg.id,
      email: cfg.email,
      membership: cfg.membership,
      intended_plan: cfg.intendedPlan != null ? cfg.intendedPlan : cfg.membership,
      display_name: cfg.name
    }
  });
  await page.evaluateOnNewDocument(function (cfg) {
    window.__wbDashboardNow = new Date(2026, 10, 16, 12, 0, 0).getTime();
    window.__shares = cfg.shares || [];
    window.__sharesError = !!cfg.sharesError;
    window.__clientRows = cfg.clientRows || {};
    window.__clientSchedule = cfg.clientSchedule || {};
    window.__shared = [];
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
          return Promise.resolve(cfg.history || { sets: [], sessions: [], exercises: [] });
        };
        value.mySchedule = function () { return Promise.resolve({ entries: cfg.schedule || [] }); };
        value.myConnection = function () { return Promise.resolve(cfg.connection || null); };
        value.roster = function () { return Promise.resolve(cfg.roster || { role: null, clients: [] }); };
        value.myShares = function () {
          if (window.__sharesError) return Promise.resolve({ error: true, shares: [] });
          return Promise.resolve({ shares: window.__shares || [] });
        };
        value.clientTracking = function (id) {
          return Promise.resolve(window.__clientRows[id] || { sets: [], sessions: [], exercises: [] });
        };
        value.clientSchedule = function (id) {
          return Promise.resolve({ entries: window.__clientSchedule[id] || [] });
        };
        value.shareDashboard = function (input) {
          if (window.__shareFail) return Promise.resolve({ ok: false });
          window.__shared.push(JSON.parse(JSON.stringify(input)));
          return Promise.resolve({ ok: true, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
        };
        value.markShareViewed = function (id) {
          var found = null;
          (window.__shares || []).forEach(function (row) { if (row.id === id) found = row; });
          if (!found) return Promise.resolve({ ok: false });
          if (found.viewed_at) return Promise.resolve({ ok: true, already: true });
          found.viewed_at = '2026-11-16T18:00:00.000Z';
          return Promise.resolve({ ok: true, viewed_at: found.viewed_at });
        };
        value.threads = function () { return Promise.resolve({ threads: [], role: 'client' }); };
        value.messages = function (id) {
          return Promise.resolve({ messages: [], person: { id: id, name: 'Coach Lee', plan: 'Trainer' } });
        };
        value.watchMessages = function () { return Promise.resolve(function () {}); };
        value.markRead = function () { return Promise.resolve(null); };
        ['workoutCopies', 'accountPull', 'accountPush', 'accountImport', 'saveWorkoutCopy', 'deleteWorkoutCopy', 'freshSession', 'shareSetting', 'programEntries', 'myDashboardLayout', 'saveDashboardLayout', 'resetDashboardLayout'].forEach(function (name) {
          value[name] = function () { return Promise.resolve(null); };
        });
      }
    });
  }, cfg);
  const data = M.emptyData();
  data.workouts.push(workout());
  await page.evaluateOnNewDocument(function (key, value) {
    localStorage.setItem(key, value);
  }, M.STORAGE_KEY, JSON.stringify(data));
  return page;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await pp.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const adaRows = remoteHistory();
  const trainer = await openPage(browser, {
    id: TRAINER,
    email: 'coach@example.com',
    membership: 'trainer',
    name: 'Coach Lee',
    history: { sets: [], sessions: [], exercises: [] },
    roster: {
      role: 'trainer',
      clients: [
        { id: ADA, name: 'Ada Client', email: 'ada@example.com', plan: 'Free Client' },
        { id: NEIL, name: 'Neil Client', email: 'neil@example.com', plan: 'Free Client' },
        { id: FAN, name: 'Fan Enthusiast', email: 'fan@example.com', plan: 'Enthusiast', membership: 'enthusiast' },
        { id: PAT, name: 'Pat Chooser', email: 'pat@example.com', plan: 'Enthusiast', membership: 'free_client' },
        { id: KIP, name: 'Kip Pending', email: 'kip@example.com', plan: 'Enthusiast', membership: 'none' }
      ]
    },
    clientRows: { [ADA]: adaRows, [NEIL]: { sets: [], sessions: [], exercises: [] }, [FAN]: adaRows },
    clientSchedule: {}
  });
  await trainer.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
  await trainer.waitForSelector('#client-pick');
  const picker = await trainer.evaluate(function () {
    return {
      names: Array.prototype.map.call(document.querySelectorAll('#client-pick [role="option"]'), function (el) { return el.textContent; }),
      share: !!document.getElementById('dash-share'),
      reset: !!document.getElementById('dash-reset'),
      pass: !!document.getElementById('dashboard-pass')
    };
  });
  assert.deepStrictEqual(picker.names, ['Me · Coach Lee', 'Ada Client', 'Neil Client', 'Fan Enthusiast', 'Pat Chooser', 'Kip Pending']);
  assert.strictEqual(picker.share, false);
  assert.strictEqual(picker.reset, true);
  assert.strictEqual(picker.pass, false);
  await shot(trainer, 'trainer-client-picker.png');

  await trainer.click('#client-pick [data-client="' + ADA + '"]');
  await trainer.waitForSelector('#dash-share');
  await trainer.waitForSelector('#dashboard-schedule-note');
  await trainer.click('[data-card-up="volume"]');
  await trainer.waitForFunction(function () {
    var titles = Array.prototype.map.call(document.querySelectorAll('#dashboard-sheet h2'), function (el) { return el.textContent; });
    return titles[2] === 'Total volume';
  });
  await trainer.click('[data-card-add="pass"]');
  await trainer.waitForSelector('#dashboard-pass');
  await trainer.click('[data-card-remove="records"]');
  await trainer.waitForFunction(function () {
    return !document.getElementById('dashboard-records') && document.getElementById('dashboard-pass');
  });
  const edited = await trainer.evaluate(function () {
    var titles = Array.prototype.map.call(document.querySelectorAll('#dashboard-sheet h2'), function (el) { return el.textContent; });
    var up = document.querySelector('[data-card-up="plan"]');
    return {
      titles: titles,
      note: document.getElementById('dashboard-schedule-note').textContent,
      pass: document.getElementById('dashboard-pass-note').textContent,
      inputs: document.querySelectorAll('#dashboard input, #dashboard textarea, #dashboard select, #dashboard [contenteditable]').length,
      upDisabled: up.disabled,
      upLabel: up.getAttribute('aria-label')
    };
  });
  assert.deepStrictEqual(edited.titles, [
    'Hit the plan',
    'Workouts and streak',
    'Total volume',
    'Strength and Capacity',
    'Consistency · November 2026',
    'Stopwatch pass rate'
  ]);
  assert.strictEqual(edited.note, 'Schedule workouts in the program calendar.');
  assert.strictEqual(edited.pass, '5 of 8 stopwatch events passed this month');
  assert.strictEqual(edited.inputs, 0);
  assert.strictEqual(edited.upDisabled, true);
  assert.strictEqual(edited.upLabel, 'Move Hit the plan up');
  await trainer.focus('[data-card-down="plan"]');
  await trainer.keyboard.press('Enter');
  await trainer.waitForFunction(function () {
    return document.querySelector('#dashboard-sheet h2').textContent === 'Workouts and streak';
  });
  const dragFrom = await trainer.$('[data-drag="calendar"]');
  const dragTo = await trainer.$('[data-card="workouts"]');
  const fromBox = await dragFrom.boundingBox();
  const toBox = await dragTo.boundingBox();
  await trainer.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
  await trainer.mouse.down();
  await trainer.mouse.move(toBox.x + 20, toBox.y + 20, { steps: 12 });
  await trainer.mouse.up();
  await trainer.waitForFunction(function () {
    var titles = Array.prototype.map.call(document.querySelectorAll('#dashboard-sheet h2'), function (el) { return el.textContent; });
    return titles[0] === 'Consistency · November 2026';
  }, { timeout: 4000 }).catch(function () {});
  await shot(trainer, 'trainer-dashboard-edit.png', true);

  await trainer.evaluate(function () {
    window.__clientRows['22222222-2222-4222-8222-222222222222'] = { sets: [], sessions: [], exercises: [] };
  });
  await trainer.click('#dash-share');
  await trainer.waitForFunction(function () { return window.__shared && window.__shared.length === 1; });
  const shared = await trainer.evaluate(function () { return window.__shared[0]; });
  assert.strictEqual(shared.clientId, ADA);
  assert.strictEqual(shared.asOf, '2026-11-16');
  assert.strictEqual(shared.trainerName, 'Coach Lee');
  assert.ok(shared.cards.some(function (card) { return card.type === 'plan' && card.plan.pct === 65; }));
  assert.ok(shared.cards.some(function (card) { return card.type === 'pass' && card.pass.pct === 63; }));
  assert.ok(shared.cards.some(function (card) { return card.type === 'workouts' && card.scheduleNote === true; }));
  assert.ok(!shared.cards.some(function (card) { return card.type === 'records'; }));
  assert.ok(JSON.stringify(shared).indexOf('session_id') < 0);
  const toast = await trainer.$eval('#toast', function (el) { return el.textContent; });
  assert.strictEqual(toast, 'Dashboard shared.');
  await trainer.evaluate(function (id) {
    document.querySelector('#client-pick [data-client="' + id + '"]').click();
  }, NEIL);
  await trainer.waitForFunction(function () {
    var note = document.getElementById('dashboard-plan-note');
    return note && note.textContent === 'No sets logged this month.';
  });
  assert.ok((await trainer.$eval('#app', function (el) { return el.innerText; })).indexOf('Barbell squat') < 0);
  await trainer.evaluate(function (id) {
    document.querySelector('#client-pick [data-client="' + id + '"]').click();
  }, FAN);
  await trainer.waitForSelector('#dash-share');
  await trainer.waitForSelector('#dashboard-schedule-note');
  await trainer.click('[data-card-up="volume"]');
  await trainer.waitForFunction(function () {
    var titles = Array.prototype.map.call(document.querySelectorAll('#dashboard-sheet h2'), function (el) { return el.textContent; });
    return titles[2] === 'Total volume';
  });
  await trainer.click('[data-card-add="pass"]');
  await trainer.waitForSelector('#dashboard-pass');
  await trainer.click('[data-card-remove="records"]');
  await trainer.waitForFunction(function () {
    return !document.getElementById('dashboard-records') && !!document.getElementById('dash-share');
  });
  const enthusiastEditor = await trainer.evaluate(function (id) {
    var selected = document.querySelector('#client-pick [aria-selected="true"]');
    return {
      client: selected ? selected.getAttribute('data-client') : '',
      name: selected ? selected.textContent : '',
      share: !!document.getElementById('dash-share'),
      heldBack: !!document.getElementById('dash-share-none'),
      remove: !!document.querySelector('[data-card-remove="plan"]'),
      add: !!document.querySelector('[data-card-add="records"]'),
      pass: document.getElementById('dashboard-pass-note').textContent
    };
  }, FAN);
  assert.deepStrictEqual(enthusiastEditor, {
    client: FAN,
    name: 'Fan Enthusiast',
    share: true,
    heldBack: false,
    remove: true,
    add: true,
    pass: '5 of 8 stopwatch events passed this month'
  });
  await trainer.evaluate(function () {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = '';
    t.classList.remove('show');
  });
  await shot(trainer, 'trainer-enthusiast-edit.png', true);
  await trainer.evaluate(function () { window.__shareFail = true; });
  await trainer.click('#dash-share');
  await trainer.waitForFunction(function () {
    return document.getElementById('toast').textContent === 'Could not share that dashboard.';
  });
  assert.strictEqual(await trainer.evaluate(function () { return window.__shared.length; }), 1);
  await trainer.evaluate(function () { window.__shareFail = false; });
  await trainer.click('#dash-share');
  await trainer.waitForFunction(function () { return window.__shared && window.__shared.length === 2; });
  const sharedFan = await trainer.evaluate(function () { return window.__shared[1]; });
  assert.strictEqual(sharedFan.clientId, FAN);
  assert.strictEqual(sharedFan.asOf, '2026-11-16');
  assert.strictEqual(sharedFan.trainerName, 'Coach Lee');
  assert.ok(sharedFan.cards.some(function (card) { return card.type === 'pass' && card.pass.pct === 63; }));
  assert.ok(!sharedFan.cards.some(function (card) { return card.type === 'records'; }));
  assert.strictEqual(await trainer.$eval('#toast', function (el) { return el.textContent; }), 'Dashboard shared.');
  await trainer.evaluate(function (id) {
    document.querySelector('#client-pick [data-client="' + id + '"]').click();
  }, PAT);
  await trainer.waitForSelector('#dash-share');
  await trainer.evaluate(function (id) {
    document.querySelector('#client-pick [data-client="' + id + '"]').click();
  }, KIP);
  await trainer.waitForSelector('#dash-share');
  const chooser = await trainer.evaluate(function () {
    return {
      share: !!document.getElementById('dash-share'),
      heldBack: !!document.getElementById('dash-share-none')
    };
  });
  assert.deepStrictEqual(chooser, { share: true, heldBack: false });

  const withTrainer = await openPage(browser, {
    id: ADA,
    email: 'ada@example.com',
    membership: 'free_client',
    name: 'Ada Client',
    connection: { trainerId: TRAINER, trainerName: 'Coach Lee', trainerEmail: 'coach@example.com' },
    shares: []
  });
  await withTrainer.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
  await withTrainer.waitForSelector('#dashboard-message');
  const emptyLinked = await withTrainer.evaluate(function () {
    return {
      message: document.getElementById('dashboard-message').textContent,
      upgrade: document.getElementById('dashboard-upgrade').textContent,
      find: !!document.getElementById('dashboard-find'),
      sheet: !!document.getElementById('dashboard-sheet')
    };
  });
  assert.deepStrictEqual(emptyLinked, {
    message: 'Message your trainer',
    upgrade: 'Upgrade to Enthusiast',
    find: false,
    sheet: false
  });
  await shot(withTrainer, 'client-empty-with-trainer.png');
  await withTrainer.click('#dashboard-message');
  await withTrainer.waitForFunction(function (id) { return location.hash === '#/messages/' + id; }, {}, TRAINER);
  await withTrainer.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
  await withTrainer.waitForSelector('#dashboard-upgrade');
  await withTrainer.click('#dashboard-upgrade');
  await withTrainer.waitForFunction(function () { return location.hash === '#/subscriptions'; });

  const alone = await openPage(browser, {
    id: NEIL,
    email: 'neil@example.com',
    membership: 'free_client',
    name: 'Neil Client',
    connection: null,
    shares: []
  });
  await alone.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
  await alone.waitForSelector('#dashboard-find');
  await shot(alone, 'client-empty-no-trainer.png');
  await alone.click('#dashboard-find');
  await alone.waitForSelector('#dashboard-hub');
  const hub = await alone.evaluate(function () {
    return {
      text: document.getElementById('dashboard-hub').textContent,
      hidden: document.getElementById('dashboard-hub').hidden,
      hash: location.hash,
      upgrade: document.getElementById('dashboard-upgrade').textContent
    };
  });
  assert.deepStrictEqual(hub, {
    text: 'The Trainer Hub is coming soon.',
    hidden: false,
    hash: '#/tracking/dashboard',
    upgrade: 'Upgrade to Enthusiast'
  });
  await shot(alone, 'client-empty-no-trainer.png');

  const cards = frozenCards();
  const inbox = await openPage(browser, {
    id: ADA,
    email: 'ada@example.com',
    membership: 'free_client',
    name: 'Ada Client',
    connection: { trainerId: TRAINER, trainerName: 'Coach Lee' },
    shares: [
      { id: SHARE_OLD, trainer_name: 'Coach Lee', as_of: '2026-11-01', cards: olderCards(), created_at: '2026-11-01T12:00:00.000Z', viewed_at: null },
      { id: SHARE_NEW, trainer_name: 'Coach Lee', as_of: '2026-11-16', cards: cards, created_at: '2026-11-16T15:00:00.000Z', viewed_at: null }
    ]
  });
  await inbox.goto(URL + '#/tracking', { waitUntil: 'domcontentloaded' });
  await inbox.waitForFunction(function () {
    var badge = document.getElementById('dashboard-count');
    return badge && !badge.hidden && badge.textContent === '2';
  });
  await inbox.click('#tracking-tab-dashboard');
  await inbox.waitForSelector('#share-list');
  const listed = await inbox.evaluate(function () {
    var badge = document.getElementById('dashboard-count');
    return {
      order: Array.prototype.map.call(document.querySelectorAll('[data-share]'), function (el) { return el.textContent.replace(/\s+/g, ' ').trim(); }),
      count: badge.textContent,
      label: badge.getAttribute('aria-label'),
      hidden: badge.hidden,
      trainerShares: !!document.getElementById('trainer-shares'),
      live: !!document.getElementById('dashboard-sheet')
    };
  });
  assert.strictEqual(listed.count, '2');
  assert.strictEqual(listed.label, '2 shared dashboards');
  assert.strictEqual(listed.hidden, false);
  assert.ok(listed.order[0].indexOf('As of November 16, 2026 from Coach Lee') === 0);
  assert.ok(listed.order[1].indexOf('As of November 1, 2026 from Coach Lee') === 0);
  assert.strictEqual(listed.trainerShares, false);
  assert.strictEqual(listed.live, false);
  await shot(inbox, 'client-tracking-badge.png');

  await inbox.click('[data-share="' + SHARE_NEW + '"]');
  await inbox.waitForSelector('#dashboard-stamp');
  await inbox.waitForFunction(function () {
    var badge = document.getElementById('dashboard-count');
    return badge && badge.textContent === '1';
  });
  const opened = await inbox.evaluate(function () {
    return {
      stamp: document.getElementById('dashboard-stamp').textContent,
      rating: document.getElementById('dashboard-rating').textContent,
      buttons: document.querySelectorAll('#dashboard button, #dashboard input, #dashboard [contenteditable]').length,
      add: !!document.getElementById('dash-add'),
      count: document.getElementById('dashboard-count').textContent,
      hash: location.hash
    };
  });
  assert.strictEqual(opened.stamp, 'As of November 16, 2026 from Coach Lee');
  assert.strictEqual(opened.rating, 'Keep trying');
  assert.strictEqual(opened.buttons, 0);
  assert.strictEqual(opened.add, false);
  assert.strictEqual(opened.count, '1');
  assert.ok(opened.hash.indexOf(SHARE_NEW) >= 0);
  await shot(inbox, 'client-shared-dashboard.png', true);
  await inbox.click('#back');
  await inbox.waitForSelector('#share-list');
  const after = await inbox.evaluate(function (id) {
    var rows = Array.prototype.map.call(document.querySelectorAll('[data-share]'), function (el) {
      return { id: el.getAttribute('data-share'), text: el.innerText };
    });
    return { rows: rows, count: document.getElementById('dashboard-count').textContent };
  }, SHARE_NEW);
  assert.strictEqual(after.count, '1');
  assert.strictEqual(after.rows[0].id, SHARE_NEW);
  assert.ok(after.rows[0].text.indexOf('Not opened') < 0);
  assert.ok(after.rows[1].text.indexOf('Not opened') >= 0);

  const quiet = await openPage(browser, {
    id: FAN,
    email: 'fan@example.com',
    membership: 'enthusiast',
    name: 'Fan Enthusiast',
    history: adaRows,
    shares: []
  });
  await quiet.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
  await quiet.waitForSelector('#dashboard-sheet');
  const quietDash = await quiet.evaluate(function () {
    return {
      title: document.getElementById('trainer-shares-title'),
      soon: !!document.getElementById('dashboard-soon'),
      find: !!document.getElementById('dashboard-find'),
      list: !!document.getElementById('share-list'),
      share: !!document.getElementById('dash-share'),
      add: !!document.getElementById('dash-add'),
      buttons: document.querySelectorAll('#dashboard button, #dashboard input, #dashboard [contenteditable]').length,
      badge: document.getElementById('dashboard-count').hidden,
      rating: document.getElementById('dashboard-rating').textContent
    };
  });
  assert.deepStrictEqual(quietDash, {
    title: null,
    soon: false,
    find: false,
    list: false,
    share: false,
    add: false,
    buttons: 0,
    badge: true,
    rating: 'Keep trying'
  });

  const enthusiast = await openPage(browser, {
    id: FAN,
    email: 'fan@example.com',
    membership: 'enthusiast',
    name: 'Fan Enthusiast',
    history: adaRows,
    shares: [
      { id: SHARE_OLD, trainer_name: 'Coach Lee', as_of: '2026-11-01', cards: olderCards(), created_at: '2026-11-01T12:00:00.000Z', viewed_at: null },
      { id: SHARE_NEW, trainer_name: 'Coach Lee', as_of: '2026-11-16', cards: cards, created_at: '2026-11-16T15:00:00.000Z', viewed_at: null }
    ]
  });
  await enthusiast.goto(URL + '#/tracking', { waitUntil: 'domcontentloaded' });
  await enthusiast.waitForFunction(function () {
    var badge = document.getElementById('dashboard-count');
    return badge && !badge.hidden && badge.textContent === '2';
  });
  await enthusiast.click('#tracking-tab-dashboard');
  await enthusiast.waitForSelector('#dashboard-sheet');
  await enthusiast.waitForSelector('#trainer-shares');
  const own = await enthusiast.evaluate(function () {
    var badge = document.getElementById('dashboard-count');
    var titles = Array.prototype.map.call(document.querySelectorAll('#dashboard-sheet h2'), function (el) { return el.textContent; });
    return {
      pick: !!document.getElementById('client-pick'),
      share: !!document.getElementById('dash-share'),
      add: !!document.getElementById('dash-add'),
      pass: document.body.innerText.indexOf('pass rate') >= 0,
      soon: !!document.getElementById('dashboard-soon'),
      heading: document.getElementById('trainer-shares-title').textContent,
      rating: document.getElementById('dashboard-rating').textContent,
      titles: titles,
      buttons: document.querySelectorAll('#dashboard button, #dashboard input, #dashboard [contenteditable]').length,
      order: Array.prototype.map.call(document.querySelectorAll('#trainer-shares [data-share]'), function (el) { return el.textContent.replace(/\s+/g, ' ').trim(); }),
      count: badge.textContent,
      label: badge.getAttribute('aria-label'),
      hidden: badge.hidden
    };
  });
  assert.strictEqual(own.pick, false);
  assert.strictEqual(own.share, false);
  assert.strictEqual(own.add, false);
  assert.strictEqual(own.pass, false);
  assert.strictEqual(own.soon, false);
  assert.strictEqual(own.heading, 'Shared by your trainer');
  assert.strictEqual(own.rating, 'Keep trying');
  assert.deepStrictEqual(own.titles, [
    'Hit the plan',
    'Workouts and streak',
    'Strength and Capacity',
    'Total volume',
    'Recent personal records',
    'Consistency · November 2026'
  ]);
  assert.strictEqual(own.buttons, 0);
  assert.strictEqual(own.count, '2');
  assert.strictEqual(own.label, '2 shared dashboards');
  assert.strictEqual(own.hidden, false);
  assert.ok(own.order[0].indexOf('As of November 16, 2026 from Coach Lee') === 0);
  assert.ok(own.order[0].indexOf('Not opened') >= 0);
  assert.ok(own.order[1].indexOf('As of November 1, 2026 from Coach Lee') === 0);
  await shot(enthusiast, 'enthusiast-shared-list.png', true);

  await enthusiast.click('[data-share="' + SHARE_NEW + '"]');
  await enthusiast.waitForSelector('#dashboard-stamp');
  await enthusiast.waitForFunction(function () {
    var badge = document.getElementById('dashboard-count');
    return badge && badge.textContent === '1';
  });
  const openedFan = await enthusiast.evaluate(function () {
    return {
      stamp: document.getElementById('dashboard-stamp').textContent,
      rating: document.getElementById('dashboard-rating').textContent,
      plan: document.getElementById('dashboard-plan-note').textContent,
      buttons: document.querySelectorAll('#dashboard button, #dashboard input, #dashboard [contenteditable]').length,
      add: !!document.getElementById('dash-add'),
      heading: !!document.getElementById('trainer-shares-title'),
      titles: document.querySelectorAll('#dashboard-sheet h2').length,
      count: document.getElementById('dashboard-count').textContent,
      label: document.getElementById('dashboard-count').getAttribute('aria-label')
    };
  });
  assert.strictEqual(openedFan.stamp, 'As of November 16, 2026 from Coach Lee');
  assert.strictEqual(openedFan.rating, 'Keep trying');
  assert.strictEqual(openedFan.plan, '11 of 17 sets met or beat the plan this month');
  assert.strictEqual(openedFan.buttons, 0);
  assert.strictEqual(openedFan.add, false);
  assert.strictEqual(openedFan.heading, false);
  assert.strictEqual(openedFan.titles, 6);
  assert.strictEqual(openedFan.count, '1');
  assert.strictEqual(openedFan.label, '1 shared dashboard');
  await shot(enthusiast, 'enthusiast-shared-open.png', true);
  await enthusiast.click('#back');
  await enthusiast.waitForSelector('#trainer-shares');
  await enthusiast.waitForSelector('#dashboard-sheet');
  const afterFan = await enthusiast.evaluate(function (id) {
    var rows = Array.prototype.map.call(document.querySelectorAll('#trainer-shares [data-share]'), function (el) {
      return { id: el.getAttribute('data-share'), text: el.innerText };
    });
    return {
      rows: rows,
      count: document.getElementById('dashboard-count').textContent,
      rating: document.getElementById('dashboard-rating').textContent,
      soon: !!document.getElementById('dashboard-soon')
    };
  }, SHARE_NEW);
  assert.strictEqual(afterFan.count, '1');
  assert.strictEqual(afterFan.rows[0].id, SHARE_NEW);
  assert.ok(afterFan.rows[0].text.indexOf('Not opened') < 0);
  assert.ok(afterFan.rows[1].text.indexOf('Not opened') >= 0);
  assert.strictEqual(afterFan.rating, 'Keep trying');
  assert.strictEqual(afterFan.soon, false);

  assert.deepStrictEqual(trainer.__errors, []);
  assert.deepStrictEqual(withTrainer.__errors, []);
  assert.deepStrictEqual(alone.__errors, []);
  assert.deepStrictEqual(inbox.__errors, []);
  assert.deepStrictEqual(quiet.__errors, []);
  assert.deepStrictEqual(enthusiast.__errors, []);

  const broken = await openPage(browser, {
    id: ADA,
    email: 'ada@example.com',
    membership: 'free_client',
    name: 'Ada Client',
    sharesError: true,
    shares: []
  });
  await broken.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
  await broken.waitForSelector('#share-error');
  const failedEmpty = await broken.evaluate(function () {
    return {
      error: document.getElementById('share-error').innerText,
      soon: !!document.getElementById('dashboard-soon'),
      hidden: document.getElementById('dashboard-count').hidden
    };
  });
  assert.ok(failedEmpty.error.indexOf('Shared dashboards could not be loaded.') >= 0);
  assert.strictEqual(failedEmpty.soon, false);
  assert.strictEqual(failedEmpty.hidden, true);

  const kept = await openPage(browser, {
    id: ADA,
    email: 'ada@example.com',
    membership: 'free_client',
    name: 'Ada Client',
    shares: [{
      id: SHARE_NEW,
      trainer_name: 'Coach Lee',
      as_of: '2026-11-16',
      created_at: '2026-11-16T18:00:00.000Z',
      viewed_at: null,
      cards: [{ type: 'plan', plan: { pct: 65, hits: 11, total: 17, rating: { label: 'Keep trying' } } }]
    }]
  });
  await kept.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
  await kept.waitForFunction(function () {
    var badge = document.getElementById('dashboard-count');
    return badge && badge.textContent === '1';
  });
  await kept.evaluate(function () { window.__sharesError = true; });
  await kept.click('#tracking-tab-history');
  await kept.waitForSelector('#tracking-tab-history.on');
  await kept.click('#tracking-tab-dashboard');
  await kept.waitForSelector('#share-stale');
  const stillThere = await kept.evaluate(function (id) {
    var row = document.querySelector('[data-share="' + id + '"]');
    var badge = document.getElementById('dashboard-count');
    return {
      row: !!row,
      soon: !!document.getElementById('dashboard-soon'),
      count: badge ? badge.textContent : '',
      stale: document.getElementById('share-stale').textContent
    };
  }, SHARE_NEW);
  assert.deepStrictEqual(stillThere, {
    row: true,
    soon: false,
    count: '1',
    stale: 'The latest shares could not be loaded.'
  });
  const pending = await openPage(browser, {
    id: '14141414-1414-4414-8414-141414141414',
    email: 'pending@example.com',
    membership: 'none',
    intendedPlan: 'enthusiast',
    name: 'Pending Chooser',
    shares: [{
      id: SHARE_NEW,
      trainer_name: 'Coach Lee',
      as_of: '2026-11-16',
      created_at: '2026-11-16T18:00:00.000Z',
      viewed_at: null,
      cards: [{ type: 'plan', plan: { pct: 65, hits: 11, total: 17, rating: { label: 'Keep trying' } } }]
    }]
  });
  await pending.goto(URL + '#/tracking', { waitUntil: 'domcontentloaded' });
  await pending.waitForFunction(function () {
    var badge = document.getElementById('dashboard-count');
    return badge && badge.textContent === '1';
  });
  await pending.goto(URL + '#/tracking/dashboard/share/' + SHARE_NEW, { waitUntil: 'domcontentloaded' });
  await pending.waitForSelector('#dashboard-stamp');
  const openedPending = await pending.evaluate(function () {
    return {
      stamp: document.getElementById('dashboard-stamp').textContent,
      sheet: !!document.getElementById('dashboard-sheet'),
      soon: !!document.getElementById('dashboard-soon')
    };
  });
  assert.deepStrictEqual(openedPending, {
    stamp: 'As of November 16, 2026 from Coach Lee',
    sheet: true,
    soon: false
  });
  assert.deepStrictEqual(broken.__errors, []);
  assert.deepStrictEqual(kept.__errors, []);
  assert.deepStrictEqual(pending.__errors, []);
  console.log('SHARES UI OK');
  await browser.close();
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
