import { DatabaseSync } from "node:sqlite";

const schema = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS price_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  is_market INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS labor_rates (
  group_name TEXT PRIMARY KEY,
  hourly_rate TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS project_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'completed')),
  input_json TEXT NOT NULL,
  calculation_json TEXT,
  lock_version INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL,
  updated_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  UNIQUE(project_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_project_versions_project_status
ON project_versions(project_id, status, version_number);

CREATE INDEX IF NOT EXISTS idx_projects_name
ON projects(name);
`;

export type AppDatabase = DatabaseSync;

export function createDatabase(path: string): AppDatabase {
  const db = new DatabaseSync(path);
  db.exec(schema);
  const projectColumns = db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
  if (!projectColumns.some((column) => column.name === "deleted_at")) {
    db.exec("ALTER TABLE projects ADD COLUMN deleted_at TEXT");
  }
  db.prepare(`INSERT OR IGNORE INTO price_types (id, name, sort_order, active, is_market)
    VALUES (?, ?, ?, 1, ?)`)
    .run("market", "市场指导价", 0, 1);
  [
    ["d", "D价", 10],
    ["kd", "KD价", 20],
    ["vd", "VD价", 30],
    ["research", "科研结算价", 40],
  ].forEach(([id, name, order]) => {
    db.prepare(`INSERT OR IGNORE INTO price_types (id, name, sort_order, active, is_market)
      VALUES (?, ?, ?, 1, 0)`).run(id, name, order);
  });
  [
    ["样本组", "7.81", 10],
    ["实验组", "9.77", 20],
    ["报告组", "9.77", 30],
  ].forEach(([group, rate, order]) => {
    db.prepare(`INSERT OR IGNORE INTO labor_rates (group_name, hourly_rate, sort_order)
      VALUES (?, ?, ?)`).run(group, rate, order);
  });
  db.exec("PRAGMA optimize");
  return db;
}
