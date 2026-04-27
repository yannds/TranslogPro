# Manuels TransLog Pro

Documentation opérationnelle organisée par profil utilisateur. Chaque manuel décrit ce que la personne doit savoir, voir, faire et éviter sur sa zone de responsabilité.

## Structure

```
docs/manuals/
├── admin-infra/        — Toi (root VPS, ops infra, observabilité, sécurité, déploiements)
├── admin-platform/     — Super-admin SaaS (gestion tenants, plans, billing, modération)
├── dev/                — Développeurs (architecture, conventions, modules, tests)
└── user/               — Utilisateurs finaux (admin tenant, agent, voyageur)
```

## Index

### Admin infra ([admin-infra/](admin-infra/))

| Manuel | Sujet |
|---|---|
| [observability.md](admin-infra/observability.md) | Stack monitoring : Prometheus, Grafana, Loki, exporters, CrowdSec |

### Admin plateforme ([admin-platform/](admin-platform/))

À rédiger.

### Développeurs ([dev/](dev/))

À rédiger par module au fur et à mesure.

### Utilisateurs ([user/](user/))

À rédiger par profil.

## Convention de rédaction

Chaque manuel doit suivre la même structure pour être prévisible :

1. **Vue d'ensemble** — quoi, pourquoi, comment c'est intégré
2. **Architecture** — schéma + composants
3. **Accès** — URLs, credentials, où trouver les secrets
4. **Opérations courantes** — ce qu'on fait au quotidien
5. **Investigation / debug** — quand quelque chose semble bizarre
6. **Activation / désactivation de features** — pour les composants à comportement progressif (ex: CrowdSec scenarios)
7. **Recovery** — ce qu'on fait quand ça casse
8. **Limites connues** — ce qui ne marche pas (encore)

Les sections **Accès** et **Recovery** sont **non négociables** — si je peux pas les trouver en 30 secondes en pleine alerte, le manuel est inutile.
