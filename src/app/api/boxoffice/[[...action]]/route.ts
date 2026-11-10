import { NextRequest, NextResponse } from "next/server";
import { errorResponse, NotFoundError, ValidationError } from "@/shared/errors";
import { requirePanelAuth, requirePermission } from "@/shared/auth";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma";
import { randomUUID } from "node:crypto";

// ============================================================
// Módulo boxoffice — rotas API
//   POST /api/boxoffice/shifts/open    — abrir turno (shift:open)
//   POST /api/boxoffice/shifts/close   — fechar turno (shift:close)
//   POST /api/boxoffice/shifts/movement — movimento de caixa (cash:movement)
//   POST /api/boxoffice/sale           — venda presencial (boxoffice:sell)
// ============================================================

function parse<TSchema extends z.ZodType>(schema: TSchema, data: unknown): z.output<TSchema> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new ValidationError(
      r.error.issues.map((i) => `${i.path.map((part) => String(part)).join(".")}: ${i.message}`).join("; ")
    );
  }
  return r.data;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ action?: string[] }> }) {
  const { action = [] } = await ctx.params;
  const path = action.join("/");

  try {
    if (path === "stations") {
      const auth = await requirePermission("venue:manage");
      if (!auth.organizationId) throw new ValidationError("Selecione uma organização.");
      const body = parse(z.object({
        name: z.string().trim().min(2).max(100),
        location: z.string().trim().min(2).max(120),
        eventId: z.string().uuid(),
        venueId: z.string().uuid(),
      }), await req.json());
      const session = await prisma.eventSession.findFirst({
        where: {
          eventId: body.eventId,
          venueId: body.venueId,
          event: { organizationId: auth.organizationId },
        },
        select: { id: true },
      });
      if (!session) throw new ValidationError("Selecione um local associado a uma sessão desse evento.");
      const code = `CX-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
      const station = await prisma.boxOfficeStation.create({
        data: { organizationId: auth.organizationId, venueId: body.venueId, name: body.name, location: body.location, code },
        select: { code: true, name: true, location: true, status: true, venue: { select: { name: true } } },
      });
      return NextResponse.json({ ok: true, station }, { status: 201 });
    }

    if (action.length === 2 && action[0] === "stations") {
      if (req.method !== "PATCH" && req.method !== "DELETE") {
        return NextResponse.json({ code: "METHOD_NOT_ALLOWED", message: "Método não permitido." }, { status: 405 });
      }
      const auth = await requirePermission("venue:manage");
      if (!auth.organizationId) throw new ValidationError("Selecione uma organização.");
      const code = parse(z.string().min(2).max(40), action[1]);
      const station = await prisma.boxOfficeStation.findUnique({
        where: { organizationId_code: { organizationId: auth.organizationId, code } },
        select: { id: true },
      });
      if (!station) throw new NotFoundError("Posto");

      if (req.method === "PATCH") {
        const body = parse(z.object({
          name: z.string().trim().min(2).max(100),
          location: z.string().trim().min(2).max(120),
          eventId: z.string().uuid(),
          venueId: z.string().uuid(),
        }), await req.json());
        const session = await prisma.eventSession.findFirst({
          where: {
            eventId: body.eventId,
            venueId: body.venueId,
            event: { organizationId: auth.organizationId },
          },
          select: { id: true },
        });
        if (!session) throw new ValidationError("Selecione um local associado a uma sessão desse evento.");
        const updated = await prisma.boxOfficeStation.update({
          where: { id: station.id },
          data: { name: body.name, location: body.location, venueId: body.venueId, status: "ACTIVE" },
          select: { code: true, name: true, location: true, status: true, venue: { select: { name: true } } },
        });
        return NextResponse.json({ ok: true, station: updated });
      }

      const shiftCount = await prisma.cashShift.count({ where: { stationId: station.id } });
      if (shiftCount > 0) {
        await prisma.boxOfficeStation.update({ where: { id: station.id }, data: { status: "SUSPENDED" } });
      } else {
        await prisma.boxOfficeStation.delete({ where: { id: station.id } });
      }
      return NextResponse.json({ ok: true });
    }

    if (path === "shifts/open") {
      const auth = await requirePanelAuth();
      const body = parse((await import("@/modules/boxoffice/schemas")).openShiftSchema, await req.json());
      const { openShift } = await import("@/modules/boxoffice/service");
      const shift = await openShift(auth, body);
      return NextResponse.json({ ok: true, shift }, { status: 201 });
    }

    if (path === "shifts/close") {
      const auth = await requirePanelAuth();
      const raw = await req.json();
      // Notas obrigatórias quando há diferença: validação dupla (servidor)
      const body = parse((await import("@/modules/boxoffice/schemas")).closeShiftSchema, raw);
      const { closeShift } = await import("@/modules/boxoffice/service");
      const result = await closeShift(auth, body);
      return NextResponse.json({ ok: true, ...result });
    }

    if (path === "shifts/movement") {
      const auth = await requirePanelAuth();
      const body = parse((await import("@/modules/boxoffice/schemas")).cashMovementSchema, await req.json());
      const { registerCashMovement } = await import("@/modules/boxoffice/service");
      await registerCashMovement(auth, body);
      return NextResponse.json({ ok: true });
    }

    if (path === "sale") {
      const auth = await requirePanelAuth();
      const body = parse((await import("@/modules/boxoffice/schemas")).boxOfficeSaleSchema, await req.json());
      const { boxOfficeSale } = await import("@/modules/boxoffice/service");
      const order = await boxOfficeSale(auth, body);
      return NextResponse.json({ ok: true, order }, { status: 201 });
    }

    return NextResponse.json({ code: "NOT_FOUND", message: "Ação desconhecida." }, { status: 404 });
  } catch (err) {
    const { status, body } = errorResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ action?: string[] }> }) {
  return POST(req, ctx);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ action?: string[] }> }) {
  return POST(req, ctx);
}
