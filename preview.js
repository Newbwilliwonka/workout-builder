/* Programs calendar. Real workouts and real tracking. No sample people. */
(function () {
  'use strict';
  var P = window.WBPrograms;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var app = null, titleEl = null, backBtn = null, options = null, state = null, drag = null, loadToken = 0;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function data() { return options && options.data; }
  function todayIso() { return P.iso(new Date()); }
  function fresh() {
    var today = todayIso();
    return {
      view: 'week',
      cursor: today,
      month: today.slice(0, 7),
      screen: 'home',
      playerMode: 'view',
      focusWorkout: null,
      focusEntry: null,
      clientId: '',
      clients: [],
      profile: null,
      userId: '',
      role: 'none',
      shareOn: null,
      clientShare: null,
      hint: '',
      ready: false,
      remote: '',
      playerLive: false
    };
  }
  function ownerId() {
    if (!state) return 'self';
    if (P.isTrainer(state.role)) return state.clientId || '';
    return state.userId || 'self';
  }
  function context() {
    var self = state.userId || 'self';
    var owner = ownerId();
    var plan = 'free_client';
    var linked = false;
    var shareOn = false;
    if (P.isTrainer(state.role)) {
      var client = null;
      state.clients.forEach(function (row) { if (row.id === state.clientId) client = row; });
      plan = P.ownerPlanOf(client);
      linked = !!client;
      shareOn = !!(state.clientShare && state.clientShare.shared === true);
      if (state.clientShare && state.clientShare.enthusiast === true) plan = 'enthusiast';
    }
    return { role: state.role, self: self, ownerId: owner, ownerPlan: plan, linked: linked, shareOn: state.role === 'enthusiast' ? state.shareOn === true : shareOn };
  }
  function canEdit() { return !!state && state.ready && P.canEdit(context()); }
  function canSee() { return !!state && state.ready && P.canSee(context()); }
  function buttonList() { return P.buttons(state && state.role); }
  function workouts() {
    var rows = data() && data().workouts;
    return Array.isArray(rows) ? rows : [];
  }
  function sessions() {
    if (options && options.sessions) {
      try { return options.sessions() || []; } catch (e) { return []; }
    }
    var rows = data() && data().sessions;
    return Array.isArray(rows) ? rows : [];
  }
  function entries() {
    var rows = data() && data().programs;
    return P.forOwner(rows, ownerId());
  }
  function workoutById(id) {
    var found = null;
    workouts().forEach(function (row) { if (row && row.id === id) found = row; });
    if (found) return found;
    var snap = null;
    entries().forEach(function (row) { if (row && row.workoutId === id) snap = row; });
    if (!snap) return null;
    return { id: snap.workoutId, name: snap.workoutName || 'Workout', items: snap.items || [] };
  }
  function entryById(id) {
    var found = null;
    entries().forEach(function (row) { if (row && row.id === id) found = row; });
    return found;
  }
  function savePrograms(next, hint) {
    if (!data()) return;
    data().programs = next;
    if (options.persist) options.persist();
    state.hint = hint || 'Saved on this device.';
  }
  function pushRemote(row) {
    if (!row || !options.saveEntry || !P.isUuid(row.ownerId)) return;
    Promise.resolve().then(function () { return options.saveEntry(row); }).then(function () {
      if (state) state.remote = '';
    }, function () {
      if (!state) return;
      state.remote = 'Saved on this device. The shared calendar waits until the programs SQL is applied.';
      render();
    });
  }
  function pullRemote() {
    var owner = ownerId();
    if (!options.loadEntries || !P.isUuid(owner)) return;
    var token = loadToken;
    Promise.resolve().then(function () { return options.loadEntries(owner); }).then(function (rows) {
      if (!state || token !== loadToken || !Array.isArray(rows)) return;
      data().programs = P.merge(data().programs, rows, owner);
      if (options.persist) options.persist();
      render();
    }, function () {
      if (!state || token !== loadToken) return;
      state.remote = 'Saved on this device. The shared calendar waits until the programs SQL is applied.';
    });
  }
  function presenceLabel(kind) { return kind === 'trainer' ? 'Trainer present' : 'Solo'; }
  function ico(kind) {
    var path = kind === 'trainer'
      ? 'M9 11a3 3 0 100-6 3 3 0 000 6zm7 1a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM9 13c-2.8 0-5 1.6-5 3.5V19h10v-2.5C14 14.6 11.8 13 9 13zm7 .5c-.4 0-.8 0-1.2.1 1.3.8 2.2 1.9 2.2 3.2V19h5v-2c0-1.8-2.5-3.5-6-3.5z'
      : 'M12 12a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm0 2c-3.3 0-6 1.8-6 4v2h12v-2c0-2.2-2.7-4-6-4z';
    return '<span class="pv-ico ' + kind + '" title="' + esc(presenceLabel(kind)) + '"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="' + path + '"/></svg></span>';
  }
  function check() { return '<span class="pv-check" aria-label="Completed">✓</span>'; }
  function onDay(date) { return entries().filter(function (row) { return row.date === date; }); }
  function actionsHtml(workoutId, entryId) {
    var buttons = buttonList();
    var h = '<div class="actions">';
    if (buttons.indexOf('run') >= 0) h += '<button type="button" class="pri sm" data-run="' + esc(workoutId) + '"' + (entryId ? ' data-entry="' + esc(entryId) + '"' : '') + '>Run</button>';
    if (buttons.indexOf('view') >= 0) h += '<button type="button" class="sm" data-view-wo="' + esc(workoutId) + '"' + (entryId ? ' data-entry="' + esc(entryId) + '"' : '') + '>View</button>';
    if (buttons.indexOf('open') >= 0) h += '<button type="button" class="sm" data-open-wo="' + esc(workoutId) + '">Open</button>';
    if (buttons.indexOf('send') >= 0) h += '<button type="button" class="sm" data-send="' + esc(workoutId) + '">Send</button>';
    return h + '</div>';
  }
  function workoutCard(w) {
    var n = (w.items || []).length;
    return '<div class="card" data-wo="' + esc(w.id) + '"><div class="pv-session-top">' +
      (canEdit() ? '<button type="button" class="pv-handle" data-drag="' + esc(w.id) + '" data-drag-kind="workout" data-label="' + esc(w.name || 'Workout') + '" aria-label="Drag ' + esc(w.name || 'Workout') + '">⋮⋮</button>' : '') +
      '<div class="name">' + esc(w.name || 'Workout') + '</div></div>' +
      '<div class="mute">' + n + ' exercise' + (n === 1 ? '' : 's') + '</div>' +
      actionsHtml(w.id, '') + '</div>';
  }
  function sessionCard(row) {
    var live = workoutById(row.workoutId);
    var name = live ? live.name : (row.workoutName || 'Workout');
    var kind = row.presence === 'trainer' ? 'trainer' : 'solo';
    var icon = canEdit()
      ? '<button type="button" class="pv-ico ' + kind + '" data-presence="' + esc(row.id) + '" aria-label="' + esc(presenceLabel(kind)) + '. Change it."><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="' + (kind === 'trainer'
        ? 'M9 11a3 3 0 100-6 3 3 0 000 6zm7 1a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM9 13c-2.8 0-5 1.6-5 3.5V19h10v-2.5C14 14.6 11.8 13 9 13zm7 .5c-.4 0-.8 0-1.2.1 1.3.8 2.2 1.9 2.2 3.2V19h5v-2c0-1.8-2.5-3.5-6-3.5z'
        : 'M12 12a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm0 2c-3.3 0-6 1.8-6 4v2h12v-2c0-2.2-2.7-4-6-4z') + '"/></svg></button>'
      : ico(kind);
    return '<div class="card pv-session"><div class="pv-session-top">' +
      (canEdit() ? '<button type="button" class="pv-handle" data-drag="' + esc(row.id) + '" data-drag-kind="session" data-label="' + esc(name) + '" aria-label="Drag ' + esc(name) + '">⋮⋮</button>' : '') +
      icon + '</div>' +
      '<button type="button" class="pv-session-open" data-open-session="' + esc(row.id) + '"><span class="name">' + esc(name) + '</span><span class="mute">' + esc(presenceLabel(kind)) + '</span></button></div>';
  }
  function legendHtml() {
    return '<div class="pv-legend"><span>' + ico('trainer') + 'Trainer present</span><span>' + ico('solo') + 'Solo</span><span>' + check() + 'Completed</span></div>';
  }
  function weekHtml() {
    var start = P.weekStart(state.cursor);
    var end = new Date(start.getTime());
    end.setDate(start.getDate() + 6);
    var label = start.getMonth() === end.getMonth()
      ? MONTHS[start.getMonth()].slice(0, 3) + ' ' + start.getDate() + ' – ' + end.getDate() + ', ' + start.getFullYear()
      : MONTHS[start.getMonth()].slice(0, 3) + ' ' + start.getDate() + ' – ' + MONTHS[end.getMonth()].slice(0, 3) + ' ' + end.getDate() + ', ' + end.getFullYear();
    var tracked = sessions();
    var h = '<div class="row pv-nav"><button type="button" class="sm" data-shift="-1" data-unit="week" aria-label="Previous week">‹</button>' +
      '<div class="grow name" id="pv-range">' + esc(label) + '</div>' +
      '<button type="button" class="sm" data-shift="1" data-unit="week" aria-label="Next week">›</button></div>' +
      '<p class="mute pv-swipe">Swipe sideways for all seven days.</p><div class="pv-week">';
    for (var i = 0; i < 7; i++) {
      var d = new Date(start.getTime());
      d.setDate(start.getDate() + i);
      var date = P.iso(d);
      var items = onDay(date);
      var today = date === todayIso();
      h += '<div class="pv-day' + (today ? ' today' : '') + '" data-date="' + date + '"><div class="pv-day-h"><div><div class="pv-dow">' + DOWS[i] + '</div><div class="pv-num">' + d.getDate() + (today ? '<span class="mute"> Today</span>' : '') + '</div></div>' +
        (P.dayDone(items, tracked) ? check() : '') + '</div>';
      items.forEach(function (row) { h += sessionCard(row); });
      if (!items.length && canEdit()) h += '<div class="mute pv-drop">Drop here</div>';
      h += '</div>';
    }
    return h + '</div>';
  }
  function monthHtml() {
    var parts = state.month.split('-');
    var year = Number(parts[0]), month = Number(parts[1]) - 1;
    var first = new Date(year, month, 1);
    var start = P.weekStart(P.iso(first));
    var tracked = sessions();
    var h = '<div class="row pv-nav"><button type="button" class="sm" data-shift="-1" data-unit="month" aria-label="Previous month">‹</button>' +
      '<div class="grow name" id="pv-range">' + esc(MONTHS[month] + ' ' + year) + '</div>' +
      '<button type="button" class="sm" data-shift="1" data-unit="month" aria-label="Next month">›</button></div>' +
      '<div class="pv-dows">' + DOWS.map(function (d) { return '<div>' + d + '</div>'; }).join('') + '</div><div class="pv-month">';
    for (var i = 0; i < 42; i++) {
      var d = new Date(start.getTime());
      d.setDate(start.getDate() + i);
      var date = P.iso(d);
      var items = onDay(date);
      var outside = d.getMonth() !== month;
      var done = P.dayDone(items, tracked);
      var kinds = {};
      items.forEach(function (row) { kinds[row.presence === 'trainer' ? 'trainer' : 'solo'] = 1; });
      var icons = '';
      if (kinds.trainer) icons += ico('trainer');
      if (kinds.solo) icons += ico('solo');
      h += '<button type="button" class="pv-cell' + (outside ? ' outside' : '') + (date === todayIso() ? ' today' : '') + '" data-jump="' + date + '" aria-label="' + esc(DOWS[(d.getDay() + 6) % 7] + ' ' + d.getDate()) + '">' +
        '<span class="pv-num">' + d.getDate() + '</span><span class="pv-marks">' + icons + (done ? check() : '') + '</span></button>';
    }
    return h + '</div>';
  }
  function noteHtml() {
    if (!state.ready) return '';
    if (state.role === 'free_client') return '<div class="card" id="pv-role-note"><p style="margin:0">Your trainer schedules your program</p></div>';
    if (state.role === 'enthusiast' && state.shareOn === true) return '<div class="card" id="pv-role-note"><p style="margin:0">Your trainer can also edit this calendar</p></div>';
    if (state.role === 'enthusiast' && state.shareOn === false) return '<div class="card" id="pv-role-note"><p style="margin:0">Sharing is off. Your trainer cannot see or edit this calendar.</p></div>';
    if (P.isTrainer(state.role) && state.clientShare && state.clientShare.shared === true) {
      return '<div class="card" id="pv-role-note"><p style="margin:0">Sharing is on, so you can drag and schedule workouts on this calendar.</p></div>';
    }
    if (P.isTrainer(state.role) && canEdit()) return '<div class="card" id="pv-role-note"><p style="margin:0">You can drag and move workouts on this client’s calendar.</p></div>';
    return '';
  }
  function clientPicker() {
    if (!P.isTrainer(state.role)) return '';
    if (!state.clients.length) return '<div class="card"><div class="name">No clients yet</div><p class="mute">Invite a client from Account, then their calendar shows up here.</p></div>';
    var h = '<label class="mute" for="pv-client">Client</label><select id="pv-client">';
    state.clients.forEach(function (client) {
      h += '<option value="' + esc(client.id) + '"' + (client.id === state.clientId ? ' selected' : '') + '>' + esc(client.email || 'Client') + ' · ' + esc(client.plan || 'Free Client') + '</option>';
    });
    return h + '</select>';
  }
  function homeHtml() {
    var hidden = state.ready && !canSee();
    var h = '<div id="pv-root" data-role-now="' + esc(state.role) + '">' + clientPicker() + noteHtml();
    if (state.remote) h += '<p class="mute" id="pv-remote">' + esc(state.remote) + '</p>';
    if (state.hint) h += '<p class="mute" id="pv-hint">' + esc(state.hint) + '</p>';
    if (!state.ready) return h + '<p class="mute" id="pv-loading">Loading…</p></div>';
    if (P.isTrainer(state.role) && !state.clients.length) return h + '</div>';
    if (hidden) {
      return h + '<div class="card" id="pv-private"><div class="name">Not shared</div><p class="mute">This Enthusiast has turned off sharing. You cannot see or edit their program.</p></div></div>';
    }
    var list = workouts();
    h += '<div class="pv-layout" id="pv-layout"><section class="pv-workouts" id="pv-workouts" aria-label="Workouts"><h2 class="pv-h">Workouts</h2>';
    if (!list.length) h += '<p class="mute">No workouts yet. Build one from the workout list, then drag it onto a day.</p>';
    list.forEach(function (row) { h += workoutCard(row); });
    h += '</section><section class="pv-cal" id="pv-cal" aria-label="Programs"><h2 class="pv-h">Programs</h2>' +
      '<p class="mute">Workouts scheduled on a calendar. A check is a day you actually tracked.</p>' +
      '<div class="seg" id="pv-range-switch" role="group" aria-label="Week or month"><button type="button" data-cal="week" class="' + (state.view === 'week' ? 'on' : '') + '">Week</button>' +
      '<button type="button" data-cal="month" class="' + (state.view === 'month' ? 'on' : '') + '">Month</button></div>' +
      legendHtml() + (state.view === 'month' ? monthHtml() : weekHtml()) + '</section></div></div>';
    return h;
  }
  function dayHtml() {
    var entry = entryById(state.focusEntry);
    var workout = entry ? workoutById(entry.workoutId) : null;
    if (!entry || !workout) return '<div id="pv-day"><p class="mute">That workout is no longer on this day.</p></div>';
    return '<div id="pv-day"><p class="mute">' + esc(entry.date) + ' · ' + esc(presenceLabel(entry.presence)) + '</p>' +
      '<div class="card"><div class="name">' + esc(workout.name || 'Workout') + '</div>' +
      '<div class="mute">' + (workout.items || []).length + ' exercise' + ((workout.items || []).length === 1 ? '' : 's') + '</div>' +
      actionsHtml(workout.id, entry.id) + '</div></div>';
  }
  function playable(id) {
    var workout = workoutById(id);
    if (!workout) return null;
    if (workout.items && workout.items.length && window.WB && WB.normalizeExercise) {
      workout = {
        id: workout.id,
        name: workout.name,
        items: workout.items.map(function (item) {
          try { return WB.normalizeExercise(item); } catch (e) { return item; }
        })
      };
    }
    return workout;
  }
  function closeRealPlayer() {
    if (state && state.playerLive && window.WBPlayer) {
      state.playerLive = false;
      WBPlayer.unmount();
    }
    document.body.classList.remove('playing');
  }
  function leavePlayer() {
    if (!state) return;
    if (options && options.onTracked) options.onTracked();
    state.playerLive = false;
    state.screen = 'home';
    if (window.WBPlayer) WBPlayer.unmount();
    render();
  }
  function openRealPlayer(track) {
    if (state.playerLive) return;
    var workout = playable(state.focusWorkout);
    if (!workout || !workout.items || !workout.items.length || !window.WBPlayer) {
      state.screen = 'home';
      state.playerLive = false;
      state.hint = 'Add an exercise before running this workout.';
      render();
      return;
    }
    state.playerLive = true;
    app.innerHTML = '';
    app.onclick = null;
    app.onchange = null;
    app.onpointerdown = null;
    window.__wbClockOffset = 0;
    var scratch = { version: 4, workouts: [], sessions: [] };
    var opts = { track: track !== false };
    if (track !== false && state.focusEntry) opts.programId = state.focusEntry;
    WBPlayer.mount(app, workout, scratch, function () {}, leavePlayer, opts);
    window.scrollTo(0, 0);
  }
  function applyChrome() {
    if (titleEl) titleEl.textContent = 'Programs';
    if (backBtn) backBtn.hidden = false;
  }
  function render() {
    if (!app || !state) return;
    document.body.classList.add('pv-on');
    if (state.screen === 'player') {
      openRealPlayer(state.playerMode !== 'view');
      applyChrome();
      return;
    }
    closeRealPlayer();
    app.innerHTML = state.screen === 'day' ? dayHtml() : homeHtml();
    applyChrome();
    app.onclick = onClick;
    app.onchange = onChange;
    app.onpointerdown = onPointerDown;
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
    if (!canEdit() || !date || !data()) return;
    var owner = ownerId();
    if (kind === 'session') {
      var result = P.move(data().programs, id, date);
      if (!result.moved) return;
      savePrograms(result.programs, 'Saved on this device.');
      pushRemote(result.moved);
      render();
      return;
    }
    var workout = workoutById(id);
    if (!workout) return;
    var placed = P.place(data().programs, {
      id: window.WB.uid('pg'),
      ownerId: owner,
      workoutId: workout.id,
      workoutName: workout.name,
      items: workout.items,
      date: date,
      presence: P.isTrainer(state.role) ? 'trainer' : 'solo'
    });
    if (placed.duplicate) {
      state.hint = 'That workout is already on this day.';
      render();
      return;
    }
    if (!placed.created) return;
    savePrograms(placed.programs, 'Saved on this device.');
    pushRemote(placed.created);
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
  function onPointerDown(e) {
    var handle = e.target.closest('[data-drag]');
    if (!handle) return;
    beginDrag(e, handle);
  }
  function onChange(e) {
    if (!state || e.target.id !== 'pv-client') return;
    state.clientId = e.target.value;
    state.clientShare = null;
    state.hint = '';
    state.screen = 'home';
    render();
    loadClientShare(++loadToken);
  }
  function onClick(e) {
    if (!state) return;
    var cal = e.target.closest('[data-cal]');
    if (cal) { state.view = cal.getAttribute('data-cal'); render(); return; }
    var shift = e.target.closest('[data-shift]');
    if (shift) {
      var dir = Number(shift.getAttribute('data-shift')) || 0;
      if (shift.getAttribute('data-unit') === 'month') {
        var parts = state.month.split('-');
        var d = new Date(Number(parts[0]), Number(parts[1]) - 1 + dir, 1);
        state.month = P.iso(d).slice(0, 7);
      } else {
        var c = P.parseDate(state.cursor);
        c.setDate(c.getDate() + (7 * dir));
        state.cursor = P.iso(c);
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
    var presenceBtn = e.target.closest('[data-presence]');
    if (presenceBtn && canEdit()) {
      var current = entryById(presenceBtn.getAttribute('data-presence'));
      if (!current) return;
      var flipped = P.setPresence(data().programs, current.id, current.presence === 'trainer' ? 'solo' : 'trainer');
      if (flipped.changed) {
        savePrograms(flipped.programs, 'Saved on this device.');
        pushRemote(flipped.changed);
      }
      render();
      return;
    }
    var openS = e.target.closest('[data-open-session]');
    if (openS) {
      state.focusEntry = openS.getAttribute('data-open-session');
      state.screen = 'day';
      render();
      return;
    }
    var openWo = e.target.closest('[data-open-wo]');
    if (openWo && buttonList().indexOf('open') >= 0 && options.go) {
      options.go('#/w/' + openWo.getAttribute('data-open-wo'));
      return;
    }
    var send = e.target.closest('[data-send]');
    if (send && buttonList().indexOf('send') >= 0 && options.go) {
      options.go('#/send');
      return;
    }
    var view = e.target.closest('[data-view-wo]');
    if (view) {
      state.focusWorkout = view.getAttribute('data-view-wo');
      state.focusEntry = view.getAttribute('data-entry') || '';
      state.playerMode = 'view';
      state.screen = 'player';
      render();
      return;
    }
    var run = e.target.closest('[data-run]');
    if (run) {
      state.focusWorkout = run.getAttribute('data-run');
      state.focusEntry = run.getAttribute('data-entry') || '';
      state.playerMode = 'run';
      state.screen = 'player';
      render();
    }
  }
  function loadClientShare(token) {
    if (!state || !P.isTrainer(state.role) || !state.clientId || !options.loadClient) {
      if (state && token === loadToken) { state.ready = true; render(); pullRemote(); }
      return;
    }
    Promise.resolve().then(function () { return options.loadClient(state.clientId); }).then(function (status) {
      if (!state || token !== loadToken) return;
      state.clientShare = status || { shared: false, enthusiast: false, linked: true };
      state.ready = true;
      render();
      if (canSee()) pullRemote();
    }, function () {
      if (!state || token !== loadToken) return;
      state.clientShare = null;
      state.ready = true;
      render();
    });
  }
  function refresh() {
    var token = ++loadToken;
    var profileP = options.loadProfile ? Promise.resolve().then(options.loadProfile) : Promise.resolve(null);
    var sessionP = options.loadSession ? Promise.resolve().then(options.loadSession) : Promise.resolve(null);
    Promise.all([profileP, sessionP]).then(function (pair) {
      if (!state || token !== loadToken) return;
      state.profile = pair[0] || null;
      var session = pair[1];
      state.userId = (session && session.user && session.user.id) || (state.profile && state.profile.id) || '';
      state.role = P.roleOf(state.profile);
      if (P.isTrainer(state.role)) {
        var rosterP = options.loadRoster ? Promise.resolve().then(options.loadRoster) : Promise.resolve(null);
        return rosterP.then(function (roster) {
          if (!state || token !== loadToken) return;
          var clients = roster && Array.isArray(roster.clients) ? roster.clients : [];
          state.clients = clients;
          if (!state.clientId || !clients.some(function (row) { return row.id === state.clientId; })) {
            state.clientId = clients.length ? clients[0].id : '';
          }
          loadClientShare(token);
        });
      }
      if (state.role === 'enthusiast' && options.loadShare) {
        return Promise.resolve().then(options.loadShare).then(function (row) {
          if (!state || token !== loadToken) return;
          state.shareOn = row && typeof row.on === 'boolean' ? row.on : null;
          state.ready = true;
          render();
          pullRemote();
        }, function () {
          if (!state || token !== loadToken) return;
          state.ready = true;
          render();
        });
      }
      state.ready = true;
      render();
      pullRemote();
    }, function () {
      if (!state || token !== loadToken) return;
      state.ready = true;
      render();
    });
  }
  function back() {
    if (!state || state.screen === 'home') return false;
    if (state.playerLive) {
      if (window.WBPlayer) WBPlayer.requestEnd();
      return true;
    }
    state.screen = 'home';
    render();
    return true;
  }
  function mount(opts) {
    clearDrag();
    options = opts || {};
    app = options.app;
    titleEl = options.titleEl;
    backBtn = options.backBtn;
    state = fresh();
    if (data() && !Array.isArray(data().programs)) data().programs = [];
    render();
    refresh();
  }
  function unmount() {
    loadToken += 1;
    clearDrag();
    if (state && state.playerLive && window.WBPlayer) WBPlayer.unmount();
    document.body.classList.remove('playing');
    document.body.classList.remove('pv-on');
    if (app) {
      app.onpointerdown = null;
      app.onclick = null;
      app.onchange = null;
    }
    state = null;
    options = null;
  }
  window.WBPreview = { mount: mount, unmount: unmount, back: back };
})();
