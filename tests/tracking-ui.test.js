// Tracking page: History is the selected tab, Dashboard is a coming-soon note.
// Phone width. History rows come from the test fixture, never from the database.
// node tests/tracking-ui.test.js [url]
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const pp = require('puppeteer-core');
const M = require('../model.js');
const remoteHistory = require('./history-fixture').remoteHistory;

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const OUT = process.argv[3] || '/opt/cursor/artifacts';
const CHROME = process.env.CHROME || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : '/usr/local/bin/google-chrome');

function workout() {
  const w = M.newWorkout('Lower strength');
  w.items = [M.normalizeExercise(M.newExercise({
    name: 'Barbell squat', sets: 3, weight: { unit: 'lb', value: 185 },
    mode: 'reps', modeConfig: { repsType: 'number', count: 5, restSec: 90 }
  }))];
  return w;
}

function profile(id, membership) {
  return {
    id: id,
    email: id + '@example.com',
    membership: membership,
    intended_plan: membership,
    display_name: 'Test Person'
  };
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, type: 'png' });
  const stat = fs.statSync(file);
  assert.ok(stat.size > 1000, name + ' screenshot is empty');
  return file;
}

async function openPage(browser, membership, payload) {
  const page = await browser.newPage();
  page.__errors = [];
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  page.on('pageerror', function (err) { page.__errors.push(String(err)); });
  page.on('request', function (req) {
    if (/supabase\.co/i.test(req.url())) page.__errors.push('live database request ' + req.url());
  });
  await require('./allow.js').stubAuth(page, {
    session: { user: { id: 'test-' + membership, email: membership + '@example.com' } },
    profile: profile('test-' + membership, membership)
  });
  await page.evaluateOnNewDocument(function (rows) {
    window.__wbDashboardNow = new Date(2026, 10, 16, 12, 0, 0).getTime();
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
          return Promise.resolve(window.__wbHistoryPayload || { sets: [], sessions: [], exercises: [] });
        };
        value.mySchedule = function () {
          return Promise.resolve(window.__wbSchedulePayload || { entries: [] });
        };
        ['workoutCopies', 'accountPull', 'accountPush', 'accountImport', 'saveWorkoutCopy', 'deleteWorkoutCopy', 'freshSession', 'myConnection', 'roster', 'shareSetting'].forEach(function (name) {
          value[name] = function () { return Promise.resolve(null); };
        });
      }
    });
    window.__wbHistoryPayload = rows;
  }, payload || { sets: [], sessions: [], exercises: [] });
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
  const payload = remoteHistory();
  const page = await openPage(browser, 'enthusiast', payload);
  await page.goto(URL + '#/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#tracking-open');
  await page.setViewport({ width: 320, height: 700, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const narrow = await page.$eval('#tracking-open', function (el) {
    var rect = el.getBoundingClientRect();
    var row = document.getElementById('home-nav').getBoundingClientRect();
    return {
      inside: rect.left >= 0 && rect.right <= window.innerWidth + 0.5,
      textFits: el.scrollWidth <= el.clientWidth + 1,
      rowFits: row.right <= window.innerWidth + 0.5
    };
  });
  assert.deepStrictEqual(narrow, { inside: true, textFits: true, rowFits: true });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.waitForFunction(function () { return document.body.innerText.indexOf('Lower strength') >= 0; });
  assert.strictEqual(await page.$eval('#tracking-open', function (el) { return el.textContent; }), 'Tracking');
  assert.strictEqual(await page.$('#history-open'), null);
  await shot(page, 'tracking-workout-list.png');

  await page.click('#tracking-open');
  await page.waitForSelector('#history-list');
  await page.waitForFunction(function () {
    var tab = document.getElementById('tracking-tab-history');
    return tab && tab.getAttribute('aria-selected') === 'true' && document.querySelector('.hx-row');
  });
  const historyTabs = await page.evaluate(function () {
    var history = document.getElementById('tracking-tab-history');
    var dashboard = document.getElementById('tracking-tab-dashboard');
    var badge = document.getElementById('dashboard-count');
    var panel = document.getElementById('tracking-panel');
    return {
      title: document.getElementById('title').textContent,
      hash: location.hash,
      listLabel: document.getElementById('tracking-tabs').getAttribute('aria-label'),
      historyRole: history.getAttribute('role'),
      historySelected: history.getAttribute('aria-selected'),
      historyOn: history.classList.contains('on'),
      historyIndex: history.getAttribute('tabindex'),
      dashboardSelected: dashboard.getAttribute('aria-selected'),
      dashboardIndex: dashboard.getAttribute('tabindex'),
      panel: panel.getAttribute('role'),
      labelled: panel.getAttribute('aria-labelledby'),
      badgeHidden: badge.hidden,
      badgeText: badge.textContent,
      back: document.getElementById('back').hidden
    };
  });
  assert.deepStrictEqual(historyTabs, {
    title: 'Tracking',
    hash: '#/tracking',
    listLabel: 'Tracking',
    historyRole: 'tab',
    historySelected: 'true',
    historyOn: true,
    historyIndex: '0',
    dashboardSelected: 'false',
    dashboardIndex: '-1',
    panel: 'tabpanel',
    labelled: 'tracking-tab-history',
    badgeHidden: true,
    badgeText: '',
    back: false
  });
  assert.ok((await page.$eval('#app', function (el) { return el.innerText; })).indexOf('Barbell squat') >= 0);
  assert.ok((await page.$eval('#app', function (el) { return el.innerText; })).indexOf('Test Person') < 0);
  await page.waitForFunction(function () {
    var imgs = Array.prototype.slice.call(document.querySelectorAll('.hx-thumb img'));
    return imgs.length >= 4 && imgs.every(function (img) { return img.complete && img.naturalWidth > 0; });
  }, { timeout: 15000 });
  await shot(page, 'tracking-history.png');

  await page.focus('#tracking-tab-history');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(function () {
    return location.hash === '#/tracking/dashboard' &&
      document.activeElement && document.activeElement.id === 'tracking-tab-dashboard' &&
      document.getElementById('dashboard');
  });
  await page.keyboard.press('End');
  await page.waitForFunction(function () {
    return document.activeElement && document.activeElement.id === 'tracking-tab-dashboard';
  });
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(function () {
    return location.hash === '#/tracking' &&
      document.activeElement && document.activeElement.id === 'tracking-tab-history' &&
      document.getElementById('history-list');
  });
  await page.keyboard.press('Home');
  await page.waitForFunction(function () {
    return document.activeElement && document.activeElement.id === 'tracking-tab-history' && location.hash === '#/tracking';
  });
  await page.keyboard.press('Enter');
  await page.waitForFunction(function () {
    return location.hash === '#/tracking' && document.getElementById('history-list') &&
      document.activeElement && document.activeElement.id === 'tracking-tab-history';
  });

  // A click while history is still loading must not leave focus on the previous tab.
  await page.evaluate(function () {
    window.__historyGate = {};
    window.__historyGate.promise = new Promise(function (resolve) { window.__historyGate.resolve = resolve; });
    var real = window.WBAuth.myHistory;
    window.WBAuth.myHistory = function () {
      return window.__historyGate.promise.then(function () { return real(); });
    };
  });
  await page.click('#tracking-tab-dashboard');
  await page.waitForSelector('#dashboard');
  await page.focus('#tracking-tab-dashboard');
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(function () {
    var panel = document.getElementById('tracking-panel');
    return location.hash === '#/tracking' && panel && panel.textContent.indexOf('Loading') >= 0 &&
      document.activeElement && document.activeElement.id === 'tracking-tab-history';
  });
  await page.click('#tracking-tab-dashboard');
  await page.waitForFunction(function () {
    var dashboard = document.getElementById('tracking-tab-dashboard');
    var history = document.getElementById('tracking-tab-history');
    return location.hash === '#/tracking/dashboard' &&
      document.getElementById('dashboard') &&
      !document.getElementById('history-list') &&
      dashboard && dashboard.getAttribute('aria-selected') === 'true' &&
      history && history.getAttribute('aria-selected') === 'false' &&
      document.activeElement === dashboard;
  });
  await page.keyboard.press('Enter');
  await page.waitForFunction(function () {
    return location.hash === '#/tracking/dashboard' &&
      document.getElementById('dashboard') &&
      document.activeElement && document.activeElement.id === 'tracking-tab-dashboard';
  });
  await page.evaluate(function () { window.__historyGate.resolve(); });
  await page.waitForFunction(function () {
    return location.hash === '#/tracking/dashboard' && document.getElementById('dashboard-sheet') && !document.getElementById('history-list');
  });

  await page.click('#tracking-tab-dashboard');
  await page.waitForSelector('#dashboard-rating');
  const dash = await page.evaluate(function () {
    var badge = document.getElementById('dashboard-count');
    var tab = document.getElementById('tracking-tab-dashboard');
    var style = getComputedStyle(tab);
    var text = document.getElementById('app').innerText;
    return {
      title: document.getElementById('title').textContent,
      hash: location.hash,
      rating: document.getElementById('dashboard-rating').textContent,
      plan: document.getElementById('dashboard-plan-note').textContent,
      selected: tab.getAttribute('aria-selected'),
      labelled: document.getElementById('tracking-panel').getAttribute('aria-labelledby'),
      historyGone: !document.getElementById('history-list') && !document.getElementById('history-empty'),
      badgeHidden: badge.hidden,
      badgeText: badge.textContent,
      disabled: tab.disabled,
      opacity: style.opacity,
      lock: !!document.querySelector('[data-lock], .lock, .is-locked'),
      passRate: text.indexOf('Stopwatch') >= 0 || text.indexOf('pass rate') >= 0,
      example: text.indexOf('Example data') >= 0,
      streak: !!document.getElementById('dashboard-streak'),
      buttons: document.querySelectorAll('#dashboard button, #dashboard input').length
    };
  });
  assert.deepStrictEqual(dash, {
    title: 'Tracking',
    hash: '#/tracking/dashboard',
    rating: 'Keep trying',
    plan: '11 of 17 sets met or beat the plan this month',
    selected: 'true',
    labelled: 'tracking-tab-dashboard',
    historyGone: true,
    badgeHidden: true,
    badgeText: '',
    disabled: false,
    opacity: '1',
    lock: false,
    passRate: false,
    example: false,
    streak: false,
    buttons: 0
  });
  assert.ok((await page.$eval('#app', function (el) { return el.innerText; })).indexOf('Your trainer can share') < 0);
  await shot(page, 'tracking-dashboard.png');

  const badgeStyle = await page.evaluate(function () {
    var badge = document.getElementById('dashboard-count');
    badge.hidden = false;
    badge.textContent = '2';
    var style = getComputedStyle(badge);
    var box = badge.getBoundingClientRect();
    var probe = document.createElement('span');
    probe.className = 'admin-count';
    probe.textContent = '2';
    badge.parentNode.appendChild(probe);
    var admin = getComputedStyle(probe);
    var result = {
      bg: style.backgroundColor,
      color: style.color,
      radius: style.borderRadius,
      weight: style.fontWeight,
      size: style.fontSize,
      sameBg: style.backgroundColor === admin.backgroundColor,
      sameRadius: style.borderRadius === admin.borderRadius,
      round: Math.abs(box.width - box.height) < 1 && box.height >= 22
    };
    probe.parentNode.removeChild(probe);
    badge.hidden = true;
    badge.textContent = '';
    return result;
  });
  assert.strictEqual(badgeStyle.bg, 'rgb(220, 38, 38)');
  assert.strictEqual(badgeStyle.color, 'rgb(255, 255, 255)');
  assert.ok(parseFloat(badgeStyle.radius) >= 11);
  assert.strictEqual(badgeStyle.weight, '700');
  assert.strictEqual(badgeStyle.size, '12px');
  assert.strictEqual(badgeStyle.sameBg, true);
  assert.strictEqual(badgeStyle.sameRadius, true);
  assert.strictEqual(badgeStyle.round, true);
  assert.strictEqual(await page.$eval('#dashboard-count', function (el) { return el.hidden && el.textContent; }), '');

  await page.click('#back');
  await page.waitForSelector('#tracking-open');
  assert.ok(/#\/?$/.test(await page.evaluate(function () { return location.hash; })));
  await page.click('#tracking-open');
  await page.waitForSelector('#tracking-tab-dashboard');
  await page.click('#tracking-tab-dashboard');
  await page.waitForSelector('#dashboard-sheet');
  await page.click('#back');
  await page.waitForSelector('#tracking-open');
  assert.ok(/#\/?$/.test(await page.evaluate(function () { return location.hash; })));

  const free = await openPage(browser, 'free_client', { sets: [], sessions: [], exercises: [] });
  await free.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
  await free.waitForSelector('#dashboard-soon');
  const freeSeen = await free.evaluate(function () {
    var badge = document.getElementById('dashboard-count');
    var tab = document.getElementById('tracking-tab-dashboard');
    return {
      note: document.getElementById('dashboard-soon').innerText,
      sheet: !!document.getElementById('dashboard-sheet'),
      title: document.getElementById('title').textContent,
      disabled: tab.disabled,
      badgeHidden: badge.hidden,
      badgeText: badge.textContent,
      lock: !!document.querySelector('[data-lock], .lock, .is-locked')
    };
  });
  assert.deepStrictEqual(freeSeen, {
    note: 'Your trainer can share a dashboard with you.',
    sheet: false,
    title: 'Tracking',
    disabled: false,
    badgeHidden: true,
    badgeText: '',
    lock: false
  });
  await free.click('#tracking-tab-history');
  await free.waitForSelector('#history-empty');
  assert.strictEqual(await free.$eval('#title', function (el) { return el.textContent; }), 'Tracking');
  assert.ok((await free.$eval('#app', function (el) { return el.innerText; })).indexOf('No history yet') >= 0);
  await free.close();

  for (const membership of ['trainer', 'master_trainer']) {
    const other = await openPage(browser, membership, { sets: [], sessions: [], exercises: [] });
    await other.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
    await other.waitForSelector('#dashboard-empty');
    const seen = await other.evaluate(function () {
      var badge = document.getElementById('dashboard-count');
      var tab = document.getElementById('tracking-tab-dashboard');
      return {
        note: document.getElementById('dashboard-empty').innerText,
        soon: !!document.getElementById('dashboard-soon'),
        title: document.getElementById('title').textContent,
        disabled: tab.disabled,
        badgeHidden: badge.hidden,
        badgeText: badge.textContent,
        lock: !!document.querySelector('[data-lock], .lock, .is-locked')
      };
    });
    assert.deepStrictEqual(seen, {
      note: 'Finish a workout and your dashboard will fill in.',
      soon: false,
      title: 'Tracking',
      disabled: false,
      badgeHidden: true,
      badgeText: '',
      lock: false
    });
    await other.click('#tracking-tab-history');
    await other.waitForSelector('#history-empty');
    assert.strictEqual(await other.$eval('#title', function (el) { return el.textContent; }), 'Tracking');
    assert.ok((await other.$eval('#app', function (el) { return el.innerText; })).indexOf('No history yet') >= 0);
    await other.close();
  }

  assert.deepStrictEqual(page.__errors, []);
  console.log('TRACKING UI OK');
  await browser.close();
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
