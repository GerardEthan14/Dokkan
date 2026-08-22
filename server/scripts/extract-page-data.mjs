// Cherche, dans le code source reconstruit (data/dokkaninfo-cards-source.html,
// généré par inspect-local-page.mjs), un attribut HTML contenant tout un blob
// JSON (motif très courant avec Vue/Inertia.js : <div data-page="[JSON encodé
// avec des &quot;]">). Décode ce JSON et écrit un résumé + 2 cartes complètes
// en exemple, pour finaliser le mapping des champs sans avoir à renvoyer le
// fichier complet.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultInput = path.join(__dirname, '..', '..', 'data', 'dokkaninfo-cards-source.html');
const inputPath = process.argv[2] || defaultInput;
const outPath = path.join(__dirname, '..', '..', 'data', 'page-data-extract.json');

function decodeEntities(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

console.log(`Lecture de ${inputPath}...`);
const data = fs.readFileSync(inputPath, 'utf8');
console.log(`${(data.length / 1024 / 1024).toFixed(1)} Mo lus.`);

const candidateAttrs = ['v-bind:cardsjson', 'cardsjson', 'data-page', 'data-cards', 'data-props', 'x-data', 'data-initial-state'];
const found = [];

for (const attr of candidateAttrs) {
  const regex = new RegExp(`${attr}="([^"]*)"`, 'g');
  let match;
  while ((match = regex.exec(data)) !== null) {
    found.push({ attr, length: match[1].length, startIndex: match.index });
  }
}

const report = { attributesFound: found.map(({ attr, length, startIndex }) => ({ attr, length, startIndex })) };

// On tente de décoder + parser le plus gros candidat trouvé (le plus susceptible
// de contenir toute la liste des cartes).
found.sort((a, b) => b.length - a.length);
if (found.length > 0) {
  const best = found[0];
  const regex = new RegExp(`${best.attr}="([^"]*)"`, 'g');
  regex.lastIndex = best.startIndex;
  const match = regex.exec(data);
  const raw = match[1];
  const decoded = decodeEntities(raw);
  report.bestCandidate = { attr: best.attr, decodedLength: decoded.length };
  try {
    const json = JSON.parse(decoded);
    report.bestCandidate.parsedOk = true;
    report.bestCandidate.topLevelType = Array.isArray(json) ? 'array' : typeof json;
    report.bestCandidate.topLevelKeys = Array.isArray(json) ? null : Object.keys(json);

    // Cherche un tableau de cartes plausible n'importe où dans la structure
      function findCardArray(node, depth = 0) {
      if (depth > 6 || node == null) return null;
      if (Array.isArray(node) && node.length > 10 && node[0] && typeof node[0] === 'object' && ('rarity' in node[0] || 'name' in node[0])) {
        return node;
      }
      if (typeof node === 'object') {
        for (const key of Object.keys(node)) {
          const result = findCardArray(node[key], depth + 1);
          if (result) return result;
        }
      }
      return null;
    }
    const cardArray = Array.isArray(json) ? json : findCardArray(json);
    if (cardArray) {
      report.cardArrayLength = cardArray.length;
      report.sampleCards = cardArray.slice(0, 2);
    } else {
      report.decodedPreview = decoded.slice(0, 3000);
    }
  } catch (err) {
    report.bestCandidate.parsedOk = false;
    report.bestCandidate.parseError = err.message;
    report.decodedPreview = decoded.slice(0, 3000);
  }
} else {
  console.log('Aucun attribut candidat trouvé, recherche de gros blocs <script> avec du JSON...');
  const scriptRegex = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let match;
  const scripts = [];
  while ((match = scriptRegex.exec(data)) !== null) {
    scripts.push({ attrs: match[1], length: match[2].length, sample: match[2].slice(0, 500) });
  }
  scripts.sort((a, b) => b.length - a.length);
  report.biggestScripts = scripts.slice(0, 5);

  // On sait (grâce à une inspection précédente) que des champs comme
  // "resource_id" ou "skill_lv_max" existent bien quelque part dans le
  // fichier : on cherche directement leur contexte pour voir où ils sont
  // réellement logés (script, attribut non deviné, JSON brut...).
  console.log('Recherche de mots-clés connus (resource_id, skill_lv_max...)...');
  const keywords = ['resource_id', 'skill_lv_max', '"rarity"', 'leader_skill', 'passive_skill'];
  report.keywordContexts = {};
  for (const kw of keywords) {
    const idx = data.indexOf(kw);
    if (idx !== -1) {
      report.keywordContexts[kw] = data.slice(Math.max(0, idx - 800), idx + 1500);
    }
  }
}

// Cherche à quoi ressemble une vraie URL d'image de carte (ce fichier vient
// de "voir le code source", donc les URLs ne sont pas ré-écrites comme dans
// un fichier "page complète" enregistré par le navigateur).
const imgMatches = [];
const imgRegex = /src="([^"]*card[^"]*\.(?:png|webp|jpg))"/gi;
let imgMatch;
while (imgMatches.length < 5 && (imgMatch = imgRegex.exec(data)) !== null) {
  imgMatches.push(imgMatch[1]);
}
report.sampleImageUrls = imgMatches;

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`Résultat écrit dans : ${outPath}`);
console.log('Envoie ce fichier.');
