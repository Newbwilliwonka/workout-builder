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
      recommended: false,
      value: 'Train with your coach.',
      available: ['Run the workouts your trainer sends you'],
      comingSoon: [
        'Follow customized tracking from your trainer',
        'Open each day\'s session from your program calendar',
        'Message your trainer'
      ],
      cta: 'Join with an invite from your trainer'
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
      recommended: false,
      value: 'Build your own training, and still work with a coach if you have one.',
      available: [
        'Create and edit up to 6 of your own workouts',
        'See your own tracking',
        'Run your workouts in the player'
      ],
      comingSoon: [
        'Receive customized programs and tracking from your trainer',
        'Follow your program calendar',
        'Message your trainer'
      ],
      cta: 'Choose Enthusiast'
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
      recommended: true,
      value: 'Coach your clients from workout to tracking.',
      available: [
        'Build customized workouts for each client',
        'Invite up to 15 clients and enthusiasts'
      ],
      comingSoon: [
        'Send workouts to your clients',
        'Review the tracking your clients complete',
        'Send customized tracking to each client',
        'Plan in-person and solo sessions on a shared program calendar',
        'Message your clients'
      ],
      cta: 'Choose Trainer'
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
      recommended: false,
      value: 'A larger roster, with a verified credential.',
      available: [
        'Everything in Trainer',
        'Invite up to 30 clients and enthusiasts',
        'Show a verified certification on your profile'
      ],
      comingSoon: [
        'Send workouts, customized tracking, and messages to a larger client list',
        'Shared program calendar for in-person and solo sessions'
      ],
      cta: 'Choose Master Trainer'
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
  // Active membership, or a paid plan they have chosen but not yet paid for.
  function hasDesignated(profile) {
    if (!profile) return false;
    if (tier(profile.membership)) return true;
    return canSelectIntended(profile.intended_plan);
  }
  function priceLine(t) { return t && t.priceCents ? t.priceLabel + ' / month' : (t ? t.priceLabel : ''); }

  var api = {
    NONE: NONE,
    TIERS: TIERS,
    tier: tier,
    canSelectIntended: canSelectIntended,
    entitlements: entitlements,
    isActive: isActive,
    hasDesignated: hasDesignated,
    priceLine: priceLine
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WBMembership = api;
})(typeof window !== 'undefined' ? window : this);
