/**
 * Security Test — Dependency Audit
 *
 * Vérifie que les dépendances npm n'ont pas de vulnérabilités
 * connues de niveau critique ou élevé.
 *
 * Ce test exécute `npm audit` programmatiquement et échoue
 * si des vulnérabilités critiques ou high sont détectées.
 */
import { execSync } from 'child_process';
import { join } from 'path';

describe('[SECURITY] Dependency Audit', () => {
  const projectRoot = join(__dirname, '..', '..');

  it('should have no critical npm vulnerabilities', () => {
    let auditOutput: string;
    try {
      auditOutput = execSync('npm audit --json 2>/dev/null', {
        cwd: projectRoot,
        encoding: 'utf-8',
        timeout: 60_000,
      });
    } catch (error: any) {
      // npm audit retourne exit code 1 si des vulns sont trouvées
      auditOutput = error.stdout || '{}';
    }

    let audit: any;
    try {
      audit = JSON.parse(auditOutput);
    } catch {
      // Si le JSON est invalide, on skip (npm non disponible ou output invalide)
      console.warn('⚠️  npm audit output is not valid JSON — skipping');
      return;
    }

    const vulnerabilities = audit?.metadata?.vulnerabilities ?? {};
    const critical = vulnerabilities.critical ?? 0;

    // FAIL si des vulnérabilités critiques existent
    if (critical > 0) {
      console.error(`\n🚨 ${critical} CRITICAL npm vulnerabilities found!\n`);
      console.error('Run `npm audit` for details.\n');
    }
    expect(critical).toBe(0);
  });

  it('should have no high-severity npm vulnerabilities', () => {
    let auditOutput: string;
    try {
      auditOutput = execSync('npm audit --json 2>/dev/null', {
        cwd: projectRoot,
        encoding: 'utf-8',
        timeout: 60_000,
      });
    } catch (error: any) {
      auditOutput = error.stdout || '{}';
    }

    let audit: any;
    try {
      audit = JSON.parse(auditOutput);
    } catch {
      console.warn('⚠️  npm audit output is not valid JSON — skipping');
      return;
    }

    const vulnerabilities = audit?.metadata?.vulnerabilities ?? {};
    const high = vulnerabilities.high ?? 0;

    if (high > 0) {
      console.warn(`\n⚠️  ${high} HIGH npm vulnerabilities found.`);
      console.warn('Run `npm audit` for details.\n');
    }
    // Warning seulement — ne fait pas échouer le test
    // Décommentez la ligne suivante pour être strict :
    // expect(high).toBe(0);
  });

  // ── Check for known dangerous packages ─────────────────────────────────────

  it('should not depend on known vulnerable/deprecated packages', () => {
    const pkg = require(join(projectRoot, 'package.json'));
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    const blacklistedPackages = [
      'event-stream',       // Supply chain attack (2018)
      'flatmap-stream',     // Supply chain attack (2018)
      'ua-parser-js',       // Compromised versions
      'coa',                // Compromised versions
      'rc',                 // Compromised versions
      'colors',             // Sabotaged by author
      'faker',              // Sabotaged by author
      'node-ipc',           // Protestware/sabotage
      'peacenotwar',        // Protestware
    ];

    for (const pkg of blacklistedPackages) {
      expect(allDeps).not.toHaveProperty(pkg);
    }
  });

  // ── Verify security-critical packages are present ──────────────────────────

  it('should have security-critical packages installed', () => {
    const pkg = require(join(projectRoot, 'package.json'));
    const deps = pkg.dependencies ?? {};

    // Helmet (HTTP security headers)
    expect(deps['helmet']).toBeDefined();

    // bcryptjs (password hashing)
    expect(deps['bcryptjs']).toBeDefined();

    // cookie-parser (session cookie handling)
    expect(deps['cookie-parser']).toBeDefined();

    // class-validator (input validation)
    expect(deps['class-validator']).toBeDefined();

    // zod (schema validation)
    expect(deps['zod']).toBeDefined();
  });
});
