// Import complet depuis dbz-dokkanbattle.com, une base bien plus fiable que
// dokkaninfo.com : une seule entrée par personnage (pas besoin de deviner les
// lignées), rareté écrite en toutes lettres dans les noms de fichiers image,
// et catégories "Fusion"/"Forme géante" clairement identifiées.
//
// Comme dokkaninfo.com, ce site bloque probablement les requêtes automatisées :
// les données doivent être récupérées à la main dans un navigateur.
//
// Procédure :
//   1. Va sur https://dbz-dokkanbattle.com/cards (charge bien toute la page,
//      utilise les filtres/scroll si besoin pour que toutes les cartes soient
//      affichées avant de sauvegarder)
//   2. Menu du navigateur -> "Enregistrer la page" / "Télécharger la page"
//      (ça doit produire un fichier .mhtml, le format qui embarque tout en un
//      seul fichier - c'est ce format que ce script attend)
//   3. node server/scripts/import-cards-dbzdb.mjs "chemin/vers/le/fichier.mhtml"
//
// Décodage des champs (vérifié manuellement sur 3 cartes connues : Son Gohan
// (enfant) = Super/INT, Son Goku Super Saiyan 3 = Super/INT,
// Boo (Kaïo Shin du Sud) = Extreme/STR) :
//   - data-rarity : lu directement depuis le nom de fichier de l'image de
//     rareté (cha_rare_sm_XXX.png), aucune supposition nécessaire.
//   - data-element : 0=AGL, 1=TEQ, 2=INT, 3=STR, 4=PHY
//   - data-classe : 1=Super, 2=Extreme
//   - image : https://dbz-dokkanbattle.com/img/character/thumb/card_{id}_thumb/card_{id}_thumb.png
//   - catégorie "Forme géante" (id 13) : jamais une vraie carte à
//     collectionner (transformation en combat), exclue automatiquement.
//   - catégorie "Fusion" (id 1, ex: Gogeta, Gotenks) : gardée sur demande de
//     l'utilisateur (certaines sont de vraies cartes invocables), à trier
//     manuellement dans le site.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inputPath = process.argv[2];

if (!inputPath) {
  console.error('Utilisation : node server/scripts/import-cards-dbzdb.mjs "chemin/vers/le/fichier.mhtml"');
  process.exit(1);
}
if (!fs.existsSync(inputPath)) {
  console.error(`Fichier introuvable : ${inputPath}`);
  process.exit(1);
}

const RARITY_MAP = { n: 'N', r: 'R', sr: 'SR', ssr: 'SSR', ur: 'UR', lr: 'LR', tur: 'TUR' };
const TYPE_MAP = ['AGL', 'TEQ', 'INT', 'STR', 'PHY'];
const CLASS_MAP = { 1: 'Super', 2: 'Extreme' };
const EXCLUDED_CATEGORY_IDS = new Set(['13']); // "Forme géante"

function decodeQuotedPrintable(str) {
  return str.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function extractMainHtml(raw) {
  const boundaryMatch = raw.match(/boundary="([^"]+)"/);
  if (!boundaryMatch) {
    throw new Error(
      "Format non reconnu : ce fichier ne ressemble pas à un .mhtml (pas de 'boundary' trouvé). " +
        "Assure-toi d'avoir utilisé 'Enregistrer la page' (pas 'voir le code source').",
    );
  }
  const delimiter = `--${boundaryMatch[1]}`;
  const parts = raw.split(delimiter);
  if (parts.length < 2) throw new Error('Impossible de séparer les parties MIME du fichier.');

  const firstPart = parts[1];
  const headerEnd = firstPart.search(/\r?\n\r?\n/);
  const partHeaders = firstPart.slice(0, headerEnd);
  let body = firstPart.slice(headerEnd).replace(/^\r?\n\r?\n/, '');

  if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(partHeaders)) {
    body = decodeQuotedPrintable(body);
  }
  return body;
}

function buildCategoryNames(html) {
  const names = new Map();
  const optionRegex = /<option value="(\d+)">([^<]+)<\/option>/g;
  let m;
  while ((m = optionRegex.exec(html)) !== null) {
    names.set(m[1], m[2].trim());
  }
  return names;
}

function main() {
  console.log(`Lecture de ${inputPath}...`);
  const raw = fs.readFileSync(inputPath, 'utf8');
  console.log(`${(raw.length / 1024 / 1024).toFixed(1)} Mo lus, extraction du HTML...`);
  const html = extractMainHtml(raw);

  const categoryNames = buildCategoryNames(html);
  console.log(`${categoryNames.size} catégories identifiées.`);

  const starts = [];
  const itemRegex = /<div class="item-container/g;
  let m;
  while ((m = itemRegex.exec(html)) !== null) starts.push(m.index);
  console.log(`${starts.length} cartes trouvées dans la page.`);

  const upsert = db.prepare(`
    INSERT INTO cards (id, lineage_key, name, rarity, class, type, categories, image_url, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      rarity=excluded.rarity,
      class=excluded.class,
      type=excluded.type,
      categories=excluded.categories,
      image_url=excluded.image_url,
      updated_at=datetime('now')
  `);
  const ensureCollectionRow = db.prepare(`INSERT OR IGNORE INTO collection (lineage_key, current_card_id) VALUES (?, ?)`);

  const rarityCounts = {};
  const keptIds = new Set();
  let imported = 0;
  let excludedGiant = 0;
  let skippedNoId = 0;

  db.exec('BEGIN');
  try {
    for (let i = 0; i < starts.length; i++) {
      const end = i + 1 < starts.length ? starts[i + 1] : starts[i] + 4000;
      const window = html.slice(starts[i], Math.min(end, starts[i] + 4000));

      const idMatch = window.match(/data-id="(\d+)"/);
      const nameMatch = window.match(/data-character="([^"]*)"/);
      const rarityMatch = window.match(/data-rarity="(\d+)"/);
      const elementMatch = window.match(/data-element="(\d+)"/);
      const classeMatch = window.match(/data-classe="(\d+)"/);
      const categoriesMatch = window.match(/data-categories="([^"]*)"/);
      const rarityImgMatch = window.match(/cha_rare_sm_(\w+?)\.png/);

      if (!idMatch || !nameMatch) {
        skippedNoId++;
        continue;
      }

      const categoryIds = categoriesMatch ? categoriesMatch[1].split(',').filter(Boolean) : [];
      if (categoryIds.some((c) => EXCLUDED_CATEGORY_IDS.has(c))) {
        excludedGiant++;
        continue;
      }

      const id = `dbzdb-${idMatch[1]}`;
      const name = nameMatch[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
      const rarity = rarityImgMatch ? RARITY_MAP[rarityImgMatch[1].toLowerCase()] ?? null : null;
      const type = elementMatch ? TYPE_MAP[Number(elementMatch[1])] ?? null : null;
      const cardClass = classeMatch ? CLASS_MAP[Number(classeMatch[1])] ?? null : null;
      const categories = categoryIds.map((c) => categoryNames.get(c) ?? c);
      const imageUrl = `https://dbz-dokkanbattle.com/img/character/thumb/card_${idMatch[1]}_thumb/card_${idMatch[1]}_thumb.png`;

      // Ce site liste déjà une seule entrée par personnage (pas de lignée à
      // regrouper) : chaque carte est sa propre lignée.
      upsert.run(id, id, name, rarity, cardClass, type, JSON.stringify(categories), imageUrl);
      ensureCollectionRow.run(id, id);
      keptIds.add(id);
      rarityCounts[rarity ?? '?'] = (rarityCounts[rarity ?? '?'] ?? 0) + 1;
      imported++;
    }

    const staleRows = db.prepare(`SELECT id FROM cards WHERE id LIKE 'dbzdb-%'`).all();
    const deleteStale = db.prepare('DELETE FROM cards WHERE id = ?');
    let removedStale = 0;
    for (const row of staleRows) {
      if (!keptIds.has(row.id)) {
        deleteStale.run(row.id);
        removedStale++;
      }
    }
    if (removedStale > 0) console.log(`${removedStale} cartes obsolètes retirées.`);

    db.exec(`
      DELETE FROM collection
      WHERE lineage_key LIKE 'dbzdb-%'
        AND NOT EXISTS (SELECT 1 FROM cards WHERE cards.lineage_key = collection.lineage_key)
    `);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  console.log(`\nImport terminé : ${imported} cartes importées.`);
  console.log(`${excludedGiant} cartes "forme géante" exclues.`);
  if (skippedNoId > 0) console.log(`${skippedNoId} entrées ignorées (id/nom manquant).`);
  console.log('Répartition par rareté :', rarityCounts);
}

main();
