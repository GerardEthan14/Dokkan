// Importe la liste des cartes LR & UR (id, nom, rareté, type, icône...) depuis
// une base de données communautaire publique (MNprojects/DokkanAPI, données
// issues du Dokkan Battle Wiki) et remplit la table `cards`.
// Les données de collection de l'utilisateur (table `collection`) ne sont
// jamais touchées : on peut relancer cet import à tout moment sans perdre
// la progression saisie.
import { db } from '../db.mjs';

const SOURCE_URL =
  'https://raw.githubusercontent.com/MNprojects/DokkanAPI/main/data/DokkanCharacterData.json';

async function main() {
  console.log(`Téléchargement des cartes depuis ${SOURCE_URL} ...`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) {
    throw new Error(`Échec du téléchargement (HTTP ${res.status})`);
  }
  const characters = await res.json();
  console.log(`${characters.length} cartes reçues, import en base...`);

  const upsert = db.prepare(`
    INSERT INTO cards (id, lineage_key, name, title, rarity, class, type, cost, categories, links, image_url, leader_skill, passive, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      title=excluded.title,
      rarity=excluded.rarity,
      class=excluded.class,
      type=excluded.type,
      cost=excluded.cost,
      categories=excluded.categories,
      links=excluded.links,
      image_url=excluded.image_url,
      leader_skill=excluded.leader_skill,
      passive=excluded.passive,
      updated_at=datetime('now')
  `);

  // Cette source ne relie pas les différentes formes d'un même personnage :
  // chaque carte est sa propre lignée (à l'inverse de import-cards-dokkaninfo.mjs).
  const ensureCollectionRow = db.prepare(`
    INSERT OR IGNORE INTO collection (lineage_key, current_card_id) VALUES (?, ?)
  `);

  let imported = 0;
  const seen = new Set();
  db.exec('BEGIN');
  try {
    for (const c of characters) {
      if (!c.id || seen.has(c.id)) continue; // ignore les doublons d'id de la source
      seen.add(c.id);
      const id = String(c.id);
      const lineageKey = id;
      upsert.run(
        id,
        lineageKey,
        c.name ?? 'Carte inconnue',
        c.title ?? null,
        c.rarity ?? null,
        c.class ?? null,
        c.type ?? null,
        c.cost ?? null,
        JSON.stringify(c.categories ?? []),
        JSON.stringify(c.links ?? []),
        c.imageURL ?? null,
        c.leaderSkill ?? null,
        c.passive ?? null,
      );
      ensureCollectionRow.run(lineageKey, id);
      imported++;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  console.log(`Import terminé : ${imported} cartes (LR & UR) disponibles dans la base.`);
}

main().catch((err) => {
  console.error('Erreur pendant l\'import :', err);
  process.exit(1);
});
