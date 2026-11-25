// Nav badges for unread messages, hub replies, and shared tracking.
// No network and no live database. node tests/nav-badges-ui.test.js [url]
const assert = require('assert');
const pp = require('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const USER = '22222222-2222-4222-8222-222222222222';

function badge(page, id) {
  return page.evaluate(function (linkId) {
    var link = document.getElementById(linkId);
    var el = link ? link.querySelector('.request-count') : null;
    if (!el) return null;
    var style = getComputedStyle(el);
    return {
      text: el.textContent,
      label: el.getAttribute('aria-label'),
      color: style.color,
      background: style.backgroundColor,
      fontSize: style.fontSize
    };
  }, id);
}

(async () => {
  const browser = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', function (err) { errors.push(String(err)); });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(function (userId) {
    var current;
    function patch(api) {
      if (!api || api.__navStub) return api;
      api.__navStub = true;
      window.__counts = { messages: 2, hub: 1, tracking: 3 };
      window.__marks = [];
      window.__signedIn = true;
      api.session = function () {
        if (!window.__signedIn) return Promise.resolve(null);
        return Promise.resolve({ user: { id: userId, email: 'ada@example.com' } });
      };
      api.profile = function () {
        return Promise.resolve({
          id: userId,
          membership: 'free_client',
          display_name: 'Ada Client'
        });
      };
      api.roster = function () { return Promise.resolve({ role: null, clients: [], invites: [] }); };
      api.myConnection = function () { return Promise.resolve(null); };
      api.trainerRequestCount = function () { return Promise.resolve(7); };
      api.signOut = function () { window.__signedIn = false; return Promise.resolve(); };
      api.navBadges = function () {
        if (window.__badgeFail) return Promise.resolve(null);
        var snap = {
          messages: window.__counts.messages,
          hub: window.__counts.hub,
          tracking: window.__counts.tracking
        };
        if (window.__badgeDelay) {
          return new Promise(function (resolve) {
            setTimeout(function () { resolve(snap); }, 250);
          });
        }
        return Promise.resolve(snap);
      };
      api.navMarkSeen = function (section) {
        window.__marks.push(section);
        function done() {
          window.__counts[section] = 0;
          return '2026-11-25T04:00:00.000Z';
        }
        if (window.__markDelay) {
          return new Promise(function (resolve) {
            window.__releaseMark = function () { resolve(done()); };
          });
        }
        return Promise.resolve(done());
      };
      api.threads = function () { return Promise.resolve({ role: 'client', threads: [], requests: [] }); };
      api.hubPosts = function () { return Promise.resolve([]); };
      api.myHistory = function () { return Promise.resolve({ sets: [], sessions: [], exercises: [] }); };
      api.myShares = function () { return Promise.resolve({ shares: [] }); };
      return api;
    }
    Object.defineProperty(window, 'WBAuth', {
      configurable: true,
      enumerable: true,
      get: function () { return current; },
      set: function (v) { current = patch(v); }
    });
  }, USER);

  await page.goto(URL + '#/');
  await page.waitForFunction(function () {
    var messages = document.querySelector('#messages-nav .request-count');
    var hub = document.querySelector('#hub-nav .request-count');
    var tracking = document.querySelector('#tracking-open .request-count');
    return messages && messages.textContent === '2' && hub && hub.textContent === '1' && tracking && tracking.textContent === '3';
  });
  const messages = await badge(page, 'messages-nav');
  const hub = await badge(page, 'hub-nav');
  const tracking = await badge(page, 'tracking-open');
  assert.strictEqual(messages.label, '2 unread messages');
  assert.strictEqual(hub.label, '1 new reply');
  assert.strictEqual(tracking.label, '3 new tracking items');
  [messages, hub, tracking].forEach(function (item) {
    assert.strictEqual(item.color, 'rgb(255, 255, 255)');
    assert.strictEqual(item.background, 'rgb(220, 38, 38)');
    assert.notStrictEqual(item.fontSize, '0px');
    assert.strictEqual(item.label.indexOf('@'), -1);
  });

  await page.click('#messages-nav');
  await page.waitForFunction(function () {
    return location.hash.indexOf('#/messages') === 0 && !document.querySelector('#messages-nav .request-count')
      && document.querySelector('#hub-nav .request-count').textContent === '1'
      && document.querySelector('#tracking-open .request-count').textContent === '3';
  });
  assert.deepStrictEqual(await page.evaluate(function () { return window.__marks.slice(); }), ['messages']);

  await page.evaluate(function () { window.__counts.messages = 4; location.hash = '#/account'; });
  await page.waitForFunction(function () {
    var el = document.querySelector('#messages-nav .request-count');
    return location.hash.indexOf('#/account') === 0 && el && el.textContent === '4';
  });

  await page.click('#hub-nav');
  await page.waitForFunction(function () {
    return location.hash.indexOf('#/hub') === 0 && !document.querySelector('#hub-nav .request-count');
  });
  assert.ok((await page.evaluate(function () { return window.__marks; })).indexOf('hub') !== -1);

  await page.evaluate(function () {
    window.__counts.tracking = 2;
    location.hash = '#/tracking';
  });
  await page.waitForFunction(function () {
    return location.hash.indexOf('#/tracking') === 0 && !document.querySelector('#tracking-open .request-count')
      && window.__marks.indexOf('tracking') !== -1;
  });

  await page.evaluate(function () {
    window.__counts = { messages: 1, hub: 0, tracking: 2 };
    location.hash = '#/';
  });
  await page.waitForFunction(function () {
    var trackingBadge = document.querySelector('#tracking-open .request-count');
    var messagesBadge = document.querySelector('#messages-nav .request-count');
    var home = location.hash === '' || location.hash === '#' || location.hash === '#/';
    return home && trackingBadge && trackingBadge.textContent === '2'
      && messagesBadge && messagesBadge.textContent === '1';
  });
  await page.evaluate(function () { location.hash = '#/history'; });
  await page.waitForFunction(function () {
    return location.hash.indexOf('#/history') === 0
      && document.querySelector('#messages-nav .request-count').textContent === '1'
      && !document.querySelector('#hub-nav .request-count')
      && !document.querySelector('#tracking-open .request-count')
      && window.__marks.filter(function (item) { return item === 'tracking'; }).length >= 2;
  });

  await page.evaluate(function () {
    window.__badgeDelay = false;
    window.__markDelay = false;
    window.__badgeFail = false;
    window.__counts = { messages: 5, hub: 0, tracking: 0 };
    location.hash = '#/';
  });
  await page.waitForFunction(function () {
    var el = document.querySelector('#messages-nav .request-count');
    var home = location.hash === '' || location.hash === '#' || location.hash === '#/';
    return home && el && el.textContent === '5';
  });
  await page.evaluate(function () {
    window.__badgeDelay = true;
    window.__markDelay = true;
  });
  await page.click('#messages-nav');
  await page.waitForFunction(function () {
    return location.hash.indexOf('#/messages') === 0 && !document.querySelector('#messages-nav .request-count');
  });
  await new Promise(function (r) { setTimeout(r, 400); });
  assert.strictEqual(await page.$('#messages-nav .request-count'), null);
  await page.evaluate(function () { if (window.__releaseMark) window.__releaseMark(); });
  await new Promise(function (r) { setTimeout(r, 80); });
  assert.strictEqual(await page.$('#messages-nav .request-count'), null);

  await page.evaluate(function () {
    window.__badgeDelay = false;
    window.__markDelay = false;
    window.__badgeFail = false;
    window.__counts = { messages: 3, hub: 0, tracking: 0 };
    location.hash = '#/';
  });
  await page.waitForFunction(function () {
    var el = document.querySelector('#messages-nav .request-count');
    return (location.hash === '' || location.hash === '#' || location.hash === '#/') && el && el.textContent === '3';
  });
  await page.evaluate(function () {
    window.__badgeFail = true;
    location.hash = '#/account';
  });
  await page.waitForFunction(function () { return location.hash.indexOf('#/account') === 0; });
  await new Promise(function (r) { setTimeout(r, 80); });
  assert.strictEqual(await page.$eval('#messages-nav .request-count', function (el) { return el.textContent; }), '3');

  await page.evaluate(function () {
    window.__badgeFail = false;
    window.__badgeDelay = true;
    window.__counts.messages = 9;
    location.hash = '#/account';
  });
  await page.waitForFunction(function () { return location.hash.indexOf('#/account') === 0; });
  await page.evaluate(function () { window.__signedIn = false; });
  await page.click('#account-signout');
  await page.waitForFunction(function () {
    var links = document.getElementById('nav-links');
    return (location.hash === '' || location.hash === '#') && links && links.hidden
      && !document.querySelector('#messages-nav .request-count');
  });
  await new Promise(function (r) { setTimeout(r, 400); });
  assert.strictEqual(await page.$('#messages-nav .request-count'), null);
  assert.strictEqual(errors.length, 0, errors.join('\n'));
  await browser.close();
  console.log('NAV BADGES UI OK');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
