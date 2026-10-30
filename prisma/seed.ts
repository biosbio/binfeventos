import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/shared/lib/security";
import { PERMISSIONS, SYSTEM_ROLES } from "../src/shared/permissions";

// ============================================================
// Seed: permissões + papéis de sistema + administrador inicial.
// Executar: npm run db:seed
//
// IMPORTANTE: o email/password abaixo são para AMBIENTE LOCAL.
// Em produção, definir via variáveis de ambiente ADMIN_EMAIL/ADMIN_PASSWORD.
// ============================================================

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // 1. Permissões (upsert — catálogo é fonte única de verdade)
  for (const perm of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: perm.code },
      update: { description: perm.description },
      create: {
        code: perm.code,
        domain: perm.domain,
        // reutiliza a coluna domain para descrição curta no seed
      },
    });
    // Atualiza descrição via update dedicado (coluna description existe no modelo)
    await prisma.permission.update({
      where: { code: perm.code },
      data: { domain: perm.domain },
    });
  }

  // 2. Papéis de sistema (isSystem=true, organizationId=null)
  for (const [roleName, permCodes] of Object.entries(SYSTEM_ROLES)) {
    const role = await prisma.role.upsert({
      where: { name_organizationId: { name: roleName, organizationId: null } },
      update: {},
      create: { name: roleName, isSystem: true, organizationId: null },
    });

    // Vincula permissões ao papel (relação muitos-para-muitos)
    for (const code of permCodes) {
      const perm = await prisma.permission.findUnique({ where: { code } });
      if (!perm) {
        throw new Error(`Permissão não encontrada no seed: ${code}`);
      }
      const existing = await prisma.rolePermission.findFirst({
        where: { roleId: role.id, permissionId: perm.id },
      });
      if (!existing) {
        await prisma.rolePermission.create({
          data: { roleId: role.id, permissionId: perm.id },
        });
      }
    }
  }

  // 3. Administrador central inicial (apenas local/dev)
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@binf.local";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "ChangeMe!2026";

  const adminRole = await prisma.role.findFirst({
    where: { name: "PLATFORM_ADMIN", isSystem: true },
  });
  if (!adminRole) throw new Error("Papel PLATFORM_ADMIN não encontrado.");

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

  console.log(`Seed concluído. Admin local: ${adminEmail}`);
  console.log("AVISO: altere a password em produção (definir ADMIN_EMAIL/ADMIN_PASSWORD).");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
