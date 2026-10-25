// Tax math for FY 2025-26 / AY 2026-27. Run with: npm test  (or node --test tests/)
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../assets/tax-core.js");

const total = (inputs, regime) => T.compute(inputs, regime).tax.total;

test("slab tax — new regime", () => {
  assert.equal(T.slabTax(4_00_000, T.SLABS.new), 0);
  assert.equal(T.slabTax(12_00_000, T.SLABS.new), 60_000);
  assert.equal(T.slabTax(24_00_000, T.SLABS.new), 3_00_000);
  assert.equal(T.slabTax(30_00_000, T.SLABS.new), 4_80_000);
});

test("slab tax — old regime by age", () => {
  assert.equal(T.slabTax(10_00_000, T.SLABS.old.below60), 1_12_500);
  assert.equal(T.slabTax(10_00_000, T.SLABS.old["60to79"]), 1_10_000);
  assert.equal(T.slabTax(10_00_000, T.SLABS.old["80plus"]), 1_00_000);
});

test("new regime: ₹12.75 lakh salary is tax-free (₹75,000 std deduction + 87A)", () => {
  const r = T.compute({ salaryGross: 12_75_000 }, "new");
  assert.equal(r.salary.stdDeduction, 75_000);
  assert.equal(r.totalIncome, 12_00_000);
  assert.equal(r.tax.beforeRebate, 60_000);
  assert.equal(r.tax.rebate, 60_000);
  assert.equal(r.tax.total, 0);
});

test("new regime: marginal relief under 87A just above ₹12 lakh", () => {
  const r = T.compute({ otherIncome: 12_10_000 }, "new");
  assert.equal(r.tax.beforeRebate, 61_500);
  assert.equal(r.tax.rebate, 51_500); // tax limited to the ₹10,000 above 12 lakh
  assert.equal(r.tax.total, 10_400);
  // relief ends once tax ≤ excess (about ₹12,70,588)
  assert.equal(T.compute({ otherIncome: 12_80_000 }, "new").tax.rebate, 0);
});

test("new regime: ₹24 lakh and ₹60 lakh (10% surcharge)", () => {
  assert.equal(total({ otherIncome: 24_00_000 }, "new"), 3_12_000);
  const r = T.compute({ otherIncome: 60_00_000 }, "new");
  assert.equal(r.tax.surchargeRate, 0.10);
  assert.equal(r.tax.surcharge, 1_38_000);
  assert.equal(r.tax.surchargeRelief, 0);
  assert.equal(r.tax.total, 15_78_720);
});

test("surcharge marginal relief just above ₹50 lakh", () => {
  const r = T.compute({ otherIncome: 50_10_000 }, "new");
  assert.equal(r.tax.afterRebate, 10_83_000);
  assert.equal(r.tax.surchargeGross, 1_08_300);
  assert.equal(r.tax.surcharge, 7_000); // tax + surcharge capped at 10,80,000 + 10,000
  assert.equal(r.tax.total, 11_33_600);
});

test("surcharge caps: 37% old regime above ₹5 crore, 25% in the new regime", () => {
  const o = T.compute({ otherIncome: 6 * 1e7 }, "old");
  const n = T.compute({ otherIncome: 6 * 1e7 }, "new");
  assert.equal(o.tax.surchargeRate, 0.37);
  assert.equal(n.tax.surchargeRate, 0.25);
});

test("old regime: 87A up to ₹5 lakh, cess above", () => {
  assert.equal(total({ otherIncome: 5_00_000 }, "old"), 0);
  assert.equal(total({ otherIncome: 10_00_000 }, "old"), 1_17_000);
  assert.equal(total({ otherIncome: 10_00_000, ageGroup: "60to79" }, "old"), 1_14_400);
  assert.equal(total({ otherIncome: 10_00_000, ageGroup: "80plus" }, "old"), 1_04_000);
});

test("old regime: salary with HRA, std deduction, professional tax and deductions", () => {
  const inputs = {
    salaryGross: 15_00_000, basicDA: 6_00_000, hraReceived: 3_00_000, rentPaid: 2_40_000, metroCity: true,
    professionalTax: 2_500, d80C: 2_00_000, d80CCD1B: 50_000, d80DSelf: 30_000, savingsInterest: 12_000,
  };
  const r = T.compute(inputs, "old");
  assert.equal(r.salary.hra, 1_80_000); // min(3L, 2.4L − 60k, 50% of 6L)
  assert.equal(r.salary.income, 15_00_000 - 1_80_000 - 50_000 - 2_500);
  assert.equal(r.deductions.d80C, 1_50_000);
  assert.equal(r.deductions.d80D, 25_000);
  assert.equal(r.deductions.d80TTA, 10_000);
  // GTI 12,79,500 − 2,35,000 = 10,44,500
  assert.equal(r.totalIncome, 10_44_500);
  assert.equal(r.tax.beforeRebate, 1_25_850);
  assert.equal(r.tax.total, 1_30_880);
  // the same person in the new regime: no HRA / 80C, ₹75,000 std deduction
  const n = T.compute(inputs, "new");
  assert.equal(n.totalIncome, 14_37_000);
  assert.equal(n.tax.total, 99_370);
  assert.equal(T.compare(inputs).better, "new");
});

test("HRA exemption is the least of the three limits", () => {
  assert.equal(T.hraExemption(T.normalize({ basicDA: 5_00_000, hraReceived: 1_00_000, rentPaid: 3_00_000 })), 1_00_000);
  assert.equal(T.hraExemption(T.normalize({ basicDA: 5_00_000, hraReceived: 3_00_000, rentPaid: 3_00_000 })), 2_00_000); // 40% non-metro
  assert.equal(T.hraExemption(T.normalize({ basicDA: 5_00_000, hraReceived: 3_00_000, rentPaid: 0 })), 0);
});

test("house property: self-occupied interest and set-off limits", () => {
  const o = T.compute({ salaryGross: 10_00_000, hpSelfInterest: 3_00_000 }, "old");
  assert.equal(o.houseProperty.selfInterest, 2_00_000);
  assert.equal(o.houseProperty.income, -2_00_000);
  const n = T.compute({ salaryGross: 10_00_000, hpSelfInterest: 3_00_000 }, "new");
  assert.equal(n.houseProperty.income, 0);
  // let-out: NAV 3,00,000 − 30% − interest 5,00,000 = −2,90,000 → capped at −2,00,000 (old), 0 (new)
  const lo = T.compute({ salaryGross: 10_00_000, hpLetRent: 3_20_000, hpLetMunicipalTax: 20_000, hpLetInterest: 5_00_000 }, "old");
  assert.equal(lo.houseProperty.nav, 3_00_000);
  assert.equal(lo.houseProperty.std30, 90_000);
  assert.equal(lo.houseProperty.computed, -2_90_000);
  assert.equal(lo.houseProperty.income, -2_00_000);
  assert.equal(lo.notes.length, 1);
  const ln = T.compute({ salaryGross: 10_00_000, hpLetRent: 3_20_000, hpLetMunicipalTax: 20_000, hpLetInterest: 5_00_000 }, "new");
  assert.equal(ln.houseProperty.income, 0);
});

test("LTCG u/s 112A counts toward total income, so 87A is lost above ₹12 lakh", () => {
  const r = T.compute({ salaryGross: 12_75_000, ltcg112A: 2_25_000 }, "new");
  assert.equal(r.totalIncome, 14_25_000);
  assert.equal(r.tax.normal, 60_000);
  assert.equal(r.tax.t112A, 12_500); // 12.5% of (2,25,000 − 1,25,000)
  assert.equal(r.tax.rebate, 0);
  assert.equal(r.tax.total, 75_400);
});

test("special-rate gains use the unused basic exemption", () => {
  // only ₹5 lakh LTCG 112A: 4 lakh shortfall + 1.25 lakh exemption → nil
  assert.equal(T.compute({ ltcg112A: 5_00_000 }, "new").tax.beforeRebate, 0);
  // old regime: 2L interest + 2L STCG 111A; 50k shortfall → 1.5L × 20% = 30,000; 87A 12,500
  const r = T.compute({ otherIncome: 2_00_000, stcg111A: 2_00_000 }, "old");
  assert.equal(r.tax.t111A, 30_000);
  assert.equal(r.tax.rebate, 12_500);
  assert.equal(r.tax.total, 18_200);
});

test("new regime: 87A rebate does not apply to tax on s.111A gains", () => {
  const r = T.compute({ otherIncome: 8_00_000, stcg111A: 2_00_000 }, "new");
  assert.equal(r.totalIncome, 10_00_000);
  assert.equal(r.tax.normal, 20_000);
  assert.equal(r.tax.t111A, 40_000);
  assert.equal(r.tax.rebate, 20_000);
  assert.equal(r.tax.total, 41_600);
});

test("Chapter VI-A deductions are not set against special-rate gains", () => {
  const r = T.compute({ otherIncome: 1_00_000, stcg111A: 10_00_000, d80C: 1_50_000 }, "old");
  assert.equal(r.deductions.total, 1_00_000);
  assert.equal(r.totalIncome, 10_00_000);
});

test("family pension deduction, 80TTB for seniors, 80CCD(2) caps", () => {
  const o = T.compute({ familyPension: 90_000 }, "old");
  assert.equal(o.otherSources.fpDeduction, 15_000);
  assert.equal(T.compute({ familyPension: 90_000 }, "new").otherSources.fpDeduction, 25_000);
  const s = T.compute({ ageGroup: "60to79", savingsInterest: 20_000, depositInterest: 60_000 }, "old");
  assert.equal(s.deductions.d80TTB, 50_000);
  assert.equal(s.deductions.d80TTA, 0);
  const nps = { salaryGross: 20_00_000, basicDA: 10_00_000, d80CCD2: 2_00_000 };
  assert.equal(T.compute(nps, "new").deductions.d80CCD2, 1_40_000);
  assert.equal(T.compute(nps, "old").deductions.d80CCD2, 1_00_000);
});

test("rounding u/s 288A/288B and balance after taxes paid", () => {
  assert.equal(T.round10(1_234), 1_230);
  assert.equal(T.round10(1_235), 1_240);
  assert.equal(T.round10(-1_235), -1_240);
  const r = T.compute({ otherIncome: 10_00_004, taxesPaid: 1_20_000 }, "old");
  assert.equal(r.totalIncome, 10_00_000);
  assert.equal(r.tax.balance, -3_000); // refund
});

test("inputs are normalised: blanks, commas, negatives, booleans", () => {
  const i = T.normalize({ salaryGross: "12,75,000", hraReceived: "", rentPaid: -5, metroCity: "on", ageGroup: "bogus" });
  assert.equal(i.salaryGross, 12_75_000);
  assert.equal(i.hraReceived, 0);
  assert.equal(i.rentPaid, 0);
  assert.equal(i.metroCity, true);
  assert.equal(i.ageGroup, "below60");
});

test("statement rows and CSV", () => {
  const cmp = T.compare({ assessee: 'A "B"', salaryGross: 12_75_000 });
  const rows = T.statementRows(cmp);
  const last = rows.at(-1);
  assert.equal(last.label, "Balance Tax Payable / (Refund)");
  assert.equal(rows.find((r) => r.label.startsWith("Gross Total Income")).new, 12_00_000);
  const csv = T.toCSV(cmp);
  assert.ok(csv.startsWith("﻿"));
  assert.ok(csv.includes('"A ""B"""'));
  assert.ok(csv.includes('"Total Income (rounded u/s 288A)",1225000,1200000\r\n'));
});

test("Indian number format", () => {
  assert.equal(T.fmt(12_75_000), "12,75,000");
  assert.equal(T.fmt(999), "999");
  assert.equal(T.fmt(-1_23_456), "(1,23,456)");
  assert.equal(T.fmt(1_00_00_000.5), "1,00,00,000.50");
});
