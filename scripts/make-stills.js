#!/usr/bin/env node
'use strict';
// Still JPEG for each library GIF. Does not upload anywhere.
//
//   node scripts/make-stills.js <gif-dir> [out-dir]
//
// gif-dir is the 180/ folder of {id}.gif files (the same ids the player loads
// from {EXERCISE_GIF_BASE}/180/{id}.gif). out-dir defaults to the sibling
// still2/ folder, which is where exerciseStillUrl() looks:
// {EXERCISE_GIF_BASE}/still2/{id}.jpg.
//
// Each still is 180px wide. ffmpeg -q:v 5 is about JPEG quality 80.
// The frame used is the last one held at least 400ms that is not blank.
// If no frame qualifies, the last non-blank frame is used, then frame 0.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const WIDTH = 180;
const QSCALE = '5';
const HOLD_MS = 400;

function run(cmd, args) {
  const r = spawnSync(cmd, args, { maxBuffer: 8 * 1024 * 1024 });
  if (r.error) throw r.error;
  return r;
}

function mustTool(cmd) {
  const r = spawnSync(cmd, ['-version'], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(cmd + ' is required but was not found.');
    process.exit(1);
  }
}

function frameCount(file) {
  let r = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=nb_frames', '-of', 'csv=p=0', file]);
  let n = parseInt(String(r.stdout || '').trim(), 10);
  if (!Number.isFinite(n) || n < 1) {
    r = run('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file]);
    n = parseInt(String(r.stdout || '').trim(), 10);
  }
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function sample(file, index) {
  const r = run('ffmpeg', [
    '-v', 'error', '-i', file,
    '-vf', 'select=eq(n\\,' + index + '),scale=24:24,format=rgb24',
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'
  ]);
  return r.stdout;
}

// A blank frame is a flat field (empty, solid white, or solid black).
function isBlank(buf) {
  if (!buf || buf.length < 24 * 24 * 3) return true;
  var sum = 0, sum2 = 0, n = 0, i, y;
  for (i = 0; i < buf.length; i += 3) {
    y = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
    sum += y;
    sum2 += y * y;
    n++;
  }
  var mean = sum / n;
  var variance = sum2 / n - mean * mean;
  return Math.sqrt(Math.max(0, variance)) < 10;
}

// One entry per decoded frame, in milliseconds. Empty when the probe fails.
function frameDelays(file) {
  var r = run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'frame=pkt_duration_time',
    '-of', 'csv=p=0', file
  ]);
  var text = String(r.stdout || '').trim();
  if (!text) return [];
  return text.split(/\r?\n/).map(function (line) {
    var sec = parseFloat(line);
    return Number.isFinite(sec) ? Math.round(sec * 1000) : 0;
  });
}

// Last long-held non-blank frame. A hold is a frame delay of at least 400ms.
// Fallback: the last non-blank frame, then frame 0.
function chooseFrame(file) {
  var delays = frameDelays(file);
  var n = delays.length || frameCount(file);
  var lastDrawn = -1;
  var i;
  for (i = n - 1; i >= 0; i--) {
    if (isBlank(sample(file, i))) continue;
    if (lastDrawn < 0) lastDrawn = i;
    if ((delays[i] || 0) >= HOLD_MS) return i;
  }
  return lastDrawn >= 0 ? lastDrawn : 0;
}

function writeStill(file, index, dest) {
  var r = run('ffmpeg', [
    '-v', 'error', '-y', '-i', file,
    '-vf', 'select=eq(n\\,' + index + '),scale=' + WIDTH + ':-2:flags=lanczos',
    '-frames:v', '1', '-q:v', QSCALE, dest
  ]);
  if (r.status !== 0) {
    var err = r.stderr && r.stderr.toString();
    throw new Error((err || 'ffmpeg failed').trim());
  }
}

function main() {
  var gifDir = process.argv[2];
  if (!gifDir || gifDir === '-h' || gifDir === '--help') {
    console.log('Usage: node scripts/make-stills.js <gif-dir> [out-dir]');
    console.log('Writes {id}.jpg for each {id}.gif. out-dir defaults to <gif-dir>/../still2.');
    console.log('Output is local only. Nothing is uploaded.');
    process.exit(gifDir ? 0 : 1);
  }
  mustTool('ffmpeg');
  mustTool('ffprobe');
  var absGif = path.resolve(gifDir);
  if (!fs.existsSync(absGif) || !fs.statSync(absGif).isDirectory()) {
    console.error('GIF folder not found: ' + absGif);
    process.exit(1);
  }
  var outDir = path.resolve(process.argv[3] || path.join(absGif, '..', 'still2'));
  fs.mkdirSync(outDir, { recursive: true });
  var names = fs.readdirSync(absGif).filter(function (n) { return /\.gif$/i.test(n); }).sort();
  if (!names.length) {
    console.error('No GIF files in ' + absGif);
    process.exit(1);
  }
  var wrote = 0, later = 0, skipped = 0, failed = 0;
  names.forEach(function (name) {
    var id = name.replace(/\.gif$/i, '');
    if (!ID_RE.test(id)) {
      skipped++;
      console.error('skip ' + name + ' (id is not 1-32 letters, digits, _ or -)');
      return;
    }
    var src = path.join(absGif, name);
    var dest = path.join(outDir, id + '.jpg');
    try {
      var frame = chooseFrame(src);
      if (frame !== 0) later++;
      writeStill(src, frame, dest);
      wrote++;
      console.log((frame === 0 ? 'frame 0' : 'frame ' + frame) + '  ' + id + '.jpg');
    } catch (e) {
      failed++;
      console.error('fail ' + name + ': ' + (e && e.message ? e.message : e));
    }
  });
  console.log('Wrote ' + wrote + ' stills to ' + outDir +
    (later ? ' (' + later + ' used a later frame)' : '') +
    (skipped ? ', skipped ' + skipped : '') +
    (failed ? ', failed ' + failed : ''));
  if (failed) process.exit(1);
}

if (require.main === module) main();
module.exports = { isBlank: isBlank, chooseFrame: chooseFrame, frameCount: frameCount, ID_RE: ID_RE };
