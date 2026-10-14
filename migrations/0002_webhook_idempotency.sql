-- Telegram retries webhook deliveries; unique update IDs prevent duplicate model calls.
CREATE TABLE IF NOT EXISTS telegram_updates (
  update_id INTEGER PRIMARY KEY,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_telegram_updates_received_at ON telegram_updates(received_at);
