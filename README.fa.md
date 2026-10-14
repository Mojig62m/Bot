# Prompt Architect — Telegram + Cloudflare Workers

قالب TypeScript برای ربات مهندسی پرامپت با Telegram Webhook، Cloudflare Workers، KV برای محدودسازی نرخ، D1 برای تاریخچه و اتصال قابل‌تنظیم به OpenRouter یا NVIDIA API.

> این مخزن آماده‌ی راه‌اندازی پس از واردکردن کلیدهای خودتان و ساخت منابع Cloudflare است؛ از این محیط امکان استقرار در حساب شما یا ساخت کلید API وجود ندارد. قبل از استفاده عمومی، تست و محدودیت هزینه را فعال کنید.

## قابلیت‌ها

- `/prompt` ساخت پرامپت ساختاریافته؛ ارسال متن عادی هم همین حالت را اجرا می‌کند.
- `/optimize` بهینه‌سازی پرامپت.
- `/analyze` تحلیل و امتیازدهی کیفی.
- `/evaluate` ساخت طرح آزمون و معیارهای رگرسیون (نه ادعای اجرای آزمون واقعی).
- `/developer` تبدیل درخواست به وظیفه قابل‌تحویل به coding agent.
- `/history` نمایش ۱۰ اجرای اخیر بدون نمایش محتوای خصوصی ورودی/خروجی.
- بررسی secret مربوط به Telegram، جلوگیری از پردازش تکراری webhook با `update_id` یکتا در D1، allowlist اختیاری، محدودسازی نرخ با KV، حد طول ورودی، عدم ثبت کلیدها و ذخیره سابقه در D1.
- `/health` برای بررسی زنده‌بودن Worker.

## پیش‌نیازها

- Node.js نسخه LTS، npm و حساب Cloudflare.
- ربات ساخته‌شده از طریق `@BotFather` و توکن آن.
- حداقل یکی از کلیدهای OpenRouter یا NVIDIA.

## 1. نصب محلی

```bash
npm install
npx wrangler login
```

در `wrangler.jsonc` مقدار `name` را در صورت نیاز تغییر بده. سپس منابع بساز:

```bash
npx wrangler kv namespace create RATE_LIMIT
npx wrangler d1 create prompt-architect-db
```

فرمان‌ها شناسه‌های واقعی منابع را چاپ می‌کنند. آن شناسه‌ها را جایگزین مقادیر `REPLACE_WITH_...` در `wrangler.jsonc` کن. شناسه‌ها راز نیستند، اما باید به منابع حساب خودت اشاره کنند.

مهاجرت دیتابیس:

```bash
npx wrangler d1 migrations apply prompt-architect-db --remote
```

برای توسعه محلی، از `--local` استفاده کن. اگر bindingهای KV و D1 در config فعال‌اند، شناسه‌ها باید معتبر باشند.

## 2. افزودن Secrets

کلیدها را در فایل کد یا Git قرار نده. این فرمان‌ها مقدار را تعاملی می‌گیرند:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put OPENROUTER_API_KEY
# اگر NVIDIA را استفاده می‌کنی:
npx wrangler secret put NVIDIA_API_KEY
```

`TELEGRAM_WEBHOOK_SECRET` باید ۱ تا ۲۵۶ نویسه و فقط شامل حروف لاتین، اعداد، `_` و `-` باشد؛ مثلاً یک مقدار تصادفی طولانی بساز. آن را در چت یا لاگ منتشر نکن. اگر فقط NVIDIA می‌خواهی، `DEFAULT_PROVIDER` را در vars روی `nvidia` بگذار و `NVIDIA_API_KEY` را ثبت کن. مدل‌ها در `OPENROUTER_MODEL` و `NVIDIA_MODEL` قابل‌تنظیم‌اند؛ نام مدل را از کاتالوگ رسمی همان سرویس بررسی کن.

اختیاری: محدودکردن دسترسی به شناسه‌های تلگرام مورداعتماد، با متغیر `ALLOWED_TELEGRAM_USER_IDS` که فهرست شناسه‌های عددی با کاما است. اگر خالی باشد، هر کاربر می‌تواند ربات را صدا بزند؛ برای انتشار عمومی، محدودیت هزینه و نظارت لازم است.

## 3. بررسی و Deploy

```bash
npm run typecheck
npm test
npm run dev
```

پس از تنظیم شناسه‌ها و Secrets:

```bash
npm run deploy
```

آدرس Worker را از خروجی Wrangler بردار. آدرس وب‌هوک باید به مسیر `/telegram/webhook` ختم شود. پیش از استفاده واقعی، `/health` را باز کن و باید JSON با `ok: true` ببینی.

## 4. ثبت Telegram Webhook

در دستور زیر `WORKER_URL` و `WEBHOOK_SECRET` را با مقادیر واقعی جایگزین کن. URL باید HTTPS باشد. توکن ربات را محرمانه نگه دار؛ فرمان را در محیطی اجرا کن که history آن امن است.

```bash
curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://WORKER_URL/telegram/webhook","secret_token":"WEBHOOK_SECRET","allowed_updates":["message"],"drop_pending_updates":false}'
```

بهتر است `TELEGRAM_BOT_TOKEN` و `WEBHOOK_SECRET` را به‌صورت متغیر محیطی در ترمینال خودت تنظیم کنی؛ آن‌ها را در README یا فایل‌های مخزن ننویس. پاسخ Telegram باید `ok: true` داشته باشد. بررسی وضعیت:

```bash
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

## 5. Provider و هزینه

- OpenRouter: `https://openrouter.ai/api/v1/chat/completions`
- NVIDIA: `https://integrate.api.nvidia.com/v1/chat/completions`
- `DEFAULT_PROVIDER` مقدار `openrouter` یا `nvidia` می‌پذیرد. این نسخه انتخاب مدل از طریق پیام کاربر را عمداً پیاده‌سازی نمی‌کند.
- `MAX_INPUT_CHARS` و `RATE_LIMIT_PER_MINUTE` را مطابق بودجه تنظیم کن.
- برای کارهای طولانی‌تر، retryهای کنترل‌شده و وظایف چندمرحله‌ای، صف Cloudflare Queues اضافه کن؛ در این نسخه، فراخوانی مدل با timeout انجام می‌شود و پردازش پس از پاسخ فوری webhook در `waitUntil` اجرا می‌شود.

## 6. OpenCode

OpenCode در این قالب به‌عنوان یک سرویس مستقل در نظر گرفته می‌شود، نه فرایندی که داخل Worker اجرا شود. اگر ادغام واقعی لازم است، یک سرویس جداگانه با شبکه خصوصی یا دسترسی محدود، احراز هویت، allowlist، محدودیت دسترسی به فایل‌ها و زمان‌بندی اجرا راه‌اندازی کن. هرگز سرور OpenCode را بدون احراز هویت روی اینترنت عمومی قرار نده. متغیرهای `OPENCODE_URL` و اطلاعات دسترسی در این نسخه برای ادغام استفاده نشده‌اند و وجودشان به معنی فعال‌بودن این قابلیت نیست.

## ارزیابی کیفیت و امنیت

- `evals/starter-cases.json` نمونه‌های رگرسیون و معیارهای چندگانه را ارائه می‌کند؛ این فایل مشخصات آزمون است، نه گزارش نتایج اجراشده.
- `docs/quality-and-evidence.fa.md` روش ارزیابی، جداسازی مجموعه آزمون، مقایسه قبل/بعد و دروازه انتشار را توضیح می‌دهد.
- `SECURITY.md` چک‌لیست امنیتی انتشار را دارد.
- برای هر نسخه، کیفیت، نرخ خطا، هزینه و تأخیر را ثبت کنید. امتیاز LLM-as-judge به‌تنهایی اثبات کیفیت نیست؛ بخشی از نتایج باید بازبینی انسانی شود.

## امنیت و محدودیت‌های فعلی

- Rate limiting مبتنی بر KV برای محافظت پایه است؛ شمارنده‌های KV اتمیک نیستند و برای کنترل سخت‌گیرانه/حجم بالا باید Durable Objects یا سرویس rate limit مناسب به کار رود.
- جدول `telegram_updates` برای idempotency ساخته شده؛ برای نگهداری بلندمدت، سیاست پاک‌سازی رکوردهای قدیمی را به‌صورت cron یا وظیفهٔ زمان‌بندی‌شده اضافه کنید.
- `/history` فقط metadata را نشان می‌دهد، اما D1 متن ورودی و خروجی را نگه می‌دارد. سیاست نگهداری/حذف و رضایت کاربر را پیش از انتشار تعریف کن.
- خطاهای provider به کاربر جزئیات حساس نشان نمی‌دهند؛ لاگ‌ها هم نباید توکن یا متن خصوصی را ثبت کنند.
- این قالب هنوز تست یکپارچه end-to-end، پنل مدیریتی، پرداخت، صف، انتخاب مدل per-user و اجرای واقعی OpenCode ندارد.
- قبل از انتشار عمومی، محدودیت هزینه در provider، دسترسی admin، پاک‌سازی تاریخچه، هشدار خطا، تست امنیتی و شرایط استفاده را تنظیم کن.

## شواهد و منابع تخصصی

- OpenAI، ارزیابی و بهینه‌سازی خروجی: https://developers.openai.com/api/docs/guides/optimizing-llm-accuracy
- OpenAI، چرخهٔ ارزیابی و بهینه‌سازی: https://developers.openai.com/api/docs/guides/model-optimization
- OWASP GenAI Security Project: https://genai.owasp.org/llm-top-10/

## منابع رسمی

- Cloudflare Workers TypeScript: https://developers.cloudflare.com/workers/languages/typescript/
- Wrangler commands: https://developers.cloudflare.com/workers/wrangler/commands/
- Cloudflare secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Telegram Bot API: https://core.telegram.org/bots/api#setwebhook
- OpenRouter quickstart: https://openrouter.ai/docs/quickstart
- NVIDIA API Catalog: https://build.nvidia.com/
- OpenCode server: https://dev.opencode.ai/docs/server/
