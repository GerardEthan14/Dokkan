// Script de diagnostic : sonde dokkaninfo.com (seule source retenue, la plus
// complète) pour trouver comment récupérer TOUTES les cartes avec leurs
// images. dokkaninfo.com est un site Next.js : en plus de quelques chemins
// d'API plausibles, on essaie d'extraire le bloc __NEXT_DATA__ intégré dans
// le HTML de la page /cards, une technique standard pour ce type de site qui
// révèle souvent soit les données directement, soit le "buildId" permettant
// de deviner l'URL JSON interne de la page (/_next/data/<buildId>/cards.json).
// N'écrit rien dans la base : produit juste data/probe-results.json à renvoyer.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, '..', '..', 'data', 'probe-results.json');
const BASE = 'https://dokkaninfo.com';

async function probe(name, url, opts = {}) {
  const entry = { name, url };
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (DokkanCollectionManager diagnostic probe)' },
      ...opts,
    });
    entry.status = res.status;
    entry.contentType = res.headers.get('content-type');
    const text = await res.text();
    entry.bodyLength = text.length;
    try {
      const json = JSON.parse(text);
      entry.jsonPreview = JSON.stringify(json).slice(0, 4000);
    } catch {
      entry.textPreview = text.slice(0, 500);
    }
    entry._rawText = text; // gardé en mémoire pour analyse locale, pas écrit tel quel
  } catch (err) {
    entry.error = err.message;
  }
  console.log(`- ${name}: ${entry.status ?? 'ERREUR'} ${entry.error ?? ''} (${entry.bodyLength ?? 0} octets)`);
  return entry;
}

function extractNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

async function main() {
  const results = [];

  console.log('1. Récupération de la page /cards (HTML) et extraction de __NEXT_DATA__...');
  const cardsPage = await probe('dokkaninfo-cards-page', `${BASE}/cards`);
  results.push(cardsPage);

  let buildId = null;
  if (cardsPage._rawText) {
    const nextData = extractNextData(cardsPage._rawText);
    if (nextData) {
      buildId = nextData.buildId ?? null;
      results.push({
        name: 'dokkaninfo-next-data-summary',
        buildId,
        topLevelKeys: Object.keys(nextData),
        pagePropsKeys: nextData.props?.pageProps ? Object.keys(nextData.props.pageProps) : null,
        pagePropsPreview: JSON.stringify(nextData.props?.pageProps ?? {}).slice(0, 4000),
      });
      console.log(`   buildId trouvé : ${buildId}`);
      console.log(`   clés de pageProps : ${Object.keys(nextData.props?.pageProps ?? {}).join(', ')}`);
    } else {
      console.log('   Pas de __NEXT_DATA__ trouvé dans le HTML.');
    }
  }
  delete cardsPage._rawText;

  if (buildId) {
    console.log('\n2. Essai de la route de données interne Next.js...');
    const dataRoute = await probe('dokkaninfo-next-data-route', `${BASE}/_next/data/${buildId}/cards.json`);
    delete dataRoute._rawText;
    results.push(dataRoute);
  }

  console.log('\n3. Essai de chemins d\'API plausibles...');
  for (const p of ['/api/cards', '/api/card', '/api/units', '/api/characters', '/api/card-list']) {
    const r = await probe(`dokkaninfo-${p}`, `${BASE}${p}`);
    delete r._rawText;
    results.push(r);
  }

  console.log('\n4. Sonde d\'une fiche carte individuelle (pour voir le détail d\'une carte)...');
  const cardDetail = await probe('dokkaninfo-card-detail-example', `${BASE}/cards/1122801`);
  if (cardDetail._rawText) {
    const nextData = extractNextData(cardDetail._rawText);
    if (nextData) {
      results.push({
        name: 'dokkaninfo-card-detail-next-data-summary',
        pagePropsKeys: nextData.props?.pageProps ? Object.keys(nextData.props.pageProps) : null,
        pagePropsPreview: JSON.stringify(nextData.props?.pageProps ?? {}).slice(0, 6000),
      });
    }
  }
  delete cardDetail._rawText;
  results.push(cardDetail);

  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nRapport écrit dans : ${outPath}`);
  console.log('Envoie ce fichier pour qu\'on écrive l\'import définitif.');
}

main().catch((err) => {
  console.error('Erreur pendant la sonde :', err);
  process.exit(1);
});
