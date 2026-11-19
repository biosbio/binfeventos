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
  if (!response.ok) {
    let providerCode: string | undefined;
    let providerMessage: string | undefined;
    try {
      const result = await response.json() as { name?: string; code?: string; message?: string };
      providerCode = result.name ?? result.code;
      providerMessage = result.message;
    } catch { /* resposta do fornecedor sem JSON */ }
    console.error("[email] Resend delivery failed", { status: response.status, code: providerCode });
    const message = response.status === 401
      ? "O Resend recusou a chave de API. Verifique RESEND_API_KEY e reinicie o servidor."
      : response.status === 403
        ? `O Resend recusou o envio (HTTP 403${providerCode ? `, ${providerCode}` : ""}). ${providerMessage ?? "Verifique o remetente e as permissões da chave na conta Resend."}`
        : response.status === 429
          ? "O limite de envio do Resend foi atingido. Aguarde e tente novamente."
          : `O Resend recusou o email (HTTP ${response.status}${providerCode ? `, código ${providerCode}` : ""})${providerMessage ? `: ${providerMessage}` : "."}`;
    throw new AppError("EMAIL_DELIVERY_FAILED", 502, message);
  }
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
  if (!response.ok) {
    let twilioCode: number | undefined;
    try {
      const result = await response.json() as { code?: number };
      twilioCode = result.code;
    } catch { /* resposta do fornecedor sem JSON */ }
    const messages: Record<number, string> = {
      20003: "Twilio recusou a autenticação. Verifique Account SID e Auth Token.",
      21211: "O número de destino não é válido. Use o formato internacional +indicativo.",
      21606: "O remetente configurado não é válido para esta conta Twilio.",
      21608: "A conta Twilio de teste só pode enviar para números previamente verificados.",
      21614: "O número de destino não é um número móvel válido para SMS.",
    };
    const knownMessage = twilioCode === undefined ? undefined : messages[twilioCode];
    const message = knownMessage
      ? knownMessage
      : `Twilio recusou o envio do SMS (HTTP ${response.status}${twilioCode ? `, código ${twilioCode}` : ""}). Verifique o remetente, saldo e permissões de envio.`;
    throw new AppError("SMS_DELIVERY_FAILED", 502, message);
  }
}

/** Organizador confirma a password antes de abrir o painel. */
export async function verifyOrganizerPanelPassword(ctx: AuthContext, password: string): Promise<void> {
  if (ctx.platformRole === "PLATFORM_ADMIN") throw new ForbiddenError("admin-must-use-mfa");
  if (!ctx.organizationId) throw new ForbiddenError("organizer-membership-required");
  if (ctx.permissions.size === 0) {
    const isApprovedEventStaff = await prisma.eventStaffMembership.findFirst({
      where: {
        userId: ctx.userId,
        role: { in: ["ORGANIZER", "SELLER", "GATE"] },
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
