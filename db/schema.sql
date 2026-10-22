CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  body TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 4000),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'done')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
CREATE INDEX IF NOT EXISTS tasks_status_updated ON tasks(status, updated_at);
PRAGMA user_version = 1;
