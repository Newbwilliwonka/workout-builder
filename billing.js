/* Checkout and portal results. No network. Browser: window.WBBilling. Node: require. */
(function (root) {
  'use strict';

  function httpsUrl(value) {
    if (typeof value !== 'string') return '';
    if (value.indexOf('https://') !== 0) return '';
    return value;
  }

  // The function body is { url } on success and { error } when it refuses.
  function outcome(payload, fallback) {
    var message = '';
    if (payload && typeof payload.error === 'string' && payload.error) message = payload.error;
    var url = httpsUrl(payload && payload.url);
    if (!message && url) return { url: url };
    return { error: message || fallback };
  }

  // Plan change: { status:'ok'|'payment_failed'|'requires_action', url? } or { error }.
  function switchOutcome(payload, fallback) {
    var message = '';
    if (payload && typeof payload.error === 'string' && payload.error) message = payload.error;
    if (message) return { error: message };
    if (!payload || typeof payload !== 'object') return { error: fallback };
    if (payload.status === 'ok' || payload.status === 'payment_failed') return { status: payload.status };
    if (payload.status === 'requires_action') {
      var url = httpsUrl(payload.url);
      if (!url) return { error: fallback };
      return { status: 'requires_action', url: url };
    }
    return { error: fallback };
  }

  var api = { httpsUrl: httpsUrl, outcome: outcome, switchOutcome: switchOutcome };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WBBilling = api;
})(typeof window !== 'undefined' ? window : this);
