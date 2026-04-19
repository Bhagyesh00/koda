CREATE TABLE IF NOT EXISTS schedules (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  cron_expr   TEXT NOT NULL,
  message     TEXT NOT NULL,
  session_id  TEXT,
  work_dir    TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  last_run    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
