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

test('small deals, lead deductions, statements, equipment', () => {
  const r = C.monthEstimate(D, {
    deals: 5, pricing: 'cash', smallDeals: 2, leadDeals: 3, stmtDeals: 1, stmtVolume: 30000, equipProfit: 1000
  }, false);
  assert.equal(r.base, 3 * 400 + 2 * 200);
  assert.equal(r.leads, 150);
  assert.equal(r.statement, 75);
  assert.equal(r.equipment, 700);
  assert.equal(r.total, 1600 + 500 + 75 + 700 - 150);
});

test('sub-counts cannot exceed total deals', () => {
  const r = C.monthEstimate(D, { deals: 2, smallDeals: 9, leadDeals: 9, stmtDeals: 9, stmtVolume: 20000 }, false);
  assert.equal(r.smallDeals, 2);
  assert.equal(r.leads, 100);
  assert.equal(r.statement, 150);
});

test('90-day bonuses: best-of by default, stacking when enabled', () => {
  const a = C.ninetyDay(D, 5, 30, true);
  assert.equal(a.fast30, 1000);
  assert.equal(a.signing, 15000);
  assert.equal(a.fast90.amount, 3000);
  assert.equal(a.total, 1000 + 15000);
  const b = C.ninetyDay(Object.assign({}, D, { stack90Day: true }), 5, 30, false);
  assert.equal(b.total, 1000 + 10000 + 3000);
  const c = C.ninetyDay(D, 0, 90, false);
  assert.equal(c.winner, 'fast90');
  assert.equal(c.total, 15000);
});

test('residuals start in month 5 and need 3 deals/month before vesting', () => {
  const per = C.residualPerMerchant(D, 15000, 50);
  assert.equal(per, 37.5);
  const p = C.projectResiduals(D, { dealsPerMonth: 10, perMerchant: per, attrition: 0, months: 6, monthlyUpfront: 0 });
  assert.equal(p.rows[3].paid, 0);
  assert.equal(p.rows[4].paid, 40 * 37.5);
  const none = C.projectResiduals(D, { dealsPerMonth: 2, perMerchant: per, attrition: 0, months: 12, monthlyUpfront: 0 });
  assert.equal(none.rows[11].cum, 0);
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
    stack90Day: 'yes',
    evil: { a: 1 }
  });
  assert.equal(c.team.name.length, 60);
  assert.equal(c.team.extra, undefined);
  assert.equal(c.upfront.traditional, 350);
  assert.equal(c.upfront.cash, 400);
  assert.deepEqual(c.monthlyTiers, [[5, 400], [10, 1000]]);
  assert.equal(c.stack90Day, false);
  assert.equal(c.evil, undefined);
});

test('diffConfig round-trips through mergeConfig', () => {
  const edited = C.mergeConfig(D, { team: { name: 'Team Lubbock' }, upfront: { cash: 450 } });
  const diff = C.diffConfig(D, edited);
  assert.deepEqual(diff, { team: { name: 'Team Lubbock' }, upfront: { cash: 450 } });
  assert.deepEqual(C.mergeConfig(D, diff), edited);
  assert.equal(C.diffConfig(D, C.mergeConfig(D, {})), null);
});
