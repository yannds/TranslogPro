/**
 * Constantes de temps partagées — évite les magic numbers dispersés.
 * À utiliser plutôt que `86_400_000` ou `60 * 60 * 1000` inline.
 */
export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR   = 60 * MS_PER_MINUTE;
export const MS_PER_DAY    = 24 * MS_PER_HOUR;
