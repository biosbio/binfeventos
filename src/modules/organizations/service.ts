import { prisma } from "@/shared/lib/prisma";
import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError } from "@/shared/errors";
import { writeAudit, assertOrgActive, sanitizeForAudit } from "@/shared/audit";
import type { AuthContext } from "@/shared/auth";
import type { CreateOrgInput, InviteMemberInput } from "./schemas";

// ============================================================
// Módulo organizations — lógica de negócio.
// Regras:
// - Isolamento multiempresa OBRIGATÓRIO: toda consulta filtra por
//   organizationId e o contexto da sessão (SEC-02 ABAC).
// - O criador torna-se ORG_ADMIN e a associação fica aceite
//   automaticamente (é o próprio criador).
// - Convidar exige permissão org:invite; atribuir papel, org:role:assign.
// - Suspender organização exige dupla validação via admin central
//   (suspensão seletiva — regra especial de segurança nº 10).
// ============================================================

/** Cria organização e torna o criador ORG_ADMIN (aceite por definição). */
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

    // Papel ORG_ADMIN (de sistema, reutilizável por todas as orgs)
    const adminRole = await tx.role.findFirst({
      where: { name: "ORG_ADMIN", isSystem: true },
      select: { id: true },
    });
    if (!adminRole) {
      throw new BusinessRuleError("Papel de sistema em falta — execute o seed.");
    }

    await tx.orgMembership.create({
      data: {
        organizationId: org.id,
        userId: ctx.userId,
        roleId: adminRole.id,
        acceptedAt: new Date(), // criador não precisa de convite
      },
    });

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

/** Convida membro por email para a organização ativa do contexto. */
export async function inviteMember(
  ctx: AuthContext,
  input: InviteMemberInput
): Promise<{ membershipId: string; invitedEmail: string }> {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");

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

  const membership = await prisma.orgMembership.update({
    where: { id: memberId },
    data: { roleId: role.id },
  });

  // Isolamento: só altera papéis DENTRO da organização do contexto
  if (membership.organizationId !== ctx.organizationId) {
    throw new ForbiddenError("membership-from-other-org");
  }

  await writeAudit({
    organizationId: membership.organizationId,
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
