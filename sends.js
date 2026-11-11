/* Send one workout to linked clients. Each person gets their own copy. No network. */
(function (root) {
  'use strict';

  function isEnthusiast(profile) {
    return !!(profile && (profile.membership === 'enthusiast' || profile.intended_plan === 'enthusiast'));
  }
  // A workout the person built stays editable. A trainer's copy is editable only for an Enthusiast.
  function canEditCopy(profile, workout) {
    if (!workout || !workout.sourceTrainerId) return true;
    return isEnthusiast(profile);
  }
  function stamp(value) {
    if (typeof value === 'number' && isFinite(value)) return value;
    var n = Date.parse(value || '');
    return isNaN(n) ? 0 : n;
  }
  function serverId(id) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''));
  }
  function selectionKey(workoutId, clientIds) {
    return String(workoutId || '') + '\n' + (clientIds || []).map(function (id) { return String(id); }).sort().join(',');
  }
  function snapshot(workout) {
    var items = [];
    try { items = JSON.parse(JSON.stringify(workout && workout.items || [])); } catch (e) { items = []; }
    return {
      sourceWorkoutId: String(workout && workout.id || ''),
      name: String(workout && workout.name || '').trim() || 'Workout',
      items: items
    };
  }
  // Same workout, same people, and the same contents keep the ids from the failed try.
  // A different workout, recipient, or edit is a new send and gets new ids.
  function prepareDeliveries(prev, workout, clientIds, makeId) {
    var ids = (clientIds || []).map(function (id) { return String(id); });
    var key = selectionKey(workout && workout.id, ids);
    var snap = snapshot(workout);
    var samePeople = !!(prev && prev.key === key && prev.ids && ids.length === Object.keys(prev.ids).length && ids.every(function (id) { return prev.ids[id]; }));
    var samePayload = samePeople && prev.name === snap.name && JSON.stringify(prev.items) === JSON.stringify(snap.items);
    if (samePayload) {
      return {
        key: key,
        workoutId: String(workout.id || ''),
        clientIds: ids.slice(),
        ids: prev.ids,
        name: prev.name,
        items: prev.items,
        sourceWorkoutId: prev.sourceWorkoutId
      };
    }
    var map = {};
    ids.forEach(function (id) { map[id] = makeId(); });
    return {
      key: key,
      workoutId: String(workout && workout.id || ''),
      clientIds: ids.slice(),
      ids: map,
      name: snap.name,
      items: snap.items,
      sourceWorkoutId: snap.sourceWorkoutId
    };
  }
  function sendBlocked(inflight, key) {
    return !!(inflight && inflight.key === key);
  }
  function asCopy(remote) {
    var items = [];
    try { items = JSON.parse(JSON.stringify(remote && remote.items || [])); } catch (e) { items = []; }
    return {
      id: String(remote.id),
      name: remote.name || 'Workout',
      items: items,
      sourceTrainerId: remote.sourceTrainerId,
      sourceTrainerEmail: remote.sourceTrainerEmail || '',
      sourceWorkoutId: remote.sourceWorkoutId || '',
      createdAt: stamp(remote.createdAt || remote.updatedAt),
      updatedAt: stamp(remote.updatedAt)
    };
  }
  // Own workouts stay put. Server copies refresh. A copy deleted here stays deleted.
  // A Free Client does not keep a local edit ahead of the server copy.
  function mergeCopies(local, remote, opts) {
    opts = opts || {};
    var canEdit = !!opts.canEdit;
    var gone = {};
    (opts.removed || []).forEach(function (id) { if (id) gone[String(id)] = 1; });
    var incoming = {};
    (remote || []).forEach(function (row) {
      if (row && row.id && !gone[String(row.id)]) incoming[String(row.id)] = row;
    });
    var seen = {};
    var next = [];
    (local || []).forEach(function (w) {
      if (!w) return;
      if (!w.sourceTrainerId) { next.push(w); return; }
      var row = incoming[String(w.id)];
      if (!row) {
        if (!serverId(w.id)) next.push(w);
        return;
      }
      seen[String(w.id)] = 1;
      var copy = asCopy(row);
      if (canEdit && (w.updatedAt || 0) > copy.updatedAt) next.push(w);
      else next.push(copy);
    });
    (remote || []).forEach(function (row) {
      if (!row || !row.id || seen[String(row.id)] || gone[String(row.id)]) return;
      next.push(asCopy(row));
    });
    return next;
  }
  function nameList(list) {
    var names = list.map(function (c) { return c.email || c.name || 'Client'; });
    if (names.length <= 1) return names[0] || 'Client';
    if (names.length === 2) return names[0] + ' and ' + names[1];
    return names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1];
  }
  function confirmation(clients, workoutName) {
    var editors = [], runners = [];
    (clients || []).forEach(function (c) {
      if (/enthusiast/i.test((c && c.plan) || '')) editors.push(c);
      else runners.push(c);
    });
    var bits = [];
    if (editors.length) bits.push(nameList(editors) + (editors.length > 1 ? ' each get' : ' gets') + ' an editable copy of ' + workoutName);
    if (runners.length) bits.push(nameList(runners) + (runners.length > 1 ? ' each get' : ' gets') + ' a copy of ' + workoutName + ' they can run');
    if (!bits.length) return '';
    return bits.join('. ') + '. Your workout was not changed.';
  }
  function isUnavailable(err) {
    return !!(err && /not available yet|not ready/i.test(String(err.message || '')));
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function initials(name) {
    var local = String(name || '').split('@')[0].replace(/[^a-z0-9]/gi, '');
    if (local.length >= 2) return local.slice(0, 2).toUpperCase();
    return (String(name || '?').charAt(0) || '?').toUpperCase();
  }
  function newId() {
    var c = (root && root.crypto) || (typeof crypto !== 'undefined' ? crypto : null);
    if (c && c.randomUUID) return c.randomUUID();
    var hex = '';
    for (var i = 0; i < 32; i++) hex += Math.floor(Math.random() * 16).toString(16);
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-4' + hex.slice(13, 16) + '-a' + hex.slice(17, 20) + '-' + hex.slice(20, 32);
  }
  function pageName() {
    var raw = (typeof location !== 'undefined' && location.hash) ? location.hash : '';
    return raw.replace(/^#\/?/, '').split('?')[0].split('/')[0] || '';
  }
  function receivedId() {
    var raw = (typeof location !== 'undefined' && location.hash) ? location.hash : '';
    var parts = raw.replace(/^#\/?/, '').split('?')[0].split('/');
    if (parts[0] !== 'received' || !parts[1]) return '';
    try { return decodeURIComponent(parts[1]); } catch (e) { return parts[1]; }
  }
  function lockedHtml(w) {
    var h = '<span class="tag">From ' + esc(w.sourceTrainerEmail || 'your trainer') + '</span>';
    h += '<p class="mute" id="copy-note">You can run this copy. Only an Enthusiast can edit it. Your trainer\'s workout stays as it is.</p>';
    (w.items || []).forEach(function (it) {
      var line = '';
      try { if (root.WB && root.WB.summarize) line = root.WB.summarize(it); } catch (e) { line = ''; }
      h += '<div class="card"><div class="name">' + esc(it.name || 'Exercise') + '</div>' +
        (line ? '<div class="mute">' + esc(line) + '</div>' : '') + '</div>';
    });
    if (w.items && w.items.length) h += '<button type="button" class="pri" id="copy-run" style="width:100%">Start</button>';
    return h;
  }

  var ctx = null, gen = 0, roster = null, pickedWorkout = '', picked = {}, attempts = {}, notes = {}, inflight = null, sendToken = 0;

  function stop() {
    gen += 1;
    ctx = null;
  }
  function ownWorkouts() {
    var list = ctx && ctx.workouts ? ctx.workouts() : [];
    return (list || []).filter(function (w) { return w && !w.sourceTrainerId; });
  }
  function chosenClients() {
    var clients = (roster && roster.clients) || [];
    return clients.filter(function (c) { return c && picked[c.id]; });
  }
  function currentKey() {
    return selectionKey(pickedWorkout, chosenClients().map(function (c) { return c.id; }));
  }
  function selectedWorkout() {
    var list = ownWorkouts();
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(pickedWorkout)) return list[i];
    return null;
  }
  function profileNow() {
    return ctx && ctx.profile ? ctx.profile() : null;
  }
  function showUnavailable(err) {
    if (!ctx) return;
    ctx.titleEl.textContent = pageName() === 'send' ? 'Send workout' : 'Workouts';
    ctx.backBtn.hidden = false;
    var detail = (err && err.message) || 'Sending workouts is not available yet. Apply the workout SQL in the Supabase SQL editor.';
    ctx.app.innerHTML = '<div class="card" id="feature-wait"><div class="name">Not available yet</div><p class="mute">' + esc(detail) + '</p></div>';
    ctx.app.onclick = null;
  }
  function showOnlyTrainer() {
    if (!ctx) return;
    ctx.titleEl.textContent = 'Send workout';
    ctx.backBtn.hidden = false;
    ctx.app.innerHTML = '<div class="card" id="send-locked"><div class="name">Only a trainer can send a workout</div>' +
      '<p class="mute">A linked client gets their own copy. An Enthusiast can edit that copy. A Free Client can run it.</p></div>';
    ctx.app.onclick = null;
  }
  function syncButton() {
    if (!ctx || pageName() !== 'send' || typeof document === 'undefined') return;
    var btn = document.getElementById('send-go');
    if (!btn) return;
    var n = chosenClients().length;
    var blocked = sendBlocked(inflight, currentKey());
    btn.disabled = !!(blocked || !n || !pickedWorkout);
  }
  function drawSend() {
    if (!ctx) return;
    var workouts = ownWorkouts();
    var clients = (roster && roster.clients) || [];
    if (!pickedWorkout || !workouts.some(function (w) { return String(w.id) === String(pickedWorkout); })) {
      pickedWorkout = workouts[0] ? workouts[0].id : '';
    }
    ctx.titleEl.textContent = 'Send workout';
    ctx.backBtn.hidden = false;
    var h = '<p class="mute">Pick one of your workouts and the clients who should get a copy. A linked Enthusiast counts as a client.</p>';
    h += '<div class="name" style="margin:12px 0 8px">Workout</div>';
    if (!workouts.length) h += '<div class="empty">No workouts yet. Build one, then send it.</div>';
    workouts.forEach(function (w) {
      var on = String(w.id) === String(pickedWorkout);
      var n = (w.items || []).length;
      h += '<button type="button" class="pick' + (on ? ' on' : '') + '" data-pick-workout="' + esc(w.id) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        '<span class="grow"><span class="name">' + esc(w.name) + '</span><span class="preview">' + n + ' exercise' + (n === 1 ? '' : 's') + '</span></span>' +
        '<span class="mark" aria-hidden="true">' + (on ? '✓' : '') + '</span></button>';
    });
    h += '<div class="name" style="margin:14px 0 8px">Clients</div>';
    h += '<p class="mute">Each person gets their own copy. An Enthusiast can edit it. A Free Client can run it. Your workout stays as it is.</p>';
    if (!clients.length) h += '<p class="mute">No linked clients yet.</p>';
    clients.forEach(function (c) {
      var on = !!picked[c.id];
      h += '<button type="button" class="pick' + (on ? ' on' : '') + '" data-pick-client="' + esc(c.id) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        '<span class="ava" aria-hidden="true">' + esc(initials(c.email || 'Client')) + '</span>' +
        '<span class="grow"><span class="name">' + esc(c.email || 'Client') + '</span><span class="preview">' + esc(c.plan || 'Client') + ' · client</span></span>' +
        '<span class="mark" aria-hidden="true">' + (on ? '✓' : '') + '</span></button>';
    });
    var key = currentKey();
    if (notes[key]) h += '<div class="card" id="sent-note"><div class="name">Copies for their workouts</div><p>' + esc(notes[key]) + '</p></div>';
    var n = chosenClients().length;
    var blocked = sendBlocked(inflight, key);
    h += '<button type="button" class="pri" id="send-go" data-send-workout style="width:100%;margin-top:8px"' +
      ((blocked || !n || !pickedWorkout) ? ' disabled' : '') + '>' +
      (n ? ('Send to ' + n + (n === 1 ? ' client' : ' clients')) : 'Send workout') + '</button>';
    ctx.app.innerHTML = h;
    ctx.app.onclick = onSendClick;
  }
  function onSendClick(e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-pick-workout], [data-pick-client], [data-send-workout]') : null;
    if (!t || t.disabled) return;
    if (t.dataset.pickWorkout) { pickedWorkout = t.dataset.pickWorkout; return drawSend(); }
    if (t.dataset.pickClient) { picked[t.dataset.pickClient] = !picked[t.dataset.pickClient]; return drawSend(); }
    if (t.dataset.sendWorkout != null) return sendCopies();
  }
  function finish(token, key, err, note) {
    var mine = !!(inflight && inflight.token === token);
    if (mine) inflight = null;
    if (!err) {
      delete attempts[key];
      if (note) notes[key] = note;
    }
    // A newer send owns the screen. This result must not redraw it or clear its lock.
    if (!mine) return;
    if (!ctx || pageName() !== 'send') return;
    if (!roster) return;
    if (currentKey() !== key) {
      if (err && ctx.toast) ctx.toast((err && err.message) || 'Could not send');
      syncButton();
      return;
    }
    if (err) ctx.toast((err && err.message) || 'Could not send');
    else if (ctx.toast) ctx.toast('Sent');
    drawSend();
  }
  function sendCopies() {
    var workout = selectedWorkout();
    var clients = chosenClients();
    if (!workout || !clients.length) {
      if (ctx && ctx.toast) ctx.toast('Choose a workout and at least one client.');
      return;
    }
    var ids = clients.map(function (c) { return String(c.id); });
    var key = selectionKey(workout.id, ids);
    if (sendBlocked(inflight, key)) return;
    var delivery = prepareDeliveries(attempts[key], workout, ids, newId);
    attempts[key] = delivery;
    delete notes[key];
    var token = ++sendToken;
    inflight = { token: token, key: key };
    var auth = root.WBAuth;
    if (!auth || !auth.sendWorkout) {
      inflight = null;
      return showUnavailable();
    }
    var deliveries = ids.map(function (id) { return { id: delivery.ids[id], clientId: id }; });
    var payload = { deliveries: deliveries, name: delivery.name, items: delivery.items, source: delivery.sourceWorkoutId };
    var people = clients.map(function (c) { return { id: c.id, email: c.email, plan: c.plan }; });
    drawSend();
    // The request belongs to this workout and these people. Settling it is what
    // turns the button back on. A timer must not call a slow success a failure.
    Promise.resolve().then(function () {
      return auth.sendWorkout(payload.deliveries, payload.name, payload.items, payload.source);
    }).then(function () {
      finish(token, key, null, confirmation(people, payload.name));
    }, function (err) {
      finish(token, key, err || new Error('Could not send'));
    });
  }
  function loadSend() {
    var myGen = gen;
    roster = null;
    if (!ctx) return;
    ctx.titleEl.textContent = 'Send workout';
    ctx.backBtn.hidden = false;
    ctx.app.innerHTML = '<p class="mute">Loading…</p>';
    ctx.app.onclick = null;
    var auth = root.WBAuth;
    if (!auth || !auth.roster || !auth.sendWorkout || !auth.workoutCopies) return showUnavailable();
    Promise.all([
      Promise.resolve().then(function () { return auth.roster(); }).then(function (v) { return v; }, function (err) { return { __err: err }; }),
      Promise.resolve().then(function () { return auth.workoutCopies(); }).then(function () { return { ok: true }; }, function (err) { return { __err: err }; })
    ]).then(function (pair) {
      if (!ctx || myGen !== gen || pageName() !== 'send') return;
      var rosterRes = pair[0], probe = pair[1];
      if (probe.__err && isUnavailable(probe.__err)) return showUnavailable(probe.__err);
      if (rosterRes && rosterRes.__err) {
        ctx.app.innerHTML = '<div class="errs" id="send-error">' + esc(rosterRes.__err.message || 'Could not load clients') + '</div>';
        ctx.app.onclick = null;
        return;
      }
      if (!rosterRes || !rosterRes.role) return showOnlyTrainer();
      if (probe.__err) {
        ctx.app.innerHTML = '<div class="errs" id="send-error">' + esc(probe.__err.message || 'Could not send a workout') + '</div>';
        ctx.app.onclick = null;
        return;
      }
      roster = rosterRes;
      drawSend();
    });
  }
  function copiesNow() {
    var list = ctx && ctx.workouts ? ctx.workouts() : [];
    return (list || []).filter(function (w) { return w && w.sourceTrainerId; });
  }
  function drawList(copies) {
    if (!ctx) return;
    var profile = profileNow();
    ctx.titleEl.textContent = 'Workouts';
    ctx.backBtn.hidden = false;
    var h = '<p class="mute" id="received-lead">Workouts from your trainer land here as your own copy.</p>';
    if (!copies.length) h += '<div class="empty" id="received-empty">No workouts from your trainer yet.</div>';
    copies.forEach(function (w) {
      var edit = canEditCopy(profile, w);
      var n = (w.items || []).length;
      h += '<div class="card" data-copy="' + esc(w.id) + '"><div class="row"><div class="name grow">' + esc(w.name) + '</div>' +
        '<span class="tag">From ' + esc(w.sourceTrainerEmail || 'your trainer') + '</span></div>';
      h += '<div class="mute">' + n + ' exercise' + (n === 1 ? '' : 's') + ' · ' + (edit ? 'You can edit it' : 'You can run it') + '</div>';
      h += '<div class="actions"><button type="button" class="pri sm" data-open-copy="' + esc(w.id) + '">Open</button>';
      if (n) h += '<button type="button" class="sm" data-run-copy="' + esc(w.id) + '">Run</button>';
      h += '</div></div>';
    });
    ctx.app.innerHTML = h;
    ctx.app.onclick = function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-open-copy], [data-run-copy]') : null;
      if (!t || !ctx) return;
      try { sessionStorage.setItem('wb.copyReturn', '#/received'); } catch (err) {}
      if (t.dataset.runCopy) return ctx.go('#/play/' + t.dataset.runCopy);
      var w = null;
      copies.forEach(function (item) { if (String(item.id) === t.dataset.openCopy) w = item; });
      if (w && canEditCopy(profile, w)) return ctx.go('#/w/' + t.dataset.openCopy);
      ctx.go('#/received/' + t.dataset.openCopy);
    };
  }
  function drawOne(w) {
    if (!ctx) return;
    if (!w) {
      ctx.titleEl.textContent = 'Workouts';
      ctx.app.innerHTML = '<div class="empty">That workout is not on this account.</div>';
      ctx.app.onclick = null;
      return;
    }
    if (canEditCopy(profileNow(), w)) {
      try { sessionStorage.setItem('wb.copyReturn', '#/received'); } catch (e) {}
      return ctx.go('#/w/' + w.id);
    }
    ctx.titleEl.textContent = w.name;
    ctx.backBtn.hidden = false;
    ctx.app.innerHTML = lockedHtml(w);
    ctx.app.onclick = function (e) {
      if (e.target && e.target.closest && e.target.closest('#copy-run')) ctx.go('#/play/' + w.id);
    };
  }
  function loadReceived() {
    var myGen = gen;
    var id = receivedId();
    if (!ctx) return;
    ctx.titleEl.textContent = 'Workouts';
    ctx.backBtn.hidden = false;
    ctx.app.innerHTML = '<p class="mute">Loading…</p>';
    ctx.app.onclick = null;
    var auth = root.WBAuth;
    if (!auth || !auth.workoutCopies) return showUnavailable();
    Promise.resolve().then(function () { return auth.workoutCopies(); }).then(function (list) {
      if (!ctx || myGen !== gen || pageName() !== 'received') return;
      if (ctx.applyCopies) ctx.applyCopies(list || []);
      var copies = copiesNow();
      if (id) return drawOne(copies.filter(function (w) { return String(w.id) === String(id); })[0] || null);
      drawList(copies);
    }, function (err) {
      if (!ctx || myGen !== gen || pageName() !== 'received') return;
      if (isUnavailable(err)) return showUnavailable(err);
      ctx.titleEl.textContent = 'Workouts';
      ctx.app.innerHTML = '<div class="errs" id="received-error">' + esc((err && err.message) || 'Could not load workouts') + '</div>';
      ctx.app.onclick = null;
    });
  }
  function mount(next) {
    gen += 1;
    ctx = next || null;
    if (!ctx) return;
    ctx.backBtn.hidden = false;
    if (pageName() === 'received') loadReceived();
    else loadSend();
  }

  var api = {
    canEditCopy: canEditCopy,
    stamp: stamp,
    serverId: serverId,
    selectionKey: selectionKey,
    snapshot: snapshot,
    prepareDeliveries: prepareDeliveries,
    sendBlocked: sendBlocked,
    mergeCopies: mergeCopies,
    confirmation: confirmation,
    isUnavailable: isUnavailable,
    lockedHtml: lockedHtml,
    mount: mount,
    stop: stop
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WBSends = api;
})(typeof window !== 'undefined' ? window : globalThis);
