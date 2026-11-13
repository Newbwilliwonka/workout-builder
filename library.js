/* Account workout sync. No network. Browser: window.WBLibrary. Node: require.
   The account is the shared copy. The device keeps its own copy so a workout
   still opens with no signal. The later edit wins. A workout is removed only
   when this device recorded that the user pressed Delete, or the account
   already has that delete. Signing in, a pull, or another device must not
   invent a removal. */
(function (root) {
  'use strict';

  var CLAIM_KEY = 'wb.accountClaimed.v1';
  var DROP_KEY = 'wb.accountDropped.v1';
  var QUEUE_KEY = 'wb.clientQueue.v1';

  function ms(value) {
    if (typeof value === 'number' && isFinite(value)) return value;
    var n = Date.parse(value || '');
    return isNaN(n) ? 0 : n;
  }
  function clone(value) {
    try { return JSON.parse(JSON.stringify(value == null ? [] : value)); }
    catch (e) { return []; }
  }
  function ownWorkout(w) {
    return !!(w && w.id && !w.sourceTrainerId && !w.remoteOwnerId);
  }
  function ownWorkouts(list) {
    return (list || []).filter(ownWorkout);
  }
  function isDeleted(row) {
    return !!(row && (row.deleted === true || row.deleted === 'true'));
  }
  function dropTime(value) {
    if (value && typeof value === 'object') return ms(value.at);
    return ms(value);
  }
  // Only the Delete button writes one of these. A bare timestamp left behind
  // by an older sync is not treated as a delete.
  function isUserDrop(value) {
    return !!(value && typeof value === 'object' && value.byUser === true && dropTime(value));
  }
  function userDrop(at) {
    var stamp = ms(at);
    if (!stamp) return null;
    return { at: stamp, byUser: true };
  }
  function serverDrop(at) {
    var stamp = ms(at);
    if (!stamp) return null;
    return { at: stamp, byUser: false };
  }
  // revisedAt is the content clock. updatedAt, when the account sends it, is
  // when the row was actually saved. An imported workout can carry an older
  // revisedAt than the moment it was stored.
  function contentTime(row) {
    return ms(row && row.revisedAt);
  }
  function writtenTime(row) {
    return Math.max(contentTime(row), ms(row && row.updatedAt));
  }
  function keepDrop(drops, id, value) {
    if (isUserDrop(value)) drops[id] = userDrop(dropTime(value));
    else if (value && typeof value === 'object' && value.byUser === false && dropTime(value)) {
      drops[id] = serverDrop(dropTime(value));
    }
  }
  function changeFrom(w, deleted, revisedAt) {
    var at = revisedAt == null ? ms(w && w.updatedAt) : ms(revisedAt);
    if (!at) at = Date.now();
    return {
      localId: String(w && w.id || ''),
      name: String(w && w.name || 'Workout'),
      items: deleted ? [] : clone(w && w.items || []),
      revisedAt: at,
      deleted: !!deleted
    };
  }
  function seedIds(stored, workouts) {
    if (Array.isArray(stored)) return stored.map(function (id) { return String(id); });
    return ownWorkouts(workouts).map(function (w) { return String(w.id); });
  }
  function importsForSeed(workouts, claimed, tombstones, seed) {
    var allow = {};
    (seed || []).forEach(function (id) { allow[String(id)] = 1; });
    return pendingImports(workouts, claimed, tombstones).filter(function (w) {
      return allow[String(w.id)];
    });
  }
  // A browser already tied to one account does not hand that library to the next person.
  function libraryForAccount(ownerId, userId, workouts, cached) {
    if (!userId) return { ownerId: ownerId || '', workouts: workouts || [], switched: false };
    if (!ownerId || ownerId === userId) {
      return { ownerId: userId, workouts: workouts || [], switched: false };
    }
    var saved = cached && Array.isArray(cached.workouts) ? cached.workouts : [];
    return { ownerId: userId, workouts: saved, switched: true };
  }
  function pendingImports(workouts, claimed, tombstones) {
    claimed = claimed || {};
    tombstones = tombstones || {};
    return ownWorkouts(workouts).filter(function (w) {
      var id = String(w.id);
      return !claimed[id] && !isUserDrop(tombstones[id]);
    });
  }
  function rememberClaim(claimed, localId) {
    var next = Object.assign({}, claimed || {});
    next[String(localId)] = 1;
    return next;
  }
  // Runs the copy one workout at a time. A failed step keeps the earlier
  // claims and leaves the failed workout, and anything after it, still pending.
  function absorbImports(workouts, claimed, tombstones, absorb) {
    var next = Object.assign({}, claimed || {});
    var pending = pendingImports(workouts, next, tombstones);
    var saved = [];
    var stopped = false;
    for (var i = 0; i < pending.length; i++) {
      var result;
      try { result = absorb(pending[i], i); }
      catch (e) { stopped = true; break; }
      if (!result || result.ok !== true || !result.localId) { stopped = true; break; }
      next[String(result.localId)] = 1;
      saved.push(String(result.localId));
    }
    return {
      claimed: next,
      saved: saved,
      stopped: stopped,
      pending: pendingImports(workouts, next, tombstones).map(function (w) { return String(w.id); })
    };
  }
  function fromRemote(row, previous) {
    var at = ms(row && row.revisedAt);
    return {
      id: String(row.localId),
      name: row.name || 'Workout',
      items: clone(row.items || []),
      createdAt: previous && previous.createdAt ? previous.createdAt : (ms(row.createdAt) || at),
      updatedAt: at
    };
  }
  // A newer remote edit updates the workout the screen already holds.
  function takeRemote(previous, row) {
    var next = fromRemote(row, previous);
    if (!previous) return next;
    previous.name = next.name;
    previous.items = next.items;
    previous.createdAt = next.createdAt;
    previous.updatedAt = next.updatedAt;
    return previous;
  }
  // Remote rows use localId, the same id a program day stores as workoutId.
  function mergeAccount(workouts, remote, tombstones) {
    var drops = {};
    Object.keys(tombstones || {}).forEach(function (id) {
      keepDrop(drops, String(id), tombstones[id]);
    });
    var incoming = {};
    (remote || []).forEach(function (row) {
      if (row && row.localId) incoming[String(row.localId)] = row;
    });
    var ack = {};
    var seen = {};
    var next = [];
    function userAt(id) {
      return isUserDrop(drops[id]) ? dropTime(drops[id]) : 0;
    }
    (workouts || []).forEach(function (w) {
      if (!w) return;
      if (!ownWorkout(w)) { next.push(w); return; }
      var id = String(w.id);
      seen[id] = 1;
      var row = incoming[id];
      var localAt = ms(w.updatedAt);
      if (!row) {
        // No account row. Keep the device copy unless the user deleted it here.
        if (userAt(id) >= localAt && userAt(id) > 0) return;
        delete drops[id];
        next.push(w);
        return;
      }
      var contentAt = contentTime(row);
      var writtenAt = writtenTime(row);
      if (isDeleted(row)) {
        // A Delete pressed after this copy, and after the account's delete,
        // stays deleted. A newer edit on the device still wins.
        if (userAt(id) >= localAt && userAt(id) > contentAt) return;
        if (localAt > contentAt) {
          delete drops[id];
          next.push(w);
        } else {
          var marked = serverDrop(contentAt);
          if (marked) drops[id] = marked;
          else delete drops[id];
          ack[id] = contentAt;
        }
        return;
      }
      // A live account workout stays. A Delete on this device hides it only
      // when that Delete is newer than the account's latest save and this
      // device has nothing newer.
      if (userAt(id) > writtenAt && userAt(id) >= localAt) return;
      if (localAt > contentAt) {
        delete drops[id];
        next.push(w);
        return;
      }
      // Same time keeps this object. The open editor mutates it in place.
      if (localAt === contentAt) {
        delete drops[id];
        next.push(w);
        ack[id] = contentAt;
        return;
      }
      delete drops[id];
      next.push(takeRemote(w, row));
      ack[id] = contentAt;
    });
    Object.keys(incoming).forEach(function (id) {
      if (seen[id]) return;
      var row = incoming[id];
      var contentAt = contentTime(row);
      var writtenAt = writtenTime(row);
      if (isDeleted(row)) {
        if (userAt(id) > contentAt) return;
        var marked = serverDrop(contentAt);
        if (marked) drops[id] = marked;
        ack[id] = contentAt;
        return;
      }
      if (userAt(id) > writtenAt) return;
      delete drops[id];
      next.push(fromRemote(row, null));
      ack[id] = contentAt;
    });
    return { workouts: next, tombstones: drops, ack: ack };
  }
  function pushChanges(workouts, tombstones, ack) {
    ack = ack || {};
    var out = [];
    var live = {};
    ownWorkouts(workouts).forEach(function (w) {
      var id = String(w.id);
      live[id] = 1;
      var at = ms(w.updatedAt);
      if (ack[id] != null && at <= ms(ack[id])) return;
      out.push(changeFrom(w, false));
    });
    Object.keys(tombstones || {}).forEach(function (id) {
      if (!isUserDrop(tombstones[id]) || live[id]) return;
      var at = dropTime(tombstones[id]);
      if (ack[id] != null && at <= ms(ack[id])) return;
      out.push({ localId: String(id), name: 'Workout', items: [], revisedAt: at, deleted: true });
    });
    return out;
  }
  function copyWorkout(w) {
    try { return JSON.parse(JSON.stringify(w)); }
    catch (e) { return null; }
  }
  // Keep the object the screen already holds. A newer copy updates that
  // object in place so an open editor is not left holding the old one.
  function copyOnto(target, source) {
    var copy = copyWorkout(source);
    if (!copy || !target) return target || source;
    Object.keys(target).forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(copy, key)) delete target[key];
    });
    Object.keys(copy).forEach(function (key) { target[key] = copy[key]; });
    return target;
  }
  // A Delete removes the open object only when that Delete still wins.
  // A newer account copy must keep the object so the open screen is updated
  // in place instead of being handed a new one.
  function userRemoved(tombstones, workout, remoteRow) {
    if (!ownWorkout(workout)) return false;
    var mark = tombstones && tombstones[String(workout.id)];
    if (!isUserDrop(mark)) return false;
    var userAt = dropTime(mark);
    var localAt = ms(workout.updatedAt);
    if (userAt < localAt) return false;
    if (!remoteRow) return true;
    if (isDeleted(remoteRow)) {
      if (userAt > contentTime(remoteRow)) return true;
      return localAt <= contentTime(remoteRow);
    }
    return userAt > writtenTime(remoteRow);
  }
  // The device copy wins on a tie so an open editor is not replaced.
  function unionWorkouts(primary, extra) {
    var seen = {};
    var next = [];
    (primary || []).forEach(function (w) {
      if (!w || !w.id) return;
      var id = String(w.id);
      seen[id] = w;
      next.push(w);
    });
    (extra || []).forEach(function (w) {
      if (!w || !w.id) return;
      var id = String(w.id);
      var prev = seen[id];
      if (!prev) {
        seen[id] = w;
        next.push(w);
        return;
      }
      if (ms(w.updatedAt) > ms(prev.updatedAt)) copyOnto(prev, w);
    });
    return next;
  }
  // Another open tab saved. A Delete there removes the workout here.
  // A workout only this tab has, with no Delete, stays. When the account
  // rows are passed, a Delete that the account has already superseded keeps
  // the object this screen is editing.
  function reconcileDevice(local, incoming, tombstones, remote) {
    var rows = {};
    (remote || []).forEach(function (row) {
      if (row && row.localId) rows[String(row.localId)] = row;
    });
    function gone(w) {
      return userRemoved(tombstones, w, rows[String(w.id)]);
    }
    var kept = [];
    (local || []).forEach(function (w) {
      if (!w || !w.id || gone(w)) return;
      kept.push(w);
    });
    var extras = [];
    (incoming || []).forEach(function (w) {
      if (!w || !w.id || gone(w)) return;
      extras.push(w);
    });
    return unionWorkouts(kept, extras);
  }
  function rememberWorkouts(archive, workouts) {
    var next = {};
    Object.keys(archive || {}).forEach(function (id) {
      if (archive[id] && archive[id].id) next[String(id)] = archive[id];
    });
    (workouts || []).forEach(function (w) {
      if (!ownWorkout(w)) return;
      var copy = copyWorkout(w);
      if (!copy) return;
      var id = String(copy.id);
      var prev = next[id];
      if (!prev || ms(copy.updatedAt) >= ms(prev.updatedAt)) next[id] = copy;
    });
    return next;
  }
  function pruneArchive(archive, workouts, limit) {
    var cap = limit || 80;
    var live = {};
    ownWorkouts(workouts).forEach(function (w) { live[String(w.id)] = 1; });
    var keep = {};
    var extra = [];
    Object.keys(archive || {}).forEach(function (id) {
      if (!archive[id] || !archive[id].id) return;
      if (live[id]) keep[id] = archive[id];
      else extra.push(id);
    });
    extra.sort(function (a, b) { return ms(archive[b].updatedAt) - ms(archive[a].updatedAt); });
    extra.slice(0, cap).forEach(function (id) { keep[id] = archive[id]; });
    return keep;
  }
  function dropBlocks(tombstones, id, updatedAt) {
    var value = tombstones && tombstones[id];
    if (!value || typeof value !== 'object') return false;
    var at = dropTime(value);
    return !!(at && at >= ms(updatedAt));
  }
  function restoreArchived(workouts, archive, tombstones, remote) {
    var next = (workouts || []).slice();
    var have = {};
    var remoteRow = {};
    next.forEach(function (w) { if (w && w.id) have[String(w.id)] = 1; });
    (remote || []).forEach(function (row) {
      if (row && row.localId) remoteRow[String(row.localId)] = row;
    });
    Object.keys(archive || {}).forEach(function (id) {
      if (have[id]) return;
      var saved = archive[id];
      if (!ownWorkout(saved)) return;
      if (dropBlocks(tombstones, id, saved.updatedAt)) return;
      var row = remoteRow[id];
      if (row && isDeleted(row) && contentTime(row) >= ms(saved.updatedAt)) return;
      var copy = copyWorkout(saved);
      if (!copy) return;
      next.push(copy);
      have[id] = 1;
    });
    return next;
  }
  // Workouts the account has never stored and this list no longer shows.
  function unseenWorkouts(candidates, current, remote) {
    var have = {};
    (current || []).forEach(function (w) { if (w && w.id) have[String(w.id)] = 1; });
    (remote || []).forEach(function (row) { if (row && row.localId) have[String(row.localId)] = 1; });
    var out = [];
    (candidates || []).forEach(function (w) {
      if (!w || !w.id || have[String(w.id)] || !ownWorkout(w)) return;
      out.push(w);
      have[String(w.id)] = 1;
    });
    return out;
  }
  // How long a rejected save stays parked. The workout stays on the device.
  // A later edit, or this much time passing, tries again. Other workouts do not wait on it.
  var REJECT_HOLD_MS = 10 * 60 * 1000;

  function plainSyncMessage(err) {
    var msg = '';
    if (typeof err === 'string') msg = err;
    else if (err) msg = err.message || err.details || err.hint || '';
    msg = String(msg || '').replace(/^ERROR:\s*/i, '').trim().split('\n')[0];
    if (/jwt expired|invalid jwt|invalid claim|pgrst301|invalid token|refresh token|auth session missing/i.test(msg)) return 'Sign in again';
    if (/sign in first/i.test(msg)) return 'Sign in again';
    if (/permission denied|42501/i.test(msg)) return 'Sign in again';
    if (msg.length > 160) msg = msg.slice(0, 157) + '…';
    return msg || 'Could not sync workouts.';
  }
  // offline: the request never reached the server. auth: the sign-in was not accepted.
  // permanent: the server refused this workout (plan, name, or no connection). retry: try again later.
  function syncFailure(err) {
    if (!err) return 'retry';
    if (err.missing) return 'missing';
    var msg = String((err && (err.message || err.details || err.hint)) || err || '');
    if (/account workout SQL|not available yet|schema cache|could not find the function|PGRST202|PGRST205|42883|42P01/i.test(msg)) return 'missing';
    if (err.offline || /failed to fetch|networkerror|load failed|network request failed|the internet connection appears to be offline|could not reach|fetch failed|econnreset|etimedout|timeout/i.test(msg)) return 'offline';
    if (err.auth || /jwt expired|invalid jwt|invalid claim|not authenticated|sign in first|sign in again|pgrst301|invalid token|refresh token|auth session missing|permission denied|42501/i.test(msg)) return 'auth';
    if (err.permanent || /up to 6 workouts|enter a workout name|could not save that workout|that workout could not be saved|you cannot (save|edit|delete)|cannot be reassigned|there is no connection|only view these workouts|choose a linked client|only an enthusiast|was not found/i.test(msg)) return 'permanent';
    return 'retry';
  }
  function bodyStamp(value) {
    try { return JSON.stringify(value == null ? null : value); }
    catch (e) { return ''; }
  }
  function rejectionHolds(entry, stamp, now) {
    if (!entry || !stamp || entry.stamp !== stamp) return false;
    var at = typeof entry.at === 'number' ? entry.at : 0;
    return (now || 0) - at < REJECT_HOLD_MS;
  }
  function statusModel(phase, detail) {
    if (phase === 'saved') return { text: 'Saved', plans: false };
    if (phase === 'offline') return { text: 'Offline, will sync', plans: false };
    if (phase === 'auth') return { text: 'Sign in again', plans: false };
    if (phase === 'error') {
      var text = String(detail || 'Could not sync workouts.');
      return { text: text, plans: /up to 6 workouts/i.test(text) };
    }
    return { text: '', plans: false };
  }
  function statusText(phase, detail) {
    return statusModel(phase, detail).text;
  }
  function preferNotice(current, next) {
    if (!next) return current || '';
    if (!current) return next;
    if (/up to 6 workouts/i.test(next) && !/up to 6 workouts/i.test(current)) return next;
    return current;
  }
  // The account pull returns a list. A string or a wrapper must not be read as "no workouts".
  function rowsFromPull(data) {
    if (typeof data === 'string') {
      try { data = JSON.parse(data); }
      catch (e) { return []; }
    }
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.workouts)) return data.workouts;
    return [];
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function viewOnlyHtml(w) {
    var h = '<p class="mute" id="copy-note">You can run this workout. You cannot edit or delete it.</p>';
    (w && w.items || []).forEach(function (it) {
      var line = '';
      try { if (root.WB && root.WB.summarize) line = root.WB.summarize(it); } catch (e) { line = ''; }
      h += '<div class="card"><div class="name">' + esc(it && it.name || 'Exercise') + '</div>' +
        (line ? '<div class="mute">' + esc(line) + '</div>' : '') + '</div>';
    });
    if (w && w.items && w.items.length) h += '<button type="button" class="pri" id="copy-run" style="width:100%">Start</button>';
    return h;
  }
  function cardButtons(kind, id, edit) {
    var h = '<div class="actions">';
    if (edit) h += '<button type="button" class="pri sm" data-client-open="' + esc(id) + '" data-client-kind="' + kind + '">Open</button>';
    h += '<button type="button" class="sm" data-client-run="' + esc(id) + '" data-client-kind="' + kind + '">Run</button>';
    if (edit) h += '<button type="button" class="sm danger" data-client-del="' + esc(id) + '" data-client-kind="' + kind + '">Delete</button>';
    return h + '</div>';
  }
  // Extra block under the existing client screen. Empty when there is nothing new to show.
  function clientToolsHtml(model) {
    model = model || {};
    var permission = model.permission || 'hidden';
    var workouts = Array.isArray(model.workouts) ? model.workouts : [];
    var sent = Array.isArray(model.sent) ? model.sent : [];
    if (permission === 'hidden' && !sent.length) return '';
    if (permission !== 'edit' && permission !== 'view' && !sent.length) return '';
    var h = '<div id="client-account">';
    if (permission === 'view' || permission === 'edit') {
      h += '<div class="name" style="margin:12px 0 8px">' + (permission === 'edit' ? 'Their workouts' : 'Run a workout') + '</div>';
      if (permission === 'view') h += '<p class="mute">You can run these. You cannot edit or delete them.</p>';
      if (permission === 'edit') h += '<p class="mute">You can view, run, and edit these workouts.</p>';
      if (!workouts.length) h += '<p class="mute" id="client-account-empty">No workouts on this account yet.</p>';
      workouts.forEach(function (w) {
        if (!w || isDeleted(w) || !w.localId) return;
        var n = (w.items || []).length;
        h += '<div class="card" data-account-id="' + esc(w.localId) + '"><div class="name">' + esc(w.name || 'Workout') + '</div>';
        h += '<div class="mute">' + n + ' exercise' + (n === 1 ? '' : 's') + '</div>';
        h += cardButtons('account', w.localId, permission === 'edit');
        h += '</div>';
      });
      if (permission === 'edit') {
        h += '<button type="button" class="pri" id="client-account-new" data-client-new style="width:100%;margin-bottom:12px">+ New workout</button>';
      }
    }
    if (sent.length) {
      h += '<div class="name" style="margin:12px 0 8px">Workouts you sent</div>';
      h += '<p class="mute">You can view, run, and edit a workout you sent.</p>';
      sent.forEach(function (w) {
        if (!w || !w.id) return;
        var n = (w.items || []).length;
        h += '<div class="card" data-sent-id="' + esc(w.id) + '"><div class="name">' + esc(w.name || 'Workout') + '</div>';
        h += '<div class="mute">' + n + ' exercise' + (n === 1 ? '' : 's') + '</div>';
        h += cardButtons('sent', w.id, true);
        h += '</div>';
      });
    }
    return h + '</div>';
  }
  function guestFromAccount(row, ownerId, permission) {
    var at = ms(row && row.revisedAt) || Date.now();
    return {
      id: String(row.localId),
      name: row.name || 'Workout',
      items: clone(row.items || []),
      createdAt: ms(row.createdAt) || at,
      updatedAt: at,
      remoteOwnerId: String(ownerId || ''),
      remoteLocked: permission !== 'edit',
      remoteEditable: permission === 'edit'
    };
  }
  function guestFromCopy(row, ownerId) {
    var at = ms(row && row.updatedAt) || Date.now();
    return {
      id: String(row.id),
      name: row.name || 'Workout',
      items: clone(row.items || []),
      createdAt: ms(row.createdAt) || at,
      updatedAt: at,
      sourceTrainerId: row.sourceTrainerId || 'trainer',
      sourceWorkoutId: row.sourceWorkoutId || '',
      remoteOwnerId: String(ownerId || ''),
      remoteEditable: true,
      sentCopy: true
    };
  }
  function queueUpsert(queue, item) {
    var list = (queue || []).filter(function (row) {
      if (!row || !item) return false;
      return !(row.ownerId === item.ownerId && row.kind === item.kind && row.localId === item.localId);
    });
    list.push(item);
    return list;
  }
  function queueDrop(queue, item) {
    return (queue || []).filter(function (row) {
      if (!row || !item) return false;
      var same = row.ownerId === item.ownerId && row.kind === item.kind && String(row.localId) === String(item.localId);
      if (!same) return true;
      if (item.gen != null && row.gen != null && row.gen !== item.gen) return true;
      return false;
    });
  }

  var api = {
    CLAIM_KEY: CLAIM_KEY,
    DROP_KEY: DROP_KEY,
    QUEUE_KEY: QUEUE_KEY,
    ms: ms,
    ownWorkouts: ownWorkouts,
    changeFrom: changeFrom,
    pendingImports: pendingImports,
    seedIds: seedIds,
    importsForSeed: importsForSeed,
    libraryForAccount: libraryForAccount,
    rememberClaim: rememberClaim,
    absorbImports: absorbImports,
    mergeAccount: mergeAccount,
    pushChanges: pushChanges,
    dropTime: dropTime,
    isUserDrop: isUserDrop,
    userDrop: userDrop,
    unionWorkouts: unionWorkouts,
    reconcileDevice: reconcileDevice,
    rememberWorkouts: rememberWorkouts,
    pruneArchive: pruneArchive,
    restoreArchived: restoreArchived,
    unseenWorkouts: unseenWorkouts,
    REJECT_HOLD_MS: REJECT_HOLD_MS,
    plainSyncMessage: plainSyncMessage,
    syncFailure: syncFailure,
    bodyStamp: bodyStamp,
    rejectionHolds: rejectionHolds,
    statusModel: statusModel,
    statusText: statusText,
    preferNotice: preferNotice,
    rowsFromPull: rowsFromPull,
    viewOnlyHtml: viewOnlyHtml,
    clientToolsHtml: clientToolsHtml,
    guestFromAccount: guestFromAccount,
    guestFromCopy: guestFromCopy,
    queueUpsert: queueUpsert,
    queueDrop: queueDrop
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WBLibrary = api;
})(typeof window !== 'undefined' ? window : this);
