import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'dokkan.sqlite3'));

db.exec(`
  CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    title TEXT,
    rarity TEXT,
    class TEXT,
    type TEXT,
    cost INTEGER,
    categories TEXT,
    links TEXT,
    image_url TEXT,
    leader_skill TEXT,
    passive TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS collection (
    card_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
    owned INTEGER NOT NULL DEFAULT 0,
    current_percent INTEGER NOT NULL DEFAULT 0,
    dupes_in_stock INTEGER NOT NULL DEFAULT 0,
    dokkan_awakened INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_cards_rarity ON cards(rarity);
  CREATE INDEX IF NOT EXISTS idx_cards_type ON cards(type);
  CREATE INDEX IF NOT EXISTS idx_cards_class ON cards(class);
`);
