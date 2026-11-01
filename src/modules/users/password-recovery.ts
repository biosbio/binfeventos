import { randomInt } from "node:crypto";
import { authenticator } from "otplib";
import { prisma } from "@/shared/lib/prisma";
import { AppError, UnauthorizedError } from "@/shared/errors";
import { decryptMfaSecret, hashPassword, rateLimit, sha256, safeEqual } from "@/shared/lib/security";
import { deliverEmail, deliverSms } from "./panel-auth";

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
export async function startPasswordRecovery(email: string, channel: "EMAIL" | "SMS", ip: string) {
  if (await rateLimit(`password-reset:ip:${ip}`, 10, 15 * 60 * 1000) ||
      await rateLimit(`password-reset:email:${email}`, 5, 15 * 60 * 1000)) {
    throw new AppError("RATE_LIMITED", 429, "Demasiados pedidos. Aguarde antes de tentar novamente.");
  }

  const user = await findAccountType(email);
  if (!user || user.platformRole === "PLATFORM_ADMIN") return;

  const isOrganizer = user.memberships.length > 0;
  if (isOrganizer && channel !== "EMAIL") {
    throw new AppError("EMAIL_REQUIRED", 422, "A recuperação de contas de organizador é feita pelo email cadastrado.");
  }
  if (channel === "SMS" && !user.phone) {
    throw new AppError("PHONE_REQUIRED", 422, "Esta conta não tem telemóvel cadastrado. Utilize o email.");
  }

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
    data: { userId: user.id, codeHash: digest(code), channel, expiresAt: new Date(Date.now() + CODE_TTL_MS) },
    select: { id: true },
  });

  try {
    if (channel === "EMAIL") {
      await deliverEmail(user.email, code, "Recuperação da palavra-passe — BINF EVENTOS");
    } else {
      await deliverSms(user.phone!, code, "recuperação da palavra-passe");
    }
  } catch (error) {
    await prisma.passwordResetCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
    throw error;
  }
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
  if (!user || user.platformRole === "PLATFORM_ADMIN" && !input.totpCode) throw new UnauthorizedError();
  if (user.platformRole === "PLATFORM_ADMIN") {
    if (!user.mfaEnabled || !user.mfaSecret || !/^\\d{6}$/.test(input.totpCode ?? "")) {
      throw new AppError("INVALID_RECOVERY_CODE", 401, "Código de recuperação inválido.");
    }
    if (!authenticator.verify({ token: input.totpCode!, secret: decryptMfaSecret(user.mfaSecret) })) {
      throw new AppError("INVALID_RECOVERY_CODE", 401, "Código de recuperação inválido.");
    }
  } else {
    if (!input.code || !/^\\d{6}$/.test(input.code)) {
      throw new AppError("INVALID_RECOVERY_CODE", 401, "Código de recuperação inválido.");
    }
    const record = await prisma.passwordResetCode.findFirst({
      where: { userId: user.id, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: MAX_ATTEMPTS } },
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
    const consumed = await prisma.passwordResetCode.updateMany({
      where: { id: record.id, consumedAt: null, codeHash: digest(input.code), attempts: { lte: MAX_ATTEMPTS } },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new AppError("INVALID_RECOVERY_CODE", 401, "Código já utilizado.");
  }

  const passwordHash = await hashPassword(input.newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  console.log("[audit] auth.password_recovered", { userId: user.id, ip });
}
