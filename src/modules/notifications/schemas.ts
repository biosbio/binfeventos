import { z } from "zod";

// ============================================================
// Módulo notifications — Domínio 10.
// Schemas de entrada. Regra de ouro: sem dados sensíveis nos
// payloads de template (o conteúdo é montado no servidor a
// partir da base de dados, nunca do pedido do cliente).
// ============================================================

/** Canais suportados (documento mestre, Domínio 10). */
export const NotificationChannel = z.enum(["EMAIL", "SMS", "IN_APP"]);
export type NotificationChannelType = z.infer<typeof NotificationChannel>;

/** Tipos essenciais (documento mestre, Domínio 10). */
export const NotificationType = z.enum([
  "ORDER_CONFIRMED",
  "PAYMENT_CONFIRMED",
  "TICKETS_ISSUED",
  "TICKET_TRANSFERRED",
  "REFUND_PROCESSED",
  "EVENT_CANCELLED",
  "EVENT_POSTPONED",
  "PAYMENT_REMINDER",
  "ACCESS_ALERT",
  "SECURITY_ALERT",
  "SETTLEMENT_READY",
  "SHIFT_ALERT",
  "MEMBER_INVITED",
]);
export type NotificationTypeCode = z.infer<typeof NotificationType>;

/** Filtros de listagem das minhas notificações (IN_APP). */
export const listMyNotificationsSchema = z.object({
  onlyUnread: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(100).optional().default(30),
});

export type ListMyNotificationsInput = z.infer<typeof listMyNotificationsSchema>;

/** Marcar lida. */
export const markReadSchema = z.object({
  notificationId: z.string().uuid(),
});

export type MarkReadInput = z.infer<typeof markReadSchema>;

/** Preferências por tipo (opt-out por canal). */
export const preferenceSchema = z.object({
  type: NotificationType,
  channel: NotificationChannel,
  enabled: z.boolean(),
});

export type PreferenceInput = z.infer<typeof preferenceSchema>;

/**
 * Pedido interno de envio (usado pelos módulos de negócio — nunca
 * exposto a rotas públicas). `data` contém apenas identificadores
 * e valores que o servidor já calculou.
 */
export const sendRequestSchema = z.object({
  userId: z.string().uuid(),
  type: NotificationType,
  channel: NotificationChannel,
  data: z.record(z.unknown()).optional().default({}),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export type SendRequestInput = z.infer<typeof sendRequestSchema>;
