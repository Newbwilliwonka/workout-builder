// Carousel tiles: stills, custom photos, fallback text, Up next. node tests/player-carousel.test.js [url]
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const M = require('../model.js');
const pp = require('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-car-'));
function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error'].concat(args), { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || 'ffmpeg failed');
}
const jpegPath = path.join(tmp, 'tile.jpg');
const gifPath = path.join(tmp, 'tile.gif');
ffmpeg(['-f', 'lavfi', '-i', 'testsrc=s=48x48:r=1', '-frames:v', '1', jpegPath]);
ffmpeg(['-f', 'lavfi', '-i', 'testsrc=s=32x32:r=2', '-frames:v', '2', gifPath]);
const jpeg = fs.readFileSync(jpegPath);
const gif = fs.readFileSync(gifPath);

const w = M.newWorkout('Carousel');
const mk = o => M.normalizeExercise(M.newExercise(o));
w.items = [
  mk({ name: 'Squat', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 12 }, media: { kind: 'library', libraryId: '0001', view: '180' } }),
  mk({ name: 'Broken demo', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'reps', modeConfig: { repsType: 'number', count: 5, restSec: 0 }, media: { kind: 'library', libraryId: 'miss', view: '360' } }),
  mk({ name: 'Photo curl', sets: 1, weight: { unit: 'lb', value: 20 }, mode: 'reps', modeConfig: { repsType: 'number', count: 6, restSec: 8 }, media: { kind: 'custom', imageKey: 'img_tile' } }),
  mk({ name: 'Plain press', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'reps', modeConfig: { repsType: 'number', count: 4, restSec: 8 } }),
  mk({ name: 'Bike', sets: 2, weight: { unit: 'bodyweight', value: null }, mode: 'intervals', modeConfig: { workSec: 8, repsType: null } }),
];
M.linkSuperset(w, [w.items[2].id, w.items[3].id]);
const data = M.emptyData();
data.workouts.push(w);

(async () => {
  const b = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await require('./allow.js')(p);
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.setRequestInterception(true);
  p.on('request', req => {
    const u = req.url();
    if (u.endsWith('/still2/0001.jpg')) return req.respond({ status: 200, contentType: 'image/jpeg', body: jpeg });
    if (u.endsWith('/still2/miss.jpg')) return req.respond({ status: 404, contentType: 'text/plain', body: 'no' });
    if (u.endsWith('/180/0001.gif') || u.endsWith('/180/miss.gif') || u.endsWith('/360/miss.gif')) return req.respond({ status: 200, contentType: 'image/gif', body: gif });
    return req.continue();
  });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const click = async s => { await p.click(s); await wait(80); };
  await p.goto(URL);
  await p.evaluate(b64 => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return WBMedia.put('img_tile', new Blob([bytes], { type: 'image/jpeg' }));
  }, jpeg.toString('base64'));
  await p.evaluate((k, v) => localStorage.setItem(k, v), M.STORAGE_KEY, JSON.stringify(data));
  await p.goto(URL + '#/w/' + w.id);
  await p.reload();
  await p.waitForSelector('[data-a=play]');
  assert.strictEqual(await p.evaluate(() => WBMedia.peek('img_tile')), '');
  await p.evaluate(() => { WBAuth.gifBase = 'https://cdn.example.test/exercises'; });
  await click('[data-a=play]');
  await p.waitForFunction(() => {
    const cur = document.querySelector('.pl-ci.cur img');
    const main = document.querySelector('.pl-media img');
    return cur && main && cur.complete && cur.naturalWidth > 0 && main.complete && main.naturalWidth > 0;
  });
  assert.strictEqual(await p.$eval('.pl-media img', e => e.getAttribute('src')), 'https://cdn.example.test/exercises/180/0001.gif');
  assert.strictEqual(await p.$eval('.pl-ci.cur img', e => e.getAttribute('src')), 'https://cdn.example.test/exercises/still2/0001.jpg');
  assert.strictEqual(await p.$eval('.pl-info .pl-name', e => e.textContent), 'Squat');
  assert.strictEqual(await p.$$eval('.pl-ci b', a => a.length), 0);
  const tiles = () => p.$$eval('.pl-ci', a => a.map(e => ({
    label: e.getAttribute('aria-label'),
    set: e.querySelector('span') && e.querySelector('span').textContent,
    nameInText: (e.textContent || '').includes(e.getAttribute('aria-label') || '\u0000'),
    miss: e.querySelector('.pl-miss') ? e.querySelector('.pl-miss').textContent : '',
    up: e.querySelector('.pl-upnext') ? e.querySelector('.pl-upnext').textContent : '',
    img: e.querySelector('img') ? e.querySelector('img').getAttribute('src') : ''
  })));
  let t = await tiles();
  assert.deepStrictEqual(t.map(x => x.label), ['Squat', 'Broken demo', 'Photo curl', 'Plain press', 'Bike', 'Bike']);
  assert.deepStrictEqual(t.map(x => x.set), ['Set 1/1', 'Set 1/1', 'Set 1/1', 'Set 1/1', 'Interval 1/2', 'Interval 2/2']);
  assert.ok(t.every(x => !x.nameInText));
  assert.deepStrictEqual(t.map(x => x.up), ['', '', '', '', '', '']);
  await p.waitForFunction(() => {
    const broken = [...document.querySelectorAll('.pl-ci')].find(e => e.getAttribute('aria-label') === 'Broken demo');
    return broken && !broken.querySelector('img') && broken.querySelector('.pl-miss') && broken.querySelector('.pl-miss').textContent === 'No media available';
  });
  const fit = await p.evaluate(() => {
    const tile = document.querySelector('.pl-ci.cur');
    const img = tile.querySelector('img');
    const set = tile.querySelector('span');
    const tb = tile.getBoundingClientRect();
    const ib = img.getBoundingClientRect();
    const sb = set.getBoundingClientRect();
    const cs = getComputedStyle(img);
    return {
      cover: cs.objectFit,
      radius: cs.borderRadius,
      fills: ib.width >= tb.width - 2 && ib.height >= tb.height - 2,
      setAtBottom: Math.abs(sb.bottom - tb.bottom) <= 6,
      ring: getComputedStyle(tile, '::after').boxShadow
    };
  });
  assert.strictEqual(fit.cover, 'cover');
  assert.ok(fit.fills, JSON.stringify(fit));
  assert.ok(fit.setAtBottom, JSON.stringify(fit));
  assert.ok(/rgb\(56, 189, 248\)/.test(fit.ring), fit.ring);

  await click('[data-p=primary]');
  t = await tiles();
  assert.deepStrictEqual(t.map(x => x.up), ['', 'Up next', '', '', '', '']);
  assert.strictEqual(await p.$eval('.pl-info .pl-name', e => e.textContent), 'Broken demo');

  await click('[data-sel="1"]');
  assert.strictEqual(await p.$eval('.pl-media img', e => e.getAttribute('src')), 'https://cdn.example.test/exercises/360/miss.gif');
  assert.strictEqual(await p.$eval('.pl-ci.cur .pl-miss', e => e.textContent), 'No media available');
  assert.strictEqual(await p.$('.pl-upnext'), null);

  await click('[data-sel="2"]');
  await p.waitForFunction(() => {
    const img = document.querySelector('.pl-ci.cur img');
    return img && img.complete && img.naturalWidth > 0 && img.src.indexOf('blob:') === 0;
  });
  t = await tiles();
  assert.strictEqual(t[3].up, 'Up next'); // next exercise in this superset round
  assert.strictEqual(t[3].miss, 'No media available');
  await click('[data-sel="0"]');
  await click('[data-sel="2"]');
  const warm = await p.$eval('.pl-ci.cur .pl-frame', e => e.innerHTML);
  assert.ok(warm.includes('blob:'), warm);
  assert.ok(!warm.includes('data-local-img'), warm);

  await click('[data-sel="3"]');
  assert.strictEqual(await p.$('.pl-upnext'), null); // end of the superset round
  assert.ok((await p.$eval('.pl-media', e => e.textContent)).includes('Exercise media coming soon'));
  assert.strictEqual(await p.$eval('.pl-ci.cur .pl-miss', e => e.textContent), 'No media available');
  assert.strictEqual(await p.$eval('.pl-info .pl-name', e => e.textContent), 'Plain press');

  await click('[data-sel="4"]');
  t = await tiles();
  assert.deepStrictEqual(t.map(x => x.up), ['', '', '', '', '', 'Up next']);
  await click('[data-sel="5"]');
  assert.strictEqual(await p.$('.pl-upnext'), null); // last interval does not mark the missing successor
  const scrolled = await p.evaluate(() => {
    const car = document.querySelector('.pl-car');
    const cu = car.querySelector('.cur');
    const stage = document.querySelector('.pl-stage');
    const main = document.querySelector('.pl-main');
    const cb = car.getBoundingClientRect();
    const ub = cu.getBoundingClientRect();
    return {
      top: +(ub.top - cb.top).toFixed(1),
      bottomGap: +(cb.bottom - ub.bottom).toFixed(1),
      scroll: car.scrollTop,
      carH: +cb.height.toFixed(1),
      stageH: +stage.getBoundingClientRect().height.toFixed(1),
      mainH: +main.getBoundingClientRect().height.toFixed(1)
    };
  });
  assert.ok(scrolled.scroll > 0, JSON.stringify(scrolled)); // last tile is brought back into the scrolling strip
  assert.ok(scrolled.top >= -1 && scrolled.bottomGap >= -1, JSON.stringify(scrolled));
  assert.ok(Math.abs(scrolled.carH - scrolled.mainH) < 2, JSON.stringify(scrolled));
  assert.deepStrictEqual(errs, []);
  console.log('CAROUSEL OK');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
