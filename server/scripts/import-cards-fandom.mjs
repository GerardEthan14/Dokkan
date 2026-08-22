// Tentative d'import ÉLARGI (toutes raretés : N, R, SR, SSR, UR, LR) depuis
// le wiki communautaire Dragon Ball Z Dokkan Battle (Fandom), via son API
// publique "Cargo" (données structurées utilisées par la plupart des wikis
// de jeux). Ce script n'a PAS pu être testé en conditions réelles (l'environnement
// de développement utilisé pour écrire ce projet n'a pas accès à ce site) :
// lance-le et si l'import échoue ou semble incomplet, envoie le contenu de
// data/fandom-diagnostic.json généré, pour qu'on affine le script ensemble.
import { db } from '../db.mjs';

const WIKI_API = 'https://dbz-dokkanbattle.fandom.com/api.php';
const CANDIDATE_TABLE_PATTERNS = [/^cards?$/i, /^cardtable/i, /^character/i, /^units?$/i];

async function getJSON(params) {
  const url = `${WIKI_API}?${new URLSearchParams({ format: 'json', ...params })}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'DokkanCollectionManager/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  return res.json();
}

function pickField(fields, patterns) {
  for (const pattern of patterns) {
    const match = fields.find((f) => pattern.test(f.name));
    if (match) return match.name;
  }
  return null;
}

async function resolveImageUrl(filename) {
  if (!filename) return null;
  if (/^https?:\/\//i.test(filename)) return filename;
  try {
    const data = await getJSON({
      action: 'query',
      titles: `File:${filename}`,
      prop: 'imageinfo',
      iiprop: 'url',
    });
    const pages = data?.query?.pages;
    const page = pages && Object.values(pages)[0];
    return page?.imageinfo?.[0]?.url ?? null;
  } catch {
    return null;
  }
}

async function main() {
  console.log('Recherche des tables de données structurées (Cargo) sur le wiki...');
  const tablesRes = await getJSON({ action: 'cargotables' });
  const tables = tablesRes?.cargotables ?? [];
  console.log(`${tables.length} tables trouvées :`, tables.join(', '));

  const candidates = tables.filter((t) => CANDIDATE_TABLE_PATTERNS.some((p) => p.test(t)));
  if (candidates.length === 0) {
    await dumpDiagnostic({ tables, reason: 'Aucune table ne ressemble à une table de cartes.' });
    return;
  }
  console.log('Tables candidates :', candidates.join(', '));

  for (const table of candidates) {
    const fieldsRes = await getJSON({ action: 'cargofields', table });
    const fields = fieldsRes?.cargofields ?? [];
    console.log(`Champs de "${table}" :`, fields.map((f) => f.name).join(', '));

    const idField = pickField(fields, [/^id$/i, /^cardid$/i, /^_pageid$/i]);
    const nameField = pickField(fields, [/^name$/i, /^character$/i, /^title$/i]);
    const rarityField = pickField(fields, [/^rarity$/i]);
    const typeField = pickField(fields, [/^type$/i]);
    const classField = pickField(fields, [/^class$/i]);
    const imageField = pickField(fields, [/^image$/i, /^icon$/i, /thumbnail/i]);

    if (!nameField || !rarityField) {
      console.log(`Table "${table}" ignorée : champs nom/rareté introuvables.`);
      continue;
    }

    console.log(`Import depuis la table "${table}"...`);
    const selectedFields = [idField, nameField, rarityField, typeField, classField, imageField].filter(Boolean);

    const upsert = db.prepare(`
      INSERT INTO cards (id, name, rarity, class, type, image_url, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        rarity=COALESCE(excluded.rarity, cards.rarity),
        class=COALESCE(excluded.class, cards.class),
        type=COALESCE(excluded.type, cards.type),
        image_url=COALESCE(excluded.image_url, cards.image_url),
        updated_at=datetime('now')
    `);
    const ensureCollectionRow = db.prepare(`INSERT OR IGNORE INTO collection (card_id) VALUES (?)`);

    let offset = 0;
    const limit = 500;
    let totalImported = 0;
    for (;;) {
      const queryRes = await getJSON({
        action: 'cargoquery',
        tables: table,
        fields: selectedFields.join(','),
        limit: String(limit),
        offset: String(offset),
      });
      const rows = (queryRes?.cargoquery ?? []).map((r) => r.title);
      if (rows.length === 0) break;

      db.exec('BEGIN');
      try {
        for (const row of rows) {
          const rawId = idField ? row[idField] : null;
          const name = row[nameField];
          if (!name) continue;
          const id = rawId ? `fandom-${rawId}` : `fandom-${name}`;
          const imageUrl = await resolveImageUrl(imageField ? row[imageField] : null);
          upsert.run(
            id,
            name,
            rarityField ? row[rarityField] : null,
            classField ? row[classField] : null,
            typeField ? row[typeField] : null,
            imageUrl,
          );
          ensureCollectionRow.run(id);
          totalImported++;
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      console.log(`  ... ${totalImported} cartes importées jusqu'ici`);
      if (rows.length < limit) break;
      offset += limit;
    }

    console.log(`Table "${table}" : ${totalImported} cartes importées.`);
  }
}

async function dumpDiagnostic(data) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outPath = path.join(__dirname, '..', '..', 'data', 'fandom-diagnostic.json');
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`\nImport impossible automatiquement. Diagnostic écrit dans : ${outPath}`);
  console.log("Envoie le contenu de ce fichier pour qu'on ajuste le script ensemble.\n");
}

main().catch(async (err) => {
  console.error("Erreur pendant l'import Fandom :", err.message);
  await dumpDiagnostic({ error: err.message, stack: err.stack });
  process.exitCode = 1;
});
