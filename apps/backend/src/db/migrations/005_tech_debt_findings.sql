CREATE TABLE IF NOT EXISTS tech_debt_findings (
  id           TEXT PRIMARY KEY,
  scan_id      TEXT NOT NULL,
  work_dir     TEXT NOT NULL,
  ts           BIGINT NOT NULL,
  category     TEXT NOT NULL,
  severity     TEXT NOT NULL,
  file_path    TEXT,
  line         INTEGER,
  description  TEXT NOT NULL,
  suggestion   TEXT,
  status       TEXT NOT NULL DEFAULT 'open',
  meta         JSONB
);

CREATE INDEX IF NOT EXISTS tech_debt_findings_scan_id_idx ON tech_debt_findings(scan_id);
CREATE INDEX IF NOT EXISTS tech_debt_findings_status_idx  ON tech_debt_findings(status);
CREATE INDEX IF NOT EXISTS tech_debt_findings_ts_idx      ON tech_debt_findings(ts DESC);
