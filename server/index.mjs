import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { db } from './db.mjs';
import { DUPE_LEVELS, MAX_DUPE_LEVEL, clampDupeLevel, percentForLevel } from './dupeLevels.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Domaines dont on accepte de relayer les images (protection contre un usage
// comme proxy ouvert vers n'importe quelle URL).
const ALLOWED_IMAGE_HOSTS = new Set(['dokkaninfo.com', 'www.dokkaninfo.com']);

function toProxyUrl(imageUrl) {
  if (!imageUrl) return null;
  // Seul dokkaninfo.com bloque le hotlinking : les autres sources d'images
  // (ex: wikia) n'ont pas besoin de passer par le proxy.
  try {
    const { hostname } = new URL(imageUrl);
    if (!ALLOWED_IMAGE_HOSTS.has(hostname)) return imageUrl;
  } catch {
    return imageUrl;
  }
  return `/img-proxy?u=${encodeURIComponent(imageUrl)}`;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// dokkaninfo.com bloque le chargement de ses images depuis un autre site
// (protection anti-hotlink) : on les relaie nous-mêmes depuis le serveur,
// qui lui n'est pas concerné par cette restriction basée sur le Referer.
app.get('/img-proxy', async (req, res) => {
  const target = req.query.u;
  if (typeof target !== 'string') return res.status(400).end();

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return res.status(400).end();
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_IMAGE_HOSTS.has(parsed.hostname)) {
    return res.status(400).end();
  }

  try {
    const upstream = await fetch(parsed, {
      headers: {
        Referer: 'https://dokkaninfo.com/',
        'User-Agent': 'Mozilla/5.0 (compatible; DokkanCollectionManager/1.0)',
      },
    });
    if (!upstream.ok || !upstream.body) return res.status(upstream.status).end();

    res.set('Content-Type', upstream.headers.get('content-type') || 'image/png');
    res.set('Cache-Control', 'public, max-age=604800, immutable');
    Readable.fromWeb(upstream.body).pipe(res);
  } catch {
    res.status(502).end();
  }
});

function rowToCard(row) {
  const dupeLevel = row.dupe_level || 0;
  const dupesInStock = row.dupes_in_stock || 0;
  const potentialLevel = Math.min(MAX_DUPE_LEVEL, dupeLevel + dupesInStock);
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    rarity: row.rarity,
    class: row.class,
    type: row.type,
    cost: row.cost,
    categories: JSON.parse(row.categories || '[]'),
    links: JSON.parse(row.links || '[]'),
    imageUrl: toProxyUrl(row.image_url),
    leaderSkill: row.leader_skill,
    passive: row.passive,
    owned: !!row.owned,
    dupeLevel,
    currentPercent: row.owned ? percentForLevel(dupeLevel) : 0,
    dupesInStock,
    potentialLevel,
    potentialPercent: percentForLevel(potentialLevel),
    canUpgrade: row.owned ? potentialLevel > dupeLevel : false,
    dokkanAwakened: !!row.dokkan_awakened,
  };
}

const BASE_QUERY = `
  SELECT c.*, col.owned, col.dupe_level, col.dupes_in_stock, col.dokkan_awakened
  FROM cards c
  LEFT JOIN collection col ON col.card_id = c.id
`;

app.get('/api/cards', (req, res) => {
  const { filter, search, rarity, type, cardClass } = req.query;
  const rows = db
    .prepare(
      `${BASE_QUERY} ORDER BY
        CASE c.rarity WHEN 'LR' THEN 0 WHEN 'UR' THEN 1 WHEN 'SSR' THEN 2 WHEN 'SR' THEN 3 WHEN 'R' THEN 4 WHEN 'N' THEN 5 ELSE 6 END,
        c.name ASC`,
    )
    .all();
  let cards = rows.map(rowToCard);

  if (search) {
    const q = String(search).toLowerCase();
    cards = cards.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.title && c.title.toLowerCase().includes(q)) ||
        c.categories.some((cat) => cat.toLowerCase().includes(q)),
    );
  }
  if (rarity) cards = cards.filter((c) => c.rarity === rarity);
  if (type) cards = cards.filter((c) => c.type === type);
  if (cardClass) cards = cards.filter((c) => c.class === cardClass);

  switch (filter) {
    case 'missing':
      cards = cards.filter((c) => !c.owned);
      break;
    case 'owned':
      cards = cards.filter((c) => c.owned);
      break;
    case 'not_maxed':
      cards = cards.filter((c) => c.canUpgrade);
      break;
    case 'not_awakened':
      cards = cards.filter((c) => c.owned && !c.dokkanAwakened);
      break;
    default:
      break;
  }

  res.json(cards);
});

app.get('/api/dupe-levels', (_req, res) => {
  res.json({ levels: DUPE_LEVELS });
});

app.get('/api/stats', (_req, res) => {
  const rows = db.prepare(BASE_QUERY).all();
  const cards = rows.map(rowToCard);
  res.json({
    total: cards.length,
    owned: cards.filter((c) => c.owned).length,
    missing: cards.filter((c) => !c.owned).length,
    notMaxedWithStock: cards.filter((c) => c.canUpgrade).length,
    notAwakened: cards.filter((c) => c.owned && !c.dokkanAwakened).length,
  });
});

app.put('/api/collection/:cardId', (req, res) => {
  const { cardId } = req.params;
  const card = db.prepare('SELECT id FROM cards WHERE id = ?').get(cardId);
  if (!card) return res.status(404).json({ error: 'Carte inconnue' });

  const owned = req.body.owned ? 1 : 0;
  const dupeLevel = clampDupeLevel(req.body.dupeLevel);
  const dupesInStock = Math.max(0, Math.round(Number(req.body.dupesInStock) || 0));
  const dokkanAwakened = req.body.dokkanAwakened ? 1 : 0;

  db.prepare(`
    INSERT INTO collection (card_id, owned, dupe_level, dupes_in_stock, dokkan_awakened, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(card_id) DO UPDATE SET
      owned=excluded.owned,
      dupe_level=excluded.dupe_level,
      dupes_in_stock=excluded.dupes_in_stock,
      dokkan_awakened=excluded.dokkan_awakened,
      updated_at=datetime('now')
  `).run(cardId, owned, dupeLevel, dupesInStock, dokkanAwakened);

  const row = db.prepare(`${BASE_QUERY} WHERE c.id = ?`).get(cardId);
  res.json(rowToCard(row));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Dokkan Collection Manager sur http://localhost:${PORT}`);
});
