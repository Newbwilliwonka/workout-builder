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
      available: [
        'Get personalized workouts and programs from your trainer',
        'Run your sessions from your program calendar, solo or with your trainer',
        'Message your trainer anytime',
        'Keep all your data if you switch trainers'
      ],
      comingSoon: [
        'Follow custom tracking dashboards set up by your trainer',
        'Find a new trainer in the Trainer Hub'
      ],
      cta: 'Join with an invite from your trainer'
    },
    {
      id: 'enthusiast',
      name: 'Enthusiast',
      priceCents: 999,
      priceLabel: '$9.99',
      oldPriceCents: 1999,
      oldPriceLabel: '$19.99',
      beta: true,
      inviteOnly: false,
      selfServe: true,
      paysInApp: true,
      workoutCap: 6,
      clientCap: null,
      recommended: false,
      value: 'Build your own training, and still work with a coach if you have one.',
      includes: 'Everything in the Free Client subscription, plus:',
      available: [
        'Build workouts with sets and reps, intervals, timers, stopwatch, and supersets',
        'Create your own exercises, rename them, and add a photo',
        'Search 1,300+ exercises',
        'Save up to 6 of your own workouts',
        'Plan your training on a program calendar',
        'Track solo sessions and sessions with your trainer',
        'Share your workouts and tracking with your trainer',
        'Add a bio and location to your profile'
      ],
      comingSoon: [
        'Follow custom tracking dashboards from your trainer',
        'Find a trainer in the Trainer Hub'
      ],
      cta: 'Choose Enthusiast'
    },
    {
      id: 'trainer',
      name: 'Trainer',
      priceCents: 1999,
      priceLabel: '$19.99',
      oldPriceCents: 3999,
      oldPriceLabel: '$39.99',
      beta: true,
      inviteOnly: false,
      selfServe: true,
      paysInApp: true,
      workoutCap: null,
      clientCap: 15,
      recommended: true,
      value: 'Coach your clients from the workout to the calendar.',
      available: [
        'Build workouts with sets and reps, intervals, timers, stopwatch, and supersets',
        'Create your own exercises, rename them, and add a photo',
        'Search 1,300+ exercises',
        'Send workouts and programs to clients and enthusiasts',
        'Plan solo sessions and sessions you attend on a shared calendar',
        'Review the sessions an enthusiast shares with you',
        'Message your clients',
        'Invite up to 15 clients and enthusiasts',
        'Keep your workouts if either of you ends the connection',
        'Add a bio and location to your profile'
      ],
      comingSoon: [
        'Build custom tracking dashboards for each client'
      ],
      highlight: 'Get found in the Trainer Hub by clients who already train with a coach or pay for training',
      cta: 'Choose Trainer'
    },
    {
      id: 'master_trainer',
      name: 'Master Trainer',
      priceCents: 2999,
      priceLabel: '$29.99',
      oldPriceCents: 5999,
      oldPriceLabel: '$59.99',
      beta: true,
      inviteOnly: false,
      selfServe: true,
      paysInApp: true,
      workoutCap: null,
      clientCap: 30,
      recommended: false,
      value: 'Coach a larger roster.',
      available: [
        'Everything in Trainer, plus:',
        'Invite up to 30 clients and enthusiasts'
      ],
      comingSoon: [
        'Show a verified certification on your profile',
        'Team Training and Team Drills with tracking'
      ],
      highlight: 'Get found in the Trainer Hub by clients who already train with a coach or pay for training',
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
