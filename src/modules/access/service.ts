import { randomBytes } from "crypto";
import { prisma } from "@/shared/lib/prisma";
import { sha256 } from "@/shared/lib/security";
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/shared/errors";
import { writeAudit, sanitizeForAudit } from "@/shared/audit";
import type { AuthContext } from "@/shared/auth";
import type {
  ApproveTransferInput,
  IssueTransferInput,
  ValidateQrInput,
} from "./schemas";

// ============================================================
// Módulo access — emissão, transferência e portaria (Domínio 7).
//
// SEC-18:
// 1. QR imprevisível: segredo aleatório gerado NO SERVIDOR; a base
//    guarda apenas o SHA-256; o token plano é devolvido UMA vez ao
//    titular (para desenhar o QR) e nunca mais persistido.
// 2. Validação SEMPRE no servidor; 100% online — nenhuma credencial
//    é aprovada offline.
// 3. Emissão apenas após pagamento confirmado (chamado por
//    payments.service.confirmPayment), de forma idempotente.
// 4. Transferência/cancelamento invalida o QR anterior: rotação do
//    segredo + novo token.
// ============================================================

/** Gera número de bilhete legível (server-side). */
function nextTicketNumber(): string {
  return `TKT-${randomBytes(6).toString("hex").toUpperCase()}`;
}

/**
 * Emite os bilhetes de uma encomenda confirmada (idempotente).
 * Devolve os tokens QR UMA vez — não são guardados em claro.
 */
export async function issueTicketsForOrder(orderId: string): Promise<{
  tickets: { ticketId: string; ticketNumber: string; qrToken: string; holder: string }[];
}> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      lines: true,
      attendees: true,
      session: { select: { id: true, eventId: true } },
    },
  });
  if (!order) throw new NotFoundError("Encomenda");
  if (order.status !== "CONFIRMED") {
    throw new BusinessRuleError("Bilhetes só são emitidos após pagamento confirmado.");
  }

  // Idempotência: se já existem bilhetes, não reemite
  const existing = await prisma.ticket.count({ where: { orderId } });
  if (existing > 0) return { tickets: [] };

  const tickets: {
    ticketId: string; ticketNumber: string; qrToken: string; holder: string;
  }[] = [];

  // Um bilhete por titular identificado (quantidade == attendees do tipo)
  for (const attendee of order.attendees) {
    const secret = randomBytes(32).toString("base64url");
    const ticket = await prisma.ticket.create({
      data: {
        organizationId: order.organizationId,
        orderId: order.id,
        sessionId: order.sessionId!,
        ticketTypeId: attendee.ticketTypeId,
        orderAttendeeId: attendee.id,
        ticketNumber: nextTicketNumber(),
        status: "ISSUED",
        qrSecretHash: sha256(secret),
        reentryAllowed: false, // por regras do evento (config futura)
      },
      select: { id: true, ticketNumber: true },
    });
    tickets.push({
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      qrToken: secret, // devolvido UMA vez ao titular
      holder: attendee.fullName,
    });
  }

  await writeAudit({
    organizationId: order.organizationId,
    actorUserId: null,
    action: "ticket.issued",
    after: sanitizeForAudit({ orderId, count: tickets.length }),
  });

  return { tickets };
}

/** Reemite o token QR de um bilhete (apenas titular autenticado). */
export async function getQrToken(ctx: AuthContext, ticketId: string): Promise<string> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { order: { select: { buyerUserId: true } } },
  });
  if (!ticket || ticket.organizationId !== ctx.organizationId) throw new NotFoundError("Bilhetes");
  // Permissão operacional de leitura não concede poder para rotacionar
  // o QR de um comprador. Apenas o comprador pode pedir novo token.
  if (ticket.order.buyerUserId !== ctx.userId) {
    throw new ForbiddenError("not-ticket-holder");
  }
  if (ticket.status !== "ISSUED" && ticket.status !== "USED") {
    throw new BusinessRuleError("Bilhete não está válido.");
  }
  // Nota: o token original foi devolvido na emissão. Para reobter o QR,
  // o backend ROTA o segredo (invalida o anterior) — mesmo mecanismo da
  // transferência. Assim, tokens nunca ficam guardados em claro.
  const secret = randomBytes(32).toString("base64url");
  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { qrSecretHash: sha256(secret), qrRotatedAt: new Date() },
  });
  return secret;
}

/** Solicitar transferência (titular atual; elegibilidade verificada). */
export async function requestTransfer(ctx: AuthContext, input: IssueTransferInput) {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  const ticket = await prisma.ticket.findUnique({
    where: { id: input.ticketId },
    include: { order: { select: { buyerUserId: true } }, session: { select: { startsAt: true } } },
  });
  if (!ticket || ticket.organizationId !== ctx.organizationId) throw new NotFoundError("Bilhete");
  if (ticket.order.buyerUserId !== ctx.userId && !ctx.permissions.has("transfer:approve")) {
    throw new ForbiddenError("not-ticket-holder");
  }
  // Elegibilidade: bilhete emitido e sessão ainda não realizada
  if (ticket.status !== "ISSUED") {
    throw new BusinessRuleError("Bilhete utilizado, cancelado ou reembolsado não é transferível.");
  }
  if (ticket.session.startsAt.getTime() <= Date.now()) {
    throw new BusinessRuleError("Fora do prazo de transferência.");
  }

  const request = await prisma.ticketTransferRequest.create({
    data: {
      organizationId: ctx.organizationId,
      ticketId: ticket.id,
      requesterUserId: ctx.userId,
      newHolderFullName: input.newHolderFullName,
      newHolderEmail: input.newHolderEmail ?? null,
      newHolderPhone: input.newHolderPhone ?? null,
      newHolderDocumentType: input.newHolderDocumentType ?? null,
      newHolderDocumentNumber: input.newHolderDocumentNumber ?? null,
      status: "ELIGIBILITY_CHECK",
    },
    select: { id: true },
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "ticket.transfer_requested",
    after: sanitizeForAudit({ requestId: request.id, ticketId: ticket.id }),
  });

  return request;
}

/** Aprovar/rejeitar transferência: rotação do QR (invalida o anterior). */
export async function decideTransfer(ctx: AuthContext, input: ApproveTransferInput) {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  if (!ctx.permissions.has("transfer:approve")) throw new ForbiddenError("transfer:approve");

  const request = await prisma.ticketTransferRequest.findUnique({
    where: { id: input.requestId },
    include: { ticket: true },
  });
  if (!request || request.organizationId !== ctx.organizationId) {
    throw new NotFoundError("Pedido de transferência");
  }
  if (request.status !== "ELIGIBILITY_CHECK" && request.status !== "AWAITING_CONFIRMATION") {
    throw new ConflictError(`Pedido em estado ${request.status}.`);
  }
  if (request.ticket.status !== "ISSUED") {
    throw new BusinessRuleError("Bilhete deixou de ser elegível.");
  }

  if (input.decision === "REJECT") {
    await prisma.ticketTransferRequest.update({
      where: { id: request.id },
      data: {
        status: "REJECTED",
        rejectionReason: input.rejectionReason ?? "Sem razão indicada.",
        reviewedByUserId: ctx.userId,
      },
    });
    await writeAudit({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "ticket.transfer_rejected",
      after: sanitizeForAudit({ requestId: request.id }),
    });
    return { approved: false };
  }

  const secret = randomBytes(32).toString("base64url");
  const result = await prisma.$transaction(async (tx) => {
    // Novo titular substitui o attendee do bilhete
    const attendee = await tx.orderAttendee.create({
      data: {
        orderId: request.ticket.orderId,
        ticketTypeId: request.ticket.ticketTypeId,
        fullName: request.newHolderFullName,
        email: request.newHolderEmail,
        phone: request.newHolderPhone,
        documentType: request.newHolderDocumentType,
        documentNumber: request.newHolderDocumentNumber,
      },
      select: { id: true },
    });

    await tx.ticket.update({
      where: { id: request.ticket.id },
      data: {
        orderAttendeeId: attendee.id,
        status: "TRANSFERRED",
        qrSecretHash: sha256(secret), // ROTAÇÃO: QR anterior invalidado
        qrRotatedAt: new Date(),
      },
    });

    // TRANSFERRED continua com direito de entrada; volta a ISSUED com novo titular
    await tx.ticket.update({
      where: { id: request.ticket.id },
      data: { status: "ISSUED" },
    });

    return tx.ticketTransferRequest.update({
      where: { id: request.id },
      data: { status: "COMPLETED", reviewedByUserId: ctx.userId, completedAt: new Date() },
      select: { id: true },
    });
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "ticket.transfer_completed",
    after: sanitizeForAudit({ requestId: result.id, ticketId: request.ticketId }),
  });

  return { approved: true, newQrToken: secret };
}

/**
 * Validar QR na portaria — 100% online, sempre no servidor.
 * Regras: sessão correta, abertura de portas, identidade, reentrada.
 */
export async function validateEntry(ctx: AuthContext, input: ValidateQrInput) {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  const organizationId = ctx.organizationId;
  if (!ctx.permissions.has("access:validate")) throw new ForbiddenError("access:validate");

  const gate = await prisma.accessGate.findUnique({
    where: { organizationId_code: { organizationId, code: input.gateCode } },
  });
  if (!gate || !gate.isActive) throw new NotFoundError("Porta");

  const qrHash = sha256(input.qrToken);
  const ticket = await prisma.ticket.findUnique({
    where: { qrSecretHash: qrHash },
    include: {
      session: { select: { id: true, startsAt: true, endsAt: true, doorsOpenAt: true } },
      orderAttendee: { select: { fullName: true } },
      order: { select: { status: true } },
    },
  });

  const now = new Date();

  const deny = async (reason: string) => {
    await prisma.accessEvent.create({
      data: {
        organizationId,
        ticketId: ticket?.id ?? null,
        gateId: gate.id,
        eventType: gate.gateType === "EXIT" ? "EXIT_RECORDED" : "ENTRY_DENIED",
        denialReason: reason as never,
        qrPayloadHash: qrHash,
        validatorUserId: ctx.userId,
        identityVerified: input.identityVerified,
      },
    });
    return { allowed: false, reason };
  };

  if (!ticket) return deny("INVALID_QR");
  if (ticket.organizationId !== ctx.organizationId) return deny("INVALID_QR");

  if (ticket.order.status !== "CONFIRMED" && ticket.order.status !== "PARTIALLY_REFUNDED") {
    return deny("TICKET_CANCELLED");
  }
  if (ticket.status === "CANCELLED" || ticket.status === "EXPIRED") return deny("TICKET_CANCELLED");
  if (ticket.status === "REVOKED") return deny("TICKET_REVOKED");
  if (ticket.status !== "ISSUED" && ticket.status !== "USED") return deny("TICKET_CANCELLED");

  // Sessão correta (WRONG_SESSION)
  if (gate.sessionId && gate.sessionId !== ticket.session.id) {
    return deny("WRONG_SESSION");
  }

  // Horário: portas abertas (NOT_EVENT_DAY)
  const doorsOpen = ticket.session.doorsOpenAt ?? ticket.session.startsAt;
  if (now < doorsOpen || now > ticket.session.endsAt) {
    return deny("NOT_EVENT_DAY");
  }

  if (gate.gateType === "EXIT") {
    if (ticket.status !== "USED") return deny("ALREADY_USED");
    // Saída só é registada uma vez por entrada; update condicional evita
    // duas leituras concorrentes criarem duas saídas válidas.
    const exited = await prisma.$transaction(async (tx) => {
      const claim = await tx.ticket.updateMany({
        where: { id: ticket.id, status: "USED" },
        data: { lastExitAt: now },
      });
      if (claim.count !== 1) return false;
      await tx.accessEvent.create({
        data: {
          organizationId,
          ticketId: ticket.id,
          gateId: gate.id,
          eventType: "EXIT_RECORDED",
          qrPayloadHash: qrHash,
          validatorUserId: ctx.userId,
          identityVerified: input.identityVerified,
        },
      });
      return true;
    });
    if (!exited) return deny("ALREADY_USED");
    return { allowed: true, action: "EXIT_RECORDED", holder: ticket.orderAttendee?.fullName };
  }

  // Entrada / reentrada
  if (ticket.status === "USED") {
    // Reentrada só com permissão e saída registada
    if (ticket.reentryAllowed && ticket.lastExitAt) {
      const reentered = await prisma.$transaction(async (tx) => {
        const claim = await tx.ticket.updateMany({
          where: {
            id: ticket.id,
            status: "USED",
            reentryAllowed: true,
            lastExitAt: ticket.lastExitAt,
          },
          data: { entryCount: { increment: 1 }, lastExitAt: null },
        });
        if (claim.count !== 1) return false;
        await tx.accessEvent.create({
          data: {
            organizationId,
            ticketId: ticket.id,
            gateId: gate.id,
            eventType: "REENTRY_GRANTED",
            qrPayloadHash: qrHash,
            validatorUserId: ctx.userId,
            identityVerified: input.identityVerified,
          },
        });
        return true;
      });
      if (!reentered) return deny("ALREADY_USED");
      return { allowed: true, action: "REENTRY_GRANTED", holder: ticket.orderAttendee?.fullName };
    }
    return deny("ALREADY_USED");
  }

  // IDENTIDADE: tipos com requiresIdentity exigem conferência do validador
  if (input.identityVerified === false) {
    return deny("IDENTITY_MISMATCH");
  }

  // Entrada concedida (transação atômica: ninguça passa duas vezes)
  const entered = await prisma.$transaction(async (tx) => {
    const claim = await tx.ticket.updateMany({
      where: { id: ticket.id, status: "ISSUED" },
      data: { status: "USED", entryCount: { increment: 1 } },
    });
    if (claim.count !== 1) return false;
    await tx.accessEvent.create({
      data: {
        organizationId,
        ticketId: ticket.id,
        gateId: gate.id,
        eventType: "ENTRY_GRANTED",
        qrPayloadHash: qrHash,
        validatorUserId: ctx.userId,
        identityVerified: input.identityVerified,
      },
    });
    return true;
  });
  if (!entered) return deny("ALREADY_USED");

  await writeAudit({
    organizationId,
    actorUserId: ctx.userId,
    action: "access.entry_granted",
    after: sanitizeForAudit({ ticketId: ticket.id, gate: gate.code }),
  });

  return {
    allowed: true,
    action: "ENTRY_GRANTED",
    holder: ticket.orderAttendee?.fullName,
    ticketNumber: ticket.ticketNumber,
  };
}
