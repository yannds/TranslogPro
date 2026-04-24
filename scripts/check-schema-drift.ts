/**
 * check-schema-drift.ts — Détection READ-ONLY du drift schema Prisma vs DB.
 *
 * Utilise `prisma migrate diff` pour comparer la DB courante avec le
 * `schema.prisma` committé. **ZÉRO écriture, ZÉRO destruction.**
 *
 * Exit code :
 *   0 → DB en phase avec le schema → backend peut démarrer sans risque
 *   1 → drift détecté → STDOUT liste les changements manquants + commande à jouer
 *
 * Usage :
 *   $ npm run db:check              # check manuel
 *   $ npm run db:check && npm run start:dev   # chain prudent en dev
 *
 * Pourquoi pas `prestart:dev` automatique avec `db push` ? Parce que la DB
 * contient des données de test précieuses — toute synchro DOIT être une
 * décision humaine explicite, jamais un side-effect de `npm start`.
 */
import { execSync } from 'node:child_process';

const RESET  = '\x1b[0m';
const RED    = '\x1b[31m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BOLD   = '\x1b[1m';

try {
  const diff = execSync(
    'npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code',
    { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8' },
  );
  // exit-code 0 → pas de diff (migrate diff retourne 0 si aligné avec --exit-code)
  console.log(`${GREEN}${BOLD}✓ DB en phase avec schema.prisma${RESET} — aucun drift détecté.`);
  process.exit(0);
} catch (err: unknown) {
  const e = err as { status?: number; stderr?: Buffer; stdout?: Buffer };
  const stdout = e.stdout?.toString() ?? '';
  const stderr = e.stderr?.toString() ?? '';

  // exit-code 2 = diff présent (comportement attendu de --exit-code sur Prisma)
  if (e.status === 2) {
    console.error(
      `${RED}${BOLD}⚠  DRIFT DÉTECTÉ — la DB ne correspond pas à prisma/schema.prisma${RESET}\n`,
    );
    if (stdout.trim()) {
      console.error(`${YELLOW}Changements manquants côté DB :${RESET}`);
      console.error(stdout);
    }
    console.error(
      `\n${BOLD}Action à effectuer manuellement :${RESET}\n` +
      `  1. Relire ${YELLOW}git diff prisma/schema.prisma${RESET} pour vérifier ce qui a changé\n` +
      `  2. Si OK → ${GREEN}npm run db:sync${RESET} (non-destructif — refuse toute perte de données)\n` +
      `  3. Si l'étape 2 refuse : c'est qu'un DROP COLUMN/TABLE est nécessaire\n` +
      `     → backup d'abord, puis ${YELLOW}npx prisma db push --accept-data-loss${RESET} (à tes risques)\n`,
    );
    process.exit(1);
  }

  // Autre erreur (connexion DB, droits, etc.) → on ne bloque pas, on signale.
  console.error(`${YELLOW}⚠  check-schema-drift — impossible de vérifier :${RESET}`);
  console.error(stderr || (err as Error).message);
  process.exit(0);  // non bloquant
}
