// Public landing page: copy, search tags, and signed-out root.
// node tests/landing.test.js [url]
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const Mem = require('../membership.js');

const TITLE = 'Coach Trainer App | Build, Run, and Track Client Training';
const DESCRIPTION = 'Coach Trainer App helps trainers create team drills, run gym circuits, build personal training sessions, schedule programs, and track client progress live.';
const HEADINGS = [
  'Build custom training sessions using reps, intervals, timed sets, and a built-in stopwatch to record laps with events for speed and skill.',
  'Run group circuits, manage your calendar, and track client progress in real time.'
];
const VALUES = [
  'Free client access to the Workout Player, Calendar, History, Messaging, and Trainer Hub.',
  'Keep clients engaged with custom tracking dashboards while attracting new leads via our local and online Trainer Hub.'
];
const SHOTS = [
  'assets/landing/team-drills.jpg',
  'assets/landing/team-gym.jpg'
];

assert.ok(html.indexOf('<title>' + TITLE + '</title>') !== -1);
assert.ok(html.indexOf('<meta name="description" content="' + DESCRIPTION + '">') !== -1);
assert.ok(html.indexOf('<meta property="og:title" content="' + TITLE + '">') !== -1);
assert.ok(html.indexOf('<meta property="og:description" content="' + DESCRIPTION + '">') !== -1);
assert.ok(html.indexOf('<meta property="og:image" content="https://coachtrainerapp.com/assets/landing/team-drills.jpg">') !== -1);

const landingStart = html.indexOf('<div id="landing">');
const landingEnd = html.indexOf('<div id="toast"');
assert.ok(landingStart > 0 && landingEnd > landingStart);
const landing = html.slice(landingStart, landingEnd);
const headings = [];
landing.replace(/<h2>([^<]*)<\/h2>/g, function (_, text) { headings.push(text); return _; });
assert.deepStrictEqual(headings, HEADINGS);
const srcs = [];
landing.replace(/<img src="([^"]+)"/g, function (_, src) { srcs.push(src); return _; });
assert.deepStrictEqual(srcs, SHOTS);
assert.strictEqual(landing.split('loading="lazy"').length - 1, SHOTS.length);
assert.strictEqual(landing.split('class="landing-frame"').length - 1, SHOTS.length);
assert.strictEqual(landing.indexOf('is-text'), -1);
const sections = [];
landing.replace(/<section class="landing-feature">([\s\S]*?)<\/section>/g, function (_, inner) {
  sections.push(inner);
  return _;
});
assert.strictEqual(sections.length, HEADINGS.length);
sections.forEach(function (inner, i) {
  var headingAt = inner.indexOf('<h2>' + HEADINGS[i] + '</h2>');
  var frameAt = inner.indexOf('<div class="landing-frame">');
  var shotAt = inner.indexOf(SHOTS[i]);
  var valueAt = inner.indexOf('<p class="landing-value">' + VALUES[i] + '</p>');
  assert.strictEqual(headingAt, 0, HEADINGS[i]);
  assert.ok(frameAt > headingAt, SHOTS[i]);
  assert.ok(shotAt > frameAt && shotAt < valueAt, SHOTS[i]);
  assert.ok(valueAt > frameAt, VALUES[i]);
});
VALUES.forEach(function (text) {
  assert.strictEqual(landing.split(text).length - 1, 1, text);
});
assert.ok(landing.indexOf('feature-4') === -1 && landing.indexOf('feature-7') === -1);
assert.strictEqual(landing.split('>Sign up / Sign in</a>').length - 1, 2);
assert.strictEqual(landing.split('href="#/signin"').length - 1, 2);
assert.ok(landing.indexOf('Coach Trainer <b>App</b>') !== -1);
assert.ok(landing.indexOf('data-plan') === -1);

const shotStart = appSrc.indexOf('var LANDING_SHOTS = [');
const shotEnd = appSrc.indexOf('];', shotStart);
assert.ok(shotStart > 0 && shotEnd > shotStart);
SHOTS.forEach(function (shot) {
  assert.ok(appSrc.slice(shotStart, shotEnd).indexOf("'" + shot + "'") !== -1, shot);
});
assert.strictEqual(appSrc.slice(shotStart, shotEnd).split('assets/landing/').length - 1, SHOTS.length);
const plansStart = appSrc.indexOf('function landingPlansHtml(');
const plansEnd = appSrc.indexOf('function fillLandingPlans(');
assert.ok(plansStart > 0 && plansEnd > plansStart);
const plans = appSrc.slice(plansStart, plansEnd);
assert.ok(plans.indexOf('WBMembership.TIERS.forEach') !== -1);
assert.ok(plans.indexOf('t.available.forEach') !== -1);
assert.ok(plans.indexOf('t.priceLabel') !== -1);
assert.ok(plans.indexOf('t.name') !== -1);
assert.strictEqual(plans.indexOf('data-plan'), -1);
assert.strictEqual(plans.indexOf('t.cta'), -1);
Mem.TIERS.forEach(function (tier) {
  tier.available.concat(tier.comingSoon || []).forEach(function (line) {
    assert.strictEqual(landing.indexOf(line), -1, 'plan copy stays in the shared tier list: ' + line);
  });
});

function assertValueLine(card, i, size) {
  assert.strictEqual(card.kids, 3);
  assert.strictEqual(card.h2Margin, '12px');
  assert.strictEqual(card.h2Weight, '800');
  assert.ok(card.h2Align === 'left' || card.h2Align === 'start', card.h2Align);
  assert.strictEqual(card.radius, '14px');
  assert.strictEqual(card.bg, 'rgb(255, 255, 255)');
  assert.strictEqual(card.valueText, VALUES[i]);
  assert.strictEqual(card.valueWeight, '400');
  assert.strictEqual(card.valueSize, size);
  assert.ok(parseFloat(card.valueSize) < parseFloat(card.h2Size), card.valueSize + ' vs ' + card.h2Size);
  assert.strictEqual(card.valueColor, 'rgb(55, 65, 81)');
  assert.strictEqual(card.valueAlign, 'left');
  assert.strictEqual(card.valueGap, 12);
}

(async function () {
  let pp;
  try { pp = require('puppeteer-core'); } catch (e) { pp = null; }
  const URL = process.argv[2];
  if (!URL) {
    console.log('LANDING OK');
    return;
  }
  if (!pp) throw new Error('puppeteer-core is required to open the landing page');
  const stubAuth = require('./allow.js').stubAuth;
  const browser = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', function (err) { errors.push(String(err)); });
    await stubAuth(page, { session: null });
    await page.evaluateOnNewDocument(function () {
      window.__appChromeInstead = false;
      window.__landingWasThere = false;
      var armed = false;
      function note() {
        var bar = document.querySelector && document.querySelector('body > header.bar');
        var el = document.getElementById && document.getElementById('landing');
        if (el && el.isConnected) window.__landingWasThere = true;
        if (!bar || !window.__landingWasThere) return;
        var landingOn = !!(el && el.isConnected && getComputedStyle(el).display !== 'none');
        if (getComputedStyle(bar).display !== 'none' && !landingOn) window.__appChromeInstead = true;
      }
      function arm() {
        var root = document.documentElement;
        if (armed || !root || root.nodeType !== 1) return false;
        armed = true;
        new MutationObserver(note).observe(root, { childList: true, subtree: true, attributes: true });
        note();
        return true;
      }
      function boot(tries) {
        if (arm() || tries > 20) return;
        setTimeout(function () { boot(tries + 1); }, 0);
      }
      boot(0);
    });
    await page.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 1 });
    function landingInset() {
      var shell = document.querySelector('.landing-wrap');
      var style = getComputedStyle(shell);
      var vw = document.documentElement.clientWidth;
      function edges(el) {
        var r = el.getBoundingClientRect();
        return { left: Math.round(r.left), right: Math.round(vw - r.right) };
      }
      return {
        pad: style.paddingLeft,
        max: style.maxWidth,
        shell: edges(shell),
        feats: edges(document.querySelector('.landing-features')),
        plans: edges(document.getElementById('landing-plans')),
        end: edges(document.querySelector('.landing-end')),
        cards: Array.prototype.map.call(document.querySelectorAll('.landing-feature'), function (el) {
          var h = el.querySelector('h2');
          var frame = el.querySelector('.landing-frame');
          var value = el.querySelector('.landing-value');
          var hs = getComputedStyle(h);
          var vs = getComputedStyle(value);
          var fr = frame.getBoundingClientRect();
          var vr = value.getBoundingClientRect();
          var cr = el.getBoundingClientRect();
          return {
            edges: edges(el),
            top: Math.round(cr.top),
            height: Math.round(cr.height),
            kids: el.children.length,
            h2Margin: hs.marginBottom,
            h2Size: hs.fontSize,
            h2Weight: hs.fontWeight,
            h2Align: hs.textAlign,
            radius: getComputedStyle(el).borderRadius,
            bg: getComputedStyle(el).backgroundColor,
            valueText: value.textContent,
            valueSize: vs.fontSize,
            valueWeight: vs.fontWeight,
            valueColor: vs.color,
            valueAlign: vs.textAlign,
            valueGap: Math.round(vr.top - fr.bottom),
            frameMax: getComputedStyle(frame).maxWidth
          };
        })
      };
    }
    await page.goto(URL, { waitUntil: 'networkidle0' });
    await page.waitForFunction(function (first) {
      var h = document.querySelector('#landing h2');
      return h && h.textContent === first && document.getElementById('landing-plans') && document.querySelector('#landing-plans h3');
    }, {}, HEADINGS[0]);
    const seen = await page.evaluate(function () {
      var landing = document.getElementById('landing');
      var heads = Array.prototype.map.call(landing.querySelectorAll('.landing-feature h2'), function (el) { return el.textContent; });
      var values = Array.prototype.map.call(landing.querySelectorAll('.landing-feature .landing-value'), function (el) { return el.textContent; });
      var textCards = landing.querySelectorAll('.landing-feature.is-text').length;
      var links = Array.prototype.map.call(landing.querySelectorAll('a[href="#/signin"]'), function (el) { return el.textContent; });
      var frames = Array.prototype.map.call(landing.querySelectorAll('.landing-frame'), function (el) {
        var img = el.querySelector('img');
        var box = el.getBoundingClientRect();
        return {
          src: img ? img.getAttribute('src') : '',
          lazy: img ? img.getAttribute('loading') : '',
          ratio: box.width ? box.height / box.width : 0
        };
      });
      var names = Array.prototype.map.call(landing.querySelectorAll('.plan h3'), function (el) { return el.textContent; });
      var text = landing.innerText;
      var doc = document.documentElement;
      return {
        hash: location.hash,
        heads: heads,
        values: values,
        textCards: textCards,
        links: links,
        frames: frames,
        names: names,
        text: text,
        plans: document.querySelectorAll('#landing [data-plan]').length,
        overflow: doc.scrollWidth - doc.clientWidth,
        bar: (function () {
          var bar = landing.querySelector('.landing-bar');
          var brand = landing.querySelector('.landing-brand');
          var link = bar.querySelector('a');
          var bb = brand.getBoundingClientRect();
          var lb = link.getBoundingClientRect();
          var barBox = bar.getBoundingClientRect();
          return {
            brand: brand.textContent,
            link: link.textContent,
            brandLeft: bb.left < lb.left,
            linkRight: lb.right <= barBox.right + 1,
            brandFull: brand.scrollWidth <= brand.clientWidth + 1
          };
        })()
      };
    });
    assert.strictEqual(seen.hash, '');
    assert.deepStrictEqual(seen.heads, HEADINGS);
    assert.deepStrictEqual(seen.values, VALUES);
    assert.strictEqual(seen.textCards, 0);
    assert.deepStrictEqual(seen.links, ['Sign up / Sign in', 'Sign up / Sign in']);
    assert.deepStrictEqual(seen.names, Mem.TIERS.map(function (t) { return t.name; }));
    assert.strictEqual(seen.plans, 0);
    assert.ok(seen.overflow <= 1, 'horizontal overflow ' + seen.overflow);
    assert.strictEqual(seen.bar.brand, 'Coach Trainer App');
    assert.strictEqual(seen.bar.link, 'Sign up / Sign in');
    assert.strictEqual(seen.bar.brandLeft, true);
    assert.strictEqual(seen.bar.linkRight, true);
    assert.strictEqual(seen.bar.brandFull, true);
    assert.strictEqual(await page.evaluate(function () { return document.documentElement.classList.contains('wb-landing'); }), true);
    assert.strictEqual(await page.evaluate(function () { return window.__appChromeInstead; }), false);
    const phoneInset = await page.evaluate(landingInset);
    assert.strictEqual(phoneInset.pad, '16px');
    assert.strictEqual(phoneInset.max, '1100px');
    assert.ok(phoneInset.feats.left >= 16 && phoneInset.feats.left <= 24, 'phone feature inset ' + phoneInset.feats.left);
    assert.deepStrictEqual(phoneInset.plans, phoneInset.feats);
    assert.deepStrictEqual(phoneInset.end, phoneInset.feats);
    assert.strictEqual(phoneInset.cards.length, HEADINGS.length);
    phoneInset.cards.forEach(function (card, i) {
      assert.deepStrictEqual(card.edges, phoneInset.feats);
      assert.strictEqual(card.h2Size, '18px');
      assert.strictEqual(card.frameMax, 'none');
      assertValueLine(card, i, '16px');
    });
    assert.ok(phoneInset.cards[1].top >= phoneInset.cards[0].top + phoneInset.cards[0].height);
    assert.strictEqual(phoneInset.cards[1].top - (phoneInset.cards[0].top + phoneInset.cards[0].height), 16);
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    const deskInset = await page.evaluate(landingInset);
    assert.strictEqual(deskInset.max, '1100px');
    assert.ok(deskInset.shell.left > 40, 'desktop container inset ' + deskInset.shell.left);
    assert.strictEqual(deskInset.shell.left, deskInset.shell.right);
    assert.deepStrictEqual(deskInset.plans, deskInset.feats);
    assert.deepStrictEqual(deskInset.end, deskInset.feats);
    assert.ok(deskInset.feats.left >= deskInset.shell.left);
    assert.strictEqual(deskInset.cards.length, HEADINGS.length);
    deskInset.cards.forEach(function (card, i) {
      assert.strictEqual(card.h2Size, '22px');
      assert.strictEqual(card.frameMax, '720px');
      assertValueLine(card, i, '18px');
    });
    const deskFeatures = await page.evaluate(function () {
      var vw = document.documentElement.clientWidth;
      function box(el) {
        var r = el.getBoundingClientRect();
        return { left: Math.round(r.left), right: Math.round(vw - r.right), top: Math.round(r.top), width: Math.round(r.width) };
      }
      var feats = box(document.querySelector('.landing-features'));
      return {
        feats: feats,
        cards: Array.prototype.map.call(document.querySelectorAll('.landing-feature'), function (el) {
          return { box: box(el), frame: box(el.querySelector('.landing-frame')) };
        })
      };
    });
    assert.strictEqual(deskFeatures.cards.length, HEADINGS.length);
    var sprint = deskFeatures.cards[0];
    var group = deskFeatures.cards[1];
    assert.strictEqual(sprint.box.top, group.box.top);
    assert.strictEqual(sprint.box.left, deskFeatures.feats.left);
    assert.strictEqual(group.box.right, deskFeatures.feats.right);
    assert.strictEqual(sprint.box.width, group.box.width);
    assert.ok(sprint.box.width < deskFeatures.feats.width, 'a photo card still spans the row');
    var colGap = group.box.left - (sprint.box.left + sprint.box.width);
    assert.strictEqual(colGap, 16);
    assert.strictEqual(sprint.box.width + colGap + group.box.width, deskFeatures.feats.width);
    deskFeatures.cards.forEach(function (card, i) {
      assert.ok(card.frame.width <= 720, 'feature ' + i + ' photo ' + card.frame.width);
      assert.ok(card.frame.width <= card.box.width);
      var insetLeft = card.frame.left - card.box.left;
      var insetRight = (card.box.left + card.box.width) - (card.frame.left + card.frame.width);
      assert.ok(Math.abs(insetLeft - insetRight) <= 1, 'feature ' + i + ' photo inset');
    });
    await page.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 1 });
    assert.strictEqual(seen.frames.length, SHOTS.length);
    seen.frames.forEach(function (frame, i) {
      assert.strictEqual(frame.src, SHOTS[i]);
      assert.strictEqual(frame.lazy, 'lazy');
      assert.ok(Math.abs(frame.ratio - 9 / 16) < 0.04, 'frame ' + i + ' ratio ' + frame.ratio);
    });
    await page.evaluate(function () {
      return Promise.all(Array.prototype.map.call(document.querySelectorAll('.landing-feature img'), function (img) {
        img.loading = 'eager';
        img.scrollIntoView({ block: 'center' });
        return img.decode().catch(function () {});
      }));
    });
    const shots = await page.evaluate(function () {
      return Array.prototype.map.call(document.querySelectorAll('.landing-feature img'), function (img) {
        return { missing: img.classList.contains('is-missing'), width: img.naturalWidth };
      });
    });
    assert.strictEqual(shots[0].missing, false);
    assert.strictEqual(shots.length, SHOTS.length);
    shots.forEach(function (shot, i) {
      assert.strictEqual(shot.missing, false, SHOTS[i]);
      assert.ok(shot.width > 0, SHOTS[i]);
    });
    Mem.TIERS.forEach(function (tier) {
      assert.ok(seen.text.indexOf(tier.name) !== -1, tier.name);
      assert.ok(seen.text.indexOf(tier.priceLabel) !== -1, tier.priceLabel);
      tier.available.forEach(function (line) { assert.ok(seen.text.indexOf(line) !== -1, line); });
      (tier.comingSoon || []).forEach(function (line) { assert.ok(seen.text.indexOf(line) !== -1, line); });
    });
    assert.ok(seen.text.indexOf('Choose Enthusiast') === -1);
    assert.ok(seen.text.indexOf('Choose Trainer') === -1);
    assert.ok(seen.text.indexOf('Choose Master Trainer') === -1);

    await page.click('.landing-bar a[href="#/signin"]');
    await page.waitForFunction(function () {
      var h = document.querySelector('h2');
      var landing = document.getElementById('landing');
      return location.hash === '#/signin' && h && h.textContent === 'Sign in' && landing && getComputedStyle(landing).display === 'none';
    });
    await page.evaluate(function () {
      window.WBAuth.session = function () { return new Promise(function () {}); };
    });
    await page.evaluate(function () { history.back(); });
    await page.waitForFunction(function () { return location.hash === '' || location.hash === '#'; });
    const backState = await page.evaluate(function () {
      var el = document.getElementById('landing');
      var bar = document.querySelector('body > header.bar');
      return {
        connected: !!(el && el.isConnected),
        landing: el ? getComputedStyle(el).display : '',
        bar: bar ? getComputedStyle(bar).display : '',
        appClass: document.documentElement.classList.contains('wb-app')
      };
    });
    assert.strictEqual(backState.connected, true);
    assert.notStrictEqual(backState.landing, 'none');
    assert.strictEqual(backState.bar, 'none');
    assert.strictEqual(backState.appClass, false);
    await page.evaluate(function () {
      window.WBAuth.session = function () { return Promise.resolve(null); };
    });
    await page.goto(URL + '#/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(function () {
      var landing = document.getElementById('landing');
      return (location.hash === '' || location.hash === '#') && landing && getComputedStyle(landing).display !== 'none' && document.body.innerText.indexOf('Choose how you want to train') !== -1 && !document.querySelector('[data-a=new]');
    });
    await page.goto(URL + '?invite=ABCD2345', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(function () {
      var h = document.querySelector('h2');
      var code = document.getElementById('invite-code');
      var landing = document.getElementById('landing');
      return location.hash === '#/join' && h && h.textContent === 'Create your account' && code && code.value === 'ABCD-2345' && landing && getComputedStyle(landing).display === 'none';
    });

    const signedIn = await browser.newPage();
    signedIn.on('pageerror', function (err) { errors.push(String(err)); });
    await stubAuth(signedIn);
    await signedIn.goto(URL, { waitUntil: 'domcontentloaded' });
    await signedIn.waitForSelector('[data-a=new]');
    assert.strictEqual(await signedIn.evaluate(function () {
      var el = document.getElementById('landing');
      return !!(el && el.isConnected && getComputedStyle(el).display === 'none');
    }), true);
    assert.ok(await signedIn.$('header.bar'));

    async function neverShowsLanding(setup, url, ready) {
      const p = await browser.newPage();
      p.on('pageerror', function (err) { errors.push(String(err)); });
      await p.evaluateOnNewDocument(function () {
        window.__landingShown = false;
        function note() {
          var el = document.getElementById && document.getElementById('landing');
          if (el && el.isConnected && getComputedStyle(el).display !== 'none') window.__landingShown = true;
        }
        var timer = setInterval(note, 16);
        function arm() {
          note();
          if (!document.documentElement) return;
          clearInterval(timer);
          new MutationObserver(note).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
        }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arm);
        else arm();
      });
      await setup(p);
      await p.goto(url, { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(ready);
      assert.strictEqual(await p.evaluate(function () { return window.__landingShown; }), false);
      assert.strictEqual(await p.evaluate(function () { return document.documentElement.classList.contains('wb-landing'); }), false);
      await p.close();
    }
    await neverShowsLanding(function (p) {
      return p.evaluateOnNewDocument(function () {
        localStorage.setItem('sb-thyrgloermygnezfareg-auth-token', '{"access_token":"abc"}');
      }).then(function () { return stubAuth(p); });
    }, URL, function () { return !!document.querySelector('[data-a=new]'); });
    await neverShowsLanding(function (p) { return stubAuth(p, { session: null }); }, URL + '?invite=ABCD2345', function () {
      var h = document.querySelector('h2');
      return location.hash === '#/join' && h && h.textContent === 'Create your account';
    });
    await neverShowsLanding(function (p) { return stubAuth(p, { session: null }); }, URL + '?code=reset-code', function () {
      return location.hash === '#/reset' && document.body.innerText.indexOf('This reset link is invalid or has expired.') !== -1;
    });

    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
  }
  console.log('LANDING OK');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
