# Lysto ▶

Extension navigateur (Chrome + Safari) qui règle le problème des sites de streaming sans historique :
elle **détecte automatiquement** la série que tu regardes, te propose de la **suivre**, et **retient la
position exacte** de chaque épisode pour te faire reprendre là où tu t'étais arrêté.

Tout est **100 % local** : aucune donnée ne quitte ton navigateur.

## Fonctionnalités

- 🎬 **Détection automatique** — dès qu'une vidéo de plus de 4 minutes est lue (hors YouTube),
  Lysto analyse le titre de la page et l'URL pour reconnaître la série et l'épisode
  (`S01E03`, `1x03`, `Saison 1 Épisode 3`…), y compris quand le lecteur est dans une iframe.
- 💬 **Pop-up d'ajout** — après ~20 secondes de lecture réelle, un toast discret propose de
  suivre la série. « Ignorer » = on ne te redemandera plus pour cette série.
- ⏸️ **Reprise automatique** — la position est sauvegardée toutes les 5 secondes (et à chaque
  pause / fermeture d'onglet). Quand tu rouvres l'épisode, Lysto propose de reprendre à la
  position exacte.
- 📚 **Historique bien rangé** — le popup de l'extension liste tes séries (en cours / terminées),
  avec progression, dernier épisode vu, recherche, et un bouton **Reprendre** qui rouvre la bonne page.

## Installation

### Chrome (ou Edge, Brave, Arc…)

1. Ouvre `chrome://extensions`
2. Active le **Mode développeur** (en haut à droite)
3. Clique **Charger l'extension non empaquetée** et sélectionne le dossier `extension/`

### Safari (macOS)

Safari exige d'empaqueter les extensions web dans une petite app macOS via Xcode :

1. Installe **Xcode** (gratuit, App Store), ouvre-le une fois
2. `./scripts/build-safari.sh` — génère le projet Xcode dans `safari/`
3. Ouvre le projet, **⌘R** pour lancer l'app
4. Safari → Réglages → Avancés → coche « Afficher le menu Développement »,
   puis menu Développement → « Autoriser les extensions non signées »
5. Safari → Réglages → Extensions → active **Lysto**

## Structure

```
extension/          l'extension web (Manifest V3, commun Chrome/Safari)
  manifest.json
  parser.js         reconnaissance série/épisode (titre + URL)
  content.js        détection vidéo, suivi de lecture, toasts
  background.js     service worker : décisions + stockage
  popup.*           l'interface « mes séries »
scripts/
  make_icons.py     génère les icônes (python3, sans dépendance)
  build-safari.sh   conversion Safari via Xcode
tests/
  parser.test.mjs   tests du parser (`node tests/parser.test.mjs`)
dev/
  preview.html      aperçu du popup avec données de démo
```

## Développement

```bash
node tests/parser.test.mjs     # tests du parser de titres
python3 scripts/make_icons.py  # régénérer les icônes
```

Pour prévisualiser le popup avec des données de démo : servir la racine du projet
(`python3 -m http.server`) et ouvrir `dev/preview.html`.
