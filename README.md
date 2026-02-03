# Transfert (Mega)

## Ce que fait le projet
- Frontend type WeTransfer (statique)
- Backend Node qui envoie sur Mega
- Lien court du type `https://transfert.antoinedamay.fr/<token>`
- Expiration configurable (1, 7, 30, 90 jours)

## Structure
- `transfert/frontend/` : site statique (à héberger sur GitHub Pages)
- `transfert/server/` : backend Node (à héberger sur Render)
- `transfert/render.yaml` : déploiement Render (Blueprint)
- `transfert/.github/workflows/pages.yml` : déploiement GitHub Pages

## Déploiement Render (backend)
1. Pousser le repo sur GitHub (le fichier `render.yaml` doit être à la racine du repo)
2. Sur Render :
   - Create > New > Blueprint
   - Sélectionner le repo
   - Render détecte `render.yaml`
3. Renseigner les variables d'env (manuellement dans Render) :
   - `MEGA_EMAIL`
   - `MEGA_PASSWORD`
   - `BASE_URL` = `https://<service>.onrender.com`
   - `PUBLIC_BASE_URL` = `https://transfert.antoinedamay.fr`

## Déploiement GitHub Pages (frontend)
1. Activer GitHub Pages sur le repo
2. Source : `GitHub Actions`
3. Dans Settings > Pages, définir le domaine personnalisé : `transfert.antoinedamay.fr`

## Config frontend
Dans `transfert/frontend/config.js` :
- Remplacer `https://YOUR_RENDER_URL.onrender.com` par l'URL Render réelle

## Liens courts (optionnel)
Pour générer des liens courts du type `https://transfert.antoinedamay.fr/AbCd12`,
il faut un stockage clé/valeur. Le backend supporte Upstash Redis (REST API).

Ajouter ces variables d'environnement sur Render :
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `SHORT_CODE_LEN` (optionnel, par défaut 8)

Si Upstash n'est pas configuré, le backend génère des liens longs (base64).

### Liens personnalisés
Si Upstash est configuré, l'utilisateur peut saisir un **nom de lien** (slug)
dans l'interface. Le backend refusera si le nom est déjà pris ou invalide.

## DNS OVH (pour le sous-domaine)
- Créer un **CNAME** :
  - `transfert` -> `<ton-username>.github.io`

## Remarques
- L'expiration ne supprime pas le fichier sur Mega, elle invalide juste le lien.
- Le plan gratuit Render se met en veille après inactivité.
