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
gifFrom(path.join(gifDir, 'blank.gif'), [white, pattern]);
gifFrom(path.join(gifDir, 'drawn.gif'), [pattern, white]);
fs.writeFileSync(path.join(gifDir, '../not a gif.txt'), 'nope');
fs.writeFileSync(path.join(gifDir, 'bad id.gif'), 'nope');

assert.strictEqual(stills.chooseFrame(path.join(gifDir, 'blank.gif')), 1);
assert.strictEqual(stills.chooseFrame(path.join(gifDir, 'drawn.gif')), 0);

const cli = spawnSync(process.execPath, [path.join(__dirname, '../scripts/make-stills.js'), gifDir, outDir], { encoding: 'utf8' });
assert.strictEqual(cli.status, 0, cli.stderr + cli.stdout);
assert.ok(cli.stdout.includes('frame 1  blank.jpg'), cli.stdout);
assert.ok(cli.stdout.includes('frame 0  drawn.jpg'), cli.stdout);
assert.ok(cli.stdout.includes('skipped 1'), cli.stdout);
assert.ok(cli.stdout.includes(outDir));

const blankOut = stddev(path.join(outDir, 'blank.jpg'));
const drawnOut = stddev(path.join(outDir, 'drawn.jpg'));
assert.ok(blankOut.std > 15, JSON.stringify(blankOut)); // middle frame, not the white first frame
assert.ok(drawnOut.std > 15, JSON.stringify(drawnOut)); // first frame kept
assert.strictEqual(widthOf(path.join(outDir, 'blank.jpg')), 180);
assert.strictEqual(widthOf(path.join(outDir, 'drawn.jpg')), 180);
assert.strictEqual(fs.existsSync(path.join(outDir, 'bad id.jpg')), false);
console.log('STILLS OK');
