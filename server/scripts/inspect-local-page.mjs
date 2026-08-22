// Analyse un fichier HTML/texte énorme (ex: le code source complet de
// dokkaninfo.com/cards, ~49 Mo) et écrit un résumé compact (quelques Ko)
// listant où se trouvent les données de cartes à l'intérieur, sans avoir à
// envoyer le fichier complet. Usage :
//   node server/scripts/inspect-local-page.mjs "chemin/vers/le/fichier.txt"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inputPath = process.argv[2];

if (!inputPath) {
  console.error('Utilisation : node server/scripts/inspect-local-page.mjs "chemin/vers/le/fichier.txt"');
  process.exit(1);
}

const outPath = path.join(__dirname, '..', '..', 'data', 'page-inspection.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });

console.log(`Lecture de ${inputPath}...`);
const buffer = fs.readFileSync(inputPath);

// Détection d'encodage (un fichier "enregistré sous" depuis un navigateur
// Windows peut être en UTF-16 avec BOM, ce qui casse la recherche de texte
// si on le lit comme de l'UTF-8 brut : tout matcherait 0 résultat).
let encoding = 'utf8';
let byteOffset = 0;
if (buffer[0] === 0xff && buffer[1] === 0xfe) {
  encoding = 'utf16le';
  byteOffset = 2;
} else if (buffer[0] === 0xfe && buffer[1] === 0xff) {
  encoding = 'utf16be (non supporté nativement, converti approximativement)';
  byteOffset = 2;
} else if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
  encoding = 'utf8 avec BOM';
  byteOffset = 3;
}

let data = buffer.toString(encoding.startsWith('utf16') ? 'utf16le' : 'utf8', byteOffset);
console.log(`Encodage détecté : ${encoding}`);
console.log(`Fichier lu : ${(data.length / 1024 / 1024).toFixed(1)} Mo, ${data.length} caractères.`);

// Firefox (et d'autres navigateurs) "afficher le code source" produit une page
// HTML qui encode le vrai code source pour l'affichage (chaque " devient
// &quot;, chaque < devient &lt;, avec des <span> ajoutés pour la coloration).
// On détecte ce cas et on "désenveloppe" pour retrouver le vrai code source.
let unwrapped = false;
if (data.includes('id="viewsource"') || data.includes("id='viewsource'")) {
  console.log('Page "voir le code source" détectée, désenveloppement en cours...');
  const bodyMatch = data.match(/<body[^>]*id=["']viewsource["'][^>]*>([\s\S]*)<\/body>/);
  let inner = bodyMatch ? bodyMatch[1] : data;
  // Tout ce qui est <span ...> ou <a ...> à l'intérieur de cette page est une
  // décoration ajoutée par Firefox pour la coloration syntaxique (y compris
  // les valeurs d'attributs, encapsulées dans <a class="attribute-value">) :
  // les vraies balises de la page d'origine, elles, apparaissent ici comme du
  // texte échappé (&lt;a href=...&gt;), pas comme de vraies balises. On peut
  // donc retirer <span> et <a> sans risque.
  inner = inner.replace(/<\/?(?:span|a)(?:\s[^>]*)?>/g, '');
  inner = inner
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&'); // doit être en dernier
  data = inner;
  unwrapped = true;
  console.log(`Après désenveloppement : ${(data.length / 1024 / 1024).toFixed(1)} Mo.`);

  // Sauvegarde le code source reconstruit pour les prochaines étapes (pas besoin
  // de renvoyer ce fichier, il reste en local à côté du projet).
  const reconstructedPath = path.join(__dirname, '..', '..', 'data', 'dokkaninfo-cards-source.html');
  fs.writeFileSync(reconstructedPath, data, 'utf8');
  console.log(`Code source reconstruit sauvegardé dans : ${reconstructedPath}`);
}

const report = {
  wasViewSourceWrapped: unwrapped,
  fileSizeChars: data.length,
  detectedEncoding: encoding,
  firstBytesHex: buffer.subarray(0, 32).toString('hex'),
  first500Chars: data.slice(0, 500),
  middle500Chars: data.slice(Math.floor(data.length / 2), Math.floor(data.length / 2) + 500),
};

// 1. Marqueurs de frameworks / données embarquées connus
const markers = ['__NEXT_DATA__', '__NUXT__', 'window.__', 'application/json', '__INITIAL_STATE__'];
report.markersFound = {};
for (const marker of markers) {
  const count = data.split(marker).length - 1;
  report.markersFound[marker] = count;
}

// 2. Tous les blocs <script> : on garde les infos sur les plus gros (souvent
//    ceux qui contiennent les données), sans leur contenu complet.
const scriptBlocks = [];
const scriptRegex = /<script([^>]*)>([\s\S]*?)<\/script>/g;
let match;
while ((match = scriptRegex.exec(data)) !== null) {
  scriptBlocks.push({ attrs: match[1].trim(), length: match[2].length, sample: match[2].slice(0, 200) });
}
scriptBlocks.sort((a, b) => b.length - a.length);
report.biggestScriptBlocks = scriptBlocks.slice(0, 5);
report.totalScriptBlocks = scriptBlocks.length;

// 3. Combien de cartes différentes sont référencées (liens vers les fiches carte) ?
const cardLinkIds = new Set();
const linkRegex = /dokkaninfo\.com\/cards\/(\d+)/g;
while ((match = linkRegex.exec(data)) !== null) cardLinkIds.add(match[1]);
report.uniqueCardIdsLinked = cardLinkIds.size;
report.sampleCardIds = [...cardLinkIds].slice(0, 10);

// 4. Contexte autour de la première et dernière occurrence d'un lien de carte,
//    pour voir à quoi ressemble le bloc HTML/JS répété par carte.
const firstIdx = data.indexOf('dokkaninfo.com/cards/');
if (firstIdx !== -1) {
  report.firstCardContext = data.slice(Math.max(0, firstIdx - 300), firstIdx + 1000);
}

// 5. Présence de mots-clés typiques de données de carte (utile pour repérer
//    où sont les vraies infos : nom, rareté, stats...)
const keywords = ['leader_skill', 'leaderSkill', '"rarity"', '"hp"', '"atk"', 'super_attack', 'passive_skill'];
report.keywordCounts = {};
for (const kw of keywords) {
  report.keywordCounts[kw] = data.split(kw).length - 1;
}
const firstKeywordHit = keywords.find((kw) => report.keywordCounts[kw] > 0);
if (firstKeywordHit) {
  const idx = data.indexOf(firstKeywordHit);
  report.firstKeywordContext = { keyword: firstKeywordHit, context: data.slice(Math.max(0, idx - 300), idx + 700) };
}

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`\nRésumé écrit dans : ${outPath}`);
console.log('Envoie ce fichier (il doit faire quelques Ko, pas plus).');
