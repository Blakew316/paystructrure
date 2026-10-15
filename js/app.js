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
    pricing: 'cash',
    stmtDeals: 1,
    stmtVolume: 30000,
    equipProfit: 0,
    deals30: 5,
    deals90: 25,
    goalAmount: 10000,
    goalResidual: 0,
    stmtCalcVolume: 85000,
    resPace: null,          // null = follow the main slider
    resVolume: null         // null = team default
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
        if (state.pricing !== 'traditional' && state.pricing !== 'cash') state.pricing = 'cash';
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

  /**
   * Team overrides from the link. New links use `?t=`; older `#team=` links
   * still work and are rewritten to `?t=` so "Add to Home Screen" keeps the
   * team plan (iOS drops the fragment from home-screen bookmarks).
   */
  function readLinkPlan() {
    var q = new URLSearchParams(location.search).get('t');
    if (q && /^[A-Za-z0-9_-]+$/.test(q)) return decodePlan(q);
    var m = /(?:^#|&)team=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (!m) return Promise.resolve(null);
    try { history.replaceState(null, '', baseUrl() + '?t=' + m[1]); } catch (e) { /* sandboxed */ }
    return decodePlan(m[1]);
  }
  function readSlugPlan() {
    var slug = new URLSearchParams(location.search).get('team');
    if (!slug || !/^[a-z0-9-]{1,40}$/.test(slug)) return Promise.resolve(null);
    return fetch('teams/' + slug + '.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  // ---------- rendering ----------
  function tiersFor(period) { return C.effectiveTiers(cfg, period === 'ramp'); }

  function bindText() {
    var map = {
      rampMonths: String(cfg.rampMonths),
      rampMonthsPlus: String(cfg.rampMonths + 1),
      firstPayMonth: String(cfg.residual.firstPayMonth),
      residualShare: cfg.residual.share + '%',
      signingDeals: String(cfg.signing.deals)
    };
    document.querySelectorAll('[data-bind]').forEach(function (n) {
      var v = map[n.getAttribute('data-bind')];
      if (v != null) n.textContent = v;
    });

    document.title = cfg.team.name === D.team.name ? 'Agent Pay Estimator' : cfg.team.name + ' Pay Estimator';

    $('tradRate').textContent = money(cfg.upfront.traditional) + '/deal';
    $('cashRate').textContent = money(cfg.upfront.cash) + '/deal';

    $('cmpCommRamp').textContent = cfg.rampCommissionMultiplier + '× per deal';
    var first = cfg.monthlyTiers.slice(0, 3);
    $('cmpBonusLabel').textContent = 'Monthly bonus at ' + first.map(function (t) { return t[0]; }).join(' / ') + ' deals';
    $('cmpBonusStd').textContent = first.map(function (t) { return money(t[1]); }).join(' / ');
    $('cmpBonusRamp').textContent = first.map(function (t) { return money(C.tierFor(C.effectiveTiers(cfg, true), t[0]).amount); }).join(' / ');

    var slug = /^[a-z0-9-]{1,40}$/.test(cfg.team.guide) ? cfg.team.guide : '';
    document.querySelectorAll('.guide-link').forEach(function (link) {
      link.href = slug ? 'assets/career-guide-' + slug + '.pdf' : 'assets/career-guide.pdf';
    });

    var note = cfg.team.note.trim();
    $('managerNote').hidden = !note;
    $('managerNoteText').textContent = note;
    var by = (cfg.team.name + ' ' + cfg.team.title).trim();
    $('managerNoteBy').textContent = '— ' + (cfg.team.manager ? cfg.team.manager + ', ' + by : by);

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

  /**
   * Side-by-side Ramp-Up vs Standard table. rows: [label, rampValue, stdValue].
   * The column for the period the agent picked is highlighted, and the column
   * headers switch the period.
   */
  function renderSplit(box, totalLabel, totals, rows) {
    box.textContent = '';
    var cols = [['ramp', 'Ramp-Up', 'c-ramp'], ['standard', 'Standard', 'c-std']];
    function cell(cls, text, role) {
      var c = el('div', cls, text);
      c.setAttribute('role', role || 'cell');
      box.appendChild(c);
      return c;
    }
    cell('sp-label sp-head', '', 'columnheader');
    cols.forEach(function (c) {
      var h = cell('sp-head ' + c[2] + (state.period === c[0] ? ' on' : ''), null, 'columnheader');
      var b = el('button', 'sp-switch', c[1]);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(state.period === c[0]));
      b.addEventListener('click', function () { setPeriod(c[0]); });
      h.appendChild(b);
    });
    cell('sp-label sp-total', totalLabel, 'rowheader');
    cell('sp-val sp-total c-ramp' + (state.period === 'ramp' ? ' on' : ''), money(totals[0]));
    cell('sp-val sp-total c-std' + (state.period === 'standard' ? ' on' : ''), money(totals[1]));
    rows.forEach(function (r, i) {
      var last = i === rows.length - 1 ? ' sp-last' : '';
      cell('sp-label' + last, r[0], 'rowheader');
      cell('sp-val c-ramp' + (state.period === 'ramp' ? ' on' : '') + (r[1] ? '' : ' zero') + last, money(r[1]));
      cell('sp-val c-std' + (state.period === 'standard' ? ' on' : '') + (r[2] ? '' : ' zero') + last, money(r[2]));
    });
  }

  function renderMonth() {
    var ramp = state.period === 'ramp';
    var rr = C.monthEstimate(cfg, state, true);
    var rs = C.monthEstimate(cfg, state, false);
    var r = ramp ? rr : rs;

    $('dealsOut').textContent = String(r.deals);
    var rows = [
      ['Upfront commission', rr.commission, rs.commission],
      ['Monthly bonus', rr.bonus, rs.bonus],
      ['Statement volume bonus', rr.statement, rs.statement]
    ];
    if (rr.equipment) rows.push(['Equipment sales', rr.equipment, rs.equipment]);
    renderSplit($('breakdown'), 'This month', [rr.total, rs.total], rows);

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

    $('payoutNote').textContent = 'Daily pay: once a merchant crosses the processing threshold (5 separate cards, $1,000), you are paid the next day. ' +
      'Every deal in a bonus tier must hit the processing minimum within 90 days.';

    var each = C.statementBonus(cfg.statement, state.stmtVolume);
    $('stmtHint').textContent = each ? money(each) + ' bonus per qualifying deal.' : 'Under ' + money(cfg.statement.lowMin) + ' earns no statement bonus.';

    renderTicks();
    renderGoal();
    renderStmt();
    return r;
  }

  function fixed1(n) { var t = (Math.round(n * 10) / 10).toFixed(1); return t.slice(-2) === '.0' ? t.slice(0, -2) : t; }

  function renderGoal() {
    var ramp = state.period === 'ramp';
    $('goalPeriod').textContent = ramp ? 'Ramp-Up month' : 'Standard month';
    document.querySelectorAll('#goalChips .chip').forEach(function (c) {
      c.setAttribute('aria-pressed', String(Number(c.getAttribute('data-goal')) === state.goalAmount));
    });
    var res = C.dealsForGoal(cfg, state, ramp, state.goalAmount, state.goalResidual, 200);
    var stats = $('goalStats');
    stats.textContent = '';
    if (!res) {
      $('goalDeals').textContent = '200+';
      $('goalDealsUnit').textContent = 'deals';
      $('goalSub').textContent = 'That goal needs more than 200 deals this month at your current deal mix.';
      $('goalNote').textContent = '';
      return;
    }
    var d = res.deals;
    $('goalDeals').textContent = String(d);
    $('goalDealsUnit').textContent = d === 1 ? 'deal this month' : 'deals this month';
    if (d === 0) {
      $('goalSub').textContent = 'Your residuals already cover this goal.';
      $('goalNote').textContent = '';
      return;
    }
    var est = res.estimate;
    var sub = 'Estimated pay at ' + plural(d, 'deal') + ': ' + money(est.total);
    if (state.goalResidual > 0) sub += ' + ' + money(state.goalResidual) + ' in residuals';
    if (est.tier.hit) sub += '. That includes the ' + est.tier.hit[0] + '-deal bonus of ' + money(est.bonus);
    $('goalSub').textContent = sub + '.';

    var rate = Math.max(1, cfg.closeRate) / 100;
    var appts = Math.ceil(d / rate);
    [['Deals per week', fixed1(d / 4.33)],
     ['Appointments this month', String(appts)],
     ['Appointments per week', fixed1(appts / 4.33)],
     ['Appointments per workday', fixed1(appts / 21.7)]
    ].forEach(function (s2) {
      var box = el('div', 'stat');
      box.appendChild(el('span', null, s2[0]));
      box.appendChild(el('b', null, s2[1]));
      stats.appendChild(box);
    });
    $('goalNote').textContent = 'Appointments assume every deal comes from a company appointment at a ' + cfg.closeRate +
      '% close rate. Deals you find yourself lower that number. ' +
      (ramp ? 'Includes ramp-up double commission and bonuses.' : 'Uses standard commission and bonuses.') +
      ' Does not include the 30-day or 25-deal bonuses.';
  }

  function renderStmt() {
    var key = state.pricing === 'cash' ? 'cash' : 'traditional';
    var st = cfg.statement;
    var vol = state.stmtCalcVolume;
    var bonus = C.statementBonus(st, vol);
    var commStd = cfg.upfront[key];
    var commRamp = commStd * cfg.rampCommissionMultiplier;

    if (document.activeElement !== $('stmtCalcVolume')) $('stmtCalcVolume').value = String(vol);
    var slider = $('stmtCalcSlider');
    slider.value = String(Math.min(Number(slider.max), vol));
    setPct(slider);
    document.querySelectorAll('#stmtChips .chip').forEach(function (c) {
      c.setAttribute('aria-pressed', String(Number(c.getAttribute('data-volume')) === vol));
    });

    renderSplit($('stmtBreakdown'), 'This deal', [commRamp + bonus, commStd + bonus], [
      ['Upfront commission', commRamp, commStd],
      ['Statement volume bonus', bonus, bonus]
    ]);

    // next volume that pays more
    var cands = [st.lowMin, st.midMin, st.topMin];
    var k = vol >= st.topMin ? Math.floor((vol - st.topMin) / st.step) + 1 : 1;
    cands.push(st.topMin + k * st.step);
    var next = null;
    cands.sort(function (a, b) { return a - b; }).some(function (c) {
      if (c > vol && C.statementBonus(st, c) > bonus) { next = c; return true; }
      return false;
    });
    var nt = $('stmtNext');
    nt.textContent = '';
    if (next !== null) {
      nt.appendChild(el('strong', null, money(next - vol) + ' more'));
      nt.appendChild(document.createTextNode(' in monthly volume pays '));
      nt.appendChild(el('strong', null, '+' + money(C.statementBonus(st, next) - bonus)));
      nt.appendChild(document.createTextNode(' more on this deal.'));
    }

    var rows = [
      ['Under ' + short(st.lowMin), '$0', vol < st.lowMin],
      [short(st.lowMin) + ' – ' + short(st.midMin) , money(st.low), vol >= st.lowMin && vol < st.midMin],
      [short(st.midMin) + ' – ' + short(st.topMin), money(st.mid), vol >= st.midMin && vol < st.topMin],
      [short(st.topMin) + ' and up', money(st.topBase) + ' + ' + money(st.stepBonus) + ' per extra ' + short(st.step), vol >= st.topMin]
    ];
    var box = $('stmtTiers');
    box.textContent = '';
    rows.forEach(function (r) {
      var line = el('div', 'stmt-row' + (r[2] ? ' on' : ''));
      line.setAttribute('role', 'row');
      var a = el('span', null, r[0]); a.setAttribute('role', 'cell');
      var b = el('span', null, r[1]); b.setAttribute('role', 'cell');
      line.appendChild(a); line.appendChild(b);
      box.appendChild(line);
    });
  }

  function renderNinety() {
    var n = C.ninetyDay(cfg, state.deals30, state.deals90);
    $('deals30Out').textContent = String(state.deals30);
    $('deals90Out').textContent = String(n.deals90);
    $('ninetyTotal').textContent = money(n.total);
    $('ninetyRule').textContent = 'Both bonuses stack on top of your monthly pay.';

    var box = $('bonusCards');
    box.textContent = '';

    function card(title, amount, earned, desc, progress, pill) {
      var c = el('article', 'bcard' + (earned ? ' earned' : ''));
      c.appendChild(el('h3', null, title));
      c.appendChild(el('span', 'amt', money(amount)));
      var bar = el('div', 'progress');
      var fill = el('i');
      fill.style.width = Math.min(100, progress * 100) + '%';
      bar.appendChild(fill);
      c.appendChild(bar);
      c.appendChild(el('p', null, desc));
      var st = el('div', 'status');
      st.appendChild(el('span', 'pill' + (earned ? ' on' : ''), pill));
      c.appendChild(st);
      box.appendChild(c);
    }

    var f = cfg.fastStart30;
    card('30-Day Fast Start', f.bonus, n.fast30 > 0,
      f.deals + ' deals in your first 30 days. Paid once those deals process $1,000 and 5 transactions.',
      n.deals30 / f.deals,
      n.fast30 ? 'Earned' : plural(Math.max(0, f.deals - n.deals30), 'deal') + ' to go');

    var sg = cfg.signing;
    card(sg.deals + '-Deal Signing Bonus', sg.bonus, n.signing > 0,
      sg.deals + ' deals in your first 90 days, then 60 more days to get all ' + sg.deals + ' processing ' + money(sg.minVolume) + '+. The report runs once.',
      n.deals90 / sg.deals,
      n.signing ? 'Earned' : plural(Math.max(0, sg.deals - n.deals90), 'deal') + ' to go');
  }

  function residualInputs() {
    return {
      pace: state.resPace === null ? state.deals : state.resPace,
      volume: state.resVolume === null ? cfg.residual.volume : state.resVolume,
      bps: cfg.residual.bps,
      attrition: cfg.residual.attrition
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
    var rampLadder = C.effectiveTiers(cfg, true);
    var doubledTo = cfg.rampTiers.length ? cfg.rampTiers[cfg.rampTiers.length - 1][0] : 0;
    var ladderText = function (l) { return l.map(function (t) { return t[0] + ' deals ' + short(t[1]); }).join(', '); };
    var groups = [
      ['When deals pay', [
        'Daily pay: once a merchant crosses the processing threshold, you are paid the next day.',
        'The threshold is at least 5 transactions on separate cards and $1,000 in volume.',
        'Upfront starts at ' + money(cfg.upfront.cash) + ' for cash discount deals and ' + money(cfg.upfront.traditional) + ' for traditional deals, adjusted for volume and SSOC pricing.',
        'Leases pay once funded and the Delivery & Acceptance form is in. Equipment sales pay ' + cfg.equipmentShare + '% of the sale minus equipment cost once the merchant has paid in full.'
      ]],
      ['Monthly bonuses', [
        'Only your best tier pays. Standard: ' + ladderText(cfg.monthlyTiers) + '.',
        'During ramp-up (months 1–' + cfg.rampMonths + ') the bonus is doubled up to ' + doubledTo + ' deals: ' + ladderText(cfg.rampTiers) + '. Above that, you earn the standard tier once it pays more: ' + ladderText(rampLadder.filter(function (t) { return t[0] > doubledTo; })) + '.',
        'Ramp-up bonuses and the second ramp-up commission pay in two parts: the first when accounts hit 5 transactions and $1,000, the second at 10 transactions and $5,000.',
        'Every deal in a tier must be processing $1,000 in a 30-day span within 90 days. For example, a January 8-deal bonus needs all 8 accounts processing by April 30.'
      ]],
      ['Statement volume bonus', [
        'Submit the statement with the merchant application. It must be within the last 90 days.',
        money(st.lowMin) + ' to ' + money(st.midMin - 1) + ': ' + money(st.low) + '. ' + money(st.midMin) + ' to ' + money(st.topMin - 1) + ': ' + money(st.mid) + '.',
        money(st.topMin) + ' and above: ' + money(st.topBase) + ' plus ' + money(st.stepBonus) + ' for every additional ' + money(st.step) + ' in monthly volume.'
      ]],
      ['Appointments', [
        'Complete the appointment certification in WPI University and you receive company appointments. No deal is required to unlock them.',
        'Keep a ' + cfg.closeRate + '% close rate. Deals you generate yourself also count toward it.',
        'Submit feedback on every appointment by 8 PM the same day, with the merchant name and result.'
      ]],
      ['Residuals and vesting', [
        'You earn ' + cfg.residual.share + '% of the residual on your merchants. Residuals pay on the first Friday of each month, starting month ' + cfg.residual.firstPayMonth + '.',
        'You are vested after ' + cfg.vesting.months + ' straight months with at least ' + money(cfg.vesting.comp) + ' in compensation and ' + cfg.vesting.accounts + ' processing merchant accounts.'
      ]],
      ['Deductions', [
        'Non-processing: if a merchant stops processing for 30 days (within 120 days of payment), the upfront commission, statement bonus and ramp-up bonus are deducted. They are paid back once the merchant processes again.',
        'Equipment: if a merchant has not processed for 45 days, the equipment cost is deducted until the merchant processes or the equipment is returned.',
        'Statement bonus: deducted after 60 days if the merchant doesn\'t process the statement amount.',
        'Pricing below the SSOC: the monthly minimum and monthly service fee difference ×3, plus the annual fee and early termination fee difference.'
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
    ['deals', 'deals30', 'deals90', 'stmtCalcSlider'].forEach(function (id) { setPct($(id)); });
  }

  function setPeriod(p) {
    state.period = p === 'standard' ? 'standard' : 'ramp';
    renderPeriod();
    renderMonth();
    saveInputs();
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
      b.addEventListener('click', function () { setPeriod(b.getAttribute('data-period')); });
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

    ['stmtDeals', 'stmtVolume', 'equipProfit'].forEach(function (id) {
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
    var goal = $('goalAmount'), goalRes = $('goalResidual');
    goal.value = String(state.goalAmount);
    goalRes.value = String(state.goalResidual);
    [[goal, 'goalAmount'], [goalRes, 'goalResidual']].forEach(function (p) {
      p[0].addEventListener('input', function () {
        var n = Number(p[0].value);
        state[p[1]] = Number.isFinite(n) ? Math.max(0, n) : 0;
        renderGoal();
        saveInputs();
      });
    });
    document.querySelectorAll('#goalChips .chip').forEach(function (c) {
      c.addEventListener('click', function () {
        state.goalAmount = Number(c.getAttribute('data-goal'));
        goal.value = String(state.goalAmount);
        renderGoal();
        saveInputs();
      });
    });

    function setStmtVolume(v) {
      state.stmtCalcVolume = Math.max(0, Number.isFinite(v) ? v : 0);
      renderStmt();
      saveInputs();
    }
    $('stmtCalcVolume').addEventListener('input', function () { setStmtVolume(Number($('stmtCalcVolume').value)); });
    $('stmtCalcSlider').addEventListener('input', function () {
      setStmtVolume(Number($('stmtCalcSlider').value));
      $('stmtCalcVolume').value = String(state.stmtCalcVolume);
    });
    document.querySelectorAll('#stmtChips .chip').forEach(function (c) {
      c.addEventListener('click', function () {
        setStmtVolume(Number(c.getAttribute('data-volume')));
        $('stmtCalcVolume').value = String(state.stmtCalcVolume);
      });
    });

    ['resPace', 'resVolume'].forEach(function (id) {
      var inp = $(id);
      inp.addEventListener('input', function () {
        if (inp.value === '') return;
        var n = Number(inp.value);
        state[id] = Number.isFinite(n) ? Math.max(0, n) : 0;
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
      { k: 'team.title', label: 'Manager title (shown under the note)', type: 'text' },
      { k: 'team.note', label: 'Note to your agents (shown at the bottom)', type: 'textarea', wide: true },
      { k: 'team.guide', label: 'Team career guide (optional)', type: 'text', wide: true, hint: 'Leave blank for the company guide. Enter a slug like "lubbock" once assets/career-guide-lubbock.pdf is published.' }
    ]],
    ['Upfront commission', [
      { k: 'upfront.cash', label: 'Cash discount, per deal', pre: '$' },
      { k: 'upfront.traditional', label: 'Traditional, per deal', pre: '$' },
      { k: 'closeRate', label: 'Appointment close rate', post: '%' },
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
      { k: 'signing.bonus', label: 'Signing bonus', pre: '$' },
      { k: 'signing.minVolume', label: 'Signing bonus: volume per merchant', pre: '$' }
    ]],
    ['Residuals', [
      { k: 'residual.share', label: 'Residual share', post: '%' },
      { k: 'residual.firstPayMonth', label: 'First residual month' },
      { k: 'residual.volume', label: 'Default volume per merchant', pre: '$' },
      { k: 'residual.bps', label: 'Net margin used for estimates (bps)' },
      { k: 'residual.attrition', label: 'Merchants lost per month', post: '%' }
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
      var url = baseUrl() + '?t=' + code;
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

  // ---------- home-screen app ----------
  function setupPwa() {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline support is optional */ });
    }
    var ua = navigator.userAgent;
    var iOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    var standalone = navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    var dismissed = false;
    try { dismissed = localStorage.getItem('wp-install-dismissed') === '1'; } catch (e) { /* ignore */ }
    if (!iOS || !safari || standalone || dismissed) return;
    var hint = $('installHint');
    hint.hidden = false;
    $('installClose').addEventListener('click', function () {
      hint.hidden = true;
      try { localStorage.setItem('wp-install-dismissed', '1'); } catch (e) { /* ignore */ }
    });
  }

  // ---------- boot ----------
  loadInputs();
  wire();
  wireSetup();
  renderAll();
  setupPwa();

  // Team file (?team=slug) first, then any ?t= link overrides on top.
  Promise.all([readSlugPlan(), readLinkPlan().catch(function () { return null; })]).then(function (res) {
    if (!res[0] && !res[1]) return;
    cfg = C.mergeConfig(D, res[0] || {});
    if (res[1]) cfg = C.mergeConfig(cfg, res[1]);
    renderAll();
  });
})();
