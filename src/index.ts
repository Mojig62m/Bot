export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  OPENROUTER_API_KEY?: string;
  NVIDIA_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  NVIDIA_MODEL?: string;
  DEFAULT_PROVIDER?: string;
  MAX_INPUT_CHARS?: string;
  RATE_LIMIT_PER_MINUTE?: string;
  RATE_LIMIT: KVNamespace;
  DB: D1Database;
  OPENCODE_URL?: string;
  OPENCODE_SERVER_USERNAME?: string;
  OPENCODE_SERVER_PASSWORD?: string;
  ALLOWED_TELEGRAM_USER_IDS?: string;
}

type TelegramUpdate = {
  update_id?: number;
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number | string; type?: string };
    from?: { id: number | string; is_bot?: boolean };
  };
};
type Mode = "architect" | "optimize" | "analyze" | "evaluate" | "developer";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const SYSTEM_PROMPTS: Record<Mode, string> = {
  architect: `You are Prompt Architect, an expert prompt engineer. Convert the user's rough request into a clear, reusable prompt. Preserve intent; do not invent requirements. Structure the result with Role, Goal, Context, Inputs, Constraints, Workflow, Output Format, and Quality Checks where relevant. Respond in the user's language. Clearly mark assumptions and ask concise questions only if truly blocking.`,
  optimize: `You are a prompt optimization specialist. Improve clarity, specificity, constraints, testability, and output formatting without changing the user's intent. Return: (1) optimized prompt, (2) concise change log, (3) assumptions, (4) a small evaluation checklist. Respond in the user's language.`,
  analyze: `Analyze the supplied prompt. Score 0-10 for clarity, context, constraints, output specification, testability, and robustness. Explain each score briefly, identify ambiguities and likely failure modes, then provide prioritized fixes. Do not claim scores are empirical measurements. Respond in the user's language.`,
  evaluate: `Create an evaluation plan for the supplied prompt. Define measurable criteria, a 1-5 rubric, at least five diverse test cases, expected properties of good answers, and regression checks. Separate proposed tests from results; do not pretend tests were executed. Respond in the user's language.`,
  developer: `Turn the user's software-development goal into an implementation-ready coding-agent task. Include repository context (if supplied), requirements, non-goals, architecture, files likely to change, acceptance criteria, tests, security requirements, and a concise final report format. Do not claim code was run. Respond in the user's language.`
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function parseMode(text: string): { mode: Mode; prompt: string } {
  const m = text.match(/^\/(optimize|analyze|evaluate|developer|prompt)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  if (!m) return { mode: "architect", prompt: text };
  const cmd = m[1].toLowerCase();
  const map: Record<string, Mode> = { optimize: "optimize", analyze: "analyze", evaluate: "evaluate", developer: "developer", prompt: "architect" };
  return { mode: map[cmd], prompt: (m[2] || "").trim() };
}
function providerFor(_mode: Mode, env: Env): "openrouter" | "nvidia" {
  // Respect explicit configuration, but avoid choosing a provider whose key is absent.
  const preferred = env.DEFAULT_PROVIDER?.toLowerCase() === "nvidia" ? "nvidia" : "openrouter";
  if (preferred === "nvidia" && env.NVIDIA_API_KEY) return "nvidia";
  if (preferred === "openrouter" && env.OPENROUTER_API_KEY) return "openrouter";
  if (env.OPENROUTER_API_KEY) return "openrouter";
  if (env.NVIDIA_API_KEY) return "nvidia";
  throw new Error("No model provider API key is configured");
}
async function callModel(mode: Mode, input: string, env: Env): Promise<{ text: string; provider: string; model: string }> {
  const provider = providerFor(mode, env);
  const isNvidia = provider === "nvidia";
  const key = isNvidia ? env.NVIDIA_API_KEY : env.OPENROUTER_API_KEY;
  if (!key) throw new Error(isNvidia ? "NVIDIA_API_KEY is not configured" : "OPENROUTER_API_KEY is not configured");
  const endpoint = isNvidia ? "https://integrate.api.nvidia.com/v1/chat/completions" : "https://openrouter.ai/api/v1/chat/completions";
  const model = (isNvidia ? env.NVIDIA_MODEL : env.OPENROUTER_MODEL) || (isNvidia ? "meta/llama-3.3-70b-instruct" : "openai/gpt-4o-mini");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${key}`,
      "content-type": "application/json",
      ...(isNvidia ? {} : { "HTTP-Referer": "https://prompt-architect-telegram.workers.dev", "X-OpenRouter-Title": "Prompt Architect Telegram" })
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPTS[mode] },
        { role: "user", content: input }
      ],
      temperature: mode === "evaluate" || mode === "analyze" ? 0.2 : 0.4,
      max_tokens: 2500
    }),
    signal: AbortSignal.timeout(45000)
  });
  if (!response.ok) {
    // Do not forward provider bodies; they may contain internal details.
    throw new Error(`Provider request failed (${response.status})`);
  }
  const data = await response.json() as { choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }> };
  const content = data.choices?.[0]?.message?.content;
  const output = typeof content === "string" ? content : Array.isArray(content) ? content.map(x => x.text || "").join("\n") : "";
  if (!output.trim()) throw new Error("The model returned an empty response");
  return { text: output.trim(), provider, model };
}
async function telegramApi(env: Env, method: string, body: unknown): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Telegram API request failed (${response.status})`);
}
async function sendMessage(env: Env, chatId: number | string, text: string): Promise<void> {
  // Telegram message text is limited; chunk conservatively and avoid splitting surrogate pairs.
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 3800) {
    let split = remaining.lastIndexOf("\n", 3800);
    if (split < 1000) split = 3800;
    chunks.push(remaining.slice(0, split));
    remaining = remaining.slice(split).trimStart();
  }
  if (remaining) chunks.push(remaining);
  for (const chunk of chunks) await telegramApi(env, "sendMessage", { chat_id: chatId, text: chunk, link_preview_options: { is_disabled: true } });
}
async function isAllowed(userId: string, env: Env): Promise<boolean> {
  const allow = env.ALLOWED_TELEGRAM_USER_IDS?.split(",").map(x => x.trim()).filter(Boolean);
  return !allow?.length || allow.includes(userId);
}
async function rateLimit(userId: string, env: Env): Promise<boolean> {
  const now = Math.floor(Date.now() / 60000);
  const key = `rl:${userId}:${now}`;
  const current = Number(await env.RATE_LIMIT.get(key) || "0");
  const max = Math.max(1, Number(env.RATE_LIMIT_PER_MINUTE || "8"));
  if (current >= max) return false;
  await env.RATE_LIMIT.put(key, String(current + 1), { expirationTtl: 120 });
  return true;
}
async function saveRun(env: Env, userId: string, mode: Mode, provider: string, model: string, input: string, output: string): Promise<void> {
  try {
    await env.DB.prepare("INSERT INTO prompt_runs (telegram_user_id, mode, provider, model, input_text, output_text) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(userId, mode, provider, model, input, output).run();
  } catch (error) {
    console.error("history_save_failed", error instanceof Error ? error.message : "unknown");
  }
}
async function handleUpdate(update: TelegramUpdate, env: Env): Promise<void> {
  const msg = update.message;
  if (!msg?.text || !msg.from || msg.from.is_bot) return;
  // Telegram may retry webhook deliveries. The unique update_id prevents duplicate model calls.
  if (typeof update.update_id === "number") {
    try {
      await env.DB.prepare("INSERT INTO telegram_updates (update_id) VALUES (?)")
        .bind(update.update_id).run();
    } catch {
      const existing = await env.DB.prepare("SELECT update_id FROM telegram_updates WHERE update_id = ?")
        .bind(update.update_id).first<{ update_id: number }>();
      if (existing) return;
      throw new Error("Unable to record Telegram update id");
    }
  }
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  if (!await isAllowed(userId, env)) {
    await sendMessage(env, chatId, "این ربات در حال حاضر برای حساب شما فعال نیست.");
    return;
  }
  const raw = msg.text.trim();
  if (/^\/(start|help)(?:@\w+)?$/i.test(raw)) {
    await sendMessage(env, chatId,
      "سلام! من Prompt Architect هستم. درخواستت را به پرامپت دقیق و قابل‌آزمون تبدیل می‌کنم.\n\n" +
      "دستورها:\n/prompt متن — ساخت پرامپت\n/optimize متن — بهینه‌سازی\n/analyze متن — تحلیل و امتیازدهی\n/evaluate متن — طراحی آزمون و معیارها\n/developer متن — آماده‌سازی وظیفه برای coding agent\n\n" +
      "همچنین می‌توانی درخواستت را بدون دستور ارسال کنی. کلیدهای API هرگز در چت درخواست نمی‌شوند.");
    return;
  }
  if (/^\/history(?:@\w+)?$/i.test(raw)) {
    const rows = await env.DB.prepare("SELECT mode, provider, model, created_at FROM prompt_runs WHERE telegram_user_id = ? ORDER BY id DESC LIMIT 10").bind(userId).all<{mode:string;provider:string;model:string;created_at:string}>();
    const lines = rows.results.map((r, i) => `${i + 1}. ${r.mode} · ${r.provider}/${r.model} · ${r.created_at}`);
    await sendMessage(env, chatId, lines.length ? "آخرین اجراها (بدون متن ورودی/خروجی):\n" + lines.join("\n") : "هنوز سابقه‌ای ثبت نشده است.");
    return;
  }
  const { mode, prompt } = parseMode(raw);
  if (!prompt) {
    await sendMessage(env, chatId, "بعد از دستور، متن درخواست را هم بفرست. مثال: /optimize یک پرامپت برای یادگیری زبان بساز");
    return;
  }
  const maxChars = Math.max(500, Number(env.MAX_INPUT_CHARS || "12000"));
  if (prompt.length > maxChars) {
    await sendMessage(env, chatId, `متن خیلی طولانی است. حداکثر ${maxChars} نویسه مجاز است.`);
    return;
  }
  if (!await rateLimit(userId, env)) {
    await sendMessage(env, chatId, "تعداد درخواست‌ها در این دقیقه به حد مجاز رسیده؛ کمی بعد دوباره تلاش کن.");
    return;
  }
  await sendMessage(env, chatId, "در حال پردازش درخواست…");
  try {
    const result = await callModel(mode, prompt, env);
    await saveRun(env, userId, mode, result.provider, result.model, prompt, result.text);
    await sendMessage(env, chatId, `حالت: ${mode} | مدل: ${result.provider}/${result.model}\n\n${result.text}`);
  } catch (error) {
    console.error("request_failed", error instanceof Error ? error.message : "unknown");
    await sendMessage(env, chatId, "پردازش انجام نشد. تنظیمات کلید API، مدل و وضعیت سرویس را بررسی کن؛ جزئیات حساس در چت نمایش داده نمی‌شود.");
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, service: "prompt-architect", timestamp: new Date().toISOString() });
    if (request.method !== "POST" || url.pathname !== "/telegram/webhook") return json({ error: "Not found" }, 404);
    const supplied = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
    if (!env.TELEGRAM_WEBHOOK_SECRET || !safeEqual(supplied, env.TELEGRAM_WEBHOOK_SECRET)) return json({ error: "Unauthorized" }, 401);
    let update: TelegramUpdate;
    try { update = await request.json() as TelegramUpdate; }
    catch { return json({ error: "Invalid JSON" }, 400); }
    // Telegram expects a quick acknowledgement; process the update in the background.
    ctx.waitUntil(handleUpdate(update, env).catch(error => {
      console.error("update_processing_failed", error instanceof Error ? error.message : "unknown");
    }));
    return json({ ok: true, accepted: Boolean(update.message) });
  }
} satisfies ExportedHandler<Env>;
