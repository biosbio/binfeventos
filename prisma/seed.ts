import { authenticator } from "otplib";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/shared/lib/security";
import { PERMISSIONS, SYSTEM_ROLES } from "../src/shared/permissions";

// ============================================================
// Seed: permissões + papéis + prestadores + admin local.
// Executar: npm run db:seed
// ============================================================

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // 1. Permissões (catálogo é fonte única de verdade)
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

  // 2. Papéis de sistema
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

  // 3. Prestadores
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

  // Sandbox: webhookSecret vem de env em deploy real (nunca hardcoded)
  const sandboxSecret = process.env.SANDBOX_WEBHOOK_SECRET ?? "dev-only-secret";
  await prisma.paymentProvider.upsert({
    where: { code: "sandbox" },
    update: {},
    create: {
      code: "sandbox",
      name: "Sandbox (desenvolvimento)",
      country: "GLOBAL",
      isActive: true,
      adapterConfig: { webhookSecret: sandboxSecret },
    },
  });

  // 4. Administrador central inicial (apenas local/dev)
  // SEC-01: MFA obrigatório para admin — com segredo TOTP REAL.
  // (Bug corrigido: mfaEnabled sem mfaSecret tornava o login impossível.)
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@binf.local";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "ChangeMe!2026";
  const adminSecret = authenticator.generateSecret();

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      fullName: "Administrador da Plataforma",
      email: adminEmail,
      passwordHash: await hashPassword(adminPassword),
      mfaEnabled: true,
      mfaSecret: adminSecret,
      status: "ACTIVE",
    },
  });

  const otpauthUrl = authenticator.keyuri(adminEmail, "BINF EVENTOS", adminSecret);
  console.log(`Seed concluído. Admin local: ${adminEmail}`);
  console.log(`Admin MFA (registe na sua app autenticadora — apenas DEV):`);
  console.log(otpauthUrl);
  console.log(
    "AVISO: em produção, criar o admin por fluxo próprio com MFA interativo; " +
      "nunca imprimir segredos na consola."
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
