# Dokkan Collection Manager

Petit site perso pour suivre ta collection Dragon Ball Z Dokkan Battle :

- Voir **quelles cartes il te manque**.
- Voir **à quel % (nombre de doublons)** est chaque carte que tu possèdes.
- Repérer les cartes où tu as **des doublons en stock non utilisés** (tu pourrais monter le %).
- Repérer les cartes possédées mais **pas encore Dokkan Awaken**.
- Affichage avec les **icônes des cartes comme en jeu** (cadre coloré selon la rareté, pastille de type).

## Installation

```bash
npm install
npm run import-cards   # télécharge la base de cartes (LR & UR) une première fois
npm start               # démarre le site sur http://localhost:3000
```

Ouvre ensuite http://localhost:3000 dans ton navigateur.

## Comment ça marche

- **Base de cartes** : importée automatiquement depuis une base communautaire publique
  (données du Dokkan Battle Wiki, via le projet `MNprojects/DokkanAPI`). Elle couvre
  actuellement les cartes **LR et UR** (rareté SSR/SR/R/N pas encore incluses dans
  cette source). Tu peux relancer `npm run import-cards` à tout moment pour mettre à
  jour les infos des cartes (nom, image...) : ta progression (possédé, %, doublons,
  Dokkan Awaken) n'est jamais effacée par cet import.
- **Ta progression** est stockée dans un fichier local `data/dokkan.sqlite3` (créé
  automatiquement, ignoré par git) : rien n'est envoyé sur internet, tout reste sur
  ta machine.
- **% d'une carte** : tu indiques le % actuel en jeu (par palier de 10%, 0 à 100) et le
  nombre de doublons que tu as en stock. Le site calcule le % potentiel et t'avertit
  si tu as des doublons non utilisés qui pourraient monter le %.
- **Dokkan Awaken** : coche/décoche manuellement si la carte a été Dokkan Awaken ou
  non (l'info n'existe pas dans la base publique, donc c'est toi qui la renseignes).

## Filtres disponibles

- **Toutes** / **Possédées** / **Manquantes**
- **Doublons disponibles** : cartes possédées où tu pourrais monter le % avec ton stock.
- **Non Dokkan Awaken** : cartes possédées que tu n'as pas encore Dokkan Awaken.
- Recherche par nom/titre/catégorie, filtres par rareté, type (AGL/TEQ/INT/STR/PHY)
  et classe (Super/Extreme).

## Limites connues

- La source de données publique ne couvre que LR/UR (~800 cartes). Si tu veux aussi
  suivre des SSR/SR, il faudra soit une autre source, soit ajouter les cartes à la
  main en base (une fonctionnalité d'ajout manuel pourra être ajoutée si besoin).
- Certaines images (hébergées sur le CDN du wiki Fandom) peuvent occasionnellement
  être indisponibles ; un cadre vide s'affiche alors à la place de l'icône.
