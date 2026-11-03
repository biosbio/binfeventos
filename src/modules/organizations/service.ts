import { prisma } from "@/shared/lib/prisma";
import { AppError, BusinessRuleError, ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from "@/shared/errors";
import { writeAudit, assertOrgActive, sanitizeForAudit } from "@/shared/audit";
import { markPanelVerified, type AuthContext } from "@/shared/auth";
import { randomBytes } from "node:crypto";
import { rateLimit, sha256, verifyPassword } from "@/shared/lib/security";
import type { CreateOrgInput, InviteMemberInput } from "./schemas";

// ============================================================
// Módulo organizations — lógica de negócio.
// Regras:
// - Isolamento multiempresa OBRIGATÓRIO: toda consulta filtra por
//   organizationId e o contexto da sessão (SEC-02 ABAC).
// - O organizador recém-registado recebe apenas permissões de organizador;
//   a associação fica aceite automaticamente (é o próprio criador).
// - Convidar exige permissão org:invite; atribuir papel, org:role:assign.
// - Suspender organização exige dupla validação via admin central
//   (suspensão seletiva — regra especial de segurança nº 10).
// ============================================================

/** Cria organização e associa o criador como organizador (aceite por definição). */
export async function createOrganization(
  ctx: AuthContext,
  input: CreateOrgInput
): Promise<{ id: string; slug: string }> {
  const slugTaken = await prisma.organization.findUnique({ where: { slug: input.slug } });
  if (slugTaken) throw new ConflictError("Slug já utilizado.");

  const result = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: input.name,
        slug: input.slug,
        country: input.country,
        currency: input.currency,
        status: "ACTIVE",
      },
      select: { id: true, slug: true },
    });

    const organizerRole = await tx.role.findFirst({
      where: { name: "ORGANIZER", isSystem: true },
      select: { id: true },
    });
    if (!organizerRole) {
      throw new BusinessRuleError("Papel de organizador em falta — execute o seed.");
    }

    await tx.orgMembership.create({
      data: {
        organizationId: org.id,
        userId: ctx.userId,
        roleId: organizerRole.id,
        acceptedAt: new Date(), // criador não precisa de convite
      },
    });

    const activeSession = await tx.session.updateMany({
      where: {
        id: ctx.sessionId,
        userId: ctx.userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { organizationId: org.id, panelVerifiedUntil: null },
    });
    if (activeSession.count !== 1) throw new UnauthorizedError();

    return org;
  });

  await writeAudit({
    organizationId: result.id,
    actorUserId: ctx.userId,
    action: "org.created",
    after: sanitizeForAudit(input),
  });

  return result;
}

/** Cria a primeira organização e confirma o acesso do organizador com password. */
export async function onboardOrganizer(
  ctx: AuthContext,
  input: CreateOrgInput,
  password: string,
): Promise<{ id: string; slug: string }> {
  if (ctx.platformRole === "PLATFORM_ADMIN") {
    throw new ForbiddenError("platform-admin-uses-admin-panel");
  }
  if (ctx.organizationId || ctx.permissions.size > 0) {
    throw new ConflictError("Esta conta já está associada a uma organização.");
  }
  if (await rateLimit(`organizer-onboarding:${ctx.userId}`, 5, 15 * 60 * 1000)) {
    throw new AppError("RATE_LIMITED", 429, "Demasiadas tentativas. Aguarde quinze minutos.");
  }

  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { passwordHash: true },
  });
  if (!user || !(await verifyPassword(user.passwordHash, password))) {
    throw new UnauthorizedError();
  }

  const organization = await createOrganization(ctx, input);
  await markPanelVerified(ctx.sessionId);
  return organization;
}

/** Convida membro por email para a organização ativa do contexto. */
export async function inviteMember(
  ctx: AuthContext,
  input: InviteMemberInput
): Promise<{ membershipId: string; invitedEmail: string }> {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  if (input.roleName === "PLATFORM_ADMIN") {
    throw new ForbiddenError("platform-admin-role-cannot-be-assigned-to-members");
  }

  // Papel alvo pode ser de sistema OU da própria organização
  const role = await prisma.role.findFirst({
    where: {
      name: input.roleName,
      OR: [
        { isSystem: true },
        { organizationId: ctx.organizationId },
      ],
    },
    select: { id: true, isSystem: true, organizationId: true },
  });
  if (!role) throw new NotFoundError("Papel");
  // Papel de OUTRA organização não é atribuível (isolamento)
  if (!role.isSystem && role.organizationId !== ctx.organizationId) {
    throw new ForbiddenError("role-from-other-org");
  }

  // Utilizador convidado deve existir (contas criam-se por registo)
  const invitee = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (!invitee) {
    throw new BusinessRuleError(
      "Utilizador não encontrado. Peça-lhe para registar-se primeiro."
    );
  }

  const existing = await prisma.orgMembership.findUnique({
    where: { organizationId_userId: { organizationId: ctx.organizationId, userId: invitee.id } },
  });
  if (existing) throw new ConflictError("Utilizador já pertence à organização.");

  const membership = await prisma.orgMembership.create({
    data: {
      organizationId: ctx.organizationId,
      userId: invitee.id,
      roleId: role.id,
      acceptedAt: null, // pendente até o convite ser aceite
    },
    select: { id: true },
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "org.member_invited",
    after: { email: input.email, roleName: input.roleName },
  });

  // TODO (Domínio 10): notificar convidado (Notification + email)
  return { membershipId: membership.id, invitedEmail: input.email };
}

/** Aceita convite pendente (o próprio utilizador). */
export async function acceptInvitation(ctx: AuthContext, organizationId: string): Promise<void> {
  await prisma.orgMembership.update({
    where: { organizationId_userId: { organizationId, userId: ctx.userId } },
    data: { acceptedAt: new Date() },
  });
}

/** Altera o papel de um membro (exige org:role:assign — guard na rota). */
export async function assignRole(
  ctx: AuthContext,
  memberId: string,
  roleName: string
): Promise<void> {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  if (roleName === "PLATFORM_ADMIN") {
    throw new ForbiddenError("platform-admin-role-cannot-be-assigned-to-members");
  }

  const role = await prisma.role.findFirst({
    where: {
      name: roleName,
      OR: [{ isSystem: true }, { organizationId: ctx.organizationId }],
    },
    select: { id: true, isSystem: true, organizationId: true },
  });
  if (!role) throw new NotFoundError("Papel");
  if (!role.isSystem && role.organizationId !== ctx.organizationId) {
    throw new ForbiddenError("role-from-other-org");
  }

  // O filtro de organização faz parte da própria escrita. Nunca alterar
  // primeiro um membro de outra organização e só depois rejeitar a operação.
  const updated = await prisma.orgMembership.updateMany({
    where: { id: memberId, organizationId: ctx.organizationId },
    data: { roleId: role.id },
  });
  if (updated.count !== 1) throw new NotFoundError("Membro");

  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "org.member_role_changed",
    after: { memberId, roleName },
  });
}

/** Lista membros da organização ativa (isolamento garantido pelo ctx). */
export async function listMembers(ctx: AuthContext) {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  await assertOrgActive(ctx.organizationId);

  return prisma.orgMembership.findMany({
    where: { organizationId: ctx.organizationId },
    select: {
      id: true,
      invitedAt: true,
      acceptedAt: true,
      user: { select: { id: true, fullName: true, email: true, status: true } },
      role: { select: { name: true, isSystem: true } },
    },
    orderBy: { invitedAt: "asc" },
  });
}

export async function createBoxOfficeSellerInvite(ctx: AuthContext): Promise<{
  id: string;
  token: string;
  expiresAt: Date;
}> {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  await assertOrgActive(ctx.organizationId);

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const invite = await prisma.boxOfficeSellerInvite.create({
    data: {
      organizationId: ctx.organizationId,
      createdByUserId: ctx.userId,
      tokenHash: sha256(token),
      expiresAt,
    },
    select: { id: true, expiresAt: true },
  });
  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "org.boxoffice_seller_invite_created",
    after: { inviteId: invite.id, expiresAt },
  });
  return { ...invite, token };
}

export async function getBoxOfficeSellerInvite(token: string) {
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) throw new NotFoundError("Convite");
  const invite = await prisma.boxOfficeSellerInvite.findUnique({
    where: { tokenHash: sha256(token) },
    select: {
      id: true,
      organizationId: true,
      expiresAt: true,
      revokedAt: true,
      organization: { select: { name: true, status: true } },
    },
  });
  if (
    !invite ||
    invite.revokedAt ||
    invite.expiresAt <= new Date() ||
    invite.organization.status !== "ACTIVE"
  ) {
    throw new NotFoundError("Convite");
  }
  return { id: invite.id, organizationId: invite.organizationId, organizationName: invite.organization.name, expiresAt: invite.expiresAt };
}

export async function requestBoxOfficeSellerAccess(ctx: AuthContext, token: string): Promise<"pending" | "approved"> {
  const invite = await getBoxOfficeSellerInvite(token);
  const role = await prisma.role.findFirst({
    where: { name: "BOX_OFFICE_OPERATOR", isSystem: true, organizationId: null },
    select: { id: true },
  });
  if (!role) throw new BusinessRuleError("Papel de vendedor em falta — execute o seed.");

  const existing = await prisma.orgMembership.findUnique({
    where: { organizationId_userId: { organizationId: invite.organizationId, userId: ctx.userId } },
    select: { id: true, acceptedAt: true, role: { select: { name: true } } },
  });
  if (existing) {
    if (existing.role.name !== "BOX_OFFICE_OPERATOR") {
      throw new ConflictError("Já existe uma associação diferente com esta organização.");
    }
    return existing.acceptedAt ? "approved" : "pending";
  }

  await prisma.orgMembership.create({
    data: {
      organizationId: invite.organizationId,
      userId: ctx.userId,
      roleId: role.id,
      acceptedAt: null,
    },
  });
  await writeAudit({
    organizationId: invite.organizationId,
    actorUserId: ctx.userId,
    action: "org.boxoffice_seller_requested",
    after: { inviteId: invite.id },
  });
  return "pending";
}

export async function approveBoxOfficeSeller(ctx: AuthContext, memberId: string): Promise<void> {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  const result = await prisma.orgMembership.updateMany({
    where: {
      id: memberId,
      organizationId: ctx.organizationId,
      acceptedAt: null,
      role: { name: "BOX_OFFICE_OPERATOR", isSystem: true },
      user: { status: "ACTIVE" },
    },
    data: { acceptedAt: new Date() },
  });
  if (result.count !== 1) throw new NotFoundError("Pedido de vendedor");
  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "org.boxoffice_seller_approved",
    after: { memberId },
  });
}

export async function revokeBoxOfficeSeller(ctx: AuthContext, memberId: string): Promise<void> {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  const result = await prisma.orgMembership.deleteMany({
    where: {
      id: memberId,
      organizationId: ctx.organizationId,
      role: { name: "BOX_OFFICE_OPERATOR", isSystem: true },
    },
  });
  if (result.count !== 1) throw new NotFoundError("Vendedor");
  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "org.boxoffice_seller_revoked",
    after: { memberId },
  });
}

export async function revokeBoxOfficeSellerInvite(ctx: AuthContext, inviteId: string): Promise<void> {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  const result = await prisma.boxOfficeSellerInvite.updateMany({
    where: { id: inviteId, organizationId: ctx.organizationId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count !== 1) throw new NotFoundError("Link de convite");
  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "org.boxoffice_seller_invite_revoked",
    after: { inviteId },
  });
}
