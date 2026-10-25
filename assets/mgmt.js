/* Management Services & Financial Analysis (#/management) — inside Gita Gyan.
 * Five working tools for families, proprietors, firms and companies. Window.GGMgmt lets Saarthi run them.
 */
(() => {
  "use strict";
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
  const n = (v) => { v = +String(v ?? "").replace(/[,₹\s%]/g, ""); return isFinite(v) ? v : 0; };
  const has = (v) => String(v ?? "").trim() !== "";
  const inr = (x) => (isFinite(x) ? (x < 0 ? "−" : "") + "₹" + Math.abs(Math.round(x)).toLocaleString("en-IN") : "—");
  const pct = (x, d = 1) => (isFinite(x) ? `${(x * 100).toFixed(d)}%` : "—");
  const times = (x, d = 2) => (isFinite(x) ? `${x.toFixed(d)}×` : "—");
  const days = (x) => (isFinite(x) ? `${Math.round(x)} days` : "—");
  const yrs = (x) => (isFinite(x) ? `${x.toFixed(1)} years` : "not within the life");
  const div = (a, b) => (b ? a / b : NaN);

  // IRR by bisection on the NPV of the cash flows (flows[0] is the outlay, negative).
  const npvAt = (r, flows) => flows.reduce((s, c, t) => s + c / Math.pow(1 + r, t), 0);
  function irr(flows) {
    let lo = -0.99, hi = 10;
    if (npvAt(lo, flows) * npvAt(hi, flows) > 0) return NaN;
    for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (npvAt(lo, flows) * npvAt(mid, flows) <= 0) hi = mid; else lo = mid; }
    return (lo + hi) / 2;
  }
  const emi = (p, ratePa, years) => { const r = ratePa / 12, m = Math.round(years * 12); if (!p || !m) return 0; return r ? p * r * Math.pow(1 + r, m) / (Math.pow(1 + r, m) - 1) : p / m; };

  const TOOLS = [
    {
      id: "capital", icon: "📊", title: "Capital Analysis",
      about: "How much capital is in the business, where it comes from (own funds or loans), and the return being earned on it.",
      fields: [["equity", "Share capital / owner's or partners' capital"], ["reserves", "Reserves & surplus / accumulated profit"], ["loans_long", "Long-term loans"], ["loans_short", "Short-term loans, OD / CC"],
        ["cash", "Cash, bank balance and liquid investments"], ["ebit", "Profit before interest and tax (EBIT)"], ["interest", "Interest paid"], ["tax", "Tax paid / provided"], ["sales", "Sales / revenue (optional)"]],
      sample: { equity: 5000000, reserves: 8500000, loans_long: 6000000, loans_short: 4000000, cash: 1500000, ebit: 4200000, interest: 1100000, tax: 800000, sales: 36000000 },
      run(d) {
        const nw = n(d.equity) + n(d.reserves), debt = n(d.loans_long) + n(d.loans_short), ce = nw + debt, ebit = n(d.ebit), int = n(d.interest);
        const pat = ebit - int - n(d.tax), roce = div(ebit, ce), roe = div(pat, nw), cod = div(int, debt), de = div(debt, nw), cov = div(ebit, int);
        const rows = [["Net worth (own funds)", inr(nw)], ["Total borrowings", inr(debt)], ["Capital employed", inr(ce)], ["Net debt (borrowings − cash)", inr(debt - n(d.cash))],
          ["Own funds share of capital", pct(div(nw, ce))], ["Debt / equity", times(de)], ["Net debt / equity", times(div(debt - n(d.cash), nw))],
          ["Profit after tax", inr(pat)], ["Return on capital employed (ROCE)", pct(roce)], ["Return on equity (ROE)", pct(roe)], ["Average cost of borrowing", pct(cod)],
          ["Interest coverage (EBIT ÷ interest)", times(cov)]];
        if (has(d.sales)) rows.push(["Capital turnover (sales ÷ capital employed)", times(div(n(d.sales), ce))], ["EBIT margin", pct(div(ebit, n(d.sales)))]);
        const notes = [];
        if (nw <= 0) notes.push("⚠ Net worth is negative or nil — losses have eaten the capital; lenders will see this as high risk.");
        if (de > 2) notes.push(`⚠ Debt is ${de.toFixed(1)} times own funds — high. Most banks are comfortable below 2× (lower for trading businesses).`);
        else if (isFinite(de)) notes.push(`Debt / equity of ${de.toFixed(2)}× is ${de < 1 ? "comfortable" : "moderate"}.`);
        if (isFinite(cov)) notes.push(cov < 1.5 ? `⚠ Profit covers interest only ${cov.toFixed(1)} times — a small dip in profit could make interest hard to pay.` : cov < 3 ? `Interest coverage of ${cov.toFixed(1)}× is adequate but worth watching.` : `Interest coverage of ${cov.toFixed(1)}× is healthy.`);
        if (isFinite(roce) && isFinite(cod) && debt) notes.push(roce > cod ? `ROCE (${pct(roce)}) is above the cost of borrowing (${pct(cod)}), so borrowed money is earning more than it costs — leverage is helping.` : `⚠ ROCE (${pct(roce)}) is below the cost of borrowing (${pct(cod)}) — borrowed money is costing more than it earns. Reduce costly debt or improve returns.`);
        if (isFinite(roe)) notes.push(roe < 0.08 ? `ROE of ${pct(roe)} is below what a fixed deposit earns — the owners' money could work harder.` : `ROE of ${pct(roe)} — compare it with the owners' alternatives (FDs ~7%, equity funds 10–12% long-term).`);
        return { rows, notes };
      },
    },
    {
      id: "business", icon: "🩺", title: "Business Analysis",
      about: "A full health check of the business — sales, profit, expenses, margins, working capital and cash cycle — to find weak points and ways to improve.",
      fields: [["sales", "Sales / revenue this year"], ["prev_sales", "Sales last year (optional)"], ["cogs", "Cost of goods sold / direct costs"], ["opex", "Other expenses (excl. depreciation and interest)"],
        ["depreciation", "Depreciation"], ["interest", "Interest"], ["tax", "Tax"], ["receivables", "Trade receivables (debtors)"], ["inventory", "Inventory (stock)"], ["payables", "Trade payables (creditors)"],
        ["current_assets", "Total current assets"], ["current_liabilities", "Total current liabilities"]],
      sample: { sales: 36000000, prev_sales: 31000000, cogs: 25200000, opex: 5600000, depreciation: 700000, interest: 1100000, tax: 800000, receivables: 6900000, inventory: 5200000, payables: 3100000, current_assets: 14500000, current_liabilities: 8900000 },
      run(d) {
        const s = n(d.sales), cogs = n(d.cogs), gp = s - cogs, ebitda = gp - n(d.opex), ebit = ebitda - n(d.depreciation), pbt = ebit - n(d.interest), pat = pbt - n(d.tax);
        const dd = div(n(d.receivables), s) * 365, id = div(n(d.inventory), cogs) * 365, cd = div(n(d.payables), cogs) * 365, ccc = (dd || 0) + (id || 0) - (cd || 0);
        const cr = div(n(d.current_assets), n(d.current_liabilities)), qr = div(n(d.current_assets) - n(d.inventory), n(d.current_liabilities));
        const fixed = n(d.opex) + n(d.depreciation) + n(d.interest), cm = div(gp, s), be = div(fixed, cm);
        const rows = [["Gross profit", `${inr(gp)} (${pct(div(gp, s))})`], ["EBITDA", `${inr(ebitda)} (${pct(div(ebitda, s))})`], ["Operating profit (EBIT)", `${inr(ebit)} (${pct(div(ebit, s))})`],
          ["Profit before tax", inr(pbt)], ["Net profit", `${inr(pat)} (${pct(div(pat, s))})`]];
        if (has(d.prev_sales)) rows.push(["Sales growth", pct(div(s - n(d.prev_sales), n(d.prev_sales)))]);
        rows.push(["Debtor days", days(dd)], ["Inventory days", days(id)], ["Creditor days", days(cd)], ["Cash conversion cycle", days(ccc)],
          ["Current ratio", times(cr)], ["Quick ratio", times(qr)], ["Break-even sales", inr(be)], ["Margin of safety", pct(div(s - be, s))]);
        const notes = [];
        if (pat < 0) notes.push("⚠ The business is making a loss — start with the break-even figure: sales must reach it, or fixed costs come down.");
        if (isFinite(dd) && dd > 60) notes.push(`⚠ Customers take ${Math.round(dd)} days to pay. Bringing that down to 45 days would free about ${inr(n(d.receivables) - s / 365 * 45)} of cash.`);
        if (isFinite(id) && id > 90) notes.push(`Stock sits for about ${Math.round(id)} days — check for slow-moving or dead stock.`);
        if (isFinite(cd) && isFinite(dd) && cd < dd - 30) notes.push(`You pay suppliers in ${Math.round(cd)} days but collect in ${Math.round(dd)} — you're financing your customers.`);
        if (isFinite(cr)) notes.push(cr < 1 ? "⚠ Current liabilities exceed current assets — a liquidity squeeze is likely." : cr < 1.33 ? `Current ratio ${cr.toFixed(2)} — banks usually look for at least 1.33 for working-capital limits.` : `Current ratio ${cr.toFixed(2)} is comfortable.`);
        if (isFinite(be) && s) notes.push(s > be ? `Sales are ${pct(div(s - be, s))} above break-even — that's the cushion before a loss.` : `⚠ Sales are below break-even by ${inr(be - s)}.`);
        if (has(d.prev_sales) && n(d.prev_sales)) { const g = div(s - n(d.prev_sales), n(d.prev_sales)); notes.push(g < 0.06 ? `Sales grew ${pct(g)} — below inflation, so volumes may actually be falling.` : `Sales grew ${pct(g)}.`); }
        return { rows, notes };
      },
    },
    {
      id: "capex", icon: "🏗️", title: "Planning of Capital Expenditure",
      about: "Planning big investments such as machinery, buildings or expansion — the cost, how it is funded, how long it takes to pay back and whether it creates value.",
      fields: [["cost", "Investment cost"], ["life", "Useful life (years)"], ["salvage", "Value left at the end (optional)"], ["inflow", "Extra net cash a year — profit + depreciation, or savings"],
        ["growth", "Yearly growth in that cash (%)"], ["rate", "Required return / cost of capital (%)"], ["loan_pct", "Part funded by loan (%)"], ["loan_rate", "Loan interest rate (%)"], ["loan_years", "Loan tenure (years)"]],
      sample: { cost: 5000000, life: 8, salvage: 500000, inflow: 1100000, growth: 4, rate: 12, loan_pct: 70, loan_rate: 9.5, loan_years: 5 },
      run(d) {
        const cost = n(d.cost), life = Math.max(1, Math.min(40, Math.round(n(d.life) || 1))), g = n(d.growth) / 100, r = n(d.rate) / 100;
        const flows = [-cost], table = [];
        let cum = -cost, dcum = -cost, pay = NaN, dpay = NaN;
        for (let y = 1; y <= life; y++) {
          const c = n(d.inflow) * Math.pow(1 + g, y - 1) + (y === life ? n(d.salvage) : 0), dc = c / Math.pow(1 + r, y);
          flows.push(c);
          if (isNaN(pay) && cum + c >= 0) pay = y - 1 + (-cum) / c;
          if (isNaN(dpay) && dcum + dc >= 0) dpay = y - 1 + (-dcum) / dc;
          cum += c; dcum += dc;
          table.push([y, c, dc, cum]);
        }
        const npv = npvAt(r, flows), i = irr(flows), pi = div(npv + cost, cost);
        const loan = cost * Math.min(100, n(d.loan_pct)) / 100, e = emi(loan, n(d.loan_rate) / 100, n(d.loan_years)), dscr = div(n(d.inflow), e * 12);
        const rows = [["Payback period", yrs(pay)], ["Discounted payback", yrs(dpay)], [`Net present value at ${pct(r)}`, inr(npv)], ["Internal rate of return (IRR)", pct(i)], ["Profitability index", times(pi)]];
        if (loan) rows.push(["Loan amount", inr(loan)], ["Monthly EMI", inr(e)], ["Own contribution", inr(cost - loan)], ["Debt service cover — year 1 (DSCR)", times(dscr)]);
        const notes = [];
        notes.push(npv >= 0 ? `✔ NPV is positive (${inr(npv)}): at a ${pct(r)} required return the investment adds value.` : `⚠ NPV is negative (${inr(npv)}): it doesn't earn the ${pct(r)} you require. Reduce the cost, raise the benefit or rethink.`);
        if (isFinite(i)) notes.push(`IRR of ${pct(i)} — the return the project earns on its own. ${loan && i < n(d.loan_rate) / 100 ? "⚠ That's below the loan rate." : ""}`);
        if (loan && isFinite(dscr)) notes.push(Math.round(dscr * 100) / 100 < 1.25 ? `⚠ Year-1 cash covers the EMIs only ${dscr.toFixed(2)} times — banks usually want 1.25–1.5×. A longer tenure or more own money would help.` : `Year-1 DSCR of ${dscr.toFixed(2)}× should satisfy most lenders.`);
        if (isNaN(pay)) notes.push("⚠ The investment doesn't pay back within its life.");
        return { rows, notes, table: { head: ["Year", "Cash inflow", "Present value", "Cumulative"], rows: table.map(([y, c, dc, cu]) => [y, inr(c), inr(dc), inr(cu)]) } };
      },
    },
    {
      id: "goals", icon: "🎯", title: "Financial Goals",
      about: "Setting short- and long-term money goals for the family or the business — what they will cost, and how much to put aside every month to get there.",
      fields: [["goal", "Goal (e.g. child's education, new branch)", "text"], ["cost_today", "What it costs today"], ["years", "Years to the goal"], ["inflation", "Expected inflation for this goal (%)"],
        ["return", "Expected return on investments (%)"], ["saved", "Already saved for it"], ["stepup", "Increase in monthly saving each year (%)"]],
      sample: { goal: "Higher education", cost_today: 2500000, years: 12, inflation: 8, return: 11, saved: 300000, stepup: 10 },
      run(d) {
        const yrsN = Math.max(0, Math.min(50, n(d.years))), months = Math.round(yrsN * 12), R = n(d.return) / 100, rm = Math.pow(1 + R, 1 / 12) - 1, step = n(d.stepup) / 100;
        const future = n(d.cost_today) * Math.pow(1 + n(d.inflation) / 100, yrsN), savedFV = n(d.saved) * Math.pow(1 + R, yrsN), gap = Math.max(0, future - savedFV);
        // Value at the goal of saving ₹1 a month, stepped up once a year, invested at the start of each month.
        let unit = 0;
        for (let m = 0; m < months; m++) unit += Math.pow(1 + step, Math.floor(m / 12)) * Math.pow(1 + rm, months - m);
        const sip = gap && unit ? gap / unit : 0, lump = gap / Math.pow(1 + R, yrsN);
        let paid = 0;
        for (let m = 0; m < months; m++) paid += sip * Math.pow(1 + step, Math.floor(m / 12));
        const rows = [["Cost when you need it", inr(future)], ["What your savings will grow to", inr(savedFV)], ["Still to build", inr(gap)],
          [`Monthly saving needed${step ? ` (rising ${pct(step, 0)} a year)` : ""}`, inr(sip)], ["…or one-time investment today", inr(lump)], ["Total you'll put in", inr(paid + n(d.saved))], ["Growth earned on it", inr(future - paid - n(d.saved))]];
        const notes = [];
        if (!gap) notes.push("✔ Your existing savings should already cover this goal at the assumed return.");
        else notes.push(`Save about ${inr(sip)} a month${step ? `, raising it ${pct(step, 0)} each year,` : ""} for ${yrsN} years to reach ${inr(future)}.`);
        if (yrsN <= 3) notes.push("For goals within three years, prefer safe options (FDs, short-term debt funds) — equity can fall just when you need the money.");
        else if (R > 0.12) notes.push(`A ${pct(R, 0)} return assumption is optimistic; check the plan at 9–10% too.`);
        notes.push("Review the plan every year and when income or the goal changes.");
        return { rows, notes };
      },
    },
    {
      id: "efficiency", icon: "💡", title: "Money Efficiency Planning",
      about: "Making every rupee work — spotting idle funds, costly loans, slow collections and avoidable spending — and what fixing them is worth a year.",
      fields: [["idle_cash", "Cash lying idle in current / savings accounts"], ["idle_rate", "What it earns now (%)"], ["alt_rate", "What it could earn — sweep FD / liquid fund (%)"],
        ["loan", "Costliest loan outstanding"], ["loan_rate", "Its interest rate (%)"], ["refi_rate", "Rate available on refinancing (%)"],
        ["sales", "Annual sales (businesses)"], ["receivables", "Money owed by customers"], ["target_days", "Target collection period (days)"],
        ["expenses", "Monthly running expenses"], ["cut_pct", "Expenses that could be cut (%)"]],
      sample: { idle_cash: 1200000, idle_rate: 2.7, alt_rate: 6.8, loan: 2500000, loan_rate: 14, refi_rate: 10.5, sales: 36000000, receivables: 6900000, target_days: 45, expenses: 450000, cut_pct: 5 },
      run(d) {
        const idle = n(d.idle_cash), loan = n(d.loan), lr = n(d.loan_rate) / 100, ar = n(d.alt_rate) / 100, ir = n(d.idle_rate) / 100;
        const prepay = Math.min(idle, loan), prepaySave = prepay * Math.max(0, lr - ar) + prepay * Math.max(0, ar - ir);
        const parkSave = idle * Math.max(0, ar - ir);
        const usePrepay = loan && lr > ar && prepay > 0;
        const idleBenefit = usePrepay ? prepaySave + (idle - prepay) * Math.max(0, ar - ir) : parkSave;
        const refiBase = loan - (usePrepay ? prepay : 0), refi = has(d.refi_rate) ? refiBase * Math.max(0, lr - n(d.refi_rate) / 100) : 0;
        const curDays = div(n(d.receivables), n(d.sales)) * 365, freed = n(d.sales) && has(d.target_days) ? Math.max(0, n(d.receivables) - n(d.sales) / 365 * n(d.target_days)) : 0;
        const freedValue = freed * (lr || ar);
        const cuts = n(d.expenses) * 12 * n(d.cut_pct) / 100;
        const total = idleBenefit + refi + freedValue + cuts;
        const rows = [[usePrepay ? `Use idle cash to prepay ${inr(prepay)} of the loan` : "Move idle cash to a sweep FD / liquid fund", `${inr(idleBenefit)} a year`]];
        if (refi) rows.push([`Refinance the remaining ${inr(refiBase)} at ${pct(n(d.refi_rate) / 100)}`, `${inr(refi)} a year`]);
        if (n(d.sales)) rows.push(["Current collection period", days(curDays)], [`Cash freed by collecting in ${n(d.target_days)} days`, inr(freed)], ["Interest value of that cash", `${inr(freedValue)} a year`]);
        if (cuts) rows.push([`Cutting ${n(d.cut_pct)}% of running expenses`, `${inr(cuts)} a year`]);
        rows.push(["Total yearly benefit", inr(total)]);
        const notes = [];
        if (usePrepay) notes.push(`Paying down a ${pct(lr)} loan with cash earning ${pct(ir)} is the surest "return" available — keep a safety buffer of 2–3 months' expenses first.`);
        else if (idle) notes.push(`Idle cash earning ${pct(ir)} loses value to inflation; an auto-sweep FD keeps it available while earning more.`);
        if (freed > 0) notes.push(`Faster collection releases ${inr(freed)} — offer small early-payment discounts, invoice promptly and follow up on due dates.`);
        if (refi) notes.push("Check processing fees and prepayment charges before refinancing.");
        notes.push("Small leaks add up: review bank charges, unused subscriptions and insurance overlaps once a year.");
        return { rows, notes };
      },
    },
  ];
  const byId = Object.fromEntries(TOOLS.map((t) => [t.id, t]));
  const inputs = {};    // per tool, kept while moving around the site
  const results = {};

  function contactBlock() {
    const c = window.GG?.contact?.() || {};
    const email = String(c.email || "").trim(), phone = String(c.phone || "").trim();
    return el("p", { class: "mg-contact" },
      email ? el("a", { class: "btn small", href: `mailto:${email}?subject=${encodeURIComponent("Management services enquiry")}` }, "✉ Email SKC & CO.") : null,
      phone ? el("a", { class: "btn small", href: `tel:${phone.replace(/[^\d+]/g, "")}` }, `📞 ${phone}`) : null,
      el("button", { class: "btn small", type: "button", onclick: () => window.GG?.askSaarthi?.("I'd like help with SKC & CO.'s management services — where should I start?") }, "🙏 Ask Saarthi"),
      !email && !phone ? el("span", { class: "muted" }, " Contact details will be added here soon.") : null);
  }

  function render(root, toolId) {
    const t = byId[toolId];
    if (!t) {
      root.replaceChildren(
        el("h1", { class: "page-title" }, "Management Services & Financial Analysis"),
        el("p", null, "SKC & CO. helps families, proprietors, firms and companies understand their numbers and make better money decisions — from capital and profitability to long-term investment and everyday efficiency. Each service below has a free working tool: enter your figures for an instant analysis, then talk to us for a full review."),
        el("div", { class: "service-grid" }, TOOLS.map((x) => el("a", { class: "chapter-card service-card", href: `#/management/${x.id}` },
          el("span", { class: "service-icon", "aria-hidden": "true" }, x.icon), el("span", { class: "cc-sa" }, x.title), el("span", { class: "cc-en" }, x.about)))),
        contactBlock(),
        el("p", { class: "tax-disc" }, "The tools give general estimates from the figures you enter — not professional advice. Talk to SKC & CO. before major decisions."));
      return;
    }
    const d = inputs[t.id] || {};
    const form = el("form", { class: "tax-card noprint", onsubmit: (e) => { e.preventDefault(); compute(); } },
      el("div", { class: "tax-grid" }, t.fields.map(([k, label, type]) => el("label", { class: "field" }, el("span", null, label),
        el("input", { id: `mg-${k}`, type: "text", inputmode: type === "text" ? null : "decimal", autocomplete: "off", value: d[k] ?? "" })))),
      el("p", { class: "tax-actions" },
        el("button", { class: "btn primary", type: "submit" }, "Analyse"),
        el("button", { class: "btn", type: "button", onclick: () => { inputs[t.id] = { ...t.sample }; t.fields.forEach(([k]) => { document.getElementById(`mg-${k}`).value = t.sample[k] ?? ""; }); } }, "Fill sample"),
        el("button", { class: "btn", type: "button", onclick: () => { inputs[t.id] = {}; delete results[t.id]; render(root, t.id); } }, "Reset")));
    const out = el("div", { id: "mg-out" });
    root.replaceChildren(
      el("h1", { class: "page-title" }, `${t.icon} ${t.title}`),
      el("p", { class: "muted" }, t.about),
      form, out, contactBlock(),
      el("p", { class: "tax-disc" }, "A general estimate from the figures you enter — not professional advice. Amounts in ₹; percentages as plain numbers (12 for 12%)."));
    const compute = () => {
      inputs[t.id] = Object.fromEntries(t.fields.map(([k]) => [k, document.getElementById(`mg-${k}`).value.trim()]));
      results[t.id] = t.run(inputs[t.id]);
      showResult(t, out);
      out.scrollIntoView({ behavior: "smooth" });
    };
    if (results[t.id]) showResult(t, out);
  }
  function showResult(t, out) {
    const r = results[t.id];
    out.replaceChildren(el("section", { class: "tax-card", id: "mg-result" },
      el("h2", null, `${t.title} — results${inputs[t.id]?.goal ? " · " + inputs[t.id].goal : ""}`),
      el("table", { class: "tax-table" }, r.rows.map(([l, v]) => el("tr", null, el("td", null, l), el("td", { class: "n" }, v)))),
      el("h3", null, "What it means"), el("ul", { class: "bk-notes" }, r.notes.filter(Boolean).map((x) => el("li", null, x))),
      r.table ? el("div", { class: "bk-tw" }, el("table", { class: "tax-table" }, el("thead", null, el("tr", null, r.table.head.map((h, i) => el("th", { class: i ? "n" : "" }, h)))),
        el("tbody", null, r.table.rows.map((row) => el("tr", null, row.map((c, i) => el("td", { class: i ? "n" : "" }, c))))))) : null,
      el("p", { class: "tax-actions noprint" },
        el("button", { class: "btn primary", type: "button", onclick: () => window.print() }, "Print / save as PDF"),
        el("button", { class: "btn", type: "button", onclick: () => window.GG?.askSaarthi?.(`Explain my ${t.title} results on the Management Services page and what I should do next.`) }, "🙏 Ask Saarthi about this"))));
  }

  /* ---------- for Saarthi ---------- */
  function run(tool, d, show) {
    const t = byId[tool];
    if (!t) return { error: `Unknown tool. Use one of: ${TOOLS.map((x) => x.id).join(", ")}.` };
    const clean = Object.fromEntries(t.fields.map(([k]) => [k, d[k] == null ? "" : String(d[k])]));
    inputs[t.id] = clean; results[t.id] = t.run(clean);
    if (show) { const target = `#/management/${t.id}`; if (location.hash !== target) location.hash = target; else window.GG?.rerender?.(); }
    return { tool: t.title, results: Object.fromEntries(results[t.id].rows), observations: results[t.id].notes.filter(Boolean), shown_on_page: !!show };
  }
  const read = (tool) => (byId[tool] && results[tool] ? { tool: byId[tool].title, inputs: inputs[tool], results: Object.fromEntries(results[tool].rows), observations: results[tool].notes } : { empty: true });
  const list = () => TOOLS.map((t) => ({ id: t.id, title: t.title, about: t.about, inputs: t.fields.map(([k, l]) => `${k}: ${l}`) }));

  window.GGMgmt = { render, run, read, list, TOOLS };
})();
