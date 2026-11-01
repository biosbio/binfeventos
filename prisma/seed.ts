import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/shared/lib/security";
import { PERMISSIONS, SYSTEM_ROLES } from "../src/shared/permissions";

// Seed: permissões, papéis, prestadores, administrador e organização inicial.
const prisma = new PrismaClient();

async function main(): Promise<void> {
  for (const perm of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: perm.code },
      update: { domain: perm.domain, description: perm.description },
      create: { code: perm.code, domain: perm.domain, description: perm.description },
    });
  }

  const systemRoles = new Map<string, string>();
  for (const [roleName, permCodes] of Object.entries(SYSTEM_ROLES)) {
    const existingRole = await prisma.role.findFirst({
      where: { name: roleName, organizationId: null, isSystem: true },
      select: { id: true },
    });
    const role = existingRole ?? await prisma.role.create({
      data: { name: roleName, isSystem: true, organizationId: null },
      select: { id: true },
    });
    systemRoles.set(roleName, role.id);

    for (const code of permCodes) {
      const perm = await prisma.permission.findUnique({ where: { code } });
      if (!perm) throw new Error(`Permissão não encontrada no seed: ${code}`);
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
  }

  await prisma.paymentProvider.upsert({
    where: { code: "cash" },
    update: {},
    create: { code: "cash", name: "Dinheiro (bilheteira física)", country: "GLOBAL", isActive: true },
  });

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

  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@binf.local";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "ChangeMe!2026";
  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
    select: { id: true },
  });
  const adminSecret = process.env.ADMIN_MFA_SECRET;
  if (!existingAdmin && !adminSecret) {
    throw new Error("Defina ADMIN_MFA_SECRET no .env antes de criar o administrador. Não partilhe esse segredo.");
  }

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      fullName: "Administrador da Plataforma",
      email: adminEmail,
      passwordHash: await hashPassword(adminPassword),
      mfaEnabled: true,
      mfaSecret: adminSecret!,
      status: "ACTIVE",
    },
    select: { id: true },
  });

  // O administrador inicial também precisa de uma organização ativa e de
  // uma associação ORG_ADMIN para aceder ao painel e gerir eventos.
  const organization = await prisma.organization.upsert({
    where: { slug: "binf-eventos" },
    update: {},
    create: {
      name: "BINF EVENTOS",
      slug: "binf-eventos",
      country: "GW",
      currency: "XOF",
      status: "ACTIVE",
    },
    select: { id: true },
  });

  const orgAdminRoleId = systemRoles.get("ORG_ADMIN");
  if (!orgAdminRoleId) throw new Error("Papel ORG_ADMIN não foi criado.");
  await prisma.orgMembership.upsert({
    where: {
      organizationId_userId: { organizationId: organization.id, userId: admin.id },
    },
    update: { roleId: orgAdminRoleId, acceptedAt: new Date() },
    create: {
      organizationId: organization.id,
      userId: admin.id,
      roleId: orgAdminRoleId,
      acceptedAt: new Date(),
    },
  });

  console.log(`Seed concluído. Administrador associado à organização BINF EVENTOS: ${adminEmail}`);
  console.log("MFA existente preservado; nenhum segredo MFA é apresentado na consola.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
