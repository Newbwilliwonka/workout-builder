/* Programs preview. Sample pictures only: no storage, no network, no real workouts. */
(function () {
  'use strict';
  var SAMPLE_TODAY = '2026-11-11';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var ROLES = [
    ['trainer', 'Trainer'],
    ['client', 'Free Client'],
    ['enthusiast', 'Enthusiast'],
    ['trainer-share-on', 'Trainer · sharing on'],
    ['trainer-share-off', 'Trainer · sharing off']
  ];
  var CLIENTS = [
    { id: 'ada', name: 'Sample client: Ada Cole', plan: 'Free Client', share: null },
    { id: 'jordan', name: 'Sample client: Jordan Hale', plan: 'Enthusiast', share: true },
    { id: 'sam', name: 'Sample client: Sam Ortiz', plan: 'Enthusiast', share: false }
  ];
  var WORKOUTS = [
    { id: 'push', name: 'Sample: Push day', exercises: ['Sample: Bench press', 'Sample: Overhead press', 'Sample: Push-up'] },
    { id: 'run', name: 'Sample: Easy run', exercises: ['Sample: Easy jog', 'Sample: Stride', 'Sample: Walk'] },
    { id: 'core', name: 'Sample: Core finisher', exercises: ['Sample: Dead bug', 'Sample: Side plank'] },
    { id: 'mob', name: 'Sample: Mobility', exercises: ['Sample: Hip opener', 'Sample: Thoracic rotation'] }
  ];
  var SEED = [
    { id: 'p1', workoutId: 'push', date: '2026-11-09', presence: 'trainer', done: true },
    { id: 'p2', workoutId: 'run', date: '2026-11-10', presence: 'solo', done: true },
    { id: 'p3', workoutId: 'core', date: '2026-11-11', presence: 'trainer', done: false },
    { id: 'p4', workoutId: 'push', date: '2026-11-13', presence: 'solo', done: false },
    { id: 'p5', workoutId: 'mob', date: '2026-11-15', presence: 'solo', done: false },
    { id: 'p6', workoutId: 'run', date: '2026-11-02', presence: 'solo', done: true },
    { id: 'p7', workoutId: 'push', date: '2026-11-04', presence: 'trainer', done: true },
    { id: 'p8', workoutId: 'core', date: '2026-11-06', presence: 'trainer', done: true }
  ];

  var app = null, titleEl = null, backBtn = null, state = null, drag = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDate(value) {
    var p = String(value || '').split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  function weekStart(value) {
    var d = parseDate(value);
    var day = d.getDay();
    var delta = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + delta);
    return d;
  }
  function fresh() {
    return {
      role: 'trainer',
      clientId: 'ada',
      shareOn: true,
      view: 'week',
      cursor: SAMPLE_TODAY,
      month: '2026-11',
      screen: 'home',
      playerMode: 'view',
      focusId: 'push',
      menuOpen: true,
      menuNote: '',
      hint: '',
      seq: 20,
      extra: [],
      schedules: { ada: clone(SEED), jordan: clone(SEED), me: clone(SEED), sam: [] }
    };
  }
  function clientById(id) {
    for (var i = 0; i < CLIENTS.length; i++) if (CLIENTS[i].id === id) return CLIENTS[i];
    return CLIENTS[0];
  }
  function allWorkouts() { return WORKOUTS.concat(state && state.extra || []); }
  function workout(id) {
    var list = allWorkouts();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function ownerKey() {
    if (!state) return 'ada';
    if (state.role === 'enthusiast') return 'me';
    if (state.role === 'client') return 'ada';
    if (state.role === 'trainer-share-on') return 'jordan';
    if (state.role === 'trainer-share-off') return 'sam';
    return state.clientId || 'ada';
  }
  function schedule() {
    var key = ownerKey();
    if (!state.schedules[key]) state.schedules[key] = [];
    return state.schedules[key];
  }
  function hiddenShare() {
    if (!state) return false;
    if (state.role === 'trainer-share-off') return true;
    return state.role === 'trainer' && state.clientId === 'sam';
  }
  function canEdit() {
    if (!state || hiddenShare()) return false;
    return state.role !== 'client';
  }
  // Send is trainers only. An Enthusiast never gets it, sharing on or off.
  function showSend() {
    return !!state && (state.role === 'trainer' || state.role === 'trainer-share-on');
  }
  function showOpen() {
    return !!state && state.role !== 'client' && !hiddenShare();
  }
  function presenceLabel(kind) { return kind === 'trainer' ? 'Trainer present' : 'Solo'; }
  function countLabel(n) { return n + ' exercise' + (n === 1 ? '' : 's'); }
  function ico(kind) {
    var path = kind === 'trainer'
      ? 'M9 11a3 3 0 100-6 3 3 0 000 6zm7 1a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM9 13c-2.8 0-5 1.6-5 3.5V19h10v-2.5C14 14.6 11.8 13 9 13zm7 .5c-.4 0-.8 0-1.2.1 1.3.8 2.2 1.9 2.2 3.2V19h5v-2c0-1.8-2.5-3.5-6-3.5z'
      : 'M12 12a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm0 2c-3.3 0-6 1.8-6 4v2h12v-2c0-2.2-2.7-4-6-4z';
    return '<span class="pv-ico ' + kind + '" title="' + esc(presenceLabel(kind)) + '"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="' + path + '"/></svg></span>';
  }
  function check() { return '<span class="pv-check" aria-label="Completed">✓</span>'; }
  function onDay(date) {
    return schedule().filter(function (s) { return s.date === date; });
  }
  function dayDone(list) {
    return list.length > 0 && list.every(function (s) { return s.done; });
  }
  function clearDrag() {
    if (drag) {
      document.removeEventListener('pointermove', drag.move);
      document.removeEventListener('pointerup', drag.up);
      document.removeEventListener('pointercancel', drag.up);
    }
    drag = null;
    var floatEl = document.getElementById('pv-float');
    if (floatEl) floatEl.remove();
    var nodes = document.querySelectorAll('.pv-over');
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove('pv-over');
  }
  function dropOn(kind, id, date) {
    if (!state || !canEdit() || !date) return;
    var list = schedule();
    if (kind === 'session') {
      var found = null;
      for (var i = 0; i < list.length; i++) if (list[i].id === id) found = list[i];
      if (!found || found.date === date) return;
      found.date = date;
      state.hint = 'Sample move only. Nothing was saved.';
      render();
      return;
    }
    var already = list.some(function (s) { return s.workoutId === id && s.date === date; });
    if (already) {
      state.hint = 'That sample workout is already on this day.';
      render();
      return;
    }
    state.seq += 1;
    list.push({ id: 's' + state.seq, workoutId: id, date: date, presence: 'solo', done: false });
    state.hint = 'Sample schedule only. Nothing was saved.';
    render();
  }
  function beginDrag(e, handle) {
    if (!canEdit() || (e.button != null && e.button !== 0)) return;
    e.preventDefault();
    clearDrag();
    var floatEl = document.createElement('div');
    floatEl.id = 'pv-float';
    floatEl.className = 'pv-float';
    floatEl.textContent = handle.getAttribute('data-label') || 'Workout';
    document.body.appendChild(floatEl);
    function place(ev) {
      if (!drag) return;
      floatEl.style.left = (ev.clientX + 10) + 'px';
      floatEl.style.top = (ev.clientY + 12) + 'px';
      floatEl.style.display = 'none';
      var under = document.elementFromPoint(ev.clientX, ev.clientY);
      floatEl.style.display = '';
      var day = under && under.closest ? under.closest('.pv-day') : null;
      var prev = document.querySelectorAll('.pv-over');
      for (var i = 0; i < prev.length; i++) prev[i].classList.remove('pv-over');
      if (day) day.classList.add('pv-over');
      drag.day = day ? day.getAttribute('data-date') || '' : '';
      if (Math.abs(ev.clientX - drag.x) + Math.abs(ev.clientY - drag.y) > 6) drag.moved = true;
    }
    function up() {
      var info = drag;
      var moved = info && info.moved;
      clearDrag();
      if (!info || !moved) return;
      dropOn(info.kind, info.id, info.day);
    }
    drag = {
      kind: handle.getAttribute('data-drag-kind'),
      id: handle.getAttribute('data-drag'),
      x: e.clientX,
      y: e.clientY,
      day: '',
      moved: false,
      move: place,
      up: up
    };
    document.addEventListener('pointermove', place);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
    try { handle.setPointerCapture(e.pointerId); } catch (err) {}
    place(e);
  }
  function handleHtml(kind, id, label) {
    if (!canEdit()) return '';
    return '<button type="button" class="pv-handle" data-drag="' + esc(id) + '" data-drag-kind="' + kind + '" data-label="' + esc(label) + '" aria-label="Drag ' + esc(label) + '">⋮⋮</button>';
  }
  function legendHtml() {
    return '<div class="pv-legend"><span>' + ico('trainer') + 'Trainer present</span><span>' + ico('solo') + 'Solo</span><span>' + check() + 'Completed</span></div>';
  }
  function sessionHtml(s) {
    var w = workout(s.workoutId);
    var name = w ? w.name : 'Sample workout';
    var kind = s.presence === 'trainer' ? 'trainer' : 'solo';
    return '<div class="card pv-session"><div class="pv-session-top">' + handleHtml('session', s.id, name) + ico(kind) + '</div>' +
      '<button type="button" class="pv-session-open" data-open-session="' + esc(s.id) + '">' +
      '<span class="name">' + esc(name) + '</span><span class="mute">' + esc(presenceLabel(s.presence)) + '</span></button></div>';
  }
  function weekHtml() {
    var start = weekStart(state.cursor);
    var end = new Date(start.getTime());
    end.setDate(start.getDate() + 6);
    var label = start.getMonth() === end.getMonth()
      ? MONTHS[start.getMonth()].slice(0, 3) + ' ' + start.getDate() + ' – ' + end.getDate() + ', ' + start.getFullYear()
      : MONTHS[start.getMonth()].slice(0, 3) + ' ' + start.getDate() + ' – ' + MONTHS[end.getMonth()].slice(0, 3) + ' ' + end.getDate() + ', ' + end.getFullYear();
    var h = '<div class="row pv-nav"><button type="button" class="sm" data-shift="-1" data-unit="week" aria-label="Previous week">‹</button>' +
      '<div class="grow name" id="pv-range">' + esc(label) + '</div>' +
      '<button type="button" class="sm" data-shift="1" data-unit="week" aria-label="Next week">›</button></div>' +
      '<p class="mute pv-swipe">Swipe sideways for all seven days.</p><div class="pv-week">';
    for (var i = 0; i < 7; i++) {
      var d = new Date(start.getTime());
      d.setDate(start.getDate() + i);
      var date = iso(d);
      var items = onDay(date);
      var today = date === SAMPLE_TODAY;
      h += '<div class="pv-day' + (today ? ' today' : '') + '" data-date="' + date + '"><div class="pv-day-h"><div><div class="pv-dow">' + DOWS[i] + '</div><div class="pv-num">' + d.getDate() + (today ? '<span class="mute"> Today</span>' : '') + '</div></div>' +
        (dayDone(items) ? check() : '') + '</div>';
      items.forEach(function (s) { h += sessionHtml(s); });
      if (!items.length && canEdit() && date !== '2026-11-12') h += '<div class="mute pv-drop">Drop here</div>';
      if (canEdit() && date === '2026-11-12') {
        h += '<div class="pv-ghost" id="pv-ghost"><div class="pv-kicker">Sample drag</div><div class="name">Sample: Core finisher</div><div class="mute">Onto Thursday</div></div>';
      }
      h += '</div>';
    }
    return h + '</div>';
  }
  function monthHtml() {
    var parts = state.month.split('-');
    var year = Number(parts[0]), month = Number(parts[1]) - 1;
    var first = new Date(year, month, 1);
    var start = weekStart(iso(first));
    var h = '<div class="row pv-nav"><button type="button" class="sm" data-shift="-1" data-unit="month" aria-label="Previous month">‹</button>' +
      '<div class="grow name" id="pv-range">' + esc(MONTHS[month] + ' ' + year) + '</div>' +
      '<button type="button" class="sm" data-shift="1" data-unit="month" aria-label="Next month">›</button></div>' +
      '<div class="pv-dows">' + DOWS.map(function (d) { return '<div>' + d + '</div>'; }).join('') + '</div><div class="pv-month">';
    for (var i = 0; i < 42; i++) {
      var d = new Date(start.getTime());
      d.setDate(start.getDate() + i);
      var date = iso(d);
      var items = onDay(date);
      var outside = d.getMonth() !== month;
      var names = items.map(function (s) {
        var w = workout(s.workoutId);
        return (w ? w.name : 'Workout') + ', ' + presenceLabel(s.presence);
      });
      var label = DOWS[(d.getDay() + 6) % 7] + ' ' + MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate();
      if (names.length) label += ', ' + names.join('; ');
      if (dayDone(items)) label += ', completed';
      label += '. Opens that week.';
      var kinds = {};
      items.forEach(function (s) { kinds[s.presence === 'trainer' ? 'trainer' : 'solo'] = 1; });
      h += '<button type="button" class="pv-cell' + (outside ? ' is-out' : '') + (items.length ? ' has' : '') + (date === SAMPLE_TODAY ? ' today' : '') + '" data-jump="' + date + '" aria-label="' + esc(label) + '">' +
        '<span class="pv-num">' + d.getDate() + '</span><span class="pv-dots">' +
        (kinds.trainer ? ico('trainer') : '') + (kinds.solo ? ico('solo') : '') + (dayDone(items) ? check() : '') +
        '</span></button>';
      if (i > 27 && d.getMonth() !== month && d.getDay() === 0) break;
    }
    return h + '</div>';
  }
  function buttonHint() {
    if (state.role === 'client') return 'Run tracks in the player. View plays it without tracking.';
    if (state.role === 'enthusiast') return 'Run tracks in the player. View plays it without tracking. Open edits it in the builder.';
    return 'Run tracks in the player. View plays it without tracking. Open edits it in the builder. Send is for trainers.';
  }
  function actionsHtml(w) {
    var id = esc(w.id);
    var h = '<div class="actions"><button type="button" class="pri sm" data-run="' + id + '">Run</button>' +
      '<button type="button" class="sm" data-view-wo="' + id + '">View</button>';
    if (showOpen()) h += '<button type="button" class="sm" data-open-wo="' + id + '">Open</button>';
    if (showSend()) h += '<button type="button" class="sm" data-send="' + id + '">Send</button>';
    return h + '</div>';
  }
  function workoutsHtml() {
    var h = '<h2 class="pv-h">Workouts</h2><p class="mute">Standalone workouts. They become a Program once they are on the calendar.</p>' +
      '<p class="mute" id="pv-buttons">' + esc(buttonHint()) + '</p>';
    if (canEdit()) h += '<button type="button" class="pri" id="pv-new" style="width:100%;margin:8px 0">+ New workout</button>';
    allWorkouts().forEach(function (w) {
      h += '<div class="card pv-wo">' + handleHtml('workout', w.id, w.name) +
        '<div class="grow"><div class="name">' + esc(w.name) + '</div>' +
        '<div class="mute">' + countLabel(w.exercises.length) + ' · sample</div>' +
        actionsHtml(w) + '</div></div>';
    });
    return h;
  }
  function whoHtml() {
    if (state.role === 'trainer') {
      var h = '<label for="pv-client">Client</label><select id="pv-client">';
      CLIENTS.forEach(function (c) {
        var extra = c.share === true ? ' · sharing on' : c.share === false ? ' · sharing off' : '';
        h += '<option value="' + c.id + '"' + (c.id === state.clientId ? ' selected' : '') + '>' + esc(c.name + ' · ' + c.plan + extra) + '</option>';
      });
      return h + '</select>';
    }
    var line = 'Your sample program';
    if (state.role === 'client') line = 'Sample program for a Free Client';
    if (state.role === 'trainer-share-on') line = 'Sample client: Jordan Hale · Enthusiast · sharing on';
    if (state.role === 'trainer-share-off') line = 'Sample client: Sam Ortiz · Enthusiast · sharing off';
    return '<p class="mute" id="pv-who">' + esc(line) + '</p>';
  }
  function shareSwitchHtml() {
    var on = state.shareOn;
    return '<div class="card" id="pv-share-card"><div class="row"><button type="button" class="switch' + (on ? ' on' : '') + '" id="pv-share" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" aria-label="Share my workouts and tracking with my trainer"><i></i></button>' +
      '<div class="grow"><div class="name" style="font-size:16px">Share my workouts and tracking with my trainer</div>' +
      '<p class="mute" style="margin:4px 0 0">Sample switch, same choice as on Account. It does not change a real setting.</p></div></div></div>';
  }
  function notesHtml() {
    if (state.role === 'enthusiast') {
      var note = state.shareOn
        ? '<div class="card" id="pv-trainer-edit"><p style="margin:0">Your trainer can also edit this calendar</p></div>'
        : '<div class="card" id="pv-role-note"><p style="margin:0">Sharing is off in this sample. Your trainer cannot see or edit this calendar.</p></div>';
      return shareSwitchHtml() + note;
    }
    if (state.role === 'client') return '<div class="card" id="pv-role-note"><p style="margin:0">Your trainer schedules your program</p></div>';
    if (hiddenShare()) return '';
    if (state.role === 'trainer-share-on' || (state.role === 'trainer' && state.clientId === 'jordan')) {
      return '<div class="card" id="pv-role-note"><p style="margin:0">Sharing is on, so you can drag and schedule workouts on this calendar.</p></div>';
    }
    return '<div class="card" id="pv-role-note"><p style="margin:0">You can drag and move workouts on this client’s calendar.</p></div>';
  }
  function homeHtml() {
    var h = '<div id="pv-root" data-role-now="' + esc(state.role) + '">' +
      '<div class="card pv-banner"><span class="tag">Preview</span><p class="name" style="font-size:16px;margin:8px 0 4px">Sample data only</p>' +
      '<p class="mute" style="margin:0">Workouts are standalone. Programs are workouts scheduled on the calendar. Nothing here is saved.</p></div>' +
      '<div class="mute" id="pv-as">Preview as</div><div class="seg pv-roles" id="pv-roles" role="group" aria-label="Preview as">';
    ROLES.forEach(function (r) {
      h += '<button type="button" data-role="' + r[0] + '" class="' + (state.role === r[0] ? 'on' : '') + '" aria-pressed="' + (state.role === r[0] ? 'true' : 'false') + '">' + esc(r[1]) + '</button>';
    });
    h += '</div>' + whoHtml() + notesHtml();
    if (state.hint) h += '<p class="note" id="pv-hint">' + esc(state.hint) + '</p>';
    if (hiddenShare()) {
      return h + '<div class="card" id="pv-private"><div class="name">Not shared</div><p class="mute">This Enthusiast has turned off sharing. You cannot see or edit their program.</p></div></div>';
    }
    h += '<div class="pv-layout" id="pv-layout"><section class="pv-workouts" id="pv-workouts" aria-label="Workouts">' + workoutsHtml() + '</section>' +
      '<section class="pv-cal" id="pv-cal" aria-label="Programs"><h2 class="pv-h">Programs</h2>' +
      '<p class="mute">A calendar of scheduled workouts. Completed days keep a check, so it also reads as history.</p>' +
      '<div class="seg" id="pv-range-switch" role="group" aria-label="Week or month"><button type="button" data-cal="week" class="' + (state.view === 'week' ? 'on' : '') + '">Week</button>' +
      '<button type="button" data-cal="month" class="' + (state.view === 'month' ? 'on' : '') + '">Month</button></div>' +
      legendHtml() + (state.view === 'month' ? monthHtml() : weekHtml()) + '</section></div></div>';
    return h;
  }
  function playerHtml() {
    var w = workout(state.focusId) || WORKOUTS[0];
    var view = state.playerMode === 'view';
    return '<div id="pv-player"><div class="pv-stage"><div class="pv-ptop"><span class="pl-chip">' + (view ? 'View' : 'Run') + '</span>' +
      (view ? '<span class="tag" id="pv-not-tracked">Preview - not tracked</span>' : '') + '</div>' +
      '<div class="pv-ex">' + esc(w.exercises[0] || w.name) + '</div>' +
      '<p class="pv-stage-note">' + (view
        ? 'View runs this workout in the player without tracking. This is only the header.'
        : 'Run runs this workout in the player with tracking. This preview does not save a session.') + '</p></div>' +
      '<p class="mute">Sample player for ' + esc(w.name) + '.</p></div>';
  }
  function exerciseList(w) {
    if (!w.exercises.length) return '';
    var h = '<ul class="sets">';
    w.exercises.forEach(function (name) { h += '<li>' + esc(name) + '</li>'; });
    return h + '</ul>';
  }
  function openHtml() {
    var w = workout(state.focusId) || WORKOUTS[0];
    return '<div id="pv-open"><p class="mute">Open is the workout builder. Rename, Duplicate, and Delete stay in this menu.</p>' +
      '<div class="card"><div class="name">' + esc(w.name) + '</div><div class="mute">' + countLabel(w.exercises.length) + ' · sample</div>' +
      exerciseList(w) + '</div></div>';
  }
  function dayHtml() {
    var w = workout(state.focusId) || WORKOUTS[0];
    return '<div id="pv-day"><p class="mute">This day’s workout. You can Run or View it. Editing stays with your trainer.</p>' +
      '<div class="card"><div class="name">' + esc(w.name) + '</div><div class="mute">' + countLabel(w.exercises.length) + ' · sample</div>' +
      exerciseList(w) + '</div>' +
      '<div class="card" id="pv-role-note"><p style="margin:0">Your trainer schedules your program</p></div></div>';
  }
  function sendHtml() {
    var w = workout(state.focusId) || WORKOUTS[0];
    var h = '<div id="pv-send"><p class="mute">Trainers only. Nothing is sent.</p><div class="card"><div class="name">' + esc(w.name) + '</div>' +
      '<p class="mute" id="pv-send-note">Preview only. No workout was sent.</p></div>';
    CLIENTS.forEach(function (c) {
      h += '<button type="button" class="pick"><span class="ava">' + esc(c.name.replace('Sample client: ', '').charAt(0)) + '</span><span class="grow"><span class="name">' + esc(c.name) + '</span><span class="mute">' + esc(c.plan) + '</span></span></button>';
    });
    return h + '</div>';
  }
  function paintBar() {
    var more = document.getElementById('pv-more');
    if (more) more.remove();
    var existing = document.getElementById('pv-menu');
    if (existing) existing.remove();
    if (!state || state.screen !== 'open' || !canEdit()) return;
    var bar = document.querySelector('.bar');
    if (!bar) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'pv-more';
    btn.className = 'icon';
    btn.setAttribute('aria-label', 'Workout menu');
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', state.menuOpen ? 'true' : 'false');
    btn.textContent = '\u22ef';
    btn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      state.menuOpen = !state.menuOpen;
      render();
    };
    bar.appendChild(btn);
    if (!state.menuOpen) return;
    var menu = document.createElement('div');
    menu.id = 'pv-menu';
    menu.className = 'card pv-menu';
    menu.setAttribute('role', 'menu');
    var note = state.menuNote || 'Rename, duplicate, and delete stay in this menu.';
    menu.innerHTML = '<button type="button" role="menuitem" data-menu="rename">Rename</button>' +
      '<button type="button" role="menuitem" data-menu="dup">Duplicate</button>' +
      '<button type="button" role="menuitem" class="danger" data-menu="del">Delete</button>' +
      '<p class="mute" id="pv-menu-note">' + esc(note) + '</p>';
    menu.onclick = function (e) {
      var b = e.target.closest('[data-menu]');
      if (!b) return;
      var word = { rename: 'renamed', dup: 'duplicated', del: 'deleted' }[b.getAttribute('data-menu')] || 'changed';
      state.menuNote = 'Preview only. Nothing was ' + word + '.';
      state.menuOpen = true;
      render();
    };
    bar.appendChild(menu);
  }
  function applyChrome() {
    var w = workout(state.focusId);
    if (state.screen === 'send') titleEl.textContent = 'Send';
    else if (state.screen === 'player' || state.screen === 'open' || state.screen === 'day') titleEl.textContent = w ? w.name : 'Workout';
    else titleEl.textContent = 'Programs';
    if (backBtn) backBtn.hidden = false;
    paintBar();
  }
  function render() {
    if (!app || !state) return;
    document.body.classList.add('pv-on');
    if (state.screen === 'player') app.innerHTML = playerHtml();
    else if (state.screen === 'open') app.innerHTML = openHtml();
    else if (state.screen === 'day') app.innerHTML = dayHtml();
    else if (state.screen === 'send') app.innerHTML = sendHtml();
    else app.innerHTML = homeHtml();
    applyChrome();
    app.onclick = onClick;
    app.onchange = onChange;
    app.onpointerdown = onPointerDown;
  }
  function onPointerDown(e) {
    var handle = e.target.closest('[data-drag]');
    if (!handle) return;
    beginDrag(e, handle);
  }
  function onChange(e) {
    if (!state || e.target.id !== 'pv-client') return;
    state.clientId = e.target.value;
    state.hint = '';
    state.screen = 'home';
    render();
  }
  function onClick(e) {
    if (!state) return;
    var role = e.target.closest('[data-role]');
    if (role) {
      var prev = state.role;
      state.role = role.getAttribute('data-role');
      if (state.role === 'trainer' && prev !== 'trainer') state.clientId = 'ada';
      if (state.role === 'trainer-share-on') state.clientId = 'jordan';
      if (state.role === 'trainer-share-off') state.clientId = 'sam';
      state.hint = '';
      state.screen = 'home';
      render();
      return;
    }
    if (e.target.closest('#pv-share')) {
      state.shareOn = !state.shareOn;
      render();
      return;
    }
    var cal = e.target.closest('[data-cal]');
    if (cal) { state.view = cal.getAttribute('data-cal'); render(); return; }
    var shift = e.target.closest('[data-shift]');
    if (shift) {
      var dir = Number(shift.getAttribute('data-shift')) || 0;
      if (shift.getAttribute('data-unit') === 'month') {
        var parts = state.month.split('-');
        var d = new Date(Number(parts[0]), Number(parts[1]) - 1 + dir, 1);
        state.month = iso(d).slice(0, 7);
      } else {
        var c = parseDate(state.cursor);
        c.setDate(c.getDate() + (7 * dir));
        state.cursor = iso(c);
        state.month = state.cursor.slice(0, 7);
      }
      render();
      return;
    }
    var jump = e.target.closest('[data-jump]');
    if (jump) {
      state.cursor = jump.getAttribute('data-jump');
      state.month = state.cursor.slice(0, 7);
      state.view = 'week';
      render();
      return;
    }
    if (e.target.closest('#pv-new')) {
      state.seq += 1;
      state.extra.push({ id: 'x' + state.seq, name: 'Sample: Extra workout', exercises: ['Sample: Air squat'] });
      state.hint = 'Preview only. Nothing was saved.';
      render();
      return;
    }
    var openWo = e.target.closest('[data-open-wo]');
    if (openWo && showOpen()) { state.focusId = openWo.getAttribute('data-open-wo'); state.screen = 'open'; state.menuOpen = true; state.menuNote = ''; render(); return; }
    var openS = e.target.closest('[data-open-session]');
    if (openS) {
      var list = schedule();
      var found = null;
      for (var i = 0; i < list.length; i++) if (list[i].id === openS.getAttribute('data-open-session')) found = list[i];
      state.focusId = found ? found.workoutId : 'push';
      state.menuNote = '';
      if (showOpen()) { state.screen = 'open'; state.menuOpen = true; }
      else state.screen = 'day';
      render();
      return;
    }
    var view = e.target.closest('[data-view-wo]');
    if (view) { state.focusId = view.getAttribute('data-view-wo'); state.playerMode = 'view'; state.screen = 'player'; render(); return; }
    var run = e.target.closest('[data-run]');
    if (run) { state.focusId = run.getAttribute('data-run'); state.playerMode = 'run'; state.screen = 'player'; render(); return; }
    var send = e.target.closest('[data-send]');
    if (send && showSend()) {
      state.focusId = send.getAttribute('data-send');
      state.screen = 'send';
      render();
    }
  }
  function back() {
    if (!state || state.screen === 'home') return false;
    state.screen = 'home';
    state.menuNote = '';
    render();
    return true;
  }
  function mount(opts) {
    clearDrag();
    app = opts && opts.app;
    titleEl = opts && opts.titleEl;
    backBtn = opts && opts.backBtn;
    state = fresh();
    render();
  }
  function unmount() {
    clearDrag();
    document.body.classList.remove('pv-on');
    var more = document.getElementById('pv-more');
    if (more) more.remove();
    var menu = document.getElementById('pv-menu');
    if (menu) menu.remove();
    if (app) {
      app.onpointerdown = null;
      app.onclick = null;
      app.onchange = null;
    }
    state = null;
  }
  window.WBPreview = { mount: mount, unmount: unmount, back: back };
})();
