/**
 * Pure pay math and team-config helpers for the Agent Pay Estimator.
 *
 * No DOM access here, so every function can be unit-tested in Node
 * (see tests/calc.test.js). All money values are whole dollars.
 */
(function (root) {
  'use strict';

  var MAX_NUMBER = 10000000;

  function num(v) {
    var n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  function count(v) {
    return Math.max(0, Math.floor(num(v)));
  }

  /** Highest tier reached plus the next tier up. Tiers are [threshold, amount] pairs. */
  function tierFor(tiers, n) {
    var hit = null, next = null;
    for (var i = 0; i < tiers.length; i++) {
      if (n >= tiers[i][0]) hit = tiers[i];
      else if (!next) next = tiers[i];
    }
    return { hit: hit, next: next, amount: hit ? hit[1] : 0 };
  }

  /** Statement volume bonus for one deal with a statement of `volume` per month. */
  function statementBonus(s, volume) {
    var v = num(volume);
    if (v >= s.topMin) return s.topBase + Math.floor((v - s.topMin) / s.step) * s.stepBonus;
    if (v >= s.midMin) return s.mid;
    if (v >= s.lowMin) return s.low;
    return 0;
  }

  /**
   * One month of upfront pay.
   * inp: { deals, pricing: 'traditional'|'cash', smallDeals, leadDeals, stmtDeals, stmtVolume, equipProfit }
   * Sub-counts are capped at `deals` so the breakdown can never exceed the deal count.
   */
  function monthEstimate(cfg, inp, ramp) {
    var deals = count(inp.deals);
    var small = Math.min(count(inp.smallDeals), deals);
    var lead = Math.min(count(inp.leadDeals), deals);
    var stmt = Math.min(count(inp.stmtDeals), deals);
    var key = inp.pricing === 'cash' ? 'cash' : 'traditional';

    var base = (deals - small) * cfg.upfront[key] + small * cfg.smallDeal[key];
    var commission = ramp ? base * cfg.rampCommissionMultiplier : base;
    var tiers = ramp ? cfg.rampTiers : cfg.monthlyTiers;
    var tier = tierFor(tiers, deals);
    var statementEach = statementBonus(cfg.statement, inp.stmtVolume);
    var statement = stmt * statementEach;
    var equipment = Math.round(Math.max(0, num(inp.equipProfit)) * cfg.equipmentShare / 100);
    var leads = lead * cfg.leadDeduction;

    return {
      deals: deals,
      smallDeals: small,
      leadDeals: lead,
      stmtDeals: stmt,
      base: base,
      commission: commission,
      commissionFirst: base,
      commissionSecond: commission - base,
      tier: tier,
      bonus: tier.amount,
      statementEach: statementEach,
      statement: statement,
      equipment: equipment,
      leads: leads,
      total: commission + tier.amount + statement + equipment - leads
    };
  }

  /** Ramp-up 30/90-day bonuses. all5k = every one of the 25 merchants at option-2 volume on report day. */
  function ninetyDay(cfg, deals30, deals90, all5k) {
    var d30 = count(deals30), d90 = Math.max(count(deals90), d30);
    var fast30 = d30 >= cfg.fastStart30.deals ? cfg.fastStart30.bonus : 0;
    var signing = d90 >= cfg.signing.deals ? (all5k ? cfg.signing.option2 : cfg.signing.option1) : 0;
    var fast90 = tierFor(cfg.fastStart90, d90);
    var applied;
    if (cfg.stack90Day) applied = signing + fast90.amount;
    else applied = Math.max(signing, fast90.amount);
    return {
      deals30: d30,
      deals90: d90,
      fast30: fast30,
      signing: signing,
      fast90: fast90,
      winner: cfg.stack90Day ? 'both' : (fast90.amount > signing ? 'fast90' : (signing > 0 ? 'signing' : 'none')),
      total: fast30 + applied
    };
  }

  /** Estimated monthly residual for one merchant. */
  function residualPerMerchant(cfg, volume, bps) {
    return num(volume) * num(bps) / 10000 * cfg.residual.share / 100;
  }

  /**
   * Month-by-month residual projection at a steady deal pace.
   * o: { dealsPerMonth, perMerchant, attrition (% per month), months, monthlyUpfront }
   * Residuals for a month's book are paid the following month, starting at
   * cfg.residual.firstPayMonth, and only while the agent writes the minimum
   * deals per month (until vested). Vesting = `vesting.months` consecutive
   * months with total comp >= vesting.comp and book >= vesting.accounts.
   */
  function projectResiduals(cfg, o) {
    var rows = [];
    var book = 0, cum = 0, streak = 0, vestedAt = 0;
    var pace = count(o.dealsPerMonth);
    var keep = 1 - Math.min(100, Math.max(0, num(o.attrition))) / 100;
    for (var m = 1; m <= o.months; m++) {
      var prevBook = book;
      book = book * keep + pace;
      var eligible = m >= cfg.residual.firstPayMonth && (vestedAt > 0 || pace >= cfg.residual.minDeals);
      var paid = eligible ? prevBook * num(o.perMerchant) : 0;
      cum += paid;
      var comp = paid + num(o.monthlyUpfront);
      if (!vestedAt) {
        streak = comp >= cfg.vesting.comp && book >= cfg.vesting.accounts ? streak + 1 : 0;
        if (streak >= cfg.vesting.months) vestedAt = m;
      }
      rows.push({ m: m, book: book, paid: paid, cum: cum, comp: comp });
    }
    return { rows: rows, vestedAt: vestedAt };
  }

  // ---------- team config: merge, sanitize, diff ----------

  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function cleanTiers(v, fallback) {
    if (!Array.isArray(v)) return clone(fallback);
    var out = [];
    for (var i = 0; i < v.length && out.length < 12; i++) {
      var p = v[i];
      if (!Array.isArray(p) || p.length !== 2) continue;
      var a = count(p[0]), b = count(p[1]);
      if (a > 0 && a <= 1000 && b <= MAX_NUMBER) out.push([a, b]);
    }
    out.sort(function (x, y) { return x[0] - y[0]; });
    // drop duplicate thresholds, keeping the last one entered
    var dedup = [];
    out.forEach(function (p) {
      if (dedup.length && dedup[dedup.length - 1][0] === p[0]) dedup[dedup.length - 1] = p;
      else dedup.push(p);
    });
    return dedup;
  }

  /**
   * Overlay untrusted `over` (from a share link or team file) onto `defaults`.
   * Only keys that exist in defaults survive, each coerced to the default's type,
   * so a crafted link can't inject markup or unexpected fields.
   */
  function mergeConfig(defaults, over) {
    var out = {};
    Object.keys(defaults).forEach(function (k) {
      var d = defaults[k], v = isObj(over) ? over[k] : undefined;
      if (Array.isArray(d)) out[k] = v === undefined ? clone(d) : cleanTiers(v, d);
      else if (isObj(d)) out[k] = mergeConfig(d, v);
      else if (typeof d === 'number') {
        var n = Number(v);
        out[k] = v === undefined || v === '' || !Number.isFinite(n) ? d : Math.min(MAX_NUMBER, Math.max(0, n));
      } else if (typeof d === 'boolean') out[k] = v === undefined ? d : v === true;
      else out[k] = typeof v === 'string' ? v.slice(0, k === 'note' ? 280 : 60) : d;
    });
    return out;
  }

  /** Only the leaves of `cfg` that differ from `defaults` (arrays compared whole). */
  function diffConfig(defaults, cfg) {
    var out = {}, any = false;
    Object.keys(defaults).forEach(function (k) {
      var d = defaults[k], v = cfg[k];
      if (isObj(d)) {
        var sub = diffConfig(d, v || {});
        if (sub) { out[k] = sub; any = true; }
      } else if (JSON.stringify(d) !== JSON.stringify(v)) {
        out[k] = v; any = true;
      }
    });
    return any ? out : null;
  }

  var api = {
    tierFor: tierFor,
    statementBonus: statementBonus,
    monthEstimate: monthEstimate,
    ninetyDay: ninetyDay,
    residualPerMerchant: residualPerMerchant,
    projectResiduals: projectResiduals,
    mergeConfig: mergeConfig,
    diffConfig: diffConfig
  };
  root.PayCalc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
