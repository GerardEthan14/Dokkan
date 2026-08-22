# Dokkan Collection Manager

Petit site perso pour suivre ta collection Dragon Ball Z Dokkan Battle :

- Voir **quelles cartes il te manque**.
- Voir **à quel % (nombre de doublons)** est chaque carte que tu possèdes.
- Repérer les cartes où tu as **des doublons en stock non utilisés** (tu pourrais monter le %).
- Repérer les cartes possédées mais **pas encore Dokkan Awaken**.
- Affichage avec les **icônes des cartes comme en jeu** (cadre coloré selon la rareté, pastille de type).
- Interface responsive, utilisable depuis un téléphone.

## Installation (en local)

```bash
npm install
npm run import-cards   # télécharge la base de cartes (LR & UR) une première fois
npm start               # démarre le site sur http://localhost:3000
```

Ouvre ensuite http://localhost:3000 dans ton navigateur.

## Comment ça marche

- **Base de cartes** : importée automatiquement depuis une base communautaire publique
  (données du Dokkan Battle Wiki, via le projet `MNprojects/DokkanAPI`). Elle couvre
  pour l'instant ~800 cartes **LR et UR**. Tu peux relancer `npm run import-cards` à
  tout moment pour mettre à jour les infos des cartes (nom, image...) : ta progression
  (possédé, %, doublons, Dokkan Awaken) n'est jamais effacée par cet import.
- **`npm run import-cards-full`** (optionnel, expérimental) : tente d'importer en plus
  toutes les autres raretés (N/R/SR/SSR) depuis le wiki Fandom Dokkan Battle. Ce script
  n'a pas pu être testé en conditions réelles pendant le développement (environnement
  sans accès à ce site) : lance-le, et s'il échoue ou si le résultat semble faux/incomplet,
  envoie-moi le contenu de `data/fandom-diagnostic.json` qu'il génère, pour qu'on corrige
  ensemble le mapping des champs.
- **Ta progression** est stockée dans un fichier local `data/dokkan.sqlite3` (créé
  automatiquement, ignoré par git) : rien n'est envoyé sur internet, tout reste sur
  ta machine (ou sur ton volume persistant si tu déploies en ligne, voir plus bas).
- **% d'une carte** : le jeu n'avance pas par paliers de 10%. Le site utilise les vrais
  paliers Dokkan Battle : **55% (sans doublon), 69% (1 doublon), 79% (2), 89% (3), 100%
  (4, rainbow)**. Tu indiques le % actuel et le nombre de doublons en stock ; le site
  calcule le % potentiel et t'avertit si tu as de quoi monter le %.
- **Dokkan Awaken** : coche/décoche manuellement si la carte a été Dokkan Awaken ou
  non (l'info n'existe pas dans la base publique, donc c'est toi qui la renseignes).

## Filtres disponibles

- **Toutes** / **Possédées** / **Manquantes**
- **Doublons disponibles** : cartes possédées où tu pourrais monter le % avec ton stock.
- **Non Dokkan Awaken** : cartes possédées que tu n'as pas encore Dokkan Awaken.
- Recherche par nom/titre/catégorie, filtres par rareté, type (AGL/TEQ/INT/STR/PHY)
  et classe (Super/Extreme).

## Accéder au site depuis ton téléphone, partout (déploiement en ligne)

Le projet est prêt pour un déploiement sur [Fly.io](https://fly.io) (offre gratuite avec
volume persistant, pour ne jamais perdre ta progression) :

```bash
# 1. Installer flyctl (une seule fois) : https://fly.io/docs/flyctl/install/
# 2. Se connecter / créer un compte
fly auth login

# 3. Depuis le dossier du projet : lancer le déploiement
fly launch --copy-config --name ton-nom-de-site   # répond "non" si on te propose de recréer fly.toml

# 4. Créer le volume persistant pour la base de données (une seule fois)
fly volumes create dokkan_data --size 1 --region cdg

# 5. Déployer
fly deploy
```

Une fois déployé, `fly.toml` expose le site sur une URL du type
`https://ton-nom-de-site.fly.dev`, accessible depuis ton téléphone (ajoute-la à ton
écran d'accueil pour un accès en un clic). L'import des cartes se fait automatiquement
au tout premier démarrage du conteneur (voir `docker-entrypoint.sh`).

Je n'ai pas pu tester ce déploiement moi-même (pas d'accès Docker Hub / Fly.io depuis
mon environnement de développement) : le `Dockerfile` suit des pratiques standards mais
dis-moi si `fly deploy` échoue, pour qu'on corrige ensemble.

**Alternative** : faire tourner `npm start` sur ton PC/serveur à la maison et y accéder
depuis ton téléphone via l'IP locale de la machine (ex: `http://192.168.1.x:3000`) tant
que tu es sur le même réseau WiFi — gratuit et simple, mais pas accessible en dehors de
chez toi.

## Limites connues

- La base "principale" (`import-cards`) ne couvre que LR/UR (~800 cartes) ; l'import
  élargi (`import-cards-full`) est expérimental et n'a pas pu être validé avant livraison.
- Les % suivent le barème standard (55/69/79/89/100). Si une carte précise affiche un
  barème différent chez toi, dis-le-moi pour qu'on adapte.
- Certaines images (hébergées sur des CDN externes) peuvent occasionnellement être
  indisponibles ; un cadre vide s'affiche alors à la place de l'icône.
