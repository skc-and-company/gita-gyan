/**
 * Saarthi (सारथी) — Cloudflare Worker behind the site's AI assistant.
 *
 * Keeps the Claude API key secret and fixes the model, system prompt and tools,
 * so the browser can only send the conversation. The tools themselves run in the
 * reader's browser against the site's own (decrypted) text.
 *
 * Plain fetch() instead of the Anthropic SDK so this file can be pasted straight
 * into the Cloudflare dashboard editor with no build step.
 *
 * Secrets / variables (Worker → Settings → Variables and Secrets):
 *   ANTHROPIC_API_KEY  (secret)   your Claude API key
 *   CHAT_TOKEN         (secret)   same value as "Chat token" in the admin Settings
 *   ADMIN_KEY          (secret)   any long random string; lets the admin read the visitor log
 *   ALLOWED_ORIGIN     (optional) e.g. https://yourname.github.io  (default: allow any)
 *   MODEL              (optional) default claude-haiku-5-5
 *   EFFORT             (optional) low | medium | high   (default low)
 *   DAILY_LIMIT        (optional) questions per reader per day (default 20; 0 = no limit).
 *                      The admin can also change it from the site's Settings page.
 * KV binding (optional, for the visitor log and the daily limit):  VISITS
 * Workers AI binding (for voice questions — speech-to-text with automatic language detection):  AI
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const MAX_BODY_BYTES = 15_000_000;   // room for attached PDFs / photos (sent as base64)
const DEFAULT_DAILY_LIMIT = 20;
const STT_MODEL = "@cf/openai/whisper-large-v3-turbo";
const MAX_AUDIO_BYTES = 2_500_000;    // ~75 s of 16 kHz mono WAV
const DAILY_VOICE_LIMIT = 60;         // voice clips per reader per day
const INDIAN_LANGS = ["bn", "te", "kn", "ml", "ta", "gu", "pa", "or", "ur", "mr", "as", "ne"];

const SYSTEM_PROMPT = `You are Saarthi (सारथी), the assistant inside SKC & CO.'s Gita Gyan website. Like Krishna as Arjuna's charioteer, you guide people through everything the site offers:

1. The Shrimad Bhagavad Gita — verses, concepts (karma, dharma, yoga, bhakti, the gunas, the Self) and life questions seen in the Gita's light.
2. The Income Tax Calculator — income tax for individuals in India, Tax Year 2026-27 (Income-tax Act 2025; rates unchanged by Finance Act 2026), new and old regime.
3. "Gita se Capital Market tak" — JMJ Wealth Creator videos that connect Gita lessons with investing.

Language: always reply in the same language and script the person writes or speaks in — Hindi, English, Hinglish, Marathi, Gujarati, Bengali, Tamil, Telugu, Kannada, Malayalam, Punjabi, Odia, Urdu, Nepali or any other. Questions may arrive by voice, so read past small transcription mistakes; speech in Bengali, Telugu, Kannada and similar languages is sometimes written out phonetically in Devanagari (for example "अमार मोन खुब आश्थिर" is Bengali) — work out the language actually spoken and reply in its own script. The site's interface is in English, so when the language is unclear (for example a document sent with no message), reply in English.

Gita: ground what you say in the text. Read the exact verses with the tools before quoting, cite them as chapter.verse (for example 2.47) so the site can link them, and say whether a translation is the site's Hindi bhavarth or Purohit Swami's English. The site's texts are Sanskrit, Hindi and English, so translate quotes into the reader's language when it differs (keep the Sanskrit as it is). Go deep when asked — word meanings, context, links to other verses, daily-life use. Where commentators differ (Shankara, Ramanuja, Madhva, Tilak, Gandhi, Vinoba, Aurobindo…), present the views fairly. Never claim to be Krishna or to speak with divine authority.

Tax: never do tax arithmetic yourself — use calculate_tax, which runs the site's tested calculator, and quote its figures. When someone shares a document (Form 16, salary slip, AIS/26AS, capital-gains or interest statement, rent receipts), read it carefully and call calculate_tax with show_in_calculator set to true straight away, in the same turn, so the calculator on the site is filled in for them to check, print or save — do not wait for a go-ahead. Documents often belong to a family member or a client, so a name that differs from the reader's is normal and no reason to hold back. Where something is missing or unclear (age, residential status and so on), use the sensible default (below 60, resident) and say so. Then list the figures you used and where they came from, state any assumptions, and offer to recalculate if anything needs correcting. read_tax_calculator shows what is currently on the calculator page. Explain the result simply, say which regime is cheaper and why, and remind them it is an estimate for guidance — not tax advice — to verify with a professional or the official utility before filing. Do not repeat full PAN, Aadhaar, bank account or phone numbers from documents.

Videos: use list_videos to see the episodes and open_page to take people there. Investing content is educational only — never give buy/sell calls, price targets or personal investment advice.

Style: warm and respectful, like a knowledgeable friend; focused, well-organised answers with short headings or lists when they help. If you are unsure, say so. If someone seems to be in real distress (for example thoughts of self-harm), respond with care, encourage them to talk to someone they trust, and suggest a helpline such as Tele-MANAS 14416 (India). Anything outside these services can be answered briefly and kindly.`;

const AMOUNT = (description) => ({ type: "number", description });

const TOOLS = [
  {
    name: "get_shlokas",
    description: "Read verses from this website's text of the Bhagavad Gita: Sanskrit, IAST transliteration, the site's own Hindi bhavarth, Shri Purohit Swami's English translation, and any admin note. Returns at most 15 verses per call. Chapter verse counts: 1:47 2:72 3:43 4:42 5:29 6:47 7:30 8:28 9:34 10:42 11:55 12:20 13:35 14:27 15:20 16:24 17:28 18:78.",
    input_schema: {
      type: "object",
      properties: {
        chapter: { type: "integer", description: "Chapter number, 1-18" },
        start_verse: { type: "integer", description: "First verse number" },
        end_verse: { type: "integer", description: "Last verse number (inclusive). Use the same as start_verse for one verse." },
      },
      required: ["chapter", "start_verse", "end_verse"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "search_gita",
    description: "Keyword search across the site's Hindi, English, transliteration and Sanskrit text. Returns up to 12 matching verse references with short snippets. Use it to find where a theme or word appears, then read the full verses with get_shlokas. Search with Hindi or English words (translate keywords from other languages first).",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Words to search for, in Hindi, English or transliteration" } },
      required: ["query"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "get_chapter",
    description: "Get a chapter's names (Sanskrit, Hindi, English), verse count and the site's summary.",
    input_schema: {
      type: "object",
      properties: { chapter: { type: "integer", description: "Chapter number, 1-18" } },
      required: ["chapter"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "calculate_tax",
    description: "Run the site's Income Tax Calculator (individuals, Tax Year 2026-27) and get both regimes' tax, the recommendation and the main lines of each computation. All amounts are annual rupees; leave out anything that doesn't apply. Set show_in_calculator to true to also fill the calculator page on the site with these figures and open it (do this after reading someone's document).",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Taxpayer name for the computation heading (optional)" },
        age: { type: "string", enum: ["below_60", "60_to_80", "80_plus"] },
        resident: { type: "boolean", description: "Resident in India (default true)" },
        salary_gross: AMOUNT("Gross salary incl. perquisites"),
        exempt_allowances: AMOUNT("Exempt allowances u/s 10 such as HRA, LTA (old regime)"),
        professional_tax: AMOUNT("Professional tax paid"),
        basic_da: AMOUNT("Basic + DA, for the 80CCD(2) cap"),
        house_property: { type: "string", enum: ["none", "self_occupied", "let_out"] },
        rent_received: AMOUNT("Annual rent received (let-out)"),
        municipal_tax: AMOUNT("Municipal tax paid (let-out)"),
        home_loan_interest: AMOUNT("Home-loan interest u/s 24(b)"),
        business_method: { type: "string", enum: ["regular", "44AD", "44ADA"] },
        net_profit: { type: "number", description: "Business net profit (regular); negative for a loss" },
        turnover_digital_44ad: AMOUNT("44AD turnover received digitally / by bank"),
        turnover_cash_44ad: AMOUNT("44AD turnover received in cash"),
        gross_receipts_44ada: AMOUNT("44ADA gross receipts"),
        stcg_111a: AMOUNT("Short-term gain on listed equity / equity funds (111A)"),
        stcg_other: AMOUNT("Other short-term capital gain (slab rates)"),
        ltcg_112a: AMOUNT("Long-term gain on listed equity / equity funds (112A), before the 1.25 lakh exemption"),
        ltcg_112: AMOUNT("Other long-term capital gain (112)"),
        savings_interest: AMOUNT("Savings bank interest"),
        fd_interest: AMOUNT("FD / other interest"),
        dividends: AMOUNT("Dividends"),
        other_income: AMOUNT("Other income"),
        d80c: AMOUNT("80C / 80CCC / 80CCD(1) investments (PF, PPF, ELSS, LIC, tuition fees…)"),
        d80ccd1b: AMOUNT("80CCD(1B) own NPS contribution"),
        d80ccd2: AMOUNT("80CCD(2) employer NPS contribution"),
        d80d_self: AMOUNT("80D health insurance for self / family"),
        d80d_parents: AMOUNT("80D health insurance for parents"),
        parents_senior: { type: "boolean", description: "Parents are senior citizens" },
        d80e: AMOUNT("80E education-loan interest"),
        d80g: AMOUNT("80G qualifying donation amount"),
        other_deductions: AMOUNT("Other Chapter VI-A deductions (80DD, 80U, 80GG…)"),
        show_in_calculator: { type: "boolean", description: "Also fill and open the calculator page on the site" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "read_tax_calculator",
    description: "Read what is currently entered on the site's Income Tax Calculator page and its latest result, if any.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_videos",
    description: "List the 'Gita se Capital Market tak' (JMJ Wealth Creator) episodes on the site, with titles, descriptions and YouTube links, plus upcoming topics.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "open_page",
    description: "Open a page of the site for the person: home, chapters, a chapter or verse, the tax calculator, or the videos page.",
    input_schema: {
      type: "object",
      properties: {
        page: { type: "string", enum: ["home", "chapters", "chapter", "tax", "videos"] },
        chapter: { type: "integer", description: "For page = chapter" },
        verse: { type: "integer", description: "Optional verse within the chapter" },
      },
      required: ["page"],
      additionalProperties: false,
    },
  },
];

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, x-chat-token, x-admin-key, x-lang-hint",
      "Access-Control-Expose-Headers": "x-questions-remaining",
      "Access-Control-Max-Age": "86400",
    };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });
    const isAdmin = () => !!env.ADMIN_KEY && request.headers.get("x-admin-key") === env.ADMIN_KEY;

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const { pathname } = new URL(request.url);

    try {
      if (pathname === "/chat" && request.method === "POST") {
        if (!env.CHAT_TOKEN || request.headers.get("x-chat-token") !== env.CHAT_TOKEN) return json({ error: "Not authorised" }, 401);
        const raw = await request.text();
        if (raw.length > MAX_BODY_BYTES) return json({ error: "Conversation is too long — please start a new one (↺)." }, 413);
        const { messages, name } = JSON.parse(raw);
        if (!Array.isArray(messages) || !messages.length || messages[0].role !== "user") return json({ error: "Bad request" }, 400);

        // Daily question limit per reader (admin is never limited). Only a new question counts —
        // the follow-up calls Claude makes while reading verses belong to the same question.
        let remaining = null;
        if (env.VISITS && !isAdmin()) {
          const limit = await dailyLimit(env);
          if (limit > 0) {
            const key = `q:${indiaDate()}:${await readerId(request)}`;
            let used = Number(await env.VISITS.get(key)) || 0;
            const lastMsg = messages.at(-1);
            const isNewQuestion = lastMsg.role === "user" && (typeof lastMsg.content === "string"
              || !lastMsg.content.every((b) => b.type === "tool_result"));
            if (isNewQuestion) {
              if (used >= limit) return json({ error: { type: "daily_limit", message: `Daily limit of ${limit} questions reached.` }, limit }, 429);
              used += 1;
              await env.VISITS.put(key, String(used), { expirationTtl: 60 * 60 * 48 });
            }
            remaining = Math.max(0, limit - used);
          }
        }
        return chat(env, messages, name, { ...cors, ...(remaining == null ? {} : { "x-questions-remaining": String(remaining) }) });
      }

      // Voice question → text. Whisper detects the spoken language by itself, so readers never pick one.
      if (pathname === "/transcribe" && request.method === "POST") {
        if (!env.CHAT_TOKEN || request.headers.get("x-chat-token") !== env.CHAT_TOKEN) return json({ error: "Not authorised" }, 401);
        if (!env.AI) return json({ error: "Voice isn't switched on yet (no Workers AI binding named AI)." }, 503);
        const audio = await request.arrayBuffer();
        if (!audio.byteLength) return json({ error: "Empty recording" }, 400);
        if (audio.byteLength > MAX_AUDIO_BYTES) return json({ error: "Recording is too long — please keep it under a minute." }, 413);
        if (env.VISITS && !isAdmin()) {
          const key = `t:${indiaDate()}:${await readerId(request)}`;
          const used = Number(await env.VISITS.get(key)) || 0;
          if (used >= DAILY_VOICE_LIMIT) return json({ error: { type: "daily_limit" } }, 429);
          await env.VISITS.put(key, String(used + 1), { expirationTtl: 60 * 60 * 48 });
        }
        const b64 = toBase64(audio);
        const transcribe = (language) => env.AI.run(STT_MODEL, { audio: b64, vad_filter: true, condition_on_previous_text: false, ...(language ? { language } : {}) });
        let out = await transcribe();
        let language = out?.transcription_info?.language || null;
        // Whisper can mistake Bengali, Telugu, Kannada… for Hindi. If the reader's phone is set to one of those
        // languages, trust that and transcribe again in it (still no choice for the reader to make).
        const hint = (request.headers.get("x-lang-hint") || "").split(",").map((l) => l.trim().slice(0, 2).toLowerCase())
          .find((c) => INDIAN_LANGS.includes(c));
        if (hint && hint !== language && ["hi", "mr", "ne"].includes(language)) {
          out = await transcribe(hint);
          language = hint;
        }
        const text = String(out?.text ?? out?.transcription_info?.text ?? "").trim();
        return json({ text, language });
      }

      if (pathname === "/visit" && request.method === "POST") {
        if (!env.CHAT_TOKEN || request.headers.get("x-chat-token") !== env.CHAT_TOKEN) return json({ error: "Not authorised" }, 401);
        if (!env.VISITS) return json({ ok: true, stored: false });
        const { name } = await request.json();
        const at = Date.now();
        await env.VISITS.put(`v:${String(9e15 - at).padStart(16, "0")}:${crypto.randomUUID().slice(0, 8)}`, "", {
          expirationTtl: 60 * 60 * 24 * 180,
          metadata: { name: String(name || "").slice(0, 60), at, country: request.cf?.country || "" },
        });
        return json({ ok: true, stored: true });
      }

      if (pathname === "/visits" && request.method === "GET") {
        if (!env.ADMIN_KEY || request.headers.get("x-admin-key") !== env.ADMIN_KEY) return json({ error: "Not authorised" }, 401);
        if (!env.VISITS) return json({ error: "No VISITS KV namespace is bound to this worker." }, 404);
        const list = await env.VISITS.list({ prefix: "v:", limit: 1000 }); // newest first (keys sort by reversed time)
        return json({ visits: list.keys.map((k) => k.metadata).filter(Boolean) });
      }

      if (pathname === "/config") {
        if (!isAdmin()) return json({ error: "Not authorised" }, 401);
        if (!env.VISITS) return json({ error: "No VISITS KV namespace is bound to this worker." }, 404);
        if (request.method === "POST") {
          const { daily_limit } = await request.json();
          const n = Math.floor(Number(daily_limit));
          if (!(n >= 0 && n <= 1000)) return json({ error: "daily_limit must be a number from 0 to 1000" }, 400);
          await env.VISITS.put("cfg:daily_limit", String(n));
        }
        return json({ daily_limit: await dailyLimit(env) });
      }

      if (pathname === "/" || pathname === "/health") return json({ ok: true, service: "gita-sakha" });
      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json({ error: String(e?.message || e) }, 500);
    }
  },
};

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function dailyLimit(env) {
  const saved = env.VISITS ? await env.VISITS.get("cfg:daily_limit") : null;
  const n = Number(saved ?? env.DAILY_LIMIT ?? DEFAULT_DAILY_LIMIT);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_LIMIT;
}

// The day rolls over at midnight India time.
function indiaDate() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

// A reader is identified by a hash of their IP address, so the raw address is never stored.
async function readerId(request) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`gita-sakha:${ip}`));
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function chat(env, messages, name, cors) {
  const model = env.MODEL || "claude-haiku-5-5";
  const system = [{ type: "text", text: SYSTEM_PROMPT }];
  const reader = String(name || "").replace(/[^\p{L}\p{M}\p{N} .'-]/gu, "").slice(0, 40).trim();
  if (reader) system.push({ type: "text", text: `The reader's name is ${reader}.` });

  const body = {
    model,
    max_tokens: 32000,
    stream: true,
    system,
    tools: TOOLS,
    messages,
    output_config: { effort: env.EFFORT || "low" },
    cache_control: { type: "ephemeral" },
  };
  const headers = {
    "content-type": "application/json",
    "x-api-key": env.ANTHROPIC_API_KEY,
    "anthropic-version": "2026-10-21",
  };
  // Server-side fallback: if the model's safety classifier declines, Anthropic retries on its recommended model.
  // (Not available for Haiku 5.5 — a declined request there stays declined and the site shows a polite message.)
  if (/^claude-(opus|sonnet|fable)/.test(model)) {
    body.fallbacks = "default";
    headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
  }

  const upstream = await fetch(API_URL, { method: "POST", headers, body: JSON.stringify(body) });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { ...cors, "content-type": upstream.headers.get("content-type") || "text/event-stream", "cache-control": "no-store" },
  });
}
