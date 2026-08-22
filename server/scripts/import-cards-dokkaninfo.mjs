// Import COMPLET (toutes raretés : N, R, SR, SSR, UR, LR) depuis les données
// extraites du site dokkaninfo.com. Contrairement à `import-cards.mjs` (qui
// télécharge directement depuis GitHub et ne couvre que LR/UR), ce script lit
// un fichier local : dokkaninfo.com bloque les requêtes automatisées
// (protection Cloudflare), donc les données doivent d'abord être récupérées
// à la main dans un navigateur, puis reconstruites avec
// `inspect-local-page.mjs`. Voir le README pour la procédure complète.
//
// Décodage des champs (vérifié manuellement sur des cas connus : "Super
// Saiyan Goku" id 1000010 = SSR / Super / AGL, et "Third Eye Gomah"
// id 1032311 = LR / Extreme / AGL) :
//   - rarity : 0=N, 1=R, 2=SR, 3=SSR, 4=UR, 5=LR
//   - element (ex: "00", "20") : 1er chiffre = classe (0=Super, autre
//     chiffre=Extreme — la valeur exacte du "Extreme" varie selon les cartes,
//     mais 0 signifie toujours Super), 2e chiffre = type (0=AGL, 1=TEQ,
//     2=INT, 3=STR, 4=PHY)
//   - image : https://dokkaninfo.com/assets/global/en/character/thumb/card_{n}_thumb/card_{n}_thumb.png
//     où n = resource_id (si présent) sinon icon_id
//   - les identifiants commençant par "9" sont des apparitions boss/ennemi
//     du personnage (réutilisées en combat), pas de vraies cartes à
//     collectionner : elles sont exclues de l'import.
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
    // Vérifié sur plusieurs cas : classDigit 0 et 1 = Super, 2 (et plus) = Extreme.
    class: CLASS_MAP[classDigit >= 2 ? 1 : 0] ?? null,
    type: TYPE_MAP[typeDigit] ?? null,
  };
}

function buildImageUrl(card) {
  const n = card.resource_id ?? card.icon_id;
  if (!n) return null;
  return `https://dokkaninfo.com/assets/global/en/character/thumb/card_${n}_thumb/card_${n}_thumb.png`;
}

// Avoir un resource_id/icon_id ne garantit pas que l'image existe vraiment
// sur le serveur de dokkaninfo.com (certaines cartes n'ont jamais eu
// d'icône mise en ligne). On vérifie donc chaque URL en vrai avant de
// garder la carte, avec un nombre limité de requêtes en parallèle pour ne
// pas surcharger le site.
async function imageExists(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

async function filterCardsWithRealImage(cards) {
  const CONCURRENCY = 20;
  const kept = [];
  let checked = 0;
  let index = 0;

  async function worker() {
    while (index < cards.length) {
      const card = cards[index++];
      const url = buildImageUrl(card);
      if (url && (await imageExists(url))) kept.push(card);
      checked++;
      if (checked % 200 === 0 || checked === cards.length) {
        process.stdout.write(`\rVérification des images... ${checked}/${cards.length}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stdout.write('\n');
  return kept;
}

async function main() {
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

  // Les apparitions boss/ennemi (le personnage réutilisé comme adversaire en
  // combat, pas une vraie carte à collectionner) ont une stat moyenne (avg)
  // figée à 500, alors que les vraies cartes ont des valeurs qui varient
  // dans les milliers. Certains boss ont un id commençant par "9" ET sont
  // pourtant de vraies cartes invocables (ex: anciens boss d'Extreme
  // Z-Battle), donc le premier chiffre de l'id seul n'est pas fiable : on se
  // base uniquement sur cette stat à 500.
  // Les formes géantes (transformation en combat, pas une vraie carte) ont
  // un ATK anormalement élevé (confirmé jusqu'à 60000 sur "Giant Gomah").
  // Seuil à 25000 : au-dessus du plus fort vrai LR EZA connu (22185, Super
  // Saiyan 4 Goku & Vegeta id 1022421), en dessous des formes géantes
  // connues (>= 20000, généralement bien plus). Le signal grow_type/step
  // utilisé pour les fusions ne s'applique pas ici : une vraie forme géante
  // (Giant Gomah) a aussi ces deux champs vides.
  //
  // Les fusions en combat (ex: Gogeta obtenu en fusionnant Goku & Vegeta)
  // ont exactement les MÊMES stats que la vraie carte (donc le filtre ATK ne
  // les attrape pas), mais partagent un signal différent : elles ont un
  // `optimal_awakening_grow_type` renseigné (elles appartiennent au même
  // "arbre d'évolution" que la vraie carte) alors que leur
  // `optimal_awakening_step` reste vide, car elles ne sont pas elles-mêmes
  // une étape d'éveil franchissable. Une vraie carte de base (jamais encore
  // éveillée) a les deux champs vides, donc ce n'est que la combinaison
  // "grow_type rempli + step vide" qui signale une forme dérivée.
  //
  // Enfin, les changements d'affichage en combat (ex: une carte à 2
  // personnages où l'ordre affiché change) créent une deuxième entrée avec
  // les mêmes stats et le même open_at que l'originale, mais un id
  // commençant par "4" (confirmé sur 3 cas : forme géante, fusion, et
  // changement d'ordre d'affichage). On l'exclut directement par ce préfixe.
  const playableCards = allCards.filter(
    (c) =>
      c.avg_max !== 500 &&
      c.avg_hipo !== 500 &&
      (c.atk_max ?? 0) < 25000 &&
      (c.atk_hipo ?? 0) < 25000 &&
      !(c.optimal_awakening_grow_type != null && c.optimal_awakening_step == null) &&
      !String(c.id).startsWith('4') &&
      (c.resource_id != null || c.icon_id != null),
  );
  console.log(
    `${allCards.length - playableCards.length} apparitions boss/ennemi/forme géante/fusion/forme dérivée/sans image retirées.`,
  );

  // Une même carte a plusieurs "formes" au fil de ses éveils (SSR -> UR après
  // Dokkan Awaken -> TUR après une évolution supplémentaire). Le jeu leur
  // attribue des identifiants consécutifs pour la même lignée (ex: 1000010,
  // 1000011, 1000012...), donc on regroupe par dizaine d'id et on ne garde
  // que la forme la plus aboutie (id le plus élevé du groupe) : c'est celle-là
  // qui compte pour la collection, le statut "Dokkan Awaken" étant de toute
  // façon suivi séparément via la case à cocher.
  const lineages = new Map();
  for (const card of playableCards) {
    if (!card.id || !card.name) continue;
    const lineageKey = Math.floor(card.id / 10);
    const current = lineages.get(lineageKey);
    if (!current || card.id > current.id) lineages.set(lineageKey, card);
  }
  const groupedCards = [...lineages.values()];
  console.log(`${groupedCards.length} cartes après regroupement par lignée (forme la plus aboutie gardée).`);

  console.log('Vérification que chaque image existe vraiment (peut prendre plusieurs minutes)...');
  const cards = await filterCardsWithRealImage(groupedCards);
  console.log(`${groupedCards.length - cards.length} cartes retirées car leur image n'existe pas réellement.`);

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
  const keptIds = new Set(cards.map((c) => `dki-${c.id}`));

  db.exec('BEGIN');
  try {
    // Un précédent import a pu laisser des cartes qui ne font plus partie du
    // jeu de données actuel (ex: anciennes formes SSR/UR d'une lignée
    // maintenant regroupée sous sa forme TUR) : on les retire, sinon elles
    // restent affichées en double indéfiniment.
    const staleRows = db.prepare(`SELECT id FROM cards WHERE id LIKE 'dki-%'`).all();
    const deleteStale = db.prepare('DELETE FROM cards WHERE id = ?');
    let removedStale = 0;
    for (const row of staleRows) {
      if (!keptIds.has(row.id)) {
        deleteStale.run(row.id);
        removedStale++;
      }
    }
    if (removedStale > 0) {
      console.log(`${removedStale} cartes obsolètes retirées (progression associée perdue pour celles-ci).`);
    }
    for (const card of cards) {
      if (!card.id || !card.name) continue;
      const { type, class: cardClass } = decodeElement(card.element);
      const rarity = RARITY_MAP[card.rarity] ?? String(card.rarity ?? '?');
      const imageUrl = buildImageUrl(card);

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
  console.log(
    "\nNe lance pas aussi `npm run import-cards` (source LR/UR séparée) après ceci : les identifiants" +
      ' ne correspondent pas entre les deux sources et tu obtiendrais des cartes en double.',
  );
}

main().catch((err) => {
  console.error("Erreur pendant l'import :", err);
  process.exit(1);
});
