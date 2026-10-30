import { prisma } from "@/shared/lib/prisma";
import { AppError, ForbiddenError, NotFoundError, ConflictError } from "@/shared/errors";
import { writeAudit, sanitizeForAudit } from "@/shared/audit";
import type { AuthContext } from "@/shared/auth";
import type {
  SendRequestInput,
  ListMyNotificationsInput,
  MarkReadInput,
  PreferenceInput,
} from "./schemas";
import type { NotificationChannelType, NotificationTypeCode } from "./schemas";

// ============================================================
// Módulo notifications — Domínio 10.
//
// Regras (documento mestre + risco nº 12 "falha de notificações"):
// 1. Toda notificação é persistida ANTES do envio (registro
//    auditável: PENDING → SENT → DELIVERED; FAILED/RETRYING
//    com attempts e lastError).
// 2. Templates montados 100% no servidor com dados da base.
// 3. Idempotência: mesma chave nunca cria dois envios.
// 4. Preferências do utilizador respeitadas (opt-out por canal).
// 5. Canais externos via providers abstraídos (mock em dev;
//    SMTP/Resend/SMS em produção — chaves via gestor de segredos).
// ============================================================

/** Interface do canal externo (email/SMS). */
export interface ChannelProvider {
  readonly code: NotificationChannelType;
  /** Envia e devolve identificador do prestador (ou null em mock). */
  send(input: { to: string; subject: string; body: string }): Promise<string | null>;
}

/** Provider IN_APP: não há externo — a entrega é a própria persistência. */
const inAppProvider: ChannelProvider = {
  code: "IN_APP",
  async send() {
    return null; // entrega imediata: a notificação está guardada
  },
};

/** Provider EMAIL mock (dev): loga em vez de enviar. Produção: SMTP/Resend. */
export const emailProvider: ChannelProvider = {
  code: "EMAIL",
  async send({ to, subject, body }) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[notifications:mock] EMAIL → ${to} :: ${subject} :: ${body.slice(0, 120)}`);
      return null;
    }
    // Produção: trocar por adapter concreto (SMTP/Resend) via provider
    // registrado no arranque — mesmo padrão dos adaptadores de pagamento.
    throw new AppError("EMAIL_PROVIDER_UNCONFIGURED", 500, "Provider EMAIL não configurado.");
  },
};

/** Provider SMS mock (dev). */
export const smsProvider: ChannelProvider = {
  code: "SMS",
  async send({ to, body }) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[notifications:mock] SMS → ${to} :: ${body.slice(0, 60)}`);
      return null;
    }
    throw new AppError("SMS_PROVIDER_UNCONFIGURED", 500, "Provider SMS não configurado.");
  },
};

const providers: Partial<Record<NotificationChannelType, ChannelProvider>> = {
  IN_APP: inAppProvider,
  EMAIL: emailProvider,
  SMS: smsProvider,
};

/** Registos de providers externos (bootstrap em produção). */
export function registerChannelProvider(provider: ChannelProvider): void {
  providers[provider.code] = provider;
}

/** Assuntos e corpos por tipo — texto PT, dados interpolados no servidor. */
export function renderTemplate(
  type: NotificationTypeCode,
  data: Record<string, unknown>
): { subject: string; body: string } {
  const s = (k: string) => String(data[k] ?? "");
  switch (type) {
    case "ORDER_CONFIRMED":
      return {
        subject: `Encomenda ${s("orderNumber")} confirmada`,
        body: `A sua encomenda ${s("orderNumber")} foi confirmada. Os bilhetes estão disponíveis na sua conta.`,
      };
    case "PAYMENT_CONFIRMED":
      return {
        subject: `Pagamento confirmado — ${s("orderNumber")}`,
        body: `Recebemos o pagamento da encomenda ${s("orderNumber")}.`,
      };
    case "TICKETS_ISSUED":
      return {
        subject: `Bilhetes emitidos — ${s("eventName")}`,
        body: `Os seus bilhetes para ${s("eventName")} foram emitidos. Apresente o QR na portaria.`,
      };
    case "TICKET_TRANSFERRED":
      return {
        subject: "Bilhete transferido",
        body: `O bilhete ${s("ticketNumber")} foi transferido para ${s("newHolder")}.`,
      };
    case "REFUND_PROCESSED":
      return {
        subject: `Reembolso processado — ${s("orderNumber")}`,
        body: `O reembolso da encomenda ${s("orderNumber")} foi processado.`,
      };
    case "EVENT_CANCELLED":
      return {
        subject: `Evento cancelado — ${s("eventName")}`,
        body: `O evento ${s("eventName")} foi cancelado. Encontrará instruções de reembolso na sua conta.`,
      };
    case "EVENT_POSTPONED":
      return {
        subject: `Evento adiado — ${s("eventName")}`,
        body: `O evento ${s("eventName")} foi adiado. A sua encomenda mantém-se válida.`,
      };
    case "PAYMENT_REMINDER":
      return {
        subject: `Pagamento pendente — ${s("orderNumber")}`,
        body: `A reserva da encomenda ${s("orderNumber")} expira em breve. Conclua o pagamento.`,
      };
    case "ACCESS_ALERT":
      return {
        subject: "Alerta de acesso",
        body: `Ocorrência registada: ${s("detail")}.`,
      };
    case "SECURITY_ALERT":
      return {
        subject: "Alerta de segurança",
        body: `Detectámos uma ocorrência na sua conta: ${s("detail")}.`,
      };
    case "SETTLEMENT_READY":
      return {
        subject: "Liquidação pronta para aprovação",
        body: `A liquidação do período está preparada (${s("period")}).`,
      };
    case "SHIFT_ALERT":
      return {
        subject: "Turno de caixa",
        body: `Turno ${s("shiftId")}: ${s("detail")}.`,
      };
    case "MEMBER_INVITED":
      return {
        subject: `Convite: juntou-se à organização ${s("orgName")}`,
        body: `Foi convidado para a organização ${s("orgName")} como ${s("roleName")}. Aceite o convite na sua conta.`,
      };
    default:
      return { subject: "Notificação BINF EVENTOS", body: s("detail") };
  }
}

/** Preferência do utilizador para (tipo, canal). Default: habilitado. */
async function isPreferred(
  userId: string,
  type: NotificationTypeCode,
  channel: NotificationChannelType
): Promise<boolean> {
  if (channel === "IN_APP") return true; // in-app nunca é silenciado
  const pref = await prisma.notificationPreference.findFirst({
    where: { userId, type, channel, enabled: false },
    select: { id: true },
  });
  return !pref;
}

/**
 * Enqueue de notificação (uso interno dos módulos de negócio).
 * Persiste PENDING e envia na hora (simple in-process queue; trocar
 * por Redis/BullMQ quando escalar — risco nº 12).
 */
export async function queueNotification(input: SendRequestInput): Promise<{ id: string }> {
  const { userId, type, channel, data } = input;

  // Idempotência
  if (input.idempotencyKey) {
    const existing = await prisma.notification.findFirst({
      where: { userId, type, channel, idempotencyKey: input.idempotencyKey },
      select: { id: true },
    });
    if (existing) return { id: existing.id };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, status: true },
  });
  if (!user || user.status !== "ACTIVE") {
    throw new NotFoundError("Utilizador");
  }

  if (!(await isPreferred(userId, type, channel))) {
    // Respeitar opt-out não é erro: registar como suprimida
    const suppressed = await prisma.notification.create({
      data: {
        userId,
        type,
        channel,
        payload: sanitizeForAudit(data),
        status: "SUPPRESSED",
        idempotencyKey: input.idempotencyKey ?? null,
      },
      select: { id: true },
    });
    return suppressed;
  }

  const { subject, body } = renderTemplate(type, data);
  const provider = providers[channel]!;

  // Persiste ANTES de enviar (registro auditável)
  const notification = await prisma.notification.create({
    data: {
      userId,
      type,
      channel,
      subject,
      body,
      payload: sanitizeForAudit(data),
      status: "PENDING",
      idempotencyKey: input.idempotencyKey ?? null,
    },
    select: { id: true },
  });

  try {
    const externalId = await provider.send({
      to: user.email,
      subject,
      body,
    });
    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: "SENT",
        externalId,
        sentAt: new Date(),
      },
    });
  } catch (err) {
    // FAILED com lastError; job de retry pegará RETRYING
    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: "RETRYING",
        attempts: 1,
        lastError: err instanceof Error ? err.message : "unknown",
      },
    });
    throw new AppError("NOTIFICATION_FAILED", 202, "Notificação agendada para nova tentativa.");
  }

  return { id: notification.id };
}

/**
 * Job: reprocessar notificações RETRYING/FAILED (cron/worker).
 * Idempotente; backoff simples por attempts.
 */
export async function retryFailedNotifications(maxAttempts = 5): Promise<{ retried: number }> {
  const pending = await prisma.notification.findMany({
    where: { status: { in: ["RETRYING", "FAILED"] }, attempts: { lt: maxAttempts } },
    select: { id: true, userId: true, type: true, channel: true, subject: true, body: true, attempts: true },
    take: 100,
  });

  for (const n of pending) {
    const user = await prisma.user.findUnique({
      where: { id: n.userId },
      select: { email: true },
    });
    const provider = providers[n.channel as NotificationChannelType];
    if (!provider || !user) {
      await prisma.notification.update({
        where: { id: n.id },
        data: { status: "FAILED", lastError: "provider-or-user-missing" },
      });
      continue;
    }
    try {
      const externalId = await provider.send({ to: user.email, subject: n.subject, body: n.body });
      await prisma.notification.update({
        where: { id: n.id },
        data: { status: "SENT", externalId, sentAt: new Date(), lastError: null },
      });
    } catch (err) {
      const attempts = n.attempts + 1;
      await prisma.notification.update({
        where: { id: n.id },
        data: {
          attempts,
          status: attempts >= maxAttempts ? "FAILED" : "RETRYING",
          lastError: err instanceof Error ? err.message : "unknown",
        },
      });
    }
  }
  return { retried: pending.length };
}

/** Minhas notificações IN_APP (área do utilizador). */
export async function listMyNotifications(ctx: AuthContext, input: ListMyNotificationsInput) {
  return prisma.notification.findMany({
    where: {
      userId: ctx.userId,
      channel: "IN_APP",
      ...(input.onlyUnread ? { readAt: null } : {}),
    },
    select: { id: true, type: true, subject: true, body: true, readAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: input.limit,
  });
}

/** Marcar uma notificação como lida (apenas a própria). */
export async function markNotificationRead(ctx: AuthContext, input: MarkReadInput) {
  const notification = await prisma.notification.findUnique({
    where: { id: input.notificationId },
    select: { id: true, userId: true, readAt: true },
  });
  if (!notification) throw new NotFoundError("Notificação");
  if (notification.userId !== ctx.userId) throw new ForbiddenError("notification-not-yours");
  if (notification.readAt) throw new ConflictError("Já lida.");
  await prisma.notification.update({
    where: { id: notification.id },
    data: { readAt: new Date() },
  });
}

/** Definir preferência (opt-out por tipo+canal). */
export async function setNotificationPreference(ctx: AuthContext, input: PreferenceInput) {
  const existing = await prisma.notificationPreference.findFirst({
    where: { userId: ctx.userId, type: input.type, channel: input.channel },
    select: { id: true },
  });
  if (existing) {
    await prisma.notificationPreference.update({
      where: { id: existing.id },
      data: { enabled: input.enabled },
    });
    return;
  }
  await prisma.notificationPreference.create({
    data: {
      userId: ctx.userId,
      type: input.type,
      channel: input.channel,
      enabled: input.enabled,
    },
  });

  await writeAudit({
    actorUserId: ctx.userId,
    action: "notification.preference_changed",
    after: sanitizeForAudit(input),
  });
}
