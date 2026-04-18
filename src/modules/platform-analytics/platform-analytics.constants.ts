/**
 * Paramètres de calcul du TenantHealthScore (0-100).
 *
 * Le score agrège 4 composantes. Chacune est un ratio "1 - (n / seuil)" clampé
 * entre 0 et 1, multiplié par son poids. La somme des poids = 100.
 *
 * Ces valeurs sont des choix d'ingénierie (pas métier) — elles pilotent une
 * heuristique interne et ne nécessitent pas de configuration DB. Si un jour
 * le besoin de tuning par tenant ou par plan émerge, on les déplacera vers
 * `TenantConfig` ou `Plan.sla` — pas de hardcoding caché : tout est ici.
 */
export const HEALTH_SCORE = {
  // Dégradation linéaire : n incidents ouverts → composante 0 quand n ≥ seuil.
  thresholds: {
    incidents: 10,   // plus de 10 incidents ouverts = 0 sur uptime
    tickets:   5,    // plus de 5 tickets support en attente = 0 sur support
    dlqEvents: 5,    // plus de 5 événements DLQ = 0 sur fiabilité événementielle
  },
  // Pondération des composantes (total = 100).
  weights: {
    uptime:     40,
    support:    20,
    dlq:        20,
    engagement: 20,
  },
  // Tenants dont le score est sous ce seuil sont listés comme "à risque".
  riskThreshold: 60,
} as const;

/**
 * Fenêtre de calcul des agrégats DAU/MAU. Utilisée par le cron quotidien.
 */
export const ACTIVITY_WINDOWS = {
  dauDays:   1,
  wauDays:   7,
  mauDays:   30,
  trendDays: 30,
} as const;
