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

  var api = { httpsUrl: httpsUrl, outcome: outcome };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WBBilling = api;
})(typeof window !== 'undefined' ? window : this);
