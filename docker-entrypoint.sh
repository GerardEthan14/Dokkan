#!/bin/sh
set -e

if [ ! -f /app/data/dokkan.sqlite3 ]; then
  echo "Aucune base existante trouvée, import initial des cartes..."
  node server/scripts/import-cards.mjs
fi

exec "$@"
