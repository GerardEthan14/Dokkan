// Script de diagnostic : sonde plusieurs pistes possibles pour trouver une
// source de données couvrant TOUTES les raretés de cartes Dokkan Battle
// (le premier essai, basé sur l'API "Cargo" du wiki Fandom, s'est révélé
// être une impasse : ce wiki ne l'utilise pas). Ne modifie pas la base de
// données : il écrit juste un rapport dans data/probe-results.json à
// renvoyer pour qu'on choisisse la bonne piste ensemble.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, '..', '..', 'data', 'probe-results.json');

async function probe(name, url, opts = {}) {
  const entry = { name, url };
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'DokkanCollectionManager/1.0 (diagnostic probe)' },
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
      entry.textPreview = text.slice(0, 2000);
    }
  } catch (err) {
    entry.error = err.message;
  }
  console.log(`- ${name}: ${entry.status ?? 'ERREUR'} ${entry.error ?? ''}`);
  return entry;
}

async function main() {
  const results = [];
  const fandomApi = 'https://dbz-dokkanbattle.fandom.com/api.php';

  console.log('Sonde du wiki Fandom (MediaWiki de base + wikitext d\'une page carte)...');
  results.push(await probe('fandom-siteinfo', `${fandomApi}?action=query&meta=siteinfo&format=json`));
  results.push(
    await probe(
      'fandom-allcards-overview-wikitext',
      `${fandomApi}?action=parse&page=${encodeURIComponent('All Cards: (1)001 to (1)100')}&prop=wikitext&format=json`,
    ),
  );
  results.push(
    await probe(
      'fandom-sample-card-wikitext',
      `${fandomApi}?action=parse&page=${encodeURIComponent('Broly & Cheelai & Lemo')}&prop=wikitext&format=json`,
    ),
  );
  results.push(
    await probe(
      'fandom-sample-card-images',
      `${fandomApi}?action=query&titles=${encodeURIComponent('Broly & Cheelai & Lemo')}&prop=images&format=json`,
    ),
  );
  results.push(
    await probe(
      'fandom-category-cards',
      `${fandomApi}?action=query&list=categorymembers&cmtitle=Category:Cards&cmlimit=20&format=json`,
    ),
  );

  console.log('\nSonde de dokkan.wiki...');
  results.push(await probe('dokkanwiki-known-card', 'https://dokkan.wiki/api/cards/1007181'));
  results.push(await probe('dokkanwiki-list-bare', 'https://dokkan.wiki/api/cards'));
  results.push(await probe('dokkanwiki-list-paginated', 'https://dokkan.wiki/api/cards?page=1'));

  console.log('\nSonde de dokkaninfo.com...');
  results.push(await probe('dokkaninfo-api-cards', 'https://dokkaninfo.com/api/cards'));
  results.push(await probe('dokkaninfo-cards-page', 'https://dokkaninfo.com/cards'));

  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nRapport écrit dans : ${outPath}`);
  console.log('Envoie ce fichier pour qu\'on choisisse la meilleure source ensemble.');
}

main().catch((err) => {
  console.error('Erreur pendant la sonde :', err);
  process.exit(1);
});
