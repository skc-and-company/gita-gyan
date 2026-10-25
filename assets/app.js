/* Gita Gyan — one app for both links.
 * index.html  → public reader (name + password gate)
 * admin.html  → same site with editing tools; "Publish" commits to GitHub so the
 *               public link picks the change up automatically (~1 minute).
 * Content lives in data/gita.enc, encrypted with the access password, so the
 * public GitHub repo never exposes it.
 */
(() => {
  "use strict";

  const ADMIN = document.body.dataset.mode === "admin";
  const LS = {
    auth: "gg-auth", prefs: "gg-prefs", draft: "gg-admin-draft",
    ghToken: "gg-gh-token", adminKey: "gg-worker-admin-key",
  };
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
      S.config = { title: "SKC & CO.", tagline: "" };
    }
    document.title = (S.config.title || "SKC & CO.") + (ADMIN ? " · Admin" : "");
    const saved = store.get(LS.auth);
    if (saved?.password) {
      const ok = await tryLogin(saved.name, saved.password, true).catch(() => false);
      if (ok) return;
    }
    renderLogin();
  }

  function renderLogin(error = "") {
    const app = $("#app");
    app.className = "login-wrap";
    const saved = store.get(LS.auth) || {};
    const nameIn = h("input", { id: "login-name", autocomplete: "name", placeholder: "Your name", value: saved.name || (ADMIN ? "Admin" : ""), required: true });
    const passIn = h("input", { id: "login-pass", type: "password", autocomplete: "current-password", placeholder: "Password", required: true });
    const remember = h("input", { type: "checkbox", id: "login-remember", checked: true });
    const btn = h("button", { class: "btn primary block", type: "submit" }, "Enter");
    const err = h("p", { class: "login-error", role: "alert" }, error);
    const form = h("form", {
      class: "login-card",
      onsubmit: async (e) => {
        e.preventDefault();
        if (!nameIn.value.trim() || !passIn.value) return;
        btn.disabled = true; btn.textContent = "Opening…"; err.textContent = "";
        const ok = await tryLogin(nameIn.value.trim(), passIn.value, remember.checked).catch((e2) => { err.textContent = e2.message; return null; });
        if (ok === false) err.textContent = "Wrong password.";
        if (!ok) { btn.disabled = false; btn.textContent = "Enter"; passIn.select(); }
      },
    },
      h("div", { class: "login-mark", "aria-hidden": "true" }, "SKC"),
      h("h1", null, S.config.title || "SKC & CO."),
      S.config.tagline ? h("p", { class: "login-tag" }, S.config.tagline) : null,
      ADMIN ? h("p", { class: "admin-pill" }, "Admin") : null,
      h("label", { for: "login-name" }, "Name"), nameIn,
      h("label", { for: "login-pass" }, "Password"), passIn,
      h("label", { class: "check" }, remember, " Remember me on this device"),
      btn, err,
      h("p", { class: "login-help" }, ADMIN ? "Use the readers' access password. Publishing also needs your GitHub token (Settings)." : "Don't have the password? Please contact the site administrator."),
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
    if (ADMIN) restoreDraft();
    logVisit();
    startApp();
    return true;
  }

  function logout() {
    store.del(LS.auth);
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
  function startApp() {
    const app = $("#app");
    app.className = "";
    app.replaceChildren(...[
      ADMIN ? adminBar() : null,
      header(),
      h("main", { id: "view", tabindex: "-1" }),
      h("footer", { class: "site-footer" }, h("div", { class: "footer-map", id: "footer-map" }), h("div", { class: "footer-text", id: "footer-text" })),
    ].filter(Boolean));
    renderFooter();
    chatMount();
    window.addEventListener("hashchange", () => { if (!S.keepEditing) S.editing = null; S.keepEditing = false; route(); });
    // Close an open header menu when tapping anywhere else; only one dropdown open at a time.
    document.addEventListener("click", (e) => {
      document.querySelectorAll(".nav-group[open], .menu[open]").forEach((d) => { if (!d.contains(e.target)) d.removeAttribute("open"); });
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".nav-group[open], .menu[open]").forEach((d) => d.removeAttribute("open")); });
    route();
  }

  function header() {
    const toggles = [["sa", "Sanskrit"], ["tr", "Roman"], ["en", "English"], ["hi", "Hindi"]].map(([k, label]) =>
      h("button", {
        class: `chip ${S.prefs[k] ? "on" : ""}`, "aria-pressed": String(!!S.prefs[k]), title: "Show / hide",
        onclick: (e) => { S.prefs[k] = !S.prefs[k]; store.set(LS.prefs, S.prefs); e.currentTarget.classList.toggle("on", S.prefs[k]); e.currentTarget.setAttribute("aria-pressed", String(S.prefs[k])); document.body.classList.toggle(`hide-${k}`, !S.prefs[k]); },
      }, label));
    for (const k of ["sa", "tr", "hi", "en"]) document.body.classList.toggle(`hide-${k}`, !S.prefs[k]);
    const sugg = h("div", { class: "search-sugg", hidden: true, role: "listbox" });
    const search = h("form", {
      class: "search", role: "search",
      onsubmit: (e) => { e.preventDefault(); const q = e.currentTarget.q.value.trim(); sugg.hidden = true; if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`; },
    }, h("input", { name: "q", type: "search", placeholder: "Search tools or the Gita…", "aria-label": "Search tools, pages or the Gita", autocomplete: "off",
      oninput: (e) => showSuggestions(e.target.value, sugg), onfocus: (e) => showSuggestions(e.target.value, sugg),
      onblur: () => setTimeout(() => { sugg.hidden = true; }, 150), onkeydown: (e) => { if (e.key === "Escape") { sugg.hidden = true; e.target.blur(); } } }), sugg);
    const groupLinks = (g) => g.tools.map((t) => h("a", { href: t.href }, h("span", { class: "nav-ico", "aria-hidden": "true" }, t.icon), h("span", null, h("b", null, t.title), h("small", null, t.about))));
    const menu = h("details", { class: "menu" },
      h("summary", { "aria-label": "Menu" }, h("span", { class: "menu-ico", "aria-hidden": "true" }, "☰"), h("span", { class: "menu-word" }, "Menu")),
      h("div", { class: "menu-panel" },
        h("div", { class: "menu-section" },
          h("div", { class: "menu-label" }, "Go to"),
          h("a", { class: "menu-home", href: "#/" }, "🏠 Home — all services"),
          GROUPS.map((g) => h("details", { class: "menu-group" }, h("summary", null, `${g.icon}  ${g.title}`), h("div", { class: "menu-links" }, g.tools.map((t) => h("a", { href: t.href }, `${t.icon} ${t.title}`)))))),
        h("div", { class: "menu-section" },
          h("div", { class: "menu-label" }, "Reading the Gita — show"),
          h("div", { class: "chips" }, toggles),
          h("div", { class: "menu-label" }, "Text size"),
          h("div", { class: "chips" },
            h("button", { class: "chip", onclick: () => setScale(-0.1) }, "A−"),
            h("button", { class: "chip", onclick: () => setScale(0) }, "A"),
            h("button", { class: "chip", onclick: () => setScale(0.1) }, "A+")),
          h("div", { class: "menu-label" }, "Theme"),
          h("div", { class: "chips" },
            h("button", { class: `chip theme-chip ${S.prefs.theme !== "dark" ? "on" : ""}`, "data-theme-choice": "light", onclick: () => setTheme("light") }, "☀️ Light"),
            h("button", { class: `chip theme-chip ${S.prefs.theme === "dark" ? "on" : ""}`, "data-theme-choice": "dark", onclick: () => setTheme("dark") }, "🌙 Dark"))),
        h("div", { class: "menu-section" },
          h("div", { class: "menu-label" }, "Pages"),
          h("div", { id: "menu-pages", class: "menu-links" })),
        h("div", { class: "menu-section menu-foot" },
          h("span", { class: "menu-user" }, `🙏 ${S.name}`),
          h("button", { class: "btn small ghost", onclick: logout }, "Log out"))));
    return h("header", { class: "site-header" },
      h("a", { href: "#/", class: "brand", "aria-label": "SKC & CO. — home" }, h("span", { class: "brand-mark", "aria-hidden": "true" }, "SKC"), h("span", { class: "brand-name" }, "SKC & CO.")),
      h("nav", { class: "main-nav", "aria-label": "Services" },
        GROUPS.map((g) => h("details", { class: "nav-group", "data-group": g.id },
          h("summary", null, g.title, h("span", { class: "caret", "aria-hidden": "true" }, "▾")),
          h("div", { class: "nav-panel" },
            h("div", { class: "nav-panel-head" }, h("b", null, `${g.icon} ${g.title}`), h("small", null, g.about)),
            groupLinks(g),
            h("a", { class: "nav-panel-all", href: `#/s/${g.id}` }, `All of ${g.title} →`))))),
      search, menu);
  }

  // Search suggestions: matching tools and pages first, then a Gita search.
  function matchTools(q) {
    const words = fold(q).split(/\s+/).filter((w) => w.length > 1);
    if (!words.length) return [];
    return TOOLS.map((t) => {
      const hay = fold(`${t.title} ${t.about} ${t.keys} ${t.group.title}`);
      const score = words.reduce((n, w) => n + (fold(t.title).includes(w) ? 3 : hay.includes(w) ? 1 : 0), 0);
      return { t, score };
    }).filter((x) => x.score).sort((a, b) => b.score - a.score).map((x) => x.t);
  }
  function showSuggestions(q, box) {
    q = q.trim();
    if (!q) { box.hidden = true; return; }
    const tools = matchTools(q).slice(0, 5);
    box.replaceChildren(
      ...tools.map((t) => h("a", { class: "sugg", href: t.href, role: "option", onmousedown: (e) => e.preventDefault(), onclick: () => { box.hidden = true; } },
        h("span", { class: "nav-ico", "aria-hidden": "true" }, t.icon), h("span", null, h("b", null, t.title), h("small", null, t.group.title)))),
      h("a", { class: "sugg", href: `#/search?q=${encodeURIComponent(q)}`, role: "option", onmousedown: (e) => e.preventDefault(), onclick: () => { box.hidden = true; } },
        h("span", { class: "nav-ico", "aria-hidden": "true" }, "🔎"), h("span", null, h("b", null, `Search the Gita for “${q}”`), h("small", null, "Sanskrit, English and Hindi"))));
    box.hidden = false;
  }

  function refreshChrome() {
    const links = $("#menu-pages");
    links.replaceChildren(...S.content.pages.map((p) => h("a", { href: `#/p/${p.id}` }, p.title)));
    if (ADMIN) links.append(h("a", { href: "#/p/new", class: "muted" }, "+ New page"));
    renderFooter();
  }

  function renderFooter() {
    const map = $("#footer-map");
    if (map) map.replaceChildren(...GROUPS.map((g) => h("div", null, h("a", { class: "foot-head", href: `#/s/${g.id}` }, g.title), g.tools.map((t) => h("a", { href: t.href }, t.title)))),
      h("div", null, h("span", { class: "foot-head" }, "SKC & CO."), h("a", { href: "#/" }, "Home"), S.content.pages.map((p) => h("a", { href: `#/p/${p.id}` }, p.title)), h("a", { href: "#", onclick: (e) => { e.preventDefault(); chatOpen(); } }, "Ask Saarthi")));
    const f = $("#footer-text");
    if (f) f.innerHTML = md(S.content.site.footer || "");
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
    else if (parts[0] === "tax") node = viewTax();
    else if (parts[0] === "videos") node = viewVideos();
    else if (parts[0] === "bank") node = viewModule("bank-page", window.GGBank, (m, box) => m.render(box));
    else if (parts[0] === "tenders") node = viewModule("mk-page", window.GGMarkets, (m, box) => m.renderTenders(box));
    else if (parts[0] === "scanner") node = viewModule("mk-page", window.GGMarkets, (m, box) => m.renderScanner(box));
    else if (parts[0] === "management") node = viewModule("mg-page", window.GGMgmt, (m, box) => m.render(box, parts[1]));
    else if (parts[0] === "library") node = viewLibrary();
    else if (parts[0] === "vision") node = viewVision();
    else if (parts[0] === "gita") node = viewHome();
    else if (parts[0] === "s" && GROUPS.some((g) => g.id === parts[1])) node = viewGroup(parts[1]);
    else node = viewPortal();
    // Every tool page gets a breadcrumb, "How to use" and Ask Saarthi on top; Gita pages a breadcrumb.
    const tool = toolById(parts[0]);
    if (tool) {
      const sub = parts[0] === "management" && parts[1] ? (window.GGMgmt?.TOOLS.find((x) => x.id === parts[1]) || {}).title : null;
      node = h("div", null, toolChrome(tool, sub), node);
    } else if (parts[0] === "c" && findChapter(+parts[1])) {
      const c = findChapter(+parts[1]);
      node = h("div", null, h("div", { class: "tool-bar noprint" }, crumbs([["Gita Gyan", "#/gita"], [`Chapter ${c.n}`, parts[2] ? `#/c/${c.n}` : null], ...(parts[2] ? [[`Shlok ${c.n}.${parts[2]}`, null]] : [])])), node);
    }
    const section = parts[0] === "c" || parts[0] === "gita" || parts[0] === "chapters" ? "gita" : tool ? tool.group.id : parts[0] === "s" ? parts[1] : "home";
    document.body.dataset.section = section;
    document.querySelectorAll(".nav-group").forEach((d) => { d.classList.toggle("current", d.dataset.group === section); d.removeAttribute("open"); });
    document.body.dataset.route = parts[0] || "home";
    view.replaceChildren(node);
    $(".menu")?.removeAttribute("open");
    const box = $(".search-sugg"); if (box) box.hidden = true;
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
          h("div", { class: "prose intro", html: md(site.intro) }),
          h("div", { class: "hero-actions" },
            h("a", { class: "btn primary", href: "#/c/1" }, "Start reading"),
            h("button", { class: "btn", onclick: () => chatOpen() }, "🙏 Ask Saarthi"))),
        "Edit Gita introduction"),
      today ? h("section", { class: "today" },
        h("h2", { class: "section-title" }, "Shlok of the day"),
        shlokCard(findChapter(today.c), today.s, { compact: true })) : null,
      h("section", null,
        h("h2", { class: "section-title" }, `${chapters().length} Chapters · ${totalShlokas()} Shlokas`),
        chapterGrid()));
  }

  /* ---------- the SKC & CO. home page ---------- */
  function viewPortal() {
    const site = S.content.site;
    const all = allShlokas();
    const today = all.length ? all[Math.floor(Date.now() / 86400000) % all.length] : null;
    const quick = [["🧮", "Calculate income tax", "#/tax"], ["🏦", "Analyse a bank statement", "#/bank"], ["📋", "Find Bihar tenders", "#/tenders"], ["📖", "Read the Gita", "#/gita"]];
    const pulse = h("div", { class: "pulse-grid" });
    const portal = h("div", { class: "portal" },
      h("section", { class: "portal-hero" },
        h("p", { class: "portal-hello" }, `Namaste, ${S.name} 🙏`),
        h("h1", null, "SKC & CO."),
        h("p", { class: "portal-sub" }, "Tax and accounts, business advisory, markets, a library — and the Bhagavad Gita. Everything in one place, with Saarthi to help."),
        site.announcement ? h("div", { class: "announce", html: md(site.announcement) }) : null,
        h("form", { class: "portal-search", role: "search", onsubmit: (e) => { e.preventDefault(); const q = e.currentTarget.q.value.trim(); if (!q) return; const t = matchTools(q)[0]; location.hash = t && fold(t.title).includes(fold(q)) ? t.href : `#/search?q=${encodeURIComponent(q)}`; } },
          h("input", { name: "q", type: "search", placeholder: "What do you need?  e.g. tax for a firm, bank statement, tenders, karma…", "aria-label": "Search tools, pages or the Gita" }),
          h("button", { class: "btn primary", type: "submit" }, "Search")),
        h("div", { class: "quick" }, quick.map(([i, t, href]) => h("a", { class: "quick-chip", href }, h("span", { "aria-hidden": "true" }, i), t)),
          h("button", { class: "quick-chip", type: "button", onclick: () => chatOpen() }, h("span", { "aria-hidden": "true" }, "🙏"), "Ask Saarthi"))),
      h("section", null,
        h("h2", { class: "section-title" }, "Services"),
        h("div", { class: "group-grid" }, GROUPS.map((g) => h("article", { class: `group-card g-${g.id}` },
          h("a", { class: "group-head", href: `#/s/${g.id}` }, h("span", { class: "group-icon", "aria-hidden": "true" }, g.icon), h("span", null, h("b", null, g.title), h("small", null, g.about))),
          h("div", { class: "group-tools" }, g.tools.map((t) => h("a", { href: t.href }, h("span", { class: "nav-ico", "aria-hidden": "true" }, t.icon), h("span", null, h("b", null, t.title), h("small", null, t.about)), h("span", { class: "go", "aria-hidden": "true" }, "→")))))))),
      h("section", null,
        h("h2", { class: "section-title" }, "Today"),
        pulse),
      editable("home", () => editHomeForm(), h("span"), "Edit site settings & Gita introduction"));
    // "Today": the shlok of the day, tenders closing soon and the newest Daily Market Update.
    const card = (cls, title, body, href, more) => h("a", { class: `pulse ${cls}`, href }, h("small", null, title), body, h("span", { class: "pulse-more" }, more));
    if (today) {
      const c = findChapter(today.c);
      pulse.append(card("p-gita", "Shlok of the day", h("p", { class: "pulse-sa" }, (today.s.sa || "").split("\n")[0]), `#/c/${today.c}/${today.s.v}`, `Read ${today.c}.${today.s.v} · ${c?.en || ""} →`));
    }
    const dmu = byDate((libraryData().documents || []).filter((x) => x.category === "Daily Market Update"))[0];
    pulse.append(card("p-lib", "Daily Market Update", h("p", null, dmu ? dmu.title : "Added here on market days."), "#/library", dmu ? `${dmu.date} →` : "Open the library →"));
    const tCard = card("p-ten", "Bihar tenders", h("p", null, "Checking…"), "#/tenders", "See all tenders →");
    pulse.append(tCard);
    window.GGMarkets?.searchTenders({ closing_within_days: 7 }).then((r) => {
      tCard.querySelector("p").textContent = `${r.matches} tender${r.matches === 1 ? "" : "s"} closing within 7 days${r.data_age_days > 2 ? ` (data ${r.data_age_days} days old)` : ""}`;
    }).catch(() => { tCard.querySelector("p").textContent = "Live Bihar Government tenders with closing dates."; });
    return portal;
  }

  function viewGroup(id) {
    const g = GROUPS.find((x) => x.id === id);
    return h("div", { class: "group-page" },
      h("div", { class: "tool-bar noprint" }, crumbs([[g.title, null]])),
      h("h1", { class: "page-title" }, `${g.icon} ${g.title}`),
      h("p", { class: "lead" }, g.about),
      h("div", { class: "tool-grid" }, g.tools.map((t) => h("a", { class: "tool-card", href: t.href },
        h("span", { class: "tool-icon", "aria-hidden": "true" }, t.icon),
        h("b", null, t.title), h("span", null, t.about),
        t.help ? h("ol", null, t.help.slice(0, 3).map((x) => h("li", null, x))) : null,
        h("span", { class: "go" }, "Open →")))),
      h("p", { class: "muted center" }, "Not sure where to start? ", h("a", { href: "#", onclick: (e) => { e.preventDefault(); chatOpen(); } }, "Ask Saarthi"), " — it can use every tool for you."));
  }

  /* ---------- SKC & CO.: what the site offers, in five groups ----------
   * One list drives the header menus, the home page, group pages, breadcrumbs, "How to use" help,
   * the footer and the site search, so everything stays in the same place everywhere. */
  const GROUPS = [
    { id: "gita", icon: "ॐ", title: "Gita Gyan", about: "The Shrimad Bhagavad Gita — Sanskrit, Roman, English and Hindi meaning, with Saarthi to explain any verse.",
      tools: [
        { id: "gita", icon: "📖", title: "Read the Gita", href: "#/gita", about: "Introduction, shlok of the day and all 18 chapters", keys: "gita bhagavad shlok verse read krishna arjuna",
          help: ["Pick a chapter, or open the shlok of the day.", "Use ☰ → Show to hide Sanskrit, Roman, English or Hindi.", "Tap 🙏 on any shlok to ask Saarthi about it; 🔗 copies its link."] },
        { id: "chapters", icon: "📜", title: "All 18 chapters", href: "#/chapters", about: "Jump straight to any chapter", keys: "chapter adhyay list",
          help: ["Tap a chapter to read it; use “Go to shlok” at the top to jump within it."] },
      ] },
    { id: "taxacc", icon: "₹", title: "Tax & Accounts", about: "Work out income tax and make sense of bank statements — for individuals, HUFs, firms and companies.",
      tools: [
        { id: "tax", icon: "🧮", title: "Income Tax Calculator", href: "#/tax", about: "Individuals, HUFs, firms, LLPs and companies — Tax Year 2026-27, every option compared", keys: "income tax itr form 16 regime huf firm llp company mat 115baa salary calculator",
          help: ["Choose the taxpayer type — only the boxes that apply are shown.", "Enter the figures you have; leave the rest blank.", "Press Compute tax: each option open to the taxpayer is worked out and the cheaper one is marked.", "Print, save in this browser, or download a PDF / CSV.", "Shortcut: attach a Form 16 to Saarthi and it fills this in for you."] },
        { id: "bank", icon: "🏦", title: "Bank Statement Analyzer", href: "#/bank", about: "PDF, Excel or CSV statements — cash flow, categories, counterparties and checks", keys: "bank statement passbook cash flow upi neft analyse analyzer current account",
          help: ["Choose Individual or Business (current / OD / CC accounts).", "Drop the statement (PDF, Excel or CSV) on the box. It is read only in this browser.", "Read “What stands out”, then check the categories — change any that are wrong.", "Export to Excel or PDF, or ask Saarthi what to do next."] },
      ] },
    { id: "business", icon: "📊", title: "Business & Advisory", about: "Analyse a business, plan investments and goals, and find Bihar Government tenders.",
      tools: [
        { id: "management", icon: "📊", title: "Management Services", href: "#/management", about: "Capital, business health, capex, financial goals and money efficiency — five working tools", keys: "management capital roce business ratio break even capex npv irr goal sip efficiency advisory working capital",
          help: ["Pick one of the five tools.", "Press “Fill sample” to see how it works, then enter your own figures.", "Press Analyse for the results and what they mean.", "Print the result, or contact SKC & CO. for a full review."] },
        { id: "tenders", icon: "📋", title: "Bihar Tenders", href: "#/tenders", about: "Bihar Government tenders — service ₹2 crore+, works and goods ₹50 crore+, with closing dates", keys: "tender bihar eproc nit bid contract government",
          help: ["Pick a tab: service, works / goods, new, closing soon or closed.", "Search, filter by department or minimum value, and sort.", "Open the official portal and search the tender ID to bid. Always check details there."] },
      ] },
    { id: "markets", icon: "📈", title: "Markets & Learning", about: "An educational market screen and videos that connect the Gita with investing.",
      tools: [
        { id: "scanner", icon: "📈", title: "Capital Market Scanner", href: "#/scanner", about: "NIFTY 500 chart patterns with the SKC rating — educational screening", keys: "stock share market scanner nifty pattern 52 week low dma breakdown rating",
          help: ["Pick a pattern tab.", "Filter by rating or dividend payers; tap a column heading to sort.", "Hover over a score to see how it is made up. This is education, not advice."] },
        { id: "videos", icon: "▶", title: "Gita se Capital Market tak", href: "#/videos", about: "JMJ Wealth Creator videos — investing lessons from the Gita", keys: "video youtube jmj wealth investing silver",
          help: ["Play a video here or open it on YouTube."] },
      ] },
    { id: "library", icon: "📁", title: "Library", about: "Documents, curated news, the Daily Market Update and Bihar's vision documents.",
      tools: [
        { id: "library", icon: "📁", title: "Documents & News", href: "#/library", about: "Searchable documents, curated news and the Daily Market Update", keys: "document news daily market update pdf library",
          help: ["Switch between News and Documents.", "Search or filter by source / category.", "The newest Daily Market Update is shown at the top of Documents."] },
        { id: "vision", icon: "🗺️", title: "Bihar Vision Documents", href: "#/vision", about: "Vision and working documents of Bihar and the Bihar Government, by sector", keys: "bihar vision policy government sector document",
          help: ["Documents are grouped by sector; open any to read it."] },
      ] },
  ];
  const TOOLS = GROUPS.flatMap((g) => g.tools.map((t) => ({ ...t, group: g })));
  const toolById = (id) => TOOLS.find((t) => t.id === id);

  function crumbs(items) {
    return h("nav", { class: "crumbs", "aria-label": "Breadcrumb" },
      [["Home", "#/"], ...items].map(([label, href], i, a) => [i ? h("span", { class: "crumb-sep", "aria-hidden": "true" }, "›") : null,
        href && i < a.length - 1 ? h("a", { href }, label) : h("span", { "aria-current": i === a.length - 1 ? "page" : null }, label)]));
  }
  // Breadcrumb, "How to use" and Ask Saarthi above every tool page.
  function toolChrome(t, extraCrumb) {
    if (!t) return null;
    return h("div", { class: "tool-bar noprint" },
      crumbs([[t.group.title, `#/s/${t.group.id}`], [t.title, extraCrumb ? t.href : null], ...(extraCrumb ? [[extraCrumb, null]] : [])]),
      h("div", { class: "tool-bar-actions" },
        t.help ? h("details", { class: "howto" }, h("summary", null, "ⓘ How to use"), h("ol", null, t.help.map((x) => h("li", null, x)))) : null,
        h("button", { class: "btn small", type: "button", onclick: () => chatOpen() }, "🙏 Ask Saarthi")));
  }

  function viewModule(cls, mod, draw) {
    const box = h("div", { class: cls });
    if (mod) draw(mod, box);
    else box.append(h("p", { class: "missing" }, "This page didn't load — please refresh."));
    return box;
  }

  /* ---------- Income Tax Calculator (assets/tax.js) ---------- */
  function viewTax() {
    const box = h("div", { class: "tax-page" });
    if (window.GGTax) window.GGTax.render(box);
    else box.append(h("p", { class: "missing" }, "Calculator didn't load — please refresh the page."));
    return box;
  }

  /* ---------- Gita se Capital Market tak (videos) ---------- */
  const DEFAULT_VIDEOS = {
    items: [
      { id: "6WarPaJ10FU", title: "Silver Seasonal Secrets", type: "Long video", duration: "10:41",
        desc: "Portfolio in the red? The Gita says: do your duty, don't worry about the fruit. Why silver tends to weaken in June–July, data from 2021–2025, investing in instalments, stop-losses, and physical silver vs silver ETFs." },
      { id: "b0KorRf3gb0", title: "The Silver Seasonal Secret", type: "Short", duration: "1:19",
        desc: "Why does silver get cheaper every June–July? Three reasons — and patience till Diwali." },
    ],
    soon: ["The Sthitaprajna (steady-minded) investor", "Karma Yoga and risk management", "Swadharma and asset allocation"],
    disclaimer: "For educational purposes only; this is not buy/sell advice.",
  };
  const videosData = () => S.content.videos || DEFAULT_VIDEOS;
  const youtubeId = (s) => {
    const t = String(s || "").trim();
    const m = t.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/);
    return m ? m[1] : /^[\w-]{11}$/.test(t) ? t : "";
  };

  function viewVideos() {
    const v = videosData();
    return h("div", { class: "videos" },
      editable("videos", () => editVideosForm(),
        h("div", null,
          h("h1", { class: "page-title" }, "Gita se Capital Market tak"),
          h("p", { class: "muted" }, "From the Gita to the capital market · JMJ Wealth Creator"),
          v.items.length ? v.items.map((x, i) => h("section", { class: "video-card" },
            h("h2", null, `Ep ${i + 1} · ${x.title} `, h("span", { class: "muted" }, [x.type, x.duration].filter(Boolean).join(" · "))),
            h("div", { class: "video-frame" },
              h("iframe", {
                src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(x.id)}`, title: x.title, loading: "lazy",
                allow: "accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen", allowfullscreen: true,
                referrerpolicy: "strict-origin-when-cross-origin",
              })),
            x.desc ? h("p", { class: "video-desc" }, x.desc) : null,
            h("p", { class: "muted" }, h("a", { href: `https://youtu.be/${encodeURIComponent(x.id)}`, target: "_blank", rel: "noopener" }, "Watch on YouTube ↗"))))
            : h("p", { class: "missing" }, "No videos yet."),
          v.soon?.length ? h("section", { class: "video-card" }, h("h2", null, "Coming soon"), h("ul", null, v.soon.map((t) => h("li", null, t)))) : null,
          v.disclaimer ? h("p", { class: "tax-disc" }, h("b", null, "Disclaimer: "), v.disclaimer) : null),
        "Edit videos"));
  }

  function editVideosForm() {
    const v = videosData();
    return form("Videos", [
      field("Videos — one per line:  YouTube link | title | type | duration | description", "items",
        v.items.map((x) => [`https://youtu.be/${x.id}`, x.title, x.type, x.duration, x.desc].join(" | ")).join("\n"),
        { rows: 8, hint: "Example: https://youtu.be/6WarPaJ10FU | Silver Seasonal Secrets | Long video | 10:41 | short description" }),
      field("Coming soon — one per line", "soon", (v.soon || []).join("\n"), { rows: 4 }),
      field("Disclaimer", "disclaimer", v.disclaimer || "", { rows: 2 }),
    ], {
      onSave: (d) => {
        const items = [];
        for (const line of d.items.split("\n").map((l) => l.trim()).filter(Boolean)) {
          const [link, title, type, duration, ...desc] = line.split("|").map((x) => x.trim());
          const id = youtubeId(link);
          if (!id) { toast(`Couldn't read a YouTube link in: ${line.slice(0, 60)}`, "error"); return false; }
          items.push({ id, title: title || "Video", type: type || "", duration: duration || "", desc: desc.join(" | ") });
        }
        S.content.videos = { items, soon: d.soon.split("\n").map((l) => l.trim()).filter(Boolean), disclaimer: d.disclaimer.trim() };
      },
    });
  }

  /* ---------- Documents & News (#/library) and Bihar Vision documents (#/vision) ----------
   * Lists live in the encrypted content (S.content.library); files the admin uploads are committed to
   * docs/ in the GitHub repository, so they are public — only upload documents meant to be shared. */
  const VISION_SECTIONS = [["economy", "Economy"], ["industry", "Industry"], ["agriculture", "Agriculture"], ["infrastructure", "Infrastructure"],
    ["education", "Education"], ["health", "Health"], ["policies_schemes", "Policies & Schemes"], ["analysis_documents", "Analysis Documents"]];
  const libraryData = () => S.content.library || { news: [], documents: [], vision: [] };
  const byDate = (a) => a.slice().sort((x, y) => String(y.date || "").localeCompare(String(x.date || "")));
  const LIB = { tab: "news", q: "", cat: "" };
  const isUrl = (u) => /^(https?:\/\/|docs\/)/i.test(String(u || "").trim());
  const fileLink = (u, label = "Open") => (isUrl(u) ? h("a", { class: "btn small", href: u.trim(), target: "_blank", rel: "noopener" }, label) : null);

  function viewLibrary() {
    const L = libraryData(), tab = LIB.tab === "documents" ? "documents" : "news", key = tab === "news" ? "source" : "category";
    const items = byDate(L[tab] || []);
    const cats = [...new Set(items.map((x) => x[key]).filter(Boolean))].sort();
    const q = LIB.q.toLowerCase();
    const shown = items.filter((x) => (!LIB.cat || x[key] === LIB.cat) && (!q || JSON.stringify(x).toLowerCase().includes(q)));
    const dmu = byDate((L.documents || []).filter((x) => x.category === "Daily Market Update"))[0];
    const editKey = (i) => `lib:${tab}:${i}`;
    const item = (x) => {
      const i = L[tab].indexOf(x);
      const node = h("div", { class: "lib-item" },
        h("b", null, tab === "news" && isUrl(x.link) ? h("a", { href: x.link, target: "_blank", rel: "noopener" }, x.title) : x.title),
        h("div", { class: "muted" }, [x.date, x[key]].filter(Boolean).join(" · ")),
        x.summary ? h("p", null, x.summary) : null,
        tab === "documents" ? fileLink(x.file) : null);
      return editable(editKey(i), () => libItemForm(tab, x, i), node, "Edit");
    };
    return h("div", { class: "library" },
      h("h1", { class: "page-title" }, "Documents & News"),
      h("div", { class: "mk-tabs", role: "tablist" },
        ["news", "documents"].map((t) => h("button", { class: `chip ${tab === t ? "on" : ""}`, type: "button", role: "tab", "aria-selected": String(tab === t), onclick: () => { LIB.tab = t; LIB.cat = ""; rerender(); } },
          t === "news" ? `News (${(L.news || []).length})` : `Documents (${(L.documents || []).length})`))),
      tab === "documents" ? h("section", { class: "tax-card lib-dmu" },
        h("h2", null, "Daily Market Update"),
        dmu ? h("div", null, h("b", null, dmu.title), h("div", { class: "muted" }, dmu.date), fileLink(dmu.file, "Open PDF"))
          : h("p", { class: "muted" }, "The Daily Market Update appears here on market days.")) : null,
      h("section", { class: "tax-card" },
        h("div", { class: "tax-grid noprint" },
          h("label", { class: "field" }, h("span", null, "Search"), h("input", { type: "search", value: LIB.q, placeholder: "Search…", oninput: (e) => { LIB.q = e.target.value; const pos = e.target.selectionStart; rerender(); const n = $(".library input[type=search]"); n?.focus(); n?.setSelectionRange(pos, pos); } })),
          h("label", { class: "field" }, h("span", null, tab === "news" ? "Source" : "Category"),
            h("select", { onchange: (e) => { LIB.cat = e.target.value; rerender(); } }, h("option", { value: "" }, tab === "news" ? "All sources" : "All categories"), cats.map((c) => h("option", { value: c, selected: LIB.cat === c || null }, c))))),
        shown.length ? shown.map(item) : h("p", { class: "missing" }, items.length ? "Nothing matches your search." : tab === "news" ? "No news added yet." : "No documents added yet."),
        ADMIN ? (S.editing === `lib:${tab}:new` ? libItemForm(tab, null, -1) : h("button", { class: "btn small", type: "button", onclick: () => { S.editing = `lib:${tab}:new`; rerender(); } }, tab === "news" ? "+ Add news item" : "+ Add document")) : null));
  }

  function viewVision() {
    const L = libraryData();
    return h("div", { class: "library" },
      h("h1", { class: "page-title" }, "Vision and Working Documents of Bihar"),
      h("p", null, "A sector-wise collection of vision documents, government working papers and SKC & CO. analysis on Bihar. Documents are added section by section."),
      VISION_SECTIONS.map(([id, title]) => {
        const docs = byDate((L.vision || []).filter((x) => x.section === id));
        return h("section", { class: "tax-card" },
          h("h2", null, title),
          docs.length ? docs.map((x) => {
            const i = L.vision.indexOf(x);
            return editable(`lib:vision:${i}`, () => libItemForm("vision", x, i),
              h("div", { class: "lib-item" }, h("b", null, x.title), h("div", { class: "muted" }, x.date || ""), x.summary ? h("p", null, x.summary) : null, fileLink(x.file, "Open document")), "Edit");
          }) : h("p", { class: "missing" }, "Documents will be added here."),
          ADMIN ? (S.editing === `lib:vision:new:${id}` ? libItemForm("vision", { section: id }, -1) : h("button", { class: "btn small", type: "button", onclick: () => { S.editing = `lib:vision:new:${id}`; rerender(); } }, `+ Add to ${title}`)) : null);
      }));
  }

  function libItemForm(kind, x, index) {
    x = x || {};
    const today = new Date().toISOString().slice(0, 10);
    const fileField = kind === "news" ? "link" : "file";
    const upload = h("input", { type: "file", accept: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg", hidden: true, onchange: async (e) => {
      const f = e.target.files[0]; e.target.value = "";
      if (!f) return;
      if (f.size > 20 * 1024 * 1024) { toast("Files up to 20 MB can be uploaded.", "error"); return; }
      if (!confirm(`Upload ${f.name}? Files uploaded here are public on GitHub — anyone with the link can open them.`)) return;
      const folder = kind === "vision" ? "docs/bihar-vision" : "docs/library";
      const path = `${folder}/${today}-${f.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "")}`;
      const fm = e.target.closest("form");
      try {
        toast(`Uploading ${f.name}…`);
        await ghPutBytes(path, new Uint8Array(await f.arrayBuffer()), `Add ${path}`);
        fm.elements[fileField].value = path;
        if (!fm.elements.title.value) fm.elements.title.value = f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
        toast("✓ Uploaded. Save, then Publish to list it on the site.");
      } catch (err) { toast(`Upload failed — ${err.message}`, "error"); }
    } });
    const fields = [
      field("Title", "title", x.title),
      field("Date (YYYY-MM-DD)", "date", x.date || today),
      kind === "news" ? field("Source (publication)", "source", x.source) : null,
      kind === "documents" ? field("Category (e.g. Tax, Daily Market Update)", "category", x.category, { hint: "Use “Daily Market Update” for the daily PDF — the newest one is shown at the top." }) : null,
      kind === "vision" ? h("label", { class: "field" }, h("span", null, "Section"), h("select", { name: "section" }, VISION_SECTIONS.map(([id, t]) => h("option", { value: id, selected: x.section === id || null }, t)))) : null,
      field("Summary (optional)", "summary", x.summary, { rows: 3 }),
      field(kind === "news" ? "Link to the original article" : "File — link, or upload below", fileField, x[fileField], { hint: kind === "news" ? "Only real, verified news, linked to the source." : "A web link (https://…) or a file uploaded with the button below." }),
    ];
    const extra = kind === "news" ? [] : [upload, h("button", { class: "btn", type: "button", onclick: () => upload.click() }, "⬆ Upload file")];
    return form(index < 0 ? (kind === "news" ? "Add news item" : "Add document") : "Edit", fields, {
      extra,
      onSave: (d) => {
        if (!d.title.trim()) { toast("A title is needed.", "error"); return false; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date.trim())) { toast("Date must look like 2026-10-25.", "error"); return false; }
        if (d[fileField] && !isUrl(d[fileField])) { toast("The link must start with https:// (or be an uploaded file).", "error"); return false; }
        const L = S.content.library = { news: [], documents: [], vision: [], ...libraryData() };
        const rec = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, String(v).trim()]));
        const list = L[kind] = (L[kind] || []).slice();
        if (index < 0) list.push(rec); else list[index] = rec;
      },
      onDelete: index < 0 ? null : () => {
        if (!confirm(`Remove “${x.title}” from the list? (An uploaded file stays in the repository.)`)) return false;
        const L = S.content.library = { news: [], documents: [], vision: [], ...libraryData() };
        L[kind] = L[kind].filter((_, i) => i !== index);
      },
    });
  }

  function viewChapters() {
    return h("div", null, h("h1", { class: "page-title" }, "Chapters"), chapterGrid());
  }

  function chapterGrid() {
    return h("div", { class: "chapter-grid" },
      chapters().map((c) => h("a", { class: "chapter-card", href: `#/c/${c.n}` },
        h("span", { class: "cc-num" }, c.n),
        h("span", { class: "cc-sa" }, c.sa),
        h("span", { class: "cc-en" }, c.en),
        h("span", { class: "cc-hi" }, c.hi),
        h("span", { class: "cc-count" }, `${c.shlokas.length} shlokas`))),
      ADMIN ? h("button", { class: "chapter-card add", onclick: addChapter }, "+ Add chapter") : null);
  }

  function viewChapter(n) {
    const c = findChapter(n);
    if (!c) return notFound();
    const idx = chapters().indexOf(c);
    const prev = chapters()[idx - 1], next = chapters()[idx + 1];
    const jump = h("select", {
      class: "jump", "aria-label": "Go to shlok",
      onchange: (e) => { const el = $(`#s-${n}-${e.target.value}`); if (el) el.scrollIntoView({ behavior: "smooth" }); },
    }, h("option", { value: "" }, "Go to shlok…"), c.shlokas.map((s) => h("option", { value: s.v }, `${n}.${s.v}`)));
    return h("article", { class: "chapter" },
      editable(`c:${n}`, () => editChapterForm(c),
        h("header", { class: "chapter-head" },
          h("div", { class: "eyebrow" }, `Chapter ${n}`),
          h("h1", { class: "ch-sa" }, c.sa),
          h("p", { class: "ch-names" }, h("span", { class: "ch-en" }, c.en), " · ", h("span", null, c.hi)),
          h("p", { class: "ch-tr" }, c.tr),
          c.sum_en ? h("p", { class: "ch-sum en-text" }, c.sum_en) : null,
          c.sum_hi ? h("p", { class: "ch-sum hi-text" }, c.sum_hi) : null,
          h("div", { class: "ch-tools" }, jump,
            h("button", { class: "btn small", onclick: () => chatOpen(`Explain the essence and main teachings of Chapter ${n} (${c.en}) in detail.`) }, "🙏 Discuss this chapter"))),
        "Edit chapter"),
      h("div", { class: "shlok-list" }, c.shlokas.map((s) => shlokCard(c, s))),
      ADMIN ? h("button", { class: "btn add-shlok", onclick: () => addShlok(c) }, `+ Add shlok ${n}.${(c.shlokas.at(-1)?.v || 0) + 1}`) : null,
      c.colophon ? h("p", { class: "colophon" }, c.colophon) : null,
      pager(prev && { href: `#/c/${prev.n}`, label: `← Chapter ${prev.n}` }, next && { href: `#/c/${next.n}`, label: `Chapter ${next.n} →` }));
  }

  function viewShlok(n, v) {
    const c = findChapter(n), s = findShlok(n, v);
    if (!c || !s) return notFound();
    const flat = allShlokas();
    const i = flat.findIndex((x) => x.c === n && x.s === s);
    const prev = flat[i - 1], next = flat[i + 1];
    return h("article", { class: "single" },
      h("a", { class: "back", href: `#/c/${n}` }, `← Chapter ${n} · ${c.en}`),
      shlokCard(c, s, { single: true }),
      pager(prev && { href: `#/c/${prev.c}/${prev.s.v}`, label: `← ${prev.c}.${prev.s.v}` }, next && { href: `#/c/${next.c}/${next.s.v}`, label: `${next.c}.${next.s.v} →` }));
  }

  function shlokCard(c, s, opts = {}) {
    const key = `s:${c.n}:${s.v}`;
    if (S.editing === key) return editShlokForm(c, s);
    const ref = `${c.n}.${s.v}`;
    return h("section", { class: `shlok ${opts.single ? "single-card" : ""}`, id: `s-${c.n}-${s.v}` },
      h("div", { class: "shlok-top" },
        h("a", { class: "badge", href: `#/c/${c.n}/${s.v}`, title: "Link to this shlok" }, `Shlok ${ref}`),
        h("div", { class: "shlok-actions" },
          h("button", { class: "icon-btn", title: "Ask Saarthi about this shlok", onclick: () => chatOpen(`Explain shlok ${ref} in depth — word meanings, its sense, and how to apply it in life.`) }, "🙏"),
          h("button", { class: "icon-btn", title: "Copy link", onclick: () => copyLink(`#/c/${c.n}/${s.v}`) }, "🔗"),
          ADMIN ? h("button", { class: "icon-btn edit", title: "Edit", onclick: () => { S.editing = key; rerender(); } }, "✎") : null)),
      s.sa ? h("p", { class: "sa-text" }, s.sa) : null,
      s.tr ? h("p", { class: "tr-text" }, s.tr) : null,
      h("div", { class: "en-block" },
        h("div", { class: "label" }, "English · Shri Purohit Swami"),
        s.en ? h("p", { class: "en-text" }, s.en) : h("p", { class: "missing" }, "Purohit Swami's translation is not available for this verse.")),
      h("div", { class: "hi-block" },
        h("div", { class: "label" }, "Hindi meaning (Bhavarth)"),
        s.hi ? h("p", { class: "hi-text" }, s.hi) : h("p", { class: "missing" }, "Hindi meaning not added yet.")),
      s.note ? h("div", { class: "note-block" }, h("div", { class: "label" }, "Note"), h("div", { class: "prose", html: md(s.note) })) : null,
      opts.compact ? h("a", { class: "more", href: `#/c/${c.n}` }, `Read chapter ${c.n} →`) : null);
  }

  function viewPage(id) {
    if (id === "new" && ADMIN) {
      const page = { id: "", title: "New page", body: "" };
      S.editing = "p:new";
      return h("div", null, editPageForm(page, true));
    }
    const p = S.content.pages.find((x) => x.id === id);
    if (!p) return notFound();
    return h("article", { class: "page" },
      h("div", { class: "tool-bar noprint" }, crumbs([[p.title, null]])),
      editable(`p:${p.id}`, () => editPageForm(p),
        h("div", null, h("h1", { class: "page-title" }, p.title), h("div", { class: "prose", html: md(p.body) })),
        "Edit page"));
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
    const tools = matchTools(q);
    return h("div", { class: "search-view" },
      h("div", { class: "tool-bar noprint" }, crumbs([["Search", null]])),
      h("h1", { class: "page-title" }, `“${q}”`),
      tools.length ? h("section", null, h("h2", { class: "section-title" }, "Tools & pages"),
        h("div", { class: "tool-grid" }, tools.slice(0, 6).map((t) => h("a", { class: "tool-card small", href: t.href }, h("span", { class: "tool-icon", "aria-hidden": "true" }, t.icon), h("b", null, t.title), h("span", null, t.about), h("small", { class: "muted" }, t.group.title))))) : null,
      h("h2", { class: "section-title" }, "In the Gita"),
      ref && findShlok(+ref[1], +ref[2]) ? h("p", null, h("a", { class: "btn primary", href: `#/c/${ref[1]}/${ref[2]}` }, `Open shlok ${ref[1]}.${ref[2]} →`)) : null,
      h("p", { class: "muted" }, hits.length ? `${hits.length}${hits.length >= 200 ? "+" : ""} results` : "No results"),
      h("ol", { class: "results" }, hits.map(({ c, s, text }) => h("li", null,
        h("a", { href: `#/c/${c}/${s.v}` }, h("strong", null, `${c}.${s.v}`), " ", h("span", { html: snippet(text, q) }))))),
      h("p", null, h("button", { class: "btn", onclick: () => chatOpen(q) }, `🙏 Ask Saarthi: “${q}”`)));
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
    return h("div", { class: "empty" }, h("h1", null, "Page not found"), h("p", null, h("a", { href: "#/" }, "Go to the home page")));
  }

  function copyLink(hash) {
    const url = location.href.replace(/admin\.html/, "index.html").split("#")[0] + hash;
    navigator.clipboard?.writeText(url).then(() => toast("Link copied"), () => toast(url));
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

  function form(title, fields, { onSave, onDelete, deleteLabel = "Delete", extra = [] }) {
    const f = h("form", {
      class: "edit-form",
      onsubmit: (e) => { e.preventDefault(); const data = Object.fromEntries(new FormData(f)); if (onSave(data) !== false) { S.editing = null; markDirty(); rerender(); } },
    },
      h("div", { class: "edit-title" }, title),
      fields,
      h("div", { class: "edit-actions" },
        h("button", { class: "btn primary", type: "submit" }, "Save"),
        h("button", { class: "btn", type: "button", onclick: () => { S.editing = null; rerender(); } }, "Cancel"),
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
    }, "Sanskrit → Roman");
    return h("div", { id: `s-${c.n}-${s.v}` }, form(`Edit shlok ${c.n}.${s.v}`, [
      field("Verse number", "v", s.v, { type: "number" }),
      field("Sanskrit (Devanagari)", "sa", s.sa, { rows: 4, cls: "sa-input" }),
      field("Roman transliteration", "tr", s.tr, { rows: 4 }),
      field("Hindi meaning (bhavarth)", "hi", s.hi, { rows: 5, cls: "hi-input" }),
      field("English (Shri Purohit Swami)", "en", s.en, { rows: 4 }),
      field("Note (optional, markdown)", "note", s.note, { rows: 3 }),
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
        if (!confirm(`Delete shlok ${c.n}.${s.v}?`)) return false;
        c.shlokas.splice(c.shlokas.indexOf(s), 1);
      },
      deleteLabel: "Delete shlok",
    }));
  }

  function editChapterForm(c) {
    return form(`Edit chapter ${c.n}`, [
      field("Chapter number", "n", c.n, { type: "number" }),
      field("Sanskrit name", "sa", c.sa),
      field("Roman name", "tr", c.tr),
      field("Hindi name", "hi", c.hi),
      field("English name", "en", c.en),
      field("Summary (Hindi)", "sum_hi", c.sum_hi, { rows: 4 }),
      field("Summary (English)", "sum_en", c.sum_en, { rows: 4 }),
      field("Colophon", "colophon", c.colophon, { rows: 3 }),
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
        const typed = prompt(`This deletes the whole of chapter ${c.n} (${c.shlokas.length} shlokas).\nType ${c.n} to confirm.`);
        if (typed !== String(c.n)) return false;
        chapters().splice(chapters().indexOf(c), 1);
        setTimeout(() => { location.hash = "#/chapters"; }, 0);
      },
      deleteLabel: "Delete chapter",
    });
  }

  function editHomeForm() {
    const site = S.content.site;
    return form("Site settings & Gita introduction", [
      field("Announcement (optional — a banner on the home page)", "announcement", site.announcement, { rows: 2 }),
      field("Gita section title", "title", site.title),
      field("Gita section subtitle", "subtitle", site.subtitle),
      field("Gita introduction (markdown)", "intro", site.intro, { rows: 8 }),
      field("Footer / copyright", "footer", site.footer, { rows: 2 }),
      field("Enquiry email (shown on Management Services)", "contact_email", site.contact_email, { type: "email" }),
      field("Enquiry phone (optional)", "contact_phone", site.contact_phone),
    ], { onSave: (d) => { Object.assign(site, d); } });
  }

  function editPageForm(p, isNew = false) {
    return form(isNew ? "New page" : "Edit page", [
      field("Title", "title", p.title),
      field("Content (markdown: ## heading, **bold**, - list, [link](url))", "body", p.body, { rows: 14 }),
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
        if (!confirm(`Delete the page “${p.title}”?`)) return false;
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
    chapters().push({ n, sa: "", tr: "", en: `Chapter ${n}`, hi: "", sum_hi: "", sum_en: "", colophon: "", shlokas: [] });
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
      h("a", { class: "btn small ghost", href: "index.html", target: "_blank" }, "Public view ↗"),
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

  async function ghPutBytes(path, bytes, message) {
    const { owner, repo, token, branch } = ghSettings();
    if (!owner || !repo || !token) throw new Error("add your GitHub details in Settings first");
    const cur = await gh(`/contents/${path}?ref=${encodeURIComponent(branch)}`);
    const sha = cur.status === 404 ? undefined : (await cur.json()).sha;
    await gh(`/contents/${path}`, { method: "PUT", body: JSON.stringify({ message, branch, sha, content: bytesToB64(bytes) }) });
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
      section("4 · Saarthi (AI assistant)",
        h("p", { class: "muted" }, "Needs the free Cloudflare Worker from the worker/ folder (see README)."),
        chatForm),
      section("5 · Saarthi daily limit",
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

  /* ---------- Saarthi (सारथी): the in-site assistant for the Gita, tax and videos ----------
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
  // Saarthi's tax tools: the model sends plain-English field names; these map to the calculator's own fields.
  const TAX_FIELDS = {
    salary_gross: "sal", exempt_allowances: "salex", professional_tax: "pt", basic_da: "basic", rent_received: "rent",
    municipal_tax: "mun", home_loan_interest: "hli", net_profit: "np", turnover_digital_44ad: "tod", turnover_cash_44ad: "toc",
    gross_receipts_44ada: "gr", stcg_111a: "stcg111a", stcg_other: "stcgo", ltcg_112a: "ltcg112a", ltcg_112: "ltcg112",
    savings_interest: "sbint", fd_interest: "fdint", dividends: "div", other_income: "oth", d80c: "d80c", d80ccd1b: "d80ccd1b",
    d80ccd2: "d80ccd2", d80d_self: "d80ds", d80d_parents: "d80dp", d80e: "d80e", d80g: "d80g", other_deductions: "dother",
    partners_interest: "pint", partners_capital: "pcap", partners_remuneration: "prem", brought_forward_loss: "bfl",
    book_profit: "bookp", d80jjaa: "d80jjaa", d80m: "d80m",
  };
  function taxInputs(i) {
    const d = {
      ent: { huf: "huf", firm: "firm", llp: "firm", company: "co" }[i.taxpayer] || "ind",
      ftype: i.taxpayer === "llp" ? "llp" : "firm",
      name: i.name || "", age: { "60_to_80": "1", "80_plus": "2" }[i.age] || "0", res: i.resident === false ? "0" : "1",
      hpt: { self_occupied: "so", let_out: "lo" }[i.house_property] || "none", bt: { "44AD": "ad", "44ADA": "ada" }[i.business_method] || "np",
      parsen: i.parents_senior ? "1" : "0", hsen: i.senior_member ? "1" : "0", ttauto: "1",
      cturn: i.turnover_above_400cr ? "0" : "1", c115bab: i.new_manufacturing_115bab ? "1" : "0",
    };
    for (const [k, f] of Object.entries(TAX_FIELDS)) if (i[k] != null && i[k] !== "") d[f] = String(i[k]);
    return d;
  }
  function taxSummary(r, filled) {
    const pick = (o) => ({
      gross_total_income: o.gti, deductions: o.dedList.map(([section, , amount]) => ({ section, amount })), total_income: o.ti,
      tax_on_total_income: Math.round(o.tax), ...(o.rebate ? { rebate_87a: Math.round(o.rebate) } : {}), surcharge: Math.round(o.sur), cess: Math.round(o.cess),
      total_tax: o.total, ...(o.basis ? { payable_under: o.basis, normal_tax: o.normalTotal } : {}),
      ...(o.mat ? { mat: o.mat.total } : {}), ...(o.matCredit ? { mat_credit: o.matCredit } : {}), ...(o.amt ? { amt: o.amt.total } : {}),
      ...(o.firm ? { partners_interest_allowed: o.firm.intA, partners_remuneration_allowed: o.firm.remA, remuneration_limit: o.firm.lim } : {}),
      ...(o.busCF ? { business_loss_not_set_off: o.busCF } : {}), ...(o.bflLeft ? { brought_forward_loss_left: o.bflLeft } : {}),
    });
    const best = r.opts.find((x) => x.id === r.best);
    return {
      taxpayer: { ind: "individual", huf: "HUF", firm: "firm / LLP", co: "domestic company" }[r.ent],
      options: Object.fromEntries(r.opts.map((x) => [x.label, pick(x.o)])),
      recommended: r.opts.length < 2 ? best.label : r.saving ? best.label : "either (equal)", saving: r.saving,
      calculator_filled: !!filled, note: "Figures from the site's Income Tax Calculator (Tax Year 2026-27). Estimate for guidance, not tax advice.",
    };
  }
  const PAGES = { home: "#/", gita: "#/gita", chapters: "#/chapters", tax: "#/tax", videos: "#/videos", bank: "#/bank", tenders: "#/tenders", scanner: "#/scanner",
    management: "#/management", vision: "#/vision", library: "#/library" };
  Object.assign(tools, {
    calculate_tax(i) {
      if (!window.GGTax) return { error: "The tax calculator isn't loaded — ask the person to refresh the page." };
      const d = taxInputs(i);
      if (!i.show_in_calculator) return taxSummary(window.GGTax.TAX.compare(d), false);
      const r = window.GGTax.prefill(d);
      if (!location.hash.startsWith("#/tax")) location.hash = "#/tax";
      return taxSummary(r, true);
    },
    read_tax_calculator() {
      const c = window.GGTax?.current();
      const filled = c?.inputs && Object.fromEntries(Object.entries(c.inputs).filter(([, v]) => v !== "" && v != null));
      if (!c || (!c.result && (!filled || Object.keys(filled).length <= 8))) return { empty: true, note: "Nothing has been entered or computed on the calculator yet." };
      return { inputs: filled, result: c.result ? taxSummary(c.result, true) : null };
    },
    async analyze_bank_statement({ file_name, account_holder }) {
      if (!window.GGBank) return { error: "The Bank Statement Analyzer isn't loaded — ask the person to refresh." };
      const files = (S.chat.attached || []).filter((f) => !/^image\//.test(f.type));
      const f = (file_name && files.find((x) => x.name === file_name)) || files.at(-1);
      if (!f) return { error: "No PDF, Excel or CSV statement is attached in this conversation. Ask the person to attach it with 📎, or to open the Bank Statement Analyzer and load it there." };
      if (account_holder) window.GGBank.setHolder(account_holder);
      if (!location.hash.startsWith("#/bank")) location.hash = "#/bank";
      const out = await window.GGBank.loadBytes(f.name, b64ToBytes(f.data));
      return out || { error: "The file couldn't be read as a statement (it may be a scanned image or have no transaction table). Read it yourself if it's a PDF you can see." };
    },
    read_bank_statement() {
      return window.GGBank?.summary() || { empty: true, note: "No statement is loaded in the Bank Statement Analyzer." };
    },
    find_bank_transactions(i) {
      return window.GGBank?.find(i) || { empty: true, note: "No statement is loaded in the Bank Statement Analyzer." };
    },
    search_tenders(i) {
      return window.GGMarkets ? window.GGMarkets.searchTenders(i) : { error: "The tenders page isn't loaded." };
    },
    market_scanner(i) {
      return window.GGMarkets ? window.GGMarkets.scanner(i) : { error: "The scanner isn't loaded." };
    },
    management_tool({ tool, inputs, show_on_page }) {
      if (!window.GGMgmt) return { error: "The management tools aren't loaded." };
      return window.GGMgmt.run(tool, inputs || {}, show_on_page !== false);
    },
    read_management_tool({ tool }) {
      return window.GGMgmt ? window.GGMgmt.read(tool) : { error: "The management tools aren't loaded." };
    },
    list_documents({ query, kind }) {
      const L = libraryData(), q = String(query || "").toLowerCase();
      const pick = (a, k) => byDate(a || []).filter((x) => !q || JSON.stringify(x).toLowerCase().includes(q)).slice(0, 15).map((x) => ({ ...x, kind: k, ...(x.section ? { section: (VISION_SECTIONS.find(([id]) => id === x.section) || [])[1] } : {}) }));
      const out = {};
      if (!kind || kind === "news") out.news = pick(L.news, "news");
      if (!kind || kind === "documents") out.documents = pick(L.documents, "document");
      if (!kind || kind === "vision") out.bihar_vision = pick(L.vision, "vision document");
      return out;
    },
    list_videos() {
      const v = videosData();
      return { episodes: v.items.map((x, n) => ({ episode: n + 1, title: x.title, type: x.type, duration: x.duration, description: x.desc, link: `https://youtu.be/${x.id}` })), coming_soon: v.soon || [], disclaimer: v.disclaimer };
    },
    open_page({ page, chapter, verse, tool }) {
      const target = page === "management" && tool ? `#/management/${tool}` : PAGES[page]
        || (page === "chapter" && findChapter(chapter) ? `#/c/${chapter}${verse && findShlok(chapter, verse) ? "/" + verse : ""}` : null);
      if (!target) return { error: "Unknown page or chapter." };
      location.hash = target;
      return { opened: target };
    },
  });

  const toolLabel = (name, input) => ({
    calculate_tax: input.show_in_calculator ? "🧮 Filling in the tax calculator" : "🧮 Calculating tax",
    read_tax_calculator: "🧮 Reading the tax calculator",
    analyze_bank_statement: "🏦 Analysing the statement in the Bank Statement Analyzer",
    read_bank_statement: "🏦 Reading the bank statement analysis",
    find_bank_transactions: `🏦 Looking for transactions${input.query ? ": “" + input.query + "”" : ""}`,
    search_tenders: `📋 Searching Bihar tenders${input.query ? ": “" + input.query + "”" : ""}`,
    market_scanner: "📈 Checking the market scanner",
    management_tool: `📊 Running the ${(window.GGMgmt?.TOOLS.find((t) => t.id === input.tool) || {}).title || "management"} tool`,
    read_management_tool: "📊 Reading the management tool",
    list_documents: "📁 Looking through documents and news",
    list_videos: "▶ Looking at the videos",
    open_page: "↗ Opening the page",
    get_shlokas: `📖 Reading shlok ${input.chapter}.${input.start_verse}${input.end_verse && input.end_verse !== input.start_verse ? "–" + input.end_verse : ""}`,
    search_gita: `🔎 Searching: “${input.query}”`,
    get_chapter: `📜 Looking at chapter ${input.chapter}`,
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
          toast("This browser can't record voice — open the site in Chrome or Safari, or use your keyboard's 🎤 button.", "error");
          return;
        }
        if (!S.config.chatUrl) { toast("Voice questions need the AI assistant to be set up.", "error"); return; }
        if (S.chat.busy) return;
        v.stopSpeaking();
        const btn = $("#mic-btn"), label = $("#mic-label");
        const idle = "Ask by voice";
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        } catch (e) {
          toast(e.name === "NotFoundError" ? "No microphone found." : "Please allow microphone access in your browser.", "error");
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
          if (!spoke) { label.textContent = idle; toast("Didn't hear anything — please speak closer to the mic and try again."); return; }
          btn.classList.add("working"); btn.disabled = true;
          label.textContent = "Understanding…";
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
            if (res.status === 429) throw new Error("Today's voice limit is used up — please type your question.");
            if (!res.ok) throw new Error(typeof out.error === "string" ? out.error : `HTTP ${res.status}`);
            if (!out.text) throw new Error("Couldn't make that out — please try again.");
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
        label.textContent = "Listening… speak now (tap to stop)";
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
      h("button", { class: "chat-fab", id: "chat-fab", onclick: () => chatOpen(), "aria-label": "Talk to Saarthi" }, h("span", null, "🙏"), h("span", { class: "fab-label" }, "Saarthi")),
      h("aside", { class: "chat", id: "chat", "aria-label": "Saarthi", hidden: true },
        h("header", { class: "chat-head" },
          h("div", null, h("strong", null, "🙏 Saarthi"), h("small", null, "Your guide to the Gita and every SKC & CO. service")),
          h("div", null,
            h("button", { class: "icon-btn", title: "New conversation", onclick: chatReset }, "↺"),
            h("button", { class: "icon-btn", title: "Close", onclick: chatClose }, "✕"))),
        h("div", { class: "chat-log", id: "chat-log", "aria-live": "polite" }),
        h("div", { class: "voice-bar" },
          h("button", { class: "mic-btn", id: "mic-btn", type: "button", "aria-label": "Ask by voice", onclick: () => voice.toggleListen() },
            h("span", { class: "mic-icon", html: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.93V20h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.07A7 7 0 0 1 5 11a1 1 0 1 1 2 0 5 5 0 0 0 10 0Z"/></svg>' }),
            h("span", { class: "mic-label", id: "mic-label" }, "Ask by voice"))),
        h("div", { class: "chat-files", id: "chat-files", hidden: true }),
        h("form", { class: "chat-input", onsubmit: (e) => { e.preventDefault(); chatSend(); } },
          h("input", { type: "file", id: "chat-file", hidden: true, multiple: true, accept: "application/pdf,image/png,image/jpeg,image/webp,image/gif,.csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", onchange: (e) => attachFiles(e.target) }),
          h("button", { class: "attach-btn", type: "button", title: "Attach a PDF, photo, Excel or CSV (Form 16, salary slip, bank statement…)", "aria-label": "Attach a file", onclick: () => $("#chat-file").click() }, "📎"),
          h("textarea", {
            id: "chat-text", rows: 2, placeholder: "Type or speak your question — any language",
            onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); chatSend(); } },
          }),
          h("button", { class: "btn primary", id: "chat-send", type: "submit" }, "Send")),
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
    S.chat.messages = []; S.chat.view = []; S.chat.attached = [];
    chatSave(); chatRender();
  }
  // Attached files stay in memory for this conversation; the copy kept across reloads drops their contents
  // (they're too large for browser storage), leaving a note in their place.
  function chatSave() {
    const slim = S.chat.messages.map((m) => (Array.isArray(m.content) && m.role === "user"
      ? { ...m, content: m.content.map((b) => (b.type === "document" || b.type === "image"
        ? { type: "text", text: `[file attached earlier${b.title ? ": " + b.title : ""} — attach it again if it's needed]` } : b)) }
      : m));
    session.set("gg-chat", { messages: slim, view: S.chat.view });
  }

  const MAX_FILE_BYTES = 8 * 1024 * 1024, MAX_FILES = 3;
  // Excel / CSV as plain text for the AI (SheetJS from vendor/, loaded only when needed). Long files are cut.
  async function sheetText(f) {
    const bytes = b64ToBytes(f.data);
    let text;
    try {
      if (f.type === "text/csv") text = new TextDecoder().decode(bytes);
      else {
        if (!window.XLSX) await new Promise((resolve, reject) => document.head.append(h("script", { src: "vendor/xlsx.full.min.js", onload: resolve, onerror: reject })));
        const wb = window.XLSX.read(bytes, { type: "array" });
        text = wb.SheetNames.map((n) => `# Sheet: ${n}\n${window.XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join("\n\n");
      }
    } catch { text = "(this spreadsheet couldn't be read)"; }
    const LIMIT = 150000;
    return text.length > LIMIT ? text.slice(0, LIMIT) + `\n…[cut: the file is longer — ${text.length} characters. Use analyze_bank_statement for complete totals.]` : text;
  }
  async function attachFiles(input) {
    const picked = [...input.files];
    input.value = "";
    S.chat.files = S.chat.files || [];
    for (const f of picked) {
      if (S.chat.files.length >= MAX_FILES) { toast(`Up to ${MAX_FILES} files at a time.`, "error"); break; }
      const sheet = /\.(csv|xlsx?)$/i.test(f.name);
      if (!sheet && !/^(application\/pdf|image\/(png|jpeg|webp|gif))$/.test(f.type)) { toast(`${f.name}: only PDF, photo, Excel or CSV files can be attached.`, "error"); continue; }
      if (f.size > MAX_FILE_BYTES) { toast(`${f.name} is larger than 8 MB.`, "error"); continue; }
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1]);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(f);
      }).catch(() => null);
      if (data) S.chat.files.push({ name: f.name, type: sheet ? (/\.csv$/i.test(f.name) ? "text/csv" : "spreadsheet") : f.type, size: f.size, data });
    }
    renderFiles();
    $("#chat-text").focus();
  }
  function renderFiles() {
    const box = $("#chat-files");
    if (!box) return;
    const files = S.chat.files || [];
    box.hidden = !files.length;
    box.replaceChildren(...files.map((f, i) => h("span", { class: "file-chip" },
      `${f.type === "application/pdf" ? "📄" : /^image\//.test(f.type) ? "🖼" : "📊"} ${f.name} (${Math.max(1, Math.round(f.size / 1024))} KB)`,
      h("button", { type: "button", title: "Remove", onclick: () => { S.chat.files.splice(i, 1); renderFiles(); } }, "✕"))),
      files.length ? h("small", { class: "muted" }, "Files are sent to the AI only to answer you; this site doesn't store them.") : null);
  }

  function chatRender() {
    const log = $("#chat-log");
    if (!log) return;
    const left = $("#chat-remaining");
    if (left) {
      left.hidden = ADMIN || S.chat.remaining == null;
      left.textContent = `Questions left today: ${S.chat.remaining}`;
    }
    if (!S.chat.view.length) {
      const ideas = ["What is Karma Yoga? Explain simply.", "My salary is ₹15 lakh — which regime is cheaper for me?", "📎 Attach my Form 16 and work out my tax", "📎 Analyse my bank statement", "Our firm made ₹40 lakh profit — how much tax, and how much can we pay the partners?", "Which Bihar tenders above ₹10 crore close this week?"];
      log.replaceChildren(h("div", { class: "chat-welcome" },
        h("p", null, `Namaste ${S.name} 🙏`),
        h("p", null, "I'm Saarthi — here to help with the Gita's verses and life questions, and with every SKC & CO. service: income tax for individuals, HUFs, firms and companies, bank statements, Bihar tenders, the market scanner, management analysis, documents and the Gita se Capital Market tak videos. Attach a Form 16, salary slip or bank statement with 📎 and I'll read it and fill in the right tool for you."),
        h("p", { class: "muted" }, "Type, or tap 🎤 and speak, in any language — it's detected automatically, and I reply in the same language."),
        h("div", { class: "ideas" }, ideas.map((q) => h("button", {
          class: "chip",
          onclick: () => { if (q.startsWith("📎")) { $("#chat-text").value = q.slice(2).trim(); $("#chat-file").click(); } else { $("#chat-text").value = q; chatSend(); } },
        }, q)))));
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
          title: "Read aloud", onclick: () => voice.toggleSpeak(i, html),
        }, voice.speakingId === i ? "⏹ Stop" : "🔊 Listen") : null);
    }));
    log.scrollTop = log.scrollHeight;
  }

  async function chatSend() {
    const ta = $("#chat-text");
    let text = ta.value.trim();
    const files = S.chat.files || [];
    if ((!text && !files.length) || S.chat.busy) return;
    if (!S.config.chatUrl) {
      if (files.length) { toast("Reading files needs the AI assistant to be connected.", "error"); return; }
      S.chat.view.push({ role: "user", text }, { role: "bot", text: offlineAnswer(text) });
      ta.value = ""; chatSave(); chatRender(); return;
    }
    if (files.length && !text) text = files.some((f) => f.type === "text/csv" || f.type === "spreadsheet") ? "Please analyse this bank statement." : "Please read this document and help me with it — if it's a Form 16, salary slip or tax document, work out my income tax and fill in the calculator; if it's a bank statement, analyse it.";
    ta.value = "";
    S.chat.files = []; renderFiles();
    S.chat.busy = true; $("#chat-send").disabled = true;
    // Files go first, then the question: PDFs as document blocks, photos as image blocks, Excel / CSV as text.
    // They are also kept in memory so a statement can be loaded into the Bank Statement Analyzer.
    S.chat.attached = [...(S.chat.attached || []), ...files].slice(-6);
    const blocks = [];
    for (const f of files) {
      if (f.type === "application/pdf") blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data }, title: f.name });
      else if (/^image\//.test(f.type)) blocks.push({ type: "image", source: { type: "base64", media_type: f.type, data: f.data } });
      else blocks.push({ type: "document", source: { type: "text", media_type: "text/plain", data: await sheetText(f) }, title: f.name });
    }
    const content = files.length ? [...blocks, { type: "text", text }] : text;
    S.chat.messages.push({ role: "user", content });
    S.chat.view.push({ role: "user", text: [...files.map((f) => `📎 ${f.name}`), text].join("\n") });
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
          S.chat.view.push({ role: "error", text: "Sorry, I can't answer that. Please try asking in a different way." });
          break;
        }
        S.chat.messages.push({ role: "assistant", content });
        if (stopReason !== "tool_use") {
          if (stopReason === "max_tokens") S.chat.view.push({ role: "error", text: "(The answer was cut short because it got long — type “continue”.)" });
          break;
        }
        const results = [];
        for (const block of content.filter((b) => b.type === "tool_use")) {
          S.chat.view.push({ role: "tool", text: toolLabel(block.name, block.input || {}) });
          let out;
          try { out = tools[block.name] ? await tools[block.name](block.input || {}) : { error: `Unknown tool ${block.name}` }; } catch (e) { out = { error: String(e.message || e) }; }
          results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out), is_error: !!out.error || undefined });
        }
        S.chat.messages.push({ role: "user", content: results });
        chatRender();
      }
    } catch (e) {
      S.chat.messages.length = historyMark;
      console.warn("Saarthi AI unavailable:", e.message);
      S.chat.view = S.chat.view.filter((m) => !(m.role === "bot" && !m.text)); // drop the empty "typing" bubble
      const note = e.dailyLimit
        ? `You've reached today's limit${typeof e.dailyLimit === "number" ? ` of ${e.dailyLimit} questions` : ""} — please come back tomorrow. Meanwhile, here is what the site itself can tell you:`
        : "The AI isn't available right now — here is what the site itself can tell you:";
      if (e.dailyLimit) S.chat.remaining = 0;
      S.chat.view.push({ role: "tool", text: note }, { role: "bot", text: offlineAnswer(text) });
    } finally {
      S.chat.busy = false; $("#chat-send").disabled = false;
      chatSave(); chatRender();
    }
  }

  /* Built-in Saarthi: answers straight from the site's text when the AI worker
   * isn't connected (or can't be reached) — topic guide + verse lookup + search. */
  const TOPICS = [
    { hi: "कर्म और कर्तव्य", en: "Action & duty", keys: ["कर्म", "कर्तव्य", "काम कैसे", "karma", "karm", "duty", "work", "action", "फल"], refs: ["2.47", "2.48", "3.8", "3.19", "18.47"],
      note: "The Gita's core message — act with your whole heart, but let go of worry about, and attachment to, the result." },
    { hi: "मन को वश में करना", en: "Mastering the mind", keys: ["मन", "चंचल", "ध्यान", "एकाग्र", "mind", "mann", "man ko", "focus", "concentrat", "meditat", "dhyan"], refs: ["6.5", "6.6", "6.26", "6.34", "6.35"],
      note: "The mind is restless, but practice and detachment bring it under control — and each of us is our own best friend." },
    { hi: "क्रोध", en: "Anger", keys: ["क्रोध", "गुस्सा", "गुस्से", "anger", "angry", "gussa", "krodh"], refs: ["2.62", "2.63", "3.37", "16.21"],
      note: "Dwelling on objects breeds attachment, attachment breeds desire, and desire breeds anger — seeing this chain is the first remedy." },
    { hi: "चिंता, भय और तनाव", en: "Worry, fear & stress", keys: ["चिंता", "डर", "भय", "तनाव", "परेशान", "fear", "worry", "anxiety", "stress", "tension", "chinta", "dar "], refs: ["2.14", "2.56", "9.22", "18.66"],
      note: "Joy and sorrow come and go; whoever takes refuge in the Lord, He Himself carries their welfare." },
    { hi: "दुःख और शोक", en: "Grief & sorrow", keys: ["दुःख", "दुख", "शोक", "उदास", "sad", "grief", "sorrow", "depress", "dukh"], refs: ["2.11", "2.14", "2.15", "6.22", "6.23"],
      note: "The wise grieve neither for those who have gone nor for those who remain — one who stays even in joy and sorrow is fit for immortality." },
    { hi: "मृत्यु और आत्मा", en: "Death & the Self", keys: ["मृत्यु", "मौत", "मरना", "आत्मा", "पुनर्जन्म", "death", "die", "soul", "atma", "rebirth", "reincarnat"], refs: ["2.20", "2.22", "2.23", "2.27", "8.6"],
      note: "The Self is never born and never dies — just as we change old clothes, the Self changes bodies." },
    { hi: "भक्ति", en: "Devotion", keys: ["भक्ति", "भक्त", "पूजा", "प्रेम", "प्रार्थना", "bhakti", "devotion", "devotee", "worship", "prayer", "love god"], refs: ["9.22", "9.26", "12.13", "12.14", "18.65"],
      note: "Even a leaf, a flower, a fruit or water offered with love is accepted by the Lord — Chapter 12 beautifully describes the qualities of a devotee." },
    { hi: "शरणागति", en: "Surrender", keys: ["शरण", "समर्पण", "surrender", "sharan", "refuge"], refs: ["18.66", "18.62", "7.14", "9.34"],
      note: "The Gita's final and highest teaching — leave everything and take refuge in Me; I will free you from all sins." },
    { hi: "सफलता, असफलता और समता", en: "Success, failure & equanimity", keys: ["सफल", "असफल", "हार", "जीत", "समता", "success", "fail", "exam", "result", "equanim", "balance"], refs: ["2.38", "2.48", "2.50", "6.9", "12.18"],
      note: "Staying even in success and failure is yoga — and skill in action is yoga too." },
    { hi: "कामना, लोभ और इंद्रियाँ", en: "Desire, greed & the senses", keys: ["इच्छा", "कामना", "लोभ", "लालच", "इंद्रिय", "desire", "greed", "lust", "senses", "temptation", "addiction"], refs: ["3.37", "3.39", "3.41", "2.70", "16.21"],
      note: "Lust, anger and greed are the three gates to hell; this enemy is conquered by mastering the senses." },
    { hi: "स्थितप्रज्ञ", en: "The person of steady wisdom", keys: ["स्थितप्रज्ञ", "स्थिर बुद्धि", "sthitaprajna", "sthitpragya", "steady wisdom"], refs: ["2.54", "2.55", "2.56", "2.57", "2.58"],
      note: "Answering Arjuna's question, Shri Krishna describes the person of steady wisdom at the end of Chapter 2." },
    { hi: "ज्ञान और गुरु", en: "Knowledge & the teacher", keys: ["ज्ञान", "गुरु", "सीख", "knowledge", "wisdom", "guru", "teacher", "learn"], refs: ["4.34", "4.38", "4.39", "13.8"],
      note: "Knowledge comes from a wise teacher through humility, questions and service — and nothing is as purifying as knowledge." },
    { hi: "धर्म और अवतार", en: "Dharma & divine descent", keys: ["धर्म", "अवतार", "स्वधर्म", "dharma", "avatar", "righteous"], refs: ["4.7", "4.8", "3.35", "18.47"],
      note: "Whenever dharma declines, the Lord appears — and one's own dharma, even imperfect, is better than another's." },
    { hi: "आहार और संयमित जीवन", en: "Food & balanced living", keys: ["आहार", "भोजन", "खाना", "नींद", "food", "diet", "eat", "sleep"], refs: ["6.16", "6.17", "17.8", "17.9", "17.10"],
      note: "Yoga isn't for one who eats too much or too little — balanced food and rest end sorrow." },
    { hi: "तीन गुण", en: "The three gunas", keys: ["गुण", "सत्त्व", "रजो", "तमो", "guna", "sattva", "rajas", "tamas"], refs: ["14.5", "14.6", "14.7", "14.8", "14.20"],
      note: "Sattva, rajas and tamas bind the Self; one who rises above them attains immortality." },
    { hi: "भगवान का स्वरूप", en: "Who is God?", keys: ["भगवान", "ईश्वर", "परमात्मा", "विश्वरूप", "god", "krishna", "ishwar", "divine", "vishwaroop", "universal form"], refs: ["7.7", "10.8", "10.20", "11.12", "15.15"],
      note: "The whole world is strung on the Lord like pearls on a thread; He dwells in every heart." },
  ];

  function shlokBlock(ref) {
    const [c, v] = ref.split(".").map(Number);
    const s = findShlok(c, v);
    if (!s) return "";
    const sa = s.sa.split("\n").map((l) => `> ${l}`).join("\n");
    return `#### Shlok [${ref}](#/c/${c}/${v})\n${sa}${s.en ? `\n\n**English:** ${s.en}` : ""}\n\n*Hindi meaning:* ${s.hi}`;
  }

  function offlineAnswer(question) {
    const q = fold(question);
    if (/(tax|itr|form ?16|आयकर|टैक्स|इनकम|रिजीम|regime)/i.test(question)) {
      return "### Income Tax Calculator\n[Open the Income Tax Calculator](#/tax) to work out the tax of an individual, HUF, firm, LLP or company — it compares the options (new vs old regime; normal rates vs 115BAA), with print and PDF.\n\n*When the AI is connected, Saarthi can read your Form 16 and fill in the calculator for you.*";
    }
    const go = (title, href, text) => `### ${title}\n[Open ${title}](${href}) — ${text}\n\n*When the AI is connected, Saarthi can use this page for you.*`;
    if (/(bank|statement|passbook|बैंक|स्टेटमेंट)/i.test(question)) return go("Bank Statement Analyzer", "#/bank", "load a PDF, Excel or CSV statement for a summary, monthly cash flow, categories and checks. It is read only in your browser.");
    if (/(tender|निविदा|टेंडर|eproc|bid)/i.test(question)) return go("Bihar Tenders", "#/tenders", "Bihar Government tenders with values and closing dates.");
    if (/(scanner|screen|nifty|stock|शेयर|52.?week|dma|breakdown)/i.test(question)) return go("Capital Market Scanner", "#/scanner", "NIFTY 500 chart patterns with the SKC rating (educational, not advice).");
    if (/(capital|capex|roce|ratio|break.?even|goal|sip|management|प्रबंधन|efficiency|working capital)/i.test(question)) return go("Management Services", "#/management", "tools for capital analysis, business health, capex planning, financial goals and money efficiency.");
    if (/(vision|bihar.*(document|policy)|विज़न)/i.test(question)) return go("Bihar Vision Documents", "#/vision", "vision and working documents of Bihar, by sector.");
    if (/(document|news|samachar|समाचार|दस्तावेज़|daily market update)/i.test(question)) return go("Documents & News", "#/library", "the document library, news and the Daily Market Update.");
    if (/(video|वीडियो|market|मार्केट|निवेश|invest|shares?|silver|सिल्वर)/i.test(question)) {
      return "### Gita se Capital Market tak\n[Watch the JMJ Wealth Creator videos here](#/videos). (For educational purposes only; not buy/sell advice.)";
    }
    const footer = "\n\n---\n*This is Saarthi's basic mode — answers come straight from the Gita's verses. Deeper discussion (follow-up questions, examples, commentary) switches on when the AI is connected.*";
    const refs = [...question.matchAll(/\b(\d{1,2})[.:](\d{1,2})\b/g)].map((m) => `${+m[1]}.${+m[2]}`).filter((r) => findShlok(...r.split(".").map(Number)));
    if (refs.length) {
      return refs.slice(0, 4).map(shlokBlock).join("\n\n") + footer;
    }
    const chMatch = question.match(/(?:अध्याय|chapter|adhyay)\s*(\d{1,2})/i);
    if (chMatch && findChapter(+chMatch[1])) {
      const c = findChapter(+chMatch[1]);
      return `### Chapter ${c.n} · ${c.sa}\n**${c.en}** · *${c.hi}* · ${c.shlokas.length} shlokas\n\n${c.sum_en}\n\n*${c.sum_hi}*\n\n[Read the whole chapter →](#/c/${c.n})` + footer;
    }
    const scored = TOPICS.map((t) => ({ t, score: t.keys.reduce((n, k) => n + (q.includes(fold(k)) ? 1 : 0), 0) }))
      .filter((x) => x.score).sort((a, b) => b.score - a.score);
    if (scored.length) {
      const t = scored[0].t;
      return `### ${t.en} · ${t.hi}\n${t.note}\n\n` + t.refs.slice(0, 4).map(shlokBlock).join("\n\n") +
        (scored[1] ? `\n\nRelated topic: **${scored[1].t.en}** — ask about "${scored[1].t.en}"` : "") + footer;
    }
    const hits = tools.search_gita({ query: question }).results.slice(0, 3);
    if (hits.length) {
      return "Shlokas related to your question:\n\n" + hits.map((h) => shlokBlock(h.ref)).join("\n\n") + footer;
    }
    return "I couldn't find a shlok matching that. Try a topic — like **karma**, **mind**, **anger**, **worry**, **devotion**, **death**, **surrender** — or a verse number like **2.47**, or **chapter 12**." + footer;
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

  window.GG = {
    toast, rerender,
    askSaarthi: (text) => { chatOpen(text); },
    contact: () => ({ email: S.content.site.contact_email || "", phone: S.content.site.contact_phone || "" }),
    adminPutFile: ADMIN ? (path, text, message) => {
      const { owner, repo, token } = ghSettings();
      if (!owner || !repo || !token) return Promise.reject(new Error("add your GitHub details in Settings first"));
      return ghPutFile(path, text, message);
    } : undefined,
  };
  boot();
})();
