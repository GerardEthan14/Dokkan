// Import COMPLET (toutes raretés : N, R, SR, SSR, UR, LR) depuis les données
// extraites du site dokkaninfo.com. Contrairement à `import-cards.mjs` (qui
// télécharge directement depuis GitHub et ne couvre que LR/UR), ce script lit
// un fichier local : dokkaninfo.com bloque les requêtes automatisées
// (protection Cloudflare), donc les données doivent d'abord être récupérées
// à la main dans un navigateur, puis reconstruites avec
// `inspect-local-page.mjs`. Voir le README pour la procédure complète.
//
// Décodage des champs (vérifié manuellement sur un cas connu : "Super Saiyan
// Goku" id 1000010 = SSR / Super / AGL) :
//   - rarity : 0=N, 1=R, 2=SR, 3=SSR, 4=UR, 5=LR
//   - element (ex: "00", "13") : 1er chiffre = classe (0=Super, 1=Extreme),
//     2e chiffre = type (0=AGL, 1=TEQ, 2=INT, 3=STR, 4=PHY)
//   - image : https://dokkaninfo.com/assets/global/en/character/thumb/card_{n}_thumb/card_{n}_thumb.png
//     où n = resource_id (si présent) sinon icon_id
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultInput = path.join(__dirname, '..', '..', 'data', 'dokkaninfo-cards-source.html');
const inputPath = process.argv[2] || defaultInput;

// 6=TUR (Transcended Ultra Rare) est une supposition : pas encore vérifiée
// sur un cas connu, à confirmer si des cartes affichent cette rareté.
const RARITY_MAP = ['N', 'R', 'SR', 'SSR', 'UR', 'LR', 'TUR'];
const TYPE_MAP = ['AGL', 'TEQ', 'INT', 'STR', 'PHY'];
const CLASS_MAP = ['Super', 'Extreme'];

function decodeEntities(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function decodeElement(element) {
  if (typeof element !== 'string' || element.length !== 2) return { type: null, class: null };
  const classDigit = Number(element[0]);
  const typeDigit = Number(element[1]);
  return {
    class: CLASS_MAP[classDigit] ?? null,
    type: TYPE_MAP[typeDigit] ?? null,
  };
}

function buildImageUrl(card) {
  const n = card.resource_id ?? card.icon_id;
  if (!n) return null;
  return `https://dokkaninfo.com/assets/global/en/character/thumb/card_${n}_thumb/card_${n}_thumb.png`;
}

function main() {
  if (!fs.existsSync(inputPath)) {
    console.error(`Fichier introuvable : ${inputPath}`);
    console.error("Lance d'abord : node server/scripts/inspect-local-page.mjs \"chemin/vers/ta/sauvegarde.txt\"");
    process.exit(1);
  }

  console.log(`Lecture de ${inputPath}...`);
  const data = fs.readFileSync(inputPath, 'utf8');

  const attrRegex = /(?:v-bind:cardsjson|cardsjson)="([^"]*)"/;
  const match = data.match(attrRegex);
  if (!match) {
    console.error("Attribut cardsjson introuvable dans le fichier. La structure du site a peut-être changé.");
    process.exit(1);
  }

  console.log('Décodage du JSON...');
  const decoded = decodeEntities(match[1]);
  const allCards = JSON.parse(decoded);
  console.log(`${allCards.length} cartes trouvées.`);

  // Une même carte a plusieurs "formes" au fil de ses éveils (SSR -> UR après
  // Dokkan Awaken -> TUR après une évolution supplémentaire). Le jeu leur
  // attribue des identifiants consécutifs pour la même lignée (ex: 1000010,
  // 1000011, 1000012...), donc on regroupe par dizaine d'id et on ne garde
  // que la forme la plus aboutie (id le plus élevé du groupe) : c'est celle-là
  // qui compte pour la collection, le statut "Dokkan Awaken" étant de toute
  // façon suivi séparément via la case à cocher.
  const lineages = new Map();
  for (const card of allCards) {
    if (!card.id || !card.name) continue;
    const lineageKey = Math.floor(card.id / 10);
    const current = lineages.get(lineageKey);
    if (!current || card.id > current.id) lineages.set(lineageKey, card);
  }
  const cards = [...lineages.values()];
  console.log(`${cards.length} cartes après regroupement par lignée (forme la plus aboutie gardée).`);

  const upsert = db.prepare(`
    INSERT INTO cards (id, name, rarity, class, type, image_url, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      rarity=excluded.rarity,
      class=excluded.class,
      type=excluded.type,
      image_url=excluded.image_url,
      updated_at=datetime('now')
  `);
  const ensureCollectionRow = db.prepare(`INSERT OR IGNORE INTO collection (card_id) VALUES (?)`);

  const rarityCounts = {};
  let imported = 0;
  let missingImage = 0;

  db.exec('BEGIN');
  try {
    for (const card of cards) {
      if (!card.id || !card.name) continue;
      const { type, class: cardClass } = decodeElement(card.element);
      const rarity = RARITY_MAP[card.rarity] ?? String(card.rarity ?? '?');
      const imageUrl = buildImageUrl(card);
      if (!imageUrl) missingImage++;

      const id = `dki-${card.id}`;
      upsert.run(id, card.name, rarity, cardClass, type, imageUrl);
      ensureCollectionRow.run(id);
      rarityCounts[rarity] = (rarityCounts[rarity] ?? 0) + 1;
      imported++;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  console.log(`\nImport terminé : ${imported} cartes importées.`);
  console.log('Répartition par rareté :', rarityCounts);
  if (missingImage > 0) {
    console.log(`Attention : ${missingImage} cartes sans image (ni resource_id ni icon_id).`);
  }
  console.log(
    "\nNe lance pas aussi `npm run import-cards` (source LR/UR séparée) après ceci : les identifiants" +
      ' ne correspondent pas entre les deux sources et tu obtiendrais des cartes en double.',
  );
}

main();
