/* Beta membership rules. No network. Browser: window.WBMembership. Node: require. */
(function (root) {
  'use strict';
  // Active access is membership, never the plan someone only selected.
  var NONE = 'none';
  var TIERS = [
    {
      id: 'free_client',
      name: 'Free Client',
      priceCents: 0,
      priceLabel: 'Free',
      inviteOnly: true,
      selfServe: false,
      paysInApp: false,
      workoutCap: null,
      clientCap: null,
      summary: 'A trainer invite is required. You run workouts a trainer assigns and pay that trainer outside the app.'
    },
    {
      id: 'enthusiast',
      name: 'Enthusiast',
      priceCents: 699,
      priceLabel: '$6.99',
      inviteOnly: false,
      selfServe: true,
      paysInApp: true,
      workoutCap: 6,
      clientCap: null,
      summary: 'Create and edit up to 6 of your own workouts and see your own tracking. You can be promoted to a free client later.'
    },
    {
      id: 'trainer',
      name: 'Trainer',
      priceCents: 1499,
      priceLabel: '$14.99',
      inviteOnly: false,
      selfServe: true,
      paysInApp: true,
      workoutCap: null,
      clientCap: 15,
      summary: 'Up to 15 clients and enthusiasts in total. Invite keys come later.'
    },
    {
      id: 'master_trainer',
      name: 'Master Trainer',
      priceCents: 2999,
      priceLabel: '$29.99',
      inviteOnly: false,
      selfServe: true,
      paysInApp: true,
      workoutCap: null,
      clientCap: 30,
      summary: 'Up to 30 clients and enthusiasts in total. Invite keys and certification review come later.'
    }
  ];

  function tier(id) {
    for (var i = 0; i < TIERS.length; i++) if (TIERS[i].id === id) return TIERS[i];
    return null;
  }
  function canSelectIntended(id) {
    var t = tier(id);
    return !!(t && t.selfServe && !t.inviteOnly);
  }
  // Paid or invited access. A selected plan that has not been paid does not count.
  function entitlements(profile) {
    var id = profile && profile.membership;
    var t = tier(id);
    if (!t) return { active: false, tier: null, workoutCap: null, clientCap: null };
    return { active: true, tier: t, workoutCap: t.workoutCap, clientCap: t.clientCap };
  }
  function isActive(profile, id) { return !!(profile && profile.membership === id); }

  var api = {
    NONE: NONE,
    TIERS: TIERS,
    tier: tier,
    canSelectIntended: canSelectIntended,
    entitlements: entitlements,
    isActive: isActive
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WBMembership = api;
})(typeof window !== 'undefined' ? window : this);
