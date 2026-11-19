// node tests/make-stills.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const stills = require('../scripts/make-stills.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-stills-'));
const gifDir = path.join(root, '180');
const outDir = path.join(root, 'still');
fs.mkdirSync(gifDir);

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error'].concat(args), { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || 'ffmpeg failed');
}
function png(name, lavfi) {
  const dest = path.join(root, name);
  ffmpeg(['-f', 'lavfi', '-i', lavfi, '-frames:v', '1', dest]);
  return dest;
}
function gifFrom(dest, pngs) {
  const args = [];
  pngs.forEach(function (p) { args.push('-loop', '1', '-t', '0.4', '-i', p); });
  const chain = pngs.map(function (_, i) { return '[' + i + ':v]'; }).join('') + 'concat=n=' + pngs.length + ':v=1:a=0,fps=2';
  args.push('-filter_complex', chain, dest);
  ffmpeg(args);
}
function gifFrames(dest, pngs) {
  const args = [];
  pngs.forEach(function (p) { args.push('-loop', '1', '-t', '0.5', '-i', p); });
  const chain = pngs.map(function (_, i) { return '[' + i + ':v]'; }).join('') + 'concat=n=' + pngs.length + ':v=1:a=0,fps=2';
  args.push('-filter_complex', chain, '-loop', '0', dest);
  ffmpeg(args);
}
// Graphic-control delays are centiseconds. Tests set them after ffmpeg writes the frames.
function setDelays(file, delaysMs) {
  const buf = fs.readFileSync(file);
  let i = 13;
  const packed = buf[10];
  const gct = (packed & 0x80) ? 3 * (1 << ((packed & 7) + 1)) : 0;
  i = 13 + gct;
  const gce = [];
  while (i < buf.length) {
    if (buf[i] === 0x3B) break;
    if (buf[i] === 0x21 && buf[i + 1] === 0xF9 && buf[i + 2] === 4) {
      gce.push(i);
      i += 8;
      continue;
    }
    if (buf[i] === 0x21) {
      i += 2;
      while (i < buf.length) {
        const sz = buf[i++];
        if (!sz) break;
        i += sz;
      }
      continue;
    }
    if (buf[i] === 0x2C) {
      const ip = buf[i + 9];
      const lct = (ip & 0x80) ? 3 * (1 << ((ip & 7) + 1)) : 0;
      i += 10 + lct + 1;
      while (i < buf.length) {
        const n = buf[i++];
        if (!n) break;
        i += n;
      }
      continue;
    }
    throw new Error('bad gif block at ' + i);
  }
  assert.strictEqual(gce.length, delaysMs.length, file + ' frames ' + gce.length);
  delaysMs.forEach(function (ms, idx) {
    const cs = Math.round(ms / 10);
    buf[gce[idx] + 4] = cs & 255;
    buf[gce[idx] + 5] = (cs >> 8) & 255;
  });
  fs.writeFileSync(file, buf);
}
function stddev(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 8 * 1024 * 1024 });
  const buf = r.stdout;
  assert.ok(buf && buf.length >= 24 * 24 * 3, file);
  let sum = 0, sum2 = 0, n = 0;
  for (let i = 0; i < buf.length; i += 3) {
    const y = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
    sum += y; sum2 += y * y; n++;
  }
  const mean = sum / n;
  return { mean: mean, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) };
}
function widthOf(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return parseInt(String(r.stdout).trim(), 10);
}

const white = png('white.png', 'color=c=white:s=96x96:r=1');
const pattern = png('pattern.png', 'testsrc=s=96x96:r=1');
const bars = png('bars.png', 'smptebars=s=96x96:r=1');
const rgb = png('rgb.png', 'rgbtestsrc=s=96x96:r=1');
gifFrom(path.join(gifDir, 'blank.gif'), [white, pattern]);
gifFrom(path.join(gifDir, 'drawn.gif'), [pattern, white]);
// First hold, a short frame, a later hold, then a short tail. The later hold wins.
gifFrames(path.join(gifDir, 'held.gif'), [pattern, bars, rgb, pattern]);
setDelays(path.join(gifDir, 'held.gif'), [1000, 100, 500, 100]);
// Nothing is held for 400ms except a blank frame, so the last drawn frame is used.
gifFrames(path.join(gifDir, 'short.gif'), [pattern, bars, white]);
setDelays(path.join(gifDir, 'short.gif'), [100, 200, 800]);
gifFrames(path.join(gifDir, 'empty.gif'), [white, white]);
setDelays(path.join(gifDir, 'empty.gif'), [100, 800]);
fs.writeFileSync(path.join(gifDir, '../not a gif.txt'), 'nope');
fs.writeFileSync(path.join(gifDir, 'bad id.gif'), 'nope');

assert.strictEqual(stills.chooseFrame(path.join(gifDir, 'blank.gif')), 1);
assert.strictEqual(stills.chooseFrame(path.join(gifDir, 'drawn.gif')), 0);
assert.strictEqual(stills.chooseFrame(path.join(gifDir, 'held.gif')), 2);
assert.strictEqual(stills.chooseFrame(path.join(gifDir, 'short.gif')), 1);
assert.strictEqual(stills.chooseFrame(path.join(gifDir, 'empty.gif')), 0);

const cli = spawnSync(process.execPath, [path.join(__dirname, '../scripts/make-stills.js'), gifDir, outDir], { encoding: 'utf8' });
assert.strictEqual(cli.status, 0, cli.stderr + cli.stdout);
assert.ok(cli.stdout.includes('frame 1  blank.jpg'), cli.stdout);
assert.ok(cli.stdout.includes('frame 0  drawn.jpg'), cli.stdout);
assert.ok(cli.stdout.includes('frame 2  held.jpg'), cli.stdout);
assert.ok(cli.stdout.includes('frame 1  short.jpg'), cli.stdout);
assert.ok(cli.stdout.includes('frame 0  empty.jpg'), cli.stdout);
assert.ok(cli.stdout.includes('skipped 1'), cli.stdout);
assert.ok(cli.stdout.includes(outDir));

const blankOut = stddev(path.join(outDir, 'blank.jpg'));
const drawnOut = stddev(path.join(outDir, 'drawn.jpg'));
const shortOut = stddev(path.join(outDir, 'short.jpg'));
const emptyOut = stddev(path.join(outDir, 'empty.jpg'));
assert.ok(blankOut.std > 15, JSON.stringify(blankOut)); // last held frame, not the white first frame
assert.ok(drawnOut.std > 15, JSON.stringify(drawnOut)); // held drawn frame, not the white frame after it
assert.ok(shortOut.std > 15, JSON.stringify(shortOut)); // last drawn frame, not the long white frame
assert.ok(emptyOut.std < 10, JSON.stringify(emptyOut)); // only blank frames, so frame 0
assert.strictEqual(widthOf(path.join(outDir, 'blank.jpg')), 180);
assert.strictEqual(widthOf(path.join(outDir, 'drawn.jpg')), 180);
assert.strictEqual(widthOf(path.join(outDir, 'held.jpg')), 180);
assert.strictEqual(fs.existsSync(path.join(outDir, 'bad id.jpg')), false);

const defCli = spawnSync(process.execPath, [path.join(__dirname, '../scripts/make-stills.js'), gifDir], { encoding: 'utf8' });
assert.strictEqual(defCli.status, 0, defCli.stderr + defCli.stdout);
const defDir = path.join(root, 'still2');
assert.ok(defCli.stdout.includes(defDir), defCli.stdout);
assert.ok(fs.existsSync(path.join(defDir, 'held.jpg')));
assert.strictEqual(widthOf(path.join(defDir, 'held.jpg')), 180);
console.log('STILLS OK');
