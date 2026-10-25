/* Gita Gyan — one app for every page.
 * index.html  → name + password login, then a choice: Gita or Income Tax Calculator
 * gita.html   → public reader
 * tax.html    → Income Tax Calculator (assets/tax.js)
 * admin.html  → reader with editing tools; "Publish" commits to GitHub so the
 *               public link picks the change up automatically (~1 minute).
 * gita.html and tax.html open only after the same login (remembered on the
 * device, or for this tab) and send visitors back to index.html otherwise.
 * Content lives in data/gita.enc, encrypted with the access password, so the
 * public GitHub repo never exposes it.
 */
(() => {
  "use strict";

  const ADMIN = document.body.dataset.mode === "admin";
  const PAGE = document.body.dataset.page || "gita"; // hub | gita | tax
  const FOOTER = "© 2026 SKC & CO. All rights reserved";
  const LS = {
    auth: "gg-auth", prefs: "gg-prefs", draft: "gg-admin-draft",
    ghToken: "gg-gh-token", adminKey: "gg-worker-admin-key",
  };
  const SS = { auth: "gg-session" };
  const S = {
    config: null, enc: null, content: null, password: "", name: "",
    pendingPassword: null, dirty: false, editing: null,
    prefs: { sa: true, tr: true, hi: true, en: true, scale: 1, theme: "light" },
    chat: { messages: [], view: [], busy: false, open: false },
  };

  /* ---------- small utilities ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const store = {
    get(k, fallback = null) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };
  const session = {
    get(k, fallback = null) { try { const v = sessionStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
  };

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "value") el.value = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const slug = (s) => fold(s).replace(/[^a-z0-9ऀ-ॿ]+/g, "-").replace(/^-|-$/g, "") || "page";

  function toast(msg, kind = "") {
    const t = h("div", { class: `toast ${kind}` }, msg);
    document.body.append(t);
    setTimeout(() => t.classList.add("show"), 10);
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, kind === "error" ? 6000 : 3200);
  }

  /* Minimal, safe markdown: input is escaped first, then a few constructs are re-enabled. */
  function md(src, { linkRefs = false } = {}) {
    const inline = (t) => {
      t = t.replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
        .replace(/\[([^\]]+)\]\(((?:https?:\/\/|#|\.?\/)[^)\s]*)\)/g, (m, txt, url) =>
          `<a href="${url}"${url.startsWith("http") ? ' target="_blank" rel="noopener"' : ""}>${txt}</a>`);
      if (linkRefs) t = linkShlokRefs(t);
      return t;
    };
    const lines = esc(src).replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let list = null, para = [], quote = [];
    const flushQuote = () => { if (quote.length) { out.push(`<blockquote>${quote.map(inline).join("<br>")}</blockquote>`); quote = []; } };
    const flushPara = () => { flushQuote(); if (para.length) { out.push(`<p>${inline(para.join("<br>"))}</p>`); para = []; } };
    const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; } };
    for (const line of lines) {
      let m;
      if (!line.trim()) { flushPara(); flushList(); continue; }
      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flushPara(); flushList(); const n = Math.min(m[1].length + 1, 5); out.push(`<h${n}>${inline(m[2])}</h${n}>`); continue; }
      if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) { flushPara(); if (!list || list.tag !== "ul") { flushList(); list = { tag: "ul", items: [] }; } list.items.push(m[1]); continue; }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flushPara(); if (!list || list.tag !== "ol") { flushList(); list = { tag: "ol", items: [] }; } list.items.push(m[1]); continue; }
      if ((m = line.match(/^&gt;\s?(.*)$/))) { if (para.length) flushPara(); flushList(); quote.push(m[1]); continue; }
      flushQuote();
      if (/^-{3,}$/.test(line.trim())) { flushPara(); flushList(); out.push("<hr>"); continue; }
      flushList();
      para.push(line);
    }
    flushPara(); flushList();
    return out.join("\n");
  }

  function linkShlokRefs(htmlText) {
    // Turns "2.47" / "BG 2.47" into links when the verse exists (skips text already inside tags).
    return htmlText.replace(/(<[^>]+>)|\b(\d{1,2})\.(\d{1,2})\b/g, (m, tag, c, v) => {
      if (tag) return tag;
      const s = findShlok(+c, +v);
      return s ? `<a href="#/c/${c}/${v}" class="ref">${c}.${v}</a>` : m;
    });
  }

  /* ---------- Devanagari → IAST (admin helper; mirrors private/build_seed.py) ---------- */
  const CONS = { "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "ṅ", "च": "c", "छ": "ch", "ज": "j", "झ": "jh", "ञ": "ñ", "ट": "ṭ", "ठ": "ṭh", "ड": "ḍ", "ढ": "ḍh", "ण": "ṇ", "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n", "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m", "य": "y", "र": "r", "ल": "l", "ळ": "ḷ", "व": "v", "श": "ś", "ष": "ṣ", "स": "s", "ह": "h" };
  const VOWELS = { "अ": "a", "आ": "ā", "इ": "i", "ई": "ī", "उ": "u", "ऊ": "ū", "ऋ": "ṛ", "ॠ": "ṝ", "ऌ": "ḷ", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au" };
  const MATRAS = { "ा": "ā", "ि": "i", "ी": "ī", "ु": "u", "ू": "ū", "ृ": "ṛ", "ॄ": "ṝ", "ॢ": "ḷ", "े": "e", "ै": "ai", "ो": "o", "ौ": "au" };
  const MARKS = { "ं": "ṃ", "ः": "ḥ", "ँ": "m̐", "ऽ": "'", "ॐ": "oṃ" };
  function toIast(text) {
    let out = "";
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      let nxt = text[i + 1] || "";
      if (CONS[ch]) {
        out += CONS[ch];
        if (nxt === "़") { i++; nxt = text[i + 1] || ""; }
        if (nxt === "्") i++;
        else if (MATRAS[nxt]) { out += MATRAS[nxt]; i++; }
        else out += "a";
      } else if (VOWELS[ch]) out += VOWELS[ch];
      else if (MARKS[ch]) out += MARKS[ch];
      else if ("।॥|".includes(ch)) { /* drop dandas */ }
      else if (ch >= "०" && ch <= "९") out += String(ch.charCodeAt(0) - 0x966);
      else out += ch;
    }
    return out;
  }
  function makeTranslit(sanskrit) {
    return sanskrit.split("\n").map((l) => {
      const num = l.match(/॥\s*([०-९]+\.[०-९]+)\s*॥\s*$/);
      const body = l.replace(/॥\s*[०-९]+\.[०-९]+\s*॥\s*$/, "");
      let t = toIast(body).replace(/\s+/g, " ").trim();
      if (num) t += ` ‖ ${toIast(num[1])} ‖`;
      return t;
    }).join("\n");
  }

  /* ---------- crypto: gzip(JSON) → AES-256-GCM, key = PBKDF2-SHA256(password) ---------- */
  const enc8 = new TextEncoder(), dec8 = new TextDecoder();
  function b64ToBytes(b64) { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  function bytesToB64(bytes) { let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); }
  async function pipeBytes(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
  async function deriveKey(password, salt, iterations) {
    const base = await crypto.subtle.importKey("raw", enc8.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function decryptContent(blob, password) {
    const key = await deriveKey(password, b64ToBytes(blob.salt), blob.iter);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(blob.iv) }, key, b64ToBytes(blob.data));
    return JSON.parse(dec8.decode(await pipeBytes(new Uint8Array(plain), new DecompressionStream("gzip"))));
  }
  async function encryptContent(obj, password) {
    const iter = 250000;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, iter);
    const zipped = await pipeBytes(enc8.encode(JSON.stringify(obj)), new CompressionStream("gzip"));
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, zipped));
    return { v: 1, kdf: "PBKDF2-SHA256", iter, salt: bytesToB64(salt), iv: bytesToB64(iv), data: bytesToB64(data) };
  }

  /* ---------- content helpers ---------- */
  const chapters = () => S.content.chapters;
  const findChapter = (n) => chapters().find((c) => c.n === n);
  const findShlok = (c, v) => findChapter(c)?.shlokas.find((s) => s.v === v);
  const totalShlokas = () => chapters().reduce((a, c) => a + c.shlokas.length, 0);
  const allShlokas = () => chapters().flatMap((c) => c.shlokas.map((s) => ({ c: c.n, s })));

  /* ---------- boot & login ---------- */
  async function fetchFresh(path) {
    const res = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res;
  }

  async function boot() {
    S.prefs = { ...S.prefs, ...store.get(LS.prefs, {}) };
    applyScale();
    applyTheme();
    try {
      S.config = await (await fetchFresh("data/config.json")).json();
    } catch {
      S.config = { title: "गीता ज्ञान", tagline: "" };
    }
    document.title = (PAGE === "tax" ? "Income Tax Calculator · " : "") + (S.config.title || "Gita Gyan") + (ADMIN ? " · Admin" : "");
    const remembered = store.get(LS.auth);
    const saved = remembered || session.get(SS.auth);
    if (saved?.password) {
      const ok = await tryLogin(saved.name, saved.password, !!remembered).catch(() => false);
      if (ok) return;
    }
    if (!ADMIN && PAGE !== "hub") { location.replace("index.html" + location.hash); return; }
    renderLogin();
  }

  function renderLogin(error = "") {
    const app = $("#app");
    app.className = "login-wrap";
    const saved = store.get(LS.auth) || {};
    const nameIn = h("input", { id: "login-name", autocomplete: "name", placeholder: "आपका नाम / Your name", value: saved.name || (ADMIN ? "Admin" : ""), required: true });
    const passIn = h("input", { id: "login-pass", type: "password", autocomplete: "current-password", placeholder: "पासवर्ड / Password", required: true });
    const remember = h("input", { type: "checkbox", id: "login-remember", checked: true });
    const btn = h("button", { class: "btn primary block", type: "submit" }, "प्रवेश करें · Enter");
    const err = h("p", { class: "login-error", role: "alert" }, error);
    const form = h("form", {
      class: "login-card",
      onsubmit: async (e) => {
        e.preventDefault();
        if (!nameIn.value.trim() || !passIn.value) return;
        btn.disabled = true; btn.textContent = "खुल रहा है…"; err.textContent = "";
        const ok = await tryLogin(nameIn.value.trim(), passIn.value, remember.checked).catch((e2) => { err.textContent = e2.message; return null; });
        if (ok === false) err.textContent = "पासवर्ड गलत है। · Wrong password.";
        if (!ok) { btn.disabled = false; btn.textContent = "प्रवेश करें · Enter"; passIn.select(); }
      },
    },
      h("div", { class: "login-om", "aria-hidden": "true" }, "ॐ"),
      h("h1", null, S.config.title || "गीता ज्ञान"),
      S.config.tagline ? h("p", { class: "login-tag" }, S.config.tagline) : null,
      ADMIN ? h("p", { class: "admin-pill" }, "Admin") : null,
      h("label", { for: "login-name" }, "नाम · Name"), nameIn,
      h("label", { for: "login-pass" }, "पासवर्ड · Password"), passIn,
      h("label", { class: "check" }, remember, " इस डिवाइस पर याद रखें · Remember me"),
      btn, err,
      h("p", { class: "login-help" }, ADMIN ? "Use the readers' access password. Publishing also needs your GitHub token (Settings)." : "पासवर्ड न हो तो साइट के व्यवस्थापक से संपर्क करें।"),
    );
    app.replaceChildren(form);
    (saved.name && !ADMIN ? passIn : nameIn).focus();
  }

  async function tryLogin(name, password, remember) {
    if (!S.enc) S.enc = await (await fetchFresh("data/gita.enc")).json();
    let content;
    try { content = await decryptContent(S.enc, password); } catch { return false; }
    S.content = content; S.password = password; S.name = name;
    if (remember) store.set(LS.auth, { name, password }); else store.del(LS.auth);
    session.set(SS.auth, { name, password });
    if (ADMIN) restoreDraft();
    logVisit();
    if (PAGE === "hub") startHub();
    else if (PAGE === "tax") startTax();
    else startApp();
    return true;
  }

  function logout() {
    store.del(LS.auth);
    session.del(SS.auth);
    if (!ADMIN) { location.replace("index.html"); return; }
    location.hash = "";
    location.reload();
  }

  function logVisit() {
    if (ADMIN || !S.config.chatUrl || session.get("gg-visit-logged")) return;
    session.set("gg-visit-logged", true);
    fetch(S.config.chatUrl.replace(/\/$/, "") + "/visit", {
      method: "POST",
      headers: { "content-type": "application/json", "x-chat-token": S.content.chat?.token || "" },
      body: JSON.stringify({ name: S.name }),
    }).catch(() => { /* the visitor log is optional */ });
  }

  /* ---------- app shell ---------- */
  function shell(...top) {
    const app = $("#app");
    app.className = "";
    app.replaceChildren(...[
      ...top,
      h("main", { id: "view", tabindex: "-1" }),
      h("footer", { class: "site-footer" }, h("div", { id: "footer-text" })),
    ].filter(Boolean));
    renderFooter();
  }

  function startApp() {
    shell(ADMIN ? adminBar() : null, header());
    chatMount();
    window.addEventListener("hashchange", () => { if (!S.keepEditing) S.editing = null; S.keepEditing = false; route(); });
    route();
  }

  // Links shared by every page's header (and the ☰ menu on small screens).
  function siteLinks() {
    const gitaHref = PAGE === "gita" ? "#/" : "gita.html";
    return [["hub", "index.html", "मुख्य · Home"], ["gita", gitaHref, "गीता · Gita"], ["tax", "tax.html", "आयकर · Income Tax"]]
      .map(([id, href, label]) => h("a", { href, "aria-current": id === PAGE ? "page" : null }, label));
  }

  function themeChips() {
    return h("div", { class: "chips" },
      h("button", { class: `chip theme-chip ${S.prefs.theme !== "dark" ? "on" : ""}`, "data-theme-choice": "light", onclick: () => setTheme("light") }, "☀️ Light"),
      h("button", { class: `chip theme-chip ${S.prefs.theme === "dark" ? "on" : ""}`, "data-theme-choice": "dark", onclick: () => setTheme("dark") }, "🌙 Dark"));
  }

  // Header for the choice screen and the tax page: brand, shared links, theme and logout.
  function simpleHeader() {
    const menu = h("details", { class: "menu" },
      h("summary", { "aria-label": "Menu" }, "☰"),
      h("div", { class: "menu-panel" },
        h("div", { class: "menu-label" }, "सेवाएँ · Sections"),
        h("div", { class: "menu-links" }, siteLinks()),
        h("div", { class: "menu-label" }, "रंग · Theme"),
        themeChips(),
        h("hr"),
        h("div", { class: "menu-user" }, `🙏 ${S.name}`),
        h("button", { class: "btn small ghost", onclick: logout }, "Logout")));
    return h("header", { class: "site-header simple" },
      h("a", { href: "index.html", class: "brand" }, h("span", { class: "brand-om" }, "ॐ"), h("span", { id: "brand-title" }, S.content.site.title)),
      h("nav", { class: "main-nav" }, siteLinks()),
      menu);
  }

  /* ---------- choice screen (index.html) and tax page ---------- */
  function startHub() {
    // Old shared links (index.html#/c/2/47) still open the reader.
    if (location.hash.replace(/^#\/?/, "")) { location.replace("gita.html" + location.hash); return; }
    shell(simpleHeader());
    const card = (href, icon, title, sub) => h("a", { class: "hub-card", href },
      h("span", { class: "hub-icon", "aria-hidden": "true" }, icon),
      h("span", { class: "hub-title" }, title),
      h("span", { class: "hub-sub" }, sub));
    $("#view").replaceChildren(h("section", { class: "hub" },
      h("div", { class: "hero-om", "aria-hidden": "true" }, "ॐ"),
      h("h1", { class: "page-title" }, `🙏 नमस्ते, ${S.name}`),
      h("p", { class: "hero-sub" }, "आगे बढ़ने के लिए चुनें · Choose where to go"),
      h("div", { class: "hub-grid" },
        card("gita.html", "ॐ", "गीता · Gita", S.config.tagline || "श्रीमद्भगवद्गीता"),
        card("tax.html", "₹", "आयकर गणना · Income Tax Calculator", "FY 2025-26 · AY 2026-27 — old vs new regime, computation of income"))));
  }

  function startTax() {
    shell(simpleHeader());
    if (window.TaxApp) window.TaxApp.mount($("#view"), { h, toast });
    else $("#view").replaceChildren(h("p", { class: "warn" }, "The calculator could not load. Please refresh the page."));
  }

  function header() {
    const toggles = [["sa", "संस्कृत"], ["tr", "Roman"], ["hi", "हिन्दी"], ["en", "English"]].map(([k, label]) =>
      h("button", {
        class: `chip ${S.prefs[k] ? "on" : ""}`, "aria-pressed": String(!!S.prefs[k]), title: "दिखाएँ/छिपाएँ",
        onclick: (e) => { S.prefs[k] = !S.prefs[k]; store.set(LS.prefs, S.prefs); e.currentTarget.classList.toggle("on", S.prefs[k]); e.currentTarget.setAttribute("aria-pressed", String(S.prefs[k])); document.body.classList.toggle(`hide-${k}`, !S.prefs[k]); },
      }, label));
    for (const k of ["sa", "tr", "hi", "en"]) document.body.classList.toggle(`hide-${k}`, !S.prefs[k]);
    const search = h("form", {
      class: "search", role: "search",
      onsubmit: (e) => { e.preventDefault(); const q = e.currentTarget.q.value.trim(); if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`; },
    }, h("input", { name: "q", type: "search", placeholder: "खोजें · Search", "aria-label": "Search" }));
    const menu = h("details", { class: "menu" },
      h("summary", { "aria-label": "Menu" }, "☰"),
      h("div", { class: "menu-panel" },
        h("div", { class: "menu-label" }, "दिखाएँ · Show"),
        h("div", { class: "chips" }, toggles),
        h("div", { class: "menu-label" }, "अक्षर आकार · Text size"),
        h("div", { class: "chips" },
          h("button", { class: "chip", onclick: () => setScale(-0.1) }, "A−"),
          h("button", { class: "chip", onclick: () => setScale(0) }, "A"),
          h("button", { class: "chip", onclick: () => setScale(0.1) }, "A+")),
        h("div", { class: "menu-label" }, "रंग · Theme"),
        themeChips(),
        h("div", { class: "menu-label" }, "सेवाएँ · Sections"),
        h("div", { class: "menu-links" }, siteLinks()),
        h("div", { class: "menu-label" }, "पृष्ठ · Pages"),
        h("div", { id: "menu-pages", class: "menu-links" }),
        h("hr"),
        h("div", { class: "menu-user" }, `🙏 ${S.name}`),
        h("button", { class: "btn small ghost", onclick: logout }, "Logout"),
      ));
    return h("header", { class: "site-header" },
      h("a", { href: "#/", class: "brand" }, h("span", { class: "brand-om" }, "ॐ"), h("span", { id: "brand-title" }, S.content.site.title)),
      h("nav", { class: "main-nav" }, siteLinks(), h("a", { href: "#/chapters" }, "अध्याय")),
      search, menu);
  }

  function refreshChrome() {
    $("#brand-title").textContent = S.content.site.title;
    const links = $("#menu-pages");
    links.replaceChildren(...S.content.pages.map((p) => h("a", { href: `#/p/${p.id}` }, p.title)));
    if (ADMIN) links.append(h("a", { href: "#/p/new", class: "muted" }, "+ नया पृष्ठ / New page"));
    renderFooter();
  }

  function renderFooter() {
    const f = $("#footer-text");
    if (f) f.textContent = FOOTER;
  }

  function setScale(d) {
    S.prefs.scale = d === 0 ? 1 : Math.min(1.6, Math.max(0.8, +(S.prefs.scale + d).toFixed(2)));
    store.set(LS.prefs, S.prefs); applyScale();
  }
  function applyScale() { document.documentElement.style.setProperty("--scale", S.prefs.scale); }

  function setTheme(theme) {
    S.prefs.theme = theme;
    store.set(LS.prefs, S.prefs);
    applyTheme();
    document.querySelectorAll(".theme-chip").forEach((b) => b.classList.toggle("on", b.dataset.themeChoice === theme));
  }
  function applyTheme() { document.documentElement.dataset.theme = S.prefs.theme === "dark" ? "dark" : "light"; }

  /* ---------- router ---------- */
  function route() {
    refreshChrome();
    const hash = location.hash.replace(/^#/, "") || "/";
    const [path, query] = hash.split("?");
    const parts = path.split("/").filter(Boolean);
    const view = $("#view");
    let node;
    if (parts[0] === "c" && parts[2]) node = viewShlok(+parts[1], +parts[2]);
    else if (parts[0] === "c" && parts[1]) node = viewChapter(+parts[1]);
    else if (parts[0] === "chapters") node = viewChapters();
    else if (parts[0] === "p" && parts[1]) node = viewPage(decodeURIComponent(parts[1]));
    else if (parts[0] === "search") node = viewSearch(new URLSearchParams(query).get("q") || "");
    else if (parts[0] === "admin" && ADMIN) node = viewSettings();
    else node = viewHome();
    view.replaceChildren(node);
    $(".menu")?.removeAttribute("open");
    if (!rerendering) window.scrollTo(0, 0);
    updateAdminBar();
    const target = parts[0] === "c" && parts[2] && $(`#s-${parts[1]}-${parts[2]}`);
    if (target) target.scrollIntoView({ block: "start" });
  }

  let rerendering = false;
  function rerender() {
    const y = window.scrollY;
    rerendering = true;
    route();
    rerendering = false;
    window.scrollTo(0, y);
  }

  /* ---------- views ---------- */
  function viewHome() {
    const site = S.content.site;
    const all = allShlokas();
    const day = Math.floor(Date.now() / 86400000);
    const today = all.length ? all[day % all.length] : null;
    return h("div", { class: "home" },
      editable("home", () => editHomeForm(),
        h("section", { class: "hero" },
          h("div", { class: "hero-om", "aria-hidden": "true" }, "ॐ"),
          h("h1", null, site.title),
          h("p", { class: "hero-sub" }, site.subtitle),
          site.announcement ? h("div", { class: "announce", html: md(site.announcement) }) : null,
          h("div", { class: "prose intro", html: md(site.intro) }),
          h("div", { class: "hero-actions" },
            h("a", { class: "btn primary", href: "#/c/1" }, "पढ़ना आरंभ करें · Start reading"),
            h("button", { class: "btn", onclick: () => chatOpen() }, "🙏 गीता सखा से पूछें"))),
        "मुखपृष्ठ संपादित करें · Edit home"),
      today ? h("section", { class: "today" },
        h("h2", { class: "section-title" }, "आज का श्लोक · Shlok of the day"),
        shlokCard(findChapter(today.c), today.s, { compact: true })) : null,
      h("section", null,
        h("h2", { class: "section-title" }, `अध्याय · ${chapters().length} Chapters · ${totalShlokas()} श्लोक`),
        chapterGrid()));
  }

  function viewChapters() {
    return h("div", null, h("h1", { class: "page-title" }, "अध्याय · Chapters"), chapterGrid());
  }

  function chapterGrid() {
    return h("div", { class: "chapter-grid" },
      chapters().map((c) => h("a", { class: "chapter-card", href: `#/c/${c.n}` },
        h("span", { class: "cc-num" }, c.n),
        h("span", { class: "cc-sa" }, c.sa),
        h("span", { class: "cc-hi" }, c.hi),
        h("span", { class: "cc-en" }, c.en),
        h("span", { class: "cc-count" }, `${c.shlokas.length} श्लोक`))),
      ADMIN ? h("button", { class: "chapter-card add", onclick: addChapter }, "+ नया अध्याय · Add chapter") : null);
  }

  function viewChapter(n) {
    const c = findChapter(n);
    if (!c) return notFound();
    const idx = chapters().indexOf(c);
    const prev = chapters()[idx - 1], next = chapters()[idx + 1];
    const jump = h("select", {
      class: "jump", "aria-label": "Go to shlok",
      onchange: (e) => { const el = $(`#s-${n}-${e.target.value}`); if (el) el.scrollIntoView({ behavior: "smooth" }); },
    }, h("option", { value: "" }, "श्लोक पर जाएँ…"), c.shlokas.map((s) => h("option", { value: s.v }, `${n}.${s.v}`)));
    return h("article", { class: "chapter" },
      editable(`c:${n}`, () => editChapterForm(c),
        h("header", { class: "chapter-head" },
          h("div", { class: "eyebrow" }, `अध्याय ${n} · Chapter ${n}`),
          h("h1", { class: "ch-sa" }, c.sa),
          h("p", { class: "ch-names" }, h("span", null, c.hi), " · ", h("span", { class: "ch-en" }, c.en)),
          h("p", { class: "ch-tr" }, c.tr),
          c.sum_hi ? h("p", { class: "ch-sum hi-text" }, c.sum_hi) : null,
          c.sum_en ? h("p", { class: "ch-sum en-text" }, c.sum_en) : null,
          h("div", { class: "ch-tools" }, jump,
            h("button", { class: "btn small", onclick: () => chatOpen(`अध्याय ${n} (${c.hi}) का सार और मुख्य शिक्षाएँ विस्तार से समझाइए।`) }, "🙏 इस अध्याय पर चर्चा"))),
        "अध्याय संपादित करें · Edit chapter"),
      h("div", { class: "shlok-list" }, c.shlokas.map((s) => shlokCard(c, s))),
      ADMIN ? h("button", { class: "btn add-shlok", onclick: () => addShlok(c) }, `+ श्लोक जोड़ें · Add shlok ${n}.${(c.shlokas.at(-1)?.v || 0) + 1}`) : null,
      c.colophon ? h("p", { class: "colophon" }, c.colophon) : null,
      pager(prev && { href: `#/c/${prev.n}`, label: `← अध्याय ${prev.n}` }, next && { href: `#/c/${next.n}`, label: `अध्याय ${next.n} →` }));
  }

  function viewShlok(n, v) {
    const c = findChapter(n), s = findShlok(n, v);
    if (!c || !s) return notFound();
    const flat = allShlokas();
    const i = flat.findIndex((x) => x.c === n && x.s === s);
    const prev = flat[i - 1], next = flat[i + 1];
    return h("article", { class: "single" },
      h("a", { class: "back", href: `#/c/${n}` }, `← अध्याय ${n} · ${c.hi}`),
      shlokCard(c, s, { single: true }),
      pager(prev && { href: `#/c/${prev.c}/${prev.s.v}`, label: `← ${prev.c}.${prev.s.v}` }, next && { href: `#/c/${next.c}/${next.s.v}`, label: `${next.c}.${next.s.v} →` }));
  }

  function shlokCard(c, s, opts = {}) {
    const key = `s:${c.n}:${s.v}`;
    if (S.editing === key) return editShlokForm(c, s);
    const ref = `${c.n}.${s.v}`;
    return h("section", { class: `shlok ${opts.single ? "single-card" : ""}`, id: `s-${c.n}-${s.v}` },
      h("div", { class: "shlok-top" },
        h("a", { class: "badge", href: `#/c/${c.n}/${s.v}`, title: "इस श्लोक का लिंक" }, `श्लोक ${ref}`),
        h("div", { class: "shlok-actions" },
          h("button", { class: "icon-btn", title: "गीता सखा से पूछें · Ask about this shlok", onclick: () => chatOpen(`श्लोक ${ref} को गहराई से समझाइए — शब्दार्थ, भाव और जीवन में उपयोग।`) }, "🙏"),
          h("button", { class: "icon-btn", title: "लिंक कॉपी करें · Copy link", onclick: () => copyLink(`#/c/${c.n}/${s.v}`) }, "🔗"),
          ADMIN ? h("button", { class: "icon-btn edit", title: "Edit", onclick: () => { S.editing = key; rerender(); } }, "✎") : null)),
      s.sa ? h("p", { class: "sa-text" }, s.sa) : null,
      s.tr ? h("p", { class: "tr-text" }, s.tr) : null,
      h("div", { class: "hi-block" },
        h("div", { class: "label" }, "हिन्दी भावार्थ"),
        s.hi ? h("p", { class: "hi-text" }, s.hi) : h("p", { class: "missing" }, "भावार्थ अभी जोड़ा जाना है।")),
      h("div", { class: "en-block" },
        h("div", { class: "label" }, "English · Shri Purohit Swami"),
        s.en ? h("p", { class: "en-text" }, s.en) : h("p", { class: "missing" }, "Purohit Swami's translation is not available for this verse.")),
      s.note ? h("div", { class: "note-block" }, h("div", { class: "label" }, "टिप्पणी · Note"), h("div", { class: "prose", html: md(s.note) })) : null,
      opts.compact ? h("a", { class: "more", href: `#/c/${c.n}` }, `अध्याय ${c.n} पढ़ें →`) : null);
  }

  function viewPage(id) {
    if (id === "new" && ADMIN) {
      const page = { id: "", title: "नया पृष्ठ", body: "" };
      S.editing = "p:new";
      return h("div", null, editPageForm(page, true));
    }
    const p = S.content.pages.find((x) => x.id === id);
    if (!p) return notFound();
    return h("article", { class: "page" },
      editable(`p:${p.id}`, () => editPageForm(p),
        h("div", null, h("h1", { class: "page-title" }, p.title), h("div", { class: "prose", html: md(p.body) })),
        "पृष्ठ संपादित करें · Edit page"));
  }

  function viewSearch(q) {
    const qf = fold(q);
    const hits = [];
    if (qf) {
      for (const { c, s } of allShlokas()) {
        const fields = [["hi", s.hi], ["en", s.en], ["tr", s.tr], ["sa", s.sa], ["note", s.note]];
        const f = fields.find(([, t]) => fold(t).includes(qf));
        if (f) hits.push({ c, s, field: f[0], text: f[1] });
        if (hits.length >= 200) break;
      }
    }
    const ref = q.match(/^\s*(\d{1,2})[.: ](\d{1,3})\s*$/);
    return h("div", { class: "search-view" },
      h("h1", { class: "page-title" }, `“${q}”`),
      ref && findShlok(+ref[1], +ref[2]) ? h("p", null, h("a", { class: "btn primary", href: `#/c/${ref[1]}/${ref[2]}` }, `श्लोक ${ref[1]}.${ref[2]} खोलें →`)) : null,
      h("p", { class: "muted" }, hits.length ? `${hits.length}${hits.length >= 200 ? "+" : ""} परिणाम · results` : "कोई परिणाम नहीं मिला · No results"),
      h("ol", { class: "results" }, hits.map(({ c, s, text }) => h("li", null,
        h("a", { href: `#/c/${c}/${s.v}` }, h("strong", null, `${c}.${s.v}`), " ", h("span", { html: snippet(text, q) }))))),
      h("p", null, h("button", { class: "btn", onclick: () => chatOpen(q) }, `🙏 गीता सखा से पूछें: “${q}”`)));
  }

  function snippet(text, q) {
    const t = String(text).replace(/\n/g, " ");
    const i = fold(t).indexOf(fold(q));
    const start = Math.max(0, i - 60);
    const part = t.slice(start, start + 200);
    const j = i - start;
    return (start ? "…" : "") + esc(part.slice(0, j)) + "<mark>" + esc(part.slice(j, j + q.length)) + "</mark>" + esc(part.slice(j + q.length)) + "…";
  }

  function pager(prev, next) {
    return h("nav", { class: "pager" },
      prev ? h("a", { class: "btn", href: prev.href }, prev.label) : h("span"),
      next ? h("a", { class: "btn", href: next.href }, next.label) : h("span"));
  }

  function notFound() {
    return h("div", { class: "empty" }, h("h1", null, "पृष्ठ नहीं मिला"), h("p", null, h("a", { href: "#/" }, "मुखपृष्ठ पर जाएँ")));
  }

  function copyLink(hash) {
    const url = location.href.replace(/(admin|index)\.html/, "gita.html").split("#")[0] + hash;
    navigator.clipboard?.writeText(url).then(() => toast("लिंक कॉपी हो गया · Link copied"), () => toast(url));
  }

  /* ---------- admin: editing ---------- */
  function editable(key, formFn, node, label) {
    if (!ADMIN) return node;
    if (S.editing === key) return formFn();
    return h("div", { class: "editable" }, node,
      h("button", { class: "btn small edit-toggle", onclick: () => { S.editing = key; rerender(); } }, `✎ ${label}`));
  }

  function field(label, name, value, { rows = 0, type = "text", cls = "", hint = "" } = {}) {
    const input = rows
      ? h("textarea", { name, rows, class: cls }, value ?? "")
      : h("input", { name, type, value: value ?? "", class: cls });
    return h("label", { class: "field" }, h("span", null, label), input, hint ? h("small", null, hint) : null);
  }

  function form(title, fields, { onSave, onDelete, deleteLabel = "हटाएँ · Delete", extra = [] }) {
    const f = h("form", {
      class: "edit-form",
      onsubmit: (e) => { e.preventDefault(); const data = Object.fromEntries(new FormData(f)); if (onSave(data) !== false) { S.editing = null; markDirty(); rerender(); } },
    },
      h("div", { class: "edit-title" }, title),
      fields,
      h("div", { class: "edit-actions" },
        h("button", { class: "btn primary", type: "submit" }, "सहेजें · Save"),
        h("button", { class: "btn", type: "button", onclick: () => { S.editing = null; rerender(); } }, "रद्द · Cancel"),
        extra,
        onDelete ? h("button", { class: "btn danger", type: "button", onclick: () => { if (onDelete() !== false) { S.editing = null; markDirty(); rerender(); } } }, deleteLabel) : null),
      h("p", { class: "edit-hint" }, "Save keeps the change in this browser. Press “Publish” (top bar) to make it live on the public link."));
    setTimeout(() => f.querySelector("textarea, input")?.focus(), 0);
    return f;
  }

  function editShlokForm(c, s) {
    const translitBtn = h("button", {
      class: "btn", type: "button", title: "Rebuild the Roman transliteration from the Sanskrit box",
      onclick: (e) => { const fm = e.target.closest("form"); fm.tr.value = makeTranslit(fm.sa.value); },
    }, "संस्कृत → Roman");
    return h("div", { id: `s-${c.n}-${s.v}` }, form(`श्लोक ${c.n}.${s.v} संपादित करें`, [
      field("श्लोक संख्या · Verse number", "v", s.v, { type: "number" }),
      field("संस्कृत (देवनागरी)", "sa", s.sa, { rows: 4, cls: "sa-input" }),
      field("Roman transliteration", "tr", s.tr, { rows: 4 }),
      field("हिन्दी भावार्थ", "hi", s.hi, { rows: 5, cls: "hi-input" }),
      field("English (Shri Purohit Swami)", "en", s.en, { rows: 4 }),
      field("टिप्पणी / Note (optional, markdown)", "note", s.note, { rows: 3 }),
    ], {
      extra: [translitBtn],
      onSave: (d) => {
        const v = parseInt(d.v, 10);
        if (!(v > 0)) { toast("Verse number must be a positive number", "error"); return false; }
        if (v !== s.v && c.shlokas.some((x) => x.v === v)) { toast(`Shlok ${c.n}.${v} already exists`, "error"); return false; }
        Object.assign(s, { v, sa: d.sa.trim(), tr: d.tr.trim(), hi: d.hi.trim(), en: d.en.trim(), note: d.note.trim() });
        c.shlokas.sort((a, b) => a.v - b.v);
      },
      onDelete: () => {
        if (!confirm(`श्लोक ${c.n}.${s.v} हटाएँ? · Delete shlok ${c.n}.${s.v}?`)) return false;
        c.shlokas.splice(c.shlokas.indexOf(s), 1);
      },
      deleteLabel: "श्लोक हटाएँ · Delete shlok",
    }));
  }

  function editChapterForm(c) {
    return form(`अध्याय ${c.n} संपादित करें`, [
      field("अध्याय संख्या · Chapter number", "n", c.n, { type: "number" }),
      field("संस्कृत नाम", "sa", c.sa),
      field("Roman name", "tr", c.tr),
      field("हिन्दी नाम", "hi", c.hi),
      field("English name", "en", c.en),
      field("सार (हिन्दी)", "sum_hi", c.sum_hi, { rows: 4 }),
      field("Summary (English)", "sum_en", c.sum_en, { rows: 4 }),
      field("पुष्पिका · Colophon", "colophon", c.colophon, { rows: 3 }),
    ], {
      onSave: (d) => {
        const n = parseInt(d.n, 10);
        if (!(n > 0)) { toast("Chapter number must be positive", "error"); return false; }
        if (n !== c.n && findChapter(n)) { toast(`Chapter ${n} already exists`, "error"); return false; }
        const moved = n !== c.n;
        Object.assign(c, { n, sa: d.sa.trim(), tr: d.tr.trim(), hi: d.hi.trim(), en: d.en.trim(), sum_hi: d.sum_hi.trim(), sum_en: d.sum_en.trim(), colophon: d.colophon.trim() });
        chapters().sort((a, b) => a.n - b.n);
        if (moved) setTimeout(() => { location.hash = `#/c/${n}`; }, 0);
      },
      onDelete: () => {
        const typed = prompt(`पूरा अध्याय ${c.n} (${c.shlokas.length} श्लोक) हटेगा। पुष्टि के लिए अध्याय संख्या ${c.n} लिखें:\nType ${c.n} to delete the whole chapter.`);
        if (typed !== String(c.n)) return false;
        chapters().splice(chapters().indexOf(c), 1);
        setTimeout(() => { location.hash = "#/chapters"; }, 0);
      },
      deleteLabel: "अध्याय हटाएँ · Delete chapter",
    });
  }

  function editHomeForm() {
    const site = S.content.site;
    return form("मुखपृष्ठ · Home page", [
      field("शीर्षक · Site title", "title", site.title),
      field("उपशीर्षक · Subtitle", "subtitle", site.subtitle),
      field("सूचना · Announcement (optional, shows as a banner)", "announcement", site.announcement, { rows: 2 }),
      field("परिचय · Introduction (markdown)", "intro", site.intro, { rows: 8 }),
    ], { onSave: (d) => { Object.assign(site, d); } });
  }

  function editPageForm(p, isNew = false) {
    return form(isNew ? "नया पृष्ठ · New page" : "पृष्ठ संपादित करें · Edit page", [
      field("शीर्षक · Title", "title", p.title),
      field("सामग्री · Content (markdown: ## heading, **bold**, - list, [link](url))", "body", p.body, { rows: 14 }),
    ], {
      onSave: (d) => {
        if (!d.title.trim()) { toast("Title required", "error"); return false; }
        if (isNew) {
          let id = slug(d.title), i = 2;
          while (S.content.pages.some((x) => x.id === id)) id = `${slug(d.title)}-${i++}`;
          S.content.pages.push({ id, title: d.title.trim(), body: d.body });
          setTimeout(() => { location.hash = `#/p/${id}`; }, 0);
        } else Object.assign(p, { title: d.title.trim(), body: d.body });
      },
      onDelete: isNew ? null : () => {
        if (!confirm(`“${p.title}” पृष्ठ हटाएँ? · Delete this page?`)) return false;
        S.content.pages.splice(S.content.pages.indexOf(p), 1);
        setTimeout(() => { location.hash = "#/"; }, 0);
      },
    });
  }

  function addShlok(c) {
    const v = (c.shlokas.at(-1)?.v || 0) + 1;
    c.shlokas.push({ v, sa: "", tr: "", hi: "", en: "", note: "" });
    S.editing = `s:${c.n}:${v}`;
    markDirty();
    rerender();
    $(`#s-${c.n}-${v}`)?.scrollIntoView({ block: "center" });
  }

  function addChapter() {
    const n = Math.max(0, ...chapters().map((c) => c.n)) + 1;
    chapters().push({ n, sa: "", tr: "", en: `Chapter ${n}`, hi: `अध्याय ${n}`, sum_hi: "", sum_en: "", colophon: "", shlokas: [] });
    markDirty();
    S.editing = `c:${n}`;
    S.keepEditing = true;
    location.hash = `#/c/${n}`;
  }

  /* ---------- admin: draft, bar, publish ---------- */
  function markDirty() {
    S.dirty = true;
    S.content.updated = new Date().toISOString();
    store.set(LS.draft, { base: S.enc.data.slice(0, 64), content: S.content, config: S.config, pendingPassword: S.pendingPassword })
      || toast("Draft too large to keep in this browser — publish soon.", "error");
    updateAdminBar();
  }

  function restoreDraft() {
    const d = store.get(LS.draft);
    if (!d) return;
    if (d.base !== S.enc.data.slice(0, 64) &&
      !confirm("You have unpublished edits from earlier, but the live site has changed since then.\n\nOK = keep my unpublished edits (they will replace the live version when published)\nCancel = discard them and load the live version")) {
      store.del(LS.draft);
      return;
    }
    S.content = d.content; S.config = d.config || S.config; S.pendingPassword = d.pendingPassword || null; S.dirty = true;
    setTimeout(() => toast("Unpublished changes restored from this browser."), 300);
  }

  function adminBar() {
    return h("div", { class: "admin-bar", id: "admin-bar" },
      h("span", { class: "admin-pill" }, "ADMIN"),
      h("span", { id: "admin-status", class: "admin-status" }),
      h("a", { class: "btn small ghost", href: "#/admin" }, "⚙ Settings"),
      h("a", { class: "btn small ghost", href: "gita.html", target: "_blank" }, "Public view ↗"),
      h("button", { class: "btn small ghost", id: "discard-btn", onclick: discardDraft }, "Discard"),
      h("button", { class: "btn small primary", id: "publish-btn", onclick: publish }, "Publish"));
  }

  function updateAdminBar() {
    if (!ADMIN || !$("#admin-status")) return;
    $("#admin-status").textContent = S.dirty ? "● Unpublished changes" : "✓ Everything is published";
    $("#admin-status").classList.toggle("dirty", S.dirty);
    $("#publish-btn").disabled = !S.dirty;
    $("#discard-btn").hidden = !S.dirty;
  }

  function discardDraft() {
    if (!confirm("Throw away all unpublished changes and reload the live version?")) return;
    store.del(LS.draft);
    location.reload();
  }

  function ghSettings() {
    const g = S.config.github || {};
    let { owner, repo } = g;
    const m = location.hostname.match(/^([^.]+)\.github\.io$/);
    if (m && !owner) owner = m[1];
    if (m && !repo) repo = location.pathname.split("/").filter(Boolean)[0] || `${m[1]}.github.io`;
    return { owner, repo, branch: g.branch || "main", token: store.get(LS.ghToken, "") };
  }

  async function gh(path, opts = {}) {
    const { owner, repo, token } = ghSettings();
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, {
      ...opts,
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) },
    });
    if (!res.ok && res.status !== 404) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`GitHub ${res.status}: ${body.message || res.statusText}`);
    }
    return res;
  }

  async function ghPutFile(path, text, message) {
    const { branch } = ghSettings();
    const cur = await gh(`/contents/${path}?ref=${encodeURIComponent(branch)}`);
    const sha = cur.status === 404 ? undefined : (await cur.json()).sha;
    await gh(`/contents/${path}`, {
      method: "PUT",
      body: JSON.stringify({ message, branch, sha, content: bytesToB64(enc8.encode(text)) }),
    });
  }

  async function publish() {
    const { owner, repo, token } = ghSettings();
    if (!owner || !repo || !token) {
      toast("Add your GitHub details in Settings first.", "error");
      location.hash = "#/admin";
      return;
    }
    const btn = $("#publish-btn");
    btn.disabled = true; btn.textContent = "Publishing…";
    try {
      const password = S.pendingPassword || S.password;
      S.content.updated = new Date().toISOString();
      const blob = await encryptContent(S.content, password);
      const stamp = new Date().toLocaleString();
      await ghPutFile("data/config.json", JSON.stringify(S.config, null, 2) + "\n", `Update site settings (${stamp})`);
      await ghPutFile("data/gita.enc", JSON.stringify(blob), `Update content (${stamp})`);
      S.enc = blob; S.password = password; S.pendingPassword = null; S.dirty = false;
      if (store.get(LS.auth)) store.set(LS.auth, { name: S.name, password });
      store.del(LS.draft);
      toast("✓ Published. The public link updates in about a minute.");
    } catch (e) {
      toast(`Publish failed — ${e.message}`, "error");
    } finally {
      btn.textContent = "Publish";
      updateAdminBar();
    }
  }

  /* ---------- admin: settings ---------- */
  function viewSettings() {
    const g = ghSettings();
    const cfg = S.config;
    const section = (title, ...kids) => h("section", { class: "settings-card" }, h("h2", null, title), kids);

    const ghForm = h("form", {
      class: "stack",
      onsubmit: async (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.currentTarget));
        cfg.github = { owner: d.owner.trim(), repo: d.repo.trim(), branch: d.branch.trim() || "main" };
        if (d.token.trim()) store.set(LS.ghToken, d.token.trim());
        markDirty();
        try {
          const res = await gh("");
          if (res.status === 404) throw new Error("Repository not found — check owner/repo, and that the token can access it.");
          const info = await res.json();
          if (!info.permissions?.push) throw new Error("This token can read the repository but cannot write to it.");
          toast(`✓ Connected to ${info.full_name}`);
        } catch (err) { toast(err.message, "error"); }
      },
    },
      h("div", { class: "row" }, field("GitHub username (owner)", "owner", g.owner), field("Repository name", "repo", g.repo), field("Branch", "branch", g.branch)),
      field("Personal access token", "token", "", { type: "password", hint: g.token ? "A token is saved in this browser. Leave blank to keep it." : "Fine-grained token with “Contents: Read and write” on this repository only. Stored only in this browser." }),
      h("div", { class: "edit-actions" },
        h("button", { class: "btn primary" }, "Save & test connection"),
        g.token ? h("button", { class: "btn", type: "button", onclick: () => { store.del(LS.ghToken); toast("Token removed from this browser"); rerender(); } }, "Forget token") : null));

    const pwForm = h("form", {
      class: "stack",
      onsubmit: (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.currentTarget));
        if (d.p1.length < 6) return toast("Use at least 6 characters.", "error");
        if (d.p1 !== d.p2) return toast("The two passwords don't match.", "error");
        S.pendingPassword = d.p1;
        markDirty();
        e.currentTarget.reset();
        toast("New password set. It takes effect when you Publish — then share it with your readers.");
        rerender();
      },
    },
      S.pendingPassword ? h("p", { class: "warn" }, "A new password is waiting to be published.") : null,
      h("div", { class: "row" }, field("New password", "p1", "", { type: "password" }), field("Repeat new password", "p2", "", { type: "password" })),
      h("p", { class: "muted" }, "Everyone (including you) will need the new password after you publish. Readers who saved the old one will be asked again."),
      h("button", { class: "btn primary" }, "Change password"));

    const siteForm = h("form", {
      class: "stack",
      onsubmit: (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.currentTarget));
        cfg.title = d.title.trim(); cfg.tagline = d.tagline.trim();
        markDirty(); toast("Saved — publish to apply.");
      },
    },
      field("Title on the login screen", "title", cfg.title),
      field("Line under the title on the login screen", "tagline", cfg.tagline),
      h("p", { class: "muted" }, "These two are visible before login, so don't put private content here."),
      h("button", { class: "btn primary" }, "Save"));

    const chatForm = h("form", {
      class: "stack",
      onsubmit: (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.currentTarget));
        cfg.chatUrl = d.chatUrl.trim().replace(/\/$/, "");
        S.content.chat = { ...(S.content.chat || {}), token: d.chatToken.trim() };
        if (d.adminKey.trim()) store.set(LS.adminKey, d.adminKey.trim());
        markDirty(); toast("Saved — publish so readers get it.");
      },
    },
      field("Worker URL", "chatUrl", cfg.chatUrl, { hint: "e.g. https://gita-sakha.yourname.workers.dev" }),
      field("Chat token (same value as the CHAT_TOKEN secret in the worker)", "chatToken", S.content.chat?.token, { hint: "Kept inside the encrypted content, so only logged-in readers have it." }),
      field("Worker admin key (for the visitor log; ADMIN_KEY secret)", "adminKey", "", { type: "password", hint: store.get(LS.adminKey) ? "Saved in this browser. Leave blank to keep it." : "Optional." }),
      h("div", { class: "edit-actions" },
        h("button", { class: "btn primary" }, "Save"),
        h("button", { class: "btn", type: "button", onclick: (e) => { e.target.closest("form").chatToken.value = bytesToB64(crypto.getRandomValues(new Uint8Array(24))).replace(/[+/=]/g, ""); } }, "Generate new token")));

    const limitInput = h("input", { type: "number", min: 0, max: 1000, name: "limit", placeholder: "…" });
    const limitForm = h("form", {
      class: "stack",
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const res = await fetch(`${cfg.chatUrl}/config`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-admin-key": store.get(LS.adminKey, "") },
            body: JSON.stringify({ daily_limit: Number(limitInput.value) }),
          });
          const out = await res.json();
          if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
          limitInput.value = out.daily_limit;
          toast(out.daily_limit ? `✓ Each reader can now ask ${out.daily_limit} questions a day.` : "✓ No daily limit.");
        } catch (err) { toast(`Couldn't save the limit — ${err.message}`, "error"); }
      },
    },
      h("label", { class: "field" }, h("span", null, "Questions per reader per day (0 = no limit). Admin is never limited; it resets at midnight India time."), limitInput),
      h("button", { class: "btn primary", disabled: !cfg.chatUrl }, "Save limit"));
    if (cfg.chatUrl && store.get(LS.adminKey)) {
      fetch(`${cfg.chatUrl}/config`, { headers: { "x-admin-key": store.get(LS.adminKey) } })
        .then((r) => r.json()).then((d) => { if (d.daily_limit != null) limitInput.value = d.daily_limit; }).catch(() => {});
    }

    const visitors = h("div", { class: "visitors" }, h("p", { class: "muted" }, "Shows who logged in (needs the worker with a VISITS store)."));
    const loadVisitors = async () => {
      visitors.replaceChildren(h("p", { class: "muted" }, "Loading…"));
      try {
        const res = await fetch(`${cfg.chatUrl}/visits`, { headers: { "x-admin-key": store.get(LS.adminKey, "") } });
        if (!res.ok) throw new Error(`HTTP ${res.status} — ${await res.text()}`);
        const { visits } = await res.json();
        visitors.replaceChildren(visits.length ? h("table", { class: "table" },
          h("thead", null, h("tr", null, h("th", null, "Name"), h("th", null, "When"), h("th", null, "Where"))),
          h("tbody", null, visits.map((v) => h("tr", null, h("td", null, v.name), h("td", null, new Date(v.at).toLocaleString()), h("td", null, v.country || "—"))))) : h("p", null, "No visits yet."));
      } catch (e) { visitors.replaceChildren(h("p", { class: "warn" }, `Couldn't load: ${e.message}`)); }
    };

    const importInput = h("input", {
      type: "file", accept: "application/json,.json", hidden: true,
      onchange: async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const obj = JSON.parse(await file.text());
          if (!Array.isArray(obj.chapters) || !obj.site) throw new Error("This doesn't look like a Gita Gyan backup.");
          if (!confirm(`Replace ALL content with “${file.name}” (${obj.chapters.length} chapters)? You can still Discard before publishing.`)) return;
          S.content = obj; markDirty(); toast("Backup loaded — publish to make it live."); location.hash = "#/";
        } catch (err) { toast(err.message, "error"); }
      },
    });

    return h("div", { class: "settings" },
      h("h1", { class: "page-title" }, "Admin settings"),
      section("1 · Publishing (GitHub)",
        h("p", { class: "muted" }, "Publish saves your edits to the GitHub repository; GitHub Pages then updates the public link automatically."),
        ghForm),
      section("2 · Readers' access password", pwForm),
      section("3 · Login screen", siteForm),
      section("4 · Gita Sakha (AI agent)",
        h("p", { class: "muted" }, "Needs the free Cloudflare Worker from the worker/ folder (see README)."),
        chatForm),
      section("5 · Gita Sakha daily limit",
        h("p", { class: "muted" }, "Keeps your Claude cost in check. Needs the Worker admin key saved in section 4."),
        limitForm),
      section("6 · Visitor log", visitors, h("button", { class: "btn", onclick: loadVisitors, disabled: !cfg.chatUrl }, "Load visitor log")),
      section("7 · Backup",
        h("p", { class: "muted" }, "Download everything as a plain JSON file (keep it private — it's unencrypted), or restore from one."),
        h("div", { class: "edit-actions" },
          h("button", { class: "btn", onclick: () => downloadJson(S.content, `gita-gyan-backup-${new Date().toISOString().slice(0, 10)}.json`) }, "⬇ Download backup"),
          h("button", { class: "btn", onclick: () => importInput.click() }, "⬆ Restore from backup"), importInput)));
  }

  function downloadJson(obj, filename) {
    const a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: "application/json" })), download: filename });
    document.body.append(a); a.click(); a.remove();
  }

  /* ---------- Gita Sakha: the in-site agent ----------
   * The worker holds the Claude API key and fixes model/system prompt/tools.
   * Tools run here in the browser, against the decrypted text of this site. */
  const TOOL_LIMIT = 8;

  const tools = {
    get_shlokas({ chapter, start_verse, end_verse }) {
      const c = findChapter(chapter);
      if (!c) return { error: `Chapter ${chapter} not found. Chapters: 1–${chapters().length}.` };
      const end = Math.min(end_verse ?? start_verse, start_verse + 14);
      const list = c.shlokas.filter((s) => s.v >= start_verse && s.v <= end);
      if (!list.length) return { error: `No verses ${chapter}.${start_verse}–${end}. Chapter ${chapter} has ${c.shlokas.length} verses.` };
      return {
        chapter: `${c.n} · ${c.sa} (${c.en})`,
        shlokas: list.map((s) => ({ ref: `${c.n}.${s.v}`, sanskrit: s.sa, transliteration: s.tr, hindi_bhavarth: s.hi, english_purohit_swami: s.en, note: s.note || undefined })),
      };
    },
    search_gita({ query }) {
      const words = fold(query).split(/\s+/).filter((w) => w.length > 1);
      if (!words.length) return { results: [] };
      const scored = [];
      for (const { c, s } of allShlokas()) {
        const hay = fold(`${s.hi} ${s.en} ${s.tr} ${s.sa} ${s.note}`);
        const score = words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
        if (score) scored.push({ score, ref: `${c}.${s.v}`, english: s.en.slice(0, 160), hindi: s.hi.slice(0, 120) });
      }
      scored.sort((a, b) => b.score - a.score);
      return { results: scored.slice(0, 12) };
    },
    get_chapter({ chapter }) {
      const c = findChapter(chapter);
      if (!c) return { error: `Chapter ${chapter} not found.` };
      return { chapter: c.n, sanskrit_name: c.sa, transliteration: c.tr, hindi_name: c.hi, english_name: c.en, verse_count: c.shlokas.length, summary_hindi: c.sum_hi, summary_english: c.sum_en };
    },
  };
  const toolLabel = (name, input) => ({
    get_shlokas: `📖 श्लोक ${input.chapter}.${input.start_verse}${input.end_verse && input.end_verse !== input.start_verse ? "–" + input.end_verse : ""} पढ़ रहे हैं`,
    search_gita: `🔎 खोज: “${input.query}”`,
    get_chapter: `📜 अध्याय ${input.chapter} देख रहे हैं`,
  }[name] || name);

  /* Voice: ask by speaking and hear answers read aloud.
   * Asking records a short clip, which the worker turns into text with Whisper (it detects the language itself);
   * reading aloud uses the browser's own voices. */
  const voice = (() => {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    // Read-aloud picks a voice from the script of each sentence.
    const SCRIPTS = [
      [/[ঀ-৿]/g, "bn-IN"], [/[઀-૿]/g, "gu-IN"], [/[਀-੿]/g, "pa-IN"], [/[଀-୿]/g, "or-IN"],
      [/[஀-௿]/g, "ta-IN"], [/[ఀ-౿]/g, "te-IN"], [/[ಀ-೿]/g, "kn-IN"], [/[ഀ-ൿ]/g, "ml-IN"],
      [/[؀-ۿ]/g, "ur-IN"], [/[ऀ-ॿ]/g, "deva"], [/[A-Za-z]/g, "en-IN"],
    ];
    // Whisper reports languages as names or codes; these are the Devanagari ones that aren't Hindi.
    const DEVA_LANGS = { marathi: "mr-IN", mr: "mr-IN", nepali: "ne-NP", ne: "ne-NP" };
    let lastSpoken = null;   // language Whisper heard last, used to pick a Devanagari voice
    const langOfText = (t) => {
      let best = "en-IN", most = 0;
      for (const [re, lang] of SCRIPTS) { const n = (t.match(re) || []).length; if (n > most) { most = n; best = lang; } }
      if (best === "deva") best = DEVA_LANGS[String(lastSpoken || "").toLowerCase()] || "hi-IN";
      return best;
    };

    // 16 kHz mono WAV: one format every speech model accepts, whatever the phone recorded.
    async function toWav16k(blob) {
      const decodeCtx = new Ctx();
      const decoded = await decodeCtx.decodeAudioData(await blob.arrayBuffer());
      decodeCtx.close();
      const rate = 16000;
      const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
      const src = offline.createBufferSource();
      src.buffer = decoded; src.connect(offline.destination); src.start();
      const pcm = (await offline.startRendering()).getChannelData(0);
      const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
      const str = (o, t) => [...t].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
      str(0, "RIFF"); out.setUint32(4, 36 + pcm.length * 2, true); str(8, "WAVE"); str(12, "fmt ");
      out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
      out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
      str(36, "data"); out.setUint32(40, pcm.length * 2, true);
      for (let i = 0; i < pcm.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
      return new Blob([out], { type: "audio/wav" });
    }

    let session = null;   // the recording in progress
    const v = {
      canListen: !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder && Ctx),
      canSpeak: "speechSynthesis" in window,
      speakingId: null,
      async toggleListen() {
        if (session) { session.stop("tap"); return; }
        if (!v.canListen) {
          toast("इस ब्राउज़र में आवाज़ रिकॉर्ड नहीं होती — Chrome या Safari में खोलें, या कीबोर्ड का 🎤 बटन इस्तेमाल करें।", "error");
          return;
        }
        if (!S.config.chatUrl) { toast("आवाज़ से पूछना AI जुड़ने के बाद चलेगा · Voice needs the AI agent to be set up.", "error"); return; }
        if (S.chat.busy) return;
        v.stopSpeaking();
        const btn = $("#mic-btn"), label = $("#mic-label");
        const idle = "बोलकर पूछें · Ask by voice";
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        } catch (e) {
          toast(e.name === "NotFoundError" ? "माइक नहीं मिला · No microphone found." : "माइक की अनुमति दें — ब्राउज़र में Allow करें · Please allow the microphone.", "error");
          return;
        }
        const recorder = new MediaRecorder(stream);
        const chunks = [];
        recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        // Listen to the level to know when the reader starts and stops speaking.
        const ctx = new Ctx();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        const started = performance.now();
        let floor = null, spoke = false, lastVoice = 0, why = null;
        const tick = setInterval(() => {
          analyser.getFloatTimeDomainData(buf);
          const rms = Math.sqrt(buf.reduce((a, x) => a + x * x, 0) / buf.length);
          const t = performance.now() - started;
          if (t < 400) { floor = Math.max(floor || 0, rms); return; }          // learn the room noise
          const loud = rms > Math.max(0.015, (floor || 0) * 2.5);
          btn.style.setProperty("--level", Math.min(1, rms * 12).toFixed(2));
          if (loud) { spoke = true; lastVoice = t; }
          if (spoke && t - lastVoice > 1800) session.stop("silence");          // finished speaking
          else if (!spoke && t > 8000) session.stop("nothing");               // never spoke
          else if (t > 45000) session.stop("max");                            // safety cap
        }, 100);
        session = {
          stop(reason) { if (why) return; why = reason; clearInterval(tick); if (recorder.state !== "inactive") recorder.stop(); },
        };
        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          ctx.close();
          session = null;
          btn.classList.remove("listening");
          btn.style.removeProperty("--level");
          if (!spoke) { label.textContent = idle; toast("कुछ सुनाई नहीं दिया — माइक के पास बोलें · Didn't hear anything, please try again."); return; }
          btn.classList.add("working"); btn.disabled = true;
          label.textContent = "समझ रहे हैं… · Understanding…";
          try {
            const wav = await toWav16k(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
            const res = await fetch(`${S.config.chatUrl}/transcribe`, {
              method: "POST",
              headers: {
                "content-type": "audio/wav", "x-chat-token": S.content.chat?.token || "",
                "x-lang-hint": (navigator.languages || [navigator.language]).join(","),
                ...(ADMIN && store.get(LS.adminKey) ? { "x-admin-key": store.get(LS.adminKey) } : {}),
              },
              body: wav,
            });
            const out = await res.json().catch(() => ({}));
            if (res.status === 429) throw new Error("आज की आवाज़ सीमा पूरी हो गई — लिखकर पूछें · Today's voice limit is used up, please type.");
            if (!res.ok) throw new Error(typeof out.error === "string" ? out.error : `HTTP ${res.status}`);
            if (!out.text) throw new Error("आवाज़ साफ़ समझ नहीं आई — फिर से बोलें · Couldn't make that out, please try again.");
            lastSpoken = out.language;
            const ta = $("#chat-text");
            ta.value = out.text;
            chatSend();
          } catch (e) {
            toast(e.message, "error");
          } finally {
            btn.classList.remove("working"); btn.disabled = false;
            label.textContent = idle;
          }
        };
        recorder.start(250);
        btn.classList.add("listening");
        label.textContent = "सुन रहे हैं… बोलिए · Listening, speak now";
      },
      toggleSpeak(id, html) {
        if (v.speakingId === id) { v.stopSpeaking(); return; }
        v.stopSpeaking();
        const div = document.createElement("div");
        div.innerHTML = html;
        const text = div.textContent.replace(/\s+/g, " ").trim();
        // Each sentence goes to the voice for its script; neighbours in the same language are joined
        // (short pieces also avoid browsers cutting long utterances off part-way).
        const parts = text.split(/(?<=[।॥.!?:])\s+|(?=English:)/).filter((p) => p.trim());
        const chunks = [];
        for (const p of parts) {
          const last = chunks[chunks.length - 1], lang = langOfText(p);
          if (last && last.lang === lang && (last.text + p).length < 220) last.text += " " + p;
          else chunks.push({ lang, text: p });
        }
        const voices = speechSynthesis.getVoices();
        v.speakingId = id;
        chunks.forEach(({ lang, text: c }, n) => {
          const u = new SpeechSynthesisUtterance(c.trim());
          u.lang = lang;
          u.voice = voices.find((x) => x.lang === lang) || voices.find((x) => x.lang.startsWith(lang.slice(0, 2))) || null;
          u.rate = 0.95;
          if (n === chunks.length - 1) u.onend = () => { if (v.speakingId === id) { v.speakingId = null; chatRender(); } };
          speechSynthesis.speak(u);
        });
        chatRender();
      },
      stopSpeaking() {
        if (v.canSpeak) speechSynthesis.cancel();
        if (v.speakingId != null) { v.speakingId = null; chatRender(); }
      },
    };
    if (v.canSpeak) speechSynthesis.getVoices(); // starts loading the voice list
    return v;
  })();

  function chatMount() {
    const saved = session.get("gg-chat");
    if (saved) { S.chat.messages = saved.messages || []; S.chat.view = saved.view || []; }
    document.body.append(
      h("button", { class: "chat-fab", id: "chat-fab", onclick: () => chatOpen(), "aria-label": "गीता सखा से बात करें" }, h("span", null, "🙏"), h("span", { class: "fab-label" }, "गीता सखा")),
      h("aside", { class: "chat", id: "chat", "aria-label": "Gita Sakha", hidden: true },
        h("header", { class: "chat-head" },
          h("div", null, h("strong", null, "🙏 गीता सखा"), h("small", null, "Gita Sakha — गीता पर गहन चर्चा")),
          h("div", null,
            h("button", { class: "icon-btn", title: "नई बातचीत · New conversation", onclick: chatReset }, "↺"),
            h("button", { class: "icon-btn", title: "बंद करें · Close", onclick: chatClose }, "✕"))),
        h("div", { class: "chat-log", id: "chat-log", "aria-live": "polite" }),
        h("div", { class: "voice-bar" },
          h("button", { class: "mic-btn", id: "mic-btn", type: "button", "aria-label": "Ask by voice", onclick: () => voice.toggleListen() },
            h("span", { class: "mic-icon", html: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.93V20h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.07A7 7 0 0 1 5 11a1 1 0 1 1 2 0 5 5 0 0 0 10 0Z"/></svg>' }),
            h("span", { class: "mic-label", id: "mic-label" }, "बोलकर पूछें · Ask by voice"))),
        h("form", { class: "chat-input", onsubmit: (e) => { e.preventDefault(); chatSend(); } },
          h("textarea", {
            id: "chat-text", rows: 2, placeholder: "प्रश्न लिखें या बोलें — किसी भी भाषा में · Type or speak in any language",
            onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); chatSend(); } },
          }),
          h("button", { class: "btn primary", id: "chat-send", type: "submit" }, "भेजें")),
        h("div", { class: "chat-remaining", id: "chat-remaining", hidden: true })));
    chatRender();
  }

  function chatOpen(prefill) {
    $("#chat").hidden = false;
    $("#chat-fab").hidden = true;
    S.chat.open = true;
    const ta = $("#chat-text");
    if (prefill) ta.value = prefill;
    ta.focus();
  }
  function chatClose() { voice.stopSpeaking(); $("#chat").hidden = true; $("#chat-fab").hidden = false; S.chat.open = false; }
  function chatReset() {
    if (S.chat.busy) return;
    voice.stopSpeaking();
    S.chat.messages = []; S.chat.view = [];
    chatSave(); chatRender();
  }
  function chatSave() { session.set("gg-chat", { messages: S.chat.messages, view: S.chat.view }); }

  function chatRender() {
    const log = $("#chat-log");
    if (!log) return;
    const left = $("#chat-remaining");
    if (left) {
      left.hidden = ADMIN || S.chat.remaining == null;
      left.textContent = `आज शेष प्रश्न: ${S.chat.remaining} · Questions left today`;
    }
    if (!S.chat.view.length) {
      const ideas = ["कर्मयोग क्या है? सरल भाषा में समझाइए।", "मन बहुत चंचल है — गीता इसे वश में करने के क्या उपाय बताती है?", "Explain 2.47 in depth with examples from daily life.", "स्थितप्रज्ञ के लक्षण क्या हैं?"];
      log.replaceChildren(h("div", { class: "chat-welcome" },
        h("p", null, `नमस्ते ${S.name} 🙏`),
        h("p", null, "मैं गीता सखा हूँ। गीता के किसी भी श्लोक, विषय या जीवन से जुड़े प्रश्न पर विस्तार से चर्चा कर सकते हैं।"),
        h("p", { class: "muted" }, "किसी भी भाषा में लिखें या 🎤 दबाकर बोलें — भाषा अपने-आप पहचानी जाएगी। Type or speak in any language — it's detected automatically."),
        h("div", { class: "ideas" }, ideas.map((q) => h("button", { class: "chip", onclick: () => { $("#chat-text").value = q; chatSend(); } }, q)))));
      return;
    }
    log.replaceChildren(...S.chat.view.map((m, i) => {
      if (m.role === "user") return h("div", { class: "msg user" }, m.text);
      if (m.role === "tool") return h("div", { class: "msg tool" }, m.text);
      if (m.role === "error") return h("div", { class: "msg error" }, m.text);
      const html = md(m.text, { linkRefs: true });
      return h("div", { class: "msg bot" },
        h("div", { class: "prose", html: html || "<span class='typing'>…</span>" }),
        html && voice.canSpeak ? h("button", {
          class: `speak-btn ${voice.speakingId === i ? "on" : ""}`, type: "button",
          title: "सुनें · Read aloud", onclick: () => voice.toggleSpeak(i, html),
        }, voice.speakingId === i ? "⏹ रोकें" : "🔊 सुनें") : null);
    }));
    log.scrollTop = log.scrollHeight;
  }

  async function chatSend() {
    const ta = $("#chat-text");
    const text = ta.value.trim();
    if (!text || S.chat.busy) return;
    if (!S.config.chatUrl) {
      S.chat.view.push({ role: "user", text }, { role: "bot", text: offlineAnswer(text) });
      ta.value = ""; chatSave(); chatRender(); return;
    }
    ta.value = "";
    S.chat.busy = true; $("#chat-send").disabled = true;
    S.chat.messages.push({ role: "user", content: text });
    S.chat.view.push({ role: "user", text });
    const historyMark = S.chat.messages.length - 1;
    try {
      for (let turn = 0; turn < TOOL_LIMIT; turn++) {
        const bubble = { role: "bot", text: "" };
        S.chat.view.push(bubble);
        chatRender();
        const { content, stopReason } = await streamTurn((t) => { bubble.text += t; chatRender(); });
        if (!bubble.text) S.chat.view.splice(S.chat.view.indexOf(bubble), 1);
        if (stopReason === "refusal") {
          S.chat.messages.length = historyMark; // drop this exchange from what we send next time
          S.chat.view.push({ role: "error", text: "क्षमा करें, इस प्रश्न का उत्तर मैं नहीं दे सकता। कृपया प्रश्न दूसरे ढंग से पूछें।" });
          break;
        }
        S.chat.messages.push({ role: "assistant", content });
        if (stopReason !== "tool_use") {
          if (stopReason === "max_tokens") S.chat.view.push({ role: "error", text: "(उत्तर लंबा होने के कारण यहीं रुका — “आगे बताइए” लिखें।)" });
          break;
        }
        const results = [];
        for (const block of content.filter((b) => b.type === "tool_use")) {
          S.chat.view.push({ role: "tool", text: toolLabel(block.name, block.input || {}) });
          let out;
          try { out = tools[block.name] ? tools[block.name](block.input || {}) : { error: `Unknown tool ${block.name}` }; } catch (e) { out = { error: String(e.message || e) }; }
          results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out), is_error: !!out.error || undefined });
        }
        S.chat.messages.push({ role: "user", content: results });
        chatRender();
      }
    } catch (e) {
      S.chat.messages.length = historyMark;
      console.warn("Gita Sakha AI unavailable:", e.message);
      S.chat.view = S.chat.view.filter((m) => !(m.role === "bot" && !m.text)); // drop the empty "typing" bubble
      const note = e.dailyLimit
        ? `आज के प्रश्नों की सीमा${typeof e.dailyLimit === "number" ? ` (${e.dailyLimit})` : ""} पूरी हो गई — कल फिर पूछें। तब तक गीता से सीधे उत्तर:`
        : "AI अभी उपलब्ध नहीं है — गीता से सीधे उत्तर:";
      if (e.dailyLimit) S.chat.remaining = 0;
      S.chat.view.push({ role: "tool", text: note }, { role: "bot", text: offlineAnswer(text) });
    } finally {
      S.chat.busy = false; $("#chat-send").disabled = false;
      chatSave(); chatRender();
    }
  }

  /* Built-in Gita Sakha: answers straight from the site's text when the AI worker
   * isn't connected (or can't be reached) — topic guide + verse lookup + search. */
  const TOPICS = [
    { hi: "कर्म और कर्तव्य", en: "Action & duty", keys: ["कर्म", "कर्तव्य", "काम कैसे", "karma", "karm", "duty", "work", "action", "फल"], refs: ["2.47", "2.48", "3.8", "3.19", "18.47"],
      note: "गीता का मूल संदेश — कर्म पूरे मन से करो, पर फल की चिंता और आसक्ति छोड़ दो।" },
    { hi: "मन को वश में करना", en: "Mastering the mind", keys: ["मन", "चंचल", "ध्यान", "एकाग्र", "mind", "mann", "man ko", "focus", "concentrat", "meditat", "dhyan"], refs: ["6.5", "6.6", "6.26", "6.34", "6.35"],
      note: "मन चंचल है, पर अभ्यास और वैराग्य से वश में आता है — और मनुष्य स्वयं ही अपना मित्र है।" },
    { hi: "क्रोध", en: "Anger", keys: ["क्रोध", "गुस्सा", "गुस्से", "anger", "angry", "gussa", "krodh"], refs: ["2.62", "2.63", "3.37", "16.21"],
      note: "विषयों के चिंतन से आसक्ति, आसक्ति से कामना और कामना से क्रोध जन्म लेता है — इस शृंखला को पहचानना ही पहला उपाय है।" },
    { hi: "चिंता, भय और तनाव", en: "Worry, fear & stress", keys: ["चिंता", "डर", "भय", "तनाव", "परेशान", "fear", "worry", "anxiety", "stress", "tension", "chinta", "dar "], refs: ["2.14", "2.56", "9.22", "18.66"],
      note: "सुख-दुःख आते-जाते हैं; जो भगवान की शरण लेता है, उसके योगक्षेम का भार वे स्वयं उठाते हैं।" },
    { hi: "दुःख और शोक", en: "Grief & sorrow", keys: ["दुःख", "दुख", "शोक", "उदास", "sad", "grief", "sorrow", "depress", "dukh"], refs: ["2.11", "2.14", "2.15", "6.22", "6.23"],
      note: "ज्ञानी न गए हुओं के लिए शोक करते हैं, न रहने वालों के लिए — सुख-दुःख में सम रहने वाला ही अमरता का अधिकारी है।" },
    { hi: "मृत्यु और आत्मा", en: "Death & the Self", keys: ["मृत्यु", "मौत", "मरना", "आत्मा", "पुनर्जन्म", "death", "die", "soul", "atma", "rebirth", "reincarnat"], refs: ["2.20", "2.22", "2.23", "2.27", "8.6"],
      note: "आत्मा न जन्मती है न मरती है — जैसे मनुष्य पुराने वस्त्र बदलता है, वैसे ही आत्मा शरीर बदलती है।" },
    { hi: "भक्ति", en: "Devotion", keys: ["भक्ति", "भक्त", "पूजा", "प्रेम", "प्रार्थना", "bhakti", "devotion", "devotee", "worship", "prayer", "love god"], refs: ["9.22", "9.26", "12.13", "12.14", "18.65"],
      note: "प्रेम से अर्पित एक पत्ता, फूल, फल या जल भी भगवान स्वीकार करते हैं — भक्त के लक्षण अध्याय 12 में सुंदरता से बताए गए हैं।" },
    { hi: "शरणागति", en: "Surrender", keys: ["शरण", "समर्पण", "surrender", "sharan", "refuge"], refs: ["18.66", "18.62", "7.14", "9.34"],
      note: "गीता का अंतिम और परम उपदेश — सब छोड़कर मेरी शरण में आओ, मैं तुम्हें सब पापों से मुक्त कर दूँगा।" },
    { hi: "सफलता, असफलता और समता", en: "Success, failure & equanimity", keys: ["सफल", "असफल", "हार", "जीत", "समता", "success", "fail", "exam", "result", "equanim", "balance"], refs: ["2.38", "2.48", "2.50", "6.9", "12.18"],
      note: "सफलता और असफलता में सम रहना ही योग है — और कर्मों में कुशलता भी योग है।" },
    { hi: "कामना, लोभ और इंद्रियाँ", en: "Desire, greed & the senses", keys: ["इच्छा", "कामना", "लोभ", "लालच", "इंद्रिय", "desire", "greed", "lust", "senses", "temptation", "addiction"], refs: ["3.37", "3.39", "3.41", "2.70", "16.21"],
      note: "काम, क्रोध और लोभ नरक के तीन द्वार हैं; इंद्रियों को वश में करके ही इस शत्रु को जीता जाता है।" },
    { hi: "स्थितप्रज्ञ", en: "The person of steady wisdom", keys: ["स्थितप्रज्ञ", "स्थिर बुद्धि", "sthitaprajna", "sthitpragya", "steady wisdom"], refs: ["2.54", "2.55", "2.56", "2.57", "2.58"],
      note: "अर्जुन के प्रश्न पर श्रीकृष्ण अध्याय 2 के अंत में स्थिर बुद्धि वाले मनुष्य के लक्षण बताते हैं।" },
    { hi: "ज्ञान और गुरु", en: "Knowledge & the teacher", keys: ["ज्ञान", "गुरु", "सीख", "knowledge", "wisdom", "guru", "teacher", "learn"], refs: ["4.34", "4.38", "4.39", "13.8"],
      note: "ज्ञान विनम्रता, प्रश्न और सेवा से ज्ञानी गुरु से प्राप्त होता है — और ज्ञान के समान पवित्र कुछ नहीं।" },
    { hi: "धर्म और अवतार", en: "Dharma & divine descent", keys: ["धर्म", "अवतार", "स्वधर्म", "dharma", "avatar", "righteous"], refs: ["4.7", "4.8", "3.35", "18.47"],
      note: "जब-जब धर्म की हानि होती है, भगवान प्रकट होते हैं — और अपना धर्म, गुणरहित भी हो, दूसरे के धर्म से श्रेष्ठ है।" },
    { hi: "आहार और संयमित जीवन", en: "Food & balanced living", keys: ["आहार", "भोजन", "खाना", "नींद", "food", "diet", "eat", "sleep"], refs: ["6.16", "6.17", "17.8", "17.9", "17.10"],
      note: "योग न बहुत खाने वाले का सधता है, न बिल्कुल न खाने वाले का — संतुलित आहार-विहार दुःख मिटाने वाला है।" },
    { hi: "तीन गुण", en: "The three gunas", keys: ["गुण", "सत्त्व", "रजो", "तमो", "guna", "sattva", "rajas", "tamas"], refs: ["14.5", "14.6", "14.7", "14.8", "14.20"],
      note: "सत्त्व, रज और तम आत्मा को बाँधते हैं; इनसे ऊपर उठने वाला गुणातीत अमृत को पाता है।" },
    { hi: "भगवान का स्वरूप", en: "Who is God?", keys: ["भगवान", "ईश्वर", "परमात्मा", "विश्वरूप", "god", "krishna", "ishwar", "divine", "vishwaroop", "universal form"], refs: ["7.7", "10.8", "10.20", "11.12", "15.15"],
      note: "सारा जगत भगवान में धागे में मणियों की तरह पिरोया है; वे सबके हृदय में स्थित हैं।" },
  ];

  function shlokBlock(ref) {
    const [c, v] = ref.split(".").map(Number);
    const s = findShlok(c, v);
    if (!s) return "";
    const sa = s.sa.split("\n").map((l) => `> ${l}`).join("\n");
    return `#### श्लोक [${ref}](#/c/${c}/${v})\n${sa}\n\n**भावार्थ:** ${s.hi}${s.en ? `\n\n*English:* ${s.en}` : ""}`;
  }

  function offlineAnswer(question) {
    const q = fold(question);
    const footer = "\n\n---\n*यह गीता सखा का बुनियादी मोड है — उत्तर सीधे गीता के श्लोकों से। गहरी चर्चा (प्रश्न-उत्तर, उदाहरण, टीकाएँ) के लिए AI जुड़ने पर पूरा मोड चालू हो जाएगा।*";
    const refs = [...question.matchAll(/\b(\d{1,2})[.:](\d{1,2})\b/g)].map((m) => `${+m[1]}.${+m[2]}`).filter((r) => findShlok(...r.split(".").map(Number)));
    if (refs.length) {
      return refs.slice(0, 4).map(shlokBlock).join("\n\n") + footer;
    }
    const chMatch = question.match(/(?:अध्याय|chapter|adhyay)\s*(\d{1,2})/i);
    if (chMatch && findChapter(+chMatch[1])) {
      const c = findChapter(+chMatch[1]);
      return `### अध्याय ${c.n} · ${c.sa}\n**${c.hi}** · *${c.en}* · ${c.shlokas.length} श्लोक\n\n${c.sum_hi}\n\n*${c.sum_en}*\n\n[पूरा अध्याय पढ़ें →](#/c/${c.n})` + footer;
    }
    const scored = TOPICS.map((t) => ({ t, score: t.keys.reduce((n, k) => n + (q.includes(fold(k)) ? 1 : 0), 0) }))
      .filter((x) => x.score).sort((a, b) => b.score - a.score);
    if (scored.length) {
      const t = scored[0].t;
      return `### ${t.hi} · ${t.en}\n${t.note}\n\n` + t.refs.slice(0, 4).map(shlokBlock).join("\n\n") +
        (scored[1] ? `\n\nसंबंधित विषय: **${scored[1].t.hi}** — पूछें "${scored[1].t.hi}"` : "") + footer;
    }
    const hits = tools.search_gita({ query: question }).results.slice(0, 3);
    if (hits.length) {
      return "आपके प्रश्न से जुड़े श्लोक:\n\n" + hits.map((h) => shlokBlock(h.ref)).join("\n\n") + footer;
    }
    return "इस प्रश्न से मेल खाता श्लोक नहीं मिला। कोई विषय लिखकर देखें — जैसे **कर्म**, **मन**, **क्रोध**, **चिंता**, **भक्ति**, **मृत्यु**, **शरणागति** — या श्लोक संख्या जैसे **2.47**, या **अध्याय 12**।" + footer;
  }

  /* One streamed Messages API turn through the worker. Rebuilds every content block
   * (thinking + signature, text, tool_use, fallback…) so they can be sent back unchanged. */
  async function streamTurn(onText) {
    const res = await fetch(`${S.config.chatUrl}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json", "x-chat-token": S.content.chat?.token || "",
        ...(ADMIN && store.get(LS.adminKey) ? { "x-admin-key": store.get(LS.adminKey) } : {}),
      },
      body: JSON.stringify({ messages: S.chat.messages, name: S.name }),
    });
    const remaining = res.headers.get("x-questions-remaining");
    if (remaining != null) S.chat.remaining = Number(remaining);
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      throw Object.assign(new Error("daily limit reached"), { dailyLimit: body.limit || true });
    }
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      let msg = body;
      try { msg = JSON.parse(body).error?.message || JSON.parse(body).error || body; } catch { /* plain text */ }
      throw new Error(`${res.status} ${msg}`.trim());
    }
    const reader = res.body.getReader();
    const blocks = [];
    let buf = "", stopReason = null;
    const handle = (ev) => {
      switch (ev.type) {
        case "content_block_start": {
          const b = structuredClone(ev.content_block);
          if (b.type === "tool_use") { b._json = ""; b.input = {}; }
          blocks[ev.index] = b;
          if (b.type === "text" && b.text) onText(b.text);
          break;
        }
        case "content_block_delta": {
          const b = blocks[ev.index], d = ev.delta;
          if (!b) break;
          if (d.type === "text_delta") { b.text = (b.text || "") + d.text; onText(d.text); }
          else if (d.type === "thinking_delta") b.thinking = (b.thinking || "") + d.thinking;
          else if (d.type === "signature_delta") b.signature = (b.signature || "") + d.signature;
          else if (d.type === "input_json_delta") b._json += d.partial_json;
          else if (d.type === "citations_delta") (b.citations ||= []).push(d.citation);
          break;
        }
        case "content_block_stop": {
          const b = blocks[ev.index];
          if (b?.type === "tool_use") { b.input = b._json ? JSON.parse(b._json) : {}; delete b._json; }
          break;
        }
        case "message_delta":
          if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
          break;
        case "error":
          throw new Error(ev.error?.message || "stream error");
        default:
      }
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec8.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
        if (data) handle(JSON.parse(data));
      }
    }
    return { content: blocks.filter(Boolean), stopReason };
  }

  boot();
})();
