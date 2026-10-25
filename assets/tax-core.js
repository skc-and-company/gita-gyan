/* Income-tax computation for a resident individual — FY 2025-26 (AY 2026-27).
 * Pure functions, no DOM: loaded by tax.html as window.TaxCore and by the
 * node tests through require(). All amounts are whole rupees.
 *
 * Covers: old and new (s.115BAC) regimes, slabs by age, standard deduction,
 * HRA s.10(13A), house property (s.24, set-off limits), capital gains at
 * special rates (s.111A, s.112, s.112A) with the basic-exemption shortfall,
 * common Chapter VI-A deductions, rebate s.87A (with the new-regime marginal
 * relief), surcharge with marginal relief, 4% cess and s.288A/288B rounding.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TaxCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const FY = "2025-26";
  const AY = "2026-27";
  const LAKH = 100000;
  const CRORE = 100 * LAKH;

  const AGE_GROUPS = {
    below60: "Below 60 years",
    "60to79": "Senior citizen (60–79 years)",
    "80plus": "Super senior citizen (80 years and above)",
  };

  // [upper limit of the slab, rate]; the last slab has no limit.
  const SLABS = {
    new: [[4 * LAKH, 0], [8 * LAKH, 0.05], [12 * LAKH, 0.10], [16 * LAKH, 0.15], [20 * LAKH, 0.20], [24 * LAKH, 0.25], [Infinity, 0.30]],
    old: {
      below60: [[2.5 * LAKH, 0], [5 * LAKH, 0.05], [10 * LAKH, 0.20], [Infinity, 0.30]],
      "60to79": [[3 * LAKH, 0], [5 * LAKH, 0.05], [10 * LAKH, 0.20], [Infinity, 0.30]],
      "80plus": [[5 * LAKH, 0], [10 * LAKH, 0.20], [Infinity, 0.30]],
    },
  };

  const RULES = {
    old: { stdDeduction: 50000, familyPensionCap: 15000, rebateLimit: 5 * LAKH, rebateMax: 12500, maxSurcharge: 0.37, employerNpsPct: 0.10 },
    new: { stdDeduction: 75000, familyPensionCap: 25000, rebateLimit: 12 * LAKH, rebateMax: 60000, maxSurcharge: 0.25, employerNpsPct: 0.14 },
  };
  const LTCG_112A_EXEMPT = 125000;
  const RATE_111A = 0.20;
  const RATE_112 = 0.125;
  const RATE_112A = 0.125;
  const SPECIAL_SURCHARGE_CAP = 0.15;
  const CESS = 0.04;
  const SELF_OCCUPIED_INTEREST_CAP = 2 * LAKH;
  const HP_LOSS_SETOFF_CAP = 2 * LAKH;

  // Every input the form knows about, with its default. Keeps saved
  // computations, CSV export and the tests on one definition.
  const FIELDS = {
    assessee: "", pan: "", ageGroup: "below60",
    salaryGross: 0, basicDA: 0, hraReceived: 0, rentPaid: 0, metroCity: false, exemptAllowances: 0, professionalTax: 0,
    hpSelfInterest: 0, hpLetRent: 0, hpLetMunicipalTax: 0, hpLetInterest: 0,
    businessIncome: 0,
    stcg111A: 0, stcgOther: 0, ltcg112A: 0, ltcg112: 0,
    savingsInterest: 0, depositInterest: 0, dividends: 0, familyPension: 0, otherIncome: 0,
    d80C: 0, d80CCD1B: 0, d80CCD2: 0, d80DSelf: 0, d80DParents: 0, parentsSenior: false, d80E: 0, d80G: 0,
    taxesPaid: 0,
  };

  const num = (v) => {
    const n = Math.round(Number(String(v ?? "").replace(/[,\s₹]/g, "")));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  // s.288A / s.288B: nearest multiple of ten, five and above rounds up.
  const round10 = (x) => Math.sign(x) * Math.round(Math.abs(x) / 10) * 10;

  function normalize(raw) {
    const out = {};
    for (const [k, def] of Object.entries(FIELDS)) {
      const v = raw?.[k];
      if (typeof def === "boolean") out[k] = v === true || v === "true" || v === "on" || v === 1 || v === "1";
      else if (typeof def === "string") out[k] = v == null ? def : String(v);
      else out[k] = num(v);
    }
    if (!AGE_GROUPS[out.ageGroup]) out.ageGroup = "below60";
    return out;
  }

  function slabTax(income, slabs) {
    let tax = 0, lower = 0;
    for (const [upper, rate] of slabs) {
      if (income <= lower) break;
      tax += (Math.min(income, upper) - lower) * rate;
      lower = upper;
    }
    return tax;
  }

  const slabsFor = (regime, ageGroup) => (regime === "new" ? SLABS.new : SLABS.old[ageGroup]);
  const basicExemption = (regime, ageGroup) => slabsFor(regime, ageGroup)[0][0];

  function hraExemption(i) {
    if (!i.hraReceived || !i.rentPaid) return 0;
    return Math.round(Math.max(0, Math.min(
      i.hraReceived,
      i.rentPaid - 0.10 * i.basicDA,
      (i.metroCity ? 0.50 : 0.40) * i.basicDA,
    )));
  }

  /* Income-tax before rebate on a split of total income:
   * n = income taxed at slab rates, a = s.111A STCG, b = s.112 LTCG, c = s.112A LTCG (full amount).
   * A resident's unused basic exemption is set against the special-rate gains,
   * highest rate first and s.112A last (it carries its own ₹1.25 lakh exemption). */
  function taxOnParts(n, a, b, c, regime, ageGroup) {
    let shortfall = Math.max(0, basicExemption(regime, ageGroup) - n);
    const take = (amt) => { const used = Math.min(amt, shortfall); shortfall -= used; return used; };
    const adj111A = take(a), adj112 = take(b), adj112A = take(c);
    const normal = slabTax(n, slabsFor(regime, ageGroup));
    const t111A = (a - adj111A) * RATE_111A;
    const t112 = (b - adj112) * RATE_112;
    const t112A = Math.max(0, c - adj112A - LTCG_112A_EXEMPT) * RATE_112A;
    return { normal, t111A, t112, t112A, special: t111A + t112 + t112A, shortfallUsed: adj111A + adj112 + adj112A };
  }

  function rebate87A(ti, t, regime) {
    const r = RULES[regime];
    if (regime === "old") {
      // Not available against tax on s.112A gains (s.112A(6)).
      return ti <= r.rebateLimit ? Math.min(r.rebateMax, t.normal + t.t111A + t.t112) : 0;
    }
    // New regime: only against tax on income other than special-rate income,
    // with marginal relief just above ₹12 lakh.
    if (ti <= r.rebateLimit) return Math.min(r.rebateMax, t.normal);
    return Math.max(0, t.normal - (ti - r.rebateLimit));
  }

  function surchargeRate(ti, regime) {
    const rate = ti > 5 * CRORE ? 0.37 : ti > 2 * CRORE ? 0.25 : ti > CRORE ? 0.15 : ti > 50 * LAKH ? 0.10 : 0;
    return Math.min(rate, RULES[regime].maxSurcharge);
  }

  function grossSurcharge(ti, t, regime) {
    const rate = surchargeRate(ti, regime);
    return { rate, amount: t.normal * rate + t.special * Math.min(rate, SPECIAL_SURCHARGE_CAP) };
  }

  /* Tax (after rebate) + surcharge for a split, before cess. Used for the
   * marginal-relief comparison at each surcharge threshold. */
  function taxAndSurcharge(n, a, b, c, regime, ageGroup) {
    const ti = n + a + b + c;
    const t = taxOnParts(n, a, b, c, regime, ageGroup);
    const rebate = rebate87A(ti, t, regime);
    const sur = grossSurcharge(ti, t, regime);
    return { t, rebate, tax: t.normal + t.special - rebate, sur };
  }

  function compute(raw, regime) {
    if (regime !== "old" && regime !== "new") throw new Error(`Unknown regime: ${regime}`);
    const i = normalize(raw);
    const r = RULES[regime];
    const isOld = regime === "old";
    const senior = i.ageGroup !== "below60";
    const notes = [];

    // Salaries
    const hra = isOld ? hraExemption(i) : 0;
    const otherExempt = isOld ? i.exemptAllowances : 0;
    const exempt10 = Math.min(i.salaryGross, hra + otherExempt);
    const netSalary = i.salaryGross - exempt10;
    const stdDeduction = Math.min(r.stdDeduction, netSalary);
    const profTax = isOld ? Math.min(i.professionalTax, 2500, netSalary - stdDeduction) : 0;
    const salary = netSalary - stdDeduction - profTax;

    // House property
    const letNav = Math.max(0, i.hpLetRent - (i.hpLetRent ? i.hpLetMunicipalTax : 0));
    const let30 = Math.round(letNav * 0.30);
    const selfInterest = isOld ? Math.min(i.hpSelfInterest, SELF_OCCUPIED_INTEREST_CAP) : 0;
    const hpComputed = letNav - let30 - i.hpLetInterest - selfInterest;
    let hp = hpComputed;
    if (hpComputed < 0) {
      hp = isOld ? Math.max(hpComputed, -HP_LOSS_SETOFF_CAP) : 0;
      if (hp !== hpComputed) {
        notes.push(`House property loss of ₹${fmt(-(hpComputed - hp))} cannot be set off this year (${isOld ? "limit ₹2,00,000" : "no inter-head set-off in the new regime"}); it can be carried forward.`);
      }
    }
    if (!isOld && i.hpSelfInterest) notes.push("Interest on a self-occupied house is not deductible in the new regime.");

    // Business / profession
    const business = i.businessIncome;

    // Capital gains
    const cgNormal = i.stcgOther;
    const cgSpecial = i.stcg111A + i.ltcg112 + i.ltcg112A;

    // Other sources
    const fpDeduction = Math.min(Math.round(i.familyPension / 3), r.familyPensionCap);
    const other = i.savingsInterest + i.depositInterest + i.dividends + (i.familyPension - fpDeduction) + i.otherIncome;

    // Gross total income; a house property loss is absorbed by slab-rate income only.
    const normalHeads = salary + hp + business + cgNormal + other;
    if (normalHeads < 0) notes.push("The house property loss exceeds other slab-rate income; the excess is ignored here.");
    const gtiNormal = Math.max(0, normalHeads);
    const gti = gtiNormal + cgSpecial;

    // Chapter VI-A — not allowed against s.111A / s.112 / s.112A gains.
    const nps2Cap = Math.round(r.employerNpsPct * i.basicDA);
    if (i.d80CCD2 && !i.basicDA) notes.push("Enter Basic + DA to apply the s.80CCD(2) limit; the amount is taken as entered.");
    const ded = {
      d80C: isOld ? Math.min(i.d80C, 150000) : 0,
      d80CCD1B: isOld ? Math.min(i.d80CCD1B, 50000) : 0,
      d80CCD2: i.basicDA ? Math.min(i.d80CCD2, nps2Cap) : i.d80CCD2,
      d80D: isOld ? Math.min(i.d80DSelf, senior ? 50000 : 25000) + Math.min(i.d80DParents, i.parentsSenior ? 50000 : 25000) : 0,
      d80E: isOld ? i.d80E : 0,
      d80G: isOld ? i.d80G : 0,
      d80TTA: isOld && !senior ? Math.min(i.savingsInterest, 10000) : 0,
      d80TTB: isOld && senior ? Math.min(i.savingsInterest + i.depositInterest, 50000) : 0,
    };
    const dedClaimed = Object.values(ded).reduce((s, v) => s + v, 0);
    const dedTotal = Math.min(dedClaimed, gtiNormal);

    // Total income, rounded under s.288A
    const tiExact = gti - dedTotal;
    const ti = Math.max(0, round10(tiExact));
    const n = Math.max(0, ti - cgSpecial);

    // Tax
    const parts = [n, i.stcg111A, i.ltcg112, i.ltcg112A];
    const base = taxAndSurcharge(...parts, regime, i.ageGroup);
    const t = base.t;
    let surcharge = base.sur.amount;
    let surchargeRelief = 0;
    const threshold = [5 * CRORE, 2 * CRORE, CRORE, 50 * LAKH].find((x) => ti > x);
    if (threshold && surcharge > 0) {
      // Marginal relief: tax + surcharge may not exceed tax + surcharge at the
      // threshold by more than the income above it. The excess over the
      // threshold is taken off slab-rate income first, then the special gains.
      let cut = ti - threshold;
      const at = parts.slice();
      for (const k of [0, 3, 2, 1]) { const d = Math.min(at[k], cut); at[k] -= d; cut -= d; }
      const atT = taxAndSurcharge(...at, regime, i.ageGroup);
      const cap = atT.tax + atT.sur.amount + (ti - threshold);
      surchargeRelief = Math.max(0, Math.min(surcharge, base.tax + surcharge - cap));
      surcharge -= surchargeRelief;
    }
    const taxBeforeRebate = t.normal + t.special;
    const rebate = base.rebate;
    const taxAfterRebate = taxBeforeRebate - rebate;
    const cess = (taxAfterRebate + surcharge) * CESS;
    const totalTax = round10(taxAfterRebate + surcharge + cess);
    const balance = round10(totalTax - i.taxesPaid);

    return {
      regime, inputs: i, notes,
      salary: { gross: i.salaryGross, hra, otherExempt, exempt10, net: netSalary, stdDeduction, profTax, income: salary },
      houseProperty: { letRent: i.hpLetRent, municipalTax: i.hpLetRent ? i.hpLetMunicipalTax : 0, nav: letNav, std30: let30, letInterest: i.hpLetInterest, selfInterest, computed: hpComputed, income: hp },
      business,
      capitalGains: { stcg111A: i.stcg111A, stcgOther: i.stcgOther, ltcg112A: i.ltcg112A, ltcg112: i.ltcg112, total: cgNormal + cgSpecial },
      otherSources: { savingsInterest: i.savingsInterest, depositInterest: i.depositInterest, dividends: i.dividends, familyPension: i.familyPension, fpDeduction, otherIncome: i.otherIncome, income: other },
      gti, gtiNormal,
      deductions: { ...ded, claimed: dedClaimed, total: dedTotal },
      totalIncomeExact: tiExact, totalIncome: ti, normalIncome: n,
      tax: {
        normal: round2(t.normal), t111A: round2(t.t111A), t112: round2(t.t112), t112A: round2(t.t112A),
        shortfallUsed: t.shortfallUsed,
        beforeRebate: round2(taxBeforeRebate), rebate: round2(rebate), afterRebate: round2(taxAfterRebate),
        surchargeRate: base.sur.rate, surchargeGross: round2(base.sur.amount), surchargeRelief: round2(surchargeRelief), surcharge: round2(surcharge),
        cess: round2(cess), total: totalTax, taxesPaid: i.taxesPaid, balance,
      },
    };
  }

  const round2 = (x) => Math.round(x * 100) / 100;

  function compare(raw) {
    const oldR = compute(raw, "old");
    const newR = compute(raw, "new");
    const better = oldR.tax.total < newR.tax.total ? "old" : "new";
    return { old: oldR, new: newR, better, saving: Math.abs(oldR.tax.total - newR.tax.total) };
  }

  /* Rows of the "Computation of Income" statement, shared by the page, the
   * PDF and the CSV. kind: section | item | sub | total | grand */
  function statementRows(cmp) {
    const o = cmp.old, w = cmp.new;
    const rows = [];
    const row = (kind, label, f, opts = {}) => {
      const ov = f(o), nv = f(w);
      if (opts.skipZero && !ov && !nv) return;
      rows.push({ kind, label, old: ov, new: nv, ...opts.extra });
    };
    const section = (label) => rows.push({ kind: "section", label, old: null, new: null });

    section("1. Income from Salaries");
    row("item", "Gross salary", (r) => r.salary.gross);
    row("sub", "Less: HRA exempt u/s 10(13A)", (r) => -r.salary.hra, { skipZero: true });
    row("sub", "Less: Other exempt allowances u/s 10", (r) => -r.salary.otherExempt, { skipZero: true });
    row("sub", "Less: Standard deduction u/s 16(ia)", (r) => -r.salary.stdDeduction);
    row("sub", "Less: Professional tax u/s 16(iii)", (r) => -r.salary.profTax, { skipZero: true });
    row("total", "Income from salaries", (r) => r.salary.income);

    section("2. Income from House Property");
    row("item", "Let-out: rent received", (r) => r.houseProperty.letRent, { skipZero: true });
    row("sub", "Less: Municipal taxes paid", (r) => -r.houseProperty.municipalTax, { skipZero: true });
    row("sub", "Less: Standard deduction @30% u/s 24(a)", (r) => -r.houseProperty.std30, { skipZero: true });
    row("sub", "Less: Interest on loan, let-out u/s 24(b)", (r) => -r.houseProperty.letInterest, { skipZero: true });
    row("sub", "Less: Interest on loan, self-occupied u/s 24(b)", (r) => -r.houseProperty.selfInterest, { skipZero: true });
    row("total", "Income from house property (after set-off limits)", (r) => r.houseProperty.income);

    section("3. Profits and Gains of Business or Profession");
    row("total", "Income from business / profession", (r) => r.business);

    section("4. Capital Gains");
    row("item", "Short-term u/s 111A (taxed @20%)", (r) => r.capitalGains.stcg111A, { skipZero: true });
    row("item", "Short-term, other (slab rates)", (r) => r.capitalGains.stcgOther, { skipZero: true });
    row("item", "Long-term u/s 112A (taxed @12.5% above ₹1,25,000)", (r) => r.capitalGains.ltcg112A, { skipZero: true });
    row("item", "Long-term u/s 112 (taxed @12.5%)", (r) => r.capitalGains.ltcg112, { skipZero: true });
    row("total", "Income from capital gains", (r) => r.capitalGains.total);

    section("5. Income from Other Sources");
    row("item", "Interest on savings account", (r) => r.otherSources.savingsInterest, { skipZero: true });
    row("item", "Interest on deposits / others", (r) => r.otherSources.depositInterest, { skipZero: true });
    row("item", "Dividends", (r) => r.otherSources.dividends, { skipZero: true });
    row("item", "Family pension", (r) => r.otherSources.familyPension, { skipZero: true });
    row("sub", "Less: Deduction u/s 57(iia)", (r) => -r.otherSources.fpDeduction, { skipZero: true });
    row("item", "Any other income", (r) => r.otherSources.otherIncome, { skipZero: true });
    row("total", "Income from other sources", (r) => r.otherSources.income);

    row("grand", "Gross Total Income", (r) => r.gti);

    section("Less: Deductions under Chapter VI-A");
    row("sub", "80C / 80CCC / 80CCD(1)", (r) => r.deductions.d80C, { skipZero: true });
    row("sub", "80CCD(1B) — NPS (own)", (r) => r.deductions.d80CCD1B, { skipZero: true });
    row("sub", "80CCD(2) — NPS (employer)", (r) => r.deductions.d80CCD2, { skipZero: true });
    row("sub", "80D — Health insurance", (r) => r.deductions.d80D, { skipZero: true });
    row("sub", "80E — Education loan interest", (r) => r.deductions.d80E, { skipZero: true });
    row("sub", "80G — Donations", (r) => r.deductions.d80G, { skipZero: true });
    row("sub", "80TTA — Savings interest", (r) => r.deductions.d80TTA, { skipZero: true });
    row("sub", "80TTB — Interest (senior citizen)", (r) => r.deductions.d80TTB, { skipZero: true });
    row("total", "Total deductions", (r) => r.deductions.total);

    row("grand", "Total Income (rounded u/s 288A)", (r) => r.totalIncome);

    section("Computation of Tax");
    row("item", "Tax on income at slab rates", (r) => r.tax.normal);
    row("item", "Tax on STCG u/s 111A @20%", (r) => r.tax.t111A, { skipZero: true });
    row("item", "Tax on LTCG u/s 112 @12.5%", (r) => r.tax.t112, { skipZero: true });
    row("item", "Tax on LTCG u/s 112A @12.5%", (r) => r.tax.t112A, { skipZero: true });
    row("total", "Tax before rebate", (r) => r.tax.beforeRebate);
    row("sub", "Less: Rebate u/s 87A", (r) => -r.tax.rebate);
    row("total", "Tax after rebate", (r) => r.tax.afterRebate);
    row("item", "Add: Surcharge", (r) => r.tax.surchargeGross, { skipZero: true });
    row("sub", "Less: Marginal relief on surcharge", (r) => -r.tax.surchargeRelief, { skipZero: true });
    row("item", "Add: Health & Education Cess @4%", (r) => r.tax.cess);
    row("grand", "Total Tax Liability (rounded u/s 288B)", (r) => r.tax.total);
    row("sub", "Less: TDS / TCS / Advance tax paid", (r) => -r.tax.taxesPaid, { skipZero: true });
    row("grand", "Balance Tax Payable / (Refund)", (r) => r.tax.balance);
    return rows;
  }

  function fmt(n) {
    const neg = n < 0;
    const [int, dec] = Math.abs(n).toFixed(Number.isInteger(n) ? 0 : 2).split(".");
    const last3 = int.slice(-3);
    const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    const s = (rest ? rest + "," : "") + last3 + (dec && dec !== "00" ? "." + dec : "");
    return neg ? `(${s})` : s;
  }

  function toCSV(cmp) {
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const i = cmp.old.inputs;
    const lines = [
      [q("Computation of Income"), q(`FY ${FY} / AY ${AY}`), ""],
      [q("Assessee"), q(i.assessee), ""],
      [q("PAN"), q(i.pan), ""],
      [q("Age group"), q(AGE_GROUPS[i.ageGroup]), ""],
      ["", "", ""],
      [q("Particulars"), q("Old regime (₹)"), q("New regime (₹)")],
      ...statementRows(cmp).map((r) => [q(r.label), r.old == null ? "" : round2(r.old), r.new == null ? "" : round2(r.new)]),
      ["", "", ""],
      [q("Lower tax under"), q(cmp.better === "old" ? "Old regime" : "New regime"), q(`Saving ₹${fmt(cmp.saving)}`)],
    ];
    return "﻿" + lines.map((l) => l.join(",")).join("\r\n") + "\r\n";
  }

  return {
    FY, AY, AGE_GROUPS, FIELDS, SLABS, RULES,
    normalize, slabTax, hraExemption, compute, compare, statementRows, toCSV, fmt, round10,
  };
});
