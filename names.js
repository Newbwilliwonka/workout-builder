/* Saved exercise-name suggestions. Pure logic, no DOM.
   Browser: window.WBNames. Node: require('./names.js').

   Names come from workouts the user owns: created on this device or stored
   on their account. A workout received from a trainer, or a client's workout
   opened by a trainer, is not a source. ExerciseDB is not a source; only
   names already saved on those workouts are.

   The same name with different case, spacing, or punctuation counts once.
   The spelling shown is the one used most often. A tie uses the most recent
   use (later in the list when the time is the same). The exercise being
   edited is left out only when it is the only place that name was saved. */
(function (root) {
  'use strict';

  function compactName(value) {
    return String(value == null ? '' : value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  }
  function displayName(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }
  function nameWords(value) {
    return String(value == null ? '' : value).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  }
  function ownWorkout(w) {
    return !!(w && w.id && !w.sourceTrainerId && !w.remoteOwnerId);
  }
  function usedAt(w) {
    var at = Number(w && w.updatedAt);
    if (!isFinite(at)) at = Number(w && w.createdAt);
    return isFinite(at) ? at : 0;
  }
  // 3 exact, 2 prefix of the whole name, 1 every typed word starts a word in the name, 0 no match.
  // Punctuation, hyphens, and extra spaces are ignored, so "pushup" matches "Push-up".
  function matchTier(query, name) {
    var qCompact = compactName(query);
    if (qCompact.length < 2) return 0;
    var nameCompact = compactName(name);
    if (!nameCompact) return 0;
    if (nameCompact === qCompact) return 3;
    if (nameCompact.indexOf(qCompact) === 0) return 2;
    var qWords = nameWords(query);
    var nWords = nameWords(name);
    if (!qWords.length) return 0;
    var ok = qWords.every(function (word) {
      return nWords.some(function (have) { return have.indexOf(word) === 0; });
    });
    return ok ? 1 : 0;
  }
  function canonicalSpelling(spellings) {
    var best = null, bestName = '';
    Object.keys(spellings).forEach(function (name) {
      var row = spellings[name];
      var better = !best || row.count > best.count || (row.count === best.count && (row.at > best.at || (row.at === best.at && row.seq > best.seq)));
      if (!better) return;
      best = row;
      bestName = name;
    });
    return bestName;
  }

  function suggestNames(workouts, query, options) {
    var trimmed = String(query == null ? '' : query).trim();
    if (trimmed.length < 2 || compactName(trimmed).length < 2) return [];
    options = options || {};
    var limit = options.limit == null ? 6 : Number(options.limit);
    if (!isFinite(limit) || limit < 1) return [];
    limit = Math.floor(limit);
    var exclude = options.excludeExerciseId == null || String(options.excludeExerciseId) === '' ? '' : String(options.excludeExerciseId);
    var groups = Object.create(null);
    var seq = 0;
    var list = Array.isArray(workouts) ? workouts : [];
    list.forEach(function (w) {
      if (!ownWorkout(w)) return;
      var at = usedAt(w);
      var items = Array.isArray(w.items) ? w.items : [];
      items.forEach(function (it) {
        seq += 1;
        if (!it) return;
        var shown = displayName(it.name);
        var key = compactName(shown);
        if (!key) return;
        var id = it.id == null || String(it.id) === '' ? '#' + seq : String(it.id);
        var group = groups[key];
        if (!group) group = groups[key] = { spellings: Object.create(null), ids: Object.create(null), count: 0, at: at, seq: seq };
        group.count += 1;
        group.ids[id] = 1;
        if (at > group.at || (at === group.at && seq >= group.seq)) {
          group.at = at;
          group.seq = seq;
        }
        var spelling = group.spellings[shown];
        if (!spelling) spelling = group.spellings[shown] = { count: 0, at: -1, seq: -1 };
        spelling.count += 1;
        if (at > spelling.at || (at === spelling.at && seq >= spelling.seq)) {
          spelling.at = at;
          spelling.seq = seq;
        }
      });
    });
    var ranked = [];
    Object.keys(groups).forEach(function (key) {
      var group = groups[key];
      if (exclude) {
        var ids = Object.keys(group.ids);
        if (ids.length === 1 && ids[0] === exclude) return;
      }
      var tier = 0;
      Object.keys(group.spellings).forEach(function (name) {
        var next = matchTier(trimmed, name);
        if (next > tier) tier = next;
      });
      if (!tier) return;
      ranked.push({
        name: canonicalSpelling(group.spellings),
        tier: tier,
        at: group.at,
        seq: group.seq,
        count: group.count
      });
    });
    ranked.sort(function (a, b) {
      return (b.tier - a.tier) || (b.at - a.at) || (b.count - a.count) || (b.seq - a.seq) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    });
    return ranked.slice(0, limit).map(function (row) { return row.name; });
  }

  var api = { suggestNames: suggestNames };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WBNames = api;
})(this);
