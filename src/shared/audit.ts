import { prisma } from "@/shared/lib/prisma";
import { AppError } from "@/shared/errors";

// ============================================================
// Auditoria transversal — toda operação sensível gera AuditLog.
// (Princípio estrutural: Rastreabilidade)
//
// Regras:
// 1. Registo de auditoria é APENSA (append-only): nunca atualizar/apagar.
// 2. before/after guardam estado relevante; dados sensíveis (passwords,
//    segredos QR, cartões) NUNCA entram nestes payloads (SEC-16).
// 3. O ator é registado quando existe; operações de sistema usam null.
// ============================================================

export type AuditAction =
  | "auth.login"
  | "auth.logout"
  | "auth.login_failed"
  | "auth.mfa_enabled"
  | "admin.user.updated"
  | "admin.user.status_changed"
  | "org.created"
  | "org.suspended"
  | "org.reactivated"
  | "org.member_invited"
  | "org.member_role_changed"
  | "org.boxoffice_seller_invite_created"
  | "org.boxoffice_seller_invite_revoked"
  | "org.boxoffice_seller_requested"
  | "org.boxoffice_seller_approved"
  | "org.boxoffice_seller_revoked"
  | "admin.boxoffice_seller_approved"
  | "admin.boxoffice_seller_revoked"
  | "event.created"
  | "event.staff_invite_created"
  | "event.staff_invite_revoked"
  | "event.staff_access_requested"
  | "event.staff_access_approved"
  | "event.staff_access_rejected"
  | "event.staff_access_revoked"
  | "session.created"
  | "event.updated"
  | "event.published"
  | "event.suspended"
  | "event.cancelled"
  | "event.postponed"
  | "event.closed"
  | "venue.created"
  | "ticket_type.created"
  | "ticket_type.updated"
  | "batch.created"
  | "batch.status_changed"
  | "batch.paused"
  | "batch.closed"
  | "order.created"
  | "order.confirmed"
  | "order.cancelled"
  | "order.reviewed"
  | "payment.initiated"
  | "payment.confirmed"
  | "payment.declined"
  | "payment.reviewed"
  | "payment.initiation_uncertain"
  | "payment.blocked_attempt_confirmation"
  | "payment.blocked_attempt_callback"
  | "payment.reviewed_late_confirmation"
  | "payment.webhook_amount_mismatch_after_state_change"
  | "refund.requested"
  | "refund.approved"
  | "refund.rejected"
  | "refund.completed"
  | "settlement.prepared"
  | "settlement.approved"
  | "settlement.rejected"
  | "settlement.paid"
  | "reserve.constituted"
  | "reserve.released"
  | "ledger.adjustment"
  | "shift.opened"
  | "shift.closed"
  | "shift.difference_recorded"
  | "ticket.issued"
  | "ticket.revoked"
  | "ticket.transfer_requested"
  | "ticket.transfer_completed"
  | "ticket.transfer_rejected"
  | "access.entry_granted"
  | "access.entry_denied"
  | "access.exit_recorded"
  | "fraud_rule.created"
  | "fraud_rule.approved"
  | "fraud_rule.paused"
  | "fraud_alert.resolved"
  | "incident.created"
  | "incident.contained"
  | "incident.resolved"
  | "subscription.created"
  | "subscription.cancelled"
  | "export.requested";

export interface AuditEntry {
  organizationId: string;
  actorUserId?: string | null;
  action: AuditAction;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/**
 * Regista um evento de auditoria.
 * Falhas de auditoria NÃO devem interromper a operação de negócio principal,
 * mas são logadas para investigação (SEC-16).
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: entry.organizationId,
        actorUserId: entry.actorUserId ?? null,
        action: entry.action,
        before: (entry.before ?? undefined) as never,
        after: (entry.after ?? undefined) as never,
        ip: entry.ip ?? null,
      },
    });
  } catch (err) {
    console.error("[audit-write-failed]", entry.action, err);
  }
}

/**
 * Sanitiza objetos para auditoria: remove campos sensíveis.
 * Usar SEMPRE antes de passar before/after.
 */
const SENSITIVE_KEYS = new Set([
  "password",
  "passwordHash",
  "token",
  "tokenHash",
  "refreshToken",
  "accessToken",
  "qrSecret",
  "qrSecretHash",
  "qrToken",
  "secret",
  "secretHash",
  "mfaSecret",
  "webhookSecret",
  "merchantToken",
  "apiKey",
  "code",
  "codeHash",
  "otp",
  "totpCode",
  "authorization",
  "providerRawPayload",
  "cvv",
  "cardNumber",
  "adapterConfig",
]);

export function sanitizeForAudit(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForAudit);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEYS.has(key) ? "[REDACTED]" : sanitizeForAudit(value);
  }
  return out;
}

/** Exige que a organização exista e esteja ativa (isolamento multiempresa). */
export async function assertOrgActive(organizationId: string): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { status: true },
  });
  if (!org) throw new AppError("NOT_FOUND", 404, "Organização não encontrada.");
  if (org.status !== "ACTIVE") {
    throw new AppError("ORG_SUSPENDED", 422, "Organização suspensa ou encerrada.");
  }
}
