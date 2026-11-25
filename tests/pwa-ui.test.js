// Installable app shell and the top-bar full screen control.
// node tests/pwa-ui.test.js [url]
const assert = require('assert');
const fs = require('fs');
const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';

function pngSize(buf) {
  assert.strictEqual(buf.slice(0, 8).toString('hex'), '89504e470d0a1a0a');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

(async () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.webmanifest', 'utf8'));
  assert.strictEqual(manifest.name, 'Coach Trainer App');
  assert.strictEqual(manifest.short_name, 'Coach Trainer');
  assert.strictEqual(manifest.start_url, '/');
  assert.strictEqual(manifest.scope, '/');
  assert.strictEqual(manifest.display, 'standalone');
  assert.strictEqual(manifest.theme_color, '#111827');
  assert.strictEqual(manifest.background_color, '#f3f4f6');
  assert.deepStrictEqual(manifest.icons.map(function (icon) { return icon.sizes + ' ' + icon.purpose; }), [
    '192x192 any',
    '512x512 any',
    '192x192 maskable',
    '512x512 maskable'
  ]);
  assert.deepStrictEqual(pngSize(fs.readFileSync('icons/icon-192.png')), { w: 192, h: 192 });
  assert.deepStrictEqual(pngSize(fs.readFileSync('icons/icon-512.png')), { w: 512, h: 512 });
  assert.deepStrictEqual(pngSize(fs.readFileSync('icons/icon-192-maskable.png')), { w: 192, h: 192 });
  assert.deepStrictEqual(pngSize(fs.readFileSync('icons/icon-512-maskable.png')), { w: 512, h: 512 });

  const sw = fs.readFileSync('sw.js', 'utf8');
  assert.ok(sw.indexOf("addEventListener('fetch'") !== -1);
  assert.ok(!/caches|respondWith|cache\.put|cache\.add/i.test(sw));

  const html = fs.readFileSync('index.html', 'utf8');
  const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
  assert.ok(head.indexOf('rel="manifest" href="manifest.webmanifest"') !== -1);
  [
    '<link rel="icon" href="/favicon.ico" sizes="48x48">',
    '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">',
    '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">',
    '<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png">',
    '<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96.png">',
    '<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png">'
  ].forEach(function (link) {
    assert.ok(head.indexOf(link) !== -1, 'missing ' + link);
  });
  assert.ok(head.indexOf('<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">') !== -1);
  [
    'favicon.ico',
    'favicon-16.png',
    'favicon-32.png',
    'favicon-48.png',
    'favicon-96.png',
    'apple-touch-icon.png',
    'icons/icon-192.png',
    'icons/icon-192-maskable.png',
    'icons/icon-512.png',
    'icons/icon-512-maskable.png'
  ].forEach(function (path) {
    assert.ok(fs.existsSync(path), 'missing ' + path);
  });
  assert.deepStrictEqual(pngSize(fs.readFileSync('favicon-16.png')), { w: 16, h: 16 });
  assert.deepStrictEqual(pngSize(fs.readFileSync('favicon-32.png')), { w: 32, h: 32 });
  assert.deepStrictEqual(pngSize(fs.readFileSync('favicon-48.png')), { w: 48, h: 48 });
  assert.deepStrictEqual(pngSize(fs.readFileSync('favicon-96.png')), { w: 96, h: 96 });
  assert.deepStrictEqual(pngSize(fs.readFileSync('apple-touch-icon.png')), { w: 180, h: 180 });
  assert.ok(html.indexOf('id="fullscreen-btn"') < html.indexOf('id="account-me"'));

  const chrome = process.env.CHROME || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : '/usr/local/bin/google-chrome');
  const browser = await pp.launch({ executablePath: chrome, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', function (err) { errors.push(String(err)); });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await require('./allow.js').stubAuth(page);
  await page.goto(URL + '#/', { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#account-me');
  await page.waitForFunction(function () {
    var btn = document.getElementById('fullscreen-btn');
    return btn && !btn.hidden && document.querySelector('[data-a=new]');
  });

  function readBar() {
    return page.evaluate(function () {
      function box(id) {
        var el = document.getElementById(id);
        var r = el.getBoundingClientRect();
        var svg = el.querySelector('svg.fs-enter') || el.querySelector('svg');
        var sr = svg ? svg.getBoundingClientRect() : null;
        return {
          top: r.top, left: r.left, right: r.right, w: r.width, h: r.height,
          svg: sr ? { w: sr.width, h: sr.height } : null,
          color: getComputedStyle(el).color,
          hidden: el.hidden,
          display: getComputedStyle(el).display
        };
      }
      var row = document.querySelector('#app-bar .nav-top');
      var kids = Array.prototype.filter.call(row.children, function (el) {
        return !el.hidden && getComputedStyle(el).display !== 'none';
      });
      return {
        scroll: row.scrollWidth,
        client: row.clientWidth,
        width: window.innerWidth,
        mids: kids.map(function (el) {
          var r = el.getBoundingClientRect();
          return r.top + r.height / 2;
        }),
        rowH: row.getBoundingClientRect().height,
        fs: box('fullscreen-btn'),
        me: box('account-me'),
        out: document.getElementById('account-signout').hidden,
        label: document.getElementById('fullscreen-btn').getAttribute('aria-label'),
        exit: getComputedStyle(document.querySelector('#fullscreen-btn .fs-exit')).display,
        enter: getComputedStyle(document.querySelector('#fullscreen-btn .fs-enter')).display
      };
    });
  }

  const home = await readBar();
  assert.ok(home.scroll <= home.client + 1, 'home bar overflows ' + home.scroll + '>' + home.client);
  assert.ok(home.rowH < 60, 'home bar height ' + home.rowH);
  assert.ok(Math.max.apply(null, home.mids) - Math.min.apply(null, home.mids) < 2, 'home bar wraps ' + JSON.stringify(home.mids));
  assert.ok(Math.abs(home.fs.w - 32) < 1 && Math.abs(home.fs.h - 32) < 1);
  assert.ok(Math.abs(home.fs.svg.w - 20) < 1 && Math.abs(home.fs.svg.h - 20) < 1);
  assert.strictEqual(home.fs.color, 'rgb(209, 213, 219)');
  assert.ok(Math.abs((home.me.left - home.fs.right) - 6) <= 1, 'gap ' + (home.me.left - home.fs.right));
  assert.strictEqual(home.label, 'Full screen');
  assert.strictEqual(home.enter, 'block');
  assert.strictEqual(home.exit, 'none');
  assert.strictEqual(home.out, true);

  await page.evaluate(function () { location.hash = '#/account'; });
  await page.waitForFunction(function () {
    return document.getElementById('title').textContent === 'Account' && !document.getElementById('account-signout').hidden;
  });
  const account = await readBar();
  assert.strictEqual(account.out, false);
  assert.ok(account.scroll <= account.client + 1, 'account bar overflows ' + account.scroll + '>' + account.client);
  assert.ok(account.rowH < 60, 'account bar height ' + account.rowH);
  assert.ok(Math.max.apply(null, account.mids) - Math.min.apply(null, account.mids) < 2, 'account bar wraps ' + JSON.stringify(account.mids));
  assert.ok(account.fs.right <= account.me.left);
  assert.ok(Math.abs((account.me.left - account.fs.right) - 6) <= 1);

  await page.evaluate(function () {
    window.__fs = 0;
    document.documentElement.requestFullscreen = function () { window.__fs += 1; return Promise.resolve(); };
  });
  await page.click('#fullscreen-btn');
  assert.strictEqual(await page.evaluate(function () { return window.__fs; }), 1);

  await page.evaluateOnNewDocument(function () {
    var orig = window.matchMedia.bind(window);
    window.matchMedia = function (query) {
      if (String(query).indexOf('display-mode') !== -1) {
        return { matches: true, media: String(query), addListener: function () {}, removeListener: function () {}, addEventListener: function () {}, removeEventListener: function () {} };
      }
      return orig(query);
    };
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#account-me');
  assert.strictEqual(await page.$eval('#fullscreen-btn', function (el) { return el.hidden; }), true);

  const reg = await page.evaluate(function () {
    return navigator.serviceWorker.getRegistration().then(function (r) { return r ? r.scope : ''; });
  });
  assert.ok(/\/$/.test(reg), reg);
  const served = await page.evaluate(function () {
    return Promise.all([
      'manifest.webmanifest', 'sw.js',
      'favicon.ico', 'favicon-16.png', 'favicon-32.png', 'favicon-48.png', 'favicon-96.png', 'apple-touch-icon.png',
      'icons/icon-192.png', 'icons/icon-192-maskable.png', 'icons/icon-512.png', 'icons/icon-512-maskable.png'
    ].map(function (path) {
      return fetch(path).then(function (res) { return { path: path, status: res.status }; });
    }));
  });
  served.forEach(function (row) { assert.strictEqual(row.status, 200, row.path); });

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('PWA UI OK');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
