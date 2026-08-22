import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'dokkan.sqlite3'));

// Une "lignée" regroupe les différentes formes d'un même personnage au fil
// de ses éveils (ex: SSR -> UR -> LR). Chaque forme reste une ligne distincte
// dans `cards` (image/rareté/type propres), mais la progression de
// collection (`collection`) est suivie une seule fois par lignée : c'est le
// joueur qui indique, via `current_card_id`, à quel stade il se trouve.
db.exec(`
  CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    lineage_key TEXT NOT NULL,
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
    lineage_key TEXT PRIMARY KEY,
    current_card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
    owned INTEGER NOT NULL DEFAULT 0,
    dupe_level INTEGER NOT NULL DEFAULT 0,
    dupes_in_stock INTEGER NOT NULL DEFAULT 0,
    dokkan_awakened INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_cards_rarity ON cards(rarity);
  CREATE INDEX IF NOT EXISTS idx_cards_type ON cards(type);
  CREATE INDEX IF NOT EXISTS idx_cards_class ON cards(class);
  CREATE INDEX IF NOT EXISTS idx_cards_lineage ON cards(lineage_key);
`);
