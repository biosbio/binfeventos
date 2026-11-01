import { randomInt } from "crypto";
import { authenticator } from "otplib";
import { prisma } from "@/shared/lib/prisma";
import { markPanelVerified, type AuthContext } from "@/shared/auth";
import { AppError, ForbiddenError, UnauthorizedError } from "@/shared/errors";
import { verifyPassword, sha256, safeEqual, rateLimit } from "@/shared/lib/security";

const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

async function deliverEmail(to: string, code: string): Promise<void> {
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
      subject: "Código de acesso ao painel — BINF EVENTOS",
      text: `O seu código de acesso é ${code}. É válido por 5 minutos e só pode ser utilizado uma vez.`,
    }),
  });
  if (!response.ok) throw new AppError("EMAIL_DELIVERY_FAILED", 502, "Não foi possível enviar o código por email.");
}

async function deliverSms(to: string, code: string): Promise<void> {
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
    Body: `BINF EVENTOS: o seu código de acesso é ${code}. Válido por 5 minutos.`,
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

function codeDigest(code: string): string {
  const pepper = process.env.SESSION_SECRET;
  if (!pepper) throw new AppError("SERVER_MISCONFIGURED", 500, "Configuração de segurança incompleta.");
  return sha256(`${pepper}:${code}`);
}

/** Envia um OTP para um organizador já associado a uma organização ativa. */
export async function sendOrganizerPanelCode(ctx: AuthContext, channel: "EMAIL" | "SMS"): Promise<void> {
  if (ctx.platformRole === "PLATFORM_ADMIN") throw new ForbiddenError("admin-must-use-mfa");
  if (!ctx.organizationId || ctx.permissions.size === 0) {
    throw new ForbiddenError("organizer-membership-required");
  }
  if (rateLimit(`panel-code:${ctx.userId}`, 5, 15 * 60 * 1000)) {
    throw new AppError("RATE_LIMITED", 429, "Limite de códigos atingido. Aguarde 15 minutos.");
  }

  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { email: true, phone: true },
  });
  if (!user) throw new UnauthorizedError();

  const recentCode = await prisma.panelVerificationCode.findFirst({
    where: { userId: ctx.userId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (recentCode && Date.now() - recentCode.createdAt.getTime() < 60_000) {
    throw new AppError("RESEND_TOO_SOON", 429, "Aguarde 60 segundos antes de solicitar outro código.");
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.panelVerificationCode.updateMany({
    where: { userId: ctx.userId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  const record = await prisma.panelVerificationCode.create({
    data: {
      userId: ctx.userId,
      codeHash: codeDigest(code),
      channel,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
    select: { id: true },
  });

  try {
    if (channel === "EMAIL") await deliverEmail(user.email, code);
    else {
      if (!user.phone) throw new AppError("PHONE_REQUIRED", 422, "Adicione um número de telefone à sua conta antes de escolher SMS.");
      await deliverSms(user.phone, code);
    }
  } catch (error) {
    await prisma.panelVerificationCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
    throw error;
  }
}

/** Valida OTP e eleva apenas a sessão atual durante 10 minutos. */
export async function verifyOrganizerPanelCode(ctx: AuthContext, code: string): Promise<void> {
  if (ctx.platformRole === "PLATFORM_ADMIN") throw new ForbiddenError("admin-must-use-mfa");
  if (!ctx.organizationId || ctx.permissions.size === 0) throw new ForbiddenError("organizer-membership-required");
  const record = await prisma.panelVerificationCode.findFirst({
    where: { userId: ctx.userId, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "desc" },
  });
  if (!record) throw new AppError("INVALID_PANEL_CODE", 401, "Código expirado ou inexistente. Solicite outro.");
  // Incremento condicional atómico: pedidos concorrentes não ultrapassam
  // o limite de cinco tentativas.
  const attempt = await prisma.panelVerificationCode.updateMany({
    where: {
      id: record.id,
      consumedAt: null,
      expiresAt: { gt: new Date() },
      attempts: { lt: MAX_ATTEMPTS },
    },
    data: { attempts: { increment: 1 } },
  });
  if (attempt.count !== 1) {
    throw new AppError("INVALID_PANEL_CODE", 401, "Código expirado ou sem tentativas disponíveis.");
  }
  if (!safeEqual(record.codeHash, codeDigest(code))) {
    throw new AppError("INVALID_PANEL_CODE", 401, "Código inválido.");
  }
  const consumed = await prisma.panelVerificationCode.updateMany({
    where: { id: record.id, consumedAt: null, codeHash: codeDigest(code), attempts: { lte: MAX_ATTEMPTS } },
    data: { consumedAt: new Date() },
  });
  if (consumed.count !== 1) throw new AppError("INVALID_PANEL_CODE", 401, "Código inválido ou já utilizado.");
  await markPanelVerified(ctx.sessionId);
}

/** Administrador: exige password e TOTP em cada elevação para o painel. */
export async function verifyAdminPanelMfa(
  ctx: AuthContext,
  password: string,
  totpCode: string,
): Promise<void> {
  if (ctx.platformRole !== "PLATFORM_ADMIN") throw new ForbiddenError("platform-admin-only");
  if (rateLimit(`panel-admin-mfa:${ctx.userId}`, 5, 5 * 60 * 1000)) {
    throw new AppError("RATE_LIMITED", 429, "Demasiadas tentativas de autenticação. Aguarde cinco minutos.");
  }
  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { passwordHash: true, mfaEnabled: true, mfaSecret: true },
  });
  if (!user || !(await verifyPassword(user.passwordHash, password))) {
    throw new AppError("INVALID_CREDENTIALS", 401, "Credenciais inválidas.");
  }
  if (!user.mfaEnabled || !user.mfaSecret || !/^\d{6}$/.test(totpCode) ||
      !authenticator.verify({ token: totpCode, secret: user.mfaSecret })) {
    throw new AppError("INVALID_MFA", 401, "Código MFA inválido ou MFA não configurado.");
  }
  await markPanelVerified(ctx.sessionId);
}
