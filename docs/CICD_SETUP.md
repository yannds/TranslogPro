# CI/CD — Setup GitHub Actions

À faire **UNE FOIS** après le premier push du repo sur GitHub.

## 1. Créer une clé SSH dédiée déploiement

Sur ton Mac, crée une clé séparée (différente de ta clé perso) :

```bash
ssh-keygen -t ed25519 -f ~/.ssh/translog_deploy -C "github-actions-deploy" -N ""

# Ajoute la PUBLIQUE au VPS
ssh-copy-id -i ~/.ssh/translog_deploy.pub root@72.61.108.160

# Test
ssh -i ~/.ssh/translog_deploy root@72.61.108.160 "echo OK"
```

## 2. Récupérer SSH_KNOWN_HOSTS

```bash
ssh-keyscan -H 72.61.108.160 2>/dev/null
# → copie le résultat (3 lignes)
```

## 3. Configurer les Secrets sur GitHub

`Repo Settings → Secrets and variables → Actions → New repository secret`

| Nom | Valeur |
|---|---|
| `SSH_PRIVATE_KEY` | Contenu de `~/.ssh/translog_deploy` (cat) |
| `SSH_KNOWN_HOSTS` | Output de `ssh-keyscan` (étape 2) |
| `VPS_HOST` | `72.61.108.160` |
| `VPS_USER` | `root` |
| `VPS_DEPLOY_PATH` | `/opt/TranslogPro` |
| `PLATFORM_BASE_DOMAIN` | `translog.dsyann.info` |
| `PUBLIC_APP_URL` | `https://api.translog.dsyann.info` |

> `GITHUB_TOKEN` est auto-injecté par GitHub Actions, pas besoin de le créer manuellement.

## 4. Déclencher le premier deploy

### Option A — manuel (recommandé pour tester)
`Actions → Deploy production → Run workflow → main`

### Option B — automatique sur tag
```bash
git tag v1.0.0
git push origin v1.0.0
```

## 5. Workflow

| Trigger | Effet |
|---|---|
| Push tag `v*.*.*` | Build + push GHCR + deploy auto sur VPS |
| `workflow_dispatch` | Pareil, déclenchement manuel |
| Push sur `main` | Tests unit/frontend/security uniquement (pas de deploy) |
| Pull request | Tests uniquement |

## 6. Vérifier que ça marche

Premier déploiement :
1. Va sur `Actions` → `Deploy production`
2. Clique **Run workflow** → `main` → Run
3. Suis les logs dans l'UI
4. À la fin, healthcheck externe valide les domaines

Si échec : voir [MANUEL_OPS.md](MANUEL_OPS.md#3-debug-par-couche).

## 7. Rotation SSH (sécu)

Tous les 6 mois :
```bash
ssh-keygen -t ed25519 -f ~/.ssh/translog_deploy_v2 -C "github-actions-deploy-v2" -N ""
ssh-copy-id -i ~/.ssh/translog_deploy_v2.pub root@72.61.108.160
# Update SSH_PRIVATE_KEY dans GitHub Secrets
# Test deploy
# Puis sur le VPS : retire l'ancienne clé du authorized_keys
```
