// Trainer sharing screens. Sample people stay in this file. No live database.
// node tests/shares-ui.test.js [url]
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const pp = require('puppeteer-core');
const D = require('../dashboard.js');
const H = require('../history.js');
const remote = require('./history-fixture').remoteHistory();

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const OUT = process.argv[3] || '/opt/cursor/artifacts';
const CHROME = process.env.CHROME || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : '/usr/local/bin/google-chrome');
const NOW = new Date(2026, 10, 16, 12, 0, 0);
const MAYA = '11111111-1111-4111-8111-111111111111';
const LUIS = '22222222-2222-4222-8222-222222222222';
const COACH = '33333333-3333-4333-8333-333333333333';
const SHARE_NEW = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SHARE_OLD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function profile(membership, over) {
  return Object.assign({
    id: 'test-' + membership,
    email: membership + '@example.com',
    membership: membership,
    intended_plan: membership,
    display_name: ''
  }, over);
}

function clientPayload() {
  const sets = H.fromRows(remote.sessions, remote.sets, remote.exercises);
  return { sessions: remote.sessions, sets: remote.sets, exercises: remote.exercises, builtSets: sets };
}

function shares() {
  const payload = clientPayload();
  const model = D.build({
    sets: payload.builtSets,
    sessions: payload.sessions,
    entries: [],
    now: NOW
  });
  const shot = D.snapshot(model, D.STANDARD.concat(['pass']), {
    asOf: '2026-11-16',
    trainerName: 'Coach Ana',
    now: NOW
  });
  return [
    {
      id: SHARE_NEW,
      trainerName: 'Coach Ana',
      asOf: '2026-11-16',
      asOfLabel: shot.asOfLabel,
      sharedAt: '2026-11-16T15:00:00.000Z',
      viewedAt: null,
      order: shot.order,
      blocks: shot.blocks
    },
    {
      id: SHARE_OLD,
      trainerName: 'Coach Ana',
      asOf: '2026-11-13',
      asOfLabel: D.asOfLabel('2026-11-13'),
      sharedAt: '2026-11-13T15:00:00.000Z',
      viewedAt: null,
      order: ['plan'],
      blocks: { plan: shot.blocks.plan }
    }
  ];
}

async function shot(page, name, opts) {
  if (opts && opts.flowDock) {
    await page.evaluate(function () {
      var dock = document.querySelector('.dock');
      if (dock) dock.style.position = 'relative';
    });
  }
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, type: 'png', fullPage: true });
  const stat = fs.statSync(file);
  assert.ok(stat.size > 1000, name + ' screenshot is empty');
  return file;
}

async function openPage(browser, opts) {
  const page = await browser.newPage();
  page.__errors = [];
  await page.setViewport({ width: 390, height: opts.tall ? 1400 : 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  page.on('pageerror', function (err) { page.__errors.push(String(err)); });
  page.on('request', function (req) {
    if (/supabase\.co/i.test(req.url())) page.__errors.push('live database request ' + req.url());
  });
  await require('./allow.js').stubAuth(page, {
    session: { user: { id: opts.profile.id, email: opts.profile.email } },
    profile: opts.profile
  });
  await page.evaluateOnNewDocument(function (state) {
    window.__wbDashboardNow = new Date(2026, 10, 16, 12, 0, 0).getTime();
    window.__wbState = state;
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
        value.myHistory = function () { return Promise.resolve(state.history); };
        value.mySchedule = function () { return Promise.resolve({ entries: [] }); };
        value.clientHistory = function () { return Promise.resolve(state.clientHistory); };
        value.clientSchedule = function () { return Promise.resolve({ entries: state.schedule || [] }); };
        value.roster = function () { return Promise.resolve(state.roster); };
        value.myConnection = function () { return Promise.resolve(state.connection); };
        value.myShares = function () { return Promise.resolve({ shares: state.shares || [] }); };
        value.shareDashboard = function (row) {
          state.sent = row;
          window.__wbSentShare = row;
          return Promise.resolve({ ok: true, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
        };
        value.markShareViewed = function (id) {
          (state.shares || []).forEach(function (share) {
            if (share.id === id) share.viewedAt = '2026-11-16T18:00:00.000Z';
          });
          return Promise.resolve({ ok: true });
        };
        ['workoutCopies', 'accountPull', 'accountPush', 'accountImport', 'saveWorkoutCopy', 'deleteWorkoutCopy', 'freshSession', 'shareSetting', 'programEntries'].forEach(function (name) {
          value[name] = function () { return Promise.resolve(null); };
        });
      }
    });
  }, opts.state);
  return page;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await pp.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const history = clientPayload();
  const roster = {
    role: 'trainer',
    clients: [
      { id: MAYA, name: 'Maya Chen', email: 'maya@example.com', plan: 'Free Client' },
      { id: LUIS, name: 'Luis Ortega', email: 'luis@example.com', plan: 'Free Client' }
    ]
  };

  const trainer = await openPage(browser, {
    tall: true,
    profile: profile('trainer', { id: 'test-trainer', display_name: 'Coach Ana', email: 'coach@example.com' }),
    state: {
      history: { sets: [], sessions: [], exercises: [] },
      clientHistory: { sets: history.sets, sessions: history.sessions, exercises: history.exercises },
      schedule: [],
      roster: roster,
      connection: null,
      shares: []
    }
  });
  await trainer.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
  await trainer.waitForSelector('#dashboard-picker');
  const picker = await trainer.evaluate(function () {
    return {
      text: document.getElementById('dashboard-picker').innerText,
      people: Array.prototype.map.call(document.querySelectorAll('[data-dash-person]'), function (el) {
        return el.getAttribute('data-dash-person');
      })
    };
  });
  assert.ok(picker.text.indexOf('Choose whose dashboard to view') >= 0);
  assert.ok(picker.text.indexOf('My dashboard') >= 0);
  assert.ok(picker.text.indexOf('Coach Ana · Trainer') >= 0);
  assert.ok(picker.text.indexOf('Maya Chen') >= 0);
  assert.ok(picker.text.indexOf('Luis Ortega') >= 0);
  assert.ok(picker.text.indexOf('Free Client') >= 0);
  assert.deepStrictEqual(picker.people, ['me', MAYA, LUIS]);
  assert.strictEqual(await trainer.$('#dashboard-sheet'), null);
  await shot(trainer, 'trainer-client-picker.png');

  await trainer.click('[data-dash-person="' + MAYA + '"]');
  await trainer.waitForSelector('#dashboard-viewing');
  await trainer.waitForSelector('#dashboard-streak-note');
  await trainer.waitForSelector('#dashboard-share-open');
  const editing = await trainer.evaluate(function () {
    return {
      banner: document.getElementById('dashboard-viewing').innerText,
      note: document.getElementById('dashboard-streak-note').textContent,
      titles: Array.prototype.map.call(document.querySelectorAll('#dashboard-sheet h2'), function (el) { return el.textContent; }),
      inputs: document.querySelectorAll('#dashboard input, #dashboard textarea, #dashboard select, #dashboard [contenteditable]').length,
      up: document.querySelector('[data-card="plan"] [data-move="up"]').disabled,
      down: document.querySelector('[data-card="plan"] [data-move="down"]').disabled,
      pass: document.getElementById('dashboard-pass') ? true : false
    };
  });
  assert.ok(editing.banner.indexOf('Viewing Maya Chen') >= 0);
  assert.ok(editing.banner.indexOf('Live dashboard') >= 0);
  assert.strictEqual(editing.note, 'Schedule workouts in the program calendar first.');
  assert.deepStrictEqual(editing.titles, [
    'Hit the plan', 'Workouts and streak', 'Total volume', 'Recent personal records', 'Consistency · November 2026'
  ]);
  assert.strictEqual(editing.inputs, 0);
  assert.strictEqual(editing.up, true);
  assert.strictEqual(editing.down, false);
  assert.strictEqual(editing.pass, false);

  await trainer.click('#dashboard-add-open');
  await trainer.waitForSelector('#dashboard-add');
  const added = await trainer.$eval('#dashboard-add', function (el) { return el.innerText; });
  assert.ok(added.indexOf('Stopwatch pass rate') >= 0);
  assert.ok(added.indexOf('Hit the plan') < 0);
  await trainer.click('[data-add="pass"]');
  await trainer.waitForSelector('#dashboard-pass');
  assert.strictEqual(await trainer.$eval('#dashboard-pass-note', function (el) { return el.textContent; }), 'Court sprint · 5 of 8 event marks passed this month');
  await shot(trainer, 'trainer-dashboard-edit.png', { flowDock: true });

  await trainer.click('[data-card="plan"] [data-move="down"]');
  const afterDown = await trainer.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('#dashboard-sheet h2'), function (el) { return el.textContent; })[0];
  });
  assert.strictEqual(afterDown, 'Workouts and streak');

  const dragged = await trainer.evaluate(function () {
    var handle = document.querySelector('[data-drag="volume"]');
    var target = document.querySelector('[data-card="records"]');
    var from = handle.getBoundingClientRect();
    var to = target.getBoundingClientRect();
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: from.x + 4, clientY: from.y + 4, pointerId: 1, button: 0 }));
    document.getElementById('dashboard-sheet').dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, clientX: to.x + 20, clientY: to.y + 20, pointerId: 1, button: 0
    }));
    return Array.prototype.map.call(document.querySelectorAll('#dashboard-sheet [data-card]'), function (el) {
      return el.getAttribute('data-card');
    });
  });
  assert.ok(dragged.indexOf('volume') > dragged.indexOf('records'), dragged.join(','));

  await trainer.click('[data-delete="pass"]');
  assert.strictEqual(await trainer.$('#dashboard-pass'), null);
  await trainer.click('#dashboard-add-open');
  await trainer.waitForSelector('[data-add="pass"]');
  await trainer.click('#dashboard-add-cancel');

  await trainer.click('#dashboard-share-open');
  await trainer.waitForSelector('#dashboard-share');
  const confirm = await trainer.$eval('#dashboard-share', function (el) { return el.innerText; });
  assert.ok(confirm.indexOf('Share with Maya Chen?') >= 0);
  assert.ok(confirm.indexOf('As of Monday, Nov 16, 2026 from Coach Ana') >= 0);
  assert.ok(confirm.indexOf('will not change') >= 0);
  await trainer.click('#dashboard-share-go');
  await trainer.waitForFunction(function () { return !document.getElementById('dashboard-share') && window.__wbSentShare; });
  const sent = await trainer.evaluate(function () { return window.__wbSentShare; });
  assert.strictEqual(sent.clientId, MAYA);
  assert.strictEqual(sent.asOf, '2026-11-16');
  assert.strictEqual(sent.trainerName, 'Coach Ana');
  assert.ok(Array.isArray(sent.cards.order) && sent.cards.order.length >= 1);
  assert.ok(sent.cards.blocks.plan && typeof sent.cards.blocks.plan.pct === 'number');
  assert.ok(!sent.cards.sets && !sent.cards.blocks.sets);
  await trainer.click('#dashboard-change');
  await trainer.waitForSelector('#dashboard-picker');
  assert.deepStrictEqual(trainer.__errors, []);
  await trainer.close();

  const master = await openPage(browser, {
    profile: profile('master_trainer', { id: 'test-master', display_name: 'Master Mo', email: 'master@example.com' }),
    state: {
      history: { sets: [], sessions: [], exercises: [] },
      clientHistory: { sets: [], sessions: [], exercises: [] },
      roster: { role: 'master_trainer', clients: [{ id: LUIS, name: 'Luis Ortega', plan: 'Free Client' }] },
      connection: null,
      shares: []
    }
  });
  await master.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
  await master.waitForSelector('#dashboard-picker');
  const masterText = await master.$eval('#dashboard-picker', function (el) { return el.innerText; });
  assert.ok(masterText.indexOf('Master Mo · Master Trainer') >= 0);
  assert.ok(masterText.indexOf('Luis Ortega') >= 0);
  await master.click('[data-dash-person="me"]');
  await master.waitForSelector('#dashboard-empty');
  assert.strictEqual(await master.$('#dashboard-share-open'), null);
  assert.strictEqual(await master.$('[data-delete]'), null);
  assert.deepStrictEqual(master.__errors, []);
  await master.close();

  const linked = await openPage(browser, {
    profile: profile('free_client', { id: 'test-free', display_name: 'Maya Chen', email: 'maya@example.com' }),
    state: {
      history: { sets: history.sets, sessions: history.sessions, exercises: history.exercises },
      clientHistory: { sets: [], sessions: [], exercises: [] },
      roster: null,
      connection: { trainerId: COACH, trainerName: 'Coach Ana' },
      shares: []
    }
  });
  await linked.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
  await linked.waitForSelector('#dashboard-message');
  const linkedState = await linked.evaluate(function () {
    return {
      text: document.getElementById('dashboard-empty-client').innerText,
      message: document.getElementById('dashboard-message').getAttribute('href'),
      upgrade: document.getElementById('dashboard-upgrade').getAttribute('href'),
      badge: document.getElementById('dashboard-count').hidden,
      sheet: !!document.getElementById('dashboard-sheet')
    };
  });
  assert.ok(linkedState.text.indexOf('No dashboard yet') >= 0);
  assert.ok(linkedState.text.indexOf('Message your trainer') >= 0);
  assert.ok(linkedState.text.indexOf('Upgrade to Enthusiast') >= 0);
  assert.ok(linkedState.text.indexOf('Find a trainer') < 0);
  assert.strictEqual(linkedState.message, '#/messages/' + COACH);
  assert.strictEqual(linkedState.upgrade, '#/subscriptions');
  assert.strictEqual(linkedState.badge, true);
  assert.strictEqual(linkedState.sheet, false);
  await shot(linked, 'client-empty-with-trainer.png');
  assert.deepStrictEqual(linked.__errors, []);
  await linked.close();

  const solo = await openPage(browser, {
    profile: profile('free_client', { id: 'test-solo', display_name: 'Luis Ortega', email: 'luis@example.com' }),
    state: {
      history: { sets: [], sessions: [], exercises: [] },
      clientHistory: { sets: [], sessions: [], exercises: [] },
      roster: null,
      connection: null,
      shares: []
    }
  });
  await solo.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
  await solo.waitForSelector('#dashboard-find');
  const soloText = await solo.$eval('#dashboard-empty-client', function (el) { return el.innerText; });
  assert.ok(soloText.indexOf('Find a trainer') >= 0);
  assert.ok(soloText.indexOf('The Trainer Hub is coming soon.') >= 0);
  assert.ok(soloText.indexOf('Upgrade to Enthusiast') >= 0);
  assert.ok(soloText.indexOf('Message your trainer') < 0);
  await solo.click('#dashboard-find');
  assert.strictEqual(await solo.evaluate(function () { return document.activeElement.id; }), 'dashboard-hub');
  assert.strictEqual(await solo.$eval('#dashboard-upgrade', function (el) { return el.getAttribute('href'); }), '#/subscriptions');
  await shot(solo, 'client-empty-no-trainer.png');
  assert.deepStrictEqual(solo.__errors, []);
  await solo.close();

  const client = await openPage(browser, {
    tall: true,
    profile: profile('free_client', { id: 'test-client', display_name: 'Maya Chen', email: 'maya@example.com' }),
    state: {
      history: { sets: history.sets, sessions: history.sessions, exercises: history.exercises },
      clientHistory: { sets: [], sessions: [], exercises: [] },
      roster: null,
      connection: { trainerId: COACH, trainerName: 'Coach Ana' },
      shares: shares()
    }
  });
  await client.goto(URL + '#/tracking', { waitUntil: 'domcontentloaded' });
  await client.waitForFunction(function () {
    var badge = document.getElementById('dashboard-count');
    return badge && !badge.hidden && badge.textContent === '2';
  });
  const badge = await client.evaluate(function () {
    var el = document.getElementById('dashboard-count');
    return { text: el.textContent, label: el.getAttribute('aria-label'), tab: document.getElementById('tracking-tab-history').getAttribute('aria-selected') };
  });
  assert.strictEqual(badge.text, '2');
  assert.strictEqual(badge.label, '2 shared dashboards');
  assert.strictEqual(badge.tab, 'true');
  await shot(client, 'client-tracking-badge.png');

  await client.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
  await client.waitForSelector('#dashboard-shares');
  const list = await client.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('[data-share]'), function (el) {
      return { id: el.getAttribute('data-share'), text: el.innerText };
    });
  });
  assert.strictEqual(list[0].id, SHARE_NEW);
  assert.ok(list[0].text.indexOf('As of Monday, Nov 16, 2026') >= 0);
  assert.ok(list[0].text.indexOf('From Coach Ana') >= 0);
  assert.ok(list[0].text.indexOf('New') >= 0);
  assert.strictEqual(list[1].id, SHARE_OLD);
  assert.ok(list[1].text.indexOf('As of Friday, Nov 13, 2026') >= 0);
  assert.strictEqual(await client.$eval('#dashboard-count', function (el) { return el.textContent; }), '2');

  await client.click('[data-share="' + SHARE_NEW + '"]');
  await client.waitForSelector('#dashboard-as-of');
  await client.waitForFunction(function () {
    var badge = document.getElementById('dashboard-count');
    return badge && badge.textContent === '1';
  });
  const opened = await client.evaluate(function () {
    return {
      stamp: document.querySelector('#dashboard-as-of .db-frozen-title').textContent,
      note: document.querySelector('#dashboard-as-of .db-note').textContent,
      pass: document.getElementById('dashboard-pass-note').textContent,
      pct: document.getElementById('dashboard-pass-pct').textContent,
      deletes: document.querySelectorAll('[data-delete]').length,
      inputs: document.querySelectorAll('#dashboard input, #dashboard textarea, #dashboard select').length,
      badge: document.getElementById('dashboard-count').textContent,
      label: document.getElementById('dashboard-count').getAttribute('aria-label')
    };
  });
  assert.strictEqual(opened.stamp, 'As of Monday, Nov 16, 2026 from Coach Ana');
  assert.ok(opened.note.indexOf('View only') >= 0);
  assert.strictEqual(opened.pass, 'Court sprint · 5 of 8 event marks passed this month');
  assert.strictEqual(opened.pct, '63%');
  assert.strictEqual(opened.deletes, 0);
  assert.strictEqual(opened.inputs, 0);
  assert.strictEqual(opened.badge, '1');
  assert.strictEqual(opened.label, '1 shared dashboard');
  await shot(client, 'client-shared-dashboard.png');

  await client.click('#back');
  await client.waitForSelector('#dashboard-shares');
  const after = await client.evaluate(function () {
    var rows = Array.prototype.map.call(document.querySelectorAll('[data-share]'), function (el) {
      return el.innerText;
    });
    return { rows: rows, badge: document.getElementById('dashboard-count').textContent };
  });
  assert.ok(after.rows[0].indexOf('Monday, Nov 16, 2026') >= 0);
  assert.ok(after.rows[0].indexOf('New') < 0);
  assert.ok(after.rows[1].indexOf('New') >= 0);
  assert.strictEqual(after.badge, '1');
  assert.deepStrictEqual(client.__errors, []);
  await client.close();

  console.log('SHARES UI OK');
  await browser.close();
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
