# Security policy

- Never commit API keys, bot tokens, webhook secrets, or user data.
- Keep Telegram webhook secret validation enabled and use HTTPS.
- Use `ALLOWED_TELEGRAM_USER_IDS` during private testing; public launch requires cost controls and monitoring.
- Keep model-generated text untrusted. Do not execute it as code or treat it as authorization.
- Do not expose OpenCode publicly without authentication, network restrictions, least privilege, workspace isolation, and execution limits.
- KV rate counters are eventually consistent and not atomic. For strict per-user enforcement, use a Durable Object or another atomic rate limiter.
- D1 currently stores prompt input/output. Establish consent, retention, deletion, and access policies before public launch.
- Review OWASP GenAI LLM Top 10 and run security tests before deployment.
- Report vulnerabilities privately to the project maintainer; do not publish secrets or personal data in issues.
