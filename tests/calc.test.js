// Unit tests for js/calc.js. Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../js/config.js');
const C = require('../js/calc.js');

test('monthly bonus pays highest tier only', () => {
  assert.equal(C.tierFor(D.monthlyTiers, 4).amount, 0);
  assert.equal(C.tierFor(D.monthlyTiers, 8).amount, 750);
  assert.equal(C.tierFor(D.monthlyTiers, 9).next[0], 10);
  assert.equal(C.tierFor(D.monthlyTiers, 25).amount, 2500);
});

test('statement volume tiers match Addendum I', () => {
  assert.equal(C.statementBonus(D.statement, 19999), 0);
  assert.equal(C.statementBonus(D.statement, 20000), 75);
  assert.equal(C.statementBonus(D.statement, 55000), 200);
  assert.equal(C.statementBonus(D.statement, 60000), 200);
  assert.equal(C.statementBonus(D.statement, 79999), 300);
  assert.equal(C.statementBonus(D.statement, 80000), 400);
});

test('standard month: 8 traditional deals', () => {
  const r = C.monthEstimate(D, { deals: 8, pricing: 'traditional' }, false);
  assert.equal(r.commission, 2400);
  assert.equal(r.bonus, 750);
  assert.equal(r.total, 3150);
});

test('ramp month doubles commission and uses ramp tiers (package example: 8 deals = $1,500 bonus)', () => {
  const r = C.monthEstimate(D, { deals: 8, pricing: 'traditional' }, true);
  assert.equal(r.commission, 4800);
  assert.equal(r.commissionSecond, 2400);
  assert.equal(r.bonus, 1500);
});

test('statements and equipment add to the month', () => {
  const r = C.monthEstimate(D, { deals: 5, pricing: 'cash', stmtDeals: 1, stmtVolume: 30000, equipProfit: 1000 }, false);
  assert.equal(r.base, 5 * 400);
  assert.equal(r.statement, 75);
  assert.equal(r.equipment, 700);
  assert.equal(r.total, 2000 + 500 + 75 + 700);
});

test('statement count cannot exceed total deals', () => {
  const r = C.monthEstimate(D, { deals: 2, stmtDeals: 9, stmtVolume: 20000 }, false);
  assert.equal(r.statement, 150);
});

test('ramp signing bonuses: 30-day Fast Start and a flat $15,000 25-deal bonus stack', () => {
  const a = C.ninetyDay(D, 5, 25);
  assert.equal(a.fast30, 1000);
  assert.equal(a.signing, 15000);
  assert.equal(a.total, 16000);
  const b = C.ninetyDay(D, 4, 24);
  assert.equal(b.total, 0);
  assert.equal(C.ninetyDay(D, 10, 3).deals90, 10, '90-day count is at least the 30-day count');
});

test('ramp bonus doubles only up to 10 deals, never pays less than standard', () => {
  assert.deepEqual(C.effectiveTiers(D, true), [[5, 1000], [8, 1500], [10, 2000], [20, 2500]]);
  assert.deepEqual(C.effectiveTiers(D, false), D.monthlyTiers);
  const at = n => C.monthEstimate(D, { deals: n }, true).bonus;
  assert.equal(at(10), 2000);
  assert.equal(at(12), 2000);
  assert.equal(at(15), 2000);
  assert.equal(at(20), 2500);
  for (let n = 1; n < 30; n++) assert.ok(at(n + 1) >= at(n), 'bonus dropped at ' + (n + 1));
});

test('goal planner finds the fewest deals that reach the goal', () => {
  const mix = { pricing: 'cash' };
  // standard cash: 10 deals = 4000 + 1000 = 5000
  assert.equal(C.dealsForGoal(D, mix, false, 5000, 0).deals, 10);
  assert.equal(C.dealsForGoal(D, mix, false, 5001, 0).deals, 11);
  assert.equal(C.dealsForGoal(D, mix, false, 5000, 6000).deals, 0);
  assert.equal(C.dealsForGoal(D, mix, false, 10000000, 0), null);
});

test('residuals start in month 4 with no minimum deal count', () => {
  const per = C.residualPerMerchant(D, 15000, 50);
  assert.equal(per, 37.5);
  const p = C.projectResiduals(D, { dealsPerMonth: 10, perMerchant: per, attrition: 0, months: 6, monthlyUpfront: 0 });
  assert.equal(p.rows[2].paid, 0);
  assert.equal(p.rows[3].paid, 30 * 37.5);
  const slow = C.projectResiduals(D, { dealsPerMonth: 2, perMerchant: per, attrition: 0, months: 12, monthlyUpfront: 0 });
  assert.ok(slow.rows[11].cum > 0);
});

test('vesting needs consecutive qualifying months', () => {
  const p = C.projectResiduals(D, { dealsPerMonth: 10, perMerchant: 40, attrition: 0, months: 24, monthlyUpfront: 5000 });
  // book >= 30 from month 3, comp >= 5000 every month -> vested at month 5
  assert.equal(p.vestedAt, 5);
});

test('mergeConfig rejects junk and keeps types', () => {
  const c = C.mergeConfig(D, {
    team: { name: '<img src=x onerror=alert(1)>'.repeat(5), extra: 'x' },
    upfront: { traditional: '350', cash: 'abc' },
    monthlyTiers: [[10, 900], ['x', 1], [5, 400], [10, 1000]],
    evil: { a: 1 }
  });
  assert.equal(c.team.name.length, 60);
  assert.equal(c.team.extra, undefined);
  assert.equal(c.upfront.traditional, 350);
  assert.equal(c.upfront.cash, 400);
  assert.deepEqual(c.monthlyTiers, [[5, 400], [10, 1000]]);
  assert.equal(c.evil, undefined);
});

test('team links can change team and contact info but never pay', () => {
  const c = C.mergeTeam(D, {
    team: { name: 'Team Lubbock', contactPhone: '214-555-0142' },
    upfront: { cash: 9999 },
    monthlyTiers: [[1, 100000]],
    signing: { bonus: 1 },
    residual: { share: 100 }
  });
  assert.equal(c.team.name, 'Team Lubbock');
  assert.equal(c.team.contactPhone, '214-555-0142');
  assert.equal(c.upfront.cash, D.upfront.cash);
  assert.deepEqual(c.monthlyTiers, D.monthlyTiers);
  assert.equal(c.signing.bonus, D.signing.bonus);
  assert.equal(c.residual.share, D.residual.share);
  assert.deepEqual(C.mergeTeam(D, null), C.mergeConfig(D, {}));
});

const TEAMS = require('../js/teams.js');

test('team block: names come from the team list, links fill in contact details', () => {
  const b = C.teamBlock(TEAMS, D, 'maverick', { contactName: 'Someone Else', contactPhone: '214-555-0142', note: '  Go get it  ' });
  assert.equal(b.name, 'Team Maverick');
  assert.equal(b.contactName, 'Blake Woodruff');
  assert.equal(b.contactPhone, '214-555-0142');
  assert.equal(b.note, 'Go get it');
  assert.equal(b.contactTitle, D.team.contactTitle);
});

test('team block: official phone and email cannot be overridden by a link', () => {
  const teams = { x: { name: 'Team X', director: 'Pat Doe', phone: '806-555-0100', email: 'pat@wholesalepayments.com' } };
  const b = C.teamBlock(teams, D, 'x', { contactPhone: '999-999-9999', contactEmail: 'evil@example.com' });
  assert.equal(b.contactPhone, '806-555-0100');
  assert.equal(b.contactEmail, 'pat@wholesalepayments.com');
});

test('every team has a short link page that forwards to it', () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', 'team');
  const built = fs.readdirSync(dir).sort();
  assert.deepEqual(built, Object.keys(TEAMS).sort(), 'run node scripts/build-team-pages.js');
  for (const slug of built) {
    const html = fs.readFileSync(path.join(dir, slug, 'index.html'), 'utf8');
    assert.ok(html.includes("'../../?team=" + slug + "'"), slug + ' page forwards to its team');
    assert.ok(html.includes(TEAMS[slug].name), slug + ' page names its team');
  }
});
