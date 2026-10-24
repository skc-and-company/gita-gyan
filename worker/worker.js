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
 *   MODEL              (optional) default claude-opus-5-5
 *   EFFORT             (optional) low | medium | high   (default medium)
 * KV binding (optional, for the visitor log):  VISITS
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const MAX_BODY_BYTES = 400_000;

const SYSTEM_PROMPT = `You are "Gita Sakha" (गीता सखा), the study companion inside the Gita Gyan website. Readers come to you to discuss the Shrimad Bhagavad Gita in depth — a verse they are stuck on, a concept (karma, dharma, yoga, bhakti, the gunas, the Self), or a question from their own life they want to see in the Gita's light.

How to help:
- Reply in the reader's language and script: Hindi in Devanagari, Hinglish if they write Hinglish, English if they write English.
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
    description: "Keyword search across the site's Hindi, English, transliteration and Sanskrit text. Returns up to 12 matching verse references with short snippets. Use it to find where a theme or word appears, then read the full verses with get_shlokas.",
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
      "Access-Control-Allow-Headers": "content-type, x-chat-token, x-admin-key",
      "Access-Control-Max-Age": "86400",
    };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const { pathname } = new URL(request.url);

    try {
      if (pathname === "/chat" && request.method === "POST") {
        if (!env.CHAT_TOKEN || request.headers.get("x-chat-token") !== env.CHAT_TOKEN) return json({ error: "Not authorised" }, 401);
        const raw = await request.text();
        if (raw.length > MAX_BODY_BYTES) return json({ error: "Conversation is too long — please start a new one (↺)." }, 413);
        const { messages, name } = JSON.parse(raw);
        if (!Array.isArray(messages) || !messages.length || messages[0].role !== "user") return json({ error: "Bad request" }, 400);
        return chat(env, messages, name, cors);
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

      if (pathname === "/" || pathname === "/health") return json({ ok: true, service: "gita-sakha" });
      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json({ error: String(e?.message || e) }, 500);
    }
  },
};

async function chat(env, messages, name, cors) {
  const model = env.MODEL || "claude-opus-5-5";
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
    output_config: { effort: env.EFFORT || "medium" },
    cache_control: { type: "ephemeral" },
  };
  const headers = {
    "content-type": "application/json",
    "x-api-key": env.ANTHROPIC_API_KEY,
    "anthropic-version": "2026-10-21",
  };
  // Server-side fallback: if the model's safety classifier declines, Anthropic retries on its recommended model.
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
