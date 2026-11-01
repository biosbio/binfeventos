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

    // Sincroniza permissões: não conservar privilégios removidos do catálogo.
    await prisma.rolePermission.deleteMany({
      where: {
        roleId: role.id,
        permission: { code: { notIn: permCodes } },
      },
    });

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

  const sandboxSecret = process.env.SANDBOX_WEBHOOK_SECRET;
  if (!sandboxSecret || sandboxSecret.length < 32) {
    throw new Error("Defina SANDBOX_WEBHOOK_SECRET com pelo menos 32 caracteres no ambiente. Não use segredos predefinidos.");
  }
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
  const adminPassword = process.env.ADMIN_PASSWORD;
  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
    select: { id: true },
  });
  const adminSecret = process.env.ADMIN_MFA_SECRET;
  if (!existingAdmin && (!adminPassword || adminPassword.length < 12 || !adminSecret || adminSecret.length < 16)) {
    throw new Error("Para criar o administrador, defina ADMIN_PASSWORD (mínimo 12 caracteres) e ADMIN_MFA_SECRET no ambiente. Não use credenciais predefinidas nem partilhe esses segredos.");
  }

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { platformRole: "PLATFORM_ADMIN" },
    create: {
      fullName: "Administrador da Plataforma",
      platformRole: "PLATFORM_ADMIN",
      email: adminEmail,
      passwordHash: await hashPassword(adminPassword),
      mfaEnabled: true,
      mfaSecret: adminSecret!,
      status: "ACTIVE",
    },
    select: { id: true },
  });

  // Organização operacional inicial. O acesso administrativo à plataforma
  // é concedido separadamente por platformRole e continua protegido por MFA.
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

  // O administrador da plataforma não recebe associação automática de organizador.
  await prisma.orgMembership.deleteMany({
    where: { organizationId: organization.id, userId: admin.id },
  });

  console.log(`Seed concluído. Administrador da plataforma configurado: ${adminEmail}`);
  console.log("MFA existente preservado; nenhum segredo MFA é apresentado na consola.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
