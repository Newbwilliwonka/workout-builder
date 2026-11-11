/* Messages and sent workouts. preview=1 keeps the sample screens. Otherwise this talks to WBAuth. */
(function (root) {
  'use strict';
  var ROLE_KEY = 'wb.sampleRole';
  var PEOPLE = [
    { id: 'maya', name: 'Maya Chen', plan: 'Enthusiast', time: '2:14 PM', unread: 1, preview: 'Can we move Thursday to Friday morning?',
      thread: [
        { from: 'them', text: 'Can we move Thursday to Friday morning?', time: '2:02 PM' },
        { from: 'me', text: 'Friday at 8 works. I will send an updated workout.', time: '2:09 PM' },
        { from: 'them', text: 'Perfect. I will keep the easy bike day on Thursday.', time: '2:14 PM' }
      ] },
    { id: 'jordan', name: 'Jordan Lee', plan: 'Free Client', time: 'Yesterday', unread: 0, preview: 'Got the lower-body workout.',
      thread: [
        { from: 'me', text: 'Lower body strength is in your workouts. The weights are a starting point.', time: 'Yesterday' },
        { from: 'them', text: 'Got the lower-body workout.', time: 'Yesterday' }
      ] },
    { id: 'sam', name: 'Sam Ortiz', plan: 'Enthusiast', time: 'Mon', unread: 0, preview: 'Thanks, I will try the new warm-up.',
      thread: [
        { from: 'me', text: 'Try the new warm-up before Friday.', time: 'Mon' },
        { from: 'them', text: 'Thanks, I will try the new warm-up.', time: 'Mon' }
      ] }
  ];
  var TRAINER = { id: 'alex', name: 'Alex Rivera', plan: 'Trainer', time: '2:16 PM', unread: 1, preview: 'Friday full body is in your workouts. You can edit your copy.',
    thread: [
      { from: 'them', text: 'Friday at 8 works. I will send an updated workout.', time: '2:09 PM' },
      { from: 'me', text: 'Perfect. I will keep the easy bike day on Thursday.', time: '2:11 PM' },
      { from: 'them', text: 'Sent. Friday full body is in your workouts. You can edit your copy.', time: '2:16 PM' }
    ] };
  var WORKOUTS = [
    { id: 'lower', name: 'Lower body strength', detail: '5 exercises' },
    { id: 'friday', name: 'Friday full body', detail: '4 exercises' },
    { id: 'bike', name: 'Easy bike day', detail: '3 exercises' }
  ];
  var COPIES = {
    friday: { from: 'Alex Rivera', lines: [['Back squat', '4 sets · 8 reps · 135 lb'], ['Bench press', '4 sets · 6 reps · 95 lb'], ['Romanian deadlift', '3 sets · 8 reps · 115 lb'], ['Plank', '3 sets · 30 sec']] },
    bike: { from: '', lines: [['Easy spin', '20 min'], ['Hip opener', '2 sets · 10 reps'], ['Easy walk', '5 min']] }
  };
  var role = 'trainer';
  var workoutId = 'lower';
  var picked = { maya: true, jordan: true };
  var sent = null;
  var extra = { maya: [], jordan: [], sam: [], alex: [] };
  var copyNames = { friday: 'Friday full body', bike: 'Easy bike day' };
  var ctx = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function parts() {
    return (location.hash || '').replace(/^#\/?/, '').split('?')[0].split('/');
  }
  function initials(name) {
    var local = String(name || '').split('@')[0].replace(/[^a-z0-9]/gi, '');
    if (local.length >= 2) return local.slice(0, 2).toUpperCase();
    var bits = String(name || '').split(' ').filter(Boolean);
    return ((bits[0] || '?').charAt(0) + (bits[1] ? bits[1].charAt(0) : '')).toUpperCase();
  }
  function person(id) {
    if (id === TRAINER.id) return TRAINER;
    for (var i = 0; i < PEOPLE.length; i++) if (PEOPLE[i].id === id) return PEOPLE[i];
    return null;
  }
  function prefer(next) {
    if (next !== 'trainer' && next !== 'client') return;
    role = next;
    try { sessionStorage.setItem(ROLE_KEY, next); } catch (e) {}
  }
  function resolveRole(profile) {
    try {
      var saved = sessionStorage.getItem(ROLE_KEY);
      if (saved === 'trainer' || saved === 'client') return saved;
    } catch (e) {}
    if (root.WBInvites && root.WBInvites.trainerRole(profile)) return 'trainer';
    if (profile && (profile.membership === 'free_client' || profile.membership === 'enthusiast' || profile.intended_plan === 'enthusiast')) return 'client';
    return 'trainer';
  }
  function sampleNote() {
    return '<div class="seg" id="sample-role">' +
      '<button type="button" data-role="trainer" class="' + (role === 'trainer' ? 'on' : '') + '">Trainer</button>' +
      '<button type="button" data-role="client" class="' + (role === 'client' ? 'on' : '') + '">Client</button></div>' +
      '<p class="note" id="sample-note">Sample people for this layout. Nothing is sent or saved.</p>';
  }
  function row(p, attrs) {
    return '<button type="button" class="person" ' + attrs + '>' +
      '<span class="ava" aria-hidden="true">' + esc(initials(p.name)) + '</span>' +
      '<span class="grow"><span class="row" style="width:100%;margin:0"><span class="name">' + esc(p.name) + '</span>' +
      '<span class="mute" style="margin-left:auto">' + esc(p.time) + '</span></span>' +
      '<span class="preview">' + esc(p.preview) + '</span>' +
      '<span class="mute">' + esc(p.plan) + '</span></span>' +
      (p.unread ? '<span class="count">' + p.unread + '</span>' : '') + '</button>';
  }
  function threadOf(p) {
    return (p.thread || []).concat(extra[p.id] || []);
  }
  function bubbles(p) {
    var h = '<div class="thread" id="thread">';
    threadOf(p).forEach(function (m) {
      h += '<div class="bubble' + (m.from === 'me' ? ' me' : '') + '"><span>' + esc(m.text) + '</span>' +
        '<span class="when">' + esc(m.time || 'Now') + '</span></div>';
    });
    return h + '</div>';
  }
  function renderList() {
    ctx.titleEl.textContent = 'Messages';
    var h = sampleNote();
    if (role === 'trainer') {
      h += '<p class="mute">Linked clients and enthusiasts.</p>';
      PEOPLE.forEach(function (p) { h += row(p, 'data-thread="' + p.id + '"'); });
    } else {
      h += '<p class="mute">Your trainer.</p>';
      h += row(TRAINER, 'data-thread="' + TRAINER.id + '"');
      h += '<button type="button" data-open-received="list" style="width:100%">Your workouts</button>';
    }
    ctx.app.innerHTML = h;
  }
  function renderThread(id) {
    var p = person(id);
    if (!p || (role === 'client' && id !== TRAINER.id) || (role === 'trainer' && id === TRAINER.id)) {
      ctx.titleEl.textContent = 'Messages';
      ctx.app.innerHTML = sampleNote() + '<div class="empty">That conversation is not in this preview.</div>' +
        '<button type="button" data-thread-back style="width:100%">All messages</button>';
      return;
    }
    ctx.titleEl.textContent = p.name;
    var h = sampleNote();
    h += '<p class="mute" id="with">' + esc(p.plan) + (role === 'trainer' ? ' · linked client' : '') + '</p>';
    h += bubbles(p);
    if (role === 'client') {
      h += '<div class="card" id="arrived"><span class="tag">From Alex Rivera</span>' +
        '<div class="name" style="margin-top:8px">Friday full body</div>' +
        '<p class="mute">A copy is in your workouts. You can edit it.</p>' +
        '<button type="button" class="pri" data-open-received="friday" style="width:100%">View in your workouts</button></div>';
    }
    h += '<div class="dock"><div class="inner composer"><input id="msg-text" placeholder="Message" autocomplete="off">' +
      '<button type="button" class="pri" id="msg-send">Send</button></div></div>';
    ctx.app.innerHTML = h;
    var input = document.getElementById('msg-text');
    if (input) {
      input.focus();
      input.onkeydown = function (e) {
        if (e.key === 'Enter') { e.preventDefault(); sendMessage(id); }
      };
    }
  }
  function selectedPeople() {
    return PEOPLE.filter(function (p) { return picked[p.id]; });
  }
  function renderSend() {
    ctx.titleEl.textContent = 'Send workout';
    var h = sampleNote();
    if (role !== 'trainer') {
      ctx.app.innerHTML = h + '<div class="card" id="send-locked"><div class="name">Only a trainer can send a workout</div>' +
        '<p class="mute">A client receives a copy in their own workouts and can edit that copy.</p>' +
        '<button type="button" class="pri" data-open-received="list" style="width:100%">See a received workout</button></div>';
      return;
    }
    h += '<p class="mute">Pick one of your workouts and the clients who should get a copy. A linked Enthusiast counts as a client.</p>';
    h += '<div class="name" style="margin:12px 0 8px">Workout</div>';
    WORKOUTS.forEach(function (w) {
      var on = w.id === workoutId;
      h += '<button type="button" class="pick' + (on ? ' on' : '') + '" data-pick-workout="' + w.id + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        '<span class="grow"><span class="name">' + esc(w.name) + '</span><span class="preview">' + esc(w.detail) + '</span></span>' +
        '<span class="mark">' + (on ? '✓' : '') + '</span></button>';
    });
    h += '<div class="name" style="margin:14px 0 8px">Clients</div>';
    h += '<p class="mute">Each person gets their own copy, which they can edit. Your workout stays as it is.</p>';
    PEOPLE.forEach(function (p) {
      var on = !!picked[p.id];
      h += '<button type="button" class="pick' + (on ? ' on' : '') + '" data-pick-client="' + p.id + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        '<span class="ava" aria-hidden="true">' + esc(initials(p.name)) + '</span>' +
        '<span class="grow"><span class="name">' + esc(p.name) + '</span><span class="preview">' + esc(p.plan) + ' · client</span></span>' +
        '<span class="mark">' + (on ? '✓' : '') + '</span></button>';
    });
    if (sent) {
      h += '<div class="card" id="sent-note"><div class="name">Copies for their workouts</div><p>' + esc(sent) + '</p>' +
        '<p class="mute">Preview only. Nothing was sent, and your workout was not changed.</p></div>';
    }
    var n = selectedPeople().length;
    var label = n ? ('Send to ' + n + (n === 1 ? ' client' : ' clients')) : 'Send workout';
    h += '<button type="button" class="pri" id="send-go" data-send-workout style="width:100%;margin-top:8px"' + (n && workoutId ? '' : ' disabled') + '>' + label + '</button>';
    ctx.app.innerHTML = h;
  }
  function renderReceived(id) {
    if (id && COPIES[id]) return renderCopy(id);
    ctx.titleEl.textContent = 'Workouts';
    var h = sampleNote();
    h += '<p class="mute" id="received-lead">Friday full body came from your trainer. It is a copy in your workouts, so you can edit it.</p>';
    h += copyCard('friday', true);
    h += copyCard('bike', false);
    ctx.app.innerHTML = h;
  }
  function copyCard(id, fromTrainer) {
    var copy = COPIES[id];
    var h = '<div class="card"><div class="row"><div class="name grow">' + esc(copyNames[id]) + '</div>';
    if (fromTrainer) h += '<span class="tag">From ' + esc(copy.from) + '</span>';
    h += '</div><div class="mute">' + copy.lines.length + ' exercises · ' + (fromTrainer ? 'Copy in your workouts · You can edit it' : 'Your workout') + '</div>' +
      '<div class="actions"><button type="button" class="pri sm" data-open-received="' + id + '">Open</button></div></div>';
    return h;
  }
  function renderCopy(id) {
    var copy = COPIES[id];
    ctx.titleEl.textContent = copyNames[id];
    var h = sampleNote();
    if (copy.from) h += '<span class="tag">From ' + esc(copy.from) + '</span>';
    h += '<label for="copy-name">Name</label><input id="copy-name" value="' + esc(copyNames[id]) + '" autocomplete="off">';
    h += '<p class="mute" id="copy-note">' + (copy.from
      ? 'This copy is yours. Edits stay in your workouts and do not change your trainer\'s workout.'
      : 'This is your workout.') + '</p>';
    copy.lines.forEach(function (line) {
      h += '<div class="card"><div class="name">' + esc(line[0]) + '</div><div class="mute">' + esc(line[1]) + '</div></div>';
    });
    h += '<button type="button" class="pri" id="copy-save" style="width:100%">Save</button>';
    ctx.app.innerHTML = h;
  }
  function sendMessage(id) {
    var input = document.getElementById('msg-text');
    var text = input ? input.value.replace(/\s+/g, ' ').trim() : '';
    if (!text) return;
    extra[id] = (extra[id] || []).concat([{ from: 'me', text: text, time: 'Now' }]);
    var p = person(id);
    if (p) p.preview = text;
    renderThread(id);
  }
  function sendWorkout() {
    var people = selectedPeople();
    var workout = null;
    for (var i = 0; i < WORKOUTS.length; i++) if (WORKOUTS[i].id === workoutId) workout = WORKOUTS[i];
    if (!people.length || !workout) {
      ctx.toast('Choose a workout and at least one client.');
      return;
    }
    var names = people.map(function (p) { return p.name; });
    var who = names.length === 1 ? names[0] : (names.length === 2 ? names[0] + ' and ' + names[1] : names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1]);
    sent = who + (names.length > 1 ? ' each get' : ' gets') + ' an editable copy of ' + workout.name + ' in their own workouts.';
    ctx.toast('Preview only. Nothing was sent.');
    renderSend();
  }
  function onClick(e) {
    var t = e.target.closest('[data-role], [data-thread], [data-thread-back], [data-pick-workout], [data-pick-client], [data-send-workout], [data-open-received], #msg-send, #copy-save');
    if (!t || t.disabled) return;
    if (t.dataset.role) {
      if (t.dataset.role === role) return;
      prefer(t.dataset.role);
      if (parts()[0] === 'messages' && parts()[1]) ctx.go('#/messages');
      else render();
      return;
    }
    if (t.id === 'msg-send') return sendMessage(parts()[1]);
    if (t.dataset.threadBack != null) return ctx.go('#/messages');
    if (t.dataset.thread) return ctx.go('#/messages/' + t.dataset.thread);
    if (t.dataset.pickWorkout) { workoutId = t.dataset.pickWorkout; sent = null; return renderSend(); }
    if (t.dataset.pickClient) { picked[t.dataset.pickClient] = !picked[t.dataset.pickClient]; sent = null; return renderSend(); }
    if (t.dataset.sendWorkout != null) return sendWorkout();
    if (t.dataset.openReceived) {
      prefer('client');
      return ctx.go(t.dataset.openReceived === 'list' ? '#/received' : '#/received/' + t.dataset.openReceived);
    }
    if (t.id === 'copy-save') {
      var input = document.getElementById('copy-name');
      var name = input ? input.value.replace(/\s+/g, ' ').trim() : '';
      if (!name) return ctx.toast('Enter a name.');
      copyNames[parts()[1]] = name;
      ctx.titleEl.textContent = name;
      ctx.toast('Saved in this preview.');
    }
  }
  function render() {
    if (!ctx) return;
    var p = parts();
    ctx.backBtn.hidden = false;
    ctx.app.onclick = onClick;
    ctx.app.oninput = null;
    ctx.app.onchange = null;
    if (p[0] === 'send') return renderSend();
    if (p[0] === 'received') return renderReceived(p[1] || '');
    if (p[0] === 'messages' && p[1]) return renderThread(p[1]);
    renderList();
  }
  function mount(next) {
    ctx = next;
    stopLive();
    if (isPreview()) {
      role = resolveRole(next.profile);
      render();
      return;
    }
    renderReal();
  }

  var live = { gen: 0, timer: 0, unwatch: null, threads: [], thread: null, roster: null, pickedWorkout: '', picked: {}, sent: '', view: null, quiet: false };
  function isPreview() {
    return /(?:^|&)preview=1(?:&|$)/.test((location.hash.split('?')[1]) || '');
  }
  function stopLive() {
    live.gen += 1;
    if (live.timer) clearInterval(live.timer);
    live.timer = 0;
    if (live.unwatch) { var off = live.unwatch; live.unwatch = null; try { off(); } catch (e) {} }
  }
  function startLive(refresh) {
    var gen = live.gen;
    live.timer = setInterval(function () {
      if (gen !== live.gen || document.hidden) return;
      refresh();
    }, 4000);
    var auth = root.WBAuth;
    if (!auth || !auth.watchMessages) return;
    auth.watchMessages(function () { if (gen === live.gen) refresh(); }).then(function (off) {
      if (gen !== live.gen) { if (off) off(); return; }
      live.unwatch = off;
    }).catch(function () {});
  }
  function unavailable(err) {
    var msg = err && err.message || '';
    return /not available yet|not ready|coaching SQL/i.test(msg);
  }
  function waitCard(err) {
    var msg = unavailable(err) || !err
      ? 'Coaching is not available yet. Apply the coaching SQL in the Supabase SQL editor.'
      : (err.message || 'Could not load this.');
    return '<div class="card" id="coaching-wait"><div class="name">Not available yet</div><p class="mute">' + esc(msg) + '</p></div>';
  }
  function whenLabel(value) {
    if (!value) return '';
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    var now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    var y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  function personRow(p) {
    return '<button type="button" class="person" data-thread="' + esc(p.id) + '">' +
      '<span class="ava" aria-hidden="true">' + esc(initials(p.name)) + '</span>' +
      '<span class="grow"><span class="row" style="width:100%;margin:0"><span class="name">' + esc(p.name) + '</span>' +
      '<span class="mute" style="margin-left:auto">' + esc(whenLabel(p.at) || '') + '</span></span>' +
      '<span class="preview">' + esc(p.preview || 'No messages yet') + '</span>' +
      '<span class="mute">' + esc(p.plan || '') + '</span></span>' +
      (p.unread ? '<span class="count">' + esc(p.unread) + '</span>' : '') + '</button>';
  }
  function showWait(err) {
    ctx.titleEl.textContent = parts()[0] === 'send' ? 'Send workout' : (parts()[0] === 'client' ? 'Client' : 'Messages');
    ctx.backBtn.hidden = false;
    ctx.app.innerHTML = waitCard(err);
    ctx.app.onclick = null;
  }
  function renderReal() {
    if (!ctx) return;
    ctx.backBtn.hidden = false;
    var p = parts();
    if (p[0] === 'send') return loadSend();
    if (p[0] === 'received') return loadReceived(p[1] || '');
    if (p[0] === 'client') return loadClient(p[1] || '');
    if (p[0] === 'messages' && p[1]) return loadThread(p[1], false);
    loadThreads(false);
  }
  function loadThreads(quiet) {
    var auth = root.WBAuth;
    if (!auth || !auth.threads) return showWait(new Error('Coaching is not available yet. Apply the coaching SQL in the Supabase SQL editor.'));
    if (!quiet) ctx.app.innerHTML = '<p class="mute">Loading…</p>';
    var gen = live.gen;
    auth.threads().then(function (data) {
      if (gen !== live.gen || isPreview() || parts()[0] !== 'messages' || parts()[1]) return;
      live.threads = data && data.threads || [];
      drawThreads();
      if (!live.timer) startLive(function () { loadThreads(true); });
    }).catch(function (err) {
      if (gen !== live.gen || parts()[0] !== 'messages' || parts()[1]) return;
      if (quiet && document.getElementById('thread-list')) return;
      showWait(err);
    });
  }
  function drawThreads() {
    ctx.titleEl.textContent = 'Messages';
    var h = '';
    if (!live.threads.length) h += '<div class="empty" id="thread-list">No linked people yet.</div>';
    else {
      h += '<div id="thread-list">';
      live.threads.forEach(function (p) { h += personRow(p); });
      h += '</div>';
    }
    ctx.app.innerHTML = h;
    ctx.app.onclick = function (e) {
      var t = e.target.closest('[data-thread]');
      if (!t) return;
      ctx.go('#/messages/' + t.dataset.thread);
    };
  }
  function loadThread(id, quiet) {
    var auth = root.WBAuth;
    if (!auth || !auth.messages) return showWait();
    var draft = '';
    var input = document.getElementById('msg-text');
    var focused = !!(input && document.activeElement === input);
    if (input) draft = input.value;
    if (!quiet) ctx.app.innerHTML = '<p class="mute">Loading…</p>';
    var gen = live.gen;
    auth.messages(id).then(function (data) {
      if (gen !== live.gen || parts()[1] !== id) return;
      live.thread = data;
      if (!quiet && auth.markRead) auth.markRead(id).catch(function () {});
      drawThread(draft, focused);
      if (!live.timer) startLive(function () { loadThread(id, true); });
    }).catch(function (err) {
      if (gen !== live.gen || parts()[1] !== id) return;
      if (quiet && document.getElementById('msg-text')) return;
      showWait(err);
    });
  }
  function bubblesHtml(messages) {
    return (messages || []).map(function (m) {
      return '<div class="bubble' + (m.mine ? ' me' : '') + '"><span>' + esc(m.body) + '</span><span class="when">' + esc(whenLabel(m.at)) + '</span></div>';
    }).join('');
  }
  function drawThread(draft, focused) {
    var data = live.thread || { person: {}, messages: [] };
    var person = data.person || {};
    var existing = document.getElementById('msg-text');
    if (existing && document.getElementById('thread')) {
      var thread = document.getElementById('thread');
      var html = bubblesHtml(data.messages);
      if (thread.innerHTML !== html) thread.innerHTML = html;
      return;
    }
    ctx.titleEl.textContent = person.name || 'Messages';
    var h = '<p class="mute" id="with">' + esc(person.plan || '') + (person.plan && person.plan !== 'Trainer' ? ' · linked client' : '') + '</p>';
    h += '<div class="thread" id="thread">' + bubblesHtml(data.messages) + '</div>';
    h += '<div class="dock"><div class="inner composer"><input id="msg-text" placeholder="Message" autocomplete="off" maxlength="2000">' +
      '<button type="button" class="pri" id="msg-send">Send</button></div></div>';
    ctx.app.innerHTML = h;
    var box = document.getElementById('msg-text');
    if (box) {
      box.value = draft || '';
      if (focused) box.focus();
      var pos = box.value.length;
      try { box.setSelectionRange(pos, pos); } catch (e) {}
      box.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); sendLive(); } };
    }
    ctx.app.onclick = function (e) {
      if (e.target.closest('#msg-send')) sendLive();
    };
  }
  function sendLive() {
    var box = document.getElementById('msg-text');
    var text = root.WBCoaching ? root.WBCoaching.cleanBody(box && box.value) : String(box && box.value || '').trim();
    if (!text) return;
    var id = parts()[1];
    var btn = document.getElementById('msg-send');
    if (btn) btn.disabled = true;
    root.WBAuth.sendMessage(id, text).then(function () {
      if (box) box.value = '';
      loadThread(id, true);
    }).catch(function (err) {
      if (btn) btn.disabled = false;
      ctx.toast((err && err.message) || 'Could not send');
    });
  }
  function loadSend() {
    ctx.titleEl.textContent = 'Send workout';
    ctx.app.innerHTML = '<p class="mute">Loading…</p>';
    var auth = root.WBAuth;
    if (!auth || !auth.roster || !auth.sendWorkout) return showWait();
    var gen = live.gen;
    auth.roster().then(function (roster) {
      if (gen !== live.gen || parts()[0] !== 'send') return;
      if (!roster || !roster.role) return showWait(new Error('Only a trainer can send a workout.'));
      live.roster = roster;
      drawSend();
    }).catch(function (err) {
      if (gen !== live.gen || parts()[0] !== 'send') return;
      showWait(err);
    });
  }
  function ownWorkouts() {
    var list = ctx.workouts ? ctx.workouts() : [];
    return (list || []).filter(function (w) { return w && !w.sourceTrainerId; });
  }
  function chosenClients() {
    var clients = live.roster && live.roster.clients || [];
    return clients.filter(function (c) { return live.picked[c.id]; });
  }
  function drawSend() {
    var workouts = ownWorkouts();
    var clients = live.roster.clients || [];
    if (!live.pickedWorkout && workouts[0]) live.pickedWorkout = workouts[0].id;
    var h = '<p class="mute">Pick one of your workouts and the clients who should get a copy. A linked Enthusiast counts as a client.</p>';
    h += '<div class="name" style="margin:12px 0 8px">Workout</div>';
    if (!workouts.length) h += '<div class="empty">No workouts yet. Build one, then send it.</div>';
    workouts.forEach(function (w) {
      var on = w.id === live.pickedWorkout;
      h += '<button type="button" class="pick' + (on ? ' on' : '') + '" data-pick-workout="' + esc(w.id) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        '<span class="grow"><span class="name">' + esc(w.name) + '</span><span class="preview">' + w.items.length + ' exercise' + (w.items.length === 1 ? '' : 's') + '</span></span>' +
        '<span class="mark">' + (on ? '✓' : '') + '</span></button>';
    });
    h += '<div class="name" style="margin:14px 0 8px">Clients</div>';
    h += '<p class="mute">Each person gets their own copy. An Enthusiast can edit it. A Free Client can run it. Your workout stays as it is.</p>';
    if (!clients.length) h += '<p class="mute">No linked clients yet.</p>';
    clients.forEach(function (c) {
      var on = !!live.picked[c.id];
      h += '<button type="button" class="pick' + (on ? ' on' : '') + '" data-pick-client="' + esc(c.id) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        '<span class="ava" aria-hidden="true">' + esc(initials(c.email || 'Client')) + '</span>' +
        '<span class="grow"><span class="name">' + esc(c.email || 'Client') + '</span><span class="preview">' + esc(c.plan || 'Client') + ' · client</span></span>' +
        '<span class="mark">' + (on ? '✓' : '') + '</span></button>';
    });
    if (live.sent) h += '<div class="card" id="sent-note"><div class="name">Copies for their workouts</div><p>' + esc(live.sent) + '</p></div>';
    var n = chosenClients().length;
    h += '<button type="button" class="pri" id="send-go" data-send-workout style="width:100%;margin-top:8px"' + (n && live.pickedWorkout ? '' : ' disabled') + '>' +
      (n ? 'Send to ' + n + (n === 1 ? ' client' : ' clients') : 'Send workout') + '</button>';
    ctx.app.innerHTML = h;
    ctx.app.onclick = function (e) {
      var t = e.target.closest('[data-pick-workout], [data-pick-client], [data-send-workout]');
      if (!t || t.disabled) return;
      if (t.dataset.pickWorkout) { live.pickedWorkout = t.dataset.pickWorkout; live.sent = ''; return drawSend(); }
      if (t.dataset.pickClient) { live.picked[t.dataset.pickClient] = !live.picked[t.dataset.pickClient]; live.sent = ''; return drawSend(); }
      if (t.dataset.sendWorkout != null) return sendCopies();
    };
  }
  function nameList(list) {
    var names = list.map(function (c) { return c.email || 'Client'; });
    if (names.length === 1) return names[0];
    if (names.length === 2) return names[0] + ' and ' + names[1];
    return names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1];
  }
  function sendCopies() {
    var workout = null;
    ownWorkouts().forEach(function (w) { if (w.id === live.pickedWorkout) workout = w; });
    var clients = chosenClients();
    if (!workout || !clients.length) return ctx.toast('Choose a workout and at least one client.');
    var snap = root.WBCoaching.snapshot(workout);
    var btn = document.getElementById('send-go');
    if (btn) btn.disabled = true;
    root.WBAuth.sendWorkout(clients.map(function (c) { return c.id; }), snap.name, snap.items, snap.sourceWorkoutId).then(function () {
      var editors = clients.filter(function (c) { return /enthusiast/i.test(c.plan || ''); });
      var runners = clients.filter(function (c) { return !/enthusiast/i.test(c.plan || ''); });
      var bits = [];
      if (editors.length) bits.push(nameList(editors) + (editors.length > 1 ? ' each get' : ' gets') + ' an editable copy of ' + snap.name);
      if (runners.length) bits.push(nameList(runners) + (runners.length > 1 ? ' each get' : ' gets') + ' a copy of ' + snap.name + ' they can run');
      live.sent = bits.join('. ') + '. Your workout was not changed.';
      ctx.toast('Sent');
      drawSend();
    }).catch(function (err) {
      ctx.toast((err && err.message) || 'Could not send');
      drawSend();
    });
  }
  function loadReceived(id) {
    ctx.titleEl.textContent = 'Workouts';
    ctx.app.innerHTML = '<p class="mute">Loading…</p>';
    var auth = root.WBAuth;
    if (!auth || !auth.myWorkouts) return showWait();
    var gen = live.gen;
    auth.myWorkouts().then(function (list) {
      if (gen !== live.gen || parts()[0] !== 'received') return;
      if (ctx.applyCopies) ctx.applyCopies(list || []);
      var copies = (ctx.workouts ? ctx.workouts() : []).filter(function (w) { return w && w.sourceTrainerId; });
      if (id) return drawCopy(copies.filter(function (w) { return w.id === id; })[0] || null);
      drawReceived(copies);
    }).catch(function (err) {
      if (gen !== live.gen || parts()[0] !== 'received') return;
      showWait(err);
    });
  }
  function drawReceived(copies) {
    ctx.titleEl.textContent = 'Workouts';
    var h = '<p class="mute" id="received-lead">Workouts from your trainer land here as your own copy.</p>';
    if (!copies.length) h += '<div class="empty">No workouts from your trainer yet.</div>';
    copies.forEach(function (w) {
      var edit = root.WBCoaching.canEditCopy(ctx.profile, w);
      h += '<div class="card"><div class="row"><div class="name grow">' + esc(w.name) + '</div><span class="tag">From ' + esc(w.sourceTrainerEmail || 'your trainer') + '</span></div>';
      h += '<div class="mute">' + w.items.length + ' exercise' + (w.items.length === 1 ? '' : 's') + ' · ' + (edit ? 'You can edit it' : 'You can run it') + '</div>';
      h += '<div class="actions"><button type="button" class="pri sm" data-open-copy="' + esc(w.id) + '">Open</button>';
      if (w.items.length) h += '<button type="button" class="sm" data-run-copy="' + esc(w.id) + '">Run</button>';
      h += '</div></div>';
    });
    ctx.app.innerHTML = h;
    ctx.app.onclick = function (e) {
      var t = e.target.closest('[data-open-copy], [data-run-copy]');
      if (!t) return;
      if (t.dataset.runCopy) return ctx.go('#/play/' + t.dataset.runCopy);
      ctx.go('#/received/' + t.dataset.openCopy);
    };
  }
  function drawCopy(w) {
    if (!w) {
      ctx.app.innerHTML = '<div class="empty">That workout is not on this account.</div>';
      return;
    }
    var edit = root.WBCoaching.canEditCopy(ctx.profile, w);
    ctx.titleEl.textContent = w.name;
    if (edit) {
      try { sessionStorage.setItem('wb.copyReturn', '#/received'); } catch (e) {}
      return ctx.go('#/w/' + w.id);
    }
    var h = '<span class="tag">From ' + esc(w.sourceTrainerEmail || 'your trainer') + '</span>';
    h += '<p class="mute" id="copy-note">You can run this copy. Only an Enthusiast can edit it. Your trainer\'s workout stays as it is.</p>';
    (w.items || []).forEach(function (it) {
      var line = root.WB && root.WB.summarize ? root.WB.summarize(it) : '';
      h += '<div class="card"><div class="name">' + esc(it.name || 'Exercise') + '</div><div class="mute">' + esc(line) + '</div></div>';
    });
    if (w.items && w.items.length) h += '<button type="button" class="pri" id="copy-run" style="width:100%">Start</button>';
    ctx.app.innerHTML = h;
    ctx.app.onclick = function (e) {
      if (e.target.closest('#copy-run')) ctx.go('#/play/' + w.id);
    };
  }
  function loadClient(id) {
    ctx.titleEl.textContent = 'Client';
    ctx.app.innerHTML = '<p class="mute">Loading…</p>';
    var auth = root.WBAuth;
    if (!auth || !auth.clientView) return showWait();
    var gen = live.gen;
    auth.clientView(id).then(function (view) {
      if (gen !== live.gen || parts()[0] !== 'client') return;
      live.view = view;
      drawClient();
    }).catch(function (err) {
      if (gen !== live.gen) return;
      showWait(err);
    });
  }
  function drawClient() {
    var view = live.view || {};
    ctx.titleEl.textContent = view.email || 'Client';
    var h = '<p class="mute">' + esc(view.plan || '') + '</p>';
    if (!view.shared) {
      h += '<div class="card" id="client-view"><div class="name">Not shared</div><p class="mute">This client has not shared their own workouts and tracking. You still see it here only when an Enthusiast turns that on.</p></div>';
    } else {
      h += '<div id="client-view"><div class="name" style="margin-bottom:8px">Their workouts</div>';
      if (!view.workouts || !view.workouts.length) h += '<p class="mute">No workouts of their own yet.</p>';
      (view.workouts || []).forEach(function (w) {
        h += '<div class="card"><div class="name">' + esc(w.name) + '</div><div class="mute">' + (w.exerciseCount || 0) + ' exercises</div></div>';
      });
      h += '<div class="name" style="margin:12px 0 8px">Tracking</div>';
      if (!view.logs || !view.logs.length) h += '<p class="mute">No completed sessions yet.</p>';
      (view.logs || []).forEach(function (log) {
        h += '<div class="card"><div class="name">' + esc(log.workoutName || 'Session') + '</div><div class="mute">' + esc(whenLabel(log.endedAt)) + '</div></div>';
      });
      h += '</div>';
    }
    ctx.app.innerHTML = h;
    ctx.app.onclick = null;
  }

  root.WBConnect = { prefer: prefer, mount: mount };
})(typeof window !== 'undefined' ? window : this);
