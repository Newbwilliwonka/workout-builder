/* Shared dashboard order and unread count. No network. No sample people.
   Browser: window.WBShares. Node: require. */
(function (root) {
  'use strict';

  function isUuid(id) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ''));
  }
  function known() {
    var dash = root.WBDashboard;
    if (dash && Array.isArray(dash.CARDS) && dash.CARDS.length) return dash.CARDS;
    return ['plan', 'workouts', 'volume', 'strength', 'records', 'calendar', 'holds', 'stopwatch', 'pass', 'circuit'];
  }
  function standard() {
    var dash = root.WBDashboard;
    if (dash && Array.isArray(dash.STANDARD) && dash.STANDARD.length) return dash.STANDARD.slice();
    return ['plan', 'workouts', 'volume', 'strength', 'calendar', 'holds'];
  }
  function orderOf(list) {
    var allow = known();
    var seen = {};
    var out = [];
    (list || []).forEach(function (id) {
      if (allow.indexOf(id) < 0 || seen[id]) return;
      seen[id] = 1;
      out.push(id);
    });
    return out;
  }
  function addCard(list, id) {
    var order = orderOf(list);
    if (known().indexOf(id) < 0 || order.indexOf(id) >= 0) return order;
    order.push(id);
    return order;
  }
  function removeCard(list, id) {
    return orderOf(list).filter(function (item) { return item !== id; });
  }
  function moveCard(list, id, dir) {
    var order = orderOf(list);
    var i = order.indexOf(id);
    var j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return order;
    var tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
    return order;
  }
  function moveBefore(list, id, beforeId) {
    if (known().indexOf(id) < 0) return orderOf(list);
    var order = orderOf(list).filter(function (item) { return item !== id; });
    var at = order.indexOf(beforeId);
    if (at < 0) order.push(id);
    else order.splice(at, 0, id);
    return order;
  }
  function viewed(row) {
    return !!(row && (row.viewed_at || row.viewedAt));
  }
  function unread(rows) {
    var n = 0;
    (rows || []).forEach(function (row) { if (row && !viewed(row)) n++; });
    return n;
  }
  function createdAt(row) {
    var t = Date.parse(row && (row.created_at || row.createdAt) || '');
    return isFinite(t) ? t : 0;
  }
  function byNewest(rows) {
    return (rows || []).slice().sort(function (a, b) {
      var ta = createdAt(a);
      var tb = createdAt(b);
      if (ta !== tb) return tb - ta;
      var ia = String(a && a.id || '');
      var ib = String(b && b.id || '');
      return ia < ib ? 1 : ia > ib ? -1 : 0;
    });
  }

  var api = {
    isUuid: isUuid,
    standard: standard,
    orderOf: orderOf,
    addCard: addCard,
    removeCard: removeCard,
    moveCard: moveCard,
    moveBefore: moveBefore,
    unread: unread,
    byNewest: byNewest
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WBShares = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
