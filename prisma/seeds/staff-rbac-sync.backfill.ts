/**
 * Staff RBAC Sync Backfill — Phase 4 du chantier "cohérence RH/IAM".
 *
 * Objectifs (idempotent, dry-run par défaut) :
 *   1. Détecter tous les User(userType='STAFF') sans row Staff.
 *      → Créer Staff + StaffAssignment ACTIVE primaire alignée sur le rôle IAM.
 *   2. Détecter tous les Staff sans StaffAssignment ACTIVE.
 *      → Créer un assignment primaire à partir du User.role.name.
 *   3. Détecter les désalignements (User.role.name ≠ primary StaffAssignment.role).
 *      → ARBITRAGE PAR DÉFAUT : IAM gagne (le rôle User.role écrase l'assignment).
 *      → Override possible avec --prefer-rh (l'assignment écrase User.roleId).
 *
 * Exclusions :
 *   - userType='CUSTOMER' ou 'ANONYMOUS' (ne sont pas du personnel)
 *   - Roles externes 'CUSTOMER' et 'PUBLIC_REPORTER' (jamais de Staff)
 *
 * Usage :
 *   npx ts-node prisma/seeds/staff-rbac-sync.backfill.ts            # dry-run
 *   npx ts-node prisma/seeds/staff-rbac-sync.backfill.ts --apply    # exécution
 *   npx ts-node prisma/seeds/staff-rbac-sync.backfill.ts --apply --prefer-rh
 *   npx ts-node prisma/seeds/staff-rbac-sync.backfill.ts --tenant=<id>
 *
 * Voir docs/STAFF_RBAC_SYNC.md.
 */

import { PrismaClient } from '@prisma/client';

const EXTERNAL_ROLES = new Set(['CUSTOMER', 'PUBLIC_REPORTER']);

interface BackfillReport {
  tenantsScanned:        number;
  staffCreated:          number;
  assignmentsCreated:    number;
  iamWonRealignments:    number;  // User.role est resté, assignment a été aligné
  rhWonRealignments:     number;  // assignment.role est resté, User.roleId a été aligné
  skippedNoTargetRole:   number;
  skippedExternalRole:   number;
  skippedRoleNotFound:   number;
  errors:                Array<{ context: string; message: string }>;
}

interface BackfillOptions {
  apply:     boolean;
  preferRh:  boolean;
  tenantId?: string;
}

function parseArgs(): BackfillOptions {
  const argv = process.argv.slice(2);
  const tenantArg = argv.find(a => a.startsWith('--tenant='));
  return {
    apply:    argv.includes('--apply'),
    preferRh: argv.includes('--prefer-rh'),
    tenantId: tenantArg ? tenantArg.split('=')[1] : undefined,
  };
}

async function backfillTenant(
  prisma: PrismaClient,
  tenantId: string,
  opts: BackfillOptions,
  report: BackfillReport,
) {
  // ── 1. Users staff orphelins (sans Staff) ──────────────────────────────────
  const orphanUsers = await prisma.user.findMany({
    where: {
      tenantId,
      userType:     'STAFF',
      staffProfile: null,
    },
    select: {
      id:       true,
      email:    true,
      agencyId: true,
      role:     { select: { id: true, name: true } },
    },
  });

  for (const user of orphanUsers) {
    const roleName = user.role?.name;
    if (!roleName) {
      report.skippedNoTargetRole++;
      console.log(`  [skip] ${user.email} : pas de Role IAM`);
      continue;
    }
    if (EXTERNAL_ROLES.has(roleName)) {
      report.skippedExternalRole++;
      console.log(`  [skip] ${user.email} : rôle externe ${roleName}`);
      continue;
    }

    console.log(`  [orphan-user] ${user.email} role=${roleName} agency=${user.agencyId ?? 'tenant-wide'}`);
    if (opts.apply) {
      const staff = await prisma.staff.create({
        data: { tenantId, userId: user.id, agencyId: user.agencyId, status: 'ACTIVE' },
      });
      await prisma.staffAssignment.create({
        data: {
          staffId:  staff.id,
          role:     roleName,
          agencyId: user.agencyId,
          status:   'ACTIVE',
        },
      });
    }
    report.staffCreated++;
    report.assignmentsCreated++;
  }

  // ── 2. Staff sans StaffAssignment ACTIVE ───────────────────────────────────
  const staffWithoutActive = await prisma.staff.findMany({
    where: {
      tenantId,
      assignments: { none: { status: 'ACTIVE' } },
    },
    select: {
      id:       true,
      agencyId: true,
      user:     {
        select: {
          email: true,
          role:  { select: { name: true } },
        },
      },
    },
  });

  for (const staff of staffWithoutActive) {
    const roleName = staff.user.role?.name;
    if (!roleName) {
      report.skippedNoTargetRole++;
      console.log(`  [skip] staff=${staff.id} (${staff.user.email}) : pas de Role IAM`);
      continue;
    }
    if (EXTERNAL_ROLES.has(roleName)) {
      report.skippedExternalRole++;
      continue;
    }

    console.log(`  [staff-no-asg] ${staff.user.email} role=${roleName}`);
    if (opts.apply) {
      await prisma.staffAssignment.create({
        data: {
          staffId:  staff.id,
          role:     roleName,
          agencyId: staff.agencyId,
          status:   'ACTIVE',
        },
      });
    }
    report.assignmentsCreated++;
  }

  // ── 3. Désalignements User.role ↔ primary StaffAssignment.role ─────────────
  const allActiveStaff = await prisma.staff.findMany({
    where: { tenantId, status: 'ACTIVE' },
    select: {
      id:     true,
      userId: true,
      user:   {
        select: {
          email:  true,
          roleId: true,
          role:   { select: { id: true, name: true } },
        },
      },
      assignments: {
        where:   { status: 'ACTIVE' },
        orderBy: { startDate: 'desc' },
        take:    1,
        select:  { id: true, role: true },
      },
    },
  });

  for (const staff of allActiveStaff) {
    const primary = staff.assignments[0];
    if (!primary) continue; // déjà géré en (2)
    const userRoleName = staff.user.role?.name;
    if (!userRoleName) continue;
    if (EXTERNAL_ROLES.has(userRoleName) || EXTERNAL_ROLES.has(primary.role)) continue;
    if (userRoleName === primary.role) continue; // aligné

    if (opts.preferRh) {
      // Stratégie RH gagne : aligner User.roleId sur le primary.role.
      const targetRole = await prisma.role.findFirst({
        where:  { tenantId, name: primary.role },
        select: { id: true },
      });
      if (!targetRole) {
        report.skippedRoleNotFound++;
        console.log(`  [skip] ${staff.user.email} : Role IAM '${primary.role}' introuvable`);
        continue;
      }
      console.log(`  [realign-rh] ${staff.user.email} : User.role '${userRoleName}' → '${primary.role}'`);
      if (opts.apply) {
        await prisma.user.update({
          where: { id: staff.userId },
          data:  { roleId: targetRole.id },
        });
      }
      report.rhWonRealignments++;
    } else {
      // Stratégie IAM gagne (défaut) : aligner primary.role sur User.role.name.
      console.log(`  [realign-iam] ${staff.user.email} : assignment '${primary.role}' → '${userRoleName}'`);
      if (opts.apply) {
        await prisma.staffAssignment.update({
          where: { id: primary.id },
          data:  { role: userRoleName },
        });
      }
      report.iamWonRealignments++;
    }
  }
}

async function main() {
  const opts = parseArgs();
  const prisma = new PrismaClient();

  const report: BackfillReport = {
    tenantsScanned:      0,
    staffCreated:        0,
    assignmentsCreated:  0,
    iamWonRealignments:  0,
    rhWonRealignments:   0,
    skippedNoTargetRole: 0,
    skippedExternalRole: 0,
    skippedRoleNotFound: 0,
    errors:              [],
  };

  console.log('━'.repeat(70));
  console.log(`Staff RBAC Sync Backfill — mode=${opts.apply ? 'APPLY' : 'DRY-RUN'} arbitrage=${opts.preferRh ? 'RH-WINS' : 'IAM-WINS'}`);
  if (opts.tenantId) console.log(`Tenant scope: ${opts.tenantId}`);
  console.log('━'.repeat(70));

  try {
    const tenants = opts.tenantId
      ? [{ id: opts.tenantId }]
      : await prisma.tenant.findMany({ select: { id: true } });

    for (const t of tenants) {
      console.log(`\n▸ Tenant ${t.id}`);
      try {
        await backfillTenant(prisma, t.id, opts, report);
        report.tenantsScanned++;
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        report.errors.push({ context: `tenant ${t.id}`, message });
        console.error(`  [error] ${message}`);
      }
    }

    console.log('\n' + '━'.repeat(70));
    console.log('RAPPORT');
    console.log('━'.repeat(70));
    console.log(`Tenants scannés                : ${report.tenantsScanned}`);
    console.log(`Staff créés (orphelins User)   : ${report.staffCreated}`);
    console.log(`Assignments créés              : ${report.assignmentsCreated}`);
    console.log(`Désalignements IAM gagne       : ${report.iamWonRealignments}`);
    console.log(`Désalignements RH gagne        : ${report.rhWonRealignments}`);
    console.log(`Skippés (pas de role cible)    : ${report.skippedNoTargetRole}`);
    console.log(`Skippés (role externe)         : ${report.skippedExternalRole}`);
    console.log(`Skippés (role IAM introuvable) : ${report.skippedRoleNotFound}`);
    if (report.errors.length > 0) {
      console.log(`\nErreurs : ${report.errors.length}`);
      for (const err of report.errors) {
        console.log(`  [${err.context}] ${err.message}`);
      }
    }
    if (!opts.apply) {
      console.log(`\n⚠️  DRY-RUN : aucune modification écrite. Relancer avec --apply pour exécuter.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
