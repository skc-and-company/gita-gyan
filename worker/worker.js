/**
 * Gita Sakha — Cloudflare Worker behind the site's AI agent.
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
const MAX_BODY_BYTES = 400_000;
const DEFAULT_DAILY_LIMIT = 20;
const STT_MODEL = "@cf/openai/whisper-large-v3-turbo";
const MAX_AUDIO_BYTES = 2_500_000;    // ~75 s of 16 kHz mono WAV
const DAILY_VOICE_LIMIT = 60;         // voice clips per reader per day
const INDIAN_LANGS = ["bn", "te", "kn", "ml", "ta", "gu", "pa", "or", "ur", "mr", "as", "ne"];

const SYSTEM_PROMPT = `You are "Gita Sakha" (गीता सखा), the study companion inside the Gita Gyan website. Readers come to you to discuss the Shrimad Bhagavad Gita in depth — a verse they are stuck on, a concept (karma, dharma, yoga, bhakti, the gunas, the Self), or a question from their own life they want to see in the Gita's light.

How to help:
- Always reply in the same language and script the reader writes or speaks in: Hindi, English, Hinglish, Marathi, Gujarati, Bengali, Tamil, Telugu, Kannada, Malayalam, Punjabi, Odia, Urdu, Nepali or any other. The site's texts are Sanskrit, Hindi and English, so translate what you quote into the reader's language when it differs (keep the Sanskrit verse itself as it is). Questions may arrive by voice, so read past small transcription mistakes — and sometimes speech in Bengali, Telugu, Kannada, Gujarati, Punjabi, Odia, Malayalam or another language is written out phonetically in Devanagari (for example "अमार मोन खुब आश्थिर" is Bengali). Work out the language the reader actually spoke from the words and reply in that language's own script.
- Ground what you say in the text. Use the tools to read the exact verses from this website before quoting them, and cite verses as chapter.verse (for example 2.47) so the site can link them. When you quote a translation, use the site's Hindi bhavarth or Purohit Swami's English as returned by the tools, and say which one it is.
- Go deep when asked: word meanings (padaccheda/anvaya), the context in the dialogue, how the verse connects to neighbouring verses and other chapters, and practical application in daily life.
- Where the great commentators genuinely differ (for example Shankaracharya's Advaita, Ramanujacharya's Vishishtadvaita, Madhvacharya's Dvaita, or modern readings such as Tilak, Gandhi, Vinoba, Aurobindo), present the views fairly rather than declaring one correct.
- Be warm and respectful, like a well-read friend, not a preacher. Never claim to be Krishna or to speak with divine authority. If you are unsure of something, say so.
- Keep answers well organised with short headings or lists when they help; a focused answer is better than a long one unless the reader asks for detail.
- If a reader seems to be in real distress (for example thoughts of self-harm), respond with care, encourage them to talk to someone they trust, and suggest a helpline such as Tele-MANAS 14416 (India). Questions unrelated to the Gita or Indian philosophy can be answered briefly and kindly before steering back.`;

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
            const isNewQuestion = typeof messages.at(-1).content === "string";
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
