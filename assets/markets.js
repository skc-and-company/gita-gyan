/* Bihar Tenders (#/tenders) and Capital Market Scanner (#/scanner) — inside Gita Gyan.
 * Both read a data file in data/ (tenders.json, scanner.json) that is refreshed outside the site and
 * uploaded by the admin; the pages warn when it is out of date. Window.GGMarkets also answers Saarthi.
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
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const num = (v, d = 1) => (v == null || !isFinite(v) ? "n/a" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: d }));
  const say = (msg, kind) => (window.GG?.toast ? window.GG.toast(msg, kind) : alert(msg));
  const ADMIN = document.body.dataset.mode === "admin";
  const ageDays = (iso) => { const t = Date.parse(iso); return isFinite(t) ? (Date.now() - t) / 864e5 : Infinity; };
  const saveBlob = (blob, name) => { const a = el("a", { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000); };
  const csv = (rows) => "﻿" + rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");

  const cache = {};
  async function load(name) {
    if (cache[name]) return cache[name];
    const r = await fetch(`data/${name}.json`, { cache: "no-cache" });
    if (!r.ok) throw new Error(`data/${name}.json: ${r.status}`);
    return (cache[name] = await r.json());
  }

  // Admin: replace a data file with a newer one (checked first), committed through the admin's GitHub token.
  function uploadButton(name, check) {
    if (!ADMIN) return null;
    const input = el("input", { type: "file", accept: ".json,application/json", hidden: true, onchange: async (e) => {
      const f = e.target.files[0]; e.target.value = "";
      if (!f) return;
      let d;
      try { d = JSON.parse(await f.text()); } catch { say("That file isn't valid JSON.", "error"); return; }
      const problem = check(d);
      if (problem) { say(`Not uploaded — ${problem}`, "error"); return; }
      if (!confirm(`Replace data/${name}.json on the live site with ${f.name}?`)) return;
      try {
        await window.GG.adminPutFile(`data/${name}.json`, JSON.stringify(d, null, 1) + "\n", `Update ${name} data (${new Date().toLocaleString()})`);
        cache[name] = d; say("✓ Uploaded. The site updates in about a minute."); window.GG.rerender();
      } catch (err) { say(`Upload failed — ${err.message}`, "error"); }
    } });
    return el("span", null, input, el("button", { class: "btn small", type: "button", onclick: () => input.click() }, `⬆ Upload new ${name}.json`));
  }
  function staleNote(iso, days, what) {
    const a = ageDays(iso);
    if (a <= days) return null;
    return el("p", { class: "bk-warn" }, `⚠ This ${what} data is ${isFinite(a) ? Math.floor(a) + " days" : "of unknown age and may be"} old. ${ADMIN ? "Upload a fresh file with the button above." : "It is refreshed by SKC & CO.; check the official source before acting."}`);
  }

  /* ================= Bihar Tenders ================= */
  const T = { view: "service", q: "", dep: "", min: "", sort: "closing", dir: 1 };
  const live = (t) => (t.closing_ms || 0) > Date.now();
  const isNew = (t) => live(t) && (t.published_ms ? t.published_ms >= Date.now() - 864e5 : !!t.new_today);
  const soon = (t) => live(t) && t.closing_ms - Date.now() < 3 * 864e5;
  const left = (t) => {
    const ms = t.closing_ms - Date.now();
    if (ms <= 0) return "closed";
    const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5);
    return d ? `${d} d ${h} h` : `${h} h ${Math.floor(ms % 36e5 / 6e4)} m`;
  };
  const TVIEWS = { service: ["Service", (t) => t.category === "service" && live(t)], other: ["Works / goods / supply", (t) => t.category === "other" && live(t)],
    new: ["New (24 h)", isNew], soon: ["Closing in 3 days", soon], closed: ["Closed", (t) => !live(t)] };
  function tenderRows(D, o = T) {
    const q = String(o.q || "").toLowerCase().trim(), min = +o.min || 0;
    const L = D.tenders.filter(o.view === "live" ? live : TVIEWS[o.view || "service"][1]).filter((t) => (!o.dep || t.department === o.dep) && (!min || (t.value_cr || 0) >= min)
      && (!q || [t.title, t.tender_id, t.ref_no, t.department, t.office, t.proc_cat].join(" ").toLowerCase().includes(q)));
    const key = { value: (t) => t.value_cr || 0, closing: (t) => t.closing_ms || 0, published: (t) => t.published_ms || 0, title: (t) => t.title || "", department: (t) => t.department || "", tender_id: (t) => +t.tender_id || 0 }[o.sort] || ((t) => t.closing_ms);
    const dir = o.dir || 1;
    return L.sort((a, b) => (key(a) < key(b) ? -dir : key(a) > key(b) ? dir : 0));
  }
  function checkTenders(d) {
    if (!d || !Array.isArray(d.tenders)) return "it has no \"tenders\" list.";
    if (!d.thresholds || !d.fetched_at_iso) return "it is missing thresholds or fetched_at_iso.";
    const bad = d.tenders.find((t) => !t.tender_id || !t.title || !t.closing_ms || !["service", "other"].includes(t.category));
    return bad ? `tender ${bad.tender_id || "?"} is missing an ID, title, closing time or category.` : "";
  }

  function renderTenders(root) {
    root.replaceChildren(el("h1", { class: "page-title" }, "Bihar Government Tenders"), el("p", { class: "muted" }, "Loading…"));
    load("tenders").then((D) => {
      const deps = [...new Set(D.tenders.map((t) => t.department))].sort();
      const tabs = el("div", { class: "mk-tabs", role: "tablist" });
      const body = el("tbody");
      const count = el("p", { class: "muted" });
      const draw = () => {
        tabs.replaceChildren(...Object.entries(TVIEWS).map(([k, [label, f]]) => el("button", { class: `chip ${T.view === k ? "on" : ""}`, role: "tab", "aria-selected": String(T.view === k), type: "button",
          onclick: () => { T.view = k; if (k === "closed") { T.sort = "closing"; T.dir = -1; } else if (T.dir === -1 && T.sort === "closing") T.dir = 1; draw(); } }, `${label} (${D.tenders.filter(f).length})`)));
        const L = tenderRows(D);
        body.innerHTML = L.map((t) => `<tr>
          <td>${esc(t.tender_id)}${isNew(t) ? ' <span class="mk-new">NEW</span>' : ""}${live(t) ? "" : ' <span class="mk-cl">Closed</span>'}<div class="muted">${esc(t.ref_no)}</div></td>
          <td class="mk-title"><div>${esc(t.title)}</div><div class="muted">${esc(t.office || "")}${t.proc_cat ? " · " + esc(t.proc_cat) : ""}</div></td>
          <td>${esc(t.department)}</td>
          <td class="n">${t.value_cr != null ? num(t.value_cr, 2) : "—"}</td>
          <td>${esc((t.published || "").slice(0, 10))}</td>
          <td class="${soon(t) ? "mk-soon" : ""}">${esc(t.closing)}<div class="muted">${left(t)}</div></td>
          <td><a href="${esc(t.link)}" target="_blank" rel="noopener" title="${esc(t.search_hint || "")}">Portal ↗</a><div class="muted">search ID ${esc(t.tender_id)}</div></td></tr>`).join("")
          || '<tr><td colspan="7" class="muted" style="text-align:center;padding:16px">No tenders in this view.</td></tr>';
        count.textContent = `Showing ${L.length} tender${L.length === 1 ? "" : "s"}${T.view === "closed" ? " — closing time passed; they drop off after a while" : ""}.`;
      };
      const sel = (id, opts, val, on) => el("select", { id, onchange: (e) => { on(e.target.value); draw(); } }, opts.map(([v, t]) => el("option", { value: v, selected: v === val || null }, t)));
      const head = (k, label) => el("th", { class: `mk-sort ${k === "value" ? "n" : ""}`, onclick: () => { T.dir = T.sort === k ? -T.dir : (k === "value" || k === "published" ? -1 : 1); T.sort = k; draw(); } }, label);
      root.replaceChildren(
        el("h1", { class: "page-title" }, "Bihar Government Tenders"),
        el("section", { class: "tax-card" },
          el("p", null, el("b", null, "Last updated: "), D.last_successful_fetch || D.fetched_at, " · Source: ", el("a", { href: D.source_url, target: "_blank", rel: "noopener" }, D.source), " ", uploadButton("tenders", checkTenders)),
          el("p", { class: "muted" }, `Service tenders of ₹${D.thresholds.service_min_cr} crore and above, and works / goods / supply tenders of ₹${D.thresholds.other_min_cr} crore and above. Smaller tenders, and tenders without a published value, aren't listed. Live / closed status is worked out again whenever you open the page.`),
          D.fetch_status !== "ok" ? el("p", { class: "bk-warn" }, "The latest refresh failed; this is the last successful update.") : null,
          staleNote(D.fetched_at_iso, 2, "tender")),
        tabs,
        el("section", { class: "tax-card" },
          el("div", { class: "tax-grid noprint" },
            el("label", { class: "field" }, el("span", null, "Search"), el("input", { type: "search", value: T.q, placeholder: "title, tender ID, reference, department", oninput: (e) => { T.q = e.target.value; draw(); } })),
            el("label", { class: "field" }, el("span", null, "Department"), sel("mk-dep", [["", "All departments"], ...deps.map((x) => [x, x])], T.dep, (v) => { T.dep = v; })),
            el("label", { class: "field" }, el("span", null, "Minimum value (₹ crore)"), el("input", { inputmode: "decimal", value: T.min, placeholder: "e.g. 10", oninput: (e) => { T.min = e.target.value.replace(/[^\d.]/g, ""); draw(); } })),
            el("label", { class: "field" }, el("span", null, "Sort by"), sel("mk-sort", [["closing", "Closing date (soonest)"], ["value", "Value (highest)"], ["published", "Published (newest)"]], T.sort, (v) => { T.sort = v; T.dir = v === "closing" ? 1 : -1; }))),
          el("p", { class: "tax-actions noprint" },
            el("button", { class: "btn small", type: "button", onclick: () => saveBlob(new Blob([csv([["Tender ID", "Reference", "Title", "Department", "Office", "Category", "Value (Rs crore)", "Published", "Closing (IST)", "Portal"], ...tenderRows(D).map((t) => [t.tender_id, t.ref_no, t.title, t.department, t.office, t.category, t.value_cr, t.published, t.closing, t.link])])], { type: "text/csv" }), `Bihar-tenders-${T.view}.csv`) }, "Download CSV"),
            el("button", { class: "btn small", type: "button", onclick: () => window.GG?.askSaarthi?.("Which of the Bihar tenders listed here look most relevant for a mid-sized firm, and what are their closing dates?") }, "🙏 Ask Saarthi")),
          count,
          el("div", { class: "bk-tw" }, el("table", { class: "tax-table mk-table" },
            el("thead", null, el("tr", null, head("tender_id", "Tender ID"), head("title", "Title"), head("department", "Department"), head("value", "Value (₹ cr)"), head("published", "Published"), head("closing", "Closing (IST)"), el("th", null, "Official page"))), body))),
        el("p", { class: "tax-disc" }, el("b", null, "Disclaimer: "), "Compiled from the public listing of the Bihar Government eProcurement portal (eproc2.bihar.gov.in) for information only. Values are the portal's estimated tender value. Details, corrigenda, dates and eligibility can change — always check the official portal before acting. SKC & CO. accepts no liability for errors or omissions."));
      draw();
      clearInterval(renderTenders.timer);
      renderTenders.timer = setInterval(() => { if (body.isConnected) draw(); else clearInterval(renderTenders.timer); }, 60000);
    }).catch((e) => root.replaceChildren(el("h1", { class: "page-title" }, "Bihar Government Tenders"), el("p", { class: "bk-warn" }, `Couldn't load the tender data (${e.message}).`), uploadButton("tenders", checkTenders)));
  }

  /* ================= Capital Market Scanner ================= */
  const SC = { tab: "bottom", q: "", minr: "", div: false, sort: "score", dir: -1 };
  const STABS = { bottom: "Double / triple bottom", below200: "Below 200 DMA (>20%)", breakdown: "Breakdown", low52: "At 52-week low" };
  function scanRows(D, o, newage) {
    const q = String(o.q || "").toLowerCase();
    return D.rows.filter((r) => r.tabs.includes(o.tab || "bottom") && !!r.newage === newage && (!q || `${r.name} ${r.symbol} ${r.sector}`.toLowerCase().includes(q))
      && (!o.minr || r.rating <= o.minr) && (!o.div || r.dividend_payer))
      .sort((a, b) => ((a[o.sort || "score"] ?? -1e18) > (b[o.sort || "score"] ?? -1e18) ? 1 : -1) * (o.dir || -1));
  }
  function pattern(r, tab) {
    const f = (v) => num(v, 2);
    if (tab === "bottom" && r.bottom) { const b = r.bottom; return `${esc(b.type)} · ${esc(b.status)}<br><span class="muted">trough ₹${f(b.trough)} · neckline ₹${f(b.neckline)} (${b.to_neck_pct}%) · ${esc(b.troughs.join(", "))}</span>`; }
    if (tab === "below200") return `${r.vs200_pct}% vs 200-DMA ₹${f(r.sma200)}`;
    if (tab === "breakdown" && r.breakdown) { const b = r.breakdown; return `<b>${esc(b.date)}</b> below ${b.window}-day low ₹${f(b.support)} <span class="muted">(now ${b.below_pct}%)</span>`; }
    return `${r.from52low_pct}% above 52-week low ₹${f(r.low52)} <span class="muted">(high ₹${f(r.high52)})</span>`;
  }
  function checkScanner(d) {
    if (!d || !Array.isArray(d.rows) || !d.counts || !d.config) return "it needs rows, counts and config.";
    if (!d.generated_ist || !d.as_of) return "it is missing generated_ist / as_of.";
    const bad = d.rows.find((r) => !r.symbol || !Array.isArray(r.tabs) || r.score == null || !r.rating);
    return bad ? `row ${bad.symbol || "?"} is missing symbol, tabs, score or rating.` : "";
  }
  function renderScanner(root) {
    root.replaceChildren(el("h1", { class: "page-title" }, "Capital Market Scanner"), el("p", { class: "muted" }, "Loading…"));
    load("scanner").then((D) => {
      const out = el("div");
      const tabs = el("div", { class: "mk-tabs", role: "tablist" });
      const cols = [["name", "Company"], ["sector", "Sector"], ["price", "Price ₹"], ["mcap_cr", "MCap ₹ cr"], ["pe", "PE"], ["roe", "ROE %"], ["de", "D/E"], ["dy", "Div yld %"], ["score", "SKC score"], [null, "Pattern"], [null, "Chart"]];
      const table = (L) => L.length ? el("div", { class: "bk-tw", html: `<table class="tax-table mk-table"><thead><tr>${cols.map(([k, l]) => `<th ${k ? `class="mk-sort" data-k="${k}"` : ""}>${l}</th>`).join("")}</tr></thead><tbody>${L.map((r) => `<tr>
        <td><b>${esc(r.name)}</b><br><span class="muted">${esc(r.symbol)}</span>${r.dividend_payer ? ' <span class="mk-div" title="Pays dividends">₹ Div</span>' : ""}${r.newage ? ' <span class="mk-na">New-age</span>' : ""}</td>
        <td>${esc(r.sector)}</td><td class="n">${num(r.price, 2)}</td><td class="n">${num(r.mcap_cr, 0)}</td><td class="n">${num(r.pe)}</td><td class="n">${num(r.roe)}</td><td class="n">${num(r.de, 2)}</td><td class="n">${num(r.dy, 2)}</td>
        <td class="n" title="Depth ${r.pillars.depth ?? "n/a"} · Profit ${r.pillars.profit ?? "–"} · Management ${r.pillars.management ?? "–"} · Sales ${r.pillars.sales_growth ?? "n/a"}${r.pillars.path_to_profit != null ? " · Path to profit " + r.pillars.path_to_profit : ""}&#10;n/a: ${esc(r.na.join(", "))}">${r.score} <span class="mk-r mk-r${esc(r.rating)}">${esc(r.rating)}</span></td>
        <td>${pattern(r, SC.tab)}</td><td><a href="${esc(r.chart)}" target="_blank" rel="noopener">Chart ↗</a></td></tr>`).join("")}</tbody></table>` }) : el("p", { class: "muted" }, "None today.");
      const draw = () => {
        tabs.replaceChildren(...Object.entries(STABS).map(([k, v]) => el("button", { class: `chip ${SC.tab === k ? "on" : ""}`, type: "button", role: "tab", "aria-selected": String(SC.tab === k), onclick: () => { SC.tab = k; draw(); } },
          `${v} (${D.counts[k]}${D.counts_newage?.[k] ? " + " + D.counts_newage[k] : ""})`)));
        const M = scanRows(D, SC, false), N = scanRows(D, SC, true);
        const a = M.filter((r) => r.rating === "A").length, dv = M.filter((r) => r.dividend_payer).length, sec = {};
        M.forEach((r) => { sec[r.sector] = (sec[r.sector] || 0) + 1; });
        const notes = M.length ? [`${a} of ${M.length} rated A; ${dv} pay dividends.`, `Most represented sectors: ${Object.entries(sec).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([s, c]) => `${s} (${c})`).join(", ")}.`] : [];
        if (SC.tab === "bottom" && M.length) { const bo = M.filter((r) => r.bottom?.status === "Breakout").length; notes.push(`${bo} have closed above the neckline; ${M.length - bo} are still below it.`); }
        if (SC.tab === "breakdown" && M.length) notes.push(`${M.filter((r) => r.breakdown?.date === D.as_of).length} broke down in the latest session (${D.as_of}).`);
        if (SC.tab === "below200" && M.length) notes.push(`Average distance from the 200-DMA: ${(M.reduce((s, r) => s + r.vs200_pct, 0) / M.length).toFixed(1)}%.`);
        out.replaceChildren(
          el("section", { class: "tax-card" }, el("h2", null, `${STABS[SC.tab]} — summary`),
            el("div", { class: "bk-sum" }, el("div", null, "Profit-making matches", el("b", null, M.length)), el("div", null, "New-age on watch", el("b", null, N.length)),
              M.slice(0, 3).map((r) => el("div", null, r.symbol, el("b", null, `${r.score} · ${r.rating}`)))),
            notes.length ? el("ul", { class: "bk-notes" }, notes.map((t) => el("li", null, t))) : null),
          el("section", { class: "tax-card" }, el("h2", null, "Profit-making companies"), table(M)),
          el("section", { class: "tax-card" }, el("h2", null, "New-age companies — loss-making, on watch"), el("p", { class: "muted tax-note" }, "Scored on depth, sales growth and path to profitability (narrowing losses, cash runway)."), table(N)));
        out.querySelectorAll("th[data-k]").forEach((th) => th.addEventListener("click", () => { const k = th.dataset.k; SC.dir = SC.sort === k ? -SC.dir : -1; SC.sort = k; draw(); }));
      };
      const w = D.config.weights, p = D.config.patterns;
      root.replaceChildren(
        el("h1", { class: "page-title" }, "Capital Market Scanner"),
        el("p", { class: "tax-disc" }, el("b", null, "Disclaimer: "), "An educational screening tool — not investment advice or a recommendation to buy or sell. Data comes from free public sources and can be delayed, incomplete or wrong; patterns are mechanical detections, not predictions. Verify independently and consult a SEBI-registered adviser."),
        el("section", { class: "tax-card" },
          el("p", null, el("b", null, "Updated: "), D.generated_ist, ` · prices as of ${D.as_of} · NIFTY 500 (${D.stats.universe}) → liquid ${D.stats.liquid} → profit-making ${D.stats.profitable} (+${D.stats.newage_lossmaking || 0} new-age loss-making) `, uploadButton("scanner", checkScanner)),
          staleNote(D.as_of + "T15:30:00+05:30", 4, "market")),
        tabs,
        el("section", { class: "tax-card noprint" }, el("div", { class: "tax-grid" },
          el("label", { class: "field" }, el("span", null, "Search"), el("input", { type: "search", value: SC.q, placeholder: "name / symbol / sector", oninput: (e) => { SC.q = e.target.value; draw(); } })),
          el("label", { class: "field" }, el("span", null, "Minimum SKC rating"), el("select", { onchange: (e) => { SC.minr = e.target.value; draw(); } }, [["", "All"], ["A", "A only"], ["B", "A and B"]].map(([v, t]) => el("option", { value: v, selected: SC.minr === v || null }, t)))),
          el("label", { class: "field mk-check" }, el("input", { type: "checkbox", checked: SC.div || null, onchange: (e) => { SC.div = e.target.checked; draw(); } }), el("span", null, "Dividend payers only"))),
          el("p", { class: "tax-actions" }, el("button", { class: "btn small", type: "button", onclick: () => window.GG?.askSaarthi?.("Explain what today's Capital Market Scanner shows — the patterns and the strongest-rated names — in simple terms. (Educational only.)") }, "🙏 Ask Saarthi to explain"))),
        out,
        el("section", { class: "tax-card muted" }, el("h3", null, "Method"),
          el("p", null, `Universal filter: positive net profit in the latest year and TTM; average 20-day traded value of ₹${D.config.min_avg_traded_value_cr} crore or more. ₹ Div = dividend payer.`),
          el("p", null, `SKC rating (weights): depth ${w.depth}, profit-making capacity ${w.profit}, management integrity ${w.management}, sales growth ${w.sales_growth}. A ≥ ${D.config.rating_bands.A}, B ≥ ${D.config.rating_bands.B}, else C. Missing data shows "n/a" and is scored neutral; promoter pledge has no free source. Hover over a score for the breakdown.`),
          el("p", null, `Double / triple bottom: swing lows in the last ~${p.dbl_lookback_days} sessions, 2–3 troughs within ${p.trough_tolerance_pct}% of each other, at least ${p.min_trough_gap_days} sessions apart, separated by peaks ${p.min_peak_rise_pct}% higher; breakout = close at or above the neckline. Below 200 DMA: close under ${p.below200_ratio} × the 200-day average. Breakdown: close below the lowest low of the previous ${p.breakdown_windows.join(" / ")} sessions within the last ${p.breakdown_recent_days} sessions. 52-week low: close within ${p.near_52w_low_pct}% of the 250-session low.`),
          el("p", null, `Sources: ${D.sources.join("; ")}. Charts: TradingView.`)));
      draw();
    }).catch((e) => root.replaceChildren(el("h1", { class: "page-title" }, "Capital Market Scanner"), el("p", { class: "bk-warn" }, `Couldn't load the scanner data (${e.message}).`), uploadButton("scanner", checkScanner)));
  }

  /* ---------- for Saarthi ---------- */
  async function searchTenders(i = {}) {
    const D = await load("tenders");
    const view = { service: "service", other: "other", new: "new", closing_soon: "soon", closed: "closed" }[i.view] || "live";
    const o = { view, q: i.query, dep: "", min: i.min_value_cr, sort: i.sort === "value" || i.sort === "published" ? i.sort : "closing", dir: i.sort === "value" || i.sort === "published" ? -1 : 1 };
    let L = tenderRows(D, o);
    if (i.department) L = L.filter((t) => t.department.toLowerCase().includes(String(i.department).toLowerCase()));
    if (i.closing_within_days) L = L.filter((t) => live(t) && t.closing_ms - Date.now() <= i.closing_within_days * 864e5);
    return {
      data_updated: D.last_successful_fetch || D.fetched_at, data_age_days: Math.floor(ageDays(D.fetched_at_iso)), thresholds_crore: D.thresholds, matches: L.length,
      tenders: L.slice(0, Math.min(25, i.limit || 12)).map((t) => ({ tender_id: t.tender_id, title: t.title.slice(0, 220), department: t.department, category: t.category, value_crore: t.value_cr, published: t.published, closing_ist: t.closing, time_left: left(t), portal: t.link, how_to_find: t.search_hint })),
      note: "From the public Bihar eProcurement listing; verify on eproc2.bihar.gov.in before acting.",
    };
  }
  async function scanner(i = {}) {
    const D = await load("scanner");
    const tab = STABS[i.pattern] ? i.pattern : "bottom";
    const o = { tab, q: i.query, minr: i.min_rating, div: !!i.dividend_only, sort: "score", dir: -1 };
    const pick = (r) => ({ symbol: r.symbol, name: r.name, sector: r.sector, price: r.price, score: r.score, rating: r.rating, pe: r.pe, roe: r.roe, debt_equity: r.de, dividend_yield: r.dy, dividend_payer: r.dividend_payer,
      pattern: tab === "bottom" ? r.bottom : tab === "breakdown" ? r.breakdown : tab === "below200" ? { vs200_pct: r.vs200_pct } : { from52low_pct: r.from52low_pct, low52: r.low52 }, chart: r.chart });
    return {
      updated: D.generated_ist, prices_as_of: D.as_of, data_age_days: Math.floor(ageDays(D.as_of + "T15:30:00+05:30")), pattern: STABS[tab], counts: D.counts,
      profit_making: scanRows(D, o, false).slice(0, Math.min(20, i.limit || 10)).map(pick), new_age_on_watch: scanRows(D, o, true).slice(0, 5).map(pick),
      rating_method: D.config.weights, disclaimer: "Educational screening only — not investment advice or a buy/sell recommendation.",
    };
  }

  window.GGMarkets = { renderTenders, renderScanner, searchTenders, scanner };
})();
