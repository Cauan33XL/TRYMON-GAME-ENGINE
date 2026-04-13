import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(__dirname, '../../data/trymon.db');
const DATA_DIR = path.dirname(DB_PATH);

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS binaries (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    size INTEGER NOT NULL,
    type TEXT NOT NULL,
    uploaded_at DATETIME NOT NULL,
    status TEXT NOT NULL,
    path TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY,
    binary_id TEXT NOT NULL,
    status TEXT NOT NULL,
    output TEXT,
    exit_code INTEGER,
    started_at DATETIME,
    completed_at DATETIME,
    args TEXT,
    FOREIGN KEY (binary_id) REFERENCES binaries(id)
  )
`);

export default db;
