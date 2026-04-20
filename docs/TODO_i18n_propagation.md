# TODO — Propagation i18n dans les 6 locales restantes

Les derniers ajouts frontend ont introduit **3 namespaces i18n** actuellement présents uniquement en `fr` et `en`. Les autres locales tombent en fallback français — ça fonctionne mais ce n'est pas propre pour une v1 publique.

## Namespaces à propager

| Namespace | Clés | Scope | Ajouté dans |
|---|---|---|---|
| `tour.*`        | ~20 | Product tour Billetterie (ProductTour + ticketing-v1) | [tours.ts](../frontend/lib/tour/tours.ts) |
| `tip.*`         | ~6  | Astuces contextuelles post-aha (ContextualTip)        | [PageSellTicket.tsx](../frontend/components/pages/PageSellTicket.tsx) |
| `billing.*`     | ~20 | Trial banner + checkout modal                         | [TrialBanner.tsx](../frontend/components/billing/TrialBanner.tsx) |
| `tenantRules.*` | ~60 | Règles métier (annulation N-tiers, no-show, compensation, hub) | [PageTenantBusinessRules.tsx](../frontend/components/pages/PageTenantBusinessRules.tsx) — ajouté 2026-04-19 |
| `vouchers.*`    | ~30 | Page admin Vouchers (émission, filtrage, annulation)  | [PageVouchers.tsx](../frontend/components/pages/PageVouchers.tsx) — ajouté 2026-04-19 |
| `nav.business_rules`, `nav.vouchers` | 2 | Entrées nav admin | [nav.config.ts](../frontend/lib/navigation/nav.config.ts) — ajouté 2026-04-19 |
| `platformKpi.*` | ~80 | Dashboard KPI SaaS plateforme (7 sections : North Star, MRR, retention, transactional, adoption détaillée, activation, strategic) | [fr.ts](../frontend/lib/i18n/locales/fr.ts), [en.ts](../frontend/lib/i18n/locales/en.ts) — ajouté 2026-04-20 |

Total : **~220 clés** × 6 locales = ~1320 lignes à ajouter.

## Locales à mettre à jour

- [frontend/lib/i18n/locales/es.ts](../frontend/lib/i18n/locales/es.ts) — Español
- [frontend/lib/i18n/locales/pt.ts](../frontend/lib/i18n/locales/pt.ts) — Português
- [frontend/lib/i18n/locales/ar.ts](../frontend/lib/i18n/locales/ar.ts) — العربية (RTL)
- [frontend/lib/i18n/locales/wo.ts](../frontend/lib/i18n/locales/wo.ts) — Wolof
- [frontend/lib/i18n/locales/ln.ts](../frontend/lib/i18n/locales/ln.ts) — Lingala
- [frontend/lib/i18n/locales/ktu.ts](../frontend/lib/i18n/locales/ktu.ts) — Kituba

## Source de vérité

Les valeurs FR (master) sont à la fin de [frontend/lib/i18n/locales/fr.ts](../frontend/lib/i18n/locales/fr.ts) dans les 3 blocs `"tour": { ... }`, `"tip": { ... }`, `"billing": { ... }` (juste avant `export default fr`).

L'équivalent EN est dans [frontend/lib/i18n/locales/en.ts](../frontend/lib/i18n/locales/en.ts) au même emplacement — utile pour vérifier le ton.

## Conventions à respecter (héritées des namespaces précédents)

- **Clés EXACTES** — copier les noms de clés tels quels depuis `fr.ts` (ne rien renommer).
- **Placeholders** à préserver verbatim : `{n}`, `{plan}`, `{price}`, `{currency}` (utilisés dans `billing.*`).
- **Termes préservés** : `TransLog Pro`, `Mobile Money`, `MTN`, `Airtel`, `Orange`, `Wave`, `Visa`, `Mastercard`, `FCFA`, `XOF`, `XAF`, `USD`.
- **Arabic** : garder les placeholders Latin (ex: `{n}`), pas de markers RTL dans les strings (le `dir="rtl"` est appliqué au DOM).
- **Wolof / Lingala / Kituba** : suivre le style mixte déjà présent dans ces fichiers — emprunts français OK pour les termes techniques SaaS (caissier, chauffeur, régulateur, abonnement, promotion, mot de passe, configuration) tout en gardant la grammaire Wolof/Lingala/Kituba. S'inspirer des namespaces `onb` et `signup` déjà traduits dans ces mêmes fichiers.

## Méthode recommandée

Déléguer à un subagent i18n en une passe :

> Prompt type : "Ajoute `tour`, `tip`, `billing` namespaces (copie depuis fr.ts bloc par bloc) dans les 6 locales [...] en respectant les conventions du fichier TODO_i18n_propagation.md."

Vérification rapide après chaque édit : `grep -c '"tour":\|"tip":\|"billing":' <file>` doit rendre 3 pour chacun des 6 fichiers.

Build final : `cd frontend && npx vite build 2>&1 | tail -3` — doit rester à `✓ built in ~18s` sans erreur TS.

## Priorité

- **Haute** : `billing.*` (vu par **tous** les tenants en trial, quelle que soit leur langue — UX dégradée en français pour un admin arabophone)
- **Moyenne** : `tour.*` (vu à la 1re visite de la billetterie — impact fort mais unique)
- **Basse** : `tip.*` (apparition one-shot par action)

Si on doit ne faire qu'un namespace, faire `billing.*` en priorité.

## Coût estimé

- Fluide (es/pt/ar) : ~15 min/locale
- Mixte (wo/ln/ktu) : ~25 min/locale (borrowing décisions)
- **Total : ~2h** avec un agent, ~4h manuellement
