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
      value: 'Join with an invite from your trainer.',
      available: [
        'Get personalized workouts and programs from your trainer',
        'Run your sessions from your program calendar, solo or with your trainer',
        'Message your trainer',
        'Keep all your data if you switch trainers',
        'View your workout history',
        'Follow custom tracking dashboards set up by your trainer',
        'Find a trainer near you or online in the Trainer Hub, and send a message request',
        'Join the Trainer Hub forum'
      ],
      comingSoon: []
    },
    {
      id: 'enthusiast',
      name: 'Enthusiast',
      priceCents: 999,
      priceLabel: '$9.99',
      // What Stripe charges after the first 100. Same as Beta until a later raise.
      // oldPrice* is the crossed-out launch price on the card, not this charge.
      standardPriceCents: 999,
      standardPriceLabel: '$9.99',
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
        'See your progress on a live tracking dashboard',
        'Share your workouts and tracking with your trainer',
        'Add a photo and bio to your profile',
        'Follow custom tracking dashboards from your trainer',
        'Find a trainer near you or online in the Trainer Hub, and send a message request',
        'Join the Trainer Hub forum'
      ],
      comingSoon: [],
      cta: 'Choose Enthusiast'
    },
    {
      id: 'trainer',
      name: 'Trainer',
      priceCents: 1999,
      priceLabel: '$19.99',
      standardPriceCents: 1999,
      standardPriceLabel: '$19.99',
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
        'Build and share custom tracking dashboards for each client',
        'Message your clients',
        'Invite up to 15 clients and enthusiasts',
        'Keep your workouts if either of you ends the connection',
        'Add a photo, bio, and a private service-location pin. Only your city and state are shown.',
        'Get found in Trainer Hub search for in-person training, online training, or both',
        'Accept message requests from new clients and enthusiasts',
        'Join the Trainer Hub forum'
      ],
      comingSoon: [],
      highlight: 'Get found in the Trainer Hub by clients who have trained with a coach',
      cta: 'Choose Trainer'
    },
    {
      id: 'master_trainer',
      name: 'Master Trainer',
      priceCents: 2999,
      priceLabel: '$29.99',
      standardPriceCents: 2999,
      standardPriceLabel: '$29.99',
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
      includes: 'Everything in the Trainer subscription, plus:',
      available: [
        'Invite up to 30 clients and enthusiasts',
        'Show a verified certification on your profile',
        'Group circuit training with tracking'
      ],
      comingSoon: [],
      highlight: 'Get found in the Trainer Hub by clients who have trained with a coach',
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
  // past_due and unpaid are not access. Free Client is not a Stripe status.
  function billingEnded(profile) {
    if (!profile || profile.membership === 'free_client') return false;
    return profile.billing_status === 'past_due' || profile.billing_status === 'unpaid';
  }
  function entitlements(profile) {
    if (billingEnded(profile)) return { active: false, tier: null, workoutCap: null, clientCap: null };
    var id = profile && profile.membership;
    var t = tier(id);
    if (!t) return { active: false, tier: null, workoutCap: null, clientCap: null };
    return { active: true, tier: t, workoutCap: t.workoutCap, clientCap: t.clientCap };
  }
  function isActive(profile, id) { return !!(profile && profile.membership === id); }
  // Active membership, or a paid plan they have chosen but not yet paid for.
  function hasDesignated(profile) {
    if (!profile) return false;
    if (billingEnded(profile)) return false;
    if (tier(profile.membership)) return true;
    return canSelectIntended(profile.intended_plan);
  }
  function priceLine(t) { return t && t.priceCents ? t.priceLabel + ' / month' : (t ? t.priceLabel : ''); }
  // The price this person would be charged. Beta-locked members stay on the
  // Beta amount. Everyone else pays the standard amount.
  function payable(tier, betaLocked) {
    if (!tier || !tier.paysInApp) return null;
    if (betaLocked) return { cents: tier.priceCents, label: tier.priceLabel };
    return {
      cents: tier.standardPriceCents != null ? tier.standardPriceCents : tier.priceCents,
      label: tier.standardPriceLabel || tier.priceLabel
    };
  }
  // A paid membership Stripe is still billing. past_due and unpaid have ended.
  function activePaidPlan(profile) {
    if (!profile || billingEnded(profile)) return null;
    var t = tier(profile.membership);
    if (!t || !t.paysInApp) return null;
    var status = profile.billing_status;
    if (status !== 'active' && status !== 'trialing') return null;
    return t.id;
  }
  var HOLD_LINE = 'Your plan has ended. Rejoin within 2 weeks to keep your clients, workouts and history.';
  var HOLD_MS = 14 * 24 * 60 * 60 * 1000;
  // One line on Subscriptions, and only while the 2-week hold is still open.
  function dataHoldLine(profile, now) {
    if (!profile || profile.membership === 'free_client') return '';
    if (activePaidPlan(profile)) return '';
    if (!profile.plan_ended_at) return '';
    var ended = Date.parse(profile.plan_ended_at);
    if (!isFinite(ended)) return '';
    var at = now == null ? Date.now() : now;
    if (ended > at || at - ended >= HOLD_MS) return '';
    return HOLD_LINE;
  }

  var api = {
    NONE: NONE,
    TIERS: TIERS,
    tier: tier,
    canSelectIntended: canSelectIntended,
    entitlements: entitlements,
    isActive: isActive,
    hasDesignated: hasDesignated,
    priceLine: priceLine,
    payable: payable,
    activePaidPlan: activePaidPlan,
    dataHoldLine: dataHoldLine,
    HOLD_LINE: HOLD_LINE
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WBMembership = api;
})(typeof window !== 'undefined' ? window : this);
