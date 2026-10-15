/**
 * Agent Pay Estimator UI.
 *
 * Reads the team plan (company defaults + overrides from the link), wires the
 * sliders and inputs to PayCalc, and renders results. Team overrides arrive as
 * either `#team=<encoded>` (made by the Team setup panel) or `?team=<slug>`,
 * which loads teams/<slug>.json. All config-derived text is set with
 * textContent, never innerHTML, because links are untrusted input.
 */
(function () {
  'use strict';

  var D = window.PAY_DEFAULTS;
  var C = window.PayCalc;
  var STORE_KEY = 'wp-pay-estimator:v1';

  var cfg = C.mergeConfig(D, {});
  var state = {
    period: 'ramp',
    deals: 8,
    pricing: 'traditional',
    smallDeals: 0,
    leadDeals: 0,
    stmtDeals: 1,
    stmtVolume: 30000,
    equipProfit: 0,
    deals30: 5,
    deals90: 25,
    all5k: false,
    resPace: null,          // null = follow the main slider
    resVolume: null,        // null = team default
    resBps: null,
    resAttrition: null
  };

  // ---------- helpers ----------
  var $ = function (id) { return document.getElementById(id); };
  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  var usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function money(n) { return usd.format(Math.round(n)); }
  function short(n) {
    if (n >= 1000) { var k = n / 1000; return '$' + (k % 1 ? k.toFixed(1) : k) + 'K'; }
    return '$' + n;
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function saveInputs() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage blocked */ }
  }
  function loadInputs() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (s && typeof s === 'object') {
        Object.keys(state).forEach(function (k) {
          if (s[k] === undefined) return;
          if (typeof state[k] === 'number' || state[k] === null) {
            var n = s[k] === null ? null : Number(s[k]);
            if (n === null || Number.isFinite(n)) state[k] = n === null ? null : Math.max(0, n);
          } else if (typeof state[k] === typeof s[k]) state[k] = s[k];
        });
        if (state.period !== 'ramp' && state.period !== 'standard') state.period = 'ramp';
        if (state.pricing !== 'traditional' && state.pricing !== 'cash') state.pricing = 'traditional';
      }
    } catch (e) { /* ignore */ }
  }

  // ---------- link encoding ----------
  function b64u(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64u(str) {
    var s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function encodePlan(obj) {
    var bytes = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream === 'undefined') return Promise.resolve('j' + b64u(bytes));
    var stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer().then(function (buf) { return 'z' + b64u(new Uint8Array(buf)); });
  }
  function decodePlan(code) {
    if (!code || code.length > 8000) return Promise.reject(new Error('bad length'));
    var bytes = unb64u(code.slice(1));
    var text;
    if (code[0] === 'j') text = Promise.resolve(new TextDecoder().decode(bytes));
    else if (code[0] === 'z' && typeof DecompressionStream !== 'undefined') {
      var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      text = new Response(stream).text();
    } else return Promise.reject(new Error('unsupported'));
    return text.then(JSON.parse);
  }
  function baseUrl() { return location.origin + location.pathname; }

  function readHashPlan() {
    var m = /(?:^#|&)team=([A-Za-z0-9_-]+)/.exec(location.hash);
    return m ? decodePlan(m[1]) : Promise.resolve(null);
  }
  function readSlugPlan() {
    var slug = new URLSearchParams(location.search).get('team');
    if (!slug || !/^[a-z0-9-]{1,40}$/.test(slug)) return Promise.resolve(null);
    return fetch('teams/' + slug + '.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  // ---------- rendering ----------
  function tiersFor(period) { return period === 'ramp' ? cfg.rampTiers : cfg.monthlyTiers; }

  function bindText() {
    var map = {
      rampMonths: String(cfg.rampMonths),
      rampMonthsPlus: String(cfg.rampMonths + 1),
      firstPayMonth: String(cfg.residual.firstPayMonth),
      residualShare: cfg.residual.share + '%',
      signingDeals: String(cfg.signing.deals),
      option2Min: money(cfg.signing.option2Min)
    };
    document.querySelectorAll('[data-bind]').forEach(function (n) {
      var v = map[n.getAttribute('data-bind')];
      if (v != null) n.textContent = v;
    });

    $('teamChip').textContent = cfg.team.name;
    $('eyebrow').textContent = cfg.team.name === D.team.name ? 'Agent pay estimator' : cfg.team.name + ' · pay estimator';
    document.title = cfg.team.name === D.team.name ? 'Agent Pay Estimator' : cfg.team.name + ' Pay Estimator';

    $('tradRate').textContent = money(cfg.upfront.traditional) + '/deal';
    $('cashRate').textContent = money(cfg.upfront.cash) + '/deal';
    $('leadHint').textContent = money(cfg.leadDeduction) + ' lead deduction each.';
    $('equipHint').textContent = 'You keep ' + cfg.equipmentShare + '% once the merchant has paid in full.';

    $('cmpCommRamp').textContent = cfg.rampCommissionMultiplier + '× per deal';
    var first = cfg.monthlyTiers.slice(0, 3);
    $('cmpBonusLabel').textContent = 'Monthly bonus at ' + first.map(function (t) { return t[0]; }).join(' / ') + ' deals';
    $('cmpBonusStd').textContent = first.map(function (t) { return money(t[1]); }).join(' / ');
    $('cmpBonusRamp').textContent = first.map(function (t) { return money(C.tierFor(cfg.rampTiers, t[0]).amount); }).join(' / ');

    var slug = /^[a-z0-9-]{1,40}$/.test(cfg.team.guide) ? cfg.team.guide : '';
    document.querySelectorAll('.guide-link').forEach(function (link) {
      link.href = slug ? 'assets/career-guide-' + slug + '.pdf' : 'assets/career-guide.pdf';
    });

    var note = cfg.team.note.trim();
    $('managerNote').hidden = !note;
    $('managerNoteText').textContent = note;
    $('managerNoteBy').textContent = cfg.team.manager ? '— ' + cfg.team.manager + ', ' + cfg.team.name : '— ' + cfg.team.name;

    renderRules();
  }

  function setPct(input) {
    var min = Number(input.min), max = Number(input.max);
    input.style.setProperty('--pct', ((Number(input.value) - min) / (max - min) * 100) + '%');
  }

  function renderTicks() {
    var slider = $('deals');
    var tiers = tiersFor(state.period);
    var top = tiers.length ? tiers[tiers.length - 1][0] : 20;
    var max = Math.max(30, Math.ceil((top + 5) / 5) * 5);
    if (Number(slider.max) !== max) { slider.max = String(max); }
    var box = $('ticks');
    box.textContent = '';
    tiers.forEach(function (t) {
      if (t[0] > max) return;
      var tick = el('span', 'tick' + (state.deals >= t[0] ? ' hit' : ''));
      tick.style.left = (t[0] / max * 100) + '%';
      tick.appendChild(el('b', null, String(t[0])));
      box.appendChild(tick);
    });
  }

  var shownTotal = 0, animId = 0;
  function animateTotal(to) {
    var node = $('total');
    cancelAnimationFrame(animId);
    if (reduceMotion) { node.textContent = money(to); shownTotal = to; return; }
    var from = shownTotal, start = performance.now(), dur = 380;
    function step(now) {
      var p = Math.min(1, (now - start) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      shownTotal = from + (to - from) * e;
      node.textContent = money(shownTotal);
      if (p < 1) animId = requestAnimationFrame(step);
    }
    animId = requestAnimationFrame(step);
  }

  function row(dl, label, sub, value, kind) {
    var wrap = el('div');
    var dt = el('dt', null, label);
    if (sub) dt.appendChild(el('small', null, sub));
    var dd = el('dd', kind || (value === 0 ? 'zero' : ''), (kind === 'neg' && value ? '−' : '') + money(Math.abs(value)));
    wrap.appendChild(dt); wrap.appendChild(dd);
    dl.appendChild(wrap);
  }

  function renderMonth() {
    var ramp = state.period === 'ramp';
    var r = C.monthEstimate(cfg, state, ramp);
    var key = state.pricing === 'cash' ? 'cash' : 'traditional';

    $('dealsOut').textContent = String(r.deals);
    $('resultPeriod').textContent = ramp ? 'Ramp-Up month' : 'Standard month';
    animateTotal(r.total);

    var dl = $('breakdown');
    dl.textContent = '';
    var std = r.deals - r.smallDeals;
    var commSub = plural(std, 'deal') + ' × ' + money(cfg.upfront[key]) +
      (r.smallDeals ? ' + ' + r.smallDeals + ' × ' + money(cfg.smallDeal[key]) : '') +
      (ramp && cfg.rampCommissionMultiplier !== 1 ? ', ' + cfg.rampCommissionMultiplier + '× for ramp-up' : '');
    row(dl, 'Upfront commission', commSub, r.commission);
    if (ramp && r.commissionSecond > 0) {
      row(dl, '↳ paid when processing', money(r.commissionFirst) + ' at $1K & 5 transactions, ' + money(r.commissionSecond) + ' at $5K & 10 transactions', r.commissionSecond);
      dl.lastChild.querySelector('dd').className = 'zero';
    }
    var bonusSub = r.tier.hit ? plural(r.tier.hit[0], 'deal') + ' tier' + (ramp ? ', half at $1K & 5 transactions, half at $5K & 10' : '') : 'Starts at ' + (tiersFor(state.period)[0] || [5])[0] + ' deals';
    row(dl, 'Monthly bonus', bonusSub, r.bonus);
    row(dl, 'Statement volume bonus', r.stmtDeals ? plural(r.stmtDeals, 'deal') + ' × ' + money(r.statementEach) : 'No qualifying statements', r.statement);
    if (r.equipment) row(dl, 'Equipment sales', cfg.equipmentShare + '% of ' + money(state.equipProfit), r.equipment);
    if (r.leads) row(dl, 'Lead deductions', plural(r.leadDeals, 'company appointment') + ' × ' + money(cfg.leadDeduction), r.leads, 'neg');

    // next tier nudge
    var nt = $('nextTier');
    nt.textContent = '';
    if (r.tier.next) {
      var need = r.tier.next[0] - r.deals;
      nt.appendChild(el('strong', null, plural(need, 'more deal')));
      nt.appendChild(document.createTextNode(' reaches the ' + r.tier.next[0] + '-deal bonus: '));
      nt.appendChild(el('strong', null, '+' + money(r.tier.next[1] - r.bonus)));
      nt.appendChild(document.createTextNode(' this month.'));
    } else if (r.tier.hit) {
      nt.appendChild(el('strong', null, 'Top bonus tier reached.'));
    }

    // ladder
    var lad = $('ladder');
    lad.textContent = '';
    tiersFor(state.period).forEach(function (t) {
      var hit = r.deals >= t[0];
      var cur = r.tier.hit && r.tier.hit[0] === t[0];
      var rung = el('div', 'rung' + (hit ? ' hit' : '') + (cur ? ' current' : ''));
      rung.appendChild(el('span', 'rung-bar'));
      rung.appendChild(el('span', 'rung-amt', short(t[1])));
      rung.appendChild(el('span', 'rung-deals', t[0] + ' deals'));
      lad.appendChild(rung);
    });

    $('payoutNote').textContent = 'Paid Fridays once each deal is installed and processing (5 separate cards, $1,000). ' +
      'Every deal in a bonus tier must hit the processing minimum within 90 days.';

    $('smallHint').textContent = 'Paid ' + money(cfg.smallDeal[key]) + ' each unless the statement is over ' + (key === 'cash' ? '$5K' : '$10K') + '.';
    var each = C.statementBonus(cfg.statement, state.stmtVolume);
    $('stmtHint').textContent = each ? money(each) + ' bonus per qualifying deal.' : 'Under ' + money(cfg.statement.lowMin) + ' earns no statement bonus.';

    renderTicks();
    return r;
  }

  function renderNinety() {
    var n = C.ninetyDay(cfg, state.deals30, state.deals90, state.all5k);
    $('deals30Out').textContent = String(state.deals30);
    $('deals90Out').textContent = String(n.deals90);
    $('ninetyTotal').textContent = money(n.total);
    $('ninetyRule').textContent = cfg.stack90Day
      ? 'The 30-day Fast Start, the ' + cfg.signing.deals + '-deal bonus and the 90-day Fast Start all stack.'
      : 'You get the 30-day Fast Start plus the larger of the ' + cfg.signing.deals + '-deal bonus and the 90-day Fast Start.';

    var box = $('bonusCards');
    box.textContent = '';

    function card(title, amount, earned, desc, progress, pills) {
      var c = el('article', 'bcard' + (earned ? ' earned' : ''));
      c.appendChild(el('h3', null, title));
      c.appendChild(el('span', 'amt', money(amount)));
      var bar = el('div', 'progress');
      var fill = el('i');
      fill.style.width = Math.min(100, progress * 100) + '%';
      bar.appendChild(fill);
      c.appendChild(bar);
      c.appendChild(el('p', null, desc));
      if (pills && pills.length) {
        var s = el('div', 'status');
        pills.forEach(function (p) { s.appendChild(el('span', 'pill' + (p[1] ? ' ' + p[1] : ''), p[0])); });
        c.appendChild(s);
      }
      box.appendChild(c);
    }

    var f = cfg.fastStart30;
    card('30-Day Fast Start', f.bonus, n.fast30 > 0,
      f.deals + ' deals in your first 30 days. Paid once those deals process $1,000 and 5 transactions.',
      n.deals30 / f.deals,
      [[n.fast30 ? 'Earned' : plural(Math.max(0, f.deals - n.deals30), 'deal') + ' to go', n.fast30 ? 'on' : '']]);

    var s = cfg.signing;
    var signingApplied = cfg.stack90Day || n.winner === 'signing';
    var sp = [
      ['Option 1 · every merchant ' + short(s.option1Min) + '+ → ' + money(s.option1), n.signing && !state.all5k ? 'on' : ''],
      ['Option 2 · every merchant ' + short(s.option2Min) + '+ → ' + money(s.option2), n.signing && state.all5k ? 'on' : '']
    ];
    if (n.signing && !signingApplied) sp.push(['Not applied: 90-day Fast Start pays more', 'dim']);
    card(s.deals + '-Deal Signing Bonus', state.all5k ? s.option2 : s.option1, n.signing > 0 && signingApplied,
      s.deals + ' deals in your first 90 days, then 60 more days to get all ' + s.deals + ' processing. The report runs once. If any merchant is under ' + money(s.option2Min) + ', it pays Option 1.',
      n.deals90 / s.deals, sp);

    var fp = cfg.fastStart90.map(function (t) { return [t[0] + ' deals → ' + money(t[1]), n.fast90.hit && n.fast90.hit[0] === t[0] ? 'on' : '']; });
    var fastApplied = cfg.stack90Day || n.winner === 'fast90';
    if (n.fast90.amount && !fastApplied) fp.push(['Not applied: signing bonus pays more', 'dim']);
    var top90 = cfg.fastStart90.length ? cfg.fastStart90[cfg.fastStart90.length - 1][0] : 1;
    card('90-Day Fast Start', n.fast90.amount || (cfg.fastStart90[0] ? cfg.fastStart90[0][1] : 0), n.fast90.amount > 0 && fastApplied,
      'Deals written in your first 90 days. Accounts must be active within 120 days. Paid in month 5.',
      n.deals90 / top90, fp);
  }

  function residualInputs() {
    return {
      pace: state.resPace === null ? state.deals : state.resPace,
      volume: state.resVolume === null ? cfg.residual.volume : state.resVolume,
      bps: state.resBps === null ? cfg.residual.bps : state.resBps,
      attrition: state.resAttrition === null ? cfg.residual.attrition : state.resAttrition
    };
  }

  function niceMax(v) {
    if (v <= 0) return 100;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var m = v / p;
    var steps = [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < steps.length; i++) if (m <= steps[i]) return steps[i] * p;
    return 10 * p;
  }

  function renderResidual() {
    var ri = residualInputs();
    if (document.activeElement !== $('resPace')) $('resPace').value = String(ri.pace);
    if (document.activeElement !== $('resVolume')) $('resVolume').value = String(ri.volume);
    if (document.activeElement !== $('resBps')) $('resBps').value = String(ri.bps);
    if (document.activeElement !== $('resAttrition')) $('resAttrition').value = String(ri.attrition);

    var per = C.residualPerMerchant(cfg, ri.volume, ri.bps);
    $('perMerchant').textContent = usd2.format(per);

    var monthlyUpfront = C.monthEstimate(cfg, Object.assign({}, state, { deals: ri.pace }), false).total;
    var proj = C.projectResiduals(cfg, { dealsPerMonth: ri.pace, perMerchant: per, attrition: ri.attrition, months: 24, monthlyUpfront: monthlyUpfront });
    var rows = proj.rows;

    var stats = $('resStats');
    stats.textContent = '';
    [['Month 12 residual', money(rows[11].paid) + '/mo'],
     ['Month 24 residual', money(rows[23].paid) + '/mo'],
     ['24-month residual total', money(rows[23].cum)],
     ['Projected vesting', proj.vestedAt ? 'Month ' + proj.vestedAt : 'Not in 24 mo']
    ].forEach(function (s) {
      var d = el('div', 'stat');
      d.appendChild(el('span', null, s[0]));
      d.appendChild(el('b', null, s[1]));
      stats.appendChild(d);
    });

    var warn = $('resWarn');
    if (ri.pace < cfg.residual.minDeals) {
      warn.hidden = false;
      warn.textContent = 'Until you are vested, residuals are only paid in months you sign at least ' + cfg.residual.minDeals + ' approved deals. At this pace you would not be paid residuals.';
    } else {
      warn.hidden = true;
    }

    drawChart(rows, proj.vestedAt);
  }

  var SVGNS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, text) {
    var e = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }

  function drawChart(rows, vestedAt) {
    var W = 640, H = 250, L = 54, R = 14, T = 26, B = 30;
    var maxV = niceMax(Math.max.apply(null, rows.map(function (r) { return r.paid; })) * 1.05);
    var x = function (m) { return L + (m - 1) / (rows.length - 1) * (W - L - R); };
    var y = function (v) { return T + (1 - v / maxV) * (H - T - B); };

    var box = $('chart');
    box.textContent = '';
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet' });
    var defs = svg('defs');
    var grad = svg('linearGradient', { id: 'resFill', x1: '0', y1: '0', x2: '0', y2: '1' });
    var s1 = svg('stop', { offset: '0%' }); s1.style.stopColor = 'var(--green)'; s1.style.stopOpacity = '0.22';
    var s2 = svg('stop', { offset: '100%' }); s2.style.stopColor = 'var(--green)'; s2.style.stopOpacity = '0';
    grad.appendChild(s1); grad.appendChild(s2); defs.appendChild(grad); s.appendChild(defs);

    for (var i = 0; i <= 4; i++) {
      var v = maxV * i / 4, yy = y(v);
      s.appendChild(svg('line', { class: 'grid', x1: L, x2: W - R, y1: yy, y2: yy }));
      s.appendChild(svg('text', { class: 'axis', x: L - 8, y: yy + 4, 'text-anchor': 'end' }, short(Math.round(v))));
    }
    [1, 6, 12, 18, 24].forEach(function (m) {
      s.appendChild(svg('text', { class: 'axis', x: x(m), y: H - 8, 'text-anchor': 'middle' }, 'Mo ' + m));
    });

    var line = rows.map(function (r, i) { return (i ? 'L' : 'M') + x(r.m).toFixed(1) + ' ' + y(r.paid).toFixed(1); }).join(' ');
    s.appendChild(svg('path', { class: 'area', d: line + ' L' + x(rows.length) + ' ' + y(0) + ' L' + x(1) + ' ' + y(0) + ' Z' }));
    s.appendChild(svg('path', { class: 'line', d: line }));

    if (vestedAt) {
      var vx = x(vestedAt);
      s.appendChild(svg('line', { class: 'vest', x1: vx, x2: vx, y1: T - 8, y2: H - B }));
      s.appendChild(svg('text', { class: 'vest-label', x: vx + (vestedAt > 18 ? -6 : 6), y: T - 12, 'text-anchor': vestedAt > 18 ? 'end' : 'start' }, 'Vested'));
    }
    var last = rows[rows.length - 1];
    s.appendChild(svg('circle', { class: 'dot', cx: x(last.m), cy: y(last.paid), r: 4.5 }));

    var hover = svg('line', { class: 'hover-line', x1: 0, x2: 0, y1: T, y2: H - B, visibility: 'hidden' });
    var hdot = svg('circle', { class: 'dot', r: 4.5, visibility: 'hidden' });
    s.appendChild(hover); s.appendChild(hdot);
    box.appendChild(s);

    var tip = el('div', 'tip');
    tip.hidden = true;
    box.appendChild(tip);

    function show(evt) {
      var rect = s.getBoundingClientRect();
      var px = (evt.clientX - rect.left) / rect.width * W;
      var m = Math.round((px - L) / (W - L - R) * (rows.length - 1)) + 1;
      m = Math.max(1, Math.min(rows.length, m));
      var r = rows[m - 1];
      hover.setAttribute('x1', x(m)); hover.setAttribute('x2', x(m)); hover.setAttribute('visibility', 'visible');
      hdot.setAttribute('cx', x(m)); hdot.setAttribute('cy', y(r.paid)); hdot.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.textContent = 'Month ' + m + ' · ' + money(r.paid) + '/mo · ' + Math.round(r.book) + ' merchants';
      var left = x(m) / W * rect.width;
      tip.style.left = Math.max(90, Math.min(rect.width - 90, left)) + 'px';
      tip.style.top = '-34px';
    }
    function hide() { hover.setAttribute('visibility', 'hidden'); hdot.setAttribute('visibility', 'hidden'); tip.hidden = true; }
    s.addEventListener('pointermove', show);
    s.addEventListener('pointerdown', show);
    s.addEventListener('pointerleave', hide);
  }

  function renderRules() {
    var st = cfg.statement;
    var groups = [
      ['When deals pay', [
        'Pay goes out every Friday. Pre-Pay Verification emails arrive Wednesday evening. Report any discrepancy to accounting before Thursday 10:00 AM Central.',
        'A deal pays once it is installed and processing: at least 5 separate cards and $1,000 in volume.',
        'Upfront starts at ' + money(cfg.upfront.traditional) + ' (traditional) or ' + money(cfg.upfront.cash) + ' (cash discount), adjusted for volume and SSOC pricing.',
        'Swipers, wireless terminals, Authorize.net, home-based businesses and salons pay ' + money(cfg.smallDeal.traditional) + ' traditional (unless the statement is over $10K) or ' + money(cfg.smallDeal.cash) + ' cash discount (unless over $5K).',
        'A re-sign of an existing deal pays $0 traditional or $100 cash discount.',
        'Leases pay once funded and the Delivery & Acceptance form is in. Equipment sales pay ' + cfg.equipmentShare + '% of the sale minus equipment cost once the merchant has paid in full.'
      ]],
      ['Monthly bonuses', [
        'Only the highest tier you reach pays. ' + cfg.monthlyTiers.map(function (t) { return t[0] + ' deals ' + short(t[1]); }).join(', ') + '.',
        'During ramp-up (months 1–' + cfg.rampMonths + ') the bonus is doubled: ' + cfg.rampTiers.map(function (t) { return t[0] + ' deals ' + short(t[1]); }).join(', ') + '.',
        'Ramp-up bonuses and the second ramp-up commission pay in two parts: the first when accounts hit 5 transactions and $1,000, the second at 10 transactions and $5,000.',
        'Every deal in a tier must be processing $1,000 in a 30-day span within 90 days. For example, a January 8-deal bonus needs all 8 accounts processing by April 30.'
      ]],
      ['Statement volume bonus', [
        'Submit the statement with the merchant application. It must be within the last 90 days.',
        money(st.lowMin) + ' to ' + money(st.midMin) + ': ' + money(st.low) + '. ' + money(st.midMin) + ' to ' + money(st.topMin - 1) + ': ' + money(st.mid) + '.',
        money(st.topMin) + ' and above: ' + money(st.topBase) + ' plus ' + money(st.stepBonus) + ' for every additional ' + money(st.step) + ' in monthly volume.',
        'If the merchant does not process the statement amount, the statement bonus is charged back after 60 days.'
      ]],
      ['Residuals and vesting', [
        'You earn ' + cfg.residual.share + '% of the residual on your merchants. Residuals pay on the first Friday of each month, starting month ' + cfg.residual.firstPayMonth + '.',
        'Until you are vested, residuals only pay in months you sign at least ' + cfg.residual.minDeals + ' approved deals, and stop if monthly compensation drops under $250.',
        'You are vested after ' + cfg.vesting.months + ' straight months with at least ' + money(cfg.vesting.comp) + ' in compensation and ' + cfg.vesting.accounts + ' processing merchant accounts.',
        'Accounts on reserve pay 50% of the normal residual until the reserve is released.'
      ]],
      ['Chargebacks and deductions', [
        'If a merchant stops processing for 30 days (within 120 days of payment), the upfront commission, statement bonus and ramp-up bonus are charged back. They are paid back once the merchant processes again.',
        'If a merchant has not processed for 45 days, the equipment cost is charged back until the merchant processes or the equipment is returned.',
        'Deals from company appointments carry a ' + money(cfg.leadDeduction) + ' lead deduction.',
        'Pricing below the SSOC is deducted: the monthly minimum and monthly service fee difference ×3, and the annual fee and early termination fee difference.'
      ]],
      ['Advances', [
        'Payment advances are approved by the CFO case by case and carry a 15% fee.',
        'No new advance is issued while one is outstanding.'
      ]]
    ];
    var box = $('rules');
    box.textContent = '';
    groups.forEach(function (g, i) {
      var d = el('details');
      if (i < 2) d.open = true;
      d.appendChild(el('summary', null, g[0]));
      var ul = el('ul');
      g[1].forEach(function (t) { ul.appendChild(el('li', null, t)); });
      d.appendChild(ul);
      box.appendChild(d);
    });
  }

  function renderPeriod() {
    document.body.setAttribute('data-period', state.period);
    document.querySelectorAll('.period-opt').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.getAttribute('data-period') === state.period));
    });
  }

  function renderPricing() {
    document.querySelectorAll('.seg-opt').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.getAttribute('data-pricing') === state.pricing));
    });
  }

  function renderAll() {
    renderPeriod();
    renderPricing();
    bindText();
    renderMonth();
    renderNinety();
    renderResidual();
    ['deals', 'deals30', 'deals90'].forEach(function (id) { setPct($(id)); });
  }

  // ---------- inputs ----------
  function wire() {
    var deals = $('deals');
    deals.value = String(state.deals);
    deals.addEventListener('input', function () {
      state.deals = Number(deals.value);
      setPct(deals);
      renderMonth();
      renderResidual();
      saveInputs();
    });

    document.querySelectorAll('.period-opt').forEach(function (b) {
      b.addEventListener('click', function () {
        state.period = b.getAttribute('data-period');
        renderPeriod();
        renderMonth();
        saveInputs();
      });
      b.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          var other = b.getAttribute('data-period') === 'ramp' ? $('periodStd') : $('periodRamp');
          other.focus(); other.click();
        }
      });
    });

    document.querySelectorAll('.seg-opt').forEach(function (b) {
      b.addEventListener('click', function () {
        state.pricing = b.getAttribute('data-pricing');
        renderPricing();
        renderMonth();
        renderResidual();
        renderRules();
        saveInputs();
      });
    });

    ['smallDeals', 'leadDeals', 'stmtDeals', 'stmtVolume', 'equipProfit'].forEach(function (id) {
      var inp = $(id);
      inp.value = String(state[id]);
      inp.addEventListener('input', function () {
        var n = Number(inp.value);
        state[id] = Number.isFinite(n) ? Math.max(0, n) : 0;
        renderMonth();
        renderResidual();
        saveInputs();
      });
    });

    ['deals30', 'deals90'].forEach(function (id) {
      var inp = $(id);
      inp.value = String(state[id]);
      inp.addEventListener('input', function () {
        state[id] = Number(inp.value);
        if (id === 'deals30' && state.deals90 < state.deals30) { state.deals90 = state.deals30; $('deals90').value = String(state.deals90); setPct($('deals90')); }
        if (id === 'deals90' && state.deals30 > state.deals90) { state.deals30 = state.deals90; $('deals30').value = String(state.deals30); setPct($('deals30')); }
        setPct(inp);
        renderNinety();
        saveInputs();
      });
    });
    $('all5k').checked = state.all5k;
    $('all5k').addEventListener('change', function () { state.all5k = $('all5k').checked; renderNinety(); saveInputs(); });

    [['resPace', 'resPace'], ['resVolume', 'resVolume'], ['resBps', 'resBps'], ['resAttrition', 'resAttrition']].forEach(function (p) {
      var inp = $(p[0]);
      inp.addEventListener('input', function () {
        if (inp.value === '') return;
        var n = Number(inp.value);
        state[p[1]] = Number.isFinite(n) ? Math.max(0, n) : 0;
        if (p[1] === 'resAttrition') state[p[1]] = Math.min(100, state[p[1]]);
        renderResidual();
        saveInputs();
      });
    });
  }

  // ---------- team setup ----------
  var FIELDS = [
    ['Team', [
      { k: 'team.name', label: 'Team name', type: 'text' },
      { k: 'team.manager', label: 'Manager name', type: 'text' },
      { k: 'team.note', label: 'Note to your agents (shown at the bottom)', type: 'textarea', wide: true },
      { k: 'team.guide', label: 'Team career guide (optional)', type: 'text', wide: true, hint: 'Leave blank for the company guide. Enter a slug like "lubbock" once assets/career-guide-lubbock.pdf is published.' }
    ]],
    ['Upfront commission', [
      { k: 'upfront.traditional', label: 'Traditional, per deal', pre: '$' },
      { k: 'upfront.cash', label: 'Cash discount, per deal', pre: '$' },
      { k: 'smallDeal.traditional', label: 'Swiper/salon deal, traditional', pre: '$' },
      { k: 'smallDeal.cash', label: 'Swiper/salon deal, cash discount', pre: '$' },
      { k: 'leadDeduction', label: 'Lead deduction per appointment deal', pre: '$' },
      { k: 'equipmentShare', label: 'Equipment sale share', post: '%' }
    ]],
    ['Ramp-up', [
      { k: 'rampMonths', label: 'Ramp-up length (months)' },
      { k: 'rampCommissionMultiplier', label: 'Commission multiplier during ramp-up', post: '×' }
    ]],
    ['Monthly bonus tiers', [
      { k: 'monthlyTiers', label: 'Standard (deals = bonus)', type: 'tiers', wide: true },
      { k: 'rampTiers', label: 'Ramp-up (deals = bonus)', type: 'tiers', wide: true }
    ]],
    ['First 90 days', [
      { k: 'fastStart30.deals', label: '30-day Fast Start: deals' },
      { k: 'fastStart30.bonus', label: '30-day Fast Start: bonus', pre: '$' },
      { k: 'signing.deals', label: 'Signing bonus: deals in 90 days' },
      { k: 'signing.option1', label: 'Option 1 bonus', pre: '$' },
      { k: 'signing.option1Min', label: 'Option 1: volume per merchant', pre: '$' },
      { k: 'signing.option2', label: 'Option 2 bonus', pre: '$' },
      { k: 'signing.option2Min', label: 'Option 2: volume per merchant', pre: '$' },
      { k: 'fastStart90', label: '90-day Fast Start (deals = bonus)', type: 'tiers', wide: true },
      { k: 'stack90Day', label: 'Signing bonus and 90-day Fast Start stack (otherwise the larger one pays)', type: 'check' }
    ]],
    ['Residual examples', [
      { k: 'residual.share', label: 'Residual share', post: '%' },
      { k: 'residual.volume', label: 'Example volume per merchant', pre: '$' },
      { k: 'residual.bps', label: 'Example net margin (bps)' },
      { k: 'residual.attrition', label: 'Example merchants lost per month', post: '%' }
    ]]
  ];

  function getPath(o, path) { return path.split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function setPath(o, path, v) {
    var ks = path.split('.'), last = ks.pop();
    var t = ks.reduce(function (a, k) { return a[k]; }, o);
    t[last] = v;
  }
  function tiersToText(t) { return t.map(function (p) { return p[0] + ' = ' + p[1]; }).join(', '); }
  function textToTiers(s) {
    return String(s).split(/[,\n;]+/).map(function (part) {
      var m = /(\d+)\D+?([\d,.]+)/.exec(part.trim());
      return m ? [Number(m[1]), Number(m[2].replace(/,/g, ''))] : null;
    }).filter(Boolean);
  }

  var draft = null;
  function buildSetup() {
    var body = $('setupBody');
    body.textContent = '';
    FIELDS.forEach(function (g) {
      var group = el('fieldset', 'setup-group');
      group.appendChild(el('h3', null, g[0]));
      g[1].forEach(function (f) {
        var id = 'cfg-' + f.k.replace(/\./g, '-');
        var val = getPath(draft, f.k);
        if (f.type === 'check') {
          var lab = el('label', 'check');
          lab.htmlFor = id;
          var cb = el('input'); cb.type = 'checkbox'; cb.id = id; cb.checked = !!val;
          cb.addEventListener('change', function () { setPath(draft, f.k, cb.checked); onDraftChange(); });
          lab.appendChild(cb); lab.appendChild(el('span', null, f.label));
          group.appendChild(lab);
          return;
        }
        var wrap = el('div', 'field' + (f.wide ? ' field-wide' : ''));
        var l = el('label', null, f.label); l.htmlFor = id;
        wrap.appendChild(l);
        var inp;
        if (f.type === 'textarea') { inp = el('textarea'); inp.value = val; inp.maxLength = 280; }
        else { inp = el('input'); inp.type = f.type === 'text' || f.type === 'tiers' ? 'text' : 'number'; inp.value = f.type === 'tiers' ? tiersToText(val) : String(val); }
        if (f.type === 'text') inp.maxLength = 60;
        if (inp.type === 'number') { inp.min = '0'; inp.step = 'any'; inp.inputMode = 'decimal'; }
        inp.id = id;
        inp.addEventListener('input', function () {
          var v = inp.value;
          if (f.type === 'tiers') v = textToTiers(v);
          else if (inp.type === 'number') { if (v === '') return; v = Number(v); }
          setPath(draft, f.k, v);
          onDraftChange();
        });
        if (f.pre || f.post) {
          var box = el('div', f.pre ? 'input-pre' : 'input-post');
          if (f.pre) box.appendChild(el('span', null, f.pre));
          box.appendChild(inp);
          if (f.post) box.appendChild(el('span', null, f.post));
          wrap.appendChild(box);
        } else wrap.appendChild(inp);
        if (f.type === 'tiers') wrap.appendChild(el('span', 'hint', 'Example: 5 = 500, 8 = 750, 10 = 1000'));
        if (f.hint) wrap.appendChild(el('span', 'hint', f.hint));
        group.appendChild(wrap);
      });
      body.appendChild(group);
    });
  }

  var linkTimer = 0;
  function onDraftChange() {
    cfg = C.mergeConfig(D, draft);
    renderAll();
    clearTimeout(linkTimer);
    linkTimer = setTimeout(updateLink, 120);
  }

  function updateLink() {
    var diff = C.diffConfig(D, cfg);
    $('copyStatus').textContent = '';
    if (!diff) {
      $('shareLink').value = baseUrl();
      try { history.replaceState(null, '', baseUrl()); } catch (e) { /* sandboxed */ }
      return Promise.resolve();
    }
    return encodePlan(diff).then(function (code) {
      var url = baseUrl() + '#team=' + code;
      $('shareLink').value = url;
      try { history.replaceState(null, '', url); } catch (e) { /* sandboxed */ }
    });
  }

  function openSetup() {
    draft = JSON.parse(JSON.stringify(cfg));
    buildSetup();
    updateLink();
    var dlg = $('setup');
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }

  function wireSetup() {
    $('openSetup').addEventListener('click', openSetup);
    $('applySetup').addEventListener('click', function () { $('setup').close(); });
    $('applySetup').textContent = 'Done';
    $('resetSetup').addEventListener('click', function () {
      draft = JSON.parse(JSON.stringify(D));
      buildSetup();
      onDraftChange();
    });
    $('copyLink').addEventListener('click', function () {
      var inp = $('shareLink');
      var done = function () { $('copyStatus').textContent = 'Link copied. Send it to your agents.'; };
      var fallback = function () { inp.focus(); inp.select(); $('copyStatus').textContent = 'Press Ctrl+C (or ⌘C) to copy the selected link.'; };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(inp.value).then(done, fallback);
        else fallback();
      } catch (e) { fallback(); }
    });
  }

  // ---------- boot ----------
  loadInputs();
  wire();
  wireSetup();
  renderAll();

  // Team file (?team=slug) first, then any #team= link overrides on top.
  Promise.all([readSlugPlan(), readHashPlan().catch(function () { return null; })]).then(function (res) {
    if (!res[0] && !res[1]) return;
    cfg = C.mergeConfig(D, res[0] || {});
    if (res[1]) cfg = C.mergeConfig(cfg, res[1]);
    renderAll();
  });
})();
