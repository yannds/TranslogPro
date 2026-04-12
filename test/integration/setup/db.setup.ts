/**
 * globalSetup — Jest Integration
 *
 * Mode automatique :
 *   1. Si Docker est accessible → démarre un container PostgreSQL (Testcontainers)
 *   2. Sinon               → utilise le PostgreSQL local sur le port 5432
 *
 * Dans les deux cas :
 *   - DATABASE_URL est injectée dans process.env
 *   - Le schéma Prisma est appliqué via `prisma db push`
 *   - Un fichier d'état temporaire permet au teardown de nettoyer proprement
 */

import { execSync }  from 'child_process';
import * as fs       from 'fs';
import * as path     from 'path';

const CONTAINER_STATE_FILE = path.join(__dirname, '.container-state.json');

// URL locale par défaut (PostgreSQL Homebrew, accès sans mot de passe)
const LOCAL_DB_URL = 'postgresql://postgres@localhost:5432/translogpro_test';

async function tryStartContainer(): Promise<string | null> {
  try {
    // Import dynamique — ne plante pas si Docker est absent
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    const container = await new PostgreSqlContainer('postgres:15-alpine')
      .withDatabase('translogpro_test')
      .withUsername('test_user')
      .withPassword('test_pass')
      .start();

    const url = container.getConnectionUri();
    fs.writeFileSync(
      CONTAINER_STATE_FILE,
      JSON.stringify({ mode: 'container', containerId: container.getId(), databaseUrl: url }),
    );
    console.log(`[Integration Setup] Testcontainers: ${container.getId().slice(0, 12)}`);
    return url;
  } catch {
    return null; // Docker absent ou inaccessible
  }
}

export default async function globalSetup() {
  console.log('\n[Integration Setup] Detecting runtime...');

  let databaseUrl = await tryStartContainer();

  if (!databaseUrl) {
    console.log('[Integration Setup] Docker unavailable — using local PostgreSQL.');
    databaseUrl = LOCAL_DB_URL;
    fs.writeFileSync(
      CONTAINER_STATE_FILE,
      JSON.stringify({ mode: 'local', databaseUrl }),
    );
  }

  process.env.DATABASE_URL = databaseUrl;
  console.log(`[Integration Setup] DATABASE_URL: ${databaseUrl}`);

  // Appliquer le schéma Prisma
  console.log('[Integration Setup] Pushing Prisma schema...');
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env:   { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  console.log('[Integration Setup] Schema ready.');

  // Vider les transitions entre runs pour éviter les faux-positifs d'idempotence
  execSync(`psql "${databaseUrl}" -c "TRUNCATE workflow_transitions CASCADE;"`, { stdio: 'pipe' });
  console.log('[Integration Setup] workflow_transitions truncated.\n');
}
