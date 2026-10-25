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
2. The Income Tax Calculator — Indian income tax for individuals, HUFs, partnership firms, LLPs and domestic companies, Tax Year 2026-27 (Income-tax Act 2025; rates unchanged by Finance Act 2026).
3. The Bank Statement Analyzer — PDF / Excel / CSV statements of individuals and businesses, read in the person's browser.
4. Bihar Tenders — Bihar Government eProcurement tenders above SKC's value thresholds, with closing dates.
5. The Capital Market Scanner — an educational NIFTY 500 screen (chart patterns plus the SKC rating).
6. Management Services & Financial Analysis — tools for capital analysis, business health, capex planning, financial goals and money efficiency, plus SKC & CO.'s advisory services.
7. Bihar Vision documents and the Documents & News library (including the Daily Market Update).
8. "Gita se Capital Market tak" — JMJ Wealth Creator videos that connect Gita lessons with investing.

You can use every one of these for the person through your tools — fill in and open the pages, run the analyses and read back what is on screen — so do the work rather than describing how to.

Language: always reply in the same language and script the person writes or speaks in — Hindi, English, Hinglish, Marathi, Gujarati, Bengali, Tamil, Telugu, Kannada, Malayalam, Punjabi, Odia, Urdu, Nepali or any other. Questions may arrive by voice, so read past small transcription mistakes; speech in Bengali, Telugu, Kannada and similar languages is sometimes written out phonetically in Devanagari (for example "अमार मोन खुब आश्थिर" is Bengali) — work out the language actually spoken and reply in its own script. The site's interface is in English, so when the language is unclear (for example a document sent with no message), reply in English.

Gita: ground what you say in the text. Read the exact verses with the tools before quoting, cite them as chapter.verse (for example 2.47) so the site can link them, and say whether a translation is the site's Hindi bhavarth or Purohit Swami's English. The site's texts are Sanskrit, Hindi and English, so translate quotes into the reader's language when it differs (keep the Sanskrit as it is). Go deep when asked — word meanings, context, links to other verses, daily-life use. Where commentators differ (Shankara, Ramanuja, Madhva, Tilak, Gandhi, Vinoba, Aurobindo…), present the views fairly. Never claim to be Krishna or to speak with divine authority.

Tax: never do tax arithmetic yourself — use calculate_tax, which runs the site's tested calculator, and quote its figures. Set taxpayer for HUFs, firms, LLPs and companies: a firm's partners' interest (12% cap) and remuneration (section 40(b) limit) are worked out by the calculator; a company is compared on normal rates (with MAT if you give book profit) against 115BAA, or 115BAB for an eligible new manufacturer — point out that 115BAA/115BAB is irrevocable. When someone shares a document (Form 16, salary slip, AIS/26AS, capital-gains or interest statement, rent receipts), read it carefully and call calculate_tax with show_in_calculator set to true straight away, in the same turn, so the calculator on the site is filled in for them to check, print or save — do not wait for a go-ahead. Documents often belong to a family member or a client, so a name that differs from the reader's is normal and no reason to hold back. Where something is missing or unclear (age, residential status and so on), use the sensible default (below 60, resident) and say so. Then list the figures you used and where they came from, state any assumptions, and offer to recalculate if anything needs correcting. read_tax_calculator shows what is currently on the calculator page. Explain the result simply, say which regime is cheaper and why, and remind them it is an estimate for guidance — not tax advice — to verify with a professional or the official utility before filing. Do not repeat full PAN, Aadhaar, bank account or phone numbers from documents.

Bank statements: when someone attaches a statement (PDF, Excel or CSV) or asks about one, call analyze_bank_statement straight away — it loads the attached file into the site's Bank Statement Analyzer, opens it and returns totals, monthly cash flow, categories, top counterparties and observations. Set account_holder to business for a current / OD / CC account of a proprietor, firm or company. Then explain what stands out (cash flow, returns / bounces, charges, EMIs, tax payments, customer concentration, cash deposits against reporting limits) and what to act on. Use read_bank_statement and find_bank_transactions for follow-up questions about the statement on screen. Never repeat full account numbers.

Tenders: use search_tenders (filters for words, department, minimum value, closing within N days). Give the tender ID, value, department and closing date, and remind people to verify on eproc2.bihar.gov.in; mention how old the data is if it's more than two days.

Markets: use market_scanner to explain the scanner's patterns and ratings, and list_videos for the videos. Investing content is educational only — never give buy/sell calls, price targets or personal investment advice; suggest a SEBI-registered adviser for personal decisions.

Management: use management_tool to run the capital, business, capex, goals or efficiency tool with the person's figures (it fills and opens the page), then explain the results in plain language and practical next steps. For a full review, suggest contacting SKC & CO. through the Management Services page.

Documents: use list_documents for the library, news, the Daily Market Update and Bihar Vision documents; link files you find. Use open_page to take people anywhere on the site.

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
    description: "Run the site's Income Tax Calculator (Tax Year 2026-27) for an individual, HUF, partnership firm, LLP or domestic company. Returns the tax under each option open to the taxpayer (new vs old regime; firm at 30%; company normal rates vs 115BAA/115BAB, with MAT), the recommendation and the main lines of each computation. All amounts are annual rupees; leave out anything that doesn't apply. Set show_in_calculator to true to also fill the calculator page on the site and open it (do this after reading someone's document).",
    input_schema: {
      type: "object",
      properties: {
        taxpayer: { type: "string", enum: ["individual", "huf", "firm", "llp", "company"], description: "Default individual. company = domestic company." },
        name: { type: "string", description: "Taxpayer's name (person, HUF, firm or company) as given in the question or document, for the heading. Leave out if not stated — don't use the reader's own name unless it is their own tax." },
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
        business_method: { type: "string", enum: ["regular", "44AD", "44ADA"], description: "Not for companies or LLPs" },
        net_profit: { type: "number", description: "Individual/HUF: business net profit (negative for a loss). Firm/LLP: net profit BEFORE partners' interest and remuneration. Company: taxable business profit after tax adjustments and tax depreciation." },
        partners_interest: AMOUNT("Firm/LLP: interest paid or credited to partners"),
        partners_capital: AMOUNT("Firm/LLP: partners' capital, for the 12% interest cap"),
        partners_remuneration: AMOUNT("Firm/LLP: remuneration to working partners"),
        brought_forward_loss: AMOUNT("Brought-forward business loss / unabsorbed depreciation"),
        book_profit: AMOUNT("Company: book profit u/s 115JB, for the MAT check"),
        turnover_above_400cr: { type: "boolean", description: "Company: turnover / gross receipts above 400 crore in FY 2024-25 (30% rate instead of 25%)" },
        new_manufacturing_115bab: { type: "boolean", description: "Company: eligible new manufacturing company (compare with 115BAB instead of 115BAA)" },
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
        senior_member: { type: "boolean", description: "HUF: an insured member is a senior citizen (80D cap 50k)" },
        d80jjaa: AMOUNT("Firm/company: 80JJAA additional employee cost"),
        d80m: AMOUNT("Company: 80M inter-corporate dividends distributed"),
        d80e: AMOUNT("80E education-loan interest"),
        d80g: AMOUNT("80G qualifying donation amount"),
        other_deductions: AMOUNT("Individual/HUF: other Chapter VI-A deductions (80DD, 80U, 80GG…). Firm/company: Part C deductions (80-IA, 80-IAC, 80-IBA…)"),
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
    description: "Open a page of the site for the person: home (all services), gita (the Gita section's front page), chapters, a chapter or verse, tax calculator, bank statement analyzer, Bihar tenders, market scanner, management services (optionally one tool), Bihar vision documents, documents & news library, or videos.",
    input_schema: {
      type: "object",
      properties: {
        page: { type: "string", enum: ["home", "gita", "chapters", "chapter", "tax", "bank", "tenders", "scanner", "management", "vision", "library", "videos"] },
        chapter: { type: "integer", description: "For page = chapter" },
        verse: { type: "integer", description: "Optional verse within the chapter" },
        tool: { type: "string", enum: ["capital", "business", "capex", "goals", "efficiency"], description: "For page = management: open this tool" },
      },
      required: ["page"],
      additionalProperties: false,
    },
  },
  {
    name: "analyze_bank_statement",
    description: "Load a bank statement the person attached in this conversation (PDF, Excel or CSV) into the site's Bank Statement Analyzer, open that page, and get the analysis: opening/closing balance, totals, balance check, categories, monthly cash flow, top payers and payees, observations and the largest transactions. Runs in the person's browser.",
    input_schema: {
      type: "object",
      properties: {
        file_name: { type: "string", description: "Name of the attached file; default the latest PDF / Excel / CSV attached" },
        account_holder: { type: "string", enum: ["personal", "business"], description: "business = current / OD / CC account of a proprietor, firm or company" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "read_bank_statement",
    description: "Read the analysis of the statement currently loaded in the Bank Statement Analyzer (whether loaded by you or by the person).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "find_bank_transactions",
    description: "Search the transactions of the statement loaded in the Bank Statement Analyzer. Returns matching rows with totals.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words, reference or amount to look for in the narration" },
        category: { type: "string", enum: ["Salary", "Payroll", "Dividend", "Interest", "Refund", "GST", "Income tax / TDS", "EMI/Loan", "Insurance", "Investments", "Credit card", "Utilities", "Rent", "ATM Cash", "Cash deposit", "Cheque", "UPI", "NEFT/RTGS/IMPS", "Charges/Fees", "Other"] },
        type: { type: "string", enum: ["credit", "debit"] },
        limit: { type: "integer", description: "Rows to return, up to 60 (default 25)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "search_tenders",
    description: "Search the Bihar Government tenders listed on the site (service tenders of 2 crore+, works / goods / supply of 50 crore+). Returns matching tenders with ID, title, department, value, closing time and time left, plus how old the data is.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words in the title, department, office, reference or tender ID" },
        view: { type: "string", enum: ["service", "other", "new", "closing_soon", "closed"], description: "Default: all live tenders" },
        department: { type: "string" },
        min_value_cr: { type: "number", description: "Minimum value in crore rupees" },
        closing_within_days: { type: "number" },
        sort: { type: "string", enum: ["closing", "value", "published"] },
        limit: { type: "integer", description: "Up to 25 (default 12)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "market_scanner",
    description: "Read the site's Capital Market Scanner (educational NIFTY 500 screen): companies matching a chart pattern, with the SKC score and rating, valuation figures and pattern details, plus the data date.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", enum: ["bottom", "below200", "breakdown", "low52"], description: "bottom = double / triple bottom; below200 = >20% below the 200-day average; breakdown = fell below a 20/50-day low; low52 = at a 52-week low" },
        min_rating: { type: "string", enum: ["A", "B"] },
        dividend_only: { type: "boolean" },
        query: { type: "string", description: "Name, symbol or sector" },
        limit: { type: "integer", description: "Up to 20 (default 10)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "management_tool",
    description: "Run one of the Management Services tools with the person's figures (amounts in rupees, percentages as plain numbers such as 12), fill and open its page, and get the results with observations. Inputs by tool — capital: equity, reserves, loans_long, loans_short, cash, ebit, interest, tax, sales. business: sales, prev_sales, cogs, opex, depreciation, interest, tax, receivables, inventory, payables, current_assets, current_liabilities. capex: cost, life, salvage, inflow, growth, rate, loan_pct, loan_rate, loan_years. goals: goal, cost_today, years, inflation, return, saved, stepup. efficiency: idle_cash, idle_rate, alt_rate, loan, loan_rate, refi_rate, sales, receivables, target_days, expenses, cut_pct.",
    input_schema: {
      type: "object",
      properties: {
        tool: { type: "string", enum: ["capital", "business", "capex", "goals", "efficiency"] },
        inputs: { type: "object", description: "Figures keyed by the input names listed for the tool", additionalProperties: true },
        show_on_page: { type: "boolean", description: "Fill and open the tool's page (default true)" },
      },
      required: ["tool", "inputs"],
      additionalProperties: false,
    },
  },
  {
    name: "read_management_tool",
    description: "Read the inputs and results currently on one of the Management Services tool pages.",
    input_schema: {
      type: "object",
      properties: { tool: { type: "string", enum: ["capital", "business", "capex", "goals", "efficiency"] } },
      required: ["tool"],
      additionalProperties: false,
    },
  },
  {
    name: "list_documents",
    description: "Search the site's Documents & News library (news, documents, the Daily Market Update) and the Bihar Vision documents. Returns titles, dates, summaries and links.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        kind: { type: "string", enum: ["news", "documents", "vision"] },
      },
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
