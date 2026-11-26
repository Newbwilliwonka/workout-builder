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
  'Precision Speed & Custom Workouts',
  'Effortless Group Circuits & Client Tracking'
];
const VALUES = [
  'Build sessions with reps, intervals, timed sets, and a built-in stopwatch with laps and events, plus free client access to the Workout Player, Calendar, History, Messaging, and Trainer Hub.',
  'Manage your calendar and track progress in real time with custom client dashboards, while attracting new leads via our local and online Trainer Hub.'
];
const PLANS_HEADING = 'Simple Plans for Every Coach';
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
  var frameAt = inner.indexOf('<div class="landing-frame">');
  var copyAt = inner.indexOf('<div class="landing-copy">');
  var headingAt = inner.indexOf('<h2>' + HEADINGS[i] + '</h2>');
  var shotAt = inner.indexOf(SHOTS[i]);
  var valueAt = inner.indexOf('<p class="landing-value">' + VALUES[i] + '</p>');
  assert.strictEqual(frameAt, 0, SHOTS[i]);
  assert.ok(shotAt > frameAt && shotAt < copyAt, SHOTS[i]);
  assert.ok(copyAt > frameAt && headingAt > copyAt && valueAt > headingAt, HEADINGS[i]);
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
assert.ok(plans.indexOf('data-landing-plan') !== -1);
assert.ok(plans.indexOf('>Subscribe</button>') !== -1);
assert.ok(plans.indexOf("Free with your trainer\\'s invite code.") !== -1);
assert.strictEqual(plans.indexOf('t.cta'), -1);
assert.ok(plans.indexOf('landing-plans-chevron') !== -1);
assert.ok(plans.indexOf('<h2>' + PLANS_HEADING + '</h2>') !== -1);
assert.ok(plans.indexOf('landing-plans-chevron') < plans.indexOf('<h2>' + PLANS_HEADING + '</h2>'));
assert.strictEqual(plans.indexOf('Choose how you want to train'), -1);
assert.strictEqual(plans.indexOf('Every plan is defined'), -1);
assert.ok(plans.indexOf('Beta pricing for the first 100 members.') !== -1);
assert.ok(appSrc.indexOf('<h2>Choose how you want to train</h2>') !== -1);
assert.ok(appSrc.indexOf('Every plan is defined by what you can do, now and as the next features arrive.') !== -1);
Mem.TIERS.forEach(function (tier) {
  tier.available.concat(tier.comingSoon || []).forEach(function (line) {
    assert.strictEqual(landing.indexOf(line), -1, 'plan copy stays in the shared tier list: ' + line);
  });
});

var FRAME_SHADOW = 'rgba(17, 24, 39, 0.14) 0px 10px 28px 0px, rgba(17, 24, 39, 0.08) 0px 2px 8px 0px';
function assertCopyBlock(card, i, size, headGap, h2Line, valueLine) {
  assert.strictEqual(card.kids, 2);
  assert.strictEqual(card.h2Weight, '800');
  assert.strictEqual(card.h2Line, h2Line);
  assert.ok(card.h2Align === 'left' || card.h2Align === 'start', card.h2Align);
  assert.strictEqual(card.radius, '0px');
  assert.strictEqual(card.bg, 'rgba(0, 0, 0, 0)');
  assert.strictEqual(card.shadow, 'none');
  assert.strictEqual(card.valueText, VALUES[i]);
  assert.strictEqual(card.valueWeight, '400');
  assert.strictEqual(card.valueSize, size);
  assert.strictEqual(card.valueLine, valueLine);
  assert.ok(parseFloat(card.valueSize) < parseFloat(card.h2Size), card.valueSize + ' vs ' + card.h2Size);
  assert.strictEqual(card.valueColor, 'rgb(75, 85, 99)');
  assert.strictEqual(card.valueAlign, 'left');
  assert.strictEqual(card.headToValue, headGap);
  assert.strictEqual(card.frameRadius, '14px');
  assert.strictEqual(card.frameShadow, FRAME_SHADOW);
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
    function landingPlate() {
      var before = getComputedStyle(document.body, '::before');
      var after = getComputedStyle(document.body, '::after');
      var bodyH = document.body.getBoundingClientRect().height;
      return {
        beforeH: before.height,
        beforeImg: before.backgroundImage,
        beforeSize: before.backgroundSize,
        beforePos: before.backgroundPosition,
        afterContent: after.content,
        afterTop: parseFloat(after.top),
        afterReach: parseFloat(after.top) + parseFloat(after.height),
        afterFilter: after.filter,
        afterImg: after.backgroundImage,
        bodyH: bodyH,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    }
    function plansCue() {
      var feats = document.querySelectorAll('.landing-feature');
      var last = feats[feats.length - 1].getBoundingClientRect();
      var mark = document.querySelector('#landing-plans .landing-plans-chevron');
      var title = document.querySelector('#landing-plans h2');
      var host = document.getElementById('landing-plans').getBoundingClientRect();
      var mr = mark.getBoundingClientRect();
      var tr = title.getBoundingClientRect();
      return {
        afterFeature: Math.round(mr.top - last.bottom),
        beforeHeading: Math.round(tr.top - mr.bottom),
        total: Math.round(tr.top - last.bottom),
        centered: Math.abs((mr.left + mr.right) / 2 - (host.left + host.right) / 2) <= 1
      };
    }
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
          var featureStyle = getComputedStyle(el);
          var frameStyle = getComputedStyle(frame);
          var fr = frame.getBoundingClientRect();
          var hr = h.getBoundingClientRect();
          var vr = value.getBoundingClientRect();
          var cr = el.getBoundingClientRect();
          return {
            edges: edges(el),
            top: Math.round(cr.top),
            height: Math.round(cr.height),
            kids: el.children.length,
            h2Size: hs.fontSize,
            h2Weight: hs.fontWeight,
            h2Line: hs.lineHeight,
            h2Align: hs.textAlign,
            radius: featureStyle.borderRadius,
            bg: featureStyle.backgroundColor,
            shadow: featureStyle.boxShadow,
            valueText: value.textContent,
            valueSize: vs.fontSize,
            valueWeight: vs.fontWeight,
            valueLine: vs.lineHeight,
            valueColor: vs.color,
            valueAlign: vs.textAlign,
            photoToHead: Math.round(hr.top - fr.bottom),
            headToValue: Math.round(vr.top - hr.bottom),
            frameMax: frameStyle.maxWidth,
            frameRadius: frameStyle.borderRadius,
            frameShadow: frameStyle.boxShadow
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
        subscribes: Array.prototype.map.call(landing.querySelectorAll('[data-landing-plan]'), function (el) { return el.getAttribute('data-landing-plan'); }),
        freeInvite: landing.innerText.indexOf("Free with your trainer's invite code.") !== -1,
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
    assert.deepStrictEqual(seen.subscribes, ['enthusiast', 'trainer', 'master_trainer']);
    assert.strictEqual(seen.freeInvite, true);
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
      assert.strictEqual(card.h2Size, '22px');
      assert.strictEqual(card.frameMax, 'none');
      assert.strictEqual(card.photoToHead, 16);
      assertCopyBlock(card, i, '15px', 8, '27.5px', '21.75px');
    });
    assert.ok(phoneInset.cards[1].top >= phoneInset.cards[0].top + phoneInset.cards[0].height);
    assert.strictEqual(phoneInset.cards[1].top - (phoneInset.cards[0].top + phoneInset.cards[0].height), 64);
    const phonePlate = await page.evaluate(landingPlate);
    assert.strictEqual(phonePlate.beforeH, '1120px');
    assert.ok(phonePlate.beforeImg.indexOf('app-bg-phone') !== -1);
    assert.strictEqual(phonePlate.beforeImg.indexOf('app-bg-wide'), -1);
    assert.strictEqual(phonePlate.afterContent, '""');
    assert.ok(phonePlate.afterFilter.indexOf('blur') !== -1);
    assert.ok(phonePlate.afterImg.indexOf('app-bg-phone') !== -1);
    assert.ok(phonePlate.beforeSize.indexOf('135%') !== -1, phonePlate.beforeSize);
    assert.ok(phonePlate.beforePos.indexOf('50% 0%') !== -1, phonePlate.beforePos);
    var secondCopy = await page.evaluate(function () {
      var block = document.querySelectorAll('.landing-feature')[1].querySelector('.landing-copy');
      var box = block.getBoundingClientRect();
      return { top: box.top + window.scrollY, bottom: box.bottom + window.scrollY };
    });
    assert.ok(secondCopy.bottom < 240 / 100 * 390, 'phone plate covers the second feature text');
    assert.ok(phonePlate.afterTop < secondCopy.bottom - 80, 'blur overlaps the plate under the second feature');
    assert.ok(phonePlate.afterTop < 1000);
    assert.ok(phonePlate.afterReach >= phonePlate.bodyH - 2, 'phone wash reaches the page bottom');
    assert.ok(phonePlate.overflow <= 1);
    await page.setViewport({ width: 768, height: 900, deviceScaleFactor: 1 });
    const midPlate = await page.evaluate(landingPlate);
    assert.strictEqual(midPlate.beforeH, '1120px');
    assert.ok(midPlate.beforeImg.indexOf('app-bg-phone') !== -1);
    assert.strictEqual(midPlate.afterContent, '""');
    assert.strictEqual(midPlate.afterTop, 900);
    assert.ok(1120 - midPlate.afterTop >= 200, 'blur overlaps the clipped plate');
    assert.ok(midPlate.afterReach >= midPlate.bodyH - 2, 'mid-width wash reaches the page bottom');
    assert.ok(midPlate.overflow <= 1);
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
      assert.strictEqual(card.h2Size, '26px');
      assert.strictEqual(card.frameMax, 'none');
      assert.deepStrictEqual(card.edges, deskInset.feats);
      assertCopyBlock(card, i, '16px', 10, '31.2px', '23.2px');
    });
    assert.strictEqual(deskInset.cards[1].top - (deskInset.cards[0].top + deskInset.cards[0].height), 64);
    const deskPlate = await page.evaluate(landingPlate);
    assert.ok(deskPlate.beforeImg.indexOf('app-bg-wide') !== -1, deskPlate.beforeImg);
    assert.strictEqual(deskPlate.afterContent, 'none');
    assert.ok(parseFloat(deskPlate.beforeH) >= deskPlate.bodyH - 2, 'desktop wash covers the page');
    assert.ok(deskPlate.overflow <= 1);
    const deskCue = await page.evaluate(plansCue);
    assert.strictEqual(deskCue.afterFeature, 16);
    assert.strictEqual(deskCue.beforeHeading, 37);
    assert.strictEqual(deskCue.total, 61);
    assert.strictEqual(deskCue.centered, true);
    const deskRows = await page.evaluate(function () {
      function box(el) {
        var r = el.getBoundingClientRect();
        return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width) };
      }
      return Array.prototype.map.call(document.querySelectorAll('.landing-feature'), function (el) {
        return {
          frame: box(el.querySelector('.landing-frame')),
          copy: box(el.querySelector('.landing-copy')),
          head: box(el.querySelector('h2')),
          value: box(el.querySelector('.landing-value'))
        };
      });
    });
    assert.strictEqual(deskRows.length, HEADINGS.length);
    function beside(row) {
      var overlap = Math.min(row.frame.bottom, row.copy.bottom) - Math.max(row.frame.top, row.copy.top);
      assert.ok(overlap > 40, 'photo and copy share a row');
      var midFrame = (row.frame.top + row.frame.bottom) / 2;
      var midCopy = (row.copy.top + row.copy.bottom) / 2;
      assert.ok(Math.abs(midFrame - midCopy) <= 2, 'copy sits with the photo');
      assert.ok(Math.abs(row.frame.width - row.copy.width) <= 1);
    }
    beside(deskRows[0]);
    beside(deskRows[1]);
    assert.ok(deskRows[0].frame.right <= deskRows[0].copy.left);
    assert.strictEqual(deskRows[0].copy.left - deskRows[0].frame.right, 48);
    assert.ok(deskRows[1].copy.right <= deskRows[1].frame.left);
    assert.strictEqual(deskRows[1].frame.left - deskRows[1].copy.right, 48);
    deskRows.forEach(function (row) {
      assert.ok(Math.abs(row.head.left - row.copy.left) <= 1);
      assert.ok(Math.abs(row.value.left - row.copy.left) <= 1);
      assert.ok(row.value.top >= row.head.bottom);
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
    assert.ok(seen.text.indexOf(PLANS_HEADING) !== -1);
    assert.strictEqual(seen.text.indexOf('Choose how you want to train'), -1);
    assert.strictEqual(seen.text.indexOf('Every plan is defined'), -1);
    assert.ok(seen.text.indexOf('Beta pricing for the first 100 members.') !== -1);
    const plansHead = await page.evaluate(function () {
      var mark = document.querySelector('#landing-plans .landing-plans-chevron');
      var title = document.querySelector('#landing-plans h2');
      var beta = document.querySelector('#landing-plans .beta-note');
      var plan = document.querySelector('#landing-plans .plan');
      var mr = mark.getBoundingClientRect();
      var tr = title.getBoundingClientRect();
      var ps = getComputedStyle(plan);
      return {
        title: title.textContent,
        beta: beta.textContent,
        lede: !!document.querySelector('#landing-plans .lede'),
        above: mr.bottom <= tr.top + 1,
        gap: Math.round(tr.top - mr.bottom),
        afterFeature: Math.round(mr.top - document.querySelectorAll('.landing-feature')[1].getBoundingClientRect().bottom),
        total: Math.round(tr.top - document.querySelectorAll('.landing-feature')[1].getBoundingClientRect().bottom),
        centered: Math.abs((mr.left + mr.right) / 2 - (document.getElementById('landing-plans').getBoundingClientRect().left + document.getElementById('landing-plans').getBoundingClientRect().right) / 2) <= 1,
        markW: Math.round(mr.width),
        markH: Math.round(mr.height),
        planBg: ps.backgroundColor,
        planRadius: ps.borderRadius
      };
    });
    assert.strictEqual(plansHead.title, PLANS_HEADING);
    assert.strictEqual(plansHead.beta, 'Beta pricing for the first 100 members.');
    assert.strictEqual(plansHead.lede, false);
    assert.strictEqual(plansHead.above, true);
    assert.strictEqual(plansHead.afterFeature, 16);
    assert.strictEqual(plansHead.gap, 21);
    assert.strictEqual(plansHead.total, 45);
    assert.strictEqual(plansHead.centered, true);
    assert.strictEqual(plansHead.markW, 12);
    assert.strictEqual(plansHead.markH, 8);
    assert.strictEqual(plansHead.planBg, 'rgb(255, 255, 255)');
    assert.strictEqual(plansHead.planRadius, '14px');
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
      return (location.hash === '' || location.hash === '#') && landing && getComputedStyle(landing).display !== 'none' && document.body.innerText.indexOf('Simple Plans for Every Coach') !== -1 && !document.querySelector('[data-a=new]');
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
    assert.strictEqual(await signedIn.evaluate(function () {
      return getComputedStyle(document.body, '::after').content;
    }), 'none');
    assert.strictEqual(await signedIn.evaluate(function () {
      return getComputedStyle(document.body, '::before').backgroundImage;
    }), 'none');

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
