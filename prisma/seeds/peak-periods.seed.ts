/**
 * Peak Periods Seed — calendriers saisonniers par défaut (Sprint 5).
 *
 * Seed **idempotent** des périodes peak pour un tenant donné, selon son pays.
 * Inclut :
 *   - Jours fériés communs (Noël, Nouvel An, fête du travail, fêtes locales)
 *   - Vacances scolaires / touristiques classiques
 *
 * Les facteurs `expectedDemandFactor` sont des valeurs métier conservatrices
 * (basées sur benchmarks secteur transport Afrique centrale). L'admin tenant
 * peut les affiner via PageTenantPeakPeriods.
 *
 * Appelé par :
 *   - `OnboardingService` (au provisioning, si country défini)
 *   - `pricing-defaults.backfill.ts` (rattrapage tenants existants)
 *   - Exécutable standalone : `npx ts-node prisma/seeds/peak-periods.seed.ts`
 */
import { PrismaClient } from '@prisma/client';

export interface PeakPeriodDef {
  code:                 string;
  label:                string;
  labelKey:             string;
  countryCode:          string | null; // null = universel (tous pays)
  /** YYYY-MM-DD, année remplacée dynamiquement selon le contexte. */
  startMonthDay:        string; // "12-20"
  endMonthDay:          string; // "01-05"
  expectedDemandFactor: number;
  isHoliday:            boolean;
}

/**
 * Catalogue de référence des périodes peak.
 * - Années futures générées dynamiquement (année courante + 1 et +2).
 * - Codes uniques par année pour éviter les collisions d'une saison à l'autre.
 */
const CATALOG: PeakPeriodDef[] = [
  // ── Universels (tous pays chrétiens/latins) ────────────────────────────
  { code: 'NEW_YEAR',       label: 'Nouvel An',              labelKey: 'peakPeriod.newYear',      countryCode: null,  startMonthDay: '12-28', endMonthDay: '01-05', expectedDemandFactor: 1.30, isHoliday: true  },
  { code: 'CHRISTMAS',      label: 'Noël',                   labelKey: 'peakPeriod.christmas',    countryCode: null,  startMonthDay: '12-20', endMonthDay: '12-27', expectedDemandFactor: 1.40, isHoliday: true  },
  { code: 'EASTER',         label: 'Pâques (semaine)',       labelKey: 'peakPeriod.easter',       countryCode: null,  startMonthDay: '04-01', endMonthDay: '04-10', expectedDemandFactor: 1.15, isHoliday: false },

  // ── Congo-Brazzaville (CG) ─────────────────────────────────────────────
  { code: 'CG_INDEPENDENCE',  label: 'Fête Indépendance CG',   labelKey: 'peakPeriod.cgIndep',     countryCode: 'CG',  startMonthDay: '08-13', endMonthDay: '08-17', expectedDemandFactor: 1.20, isHoliday: true  },
  { code: 'CG_WORK_DAY',      label: 'Fête du Travail',        labelKey: 'peakPeriod.workDay',     countryCode: 'CG',  startMonthDay: '04-30', endMonthDay: '05-02', expectedDemandFactor: 1.10, isHoliday: true  },
  { code: 'CG_SUMMER_BREAK',  label: 'Grandes vacances CG',    labelKey: 'peakPeriod.cgSummer',    countryCode: 'CG',  startMonthDay: '07-01', endMonthDay: '09-05', expectedDemandFactor: 1.20, isHoliday: false },

  // ── Sénégal (SN) ───────────────────────────────────────────────────────
  { code: 'SN_INDEPENDENCE',  label: 'Fête Indépendance SN',   labelKey: 'peakPeriod.snIndep',     countryCode: 'SN',  startMonthDay: '04-03', endMonthDay: '04-06', expectedDemandFactor: 1.20, isHoliday: true  },
  { code: 'SN_TABASKI',       label: 'Tabaski (approx)',       labelKey: 'peakPeriod.tabaski',     countryCode: 'SN',  startMonthDay: '06-15', endMonthDay: '06-20', expectedDemandFactor: 1.50, isHoliday: true  },

  // ── Côte d'Ivoire (CI) ─────────────────────────────────────────────────
  { code: 'CI_INDEPENDENCE',  label: 'Fête Indépendance CI',   labelKey: 'peakPeriod.ciIndep',     countryCode: 'CI',  startMonthDay: '08-06', endMonthDay: '08-09', expectedDemandFactor: 1.20, isHoliday: true  },
  { code: 'CI_SUMMER_BREAK',  label: 'Grandes vacances CI',    labelKey: 'peakPeriod.ciSummer',    countryCode: 'CI',  startMonthDay: '07-15', endMonthDay: '09-05', expectedDemandFactor: 1.20, isHoliday: false },

  // ── France (FR) ────────────────────────────────────────────────────────
  { code: 'FR_BASTILLE_DAY',  label: 'Fête Nationale FR',      labelKey: 'peakPeriod.frBastille',  countryCode: 'FR',  startMonthDay: '07-13', endMonthDay: '07-15', expectedDemandFactor: 1.25, isHoliday: true  },
  { code: 'FR_SUMMER_BREAK',  label: 'Grandes vacances FR',    labelKey: 'peakPeriod.frSummer',    countryCode: 'FR',  startMonthDay: '07-06', endMonthDay: '09-01', expectedDemandFactor: 1.30, isHoliday: false },

  // ── Creux typiques (factor < 1) ────────────────────────────────────────
  { code: 'JANUARY_LULL',    label: 'Creux de janvier',        labelKey: 'peakPeriod.januaryLull', countryCode: null,  startMonthDay: '01-10', endMonthDay: '02-15', expectedDemandFactor: 0.85, isHoliday: false },
];

/** Construit une date UTC à partir d'un jour-mois + année de référence. */
function mkDate(year: number, monthDay: string): Date {
  const [month, day] = monthDay.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export async function seedPeakPeriodsForTenant(
  client: PrismaClient,
  tenantId: string,
  country: string | null,
): Promise<{ created: number; skipped: number }> {
  const now = new Date();
  const years = [now.getUTCFullYear(), now.getUTCFullYear() + 1];

  let created = 0;
  let skipped = 0;

  for (const def of CATALOG) {
    // Skip si la période est propre à un pays différent de celui du tenant.
    // null = universel (toujours seedé).
    if (def.countryCode !== null && def.countryCode !== country) continue;

    for (const year of years) {
      // Gestion du passage d'année (Noël → Nouvel An peut chevaucher).
      const startYear = year;
      const start = mkDate(startYear, def.startMonthDay);
      let end = mkDate(startYear, def.endMonthDay);
      if (end < start) end = mkDate(startYear + 1, def.endMonthDay);

      const code = `${def.code}_${year}`;

      const existing = await client.peakPeriod.findUnique({
        where: { tenantId_code: { tenantId, code } },
      });
      if (existing) { skipped++; continue; }

      await client.peakPeriod.create({
        data: {
          tenantId,
          code,
          label:                `${def.label} ${year}`,
          labelKey:             def.labelKey,
          countryCode:          def.countryCode,
          startDate:            start,
          endDate:              end,
          expectedDemandFactor: def.expectedDemandFactor,
          isHoliday:            def.isHoliday,
          enabled:              true,
          isSystemDefault:      true,
        },
      });
      created++;
    }
  }

  return { created, skipped };
}

// ── Standalone run (rattrapage tenants existants) ─────────────────────────
if (require.main === module) {
  const prisma = new PrismaClient();
  (async () => {
    console.log('[peak-periods.seed] Démarrage…');
    const tenants = await prisma.tenant.findMany({
      select: { id: true, slug: true, country: true },
    });
    for (const t of tenants) {
      const r = await seedPeakPeriodsForTenant(prisma, t.id, t.country ?? null);
      console.log(`[peak-periods.seed] ${t.slug} (${t.country ?? '—'}) → créés ${r.created}, skippés ${r.skipped}`);
    }
    console.log('[peak-periods.seed] Terminé');
  })()
    .catch(err => { console.error('[peak-periods.seed] Échec :', err); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
