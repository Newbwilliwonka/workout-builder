// Existing builder tests sign in as an allowlisted email before the page loads.
async function stubAuth(page, opts) {
  var hasSession = opts && Object.prototype.hasOwnProperty.call(opts, 'session');
  var session = hasSession ? opts.session : { user: { id: 'allow-test', email: 'kinisiathletics@gmail.com' } };
  var hasProfile = opts && Object.prototype.hasOwnProperty.call(opts, 'profile');
  var profile = hasProfile ? opts.profile : null;
  await page.evaluateOnNewDocument(function (session, profile, hasProfile) {
    var current;
    function patch(api) {
      if (!api || api.__sessionStub) return api;
      api.__sessionStub = true;
      api.session = function () { return Promise.resolve(session); };
      if (hasProfile) api.profile = function () { return Promise.resolve(profile); };
      return api;
    }
    Object.defineProperty(window, 'WBAuth', {
      configurable: true,
      enumerable: true,
      get: function () { return current; },
      set: function (v) { current = patch(v); }
    });
  }, session, profile, hasProfile);
}
function allowBuilder(page) { return stubAuth(page); }
module.exports = allowBuilder;
module.exports.stubAuth = stubAuth;
