/* Visual pass only. Sample people and workouts, held in memory. No network and no saved workouts. */
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
    role = resolveRole(next.profile);
    render();
  }
  root.WBConnect = { prefer: prefer, mount: mount };
})(typeof window !== 'undefined' ? window : this);
