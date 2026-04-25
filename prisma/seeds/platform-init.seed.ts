/**
 * prisma/seeds/platform-init.seed.ts — Seed PROD minimal.
 *
 * Crée UNIQUEMENT le super-admin plateforme dans le tenant __platform__.
 * À lancer une fois après iam.seed.ts.
 *
 * Lecture des credentials via env vars :
 *   PLATFORM_SUPERADMIN_EMAIL    (default: yannds.test@gmail.com)
 *   PLATFORM_SUPERADMIN_NAME     (default: Super Admin)
 *   PLATFORM_SUPERADMIN_PASSWORD (REQUIS — pas de défaut, sinon le user crash)
 *
 * Idempotent : upsert User + Account credential. Re-run safe.
 *
 * Usage :
 *   PLATFORM_SUPERADMIN_EMAIL=admin@toto.com \
 *   PLATFORM_SUPERADMIN_PASSWORD='MotDePasseFort!23' \
 *   npx tsx prisma/seeds/platform-init.seed.ts
 */

import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000';

async function main() {
  const email    = process.env.PLATFORM_SUPERADMIN_EMAIL    || 'yannds.test@gmail.com';
  const name     = process.env.PLATFORM_SUPERADMIN_NAME     || 'Super Admin';
  const password = process.env.PLATFORM_SUPERADMIN_PASSWORD;

  if (!password || password.length < 8) {
    console.error('❌ PLATFORM_SUPERADMIN_PASSWORD requis (≥ 8 caractères)');
    process.exit(1);
  }

  // 1. Vérifier que le tenant plateforme existe (créé par iam.seed)
  const platformTenant = await prisma.tenant.findUnique({ where: { id: PLATFORM_TENANT_ID } });
  if (!platformTenant) {
    console.error(`❌ Tenant plateforme (${PLATFORM_TENANT_ID}) introuvable. Lance d'abord iam.seed.ts.`);
    process.exit(1);
  }

  // 2. Trouver le rôle SUPER_ADMIN
  const role = await prisma.role.findUnique({
    where: { tenantId_name: { tenantId: PLATFORM_TENANT_ID, name: 'SUPER_ADMIN' } },
  });
  if (!role) {
    console.error('❌ Role SUPER_ADMIN introuvable. Lance d\'abord iam.seed.ts.');
    process.exit(1);
  }

  // 3. Upsert User
  const user = await prisma.user.upsert({
    where:  { tenantId_email: { tenantId: PLATFORM_TENANT_ID, email } },
    update: { name, roleId: role.id, userType: 'STAFF' },
    create: { email, name, tenantId: PLATFORM_TENANT_ID, roleId: role.id, userType: 'STAFF' },
  });

  // 4. Upsert Account (credential provider)
  const hash = await bcrypt.hash(password, 12);
  await prisma.account.upsert({
    where:  {
      tenantId_providerId_accountId: { tenantId: PLATFORM_TENANT_ID, providerId: 'credential', accountId: email },
    },
    update: { password: hash },
    create: {
      tenantId:   PLATFORM_TENANT_ID,
      userId:     user.id,
      providerId: 'credential',
      accountId:  email,
      password:   hash,
    },
  });

  console.log(`✅ Super-admin plateforme créé/mis à jour :`);
  console.log(`   Email : ${email}`);
  console.log(`   Tenant: __platform__ (${PLATFORM_TENANT_ID})`);
  console.log(`   Role  : SUPER_ADMIN (${role.id})`);
  console.log(`   ID    : ${user.id}`);
  console.log(``);
  console.log(`Login URL : https://admin.translog.dsyann.info/login`);
}

main()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
