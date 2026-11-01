import { randomBytes } from "crypto";
import { prisma } from "@/shared/lib/prisma";
import { sha256 } from "@/shared/lib/security";
import {
  AppError,
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
  const result = await prisma.$transaction(async (tx) => {
    // Serializa a emissão por encomenda e evita emissão parcial.
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "orders" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new NotFoundError("Encomenda");

    const order = await tx.order.findUnique({
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
    if (!order.sessionId || !order.session) {
      throw new BusinessRuleError("Encomenda sem sessão válida; emissão bloqueada.");
    }
    // Uma transferência concluída implica que a emissão original já existia.
    // Evita recriar bilhetes para titulares antigos deixados por versões anteriores.
    const completedTransfer = await tx.ticketTransferRequest.findFirst({
      where: { status: "COMPLETED", ticket: { orderId } },
      select: { id: true },
    });
    if (completedTransfer) return { tickets: [] };

    const alreadyIssued = await tx.ticket.findMany({
      where: { orderId },
      select: { orderAttendeeId: true },
    });
    const issuedAttendeeIds = new Set(
      alreadyIssued.flatMap((ticket) => ticket.orderAttendeeId ? [ticket.orderAttendeeId] : [])
    );

    const tickets: {
      ticketId: string; ticketNumber: string; qrToken: string; holder: string;
    }[] = [];

    // Recupera emissões parciais antigas sem duplicar titulares.
    for (const attendee of order.attendees) {
      if (issuedAttendeeIds.has(attendee.id)) continue;
      const secret = randomBytes(32).toString("base64url");
      const ticket = await tx.ticket.create({
        data: {
          organizationId: order.organizationId,
          orderId: order.id,
          sessionId: order.sessionId,
          ticketTypeId: attendee.ticketTypeId,
          orderAttendeeId: attendee.id,
          holderUserId: order.buyerUserId,
          holderEmail: attendee.email,
          holderName: attendee.fullName,
          ticketNumber: nextTicketNumber(),
          status: "ISSUED",
          qrSecretHash: sha256(secret),
          reentryAllowed: false,
        },
        select: { id: true, ticketNumber: true },
      });
      tickets.push({
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        qrToken: secret,
        holder: attendee.fullName,
      });
    }

    return { organizationId: order.organizationId, tickets };
  });

  if (result.tickets.length > 0) {
    await writeAudit({
      organizationId: result.organizationId,
      actorUserId: null,
      action: "ticket.issued",
      after: sanitizeForAudit({ orderId, count: result.tickets.length }),
    });
  }

  return { tickets: result.tickets };
}

/** Lista os bilhetes cujo titular atual é o utilizador autenticado. */
export async function listMyTickets(ctx: AuthContext) {
  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { email: true },
  });
  if (!user) throw new NotFoundError("Utilizador");
  return prisma.ticket.findMany({
    where: {
      status: { in: ["ISSUED", "USED"] },
      OR: [
        { holderUserId: ctx.userId },
        { holderUserId: null, holderEmail: user.email.toLowerCase() },
      ],
    },
    orderBy: { issuedAt: "desc" },
    select: {
      id: true,
      ticketNumber: true,
      status: true,
      holderName: true,
      holderEmail: true,
      sessionId: true,
      ticketTypeId: true,
      issuedAt: true,
    },
  });
}

/** Reemite o token QR de um bilhete (apenas titular autenticado). */
export async function getQrToken(ctx: AuthContext, ticketId: string): Promise<string> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "tickets" WHERE "id" = ${ticketId}::uuid FOR UPDATE`;
    const [ticket, user] = await Promise.all([
      tx.ticket.findUnique({
        where: { id: ticketId },
        include: { order: { select: { buyerUserId: true } } },
      }),
      tx.user.findUnique({ where: { id: ctx.userId }, select: { email: true } }),
    ]);
    if (!ticket || !user) throw new NotFoundError("Bilhete");
    if (ticket.status !== "ISSUED" && ticket.status !== "USED") {
      throw new BusinessRuleError("Bilhete não está válido.");
    }

    const emailMatches =
      !ticket.holderUserId &&
      !!ticket.holderEmail &&
      ticket.holderEmail.toLowerCase() === user.email.toLowerCase();
    const legacyBuyer =
      !ticket.holderUserId && !ticket.holderEmail && ticket.order.buyerUserId === ctx.userId;
    if (ticket.holderUserId !== ctx.userId && !emailMatches && !legacyBuyer) {
      throw new ForbiddenError("not-current-ticket-holder");
    }

    // Associa o titular que acabou de autenticar com o email de destino.
    if (!ticket.holderUserId) {
      const bound = await tx.ticket.updateMany({
        where: {
          id: ticket.id,
          holderUserId: null,
          holderEmail: ticket.holderEmail,
          status: { in: ["ISSUED", "USED"] },
        },
        data: { holderUserId: ctx.userId },
      });
      if (bound.count !== 1) throw new ConflictError("Titular do bilhete foi alterado.");
    }

    const secret = randomBytes(32).toString("base64url");
    const rotated = await tx.ticket.updateMany({
      where: { id: ticket.id, holderUserId: ctx.userId, status: { in: ["ISSUED", "USED"] } },
      data: { qrSecretHash: sha256(secret), qrRotatedAt: new Date() },
    });
    if (rotated.count !== 1) throw new ConflictError("Não foi possível renovar o QR deste titular.");
    return secret;
  });
}

/** Solicitar transferência (titular atual; elegibilidade verificada). */
export async function requestTransfer(ctx: AuthContext, input: IssueTransferInput) {
  if (!input.newHolderEmail) {
    throw new BusinessRuleError("O email do novo titular é obrigatório para concluir a transferência.");
  }
  const request = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "tickets" WHERE "id" = ${input.ticketId}::uuid FOR UPDATE`;
    const [ticket, user] = await Promise.all([
      tx.ticket.findUnique({
        where: { id: input.ticketId },
        include: { order: { select: { buyerUserId: true } }, session: { select: { startsAt: true } } },
      }),
      tx.user.findUnique({ where: { id: ctx.userId }, select: { email: true } }),
    ]);
    if (!ticket || !user) throw new NotFoundError("Bilhete");
    const emailMatches =
      !ticket.holderUserId &&
      !!ticket.holderEmail &&
      ticket.holderEmail.toLowerCase() === user.email.toLowerCase();
    const legacyBuyer =
      !ticket.holderUserId && !ticket.holderEmail && ticket.order.buyerUserId === ctx.userId;
    if (ticket.holderUserId !== ctx.userId && !emailMatches && !legacyBuyer) {
      throw new ForbiddenError("not-current-ticket-holder");
    }
    if (input.newHolderEmail.toLowerCase() === user.email.toLowerCase()) {
      throw new BusinessRuleError("O novo titular deve ser diferente do titular atual.");
    }
    if (ticket.status !== "ISSUED") {
      throw new BusinessRuleError("Bilhete utilizado, cancelado ou reembolsado não é transferível.");
    }
    if (ticket.session.startsAt.getTime() <= Date.now()) {
      throw new BusinessRuleError("Fora do prazo de transferência.");
    }
    if (!ticket.holderUserId) {
      const bound = await tx.ticket.updateMany({
        where: { id: ticket.id, holderUserId: null, holderEmail: ticket.holderEmail, status: "ISSUED" },
        data: { holderUserId: ctx.userId },
      });
      if (bound.count !== 1) throw new ConflictError("Titular do bilhete foi alterado.");
    }
    const pending = await tx.ticketTransferRequest.findFirst({
      where: {
        ticketId: ticket.id,
        status: { in: ["REQUESTED", "ELIGIBILITY_CHECK", "AWAITING_CONFIRMATION"] },
      },
      select: { id: true },
    });
    if (pending) throw new ConflictError("Já existe um pedido de transferência pendente.");

    return tx.ticketTransferRequest.create({
      data: {
        organizationId: ticket.organizationId,
        ticketId: ticket.id,
        requesterUserId: ctx.userId,
        newHolderFullName: input.newHolderFullName,
        newHolderEmail: input.newHolderEmail.toLowerCase(),
        newHolderPhone: input.newHolderPhone ?? null,
        newHolderDocumentType: input.newHolderDocumentType ?? null,
        newHolderDocumentNumber: input.newHolderDocumentNumber ?? null,
        status: "ELIGIBILITY_CHECK",
      },
      select: { id: true, organizationId: true, ticketId: true },
    });
  });

  await writeAudit({
    organizationId: request.organizationId,
    actorUserId: ctx.userId,
    action: "ticket.transfer_requested",
    after: sanitizeForAudit({ requestId: request.id, ticketId: request.ticketId }),
  });
  return { id: request.id };
}

/** Aprovar/rejeitar transferência: rotação do QR (invalida o anterior). */
export async function decideTransfer(ctx: AuthContext, input: ApproveTransferInput) {
  if (!ctx.organizationId) throw new ForbiddenError("no-active-organization");
  if (!ctx.permissions.has("transfer:approve")) throw new ForbiddenError("transfer:approve");
  if (!ctx.panelVerifiedUntil || ctx.panelVerifiedUntil.getTime() <= Date.now()) {
    throw new AppError("PANEL_STEP_UP_REQUIRED", 401, "Autenticação reforçada necessária.");
  }

  const request = await prisma.ticketTransferRequest.findUnique({
    where: { id: input.requestId },
    include: { ticket: { include: { session: { select: { startsAt: true } } } } },
  });
  if (!request || request.organizationId !== ctx.organizationId) {
    throw new NotFoundError("Pedido de transferência");
  }
  if (request.status !== "ELIGIBILITY_CHECK" && request.status !== "AWAITING_CONFIRMATION") {
    throw new ConflictError(`Pedido em estado ${request.status}.`);
  }
  if (request.ticket.status !== "ISSUED" || request.ticket.holderUserId !== request.requesterUserId) {
    throw new BusinessRuleError("O titular mudou; este pedido de transferência já não é elegível.");
  }

  if (input.decision === "REJECT") {
    const rejected = await prisma.ticketTransferRequest.updateMany({
      where: {
        id: request.id,
        organizationId: ctx.organizationId,
        status: { in: ["ELIGIBILITY_CHECK", "AWAITING_CONFIRMATION"] },
      },
      data: {
        status: "REJECTED",
        rejectionReason: input.rejectionReason ?? "Sem razão indicada.",
        reviewedByUserId: ctx.userId,
      },
    });
    if (rejected.count !== 1) throw new ConflictError("Pedido já foi processado.");
    await writeAudit({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "ticket.transfer_rejected",
      after: sanitizeForAudit({ requestId: request.id }),
    });
    return { approved: false };
  }

  if (!request.newHolderEmail) throw new BusinessRuleError("Pedido sem email do novo titular.");
  const secret = randomBytes(32).toString("base64url");
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "tickets" WHERE "id" = ${request.ticketId}::uuid FOR UPDATE`;
    const fresh = await tx.ticketTransferRequest.findUnique({
      where: { id: request.id },
      include: { ticket: { include: { session: { select: { startsAt: true } } } } },
    });
    if (
      !fresh ||
      fresh.organizationId !== ctx.organizationId ||
      !["ELIGIBILITY_CHECK", "AWAITING_CONFIRMATION"].includes(fresh.status) ||
      fresh.ticket.status !== "ISSUED" ||
      fresh.ticket.holderUserId !== fresh.requesterUserId ||
      fresh.ticket.session.startsAt.getTime() <= Date.now()
    ) {
      throw new ConflictError("Titular ou estado do pedido foi alterado.");
    }
    if (!fresh.newHolderEmail) throw new BusinessRuleError("Pedido sem email do novo titular.");
    const newHolderEmail = newHolderEmail;

    const recipient = await tx.user.findUnique({
      where: { email: newHolderEmail },
      select: { id: true },
    });
    const attendee = fresh.ticket.orderAttendeeId
      ? await tx.orderAttendee.update({
          where: { id: fresh.ticket.orderAttendeeId },
          data: {
            fullName: fresh.newHolderFullName,
            email: newHolderEmail,
            phone: fresh.newHolderPhone,
            documentType: fresh.newHolderDocumentType,
            documentNumber: fresh.newHolderDocumentNumber,
          },
          select: { id: true },
        })
      : await tx.orderAttendee.create({
          data: {
            orderId: fresh.ticket.orderId,
            ticketTypeId: fresh.ticket.ticketTypeId,
            fullName: fresh.newHolderFullName,
            email: newHolderEmail,
            phone: fresh.newHolderPhone,
            documentType: fresh.newHolderDocumentType,
            documentNumber: fresh.newHolderDocumentNumber,
          },
          select: { id: true },
        });

    const claimed = await tx.ticket.updateMany({
      where: {
        id: fresh.ticketId,
        status: "ISSUED",
        holderUserId: fresh.ticket.holderUserId,
        holderEmail: fresh.ticket.holderEmail,
      },
      data: {
        status: "TRANSFERRED",
        orderAttendeeId: attendee.id,
        holderUserId: recipient?.id ?? null,
        holderEmail: newHolderEmail,
        holderName: fresh.newHolderFullName,
        qrSecretHash: sha256(secret),
        qrRotatedAt: new Date(),
      },
    });
    if (claimed.count !== 1) throw new ConflictError("Bilhete já foi transferido por outro pedido.");

    await tx.ticket.updateMany({
      where: { id: fresh.ticketId, status: "TRANSFERRED" },
      data: { status: "ISSUED" },
    });
    const completed = await tx.ticketTransferRequest.updateMany({
      where: {
        id: fresh.id,
        status: { in: ["ELIGIBILITY_CHECK", "AWAITING_CONFIRMATION"] },
      },
      data: { status: "COMPLETED", reviewedByUserId: ctx.userId, completedAt: new Date() },
    });
    if (completed.count !== 1) throw new ConflictError("Pedido já foi concluído.");

    await tx.ticketTransferRequest.updateMany({
      where: {
        ticketId: fresh.ticketId,
        id: { not: fresh.id },
        status: { in: ["REQUESTED", "ELIGIBILITY_CHECK", "AWAITING_CONFIRMATION"] },
      },
      data: { status: "CANCELLED" },
    });
    return { id: fresh.id, ticketId: fresh.ticketId };
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "ticket.transfer_completed",
    after: sanitizeForAudit({ requestId: result.id, ticketId: result.ticketId }),
  });
  return { approved: true, ticketId: result.ticketId, newQrToken: secret };
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
        where: { id: ticket.id, status: "USED", lastExitAt: null },
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
