// Stopwatch media window is the clock only. Uploaded photos stay on the carousel.
// node tests/stopwatch-media.test.js [url]
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const M = require('../model.js');
const pp = require('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-sw-media-'));
const jpegPath = path.join(tmp, 'photo.jpg');
const gifPath = path.join(tmp, 'demo.gif');
function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error'].concat(args), { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || 'ffmpeg failed');
}
ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x1D4E89:s=80x96:d=1', '-frames:v', '1', jpegPath]);
ffmpeg(['-f', 'lavfi', '-i', 'testsrc=s=32x32:r=2', '-frames:v', '2', gifPath]);
const jpeg = fs.readFileSync(jpegPath);
const gif = fs.readFileSync(gifPath);

const mk = o => M.normalizeExercise(M.newExercise(o));
const w = M.newWorkout('Stopwatch media');
w.items = [
  mk({ name: 'Cone shuttle', sets: 2, weight: { unit: 'bodyweight', value: null }, mode: 'stopwatch', modeConfig: { lapsEnabled: true, lapCount: 2 }, media: { kind: 'custom', imageKey: 'img_shuttle' } }),
  mk({ name: 'Library sprint', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'stopwatch', modeConfig: { lapsEnabled: false }, media: { kind: 'library', libraryId: '0007', view: '180' } }),
  mk({ name: 'Plain clock', sets: 1, weight: { unit: 'bodyweight', value: null }, mode: 'stopwatch', modeConfig: { lapsEnabled: true, lapCount: 1 } }),
  mk({ name: 'Photo curl', sets: 1, weight: { unit: 'lb', value: 20 }, mode: 'reps', modeConfig: { repsType: 'number', count: 6, restSec: 0 }, media: { kind: 'custom', imageKey: 'img_shuttle' } })
];
const data = M.emptyData();
data.workouts.push(w);

(async () => {
  const b = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  await p.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await require('./allow.js')(p);
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  await p.setRequestInterception(true);
  p.on('request', req => {
    const u = req.url();
    if (u.endsWith('/still2/0007.jpg')) return req.respond({ status: 200, contentType: 'image/jpeg', body: jpeg });
    if (u.endsWith('/180/0007.gif')) return req.respond({ status: 200, contentType: 'image/gif', body: gif });
    return req.continue();
  });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const click = async s => { await p.click(s); await wait(80); };
  const screenMedia = () => p.evaluate(() => {
    const screen = document.querySelector('.pl-screen');
    const media = screen && screen.querySelector('.pl-media');
    const imgs = screen ? screen.querySelectorAll('img') : [];
    return {
      media: !!media,
      images: imgs.length,
      html: screen ? screen.innerHTML : '',
      time: (document.querySelector('.pl-ro') || {}).textContent || '',
      go: (document.querySelector('.pl-go') || {}).textContent || '',
      tile: (document.querySelector('.pl-ci.cur .pl-frame') || {}).innerHTML || ''
    };
  });
  await p.goto(URL);
  await p.evaluate(b64 => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return WBMedia.put('img_shuttle', new Blob([bytes], { type: 'image/jpeg' }));
  }, jpeg.toString('base64'));
  await p.evaluate((k, v) => localStorage.setItem(k, v), M.STORAGE_KEY, JSON.stringify(data));
  await p.goto(URL + '#/w/' + w.id);
  await p.reload();
  await p.waitForSelector('[data-a=play]');
  await p.evaluate(() => { WBAuth.gifBase = 'https://cdn.example.test/exercises'; });
  await click('[data-a=play]');
  await p.waitForSelector('.pl-go');
  await p.waitForFunction(() => {
    const tile = document.querySelector('.pl-ci.cur img');
    return tile && tile.complete && tile.naturalWidth > 0 && tile.src.indexOf('blob:') === 0;
  });

  let view = await screenMedia();
  assert.strictEqual(view.media, false);
  assert.strictEqual(view.images, 0);
  assert.ok(!/img|svg|media-note|pl-media|Exercise media/i.test(view.html), view.html);
  assert.strictEqual(view.time, '00:00.00');
  assert.strictEqual(view.go, 'Start');
  assert.ok(view.tile.includes('blob:'), view.tile);
  assert.strictEqual(await p.$eval('.pl-ci.cur span', e => e.textContent), 'Attempt 1/2');
  const otherTile = await p.evaluate(() => {
    const tile = [...document.querySelectorAll('.pl-ci')].find(e => e.getAttribute('aria-label') === 'Photo curl');
    const img = tile && tile.querySelector('img');
    return img ? img.getAttribute('src') : '';
  });
  assert.ok(otherTile.indexOf('blob:') === 0, otherTile);

  await click('.pl-go');
  view = await screenMedia();
  assert.strictEqual(view.go, 'Lap 1 / 2');
  assert.strictEqual(view.media, false);
  assert.strictEqual(view.images, 0);
  assert.ok(/^\d\d:\d\d\.\d\d$/.test(view.time), view.time);
  await p.evaluate(ms => { window.__wbClockOffset = (window.__wbClockOffset || 0) + ms; }, 1500);
  await wait(120);
  const moved = (await screenMedia()).time;
  assert.notStrictEqual(moved, '00:00.00');
  await click('.pl-go');
  view = await screenMedia();
  assert.strictEqual(view.go, 'Lap 2 / 2');
  assert.strictEqual(view.media, false);
  assert.ok((await p.$eval('.pl-laps', e => e.textContent)).includes('Lap 1'));

  await click('[aria-label="Library sprint"]');
  await p.waitForFunction(() => {
    const tile = document.querySelector('.pl-ci.cur img');
    return tile && tile.complete && tile.naturalWidth > 0;
  });
  view = await screenMedia();
  assert.strictEqual(await p.$eval('.pl-go', e => e.textContent), 'Start');
  assert.strictEqual(view.media, false);
  assert.strictEqual(view.images, 0);
  assert.ok(!/gif|svg|Exercise media/i.test(view.html), view.html);
  assert.ok(view.tile.includes('/still2/0007.jpg'), view.tile);

  await click('[aria-label="Plain clock"]');
  view = await screenMedia();
  assert.strictEqual(view.media, false);
  assert.strictEqual(view.images, 0);
  assert.ok(!/Exercise media coming soon|svg|pl-media/i.test(view.html), view.html);
  assert.strictEqual(await p.$eval('.pl-ci.cur .pl-miss', e => e.textContent), 'No media available');
  assert.strictEqual(view.time, '00:00.00');

  await click('[aria-label="Photo curl"]');
  await p.waitForFunction(() => {
    const img = document.querySelector('.pl-media img');
    return img && img.complete && img.naturalWidth > 0 && img.src.indexOf('blob:') === 0;
  });
  assert.ok(await p.$('.pl-media img'));
  assert.strictEqual(await p.$('.pl-go'), null);
  assert.ok(await p.$('.pl-screen[data-p=primary]'));

  assert.deepStrictEqual(errs, []);
  console.log('STOPWATCH MEDIA OK');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
