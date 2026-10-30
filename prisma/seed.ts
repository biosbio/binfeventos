import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/shared/lib/security";
import { PERMISSIONS, SYSTEM_ROLES } from "../src/shared/permissions";

// ============================================================
// Seed: permissões + papéis de sistema + prestador CASH + admin.
// Executar: npm run db:seed
// ============================================================

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // 1. Permissões (upsert — catálogo é fonte única de verdade)
  for (const perm of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: perm.code },
      update: { domain: perm.domain, description: perm.description },
      create: {
        code: perm.code,
        domain: perm.domain,
        description: perm.description,
      },
    });
  }

  // 2. Papéis de sistema (isSystem=true, organizationId=null)
  for (const [roleName, permCodes] of Object.entries(SYSTEM_ROLES)) {
    const role = await prisma.role.upsert({
      where: { name_organizationId: { name: roleName, organizationId: null } },
      update: {},
      create: { name: roleName, isSystem: true, organizationId: null },
    });

    for (const code of permCodes) {
      const perm = await prisma.permission.findUnique({ where: { code } });
      if (!perm) {
        throw new Error(`Permissão não encontrada no seed: ${code}`);
      }
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: role.id, permissionId: perm.id },
        },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
  }

  // 3. Prestador CASH (bilheteira física; sem chaves externas)
  await prisma.paymentProvider.upsert({
    where: { code: "cash" },
    update: {},
    create: {
      code: "cash",
      name: "Dinheiro (bilheteira física)",
      country: "GLOBAL",
      isActive: true,
    },
  });

  // 4. Administrador central inicial (apenas local/dev)
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@binf.local";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "ChangeMe!2026";

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      fullName: "Administrador da Plataforma",
      email: adminEmail,
      passwordHash: await hashPassword(adminPassword),
      mfaEnabled: true, // SEC-01: MFA obrigatório para admin central
      status: "ACTIVE",
    },
  });

  console.log(`Seed concluído. Admin local: ${admin.email}`);
  console.log("AVISO: em produção, definir ADMIN_EMAIL/ADMIN_PASSWORD e alterar a password inicial.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
