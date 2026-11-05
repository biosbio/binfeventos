import { authenticator } from "otplib";
import { prisma } from "@/shared/lib/prisma";
import { markPanelVerified, type AuthContext } from "@/shared/auth";
import { AppError, ForbiddenError } from "@/shared/errors";
import {
  verifyPassword,
  rateLimit,
  decryptMfaSecret,
  encryptMfaSecret,
  isEncryptedMfaSecret,
} from "@/shared/lib/security";

export async function deliverEmail(to: string, code: string, subject = "Código de acesso ao painel — BINF EVENTOS", validityMinutes = 5): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    throw new AppError("DELIVERY_NOT_CONFIGURED", 503, "Envio de email indisponível: configure RESEND_API_KEY e EMAIL_FROM.");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text: `O seu código de acesso é ${code}. É válido por ${validityMinutes} minutos e só pode ser utilizado uma vez.`,
    }),
  });
  if (!response.ok) throw new AppError("EMAIL_DELIVERY_FAILED", 502, "Não foi possível enviar o código por email.");
}

export async function deliverSms(to: string, code: string, purpose = "acesso ao painel", validityMinutes = 5): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    throw new AppError("DELIVERY_NOT_CONFIGURED", 503, "Envio de SMS indisponível: configure as credenciais Twilio.");
  }
  if (!/^\+[1-9]\d{7,14}$/.test(to)) {
    throw new AppError("INVALID_PHONE", 422, "O número de telefone deve estar no formato internacional, por exemplo +245XXXXXXXXX.");
  }
  const body = new URLSearchParams({
    To: to,
    From: from,
    Body: `BINF EVENTOS: o seu código de ${purpose} é ${code}. Válido por ${validityMinutes} minutos.`,
  });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!response.ok) throw new AppError("SMS_DELIVERY_FAILED", 502, "Não foi possível enviar o código por SMS.");
}

/** Organizador confirma a password antes de abrir o painel. */
export async function verifyOrganizerPanelPassword(ctx: AuthContext, password: string): Promise<void> {
  if (ctx.platformRole === "PLATFORM_ADMIN") throw new ForbiddenError("admin-must-use-mfa");
  if (!ctx.organizationId) throw new ForbiddenError("organizer-membership-required");
  if (ctx.permissions.size === 0) {
    const isApprovedEventStaff = await prisma.eventStaffMembership.findFirst({
      where: {
        userId: ctx.userId,
        role: { in: ["SELLER", "GATE"] },
        approvedAt: { not: null },
        event: { organizationId: ctx.organizationId, organization: { status: "ACTIVE" } },
      },
      select: { id: true },
    });
    if (!isApprovedEventStaff) throw new ForbiddenError("organizer-membership-required");
  }
  if (await rateLimit(`panel-organizer-password:${ctx.userId}`, 5, 15 * 60 * 1000)) {
    throw new AppError("RATE_LIMITED", 429, "Demasiadas tentativas. Aguarde quinze minutos.");
  }
  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { passwordHash: true },
  });
  if (!user || !(await verifyPassword(user.passwordHash, password))) {
    throw new AppError("INVALID_CREDENTIALS", 401, "Password inválida.");
  }
  await markPanelVerified(ctx.sessionId);
}

/** Administrador: exige password e TOTP em cada elevação para o painel. */
export async function verifyAdminPanelMfa(
  ctx: AuthContext,
  password: string,
  totpCode: string,
): Promise<void> {
  if (ctx.platformRole !== "PLATFORM_ADMIN") throw new ForbiddenError("platform-admin-only");
  if (!process.env.MFA_ENCRYPTION_KEY) {
    throw new AppError("MFA_ENCRYPTION_KEY_MISSING", 500, "Configure MFA_ENCRYPTION_KEY para proteger o segredo TOTP.");
  }
  if (await rateLimit(`panel-admin-mfa:${ctx.userId}`, 5, 5 * 60 * 1000)) {
    throw new AppError("RATE_LIMITED", 429, "Demasiadas tentativas de autenticação. Aguarde cinco minutos.");
  }
  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { id: true, passwordHash: true, mfaEnabled: true, mfaSecret: true },
  });
  if (!user || !(await verifyPassword(user.passwordHash, password))) {
    throw new AppError("INVALID_CREDENTIALS", 401, "Credenciais inválidas.");
  }
  if (!user.mfaEnabled || !user.mfaSecret || !/^\d{6}$/.test(totpCode)) {
    throw new AppError("INVALID_MFA", 401, "Código MFA inválido ou MFA não configurado.");
  }
  const mfaSecret = decryptMfaSecret(user.mfaSecret);
  if (!authenticator.verify({ token: totpCode, secret: mfaSecret })) {
    throw new AppError("INVALID_MFA", 401, "Código MFA inválido ou MFA não configurado.");
  }
  if (!isEncryptedMfaSecret(user.mfaSecret) && process.env.MFA_ENCRYPTION_KEY) {
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaSecret: encryptMfaSecret(mfaSecret) },
    });
  }
  await markPanelVerified(ctx.sessionId);
}

export async function verifyAdminActionMfa(ctx: AuthContext, totpCode: string): Promise<void> {
  if (ctx.platformRole !== "PLATFORM_ADMIN") throw new ForbiddenError("platform-admin-only");
  if (!process.env.MFA_ENCRYPTION_KEY) {
    throw new AppError("MFA_ENCRYPTION_KEY_MISSING", 500, "Configure MFA_ENCRYPTION_KEY para proteger o segredo TOTP.");
  }
  if (await rateLimit(`admin-user-edit-mfa:${ctx.userId}`, 5, 5 * 60 * 1000)) {
    throw new AppError("RATE_LIMITED", 429, "Demasiadas tentativas. Aguarde cinco minutos.");
  }
  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { mfaEnabled: true, mfaSecret: true },
  });
  if (!user?.mfaEnabled || !user.mfaSecret || !/^\d{6}$/.test(totpCode)) {
    throw new AppError("INVALID_MFA", 401, "Código MFA inválido ou MFA não configurado.");
  }
  if (!authenticator.verify({ token: totpCode, secret: decryptMfaSecret(user.mfaSecret) })) {
    throw new AppError("INVALID_MFA", 401, "Código MFA inválido ou MFA não configurado.");
  }
}
