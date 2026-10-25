/* SKC Income Tax Calculator — Tax Year 2026-27, inside Gita Gyan (route #/tax).
 * The engine is the SKC calculator's, with four fixes:
 *  1. new-regime 87A rebate is only set against tax at slab rates (not 111A / 112 / 112A tax), as from AY 2026-27;
 *  2. the higher senior / super-senior exemptions (and senior 80D / 80TTB) apply to residents only;
 *  3. a current-year business loss no longer wipes out the house-property loss set-off against salary;
 *  4. business loss now also sets off against capital gains (after other income), the rest is carried forward.
 * Since v6 it also covers HUFs, partnership firms / LLPs (section 40(b) limits, AMT) and domestic companies
 * (normal rates with MAT vs 115BAA / 115BAB); since v8, taxes paid, the advance tax schedule, interest u/s 423-425
 * (old 234A/B/C), the fee u/s 428 (old 234F), ITR-U additional tax, winnings / VDA at 30 %, agricultural income,
 * 44AE, the indexation choice for old property, more deductions, and MAT at 14 % as a final tax (Finance Act 2026).
 * PDF export loads jsPDF from vendor/ only when asked for.
 */
(() => {
  "use strict";

  const TAX = (() => {
    const NEW = [[400000, 0], [800000, 0.05], [1200000, 0.10], [1600000, 0.15], [2000000, 0.20], [2400000, 0.25], [Infinity, 0.30]];
    const oldSl = (age) => {
      const b = [250000, 300000, 500000][age];
      const s = [[b, 0]];
      if (b < 500000) s.push([500000, 0.05]);
      s.push([1000000, 0.20], [Infinity, 0.30]);
      return s;
    };
    const slab = (inc, s) => { let t = 0, p = 0; for (const [upto, rate] of s) { if (inc > p) t += (Math.min(inc, upto) - p) * rate; p = upto; } return t; };
    const n = (v) => { v = +v; return isFinite(v) && v > 0 ? v : 0; };
    const has = (v) => v != null && String(v).trim() !== "";
    const r10 = (x) => Math.round(x / 10) * 10;
    const entOf = (d) => ({ huf: "huf", firm: "firm", co: "co" }[d.ent] || "ind");
    const slabbed = (e) => e === "ind" || e === "huf";   // taxed at slab rates, with the 15 % surcharge cap on gains
    // Senior and super-senior benefits are for resident individuals only.
    const ageOf = (d) => (entOf(d) !== "ind" || d.res === "0" ? 0 : +d.age || 0);
    const slabsOf = (d, mode) => (mode === "new" ? NEW : oldSl(ageOf(d)));

    function heads(d, mode) {
      const e = entOf(d), nw = mode === "new", age = ageOf(d), o = { ent: e, mode };
      const sal = e === "ind" ? n(d.sal) : 0;   // only an individual can have salary
      o.salGross = sal;
      o.salEx = nw ? 0 : Math.min(n(d.salex), sal);
      o.sd = sal > 0 ? Math.min(nw ? 75000 : 50000, sal - o.salEx) : 0;
      o.pt = nw || !sal ? 0 : Math.min(n(d.pt), 2500);
      o.salary = Math.max(0, sal - o.salEx - o.sd - o.pt);

      let hp = 0;
      o.hpt = d.hpt || "none";
      if (o.hpt === "so" && !slabbed(e)) o.hpt = "none";   // self-occupied relief is for individuals and HUFs
      o.nav = 0; o.sd30 = 0; o.int = 0;
      if (o.hpt === "lo") { o.nav = Math.max(0, n(d.rent) - n(d.mun)); o.sd30 = Math.round(o.nav * 0.3); o.int = n(d.hli); hp = o.nav - o.sd30 - o.int; }
      else if (o.hpt === "so") { o.int = nw ? 0 : Math.min(n(d.hli), 200000); hp = -o.int; }
      o.hpRaw = hp;
      if (hp < 0) hp = nw ? 0 : Math.max(hp, -200000);
      o.hp = hp;

      // Business: companies and LLPs can't use 44AD / 44ADA. A firm deducts interest and remuneration to
      // partners only within the section 40(b) limits. Goods carriages (44AE) are added on top.
      o.bt = d.bt || "np";
      if (e === "co" || (e === "firm" && d.ftype === "llp")) o.bt = "np";
      o.firm = null;
      if (o.bt === "ad") o.bus = Math.round(n(d.tod) * 0.06 + n(d.toc) * 0.08);
      else if (o.bt === "ada") o.bus = Math.round(n(d.gr) * 0.5);
      else if (e === "firm") {
        const np = +d.np || 0, intPaid = n(d.pint), cap = n(d.pcap), remPaid = n(d.prem);
        const intA = cap ? Math.min(intPaid, Math.round(cap * 0.12)) : intPaid;
        const bp = np - intA;   // book profit for the remuneration limit
        const lim = bp <= 0 ? 300000 : Math.round(Math.max(300000, 0.9 * Math.min(bp, 600000)) + 0.6 * Math.max(0, bp - 600000));
        const remA = Math.min(remPaid, lim);
        o.firm = { np, intPaid, intA, bp, lim, remPaid, remA };
        o.bus = np - intA - remA;
      } else o.bus = +d.np || 0;
      o.ae = Math.round(n(d.ae1) * 1000 + n(d.ae2) * 7500);   // 44AE: ₹1,000 per ton-month (heavy), ₹7,500 per vehicle-month
      o.bus += o.ae;
      o.busCY = o.bus;
      o.bflUsed = o.bus > 0 ? Math.min(n(d.bfl), o.bus) : 0;   // brought-forward loss only against business income
      o.bus -= o.bflUsed;
      o.bflLeft = n(d.bfl) - o.bflUsed;
      o.hasBusiness = !!(o.busCY || has(d.np) || o.bt !== "np" || o.ae);

      o.stcgA = n(d.stcg111a); o.stcgO = n(d.stcgo); o.ltA = n(d.ltcg112a);
      // Land / building bought before 23 Jul 2024: a resident individual or HUF may pay 20 % with indexation
      // instead of 12.5 % without; options() works out both and keeps the cheaper.
      o.ltProp = n(d.ltprop); o.idxUsed = d._idx === true;
      o.lt112 = n(d.ltcg112);
      o.lt = o.lt112 + (o.idxUsed ? 0 : o.ltProp);
      o.lt20 = o.idxUsed ? n(d.ltpropidx) : 0;
      o.cg = o.stcgA + o.stcgO + o.ltA + o.lt + o.lt20;
      o.sb = n(d.sbint); o.fd = n(d.fdint); o.div = n(d.div); o.oth = n(d.oth);
      o.fp = e === "ind" ? n(d.fampen) : 0;
      o.fpDed = Math.round(Math.min(o.fp / 3, nw ? 25000 : 15000));   // standard deduction on family pension
      o.os = o.sb + o.fd + o.div + o.oth + o.fp - o.fpDed;
      // Winnings (lottery, crossword, betting, online games) and crypto / VDA gains: flat 30 %, no exemption limit,
      // no deductions, no loss set-off against them.
      o.win = n(d.win); o.vda = n(d.vda);
      o.agri = slabbed(e) ? n(d.agri) : 0;   // exempt, but counted for the rate (partial integration)

      // Inter-head set-off of this year's losses (simplified):
      //  • business loss — against any head except salary: other normal income first, then capital gains
      //    (20 % gains before 12.5 % ones); whatever is left is carried forward;
      //  • house-property loss (already capped above) — against salary first, then other heads.
      let salary = o.salary, nonSal = Math.max(0, o.hp) + Math.max(0, o.bus) + o.stcgO + o.os;
      let sA = o.stcgA, sL20 = o.lt20, sL = o.lt, sLA = o.ltA;
      const absorb = (loss, amt) => { const used = Math.min(loss.left, amt); loss.left -= used; return amt - used; };
      const bl = { left: Math.max(0, -o.bus) };
      nonSal = absorb(bl, nonSal); sA = absorb(bl, sA); sL20 = absorb(bl, sL20); sL = absorb(bl, sL); sLA = absorb(bl, sLA);
      const hl = { left: Math.max(0, -o.hp) };
      salary = absorb(hl, salary); nonSal = absorb(hl, nonSal); sA = absorb(hl, sA); sL20 = absorb(hl, sL20); sL = absorb(hl, sL); sLA = absorb(hl, sLA);
      o.busCF = bl.left; o.hpCF = hl.left + (o.hp - o.hpRaw);   // loss not set off this year
      o.sA = sA; o.sL20 = sL20; o.sL = sL; o.sLA = sLA;         // capital gains left after set-off
      o.gti = salary + nonSal + sA + sL20 + sL + sLA + o.win + o.vda;
      o.special = sA + sL20 + sL + sLA + o.win + o.vda;
      o.normalGTI = o.gti - o.special;

      // Chapter VI-A deductions (never against special-rate income).
      const D = [], add = (k, lbl, v) => { if (v > 0) D.push([k, lbl, Math.round(v)]); };
      const disab = (v) => ({ 1: 75000, 2: 125000 }[v] || 0);
      if (e === "ind") {
        const basic = n(d.basic) || sal;
        add("80CCD(2)", "Employer NPS", Math.min(n(d.d80ccd2), Math.round(basic * (nw ? 0.14 : 0.10))));
        add("80CCH", "Agniveer Corpus Fund", n(d.d80cch));
        if (!nw) {
          add("80C", "80C/80CCC/80CCD(1)", Math.min(n(d.d80c), 150000));
          add("80CCD(1B)", "NPS (own)", Math.min(n(d.d80ccd1b), 50000));
          const dS = Math.min(n(d.d80ds), age > 0 ? 50000 : 25000), dP = Math.min(n(d.d80dp), +d.parsen ? 50000 : 25000);
          add("80D", "Health insurance", dS + dP);
          add("80DD", "Disabled dependant", disab(d.d80dd));
          add("80DDB", "Treatment of specified diseases", Math.min(n(d.d80ddb), d.ddbsen === "1" ? 100000 : 40000));
          add("80E", "Education loan interest", n(d.d80e));
          add("80EEB", "Electric-vehicle loan interest", Math.min(n(d.d80eeb), 150000));
          add("80G", "Donations", n(d.d80g));
          add("80GGC", "Political party / electoral trust", n(d.d80ggc));
          if (d.ttauto !== "0") {
            if (age > 0) add("80TTB", "Deposit interest (senior)", Math.min(o.sb + o.fd, 50000));
            else add("80TTA", "Savings interest", Math.min(o.sb, 10000));
          }
          add("80U", "Own disability", disab(d.d80u));
          add("Others", "Other Chapter VI-A", n(d.dother));
          // 80GG (rent, no HRA): least of ₹5,000 a month, 25 % of adjusted total income, rent − 10 % of it.
          if (n(d.d80gg)) {
            const ati = Math.max(0, o.normalGTI - D.reduce((a, x) => a + x[2], 0));
            add("80GG", "Rent paid (no HRA)", Math.max(0, Math.min(60000, ati * 0.25, n(d.d80gg) - ati * 0.10)));
          }
        }
      } else if (e === "huf") {
        if (!nw) {
          add("80C", "80C (for members)", Math.min(n(d.d80c), 150000));
          add("80D", "Health insurance of members", Math.min(n(d.d80ds), d.hsen === "1" ? 50000 : 25000));
          add("80DD", "Disabled member", disab(d.d80dd));
          add("80DDB", "Treatment of specified diseases", Math.min(n(d.d80ddb), d.ddbsen === "1" ? 100000 : 40000));
          add("80G", "Donations", n(d.d80g));
          add("80GGC", "Political party / electoral trust", n(d.d80ggc));
          if (d.ttauto !== "0") add("80TTA", "Savings interest", Math.min(o.sb, 10000));
          add("Others", "Other Chapter VI-A", n(d.dother));
        }
      } else {
        // Firms and companies: no personal deductions. Under 115BAA / 115BAB the Part C deductions go,
        // except 80JJAA and 80M.
        add("80G", "Donations", n(d.d80g));
        add(e === "co" ? "80GGB" : "80GGC", "Political party / electoral trust", n(d.d80ggc));
        add("80JJAA", "Additional employee cost", n(d.d80jjaa));
        if (e === "co") add("80M", "Inter-corporate dividends distributed", Math.min(n(d.d80m), o.div));
        if (mode !== "115BAA" && mode !== "115BAB") add("Part C", "80-IA / 80-IAC / 80-IBA and similar", n(d.dother));
      }
      o.dedList = D;
      o.ded = Math.min(D.reduce((a, x) => a + x[2], 0), o.normalGTI);
      o.partC = Math.min(D.find((x) => x[0] === "Part C")?.[2] || 0, o.ded);
      o.ti = r10(o.gti - o.ded);
      o.normal = Math.max(0, o.ti - o.special);
      o.busInNormal = Math.min(o.normal, Math.max(0, o.bus));   // for the 115BAB 15 % rate
      return o;
    }

    function rateTax(normal, o, d, mode) {
      if (slabbed(o.ent)) {
        const s = slabsOf(d, mode), be = s[0][0];
        // Partial integration: agricultural income above ₹5,000 raises the rate on the rest of the income.
        if (o.agri > 5000 && normal > be) return slab(normal + o.agri, s) - slab(be + o.agri, s);
        return slab(normal, s);
      }
      if (o.ent === "firm") return normal * 0.30;
      if (mode === "115BAA") return normal * 0.22;
      if (mode === "115BAB") { const b = Math.min(normal, o.busInNormal); return b * 0.15 + (normal - b) * 0.22; }
      return normal * (d.cturn === "0" ? 0.30 : 0.25);
    }
    function taxOn(normal, stA, ltA, lt, lt20, winV, o, d, mode) {
      const tn = rateTax(normal, o, d, mode);
      // resident individuals and HUFs may use unused basic exemption against special-rate capital gains
      // (never against winnings or VDA gains)
      const be = slabbed(o.ent) ? slabsOf(d, mode)[0][0] : 0;
      let unused = slabbed(o.ent) && d.res !== "0" ? Math.max(0, be - normal) : 0;
      const use = (x) => { const u = Math.min(unused, x); unused -= u; return x - u; };
      const a = use(stA), l20 = use(lt20), l = use(lt), l2 = use(Math.max(0, ltA - 125000));
      const sp = a * 0.20 + l20 * 0.20 + l * 0.125 + l2 * 0.125;
      return { normal: tn, stA: a * 0.20, lt20: l20 * 0.20, lt: l * 0.125, ltA: l2 * 0.125, sp, spW: winV * 0.30 };
    }

    // Surcharge rate and the thresholds where marginal relief applies.
    function surRate(ti, e, mode) {
      if (slabbed(e)) return ti > 50000000 ? (mode === "new" ? 0.25 : 0.37) : ti > 20000000 ? 0.25 : ti > 10000000 ? 0.15 : ti > 5000000 ? 0.10 : 0;
      if (e === "firm") return ti > 10000000 ? 0.12 : 0;
      if (mode === "115BAA" || mode === "115BAB") return 0.10;
      return ti > 100000000 ? 0.12 : ti > 10000000 ? 0.07 : 0;
    }
    const thresholds = (e, mode) => slabbed(e) ? [50000000, 20000000, 10000000, 5000000]
      : e === "firm" ? [10000000] : mode === "115BAA" || mode === "115BAB" ? [] : [100000000, 10000000];

    // Flat-rate tax (MAT / AMT) with surcharge, marginal relief and cess.
    function flatTax(base, rate, surOf, ths) {
      const tax = base * rate, r = surOf(base);
      let sur = tax * r;
      const th = ths.find((t) => base > t);
      if (r && th) { const cap = th * rate * (1 + surOf(th)) + (base - th); if (tax + sur > cap) sur = Math.max(0, cap - tax); }
      return { base, rate, tax, sur, cess: (tax + sur) * 0.04, total: r10(Math.round((tax + sur) * 1.04)) };
    }

    function compute(d, mode) {
      const o = heads(d, mode), e = o.ent, nw = mode === "new", res = d.res !== "0";
      o.regime = mode;
      const winV = o.win + o.vda;
      const t = taxOn(o.normal, o.sA, o.sLA, o.sL, o.sL20, winV, o, d, mode);
      o.tNormal = t.normal; o.tStA = t.stA; o.tLt = t.lt; o.tLtA = t.ltA; o.tLt20 = t.lt20; o.tWin = t.spW;
      o.tSpecial = t.sp + t.spW; o.tax = t.normal + t.sp + t.spW;

      // 87A — resident individuals only. New regime: only against tax at slab rates (special-rate tax excluded
      // from AY 2026-27), up to ₹60,000 for income up to ₹12 lakh, with marginal relief just above. Old regime:
      // ₹12,500 up to ₹5 lakh (not against 112A, winnings or VDA tax).
      o.rebate = 0;
      if (res && e === "ind") {
        if (nw) {
          if (o.ti <= 1200000) o.rebate = Math.min(t.normal, 60000);
          else if (o.tax - (o.ti - 1200000) > 0) o.rebate = Math.min(t.normal, o.tax - (o.ti - 1200000));
        } else if (o.ti <= 500000) o.rebate = Math.min(t.normal + t.stA + t.lt + t.lt20, 12500);
      }
      o.afterReb = o.tax - o.rebate;

      // Surcharge (individuals / HUFs: 15 % cap on capital gains and dividends) with marginal relief.
      const r = surRate(o.ti, e, mode), rc = slabbed(e) ? Math.min(r, 0.15) : r;
      const divShare = slabbed(e) ? Math.min(1, o.normal > 0 ? o.div / o.normal : 0) : 0;
      const tN = Math.max(0, o.afterReb - t.sp - t.spW);
      const sc = (rr, rcc, tn, tsp, tw) => tn * (1 - divShare) * rr + (tn * divShare + tsp) * rcc + tw * rr;
      o.surRate = r; o.sur = r ? sc(r, rc, tN, t.sp, t.spW) : 0; o.mr = 0;
      const th = thresholds(e, mode).find((x) => o.ti > x);
      if (r && th) {
        const ex = o.ti - th;
        const nN = Math.max(0, o.normal - ex);
        let rem = ex - (o.normal - nN);
        const cut = (x) => { const c = Math.min(x, rem); rem -= c; return x - c; };
        const lA = cut(o.sLA), l = cut(o.sL), l20 = cut(o.sL20), sA = cut(o.sA), w = cut(winV);
        const t2 = taxOn(nN, sA, lA, l, l20, w, o, d, mode);
        const r2 = surRate(th, e, mode), rc2 = slabbed(e) ? Math.min(r2, 0.15) : r2;
        const at = t2.normal + t2.sp + t2.spW + (r2 ? sc(r2, rc2, t2.normal, t2.sp, t2.spW) : 0);
        const capAmt = at + ex;
        if (o.afterReb + o.sur > capAmt) { o.mr = o.afterReb + o.sur - capAmt; o.sur -= o.mr; }
      }
      o.cess = (o.afterReb + o.sur) * 0.04;
      o.total = r10(Math.round(o.afterReb + o.sur + o.cess));   // 288B
      o.normalTotal = o.total; o.basis = "";

      // MAT (s.206, old 115JB): 14 % of book profit from tax year 2026-27, and a final tax — no new MAT credit.
      if (e === "co" && mode === "normal" && n(d.bookp) > 0) {
        o.mat = flatTax(n(d.bookp), 0.14, (b) => (b > 100000000 ? 0.12 : b > 10000000 ? 0.07 : 0), [100000000, 10000000]);
        if (o.mat.total > o.total) { o.total = o.mat.total; o.basis = "MAT"; }
      }
      // MAT credit built up to 31 Mar 2026 can now be used only by a company in a concessional regime,
      // up to 25 % of its tax for the year.
      if (e === "co" && (mode === "115BAA" || mode === "115BAB") && n(d.matcr) > 0) {
        o.matCrUsed = Math.min(n(d.matcr), Math.floor(o.total * 0.25));
        o.matCrLeft = n(d.matcr) - o.matCrUsed;
        o.total = r10(o.total - o.matCrUsed);
      }
      // AMT (s.206, old 115JC) for firms claiming Part C deductions: 18.5 %; the excess is still carried as credit.
      if (e === "firm" && o.partC > 0) {
        o.amt = flatTax(o.ti + o.partC, 0.185, (b) => (b > 10000000 ? 0.12 : 0), [10000000]);
        if (o.amt.total > o.total) { o.amtCredit = o.amt.total - o.total; o.total = o.amt.total; o.basis = "AMT"; }
      }
      if (!d._noPay) o.pay = payments(o, d, mode);
      return o;
    }

    /* ---------- taxes paid, advance tax, interest u/s 423-425 (old 234A/B/C) and fee u/s 428 (old 234F) ----------
     * Tax year 2026-27 (1 Apr 2026 – 31 Mar 2027). Interest is simple, 1 % a month, a part of a month counts as a
     * full month, and it is worked out on the amount rounded down to a multiple of ₹100. */
    const UTC = (y, m, day) => Date.UTC(y, m - 1, day);
    const DUE = { jul: UTC(2027, 7, 31), aug: UTC(2027, 8, 31), oct: UTC(2027, 10, 31), nov: UTC(2027, 11, 30) };
    const APR1 = UTC(2027, 4, 1), BELATED_END = UTC(2027, 12, 31);
    const INST = [["15 Jun 2026", 0.15, 3, 0.12], ["15 Sep 2026", 0.45, 3, 0.36], ["15 Dec 2026", 0.75, 3, null], ["15 Mar 2027", 1, 1, null]];
    function parseDate(v) {
      const t = String(v || "").trim();
      let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (m) return UTC(+m[1], +m[2], +m[3]);
      m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
      return m ? UTC(+m[3], +m[2], +m[1]) : null;
    }
    // months (or part of a month) from `start` up to and including `end`
    function monthsFrom(start, end) {
      if (end == null || end < start) return 0;
      const s = new Date(start);
      let k = 0;
      while (Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + k, s.getUTCDate()) <= end) k++;
      return k;
    }
    const floor100 = (x) => Math.max(0, Math.floor(x / 100) * 100);
    function dueDateFor(d, o) {
      if (DUE[d.duecat]) return { key: d.duecat, ms: DUE[d.duecat] };
      const key = o.ent === "co" ? "oct" : o.hasBusiness || o.ent === "firm" ? "aug" : "jul";
      return { key, ms: DUE[key] };
    }
    const PAY_KEYS = ["tds", "tcs", "relief89", "at1", "at2", "at3", "at4", "at5", "sat", "satdate", "filedate"];

    function payments(o, d, mode) {
      const P = { active: PAY_KEYS.some((k) => has(d[k])) };
      P.relief = Math.min(n(d.relief89), o.total);
      P.T = o.total - P.relief;
      P.tds = n(d.tds); P.tcs = n(d.tcs);
      P.due = Math.max(0, P.T - P.tds - P.tcs);              // assessed tax / tax due on returned income
      P.paid = [n(d.at1), n(d.at2), n(d.at3), n(d.at4), n(d.at5)];
      P.cum = P.paid.reduce((a, x) => (a.push((a.at(-1) || 0) + x), a), []);
      P.adv = P.cum[4];
      P.sat = n(d.sat); P.satDate = parseDate(d.satdate); P.fileDate = parseDate(d.filedate);
      const dd = dueDateFor(d, o); P.dueKey = dd.key; P.dueDate = dd.ms;
      P.seniorExempt = o.ent === "ind" && d.res !== "0" && ageOf(d) > 0 && !o.hasBusiness;
      P.liable = P.due >= 10000 && !P.seniorExempt;            // s.404: advance tax only if ₹10,000 or more
      P.presumptive = (o.bt === "ad" || o.bt === "ada") && o.ent !== "co";

      // Advance tax schedule (also used for interest under s.425)
      P.when = Math.max(0, Math.min(4, +d.cgwhen || 0));     // capital gains / dividends / winnings arose after instalment …
      let dueExcl = P.due;
      if (P.when > 0) {
        const dx = { ...d, stcg111a: "", stcgo: "", ltcg112a: "", ltcg112: "", ltprop: "", ltpropidx: "", div: "", win: "", vda: "", _noPay: true };
        const ox = compute(dx, mode);
        dueExcl = Math.max(0, Math.min(P.due, ox.total - Math.min(n(d.relief89), ox.total) - P.tds - P.tcs));
      }
      P.schedule = (P.presumptive ? [INST[3]] : INST).map(([date, pct, months, safe], j) => {
        const i = P.presumptive ? 3 : j;
        const base = i < P.when ? dueExcl : P.due;
        const required = Math.round(base * pct), paid = P.cum[i];
        let short = Math.max(0, required - paid);
        if (safe && paid >= base * safe) short = 0;   // 12 % by 15 June / 36 % by 15 September is enough
        const interest = P.liable ? floor100(short) * 0.01 * months : 0;
        return { date, pct, required, paid, short, months, interest, base };
      });
      P.int425 = P.schedule.reduce((a, x) => a + x.interest, 0);

      // s.424: advance tax paid below 90 % of assessed tax → 1 % a month from 1 April 2027 to the return.
      const end = P.fileDate ?? P.dueDate;
      P.int424 = 0; P.m424 = 0;
      if (P.liable && P.adv < 0.9 * P.due) {
        const short = P.due - P.adv;
        P.m424 = monthsFrom(APR1, end);
        if (P.sat && P.satDate != null && P.satDate < end) {
          const m1 = monthsFrom(APR1, P.satDate);
          P.int424 = floor100(short) * 0.01 * m1 + floor100(short - P.sat) * 0.01 * (P.m424 - m1);
        } else P.int424 = floor100(short) * 0.01 * P.m424;
      }

      // s.423: return after the due date → 1 % a month on the tax still unpaid at the due date.
      P.late = P.fileDate != null && P.fileDate > P.dueDate;
      P.int423 = 0; P.m423 = 0;
      if (P.late) {
        const satBefore = P.satDate != null && P.satDate <= P.dueDate ? P.sat : 0;
        P.m423 = monthsFrom(P.dueDate + 86400000, P.fileDate);
        P.int423 = floor100(P.T - P.tds - P.tcs - P.adv - satBefore) * 0.01 * P.m423;
      }
      // s.428: ₹5,000 for a late return; ₹1,000 if total income is ₹5 lakh or less (nil below the exemption limit).
      const be = slabbed(o.ent) ? slabsOf(d, mode)[0][0] : 0;
      P.fee = P.late ? (o.ti <= 500000 ? (o.ti <= be ? 0 : 1000) : 5000) : 0;
      P.tooLate = P.fileDate != null && P.fileDate > BELATED_END;

      P.interest = P.int423 + P.int424 + P.int425;
      P.net = r10(Math.round(P.T + P.interest + P.fee - P.tds - P.tcs - P.adv - P.sat));
      // Updated return (ITR-U, s.263(6)): extra 25 / 50 / 60 / 70 % of tax + interest; +10 % after a s.280 notice.
      const uRate = { 12: 0.25, 24: 0.50, 36: 0.60, 48: 0.70 }[d.itru];
      P.itruRate = uRate ? uRate + (d.itru280 === "1" ? 0.10 : 0) : 0;
      P.itru = uRate ? r10(Math.round(P.itruRate * Math.max(0, P.T + P.interest - P.tds - P.tcs - P.adv - P.sat))) : 0;
      return P;
    }

    const LABELS = { new: "New regime (115BAC)", old: "Old regime", firm: "Tax @30%", normal: "Normal rates", "115BAA": "Section 115BAA @22%", "115BAB": "Section 115BAB @15%" };
    function options(d) {
      const e = entOf(d);
      const modes = slabbed(e) ? ["new", "old"] : e === "firm" ? ["firm"] : ["normal", d.c115bab === "1" ? "115BAB" : "115BAA"];
      // indexation choice for old land / building: resident individuals and HUFs, both figures given
      const idxOk = slabbed(e) && d.res !== "0" && n(d.ltpropidx) > 0;
      return modes.map((m) => {
        let o = compute({ ...d, _idx: false }, m);
        if (idxOk) {
          const oi = compute({ ...d, _idx: true }, m);
          if (!has(d.ltprop) || oi.total < o.total) o = oi;
          o.idxCompared = has(d.ltprop);
        }
        return { id: m, label: m === "normal" ? `Normal rates (${d.cturn === "0" ? "30" : "25"}%)` : LABELS[m], o };
      });
    }
    function compare(d) {
      const opts = options(d);
      const best = opts.reduce((b, x) => (x.o.total < b.o.total ? x : b), opts[0]);
      return { ent: entOf(d), opts, best: best.id, saving: opts.length > 1 ? Math.max(...opts.map((x) => x.o.total)) - best.o.total : 0 };
    }
    return { compute, compare, entOf, parseDate, monthsFrom, both: (d) => ({ nw: compute(d, "new"), old: compute(d, "old") }) };
  })();

  /* ---------- page ---------- */
  const STORE_KEY = "skc-tax-saved-v1";
  const ALL = "ind huf firm co";
  const ENT_NAMES = { ind: "Individual", huf: "HUF", firm: "Partnership firm / LLP", co: "Domestic company" };
  // [id, label (text or per-type), options | "text" | undefined, types shown for (default: all)]
  // sections: [title, subtitle, fields, note (text or per-type), types shown for]
  const FIELDS = [
    ["Basic details", "", [
      ["ent", "Taxpayer type", [["ind", "Individual"], ["huf", "HUF (Hindu Undivided Family)"], ["firm", "Partnership firm / LLP"], ["co", "Domestic company"]]],
      ["name", { ind: "Name (optional)", huf: "Name of the HUF (optional)", firm: "Name of the firm / LLP (optional)", co: "Name of the company (optional)" }, "text"],
      ["age", "Age category", [["0", "Below 60"], ["1", "60 to 80 (Senior)"], ["2", "80 and above (Super senior)"]], "ind"],
      ["res", "Residential status", [["1", "Resident"], ["0", "Non-resident"]], "ind huf firm"],
      ["ftype", "Firm type", [["firm", "Partnership firm"], ["llp", "LLP (limited liability partnership)"]], "firm"],
      ["cturn", "Turnover / gross receipts in FY 2024-25", [["1", "Up to ₹400 crore — 25% rate"], ["0", "Above ₹400 crore — 30% rate"]], "co"],
      ["c115bab", "New manufacturing company eligible for section 115BAB?", [["0", "No — compare with 115BAA"], ["1", "Yes — compare with 115BAB"]], "co"],
    ], {
      ind: "Tax year 2026-27 = 1 Apr 2026 – 31 Mar 2027, under the Income-tax Act, 2025. Labels mostly use the familiar 1961-Act numbers; the new Act's are given where they matter (e.g. 87A → s.156, 115BAC → s.202, 80C → s.123, MAT / AMT → s.206, interest 234A / B / C → s.423 / 424 / 425, late fee 234F → s.428). Slab rates per Finance Act 2026 — unchanged from 2025-26. Senior / super-senior benefits apply to residents only.",
      huf: "An HUF is taxed at the same slab rates as an individual below 60 and can choose the new or old regime. It gets no 87A rebate and no salary income. Rates as per Finance Act 2026.",
      firm: "Firms and LLPs pay a flat 30%, plus 12% surcharge when total income exceeds ₹1 crore, and 4% cess. There is no regime choice or basic exemption. Rates as per Finance Act 2026.",
      co: "Domestic companies: 25% (turnover up to ₹400 crore in FY 2024-25) or 30%, with MAT at 15% of book profit; or the concessional 22% (115BAA) / 15% (115BAB) with a flat 10% surcharge and no MAT. Once chosen, 115BAA / 115BAB can't be withdrawn.",
    }],
    ["1. Salary", "", [
      ["sal", "Gross salary (incl. perquisites)"],
      ["salex", "Exempt allowances u/s 10 (HRA, LTA…) — old regime only"],
      ["pt", "Professional tax u/s 16(iii) — old regime only"],
      ["basic", "Basic + DA (for the 80CCD(2) cap) — blank = gross salary"],
    ], "Standard deduction u/s 16(ia) is applied automatically: ₹75,000 (new) / ₹50,000 (old).", "ind"],
    ["2. House property", "", [
      ["hpt", "Type", { ind: [["none", "None"], ["so", "Self-occupied"], ["lo", "Let-out"]], huf: [["none", "None"], ["so", "Self-occupied"], ["lo", "Let-out"]], firm: [["none", "None"], ["lo", "Let-out"]], co: [["none", "None"], ["lo", "Let-out"]] }],
      ["rent", "Annual rent received (let-out)"],
      ["mun", "Municipal tax paid (let-out)"],
      ["hli", "Home-loan interest u/s 24(b)"],
    ], { ind: "Let-out: NAV − 30% − interest. Self-occupied interest: up to ₹2,00,000 (old regime only). House-property loss set-off against other heads: up to ₹2,00,000 (old regime); not allowed in the new regime.", huf: "Let-out: NAV − 30% − interest. Self-occupied interest: up to ₹2,00,000 (old regime only). House-property loss set-off: up to ₹2,00,000 (old regime); not allowed in the new regime.", firm: "Let-out: NAV − 30% − interest. A loss is set off against other income up to ₹2,00,000; property used for the business itself isn't house property.", co: "Let-out: NAV − 30% − interest. A loss is set off against other income up to ₹2,00,000; property used for the business itself isn't house property." }],
    ["3. Business / profession", "", [
      ["bt", "Method", [["np", "Regular — net profit"], ["ad", "Presumptive 44AD (business)"], ["ada", "Presumptive 44ADA (profession)"]], "ind huf firm"],
      ["np", { ind: "Net profit (regular) — enter a loss with a minus sign", huf: "Net profit (regular) — enter a loss with a minus sign", firm: "Net profit before partners' interest and remuneration (regular)", co: "Taxable business profit (after tax adjustments and tax depreciation)" }],
      ["pint", "Interest to partners — paid / credited", undefined, "firm"],
      ["pcap", "Partners' capital (for the 12% interest cap) — blank = within 12%", undefined, "firm"],
      ["prem", "Remuneration to working partners — paid / credited", undefined, "firm"],
      ["tod", "44AD turnover — digital / bank (6%)", undefined, "ind huf firm"],
      ["toc", "44AD turnover — cash (8%)", undefined, "ind huf firm"],
      ["gr", "44ADA gross receipts (50%)", undefined, "ind huf firm"],
      ["ae1", "44AE heavy goods vehicles — total of tons × months owned (₹1,000 each)"],
      ["ae2", "44AE other goods vehicles — total vehicle-months (₹7,500 each)"],
      ["bfl", "Brought-forward business loss / unabsorbed depreciation"],
      ["bookp", "Book profit for MAT (s.206, old 115JB) — blank = skip the MAT check", undefined, "co"],
      ["matcr", "MAT credit built up to 31 Mar 2026 — used only under 115BAA / 115BAB", undefined, "co"],
    ], {
      ind: "Presumptive income is computed at the minimum rate; if you declare more, use net profit. A business loss is set off against other income except salary, then against capital gains; the rest is shown as carried forward. Brought-forward loss is set off against this year's business income only.",
      huf: "Presumptive income is computed at the minimum rate; if you declare more, use net profit. A business loss is set off against other income, then against capital gains; the rest is carried forward.",
      firm: "Partners' interest is allowed up to 12% a year on capital; working partners' remuneration up to the higher of ₹3 lakh or 90% of the first ₹6 lakh of book profit, plus 60% of the rest — both only if the partnership deed authorises them. Under 44AD / 44ADA no further deduction is allowed. LLPs can't use 44AD / 44ADA.",
      co: "Companies can't use 44AD / 44ADA. MAT is 14% of book profit from tax year 2026-27 (Finance Act 2026) and is now a final tax for companies on normal rates — no new MAT credit. Credit built up to 31 Mar 2026 can be set off only by a company in 115BAA / 115BAB, up to 25% of its tax for the year.",
    }],
    ["4. Capital gains", "", [
      ["stcg111a", "STCG u/s 111A (listed equity / equity funds, STT) — 20%"],
      ["stcgo", "Other STCG — normal rates"],
      ["ltcg112a", "LTCG u/s 112A (equity) — 12.5% above ₹1.25 lakh"],
      ["ltcg112", "Other LTCG u/s 112 — 12.5%"],
      ["ltprop", "LTCG on land / building bought before 23 Jul 2024 — without indexation (12.5%)"],
      ["ltpropidx", "The same gain worked out with indexation (20%) — the cheaper is used", undefined, "ind huf"],
      ["vda", "Crypto / virtual digital asset (VDA) gains — 30%, no loss set-off"],
    ], { ind: "Enter net gains after setting off capital losses. From tax year 2026-27 a share buyback is taxed as capital gains, not dividend. A resident individual or HUF selling land or a building bought before 23 Jul 2024 may pay 20% with indexation instead of 12.5% — enter both figures and the cheaper one is used. The 87A rebate is not available against special-rate tax.", huf: "Enter net gains after setting off capital losses. A buyback is taxed as capital gains from tax year 2026-27. For land or a building bought before 23 Jul 2024 the cheaper of 12.5% without or 20% with indexation is used.", firm: "Enter net gains after setting off capital losses. A buyback is taxed as capital gains from tax year 2026-27.", co: "Enter net gains after setting off capital losses. A buyback is taxed as capital gains from tax year 2026-27." }],
    ["5. Other sources", "", [
      ["sbint", { ind: "Savings bank interest", huf: "Savings bank interest", firm: "Savings bank interest", co: "Savings bank interest" }],
      ["fdint", "FD / other interest"], ["div", "Dividends"], ["oth", "Other income"],
      ["fampen", "Family pension received (⅓ or ₹25,000 new / ₹15,000 old is deducted)", undefined, "ind"],
      ["win", "Winnings — lottery, crossword, betting, card or online games (30%)"],
      ["agri", "Agricultural income (exempt — it only raises the rate on other income)", undefined, "ind huf"],
    ], { ind: "Winnings are taxed at 30% with no exemption limit and no expenses or deductions against them. Agricultural income above ₹5,000 is added only to work out the rate (partial integration).", huf: "Winnings are taxed at 30% flat. Agricultural income above ₹5,000 is added only to work out the rate.", firm: "Winnings are taxed at 30% flat.", co: "Winnings are taxed at 30% flat." }],
    [{ ind: "Deductions — Chapter VI-A", huf: "Deductions — Chapter VI-A", firm: "Deductions", co: "Deductions" }, { ind: "old regime only, except 80CCD(2)", huf: "old regime only", firm: "", co: "" }, [
      ["d80c", { ind: "80C / 80CCC / 80CCD(1) — max ₹1.5 lakh", huf: "80C (insurance, PPF… of members) — max ₹1.5 lakh" }, undefined, "ind huf"],
      ["d80ccd1b", "80CCD(1B) NPS (own) — max ₹50,000", undefined, "ind"],
      ["d80ccd2", "80CCD(2) employer NPS — both regimes (cap 14% new / 10% old of basic)", undefined, "ind"],
      ["d80ds", { ind: "80D health insurance — self / family (cap 25k; 50k senior)", huf: "80D health insurance of members (cap 25k; 50k if senior)" }, undefined, "ind huf"],
      ["d80dp", "80D — parents", undefined, "ind"],
      ["parsen", "Parents are senior citizens?", [["0", "No (cap 25k)"], ["1", "Yes (cap 50k)"]], "ind"],
      ["hsen", "Is an insured member a senior citizen?", [["0", "No (cap 25k)"], ["1", "Yes (cap 50k)"]], "huf"],
      ["d80dd", { ind: "80DD — dependant with disability", huf: "80DD — member with disability" }, [["0", "None"], ["1", "Disability (₹75,000)"], ["2", "Severe disability (₹1,25,000)"]], "ind huf"],
      ["d80ddb", "80DDB — treatment of specified diseases (paid)", undefined, "ind huf"],
      ["ddbsen", "Is the patient a senior citizen?", [["0", "No (cap ₹40,000)"], ["1", "Yes (cap ₹1,00,000)"]], "ind huf"],
      ["d80e", "80E education-loan interest — no cap", undefined, "ind"],
      ["d80eeb", "80EEB electric-vehicle loan interest — max ₹1.5 lakh", undefined, "ind"],
      ["d80gg", "80GG rent paid in the year — only if you get no HRA", undefined, "ind"],
      ["d80u", "80U — own disability", [["0", "None"], ["1", "Disability (₹75,000)"], ["2", "Severe disability (₹1,25,000)"]], "ind"],
      ["d80cch", "80CCH Agniveer Corpus Fund — both regimes", undefined, "ind"],
      ["d80g", "80G donations — qualifying amount"],
      ["d80ggc", { ind: "80GGC donation to a political party / electoral trust (not cash)", huf: "80GGC donation to a political party / electoral trust (not cash)", firm: "80GGC donation to a political party / electoral trust (not cash)", co: "80GGB donation to a political party / electoral trust (not cash)" }],
      ["d80jjaa", "80JJAA — additional employee cost", undefined, "firm co"],
      ["d80m", "80M — dividends received and distributed onward", undefined, "co"],
      ["ttauto", { ind: "80TTA / 80TTB on interest", huf: "80TTA on savings interest" }, [["1", "Apply automatically"], ["0", "Don't apply"]], "ind huf"],
      ["dother", { ind: "Any other Chapter VI-A deduction", huf: "Any other Chapter VI-A deduction", firm: "Part C deductions (80-IA, 80-IAC, 80-IBA…) — AMT applies", co: "Part C deductions (80-IA, 80-IAC, 80-IBA…) — normal rates only" }],
    ], { ind: "In the new regime only 80CCD(2), 80CCH and 80JJAA are allowed. 80GG is worked out automatically: the least of ₹5,000 a month, 25% of adjusted total income, and rent paid minus 10% of it.", huf: "In the new regime Chapter VI-A deductions are not allowed.", firm: "A firm claiming Part C deductions pays at least AMT: 18.5% of total income before those deductions (s.206, old 115JC), with the excess carried forward as credit.", co: "Under 115BAA / 115BAB only 80G, 80GGB, 80JJAA and 80M remain; Part C deductions and additional depreciation are given up." }],
    ["Taxes paid, advance tax & interest", "", [
      ["tds", "TDS deducted (Form 16 / 16A, AIS / 26AS)"],
      ["tcs", "TCS collected"],
      ["relief89", "Relief u/s 89 (arrears of salary, Form 10E) / foreign tax credit"],
      ["at1", "Advance tax paid by 15 Jun 2026"],
      ["at2", "Advance tax paid 16 Jun – 15 Sep 2026"],
      ["at3", "Advance tax paid 16 Sep – 15 Dec 2026"],
      ["at4", "Advance tax paid 16 Dec 2026 – 15 Mar 2027"],
      ["at5", "Advance tax paid 16 – 31 Mar 2027"],
      ["sat", "Self-assessment tax paid"],
      ["satdate", "Date self-assessment tax was paid", "date"],
      ["filedate", "Date the return is (or will be) filed — blank = on the due date", "date"],
      ["duecat", "Return due date", [["auto", "Work it out for me"], ["jul", "31 Jul 2027 — no business income"], ["aug", "31 Aug 2027 — business / profession, no audit"], ["oct", "31 Oct 2027 — tax audit, or a company"], ["nov", "30 Nov 2027 — transfer-pricing report"]]],
      ["cgwhen", "Capital gains, dividends or winnings arose…", [["0", "Early or spread over the year"], ["1", "After 15 Jun 2026"], ["2", "After 15 Sep 2026"], ["3", "After 15 Dec 2026"], ["4", "After 15 Mar 2027"]]],
      ["itru", "Filing an updated return (ITR-U)?", [["0", "No"], ["12", "Yes — within 12 months of the tax year (25%)"], ["24", "Within 24 months (50%)"], ["36", "Within 36 months (60%)"], ["48", "Within 48 months (70%)"]]],
      ["itru280", "Updated return after a reassessment notice (s.280)?", [["0", "No"], ["1", "Yes (a further 10%)"]]],
    ], "Interest is simple, 1% a month, a part of a month counted as a full month, on the amount rounded down to the nearest ₹100. Section 423 (old 234A): late return — on the tax still unpaid at the due date. Section 424 (old 234B): advance tax below 90% of the tax due — from 1 Apr 2027 to the return. Section 425 (old 234C): instalments short of 15 / 45 / 75 / 100% (44AD / 44ADA: 100% by 15 March). Section 428 (old 234F): ₹5,000 for a late return, ₹1,000 if income is ₹5 lakh or less. Advance tax applies only when the tax after TDS / TCS is ₹10,000 or more; a resident senior citizen with no business income is exempt. A belated return can be filed until 31 Dec 2027."],
  ];
  const KEYS = FIELDS.flatMap((s) => s[2].map((f) => f[0]));
  const forEnt = (v, e) => (v && typeof v === "object" && !Array.isArray(v) ? v[e] ?? "" : v ?? "");
  const shownFor = (types, e) => (types || ALL).split(" ").includes(e);

  let last = null;          // inputs kept while moving around the site
  let lastResult = null;

  const el = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v; else if (k === "html") e.innerHTML = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return e;
  };
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const inr = (x) => { x = Math.round(x); return (x < 0 ? "−" : "") + "₹" + Math.abs(x).toLocaleString("en-IN"); };
  const say = (msg, kind) => (window.GG?.toast ? window.GG.toast(msg, kind) : alert(msg));
  const store = {
    list() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); } catch { return []; } },
    put(a) { try { localStorage.setItem(STORE_KEY, JSON.stringify(a)); return true; } catch { say("Couldn't save in this browser.", "error"); return false; } },
  };

  let formEl = null;   // the form, also before it is on screen
  function render(root) {
    const form = formEl = el("div", { id: "tax-form" },
      FIELDS.map(([title, sub, fields, note, types]) => el("section", { class: "tax-card", "data-types": types || ALL },
        el("h2", null, el("span", { class: "tx-l", "data-l": JSON.stringify(title) }), el("span", { class: "muted tx-l", "data-l": JSON.stringify(sub), "data-pre": " " })),
        el("div", { class: "tax-grid" }, fields.map(([id, label, opts, ftypes]) => el("label", { class: "field", "data-types": ftypes || ALL },
          el("span", { class: "tx-l", "data-l": JSON.stringify(label) }),
          opts && opts !== "text" && opts !== "date"
            ? el("select", { id: `tx-${id}`, "data-opts": Array.isArray(opts) ? null : JSON.stringify(opts), onchange: id === "ent" ? () => applyEnt() : null },
              (Array.isArray(opts) ? opts : opts.ind).map(([v, t]) => el("option", { value: v }, t)))
            : el("input", { id: `tx-${id}`, type: opts === "date" ? "date" : "text", inputmode: opts === "text" || opts === "date" ? null : "decimal", autocomplete: "off" })))),
        el("p", { class: "muted tax-note tx-l", "data-l": JSON.stringify(note || "") }))),
      el("div", { class: "tax-actions noprint" },
        el("button", { class: "btn primary", type: "button", onclick: run }, "Compute tax"),
        el("button", { class: "btn", type: "button", onclick: sample }, "Fill sample"),
        el("button", { class: "btn", type: "button", onclick: reset }, "Reset")));
    const saved = el("section", { class: "tax-card noprint", id: "tax-saved" }, el("h2", null, "Saved computations"), el("div", { id: "tax-slist", class: "muted" }));
    const out = el("div", { id: "tax-out" });
    root.replaceChildren(
      el("h1", { class: "page-title" }, "Income Tax Calculator"),
      el("p", { class: "muted" }, "Individuals, HUFs, partnership firms, LLPs and companies · Tax Year 2026-27 · compares the options open to the taxpayer, with a printable computation."),
      form, saved, out,
      el("p", { class: "tax-disc" }, el("b", null, "Disclaimer: "), "An estimate for general guidance only, not tax advice. It does not cover every provision (clubbing, the full set-off and carry-forward rules, AMT for individuals, agricultural income, relief u/s 89, every condition of each deduction, NRI and foreign-company rates, tonnage tax). Verify with a qualified professional or the Income Tax Department's utility before filing."));
    applyEnt();
    // The page is put on screen right after render() returns; fill it in then.
    queueMicrotask(() => {
      if (!root.isConnected) return;
      if (last) fill(last);
      renderSaved();
      if (lastResult) show(lastResult, false);
    });
  }

  const $ = (id) => document.getElementById(`tx-${id}`);
  const curEnt = () => formEl?.querySelector("#tx-ent")?.value || "ind";
  // Show only the sections and fields that apply to the chosen taxpayer type, with its labels.
  function applyEnt() {
    const e = curEnt();
    if (!formEl) return;
    formEl.querySelectorAll("[data-types]").forEach((x) => { x.hidden = !shownFor(x.dataset.types, e); });
    formEl.querySelectorAll(".tx-l").forEach((x) => {
      const t = forEnt(JSON.parse(x.dataset.l), e);
      x.textContent = t ? (x.dataset.pre || "") + t : "";
      if (x.tagName === "P") x.hidden = !t;
    });
    // number the income heads that apply (an HUF, firm or company has no salary head)
    let k = 0;
    formEl.querySelectorAll(":scope > .tax-card:not([hidden]) > h2 > .tx-l:first-child").forEach((x) => {
      if (/^\d+\. /.test(x.textContent)) x.textContent = `${++k}. ${x.textContent.replace(/^\d+\. /, "")}`;
    });
    formEl.querySelectorAll("select[data-opts]").forEach((s) => {
      const opts = forEnt(JSON.parse(s.dataset.opts), e), v = s.value;
      s.replaceChildren(...opts.map(([val, t]) => el("option", { value: val }, t)));
      s.value = opts.some(([val]) => val === v) ? v : opts[0][0];
    });
  }
  // Amounts may be typed as "8,75,000" or "₹ 875000"; the name is kept as typed.
  const data = () => Object.fromEntries(KEYS.map((k) => {
    const v = $(k)?.value || "";
    return [k, k === "name" ? v.trim() : v.replace(/[,₹\s]/g, "")];
  }));
  const fill = (d) => {
    if (d.ent !== undefined && $("ent")) { $("ent").value = d.ent || "ind"; applyEnt(); }
    KEYS.forEach((k) => { if (d[k] !== undefined && $(k)) $(k).value = d[k]; });
  };

  function run() {
    last = data();
    show(TAX.compare(last), true);
  }
  function describe(d) {
    const e = TAX.entOf(d), opt = (id) => { const s = $(id); return s ? s.selectedOptions[0]?.text || "" : ""; };
    if (e === "ind") return ["Individual", opt("age"), opt("res")];
    if (e === "huf") return ["HUF", opt("res")];
    if (e === "firm") return [d.ftype === "llp" ? "LLP" : "Partnership firm", opt("res")];
    return ["Domestic company", d.cturn === "0" ? "turnover above ₹400 crore" : "turnover up to ₹400 crore"];
  }
  function show(r, scroll) {
    lastResult = r;
    const d = last || {};
    const best = r.opts.find((x) => x.id === r.best);
    const out = document.getElementById("tax-out");
    const rec = r.opts.length < 2 ? `Tax payable: ${inr(best.o.total)}${best.o.basis ? ` (${best.o.basis})` : ""}`
      : `Recommended: ${best.label}${r.saving ? " — saves " + inr(r.saving) : " (equal tax)"}`;
    const balance = (o) => (o.pay && o.pay.active ? `<small>${o.pay.net >= 0 ? "Balance payable" : "Refund"} ${inr(Math.abs(o.pay.net))}${o.pay.interest + o.pay.fee ? ` · interest & fee ${inr(o.pay.interest + o.pay.fee)}` : ""}</small>` : "");
    out.innerHTML = `<section class="tax-card" id="tax-result">
      <h2>Computation of Income — Tax Year 2026-27${d.name ? " · " + esc(d.name) : ""}</h2>
      <p class="muted">${esc(describe(d).filter(Boolean).join(" · "))}</p>
      <div class="tax-cmp n${r.opts.length}">${r.opts.map((x) => `<div class="tax-reg ${r.opts.length > 1 && x.id === r.best ? "best" : ""}">${esc(x.label)}<b>${inr(x.o.total)}</b>${x.o.basis ? `<small>${x.o.basis} applies</small>` : ""}${balance(x.o)}</div>`).join("")}</div>
      <p class="tax-rec">${esc(rec)}</p>
      ${r.ent === "co" && r.opts.length > 1 ? `<p class="muted tax-note">Choosing ${esc(r.opts[1].label.split(" @")[0])} is irrevocable and gives up Part C deductions and additional depreciation. It is now also the only way to use MAT credit built up to 31 Mar 2026 (up to 25% of the tax each year), since MAT on normal rates has become a final tax.</p>` : ""}
      ${schedule(best)}
      <div class="tax-cmp n${r.opts.length}">${r.opts.map((x) => sheet(x.o, x.label)).join("")}</div>
      <p class="tax-actions noprint">
        <button class="btn primary" type="button" data-act="print">Print</button>
        <button class="btn" type="button" data-act="save">Save</button>
        <button class="btn" type="button" data-act="pdf">Download PDF</button>
        <button class="btn" type="button" data-act="csv">Download CSV</button>
        <button class="btn" type="button" data-act="edit">Edit inputs</button>
      </p></section>`;
    out.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => ({
      print: () => window.print(), save: saveUI, pdf: downloadPDF, csv: downloadCSV,
      edit: () => document.getElementById("tax-form").scrollIntoView({ behavior: "smooth" }),
    })[b.dataset.act]()));
    if (scroll) out.scrollIntoView({ behavior: "smooth" });
  }

  // Advance tax instalments for the recommended option: what is due by each date and what is still to pay.
  function schedule(opt) {
    const P = opt.o.pay;
    if (!P || !P.liable) return "";
    const rows = P.schedule.map((x) => `<tr><td>By ${x.date} — ${Math.round(x.pct * 100)}% = ${inr(x.required)}${P.active ? ` (paid ${inr(x.paid)})` : ""}${x.base !== P.due ? " · excl. later capital gains / dividends / winnings" : ""}</td><td class="n">${inr(Math.max(0, x.required - x.paid))}</td></tr>`).join("");
    return `<div class="tax-sched"><h3>Advance tax — ${esc(opt.label)}${P.presumptive ? " (44AD / 44ADA: one instalment)" : ""}</h3>
      <table class="tax-table"><tr class="h"><td>Instalment (cumulative)</td><td class="n">Still to pay</td></tr>${rows}</table></div>`;
  }

  function sheet(o, title) {
    const row = (l, v, c) => `<tr class="${c || ""}"><td class="${c === "i" ? "ind" : ""}">${l}</td><td class="n">${v === "" ? "" : inr(v)}</td></tr>`;
    const ind = o.ent === "ind";
    let h = `<div><h3>${esc(title)}</h3><table class="tax-table">`;
    let k = 0;
    const head = (t) => `${++k}. ${t}`;
    if (ind) {
      h += row(head("Income from Salary"), "", "h") + row("Gross salary", o.salGross, "i");
      if (o.salEx) h += row("Less: exempt allowances u/s 10", -o.salEx, "i");
      h += row("Less: standard deduction u/s 16(ia)", -o.sd, "i");
      if (o.pt) h += row("Less: professional tax u/s 16(iii)", -o.pt, "i");
      h += row("Income from Salary", o.salary, "t");
    }
    h += row(head("Income from House Property") + (o.hpt === "so" ? " (self-occupied)" : o.hpt === "lo" ? " (let-out)" : ""), "", "h");
    if (o.hpt === "lo") h += row("Net annual value", o.nav, "i") + row("Less: 30% u/s 24(a)", -o.sd30, "i");
    if (o.hpt !== "none") h += row("Less: interest u/s 24(b)", -o.int, "i");
    if (o.hpRaw !== o.hp) h += row("Loss restricted for set-off", o.hp, "i");
    h += row("Income from House Property", o.hp, "t");
    h += row(head("Profits & Gains of Business/Profession") + (o.bt === "ad" ? " (44AD)" : o.bt === "ada" ? " (44ADA)" : ""), "", "h");
    if (o.firm) {
      const f = o.firm;
      h += row("Net profit before partners' interest and remuneration", f.np, "i");
      h += row("Less: interest to partners allowed u/s 40(b)" + (f.intA < f.intPaid ? ` (paid ${inr(f.intPaid)}; ${inr(f.intPaid - f.intA)} over 12% disallowed)` : ""), -f.intA, "i");
      h += row("Book profit (for the remuneration limit)", f.bp, "i");
      h += row(`Less: remuneration to working partners — allowable limit ${inr(f.lim)}` + (f.remA < f.remPaid ? ` (paid ${inr(f.remPaid)}; ${inr(f.remPaid - f.remA)} disallowed)` : ""), -f.remA, "i");
    }
    if (o.ae) h += row("Presumptive income from goods carriages (44AE)", o.ae, "i");
    if (o.bflUsed) h += row("Business income for the year", o.busCY, "i") + row("Less: brought-forward loss / unabsorbed depreciation set off", -o.bflUsed, "i");
    h += row("Profits & Gains of Business/Profession", o.bus, "t");
    if (o.bflLeft) h += row("Brought-forward loss still to carry forward", o.bflLeft, "i");
    h += row(head("Capital Gains"), "", "h") + row("STCG u/s 111A @20%", o.stcgA, "i") + row("Other STCG (normal rates)", o.stcgO, "i")
      + row("LTCG u/s 112A @12.5%", o.ltA, "i") + row("LTCG u/s 112 @12.5%" + (o.ltProp && !o.idxUsed ? " (incl. old land / building, without indexation)" : ""), o.lt, "i");
    if (o.lt20) h += row("LTCG on land / building bought before 23 Jul 2024 @20% with indexation", o.lt20, "i");
    if (o.idxCompared) h += row(o.idxUsed ? "Indexation chosen — 20% with indexation costs less" : "No indexation — 12.5% without it costs less", "", "i");
    h += row("Capital Gains", o.cg, "t");
    if (o.sA + o.sL + o.sLA + o.sL20 < o.stcgA + o.lt + o.ltA + o.lt20) h += row("Special-rate gains left after loss set-off", o.sA + o.sL + o.sLA + o.sL20, "i");
    h += row(head("Income from Other Sources"), "", "h") + row("Interest", o.sb + o.fd, "i") + row("Dividends", o.div, "i") + row("Others", o.oth, "i");
    if (o.fp) h += row("Family pension", o.fp, "i") + row("Less: deduction on family pension", -o.fpDed, "i");
    h += row("Income from Other Sources", o.os, "t");
    if (o.win || o.vda) {
      h += row(head("Income taxed at 30%"), "", "h");
      if (o.win) h += row("Winnings — lottery, crossword, betting, games", o.win, "i");
      if (o.vda) h += row("Crypto / VDA gains", o.vda, "i");
    }
    h += row("Gross Total Income", o.gti, "t");
    if (o.busCF) h += row("Business loss not set off this year (carry forward)", o.busCF, "i");
    if (o.hpCF) h += row("House-property loss not set off this year", o.hpCF, "i");
    h += row(o.ent === "firm" || o.ent === "co" ? "Less: Deductions" : "Less: Deductions under Chapter VI-A", "", "h");
    o.dedList.forEach((x) => { h += row(`${x[0]} — ${x[1]}`, x[2], "i"); });
    if (!o.dedList.length) h += row("None", "", "i");
    if (o.ded < o.dedList.reduce((a, x) => a + x[2], 0)) h += row("Restricted to normal income", o.ded, "i");
    const rateLbl = { new: "slab rates", old: "slab rates", firm: "30%", normal: o.tNormal && o.normal ? `${Math.round(o.tNormal / o.normal * 100)}%` : "normal rates", "115BAA": "22%", "115BAB": "15% / 22%" }[o.regime];
    h += row("Total Income (rounded u/s 288A)", o.ti, "t");
    if (o.agri > 5000 && o.normal > 0) h += row(`Agricultural income ${inr(o.agri)} — counted only for the rate`, "", "i");
    h += row(`Tax on normal income at ${rateLbl}`, o.tNormal, "i");
    if (o.tStA) h += row("Tax on STCG 111A @20%", o.tStA, "i");
    if (o.tLt20) h += row("Tax on LTCG (land / building, indexed) @20%", o.tLt20, "i");
    if (o.tWin) h += row("Tax on winnings / VDA gains @30%", o.tWin, "i");
    if (o.tLtA) h += row("Tax on LTCG 112A @12.5% (above ₹1.25 lakh)", o.tLtA, "i");
    if (o.tLt) h += row("Tax on LTCG 112 @12.5%", o.tLt, "i");
    h += row("Tax on Total Income", o.tax, "t");
    if (ind) h += row("Less: rebate u/s 87A (s.156)", -o.rebate, "i");
    h += row("Surcharge" + (o.surRate ? ` @${+(o.surRate * 100).toFixed(2)}%` + (o.mr ? ` (after marginal relief ${inr(o.mr)})` : "") : ""), o.sur, "i")
      + row("Health & Education Cess @4%", o.cess, "i") + row(o.mat || o.amt ? "Tax under normal provisions (rounded)" : "Total Tax Liability (rounded u/s 288B)", o.normalTotal, "t");
    const flat = (x, name, rate) => row(`${name} @${rate} of ${inr(x.base)}`, x.tax, "i") + (x.sur ? row("Surcharge", x.sur, "i") : "") + row("Cess @4%", x.cess, "i") + row(`${name} (rounded)`, x.total, "t");
    if (o.mat) h += row("Minimum Alternate Tax (s.206, old 115JB)", "", "h") + flat(o.mat, "MAT", "14%");
    if (o.amt) h += row("Alternate Minimum Tax (s.206, old 115JC)", "", "h") + flat(o.amt, "AMT", "18.5%");
    if (o.mat || o.amt) {
      h += row(`Total Tax Liability — higher of the two${o.basis ? ` (${o.basis})` : ""}`, o.total, "t");
      if (o.basis === "MAT") h += row("MAT is a final tax from tax year 2026-27 — no MAT credit arises", "", "i");
      if (o.amtCredit) h += row("AMT credit to carry forward (15 years)", o.amtCredit, "i");
    }
    if (o.matCrUsed) h += row("Less: MAT credit of earlier years set off (max 25% of tax)", -o.matCrUsed, "i")
      + row("Total Tax Liability after MAT credit", o.total, "t") + (o.matCrLeft ? row("MAT credit still to carry forward", o.matCrLeft, "i") : "");
    h += payRows(o.pay, row);
    return h + "</table></div>";
  }

  // The "Taxes paid & interest" block of a computation.
  function payRows(P, row) {
    if (!P) return "";
    let h = row("Taxes paid, interest and balance", "", "h");
    if (P.relief) h += row("Less: relief u/s 89 (s.157) / foreign tax credit", -P.relief, "i");
    h += row("Tax liability", P.T, "t");
    if (P.tds) h += row("Less: TDS", -P.tds, "i");
    if (P.tcs) h += row("Less: TCS", -P.tcs, "i");
    h += row("Tax due after TDS / TCS", P.due, "t");
    if (!P.active) return h + row(P.liable ? "Enter TDS, advance tax and the filing date below to work out interest" : "No advance tax needed (under ₹10,000, or a resident senior with no business income)", "", "i");
    if (P.adv) h += row("Less: advance tax paid", -P.adv, "i");
    if (!P.liable) h += row(P.seniorExempt ? "Advance tax: resident senior citizen with no business income — not required" : "Advance tax: tax due is under ₹10,000 — not required", "", "i");
    P.schedule.filter((x) => x.interest).forEach((x) => { h += row(`Interest u/s 425 (old 234C): ${x.date} — short by ${inr(x.short)} × 1% × ${x.months}`, x.interest, "i"); });
    if (P.liable && !P.int425) h += row("Interest u/s 425 (old 234C) — instalments paid in time", 0, "i");
    if (P.int424) h += row(`Interest u/s 424 (old 234B) — advance tax under 90%: ${P.m424} month${P.m424 > 1 ? "s" : ""} from 1 Apr 2027`, P.int424, "i");
    if (P.late) h += row(`Interest u/s 423 (old 234A) — return ${P.m423} month${P.m423 > 1 ? "s" : ""} late`, P.int423, "i") + row("Fee u/s 428 (old 234F) — late return", P.fee, "i");
    if (P.sat) h += row("Less: self-assessment tax paid", -P.sat, "i");
    h += row(P.net >= 0 ? "Balance tax payable" : "Refund due", Math.abs(P.net), "t");
    if (P.itru) h += row(`Additional tax on updated return (ITR-U) @${Math.round(P.itruRate * 100)}% of tax + interest`, P.itru, "i") + row("Total payable with the updated return", P.net + P.itru, "t");
    if (P.tooLate) h += row("⚠ A belated return can be filed only until 31 Dec 2027 — after that, an updated return (ITR-U)", "", "i");
    return h;
  }

  const SAMPLES = {
    ind: { name: "Sample Taxpayer", sal: 1500000, salex: 0, pt: 2500, hpt: "so", hli: 150000, sbint: 12000, fdint: 30000, div: 8000, ltcg112a: 200000, d80c: 150000, d80ds: 25000, d80ccd1b: 50000, tds: 60000, at3: 15000, filedate: "2027-09-20" },
    huf: { name: "Sample HUF", hpt: "lo", rent: 360000, mun: 12000, bt: "np", np: 900000, fdint: 85000, sbint: 14000, ltcg112a: 180000, d80c: 150000, d80ds: 20000 },
    firm: { name: "Sample Traders (firm)", ftype: "firm", bt: "np", np: 4200000, pint: 360000, pcap: 2500000, prem: 2400000, fdint: 60000, stcg111a: 50000, tds: 40000, at1: 60000, at2: 130000, at3: 130000, at4: 100000, filedate: "2027-08-31" },
    co: { name: "Sample Industries Pvt Ltd", cturn: "1", c115bab: "0", np: 18000000, bookp: 21000000, fdint: 400000, div: 150000, ltcg112: 800000, d80g: 100000, d80jjaa: 300000, dother: 1500000 },
  };
  function sample() {
    const e = curEnt();
    reset();
    fill({ ent: e, ...SAMPLES[e] });
  }
  // Clears the figures but keeps the taxpayer type.
  function reset() {
    const e = curEnt();
    last = null; lastResult = null;
    KEYS.forEach((k) => { const x = $(k); if (x) x.value = x.tagName === "SELECT" ? x.options[0].value : ""; });
    $("ent").value = e;
    applyEnt();
    document.getElementById("tax-out").replaceChildren();
  }

  function renderSaved() {
    const box = document.getElementById("tax-slist");
    if (!box) return;
    const a = store.list();
    if (!a.length) { box.textContent = "None saved yet."; return; }
    box.replaceChildren(el("table", { class: "tax-table" }, a.map((x) => el("tr", null,
      el("td", null, x.name, " ", el("span", { class: "muted" }, `(${new Date(x.at).toLocaleString("en-IN")})`)),
      el("td", { class: "n" },
        el("button", { class: "btn small", type: "button", onclick: () => { last = { ent: "ind", ...x.data }; fill(last); run(); } }, "Open"),
        el("button", { class: "btn small", type: "button", onclick: () => {
          if (!confirm(`Delete "${x.name}"?`)) return;
          store.put(store.list().filter((y) => y.name !== x.name)); renderSaved();
        } }, "Delete"))))));
  }
  function saveUI() {
    const def = $("name").value || "Computation " + new Date().toLocaleDateString("en-IN");
    const name = prompt("Save computation as:", def);
    if (name === null) return;
    const nm = String(name).trim() || "Untitled";
    const a = store.list().filter((x) => x.name !== nm);
    a.push({ name: nm, data: data(), at: new Date().toISOString() });
    if (store.put(a)) { renderSaved(); say("✓ Saved in this browser"); }
  }

  const fname = (ext) => "SKC-Tax-Computation-2026-27" + ($("name")?.value ? "-" + $("name").value.replace(/[^\w-]+/g, "_") : "") + "." + ext;
  function stmtRows() {
    const rows = [];
    document.querySelectorAll("#tax-result h2, #tax-result .tax-rec, #tax-result h3, #tax-result tr").forEach((e) => {
      if (e.tagName === "TR") { const c = e.querySelectorAll("td"); rows.push([c[0].textContent, c[1] ? c[1].textContent : ""]); }
      else rows.push([e.textContent, ""]);
    });
    return rows;
  }
  function downloadCSV() {
    const lines = stmtRows().map(([a, b]) => [a, b.replace(/[₹,]/g, "").replace("−", "-")].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    saveBlob(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv" }), fname("csv"));
  }
  function saveBlob(blob, name) {
    const a = el("a", { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = el("script", { src });
    s.onload = resolve; s.onerror = () => reject(new Error(`couldn't load ${src}`));
    document.head.append(s);
  });
  async function downloadPDF() {
    try {
      if (!window.jspdf?.jsPDF) { await loadScript("vendor/jspdf.umd.min.js"); await loadScript("vendor/jspdf.plugin.autotable.min.js"); }
    } catch { say("PDF library didn't load — use Print and choose “Save as PDF”.", "error"); return; }
    // The PDF's built-in fonts are Latin-only, so ₹ and Hindi are written as plain text.
    const rs = (t) => String(t).replace(/₹/g, "Rs. ").replace(/−/g, "-").replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
    const doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
    let y = 40;
    const res = document.getElementById("tax-result");
    doc.setFontSize(14); doc.text(rs(res.querySelector("h2").textContent), 40, y); y += 18;
    doc.setFontSize(10);
    res.querySelectorAll(".tax-reg").forEach((e) => { doc.text(rs(e.firstChild.textContent + ": " + e.querySelector("b").textContent), 40, y); y += 14; });
    doc.text(rs(res.querySelector(".tax-rec").textContent), 40, y); y += 10;
    res.querySelectorAll("h3").forEach((h3) => {
      const body = [...h3.nextElementSibling.querySelectorAll("tr")].map((tr) => { const c = tr.querySelectorAll("td"); return [rs(c[0].textContent), rs(c[1] ? c[1].textContent : "")]; });
      doc.autoTable({ startY: y + 12, head: [[rs(h3.textContent), "Amount"]], body, theme: "grid", styles: { fontSize: 8 }, columnStyles: { 1: { halign: "right" } }, headStyles: { fillColor: [180, 73, 15] } });
      y = doc.lastAutoTable.finalY + 10;
    });
    doc.setFontSize(8);
    doc.text("Estimate for guidance only, not tax advice. (c) SKC & CO.", 40, doc.internal.pageSize.getHeight() - 20);
    doc.save(fname("pdf"));
  }

  /* Hooks for Saarthi: fill the calculator with figures (e.g. read from a Form 16) and read what's on it. */
  function prefill(d) {
    last = Object.fromEntries(KEYS.map((k) => [k, d[k] == null ? "" : String(d[k])]));
    lastResult = TAX.compare(last);
    const root = document.querySelector(".tax-page");
    if (root && root.isConnected) render(root);   // already on the page: redraw with the new figures
    return lastResult;
  }
  function current() {
    const onPage = !!$("ent");
    return { inputs: onPage ? data() : last, result: lastResult };
  }

  window.GGTax = { render, TAX, KEYS, prefill, current };
})();
