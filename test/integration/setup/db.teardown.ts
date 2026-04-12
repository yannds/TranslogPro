/**
 * globalTeardown — Jest Integration
 *
 * Stoppe le container PostgreSQL démarré dans db.setup.ts.
 * Le container ID est lu depuis le fichier d'état temporaire.
 *
 * Note : Ryuk (Testcontainers daemon) stopperait le container
 * de toute façon à la fin du processus, mais un arrêt explicite
 * est plus propre et libère les ressources plus rapidement.
 */

import * as fs from 'fs';
import * as path from 'path';

const CONTAINER_STATE_FILE = path.join(__dirname, '.container-state.json');

export default async function globalTeardown() {
  if (!fs.existsSync(CONTAINER_STATE_FILE)) return;

  try {
    const state = JSON.parse(fs.readFileSync(CONTAINER_STATE_FILE, 'utf8'));
    fs.unlinkSync(CONTAINER_STATE_FILE);

    // Ryuk gère le cleanup automatique — on log juste
    console.log(`\n[Integration Teardown] Container ${state.containerId?.slice(0, 12)} will be cleaned by Ryuk.`);
  } catch {
    // Ignoré — Ryuk assure le cleanup
  }
}
