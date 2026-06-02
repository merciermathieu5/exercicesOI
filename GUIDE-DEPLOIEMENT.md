# Héberger « Je m'exerce » sur GitHub Pages

Tu as **deux options**. Commence par l'Option A (5 minutes, gratuit, aucun compte
supplémentaire). Passe à l'Option B seulement quand tu veux la rétroaction
intelligente sur les réponses rédigées.

---

## Option A — Site statique (sans rétroaction IA)

Les questions fermées (cases, avant/après, ordre, document-cause) sont corrigées
automatiquement. Les questions rédigées affichent directement la **réponse modèle**
pour que l'élève se compare. Tout fonctionne hors-ligne, sans clé, sans coût.

1. Dans ton dépôt GitHub, dépose **`exercice.html` à la racine**, à côté du dossier
   `assets/` (celui qui contient déjà `assets/data/questions.json` et `assets/img/`).
   La structure doit ressembler à :

   ```
   ton-depot/
   ├── index.html          ← l'outil enseignant (composition de cahiers) existant
   ├── exercice.html       ← NOUVEAU : l'interface élève
   └── assets/
       ├── data/questions.json
       └── img/...
   ```

2. `Settings` → `Pages` → branche `main` / dossier `(root)` → `Save`.
3. Patiente ~1 minute, puis ouvre :
   `https://TON-PSEUDO.github.io/TON-DEPOT/exercice.html`

C'est tout. L'interface charge automatiquement les 354 questions et les images.

> **Poids du site** : ~176 Mo (surtout les images). C'est bien en dessous des
> limites de GitHub Pages (≈1 Go) pour un usage de classe. Aucune action requise.

---

## Option B — Avec rétroaction IA sur les réponses rédigées

GitHub Pages est un **hébergement statique** : il ne peut ni stocker ta clé API
en secret, ni exécuter de code serveur. Il faut donc un petit **relais** gratuit
qui détient la clé et parle à l'API Claude. C'est le fichier `worker.js`.

### 1. Obtenir une clé API
- Crée un compte sur https://console.anthropic.com et génère une clé `sk-ant-...`.
- L'API est payante à l'usage, mais une courte rétroaction avec **Haiku 4.5**
  coûte une fraction de cent par réponse. Mets une **limite de dépense mensuelle**
  dans la console (ex. 5 $) pour dormir tranquille.

### 2. Déployer le relais (Cloudflare Workers, gratuit)
Suis les étapes indiquées **en commentaire en haut de `worker.js`**. En résumé :

```bash
npm install -g wrangler
wrangler login
wrangler init hec-relais          # choisir "Hello World", JavaScript
# remplace src/index.js par worker.js
wrangler secret put ANTHROPIC_API_KEY   # colle ta clé sk-ant-...
wrangler deploy
```

Tu obtiens une URL du type `https://hec-relais.TON-COMPTE.workers.dev`.

- Dans `worker.js`, mets ton vrai domaine dans `ALLOWED`
  (ex. `"https://TON-PSEUDO.github.io"`, **sans** le `/TON-DEPOT`).
- Le relais **impose le modèle et un plafond de jetons** : même si quelqu'un
  trouve l'URL, il ne peut pas détourner ta clé pour autre chose.

### 3. Brancher l'interface
Ouvre `exercice.html`, trouve la ligne tout en haut du script :

```js
const RELAY_URL = "";
```

et remplace par ton URL de relais :

```js
const RELAY_URL = "https://hec-relais.TON-COMPTE.workers.dev";
```

Recommit le fichier. Désormais, chaque réponse rédigée reçoit une rétroaction
qualitative bienveillante (point fort, point à améliorer, indice, encouragement),
sans note chiffrée. Si le relais est indisponible, l'interface bascule
automatiquement sur la réponse modèle.

---

## Sécurité — à retenir
- **Ne mets jamais ta clé `sk-ant-...` dans `exercice.html`** ni nulle part dans
  le dépôt GitHub : tout y est public. La clé ne vit que dans le secret du relais.
- Garde une limite de dépense mensuelle activée dans la console Anthropic.

## Pour changer de modèle
Dans `worker.js`, la constante `MODEL` :
- `claude-haiku-4-5-20251001` — rapide, économique (recommandé pour la classe).
- `claude-sonnet-4-6` — rétroaction plus fine, un peu plus coûteuse.
