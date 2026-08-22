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

const RARITY_RANK = { LR: 0, TUR: 0, UR: 1, SSR: 2, SR: 3, R: 4, N: 5 };

const BASE_QUERY = `
  SELECT c.*, col.current_card_id, col.owned, col.dupe_level, col.dupes_in_stock, col.dokkan_awakened
  FROM cards c
  LEFT JOIN collection col ON col.lineage_key = c.lineage_key
`;

// Une "lignée" regroupe toutes les formes (stages) d'un même personnage
// (ex: SSR -> UR -> LR). On construit un seul objet par lignée, affichant les
// infos du stade actuellement sélectionné par le joueur, avec la liste des
// autres stades disponibles pour changer.
function rowsToLineageCards(rows) {
  const byLineage = new Map();
  for (const row of rows) {
    if (!byLineage.has(row.lineage_key)) byLineage.set(row.lineage_key, []);
    byLineage.get(row.lineage_key).push(row);
  }

  const lineageCards = [];
  for (const [lineageKey, stageRows] of byLineage) {
    stageRows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const currentCardId = stageRows[0].current_card_id;
    const current = stageRows.find((r) => r.id === currentCardId) ?? stageRows[stageRows.length - 1];

    const dupeLevel = current.dupe_level || 0;
    const dupesInStock = current.dupes_in_stock || 0;
    const potentialLevel = Math.min(MAX_DUPE_LEVEL, dupeLevel + dupesInStock);

    lineageCards.push({
      lineageKey,
      id: current.id,
      name: current.name,
      title: current.title,
      rarity: current.rarity,
      class: current.class,
      type: current.type,
      cost: current.cost,
      categories: JSON.parse(current.categories || '[]'),
      links: JSON.parse(current.links || '[]'),
      imageUrl: toProxyUrl(current.image_url),
      leaderSkill: current.leader_skill,
      passive: current.passive,
      owned: !!current.owned,
      dupeLevel,
      currentPercent: current.owned ? percentForLevel(dupeLevel) : 0,
      dupesInStock,
      potentialLevel,
      potentialPercent: percentForLevel(potentialLevel),
      canUpgrade: current.owned ? potentialLevel > dupeLevel : false,
      dokkanAwakened: !!current.dokkan_awakened,
      stages: stageRows.map((r) => ({
        id: r.id,
        rarity: r.rarity,
        type: r.type,
        class: r.class,
        imageUrl: toProxyUrl(r.image_url),
      })),
    });
  }
  return lineageCards;
}

app.get('/api/cards', (req, res) => {
  const { filter, search, rarity, type, cardClass } = req.query;
  const rows = db.prepare(BASE_QUERY).all();
  let cards = rowsToLineageCards(rows).sort((a, b) => {
    const rankDiff = (RARITY_RANK[a.rarity] ?? 6) - (RARITY_RANK[b.rarity] ?? 6);
    return rankDiff !== 0 ? rankDiff : a.name.localeCompare(b.name);
  });

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
  const cards = rowsToLineageCards(rows);
  res.json({
    total: cards.length,
    owned: cards.filter((c) => c.owned).length,
    missing: cards.filter((c) => !c.owned).length,
    notMaxedWithStock: cards.filter((c) => c.canUpgrade).length,
    notAwakened: cards.filter((c) => c.owned && !c.dokkanAwakened).length,
  });
});

app.put('/api/collection/:lineageKey', (req, res) => {
  const { lineageKey } = req.params;
  const stages = db.prepare('SELECT id FROM cards WHERE lineage_key = ?').all(lineageKey);
  if (stages.length === 0) return res.status(404).json({ error: 'Lignée inconnue' });

  const owned = req.body.owned ? 1 : 0;
  const dupeLevel = clampDupeLevel(req.body.dupeLevel);
  const dupesInStock = Math.max(0, Math.round(Number(req.body.dupesInStock) || 0));
  const dokkanAwakened = req.body.dokkanAwakened ? 1 : 0;

  let currentCardId = null;
  if (typeof req.body.currentCardId === 'string' && stages.some((s) => s.id === req.body.currentCardId)) {
    currentCardId = req.body.currentCardId;
  } else {
    const existing = db.prepare('SELECT current_card_id FROM collection WHERE lineage_key = ?').get(lineageKey);
    currentCardId = existing?.current_card_id ?? stages[stages.length - 1].id;
  }

  db.prepare(`
    INSERT INTO collection (lineage_key, current_card_id, owned, dupe_level, dupes_in_stock, dokkan_awakened, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(lineage_key) DO UPDATE SET
      current_card_id=excluded.current_card_id,
      owned=excluded.owned,
      dupe_level=excluded.dupe_level,
      dupes_in_stock=excluded.dupes_in_stock,
      dokkan_awakened=excluded.dokkan_awakened,
      updated_at=datetime('now')
  `).run(lineageKey, currentCardId, owned, dupeLevel, dupesInStock, dokkanAwakened);

  const rows = db.prepare(`${BASE_QUERY} WHERE c.lineage_key = ?`).all(lineageKey);
  res.json(rowsToLineageCards(rows)[0]);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Dokkan Collection Manager sur http://localhost:${PORT}`);
});
