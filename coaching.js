/* Rules for sent copies and message threads. No network. */
(function (root) {
  'use strict';

  function invites() {
    if (root.WBInvites) return root.WBInvites;
    if (typeof global !== 'undefined' && global.WBInvites) return global.WBInvites;
    return null;
  }
  function isEnthusiast(profile) {
    var api = invites();
    return !!(api && api.isEnthusiast(profile));
  }
  // Own workouts stay editable. A copy from a trainer is editable only for an Enthusiast.
  function canEditCopy(profile, workout) {
    if (!workout || !workout.sourceTrainerId) return true;
    if (invites() && invites().trainerRole(profile)) return true;
    return isEnthusiast(profile);
  }
  function stamp(value) {
    if (typeof value === 'number') return value;
    var n = Date.parse(value || '');
    return isNaN(n) ? 0 : n;
  }
  function asCopy(remote) {
    return {
      id: remote.id,
      name: remote.name || 'Workout',
      items: Array.isArray(remote.items) ? remote.items : [],
      sourceTrainerId: remote.sourceTrainerId,
      sourceTrainerEmail: remote.sourceTrainerEmail || '',
      sourceWorkoutId: remote.sourceWorkoutId || '',
      createdAt: stamp(remote.createdAt || remote.updatedAt),
      updatedAt: stamp(remote.updatedAt)
    };
  }
  // Keep workouts the person built. Refresh copies from the server.
  // A received copy the server no longer returns (the link ended) is dropped.
  function mergeCopies(local, remote) {
    var incoming = {};
    (remote || []).forEach(function (row) { if (row && row.id) incoming[row.id] = row; });
    var seen = {};
    var next = [];
    (local || []).forEach(function (w) {
      if (!w || !w.sourceTrainerId) { next.push(w); return; }
      var row = incoming[w.id];
      if (!row) return;
      seen[w.id] = 1;
      var copy = asCopy(row);
      next.push((w.updatedAt || 0) > copy.updatedAt ? w : copy);
    });
    (remote || []).forEach(function (row) {
      if (row && row.id && !seen[row.id]) next.push(asCopy(row));
    });
    return next;
  }
  function snapshot(workout) {
    var items = [];
    try { items = JSON.parse(JSON.stringify(workout && workout.items || [])); } catch (e) { items = []; }
    return {
      sourceWorkoutId: workout && workout.id || '',
      name: String(workout && workout.name || '').trim() || 'Workout',
      items: items
    };
  }
  function cleanBody(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  }
  function unread(messages, mineKey) {
    return (messages || []).filter(function (m) {
      return m && !m.readAt && m[mineKey] !== true && m.mine !== true;
    }).length;
  }

  var api = {
    canEditCopy: canEditCopy,
    mergeCopies: mergeCopies,
    snapshot: snapshot,
    cleanBody: cleanBody,
    unread: unread
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WBCoaching = api;
})(typeof window !== 'undefined' ? window : this);
