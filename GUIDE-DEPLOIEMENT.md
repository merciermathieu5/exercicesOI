# Mettre en ligne « Je m'exerce » (interface élève seule)

Ce dossier ne contient **que** l'interface élève. L'outil enseignant a été retiré.
La page d'accueil du site est directement la plateforme d'exercices.

## Structure

```
HEC-eleve/
├── index.html              ← l'interface élève (page d'accueil)
├── admin/
│   └── index.html          ← la console d'administration (catalogue de questions)
├── .nojekyll
└── assets/
    ├── data/questions.json ← les 354 questions
    ├── js/data.js          ← métadonnées + banque de documents (utilisé par l'admin)
    └── img/...             ← les images des documents
```

## Déploiement sur GitHub Pages

1. Dézippe ce dossier.
2. Sur GitHub, dans ton dépôt : **Add file → Upload files**, puis glisse **le
   contenu** du dossier `HEC-eleve/` (le fichier `index.html`, le dossier
   `assets/` et `.nojekyll`) — pas le dossier `HEC-eleve` lui-même. Commit.
3. `Settings` → `Pages` → branche `main` / dossier `(root)` → `Save`.
4. Après ~1 minute, l'adresse racine de ton site affiche l'interface élève :
   `https://TON-PSEUDO.github.io/TON-DEPOT/`

C'est tout. Aucun réglage, aucune clé. Tout fonctionne hors-ligne.

## Console d'administration

Une console est disponible à l'adresse `https://TON-PSEUDO.github.io/TON-DEPOT/admin/`.
Elle reprend le même modèle que l'ancienne admin de l'outil enseignant : on y gère
le **catalogue de questions** (identification, énoncé, espace de réponse, réglettes,
documents, corrigé), avec sauvegarde directement dans le dépôt.

- Aucun lien vers cette console n'apparaît sur la page élève : les élèves ne la
  voient pas. On y accède en tapant l'adresse `/admin/`.
- Pour modifier le catalogue, la console demande un **jeton GitHub** (jeton d'accès
  personnel avec droit d'écriture sur le dépôt). Tu le saisis dans la console au
  moment de te connecter ; il **n'est jamais stocké dans le dépôt** (au plus,
  mémorisé dans ton navigateur si tu coches « se souvenir »).
- Quand tu publies une modification, la console réécrit `assets/data/questions.json`,
  et le site élève en tient compte automatiquement après 1–2 minutes.

> **Sécurité** : la page `/admin/` est visible publiquement (c'est un site
> statique), mais elle ne peut rien modifier sans un jeton GitHub valide ayant les
> droits d'écriture. Sans jeton, c'est une coquille vide. Ne partage pas ton jeton.

## Ce que fait la plateforme (Option A)

- **Questions fermées** (cases à cocher, avant/après, ordre chronologique,
  document-cause/conséquence) : **corrigées automatiquement**, avec un retour qui
  indique ce qui est juste et ce qui est à revoir.
- **Questions rédigées** : la plateforme affiche la **réponse modèle** pour que
  l'élève se compare. (L'analyse intelligente de la rédaction n'est PAS active en
  Option A.)

## Activer plus tard l'analyse des réponses rédigées (Option B)

Si tu veux que la plateforme **analyse** les réponses rédigées et donne une
rétroaction personnalisée, il faut un petit relais gratuit (fichier `worker.js`,
fourni séparément). Une fois le relais déployé, ouvre `index.html` et remplace, en
haut du script :

```js
const RELAY_URL = "";
```

par l'adresse de ton relais. Rien d'autre à changer.
