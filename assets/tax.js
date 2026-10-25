/* SKC Income Tax Calculator — Tax Year 2026-27, inside Gita Gyan (route #/tax).
 * The engine is the SKC calculator's, with four fixes:
 *  1. new-regime 87A rebate is only set against tax at slab rates (not 111A / 112 / 112A tax), as from AY 2026-27;
 *  2. the higher senior / super-senior exemptions (and senior 80D / 80TTB) apply to residents only;
 *  3. a current-year business loss no longer wipes out the house-property loss set-off against salary;
 *  4. business loss now also sets off against capital gains (after other income), the rest is carried forward.
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
    const r10 = (x) => Math.round(x / 10) * 10;
    // Senior and super-senior benefits are for resident individuals only.
    const ageOf = (d) => (d.res === "0" ? 0 : +d.age || 0);

    function heads(d, nw) {
      const age = ageOf(d), o = {};
      const sal = n(d.sal);
      o.salGross = sal;
      o.salEx = nw ? 0 : Math.min(n(d.salex), sal);
      o.sd = sal > 0 ? Math.min(nw ? 75000 : 50000, sal - o.salEx) : 0;
      o.pt = nw ? 0 : Math.min(n(d.pt), 2500);
      o.salary = Math.max(0, sal - o.salEx - o.sd - o.pt);

      let hp = 0;
      o.hpt = d.hpt || "none"; o.nav = 0; o.sd30 = 0; o.int = 0;
      if (o.hpt === "lo") { o.nav = Math.max(0, n(d.rent) - n(d.mun)); o.sd30 = Math.round(o.nav * 0.3); o.int = n(d.hli); hp = o.nav - o.sd30 - o.int; }
      else if (o.hpt === "so") { o.int = nw ? 0 : Math.min(n(d.hli), 200000); hp = -o.int; }
      o.hpRaw = hp;
      if (hp < 0) hp = nw ? 0 : Math.max(hp, -200000);
      o.hp = hp;

      o.bt = d.bt || "np";
      o.bus = o.bt === "ad" ? Math.round(n(d.tod) * 0.06 + n(d.toc) * 0.08) : o.bt === "ada" ? Math.round(n(d.gr) * 0.5) : (+d.np || 0);
      o.stcgA = n(d.stcg111a); o.stcgO = n(d.stcgo); o.ltA = n(d.ltcg112a); o.lt = n(d.ltcg112);
      o.cg = o.stcgA + o.stcgO + o.ltA + o.lt;
      o.sb = n(d.sbint); o.fd = n(d.fdint); o.div = n(d.div); o.oth = n(d.oth);
      o.os = o.sb + o.fd + o.div + o.oth;

      // Inter-head set-off of this year's losses (simplified):
      //  • business loss — against any head except salary: other normal income first, then capital gains
      //    (20 % gains before 12.5 % ones); whatever is left is carried forward;
      //  • house-property loss (already capped above) — against salary first, then other heads.
      let salary = o.salary, nonSal = Math.max(0, o.hp) + Math.max(0, o.bus) + o.stcgO + o.os;
      let sA = o.stcgA, sL = o.lt, sLA = o.ltA;
      const absorb = (loss, amt) => { const used = Math.min(loss.left, amt); loss.left -= used; return amt - used; };
      const bl = { left: Math.max(0, -o.bus) };
      nonSal = absorb(bl, nonSal); sA = absorb(bl, sA); sL = absorb(bl, sL); sLA = absorb(bl, sLA);
      const hl = { left: Math.max(0, -o.hp) };
      salary = absorb(hl, salary); nonSal = absorb(hl, nonSal); sA = absorb(hl, sA); sL = absorb(hl, sL); sLA = absorb(hl, sLA);
      o.busCF = bl.left; o.hpCF = hl.left + (o.hp - o.hpRaw);   // loss not set off this year
      o.sA = sA; o.sL = sL; o.sLA = sLA;                         // capital gains left after set-off
      o.gti = salary + nonSal + sA + sL + sLA;
      o.special = sA + sL + sLA;
      o.normalGTI = o.gti - o.special;

      // Chapter VI-A deductions (not against special-rate capital gains).
      const D = [], add = (k, lbl, v) => { if (v > 0) D.push([k, lbl, v]); };
      const basic = n(d.basic) || sal;
      add("80CCD(2)", "Employer NPS", Math.min(n(d.d80ccd2), Math.round(basic * (nw ? 0.14 : 0.10))));
      if (!nw) {
        add("80C", "80C/80CCC/80CCD(1)", Math.min(n(d.d80c), 150000));
        add("80CCD(1B)", "NPS (own)", Math.min(n(d.d80ccd1b), 50000));
        const dS = Math.min(n(d.d80ds), age > 0 ? 50000 : 25000), dP = Math.min(n(d.d80dp), +d.parsen ? 50000 : 25000);
        add("80D", "Health insurance", dS + dP);
        add("80E", "Education loan interest", n(d.d80e));
        add("80G", "Donations", n(d.d80g));
        if (d.ttauto !== "0") {
          if (age > 0) add("80TTB", "Deposit interest (senior)", Math.min(o.sb + o.fd, 50000));
          else add("80TTA", "Savings interest", Math.min(o.sb, 10000));
        }
        add("Others", "Other Chapter VI-A", n(d.dother));
      }
      o.dedList = D;
      o.ded = Math.min(D.reduce((a, x) => a + x[2], 0), o.normalGTI);
      o.ti = r10(o.gti - o.ded);
      o.normal = Math.max(0, o.ti - o.special);
      return o;
    }

    function taxOn(normal, stA, ltA, lt, nw, age, res) {
      const s = nw ? NEW : oldSl(age);
      const be = s[0][0], tn = slab(normal, s);
      let unused = res ? Math.max(0, be - normal) : 0;   // residents may use unused exemption against special-rate gains
      const use = (x) => { const u = Math.min(unused, x); unused -= u; return x - u; };
      const a = use(stA), l = use(lt), l2 = use(Math.max(0, ltA - 125000));
      return { normal: tn, stA: a * 0.20, lt: l * 0.125, ltA: l2 * 0.125, sp: a * 0.20 + l * 0.125 + l2 * 0.125 };
    }

    const surRate = (ti, nw) => (ti > 50000000 ? (nw ? 0.25 : 0.37) : ti > 20000000 ? 0.25 : ti > 10000000 ? 0.15 : ti > 5000000 ? 0.10 : 0);

    function compute(d, regime) {
      const nw = regime === "new", age = ageOf(d), res = d.res !== "0";
      const o = heads(d, nw);
      o.regime = regime;
      const t = taxOn(o.normal, o.sA, o.sLA, o.sL, nw, age, res);
      o.tNormal = t.normal; o.tSpecial = t.sp; o.tStA = t.stA; o.tLt = t.lt; o.tLtA = t.ltA; o.tax = t.normal + t.sp;

      // 87A — residents only. New regime: only against tax at slab rates (special-rate tax excluded from AY 2026-27),
      // up to ₹60,000 for income up to ₹12 lakh, with marginal relief just above. Old regime: ₹12,500 up to ₹5 lakh
      // (not against 112A tax).
      o.rebate = 0;
      if (res) {
        if (nw) {
          if (o.ti <= 1200000) o.rebate = Math.min(t.normal, 60000);
          else if (o.tax - (o.ti - 1200000) > 0) o.rebate = Math.min(t.normal, o.tax - (o.ti - 1200000));
        } else if (o.ti <= 500000) o.rebate = Math.min(t.normal + t.stA + t.lt, 12500);
      }
      o.afterReb = o.tax - o.rebate;

      // Surcharge (15 % cap on capital gains and dividends) with marginal relief.
      const r = surRate(o.ti, nw), rc = Math.min(r, 0.15);
      const divShare = Math.min(1, o.normal > 0 ? o.div / o.normal : 0);
      const tN = Math.max(0, o.afterReb - t.sp);
      const sc = (rr, rcc, tn, tsp) => tn * (1 - divShare) * rr + (tn * divShare + tsp) * rcc;
      o.surRate = r; o.sur = r ? sc(r, rc, tN, t.sp) : 0; o.mr = 0;
      if (r) {
        const th = o.ti > 50000000 ? 50000000 : o.ti > 20000000 ? 20000000 : o.ti > 10000000 ? 10000000 : 5000000;
        const ex = o.ti - th;
        const nN = Math.max(0, o.normal - ex);
        let rem = ex - (o.normal - nN);
        const cut = (x) => { const c = Math.min(x, rem); rem -= c; return x - c; };
        const lA = cut(o.sLA), l = cut(o.sL), sA = cut(o.sA);
        const t2 = taxOn(nN, sA, lA, l, nw, age, res);
        const r2 = surRate(th, nw), rc2 = Math.min(r2, 0.15);
        const at = t2.normal + t2.sp + (r2 ? sc(r2, rc2, t2.normal, t2.sp) : 0);
        const capAmt = at + ex;
        if (o.afterReb + o.sur > capAmt) { o.mr = o.afterReb + o.sur - capAmt; o.sur -= o.mr; }
      }
      o.cess = (o.afterReb + o.sur) * 0.04;
      o.total = r10(Math.round(o.afterReb + o.sur + o.cess));   // 288B
      return o;
    }
    return { compute, both: (d) => ({ nw: compute(d, "new"), old: compute(d, "old") }) };
  })();

  /* ---------- page ---------- */
  const STORE_KEY = "skc-tax-saved-v1";
  const FIELDS = [
    ["Basic details", "मूल विवरण", [
      ["name", "Name (optional)", "text"],
      ["age", "Age category · आयु", [["0", "Below 60"], ["1", "60 to 80 (Senior)"], ["2", "80 and above (Super senior)"]]],
      ["res", "Residential status", [["1", "Resident"], ["0", "Non-resident"]]],
    ], "Tax year 2026-27 = 1 Apr 2026 – 31 Mar 2027 (Income-tax Act, 2025). Section numbers are the familiar 1961-Act references; the new Act renumbers them. Rates as per Finance Act 2026 — unchanged from FY 2025-26. Senior / super-senior benefits apply to residents only."],
    ["1. Salary", "वेतन", [
      ["sal", "Gross salary (incl. perquisites)"],
      ["salex", "Exempt allowances u/s 10 (HRA, LTA…) — old regime only"],
      ["pt", "Professional tax u/s 16(iii) — old regime only"],
      ["basic", "Basic + DA (for the 80CCD(2) cap) — blank = gross salary"],
    ], "Standard deduction u/s 16(ia) is applied automatically: ₹75,000 (new) / ₹50,000 (old)."],
    ["2. House property", "गृह सम्पत्ति", [
      ["hpt", "Type", [["none", "None"], ["so", "Self-occupied"], ["lo", "Let-out"]]],
      ["rent", "Annual rent received (let-out)"],
      ["mun", "Municipal tax paid (let-out)"],
      ["hli", "Home-loan interest u/s 24(b)"],
    ], "Let-out: NAV − 30% − interest. Self-occupied interest: up to ₹2,00,000 (old regime only). House-property loss set-off against other heads: up to ₹2,00,000 (old regime); not allowed in the new regime."],
    ["3. Business / profession", "व्यापार / पेशा", [
      ["bt", "Method", [["np", "Regular — net profit"], ["ad", "Presumptive 44AD (business)"], ["ada", "Presumptive 44ADA (profession)"]]],
      ["np", "Net profit (regular) — enter a loss with a minus sign"],
      ["tod", "44AD turnover — digital / bank (6%)"],
      ["toc", "44AD turnover — cash (8%)"],
      ["gr", "44ADA gross receipts (50%)"],
    ], "Presumptive income is computed at the minimum rate; if you declare more, use net profit. A business loss is set off against other income except salary, then against capital gains; the rest is shown as carried forward."],
    ["4. Capital gains", "पूंजीगत लाभ", [
      ["stcg111a", "STCG u/s 111A (listed equity / equity funds, STT) — 20%"],
      ["stcgo", "Other STCG — slab rates"],
      ["ltcg112a", "LTCG u/s 112A (equity) — 12.5% above ₹1.25 lakh"],
      ["ltcg112", "Other LTCG u/s 112 — 12.5%"],
    ], "Enter net gains after setting off capital losses. Rates apply to transfers on or after 23 Jul 2024. The 87A rebate is not available against tax on these special-rate gains."],
    ["5. Other sources", "अन्य स्रोत", [
      ["sbint", "Savings bank interest"], ["fdint", "FD / other interest"], ["div", "Dividends"], ["oth", "Other income"],
    ], ""],
    ["Deductions — Chapter VI-A", "कटौतियाँ (old regime, except 80CCD(2))", [
      ["d80c", "80C / 80CCC / 80CCD(1) — max ₹1.5 lakh"],
      ["d80ccd1b", "80CCD(1B) NPS (own) — max ₹50,000"],
      ["d80ccd2", "80CCD(2) employer NPS — both regimes (cap 14% new / 10% old of basic)"],
      ["d80ds", "80D health insurance — self / family (cap 25k; 50k senior)"],
      ["d80dp", "80D — parents"],
      ["parsen", "Parents are senior citizens?", [["0", "No (cap 25k)"], ["1", "Yes (cap 50k)"]]],
      ["d80e", "80E education-loan interest — no cap"],
      ["d80g", "80G donations — qualifying amount"],
      ["ttauto", "80TTA / 80TTB on interest", [["1", "Apply automatically"], ["0", "Don't apply"]]],
      ["dother", "Other deductions (80DD, 80U, 80GG…)"],
    ], ""],
  ];
  const KEYS = FIELDS.flatMap((s) => s[2].map((f) => f[0]));

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

  function render(root) {
    const form = el("div", { id: "tax-form" },
      FIELDS.map(([title, hindi, fields, note]) => el("section", { class: "tax-card" },
        el("h2", null, title, " ", el("span", { class: "muted" }, hindi)),
        el("div", { class: "tax-grid" }, fields.map(([id, label, opts]) => el("label", { class: "field" },
          el("span", null, label),
          Array.isArray(opts)
            ? el("select", { id: `tx-${id}` }, opts.map(([v, t]) => el("option", { value: v }, t)))
            : el("input", { id: `tx-${id}`, type: "text", inputmode: opts === "text" ? null : "decimal", autocomplete: "off" })))),
        note ? el("p", { class: "muted tax-note" }, note) : null)),
      el("div", { class: "tax-actions noprint" },
        el("button", { class: "btn primary", type: "button", onclick: run }, "गणना करें · Compute tax"),
        el("button", { class: "btn", type: "button", onclick: sample }, "Fill sample"),
        el("button", { class: "btn", type: "button", onclick: reset }, "Reset")));
    const saved = el("section", { class: "tax-card noprint", id: "tax-saved" }, el("h2", null, "Saved computations ", el("span", { class: "muted" }, "सहेजी गई गणनाएँ")), el("div", { id: "tax-slist", class: "muted" }));
    const out = el("div", { id: "tax-out" });
    root.replaceChildren(
      el("h1", { class: "page-title" }, "आयकर गणना · Income Tax Calculator"),
      el("p", { class: "muted" }, "Individuals · Tax Year 2026-27 · old vs new regime, with a printable computation."),
      form, saved, out,
      el("p", { class: "tax-disc" }, el("b", null, "Disclaimer: "), "An estimate for general guidance only, not tax advice. It does not cover every provision (clubbing, brought-forward losses, AMT, agricultural income, relief u/s 89, every condition of each deduction, NRI special rates). Verify with a qualified professional or the Income Tax Department's calculator before filing."));
    // The page is put on screen right after render() returns; fill it in then.
    queueMicrotask(() => {
      if (!root.isConnected) return;
      if (last) fill(last);
      renderSaved();
      if (lastResult) show(lastResult, false);
    });
  }

  const $ = (id) => document.getElementById(`tx-${id}`);
  // Amounts may be typed as "8,75,000" or "₹ 875000"; the name is kept as typed.
  const data = () => Object.fromEntries(KEYS.map((k) => {
    const v = $(k)?.value || "";
    return [k, k === "name" ? v.trim() : v.replace(/[,₹\s]/g, "")];
  }));
  const fill = (d) => KEYS.forEach((k) => { if (d[k] !== undefined && $(k)) $(k).value = d[k]; });

  function run() {
    last = data();
    show(TAX.both(last), true);
  }
  function show(r, scroll) {
    lastResult = r;
    const d = last || {};
    const newBetter = r.nw.total <= r.old.total;
    const ageSel = $("age"), resSel = $("res");
    const out = document.getElementById("tax-out");
    out.innerHTML = `<section class="tax-card" id="tax-result">
      <h2>Computation of Income — Tax Year 2026-27${d.name ? " · " + esc(d.name) : ""}</h2>
      <p class="muted">Individual · ${esc(ageSel?.selectedOptions[0]?.text)} · ${esc(resSel?.selectedOptions[0]?.text)}</p>
      <div class="tax-cmp">
        <div class="tax-reg ${newBetter ? "best" : ""}">New regime (115BAC)<b>${inr(r.nw.total)}</b></div>
        <div class="tax-reg ${!newBetter ? "best" : ""}">Old regime<b>${inr(r.old.total)}</b></div>
      </div>
      <p class="tax-rec">Recommended: ${newBetter ? "New regime" : "Old regime"}${r.nw.total === r.old.total ? " (equal tax)" : " — saves " + inr(Math.abs(r.nw.total - r.old.total))}</p>
      <div class="tax-cmp">${sheet(r.nw, "New Regime (default)")}${sheet(r.old, "Old Regime")}</div>
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

  function sheet(o, title) {
    const row = (l, v, c) => `<tr class="${c || ""}"><td class="${c === "i" ? "ind" : ""}">${l}</td><td class="n">${v === "" ? "" : inr(v)}</td></tr>`;
    let h = `<div><h3>${title}</h3><table class="tax-table">`;
    h += row("1. Income from Salary", "", "h") + row("Gross salary", o.salGross, "i");
    if (o.salEx) h += row("Less: exempt allowances u/s 10", -o.salEx, "i");
    h += row("Less: standard deduction u/s 16(ia)", -o.sd, "i");
    if (o.pt) h += row("Less: professional tax u/s 16(iii)", -o.pt, "i");
    h += row("Income from Salary", o.salary, "t");
    h += row("2. Income from House Property" + (o.hpt === "so" ? " (self-occupied)" : o.hpt === "lo" ? " (let-out)" : ""), "", "h");
    if (o.hpt === "lo") h += row("Net annual value", o.nav, "i") + row("Less: 30% u/s 24(a)", -o.sd30, "i");
    if (o.hpt !== "none") h += row("Less: interest u/s 24(b)", -o.int, "i");
    if (o.hpRaw !== o.hp) h += row("Loss restricted for set-off", o.hp, "i");
    h += row("Income from House Property", o.hp, "t");
    h += row("3. Profits & Gains of Business/Profession" + (o.bt === "ad" ? " (44AD)" : o.bt === "ada" ? " (44ADA)" : ""), o.bus, "t");
    h += row("4. Capital Gains", "", "h") + row("STCG u/s 111A @20%", o.stcgA, "i") + row("Other STCG (slab)", o.stcgO, "i")
      + row("LTCG u/s 112A @12.5%", o.ltA, "i") + row("LTCG u/s 112 @12.5%", o.lt, "i") + row("Capital Gains", o.cg, "t");
    if (o.sA + o.sL + o.sLA < o.stcgA + o.lt + o.ltA) h += row("Special-rate gains left after loss set-off", o.sA + o.sL + o.sLA, "i");
    h += row("5. Income from Other Sources", "", "h") + row("Interest", o.sb + o.fd, "i") + row("Dividends", o.div, "i") + row("Others", o.oth, "i") + row("Income from Other Sources", o.os, "t");
    h += row("Gross Total Income", o.gti, "t");
    if (o.busCF) h += row("Business loss not set off this year (carry forward)", o.busCF, "i");
    if (o.hpCF) h += row("House-property loss not set off this year", o.hpCF, "i");
    h += row("Less: Deductions under Chapter VI-A", "", "h");
    o.dedList.forEach((x) => { h += row(`${x[0]} — ${x[1]}`, x[2], "i"); });
    if (!o.dedList.length) h += row("None", "", "i");
    if (o.ded < o.dedList.reduce((a, x) => a + x[2], 0)) h += row("Restricted to normal income", o.ded, "i");
    h += row("Total Income (rounded u/s 288A)", o.ti, "t") + row("Tax on normal income at slab rates", o.tNormal, "i");
    if (o.tStA) h += row("Tax on STCG 111A @20%", o.tStA, "i");
    if (o.tLtA) h += row("Tax on LTCG 112A @12.5% (above ₹1.25 lakh)", o.tLtA, "i");
    if (o.tLt) h += row("Tax on LTCG 112 @12.5%", o.tLt, "i");
    h += row("Tax on Total Income", o.tax, "t") + row("Less: rebate u/s 87A", -o.rebate, "i")
      + row("Surcharge" + (o.surRate ? ` @${o.surRate * 100}%` + (o.mr ? ` (after marginal relief ${inr(o.mr)})` : "") : ""), o.sur, "i")
      + row("Health & Education Cess @4%", o.cess, "i") + row("Total Tax Liability (rounded u/s 288B)", o.total, "t");
    return h + "</table></div>";
  }

  function sample() {
    fill({ name: "Sample Taxpayer", sal: 1500000, salex: 0, pt: 2500, hpt: "so", hli: 150000, sbint: 12000, fdint: 30000, div: 8000, ltcg112a: 200000, d80c: 150000, d80ds: 25000, d80ccd1b: 50000 });
  }
  function reset() {
    last = null; lastResult = null;
    KEYS.forEach((k) => { const e = $(k); if (e) e.value = e.tagName === "SELECT" ? e.options[0].value : ""; });
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
        el("button", { class: "btn small", type: "button", onclick: () => { last = x.data; fill(x.data); run(); } }, "Open"),
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

  const fname = (ext) => "SKC-Tax-Computation-2026-27" + ($("name").value ? "-" + $("name").value.replace(/[^\w-]+/g, "_") : "") + "." + ext;
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

  window.GGTax = { render, TAX };
})();
