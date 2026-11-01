import { authenticator } from "otplib";
import { prisma } from "@/shared/lib/prisma";
import {
  hashPassword,
  verifyPassword,
  rateLimit,
  encryptMfaSecret,
  decryptMfaSecret,
  isEncryptedMfaSecret,
} from "@/shared/lib/security";
import { AppError, BusinessRuleError, ConflictError, UnauthorizedError } from "@/shared/errors";
import { createSession, revokeCurrentSession } from "@/shared/auth";
import type { LoginInput, RegisterInput } from "./schemas";

// ============================================================
// Módulo users — lógica de negócio de contas.
// Regras de segurança:
// - Login com rate limit (SEC-03/SEC-05) e mensagem genérica em falha.
// - MFA TOTP obrigatório quando ativado (SEC-01).
// - Auditoria de auth via writeAudit com organizationId da 1ª org do
//   utilizador (Auditoria exige contexto organizacional; contas sem org
//   ficam auditadas pela org do convite aceito, ou logadas em server log).
// ============================================================

/** Registro de novo utilizador. */
export async function registerUser(input: RegisterInput, ip?: string): Promise<{ id: string }> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new ConflictError("Email já registado.");
  }

  const user = await prisma.user.create({
    data: {
      fullName: input.fullName,
      email: input.email,
      phone: input.phone ?? null,
      passwordHash: await hashPassword(input.password),
      status: "ACTIVE",
    },
    select: { id: true },
  });

  console.log("[audit] user.registered", { userId: user.id, ip });
  return user;
}

/** Autentica e cria a sessão (com MFA quando ativado). */
export async function loginUser(input: LoginInput, ip?: string): Promise<{ mfaRequired: boolean }> {
  // Rate limit por IP+email: 10 tentativas por minuto (SEC-05)
  if (
    await rateLimit(`login:ip:${ip ?? "unknown"}`, 30, 15 * 60 * 1000) ||
    await rateLimit(`login:email:${input.email}`, 10, 15 * 60 * 1000)
  ) {
    throw new AppError("RATE_LIMITED", 429, "Demasiadas tentativas de acesso. Aguarde quinze minutos.");
  }

  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const ok = user ? await verifyPassword(user.passwordHash, input.password) : false;

  // Mensagem genérica: nunca revelar se o email existe (SEC-09)
  if (!user || !ok) {
    console.log("[audit] auth.login_failed", { email: input.email, ip });
    throw new UnauthorizedError();
  }
  if (user.status !== "ACTIVE") {
    throw new AppError("ACCOUNT_SUSPENDED", 403, "Conta suspensa ou encerrada.");
  }

  // Administrador da plataforma nunca pode autenticar sem MFA ativo.
  if (user.platformRole === "PLATFORM_ADMIN" && !user.mfaEnabled) {
    throw new AppError("MFA_MISCONFIGURED", 500, "MFA obrigatório do administrador não está ativo. Contacte o suporte.");
  }
  if (user.platformRole === "PLATFORM_ADMIN" && !process.env.MFA_ENCRYPTION_KEY) {
    throw new AppError("MFA_ENCRYPTION_KEY_MISSING", 500, "Configure MFA_ENCRYPTION_KEY para proteger o segredo TOTP.");
  }

  // MFA: só entra com código TOTP válido (SEC-01)
  if (user.mfaEnabled) {
    if (!user.mfaSecret) {
      throw new AppError("MFA_MISCONFIGURED", 500, "MFA mal configurado. Contacte o suporte.");
    }
    const mfaSecret = decryptMfaSecret(user.mfaSecret);
    if (!input.totpCode || !authenticator.verify({ token: input.totpCode, secret: mfaSecret })) {
      throw new AppError("MFA_REQUIRED", 401, "Código MFA obrigatório ou inválido.");
    }
    // Migração transparente de segredos antigos em texto claro.
    if (!isEncryptedMfaSecret(user.mfaSecret) && process.env.MFA_ENCRYPTION_KEY) {
      await prisma.user.update({
        where: { id: user.id },
        data: { mfaSecret: encryptMfaSecret(mfaSecret) },
      });
    }
  }

  // Contexto organizacional: primeira associação aceita, senão null
  const membership = await prisma.orgMembership.findFirst({
    where: { userId: user.id, acceptedAt: { not: null } },
    orderBy: { acceptedAt: "asc" },
    select: { organizationId: true },
  });

  await createSession(user.id, membership?.organizationId ?? null);
  return { mfaRequired: false };
}

/** Inicia ativação de MFA: gera segredo + URL otpauth (QR a ler na app). */
export async function beginEnableMfa(userId: string): Promise<{
  otpauthUrl: string;
  secret: string;
}> {
  const secret = authenticator.generateSecret();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, mfaEnabled: true },
  });
  if (!user) throw new UnauthorizedError();
  if (user.mfaEnabled) {
    throw new BusinessRuleError("MFA já está ativo. Não é permitido substituir o segredo sem um fluxo de recuperação.");
  }

  // Guarda o segredo ANTES de ativar; confirmação acontece depois
  await prisma.user.update({
    where: { id: userId },
    data: { mfaSecret: encryptMfaSecret(secret) },
  });

  const otpauthUrl = authenticator.keyuri(user.email, "BINF EVENTOS", secret);
  return { otpauthUrl, secret };
}

/** Confirma ativação de MFA com o primeiro código válido. */
export async function confirmEnableMfa(userId: string, totpCode: string): Promise<void> {
  if (await rateLimit(`mfa-enable:${userId}`, 5, 5 * 60 * 1000)) {
    throw new AppError("RATE_LIMITED", 429, "Demasiadas tentativas. Aguarde cinco minutos.");
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mfaSecret: true, mfaEnabled: true },
  });
  if (!user?.mfaSecret) {
    throw new BusinessRuleError("Ative o MFA antes de confirmar.");
  }
  if (!authenticator.verify({ token: totpCode, secret: decryptMfaSecret(user.mfaSecret) })) {
    throw new AppError("INVALID_MFA_CODE", 422, "Código inválido. Tente novamente.");
  }
  await prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
}

/** Desativa MFA (exige código válido — não pode ser desligado sem prova). */
export async function disableMfa(userId: string, totpCode: string): Promise<void> {
  if (await rateLimit(`mfa-disable:${userId}`, 5, 5 * 60 * 1000)) {
    throw new AppError("RATE_LIMITED", 429, "Demasiadas tentativas. Aguarde cinco minutos.");
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mfaSecret: true, mfaEnabled: true, platformRole: true },
  });
  if (user?.platformRole === "PLATFORM_ADMIN") {
    throw new BusinessRuleError("O MFA do administrador da plataforma é obrigatório e não pode ser desativado.");
  }
  if (!user?.mfaEnabled || !user.mfaSecret) {
    throw new BusinessRuleError("MFA não está ativado.");
  }
  if (!authenticator.verify({ token: totpCode, secret: decryptMfaSecret(user.mfaSecret) })) {
    throw new AppError("INVALID_MFA_CODE", 422, "Código inválido. Tente novamente.");
  }
  await prisma.user.update({
    where: { id: userId },
    data: { mfaEnabled: false, mfaSecret: null },
  });
}

/** Alteração de password: revoga TODAS as sessões por segurança. */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  totpCode?: string
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user) throw new UnauthorizedError();

  const ok = await verifyPassword(user.passwordHash, currentPassword);
  if (!ok) throw new UnauthorizedError();

  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: { platformRole: true, mfaEnabled: true, mfaSecret: true },
  });
  if (account?.platformRole === "PLATFORM_ADMIN") {
    if (!account.mfaEnabled || !account.mfaSecret || !totpCode || !/^\d{6}$/.test(totpCode) ||
        !authenticator.verify({ token: totpCode, secret: decryptMfaSecret(account.mfaSecret) })) {
      throw new AppError("INVALID_MFA", 401, "Confirme a alteração com o código da aplicação autenticadora.");
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });

  // Revoga todas as sessões ativas (SEC-03)
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Logout: revoga a sessão atual. */
export async function logoutUser(): Promise<void> {
  await revokeCurrentSession();
}
