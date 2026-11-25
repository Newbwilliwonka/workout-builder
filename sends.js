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
  function selectionKey(workoutIds, clientIds) {
    var list = Array.isArray(workoutIds) ? workoutIds : [workoutIds];
    return list.map(function (id) { return String(id || ''); }).filter(Boolean).sort().join(',') +
      '\n' + (clientIds || []).map(function (id) { return String(id); }).sort().join(',');
  }
  function sendLabel(workoutCount, clientCount) {
    function word(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
    return 'Send ' + word(workoutCount || 0, 'workout', 'workouts') + ' to ' + word(clientCount || 0, 'client', 'clients');
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
    var trainerName = remote.sourceTrainerName || '';
    if (String(trainerName).indexOf('@') !== -1) trainerName = '';
    return {
      id: String(remote.id),
      name: remote.name || 'Workout',
      items: items,
      sourceTrainerId: remote.sourceTrainerId,
      sourceTrainerName: trainerName,
      sourceTrainerVerified: !!remote.sourceTrainerVerified,
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
      if (canEdit && (w.updatedAt || 0) > copy.updatedAt) {
        delete w.sourceTrainerEmail;
        if (w.sourceTrainerName && String(w.sourceTrainerName).indexOf('@') !== -1) delete w.sourceTrainerName;
        if (copy.sourceTrainerVerified) w.sourceTrainerVerified = true;
        else delete w.sourceTrainerVerified;
        next.push(w);
      } else next.push(copy);
    });
    (remote || []).forEach(function (row) {
      if (!row || !row.id || seen[String(row.id)] || gone[String(row.id)]) return;
      next.push(asCopy(row));
    });
    return next;
  }
  function personName(c) {
    if (root.WBProfile && root.WBProfile.label) {
      var labeled = root.WBProfile.label(c);
      if (labeled) return labeled;
    }
    var raw = c && String(c.display_name || c.name || '').replace(/^\s+|\s+$/g, '');
    if (raw && raw.indexOf('@') === -1) return raw;
    var plan = String((c && (c.plan || c.membership)) || '');
    if (/enthusiast/i.test(plan)) return 'Enthusiast';
    if (/trainer/i.test(plan)) return 'Trainer';
    return 'Client';
  }
  function nameList(list) {
    var names = list.map(personName);
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
  function toneOf(name) {
    var s = String(name || '');
    var n = 0;
    for (var i = 0; i < s.length; i++) n += s.charCodeAt(i);
    return 'c' + ((n % 7) + 1);
  }
  function initials(name) {
    var raw = String(name || '').trim();
    if (!raw || raw.indexOf('@') !== -1) return '?';
    var bits = raw.split(/\s+/).filter(Boolean);
    if (bits.length >= 2) return (bits[0].charAt(0) + bits[1].charAt(0)).toUpperCase();
    var compact = raw.replace(/[^a-z0-9]/gi, '');
    if (compact.length >= 2) return compact.slice(0, 2).toUpperCase();
    return (raw.charAt(0) || '?').toUpperCase();
  }
  function trainerTag(w) {
    if (root.WBProfile && root.WBProfile.fromTrainerHtml) return root.WBProfile.fromTrainerHtml(w);
    var name = w && String(w.sourceTrainerName || '').replace(/^\s+|\s+$/g, '');
    if (!name || name.indexOf('@') !== -1) name = 'Trainer';
    return esc(name);
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
    var h = '<p class="mute" id="copy-note">You can run this copy. Only an Enthusiast can edit it. Your trainer\'s workout stays as it is.</p>';
    (w.items || []).forEach(function (it) {
      var line = '';
      try { if (root.WB && root.WB.summarize) line = root.WB.summarize(it); } catch (e) { line = ''; }
      h += '<div class="card"><div class="name">' + esc(it.name || 'Exercise') + '</div>' +
        (line ? '<div class="mute">' + esc(line) + '</div>' : '') + '</div>';
    });
    if (w.items && w.items.length) h += '<button type="button" class="pri" id="copy-run" style="width:100%">Start</button>';
    return h;
  }

  var ctx = null, gen = 0, roster = null, pickedWorkouts = {}, picked = {}, attempts = {}, inflight = null, sendToken = 0, sentKey = '', sendError = '', presetDone = false;

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
  function chosenWorkouts() {
    return ownWorkouts().filter(function (w) { return pickedWorkouts[String(w.id)]; });
  }
  function currentKey() {
    return selectionKey(chosenWorkouts().map(function (w) { return w.id; }), chosenClients().map(function (c) { return c.id; }));
  }
  function hashWorkoutId() {
    var raw = (typeof location !== 'undefined' && location.hash) ? location.hash : '';
    var parts = raw.replace(/^#\/?/, '').split('?')[0].split('/');
    if (parts[0] !== 'send' || !parts[1]) return '';
    try { return decodeURIComponent(parts[1]); } catch (e) { return parts[1]; }
  }
  function ensurePreset() {
    if (presetDone) return;
    presetDone = true;
    var id = hashWorkoutId();
    if (id) pickedWorkouts[String(id)] = true;
  }
  function sendLabelNow() {
    return sendLabel(chosenWorkouts().length, chosenClients().length);
  }
  function buttonState() {
    var key = currentKey();
    var sameFlight = !!(inflight && inflight.key === key);
    if (sentKey && sentKey === key && !sameFlight) return { label: 'Sent', disabled: true, sent: true };
    var workouts = chosenWorkouts().length;
    var clients = chosenClients().length;
    return { label: sendLabelNow(), disabled: !!(sameFlight || !workouts || !clients), sent: false };
  }
  function clearSent() {
    sentKey = '';
    sendError = '';
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
    var state = buttonState();
    btn.disabled = state.disabled;
    btn.textContent = state.label;
    btn.classList.toggle('pri', !state.sent);
  }
  function drawSend() {
    if (!ctx) return;
    ensurePreset();
    var workouts = ownWorkouts();
    var clients = (roster && roster.clients) || [];
    Object.keys(pickedWorkouts).forEach(function (id) {
      if (!workouts.some(function (w) { return String(w.id) === String(id); })) delete pickedWorkouts[id];
    });
    ctx.titleEl.textContent = 'Send workout';
    ctx.backBtn.hidden = false;
    var h = '<p class="mute">Pick one or more of your workouts and the clients who should get a copy. A linked Enthusiast counts as a client.</p>';
    h += '<div class="sec">Workout</div><div class="list pick-list">';
    if (!workouts.length) h += '<div class="empty">No workouts yet. Build one, then send it.</div>';
    workouts.forEach(function (w) {
      var on = !!pickedWorkouts[String(w.id)];
      var n = (w.items || []).length;
      h += '<button type="button" class="pick' + (on ? ' on' : '') + '" data-pick-workout="' + esc(w.id) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        '<span class="grow"><span class="name">' + esc(w.name) + '</span><span class="preview">' + n + ' exercise' + (n === 1 ? '' : 's') + '</span></span>' +
        '<span class="mark" aria-hidden="true">' + (on ? '✓' : '') + '</span></button>';
    });
    h += '</div><div class="sec">Clients</div>';
    h += '<p class="mute">Each person gets their own copy. An Enthusiast can edit it. A Free Client can run it. Your workout stays as it is.</p>';
    if (!clients.length) h += '<p class="mute">No linked clients yet.</p>';
    h += '<div class="list pick-list">';
    clients.forEach(function (c) {
      var on = !!picked[c.id];
      h += '<button type="button" class="pick' + (on ? ' on' : '') + '" data-pick-client="' + esc(c.id) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        '<span class="av ' + toneOf(personName(c)) + '" data-avatar-path="' + esc(c.avatarPath || '') + '" aria-hidden="true">' + esc(initials(personName(c))) + '</span>' +
        '<span class="grow"><span class="name">' + esc(personName(c)) + '</span><span class="preview">' + esc(c.plan || 'Client') + ' · client</span></span>' +
        '<span class="mark" aria-hidden="true">' + (on ? '✓' : '') + '</span></button>';
    });
    h += '</div>';
    if (sendError) h += '<p class="errs" id="send-fail">' + esc(sendError) + '</p>';
    var state = buttonState();
    h += '<button type="button"' + (state.sent ? '' : ' class="pri"') + ' id="send-go" data-send-workout style="width:100%;margin-top:8px"' +
      (state.disabled ? ' disabled' : '') + '>' + esc(state.label) + '</button>';
    ctx.app.innerHTML = h;
    ctx.app.onclick = onSendClick;
    if (root.WBProfile) WBProfile.fillAvatars(ctx.app);
  }
  function onSendClick(e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-pick-workout], [data-pick-client], [data-send-workout]') : null;
    if (!t || t.disabled) return;
    if (t.dataset.pickWorkout) {
      pickedWorkouts[t.dataset.pickWorkout] = !pickedWorkouts[t.dataset.pickWorkout];
      clearSent();
      return drawSend();
    }
    if (t.dataset.pickClient) {
      picked[t.dataset.pickClient] = !picked[t.dataset.pickClient];
      clearSent();
      return drawSend();
    }
    if (t.dataset.sendWorkout != null) return sendCopies();
  }
  function forgetAttempts(key) {
    var parts = String(key || '').split('\n');
    var workouts = (parts[0] || '').split(',').filter(Boolean);
    var clients = parts[1] || '';
    workouts.forEach(function (id) { delete attempts[id + '\n' + clients]; });
  }
  function finish(token, key, err) {
    var mine = !!(inflight && inflight.token === token);
    if (mine) inflight = null;
    if (!err) forgetAttempts(key);
    // A newer send owns the screen. This result must not redraw it or clear its lock.
    // The older send still finishes every workout, and a failure is still reported.
    if (!mine) {
      if (err && ctx && ctx.toast) ctx.toast((err && err.message) || 'Could not send');
      return;
    }
    if (!ctx || pageName() !== 'send') return;
    if (!roster) return;
    if (currentKey() !== key) {
      if (err && ctx.toast) ctx.toast((err && err.message) || 'Could not send');
      syncButton();
      return;
    }
    if (err) {
      sendError = (err && err.message) || 'Could not send';
      if (ctx.toast) ctx.toast(sendError);
    } else {
      sendError = '';
      sentKey = key;
      if (ctx.toast) ctx.toast('Sent');
    }
    drawSend();
  }
  function sendCopies() {
    var workouts = chosenWorkouts();
    var clients = chosenClients();
    if (!workouts.length || !clients.length) return;
    var ids = clients.map(function (c) { return String(c.id); });
    var key = currentKey();
    if (sentKey === key) return;
    if (sendBlocked(inflight, key)) return;
    sendError = '';
    var token = ++sendToken;
    inflight = { token: token, key: key };
    var auth = root.WBAuth;
    if (!auth || !auth.sendWorkout) {
      inflight = null;
      return showUnavailable();
    }
    var plan = workouts.map(function (workout) {
      var oneKey = selectionKey(workout.id, ids);
      var delivery = prepareDeliveries(attempts[oneKey], workout, ids, newId);
      attempts[oneKey] = delivery;
      return {
        key: oneKey,
        deliveries: ids.map(function (id) { return { id: delivery.ids[id], clientId: id }; }),
        name: delivery.name,
        items: delivery.items,
        source: delivery.sourceWorkoutId
      };
    });
    drawSend();
    var index = 0;
    function step() {
      if (index >= plan.length) return finish(token, key, null);
      var item = plan[index];
      Promise.resolve().then(function () {
        return auth.sendWorkout(item.deliveries, item.name, item.items, item.source);
      }).then(function () {
        index += 1;
        step();
      }, function (err) {
        finish(token, key, err || new Error('Could not send'));
      });
    }
    step();
  }
  function loadSend() {
    var myGen = gen;
    roster = null;
    presetDone = false;
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
    var h = '<p class="mute" id="received-lead">Workouts from your trainer land here. View plays your workout without tracking. Run tracks your actual workout and saves it in History.</p>';
    if (!copies.length) h += '<div class="empty" id="received-empty">No workouts from your trainer yet.</div>';
    copies.forEach(function (w) {
      var edit = canEditCopy(profile, w);
      var n = (w.items || []).length;
      h += '<div class="card" data-copy="' + esc(w.id) + '"><div class="name">' + esc(w.name) + '</div>';
      h += '<div class="mute">' + n + ' exercise' + (n === 1 ? '' : 's') + ' · ' + (edit ? 'You can edit it' : 'You can run it') + '</div>';
      h += '<div class="actions">';
      if (edit) h += '<button type="button" class="pri sm" data-open-copy="' + esc(w.id) + '">Edit</button>';
      if (n) h += '<button type="button" class="sm" data-view-copy="' + esc(w.id) + '">View</button>';
      if (n) h += '<button type="button" class="sm" data-run-copy="' + esc(w.id) + '">Run</button>';
      h += '</div></div>';
    });
    ctx.app.innerHTML = h;
    if (ctx.markSeen) ctx.markSeen(copies.map(function (w) { return w.id; }));
    ctx.app.onclick = function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-open-copy], [data-run-copy], [data-view-copy]') : null;
      if (!t || !ctx) return;
      try { sessionStorage.setItem('wb.copyReturn', '#/received'); } catch (err) {}
      if (t.dataset.viewCopy) return ctx.go('#/view/' + t.dataset.viewCopy);
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
    sendLabel: sendLabel,
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
