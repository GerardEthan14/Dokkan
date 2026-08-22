// Cherche des cartes par nom dans le fichier reconstruit (data/dokkaninfo-cards-source.html)
// et affiche leurs données brutes complètes. Utile pour vérifier/corriger le
// décodage rareté/type/classe sur des cas précis.
// Usage : node server/scripts/lookup-cards.mjs "terme de recherche"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inputPath = path.join(__dirname, '..', '..', 'data', 'dokkaninfo-cards-source.html');
const searchTerm = process.argv[2];

if (!searchTerm) {
  console.error('Utilisation : node server/scripts/lookup-cards.mjs "terme de recherche"');
  process.exit(1);
}

function decodeEntities(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

const data = fs.readFileSync(inputPath, 'utf8');
const match = data.match(/(?:v-bind:cardsjson|cardsjson)="([^"]*)"/);
if (!match) {
  console.error('Attribut cardsjson introuvable.');
  process.exit(1);
}
const cards = JSON.parse(decodeEntities(match[1]));

const isNumeric = /^\d+$/.test(searchTerm);
const results = isNumeric
  ? cards.filter((c) => String(c.id) === searchTerm)
  : cards.filter((c) => c.name && c.name.toLowerCase().includes(searchTerm.toLowerCase()));

console.log(`${results.length} résultat(s) pour "${searchTerm}" :\n`);
for (const c of results) {
  console.log(JSON.stringify(c, null, 2));
}
