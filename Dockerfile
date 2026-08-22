FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public

# La base de cartes est importée au premier démarrage si elle n'existe pas encore
# (voir docker-entrypoint.sh), pour ne jamais écraser la progression déjà sauvegardée
# sur le volume persistant monté sur /app/data.
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

VOLUME ["/app/data"]
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server/index.mjs"]
