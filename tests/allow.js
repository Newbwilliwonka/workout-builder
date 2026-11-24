// Existing builder tests sign in as an allowlisted email before the page loads.
async function stubAuth(page, opts) {
  var hasSession = opts && Object.prototype.hasOwnProperty.call(opts, 'session');
  var session = hasSession ? opts.session : { user: { id: 'allow-test', email: 'kinisiathletics@gmail.com' } };
  var hasProfile = opts && Object.prototype.hasOwnProperty.call(opts, 'profile');
  var profile = hasProfile ? opts.profile : null;
  if (!hasProfile && session) {
    hasProfile = true;
    profile = {
      id: (session.user && session.user.id) || 'allow-test',
      email: (session.user && session.user.email) || 'kinisiathletics@gmail.com',
      membership: 'trainer',
      intended_plan: 'trainer'
    };
  }
  await page.evaluateOnNewDocument(function (session, profile, hasProfile) {
    var current;
    function patch(api) {
      if (!api || api.__sessionStub) return api;
      api.__sessionStub = true;
      // These tests cover the app with captcha skipped. An empty site key is the skip path.
      api.TURNSTILE_SITE_KEY = '';
      api.session = function () { return Promise.resolve(session); };
      if (hasProfile) api.profile = function () { return Promise.resolve(profile); };
      api.trainerRequestCount = function () { return Promise.resolve(0); };
      api.circuits = function () { return Promise.resolve([]); };
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
