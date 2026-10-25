/* Income Tax Calculator page (tax.html). app.js signs the visitor in with the
 * site's usual login, draws the shared header/footer and then calls
 * TaxApp.mount(view, { h, toast }). The maths lives in tax-core.js.
 */
(() => {
  "use strict";

  const T = window.TaxCore;
  const KEY = { saved: "gg-tax-saved", draft: "gg-tax-draft" };
  const FOOTER = "© 2026 SKC & CO. All rights reserved";

  const store = {
    get(k, fallback = null) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  };

  // [field, label, type?]; type defaults to a rupee amount.
  const SECTIONS = [
    { title: "करदाता · Assessee", open: true, fields: [
      ["assessee", "Name of assessee", "text"],
      ["pan", "PAN (optional)", "pan"],
      ["ageGroup", "Age during FY 2025-26", "age"],
    ] },
    { title: "1. वेतन · Salary", open: true, fields: [
      ["salaryGross", "Gross salary (allowances and perquisites included)"],
      ["basicDA", "Basic + DA (for the HRA and employer-NPS limits)"],
      ["hraReceived", "HRA received"],
      ["rentPaid", "Rent paid in the year"],
      ["metroCity", "Rented home is in Delhi, Mumbai, Kolkata or Chennai", "check"],
      ["exemptAllowances", "Other exempt allowances u/s 10, e.g. LTA (old regime)"],
      ["professionalTax", "Professional tax paid (old regime, max ₹2,500)"],
    ] },
    { title: "2. गृह सम्पत्ति · House property", fields: [
      ["hpSelfInterest", "Home-loan interest, self-occupied (old regime, max ₹2,00,000)"],
      ["hpLetRent", "Let-out: rent received in the year"],
      ["hpLetMunicipalTax", "Let-out: municipal taxes paid"],
      ["hpLetInterest", "Let-out: home-loan interest"],
    ] },
    { title: "3. व्यापार · Business / profession", fields: [
      ["businessIncome", "Net profit (books, or presumptive u/s 44AD / 44ADA)"],
    ] },
    { title: "4. पूँजीगत लाभ · Capital gains", fields: [
      ["stcg111A", "STCG on listed shares / equity funds — s.111A @20%"],
      ["stcgOther", "Other short-term gains (slab rates)"],
      ["ltcg112A", "LTCG on listed shares / equity funds — s.112A @12.5% above ₹1.25 lakh"],
      ["ltcg112", "Other long-term gains — s.112 @12.5%"],
    ] },
    { title: "5. अन्य स्रोत · Other sources", fields: [
      ["savingsInterest", "Savings bank interest"],
      ["depositInterest", "FD / RD / other interest"],
      ["dividends", "Dividends"],
      ["familyPension", "Family pension"],
      ["otherIncome", "Any other income"],
    ] },
    { title: "कटौतियाँ · Deductions (Chapter VI-A)", hint: "The new regime allows only 80CCD(2). 80TTA / 80TTB are applied automatically from the interest above.", fields: [
      ["d80C", "80C / 80CCC / 80CCD(1) — PF, PPF, ELSS, LIC, home-loan principal, tuition (max ₹1.5 lakh)"],
      ["d80CCD1B", "80CCD(1B) — own NPS contribution (max ₹50,000)"],
      ["d80CCD2", "80CCD(2) — employer's NPS contribution"],
      ["d80DSelf", "80D — health insurance: self, spouse, children"],
      ["d80DParents", "80D — health insurance: parents"],
      ["parentsSenior", "Parents are senior citizens", "check"],
      ["d80E", "80E — interest on education loan"],
      ["d80G", "80G — donations (qualifying amount)"],
    ] },
    { title: "कर भुगतान · Taxes paid", fields: [
      ["taxesPaid", "TDS / TCS / advance tax / self-assessment tax"],
    ] },
  ];

  let h, toast, form, out, savedBox, current;

  function mount(view, deps) {
    ({ h, toast } = deps);
    document.body.classList.add("tax-page");
    form = h("form", { class: "tax-form no-print", autocomplete: "off", oninput: update, onchange: update, onsubmit: (e) => e.preventDefault() },
      SECTIONS.map(sectionEl));
    out = h("section", { class: "tax-out", "aria-live": "polite" });
    savedBox = h("section", { class: "tax-saved no-print" });
    view.replaceChildren(
      h("div", { class: "tax-head no-print" },
        h("h1", { class: "page-title" }, "आयकर गणना · Income Tax Computation"),
        h("p", { class: "muted tax-sub" }, `FY ${T.FY} · AY ${T.AY} · Resident individual · Old and new regime compared`)),
      toolbar(),
      h("div", { class: "tax-grid" }, form, h("div", { class: "tax-side" }, out, savedBox)));
    fill(store.get(KEY.draft, {}));
    renderSaved();
  }

  /* ---------- form ---------- */
  function sectionEl(sec) {
    return h("details", { class: "tax-section", open: sec.open || null },
      h("summary", null, sec.title),
      sec.hint ? h("p", { class: "edit-hint" }, sec.hint) : null,
      h("div", { class: "tax-fields" }, sec.fields.map(fieldEl)));
  }

  function fieldEl([name, label, type]) {
    if (type === "check") {
      return h("label", { class: "tax-check" }, h("input", { type: "checkbox", name }), " ", label);
    }
    let input;
    if (type === "age") {
      input = h("select", { name, id: `tx-${name}` },
        Object.entries(T.AGE_GROUPS).map(([v, l]) => h("option", { value: v }, l)));
    } else if (type === "text" || type === "pan") {
      input = h("input", { name, id: `tx-${name}`, type: "text", class: type === "pan" ? "pan-input" : null, maxlength: type === "pan" ? 10 : 80, autocapitalize: type === "pan" ? "characters" : null, spellcheck: "false" });
    } else {
      input = h("input", { name, id: `tx-${name}`, type: "number", min: 0, step: 1, inputmode: "numeric", placeholder: "0" });
    }
    return h("label", { class: "field", for: `tx-${name}` }, label, input);
  }

  function read() {
    const raw = {};
    for (const [k, def] of Object.entries(T.FIELDS)) {
      const el = form.elements[k];
      if (!el) continue;
      raw[k] = typeof def === "boolean" ? el.checked : el.value;
    }
    if (raw.pan) raw.pan = raw.pan.toUpperCase();
    return T.normalize(raw);
  }

  function fill(values) {
    const v = T.normalize(values);
    for (const [k, def] of Object.entries(T.FIELDS)) {
      const el = form.elements[k];
      if (!el) continue;
      if (typeof def === "boolean") el.checked = v[k];
      else if (typeof def === "number") el.value = v[k] ? String(v[k]) : "";
      else el.value = v[k];
    }
    update();
  }

  function update() {
    const inputs = read();
    store.set(KEY.draft, inputs);
    current = T.compare(inputs);
    renderResult();
  }

  /* ---------- result ---------- */
  const rs = (n) => `₹${T.fmt(n)}`;
  const regimeName = (r) => (r === "old" ? "Old regime" : "New regime (s.115BAC)");

  function verdict(cmp) {
    if (!cmp.saving) return "Both regimes give the same tax.";
    return `${cmp.better === "old" ? "Old" : "New"} regime saves ${rs(cmp.saving)}.`;
  }

  function renderResult() {
    const cmp = current;
    const i = cmp.old.inputs;
    const card = (r) => h("div", { class: `tax-card ${cmp.saving && cmp.better === r ? "best" : ""}` },
      h("div", { class: "label" }, regimeName(r)),
      h("div", { class: "tax-amt" }, rs(cmp[r].tax.total)),
      h("div", { class: "muted small" }, `Total income ${rs(cmp[r].totalIncome)}`),
      h("div", { class: "muted small" }, cmp[r].tax.balance < 0 ? `Refund ${rs(-cmp[r].tax.balance)}` : `Balance payable ${rs(cmp[r].tax.balance)}`));
    const notes = [...new Set([...cmp.old.notes.map((n) => `Old regime: ${n}`), ...cmp.new.notes.map((n) => `New regime: ${n}`)])];
    out.replaceChildren(
      h("div", { class: "tax-cards no-print" }, card("old"), card("new")),
      h("p", { class: "tax-verdict no-print" }, verdict(cmp)),
      h("article", { class: "tax-statement", id: "tax-statement" },
        h("header", { class: "stmt-head" },
          h("h2", null, "Computation of Income and Tax"),
          h("p", null, `Financial Year ${T.FY} · Assessment Year ${T.AY}`),
          h("dl", { class: "stmt-meta" },
            meta("Name", i.assessee || "—"),
            meta("PAN", i.pan || "—"),
            meta("Status", "Individual, resident"),
            meta("Age", T.AGE_GROUPS[i.ageGroup]),
            meta("Prepared on", new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })))),
        statementTable(cmp),
        h("p", { class: "stmt-verdict" }, `Lower tax: ${verdict(cmp)}`),
        notes.length ? h("ul", { class: "stmt-notes" }, notes.map((n) => h("li", null, n))) : null,
        h("p", { class: "stmt-disclaimer" }, "Computed under the Income-tax Act, 1961 as amended by the Finance Act, 2025, for a resident individual. Indicative only; it does not cover every provision (e.g. loss carry-forward, clubbing, interest u/s 234A/B/C). Please verify before filing."),
        h("p", { class: "stmt-footer print-only" }, FOOTER)));
  }

  const meta = (k, v) => [h("dt", null, k), h("dd", null, v)];

  function statementTable(cmp) {
    const cell = (v) => h("td", { class: "num" }, v == null ? "" : T.fmt(v));
    const best = (r) => (cmp.saving && cmp.better === r ? " ✓" : "");
    return h("table", { class: "stmt-table" },
      h("thead", null, h("tr", null,
        h("th", null, "Particulars"),
        h("th", { class: "num" }, `Old regime (₹)${best("old")}`),
        h("th", { class: "num" }, `New regime (₹)${best("new")}`))),
      h("tbody", null, T.statementRows(cmp).map((r) =>
        r.kind === "section"
          ? h("tr", { class: "row-section" }, h("th", { colspan: 3, scope: "colgroup" }, r.label))
          : h("tr", { class: `row-${r.kind}` }, h("td", null, r.label), cell(r.old), cell(r.new)))));
  }

  /* ---------- toolbar: print, save, download ---------- */
  function toolbar() {
    const nameIn = h("input", { type: "text", placeholder: "Name this computation", maxlength: 80, "aria-label": "Computation name" });
    const savePanel = h("form", {
      class: "tax-savepanel", hidden: true,
      onsubmit: (e) => { e.preventDefault(); if (save(nameIn.value)) savePanel.hidden = true; },
    }, nameIn, h("button", { class: "btn small primary", type: "submit" }, "Save"), h("button", { class: "btn small ghost", type: "button", onclick: () => { savePanel.hidden = true; } }, "Cancel"));
    const download = h("details", { class: "tax-download" },
      h("summary", { class: "btn" }, "⬇ Download"),
      h("div", { class: "menu-panel" },
        h("button", { class: "btn small block", type: "button", onclick: (e) => { e.currentTarget.closest("details").open = false; downloadPDF(); } }, "PDF document"),
        h("button", { class: "btn small block", type: "button", onclick: (e) => { e.currentTarget.closest("details").open = false; downloadCSV(); } }, "CSV (Excel)")));
    return h("div", { class: "tax-toolbar no-print" },
      h("button", { class: "btn", type: "button", onclick: () => window.print() }, "🖨 Print"),
      h("button", { class: "btn", type: "button", onclick: () => {
        savePanel.hidden = !savePanel.hidden;
        if (!savePanel.hidden) { nameIn.value = defaultName(); nameIn.select(); nameIn.focus(); }
      } }, "💾 Save"),
      download,
      h("button", { class: "btn ghost", type: "button", onclick: () => { if (confirm("Clear all fields?")) fill({}); } }, "Clear"),
      savePanel);
  }

  function defaultName() {
    const d = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    return `${current.old.inputs.assessee || "Computation"} · ${d}`;
  }

  const savedList = () => {
    const l = store.get(KEY.saved, []);
    return Array.isArray(l) ? l : [];
  };

  function save(name) {
    name = String(name || "").trim();
    if (!name) { toast("Please give the computation a name.", "error"); return false; }
    const list = savedList();
    const same = list.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (same && !confirm(`“${same.name}” already exists. Replace it?`)) return false;
    const entry = { id: same?.id || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, savedAt: new Date().toISOString(), inputs: read() };
    const next = same ? list.map((x) => (x === same ? entry : x)) : [entry, ...list];
    if (!store.set(KEY.saved, next)) { toast("Could not save — browser storage is full or blocked.", "error"); return false; }
    renderSaved();
    toast(`Saved “${name}” in this browser.`);
    return true;
  }

  function renderSaved() {
    const list = savedList();
    savedBox.replaceChildren(
      h("h2", { class: "section-title" }, `सहेजी गई गणनाएँ · Saved computations (${list.length})`),
      list.length
        ? h("ul", { class: "saved-list" }, list.map((x) => h("li", null,
          h("div", { class: "saved-name" }, x.name,
            h("small", { class: "muted" }, ` ${new Date(x.savedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`)),
          h("div", { class: "saved-actions" },
            h("button", { class: "btn small", type: "button", onclick: () => { fill(x.inputs); window.scrollTo({ top: 0, behavior: "smooth" }); toast(`Opened “${x.name}”.`); } }, "Open"),
            h("button", { class: "btn small danger", type: "button", onclick: () => remove(x) }, "Delete")))))
        : h("p", { class: "muted small" }, "Nothing saved yet. Use 💾 Save to keep a computation in this browser."));
  }

  function remove(x) {
    if (!confirm(`Delete “${x.name}”?`)) return;
    store.set(KEY.saved, savedList().filter((y) => y.id !== x.id));
    renderSaved();
    toast("Deleted.");
  }

  function fileBase() {
    const i = current.old.inputs;
    const who = (i.assessee || "computation").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "computation";
    return `Tax-Computation-AY${T.AY}-${who}`;
  }

  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function downloadCSV() {
    saveBlob(new Blob([T.toCSV(current)], { type: "text/csv;charset=utf-8" }), `${fileBase()}.csv`);
  }

  // The PDF's built-in Helvetica only covers Latin-1.
  const latin = (s) => String(s ?? "")
    .replace(/₹/g, "Rs. ").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, "-")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "?");

  function downloadPDF() {
    const JsPDF = window.jspdf?.jsPDF;
    if (!JsPDF) { toast("PDF library did not load — try Print → Save as PDF.", "error"); return; }
    const cmp = current, i = cmp.old.inputs;
    const doc = new JsPDF({ unit: "pt", format: "a4" });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    const M = 40, colOld = W - M - 110, colNew = W - M;
    let y = M;

    const pageFooter = () => {
      doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(120);
      doc.text(latin(FOOTER), M, H - 24);
      doc.text(`Page ${doc.getNumberOfPages()}`, W - M, H - 24, { align: "right" });
      doc.setTextColor(0);
    };
    const ensure = (need, head = true) => { if (y + need > H - 50) { pageFooter(); doc.addPage(); y = M; if (head) tableHead(); } };
    const tableHead = () => {
      doc.setFillColor(244, 234, 217).rect(M, y - 11, W - 2 * M, 18, "F");
      doc.setFont("helvetica", "bold").setFontSize(9.5);
      doc.text("Particulars", M + 4, y + 2);
      doc.text(latin(`Old regime (Rs.)${cmp.saving && cmp.better === "old" ? " *" : ""}`), colOld, y + 2, { align: "right" });
      doc.text(latin(`New regime (Rs.)${cmp.saving && cmp.better === "new" ? " *" : ""}`), colNew - 4, y + 2, { align: "right" });
      y += 20;
    };

    doc.setFont("helvetica", "bold").setFontSize(15);
    doc.text("Computation of Income and Tax", W / 2, y, { align: "center" });
    y += 18;
    doc.setFont("helvetica", "normal").setFontSize(10);
    doc.text(`Financial Year ${T.FY}  |  Assessment Year ${T.AY}`, W / 2, y, { align: "center" });
    y += 24;
    const metaRows = [
      ["Name", i.assessee || "-"], ["PAN", i.pan || "-"], ["Status", "Individual, resident"],
      ["Age", T.AGE_GROUPS[i.ageGroup]], ["Prepared on", new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })],
    ];
    for (const [k, v] of metaRows) {
      doc.setFont("helvetica", "bold").text(`${k}:`, M, y);
      doc.setFont("helvetica", "normal").text(latin(v), M + 75, y);
      y += 14;
    }
    y += 10;
    tableHead();

    for (const r of T.statementRows(cmp)) {
      const label = doc.splitTextToSize(latin(r.label), colOld - M - 100);
      const lh = 12.5 * label.length + (r.kind === "section" ? 6 : 0);
      ensure(lh + 4);
      if (r.kind === "section") {
        y += 6;
        doc.setFont("helvetica", "bold").setFontSize(10).text(label, M + 4, y);
      } else {
        const bold = r.kind === "total" || r.kind === "grand";
        if (r.kind === "grand") doc.setFillColor(251, 230, 207).rect(M, y - 10, W - 2 * M, 12.5 * label.length + 4, "F");
        doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(r.kind === "grand" ? 10 : 9.5);
        doc.text(label, M + (r.kind === "sub" ? 16 : 4), y);
        doc.text(T.fmt(r.old), colOld, y, { align: "right" });
        doc.text(T.fmt(r.new), colNew - 4, y, { align: "right" });
        if (r.kind === "total") doc.setDrawColor(200).line(colOld - 90, y - 10, colNew, y - 10);
      }
      y += lh;
    }

    const notes = [...new Set([...cmp.old.notes.map((n) => `Old regime: ${n}`), ...cmp.new.notes.map((n) => `New regime: ${n}`)])];
    const paras = [
      { text: `Lower tax${cmp.saving ? " (*)" : ""}: ${verdict(cmp)}`, bold: true },
      ...notes.map((n) => ({ text: `* ${n}` })),
      { text: "Computed under the Income-tax Act, 1961 as amended by the Finance Act, 2025, for a resident individual. Indicative only; it does not cover every provision (e.g. loss carry-forward, clubbing, interest u/s 234A/B/C). Please verify before filing.", small: true },
    ];
    y += 8;
    for (const p of paras) {
      doc.setFont("helvetica", p.bold ? "bold" : "normal").setFontSize(p.small ? 8 : 9.5);
      const lines = doc.splitTextToSize(latin(p.text), W - 2 * M);
      ensure(lines.length * 12 + 6, false);
      doc.text(lines, M, y);
      y += lines.length * 12 + 6;
    }
    pageFooter();
    doc.save(`${fileBase()}.pdf`);
  }

  window.TaxApp = { mount };
})();
