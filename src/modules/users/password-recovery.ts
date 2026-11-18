import { randomInt } from "node:crypto";
import { authenticator } from "otplib";
import { prisma } from "@/shared/lib/prisma";
import { AppError, UnauthorizedError } from "@/shared/errors";
import { decryptMfaSecret, hashPassword, rateLimit, sha256, safeEqual } from "@/shared/lib/security";
import { adminPasswordSchema, passwordSchema } from "./schemas";
import { deliverEmail } from "./panel-auth";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function digest(code: string): string {
  const pepper = process.env.SESSION_SECRET;
  if (!pepper || pepper.length < 32) throw new AppError("SERVER_MISCONFIGURED", 500, "Serviço temporariamente indisponível.");
  return sha256(`${pepper}:password-reset:${code}`);
}

async function findAccountType(email: string) {
  return prisma.user.findUnique({
    where: { email },
    select: {
      id: true, email: true, phone: true, platformRole: true, mfaEnabled: true, mfaSecret: true,
      memberships: { where: { acceptedAt: { not: null } }, select: { id: true }, take: 1 },
    },
  });
}

/** Starts recovery without disclosing whether an email is registered. */
export async function startPasswordRecovery(email: string, ip: string) {
  if (await rateLimit(`password-reset:ip:${ip}`, 10, 15 * 60 * 1000) ||
      await rateLimit(`password-reset:email:${email}`, 5, 15 * 60 * 1000)) {
    throw new AppError("RATE_LIMITED", 429, "Demasiados pedidos. Aguarde antes de tentar novamente.");
  }

  const user = await findAccountType(email);
  if (!user || user.platformRole === "PLATFORM_ADMIN") return;

  const recent = await prisma.passwordResetCode.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (recent && Date.now() - recent.createdAt.getTime() < 60_000) {
    throw new AppError("RESEND_TOO_SOON", 429, "Aguarde 60 segundos antes de solicitar outro código.");
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.passwordResetCode.updateMany({
    where: { userId: user.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  const record = await prisma.passwordResetCode.create({
    data: { userId: user.id, codeHash: digest(code), channel: "EMAIL", expiresAt: new Date(Date.now() + CODE_TTL_MS) },
    select: { id: true },
  });

  try {
    await deliverEmail(user.email, code, "Recuperação da palavra-passe — BINF EVENTOS", 10);
  } catch (error) {
    await prisma.passwordResetCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
    throw error;
  }
}

/** Returns available recovery methods after the user submits the account email. */
export async function getPasswordRecoveryMethods(email: string, ip: string): Promise<{ methods: ["EMAIL"] | ["TOTP"]; requireTotp: boolean }> {
  if (await rateLimit(`password-reset-options:ip:${ip}`, 20, 15 * 60 * 1000) ||
      await rateLimit(`password-reset-options:email:${email}`, 8, 15 * 60 * 1000)) {
    throw new AppError("RATE_LIMITED", 429, "Demasiadas tentativas. Aguarde antes de tentar novamente.");
  }
  const user = await findAccountType(email);
  // Mesmo conjunto de métodos para contas existentes e inexistentes.
  const requireTotp = user?.platformRole === "PLATFORM_ADMIN";
  return { methods: requireTotp ? ["TOTP"] : ["EMAIL"], requireTotp };
}

export async function completePasswordRecovery(input: {
  email: string;
  newPassword: string;
  code?: string;
  totpCode?: string;
}, ip: string): Promise<void> {
  if (await rateLimit(`password-reset-confirm:ip:${ip}`, 10, 15 * 60 * 1000) ||
      await rateLimit(`password-reset-confirm:email:${input.email}`, 8, 15 * 60 * 1000)) {
    throw new AppError("RATE_LIMITED", 429, "Demasiadas tentativas. Aguarde antes de tentar novamente.");
  }

  const user = await findAccountType(input.email);
  if (!user) throw new UnauthorizedError();
  const passwordValidation = (user.platformRole === "PLATFORM_ADMIN" ? adminPasswordSchema : passwordSchema)
    .safeParse(input.newPassword);
  if (!passwordValidation.success) {
    throw new AppError("WEAK_PASSWORD", 422, passwordValidation.error.issues[0]?.message ?? "Password inválida.");
  }
  let resetCodeId: string | null = null;
  if (user.platformRole === "PLATFORM_ADMIN") {
    const encryptionKey = process.env.MFA_ENCRYPTION_KEY?.trim();
    if (!encryptionKey || !/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
      throw new AppError("MFA_ENCRYPTION_KEY_MISSING", 503, "MFA indisponível: configure a chave original MFA_ENCRYPTION_KEY de 64 caracteres hexadecimais e reinicie o servidor.");
    }
    if (input.code || !user.mfaEnabled || !user.mfaSecret || !/^\d{6}$/.test(input.totpCode ?? "")) {
      throw new AppError("INVALID_RECOVERY_CODE", 401, "Código MFA inválido ou MFA não configurado.");
    }
    let mfaSecret: string;
    try {
      mfaSecret = decryptMfaSecret(user.mfaSecret);
    } catch {
      throw new AppError("MFA_SECRET_UNAVAILABLE", 503, "Não foi possível abrir o segredo MFA. Restaure a mesma MFA_ENCRYPTION_KEY usada quando o MFA do administrador foi configurado.");
    }
    if (!authenticator.verify({ token: input.totpCode!, secret: mfaSecret })) {
      throw new AppError("INVALID_RECOVERY_CODE", 401, "Código MFA inválido ou MFA não configurado.");
    }
  } else {
    if (!input.code || !/^\d{6}$/.test(input.code) || input.totpCode) throw new UnauthorizedError();
    const record = await prisma.passwordResetCode.findFirst({
      where: { userId: user.id, channel: "EMAIL", consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { createdAt: "desc" },
    });
    if (!record) throw new AppError("INVALID_RECOVERY_CODE", 401, "Código expirado ou inválido. Solicite outro.");
    const attempt = await prisma.passwordResetCode.updateMany({
      where: { id: record.id, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (attempt.count !== 1 || !safeEqual(record.codeHash, digest(input.code))) {
      throw new AppError("INVALID_RECOVERY_CODE", 401, "Código expirado ou inválido. Solicite outro.");
    }
    resetCodeId = record.id;
  }

  const passwordHash = await hashPassword(input.newPassword);
  await prisma.$transaction(async (tx) => {
    if (resetCodeId) {
      const consumed = await tx.passwordResetCode.updateMany({
        where: { id: resetCodeId, userId: user.id, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lte: MAX_ATTEMPTS } },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) throw new AppError("INVALID_RECOVERY_CODE", 401, "Código já utilizado ou expirado.");
    }
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  });
  console.log("[audit] auth.password_recovered", { userId: user.id, ip });
}
