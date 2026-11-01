import { NextRequest, NextResponse } from "next/server";
import { errorResponse, ValidationError, NotFoundError } from "@/shared/errors";
import { requirePermission } from "@/shared/auth";
import { z } from "zod";

// ============================================================
// Módulo events — rotas API
//   POST /api/events                     — criar (event:create)
//   GET  /api/events                    — listar (event:read)
//   GET  /api/events/{id}               — detalhe (event:read)
//   PATCH /api/events/{id}              — editar (event:update)
//   POST /api/events/{id}/transition    — mudar estado (por destino)
//   POST /api/events/{id}/sessions      — adicionar sessão (session:manage)
//   POST /api/events/venues             — criar recinto (venue:manage)
// ============================================================

const UUID = z.string().uuid();
const statusSchema = z.enum([
  "PUBLISHED", "SUSPENDED", "SOLD_OUT", "POSTPONED", "CANCELLED", "COMPLETED", "CLOSED",
]);
const transitionSchema = z.object({ to: statusSchema });

function parse<T>(schema: { safeParse: (d: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } } }, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new ValidationError(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return r.data;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string[] }> }) {
  const { action } = await ctx.params;
  const path = action.join("/");

  try {
    // POST /api/events/create
    if (path === "create") {
      const auth = await requirePermission("event:create");
      const body = parse((await import("@/modules/events/schemas")).createEventSchema, await req.json());
      const { createEvent } = await import("@/modules/events/service");
      const event = await createEvent(auth, body);
      return NextResponse.json({ ok: true, event }, { status: 201 });
    }

    // POST /api/events/venues
    if (path === "venues") {
      const auth = await requirePermission("venue:manage");
      const body = parse((await import("@/modules/events/schemas")).venueSchema, await req.json());
      const { createVenue } = await import("@/modules/events/service");
      const venue = await createVenue(auth, body);
      return NextResponse.json({ ok: true, venue }, { status: 201 });
    }

    // POST /api/events/{id}/sessions
    if (action.length === 2 && action[1] === "sessions") {
      const auth = await requirePermission("session:manage");
      const eventId = parse(UUID, action[0]);
      const raw = (await req.json()) as Record<string, unknown>;
      const body = parse((await import("@/modules/events/schemas")).sessionSchema, { ...raw, eventId });
      const { addSession } = await import("@/modules/events/service");
      const session = await addSession(auth, body);
      return NextResponse.json({ ok: true, session }, { status: 201 });
    }

    // POST /api/events/{id}/transition
    if (action.length === 2 && action[1] === "transition") {
      const eventId = parse(UUID, action[0]);
      const body = parse(transitionSchema, await req.json());

      // Permissão conforme o destino:
      // publish/sold_out -> event:publish; cancel/postpone -> event:cancel
      if (["PUBLISHED", "SUSPENDED", "SOLD_OUT"].includes(body.to)) {
        const auth = await requirePermission("event:publish");
        const { transitionEvent } = await import("@/modules/events/service");
        return NextResponse.json({ ok: true, ...(await transitionEvent(auth, eventId, body.to)) });
      }
      if (["CANCELLED", "POSTPONED"].includes(body.to)) {
        const auth = await requirePermission("event:cancel");
        const { transitionEvent } = await import("@/modules/events/service");
        return NextResponse.json({ ok: true, ...(await transitionEvent(auth, eventId, body.to)) });
      }
      // COMPLETED/CLOSED: encerramento exige administrador
      const auth = await requirePermission("org:manage");
      const { transitionEvent } = await import("@/modules/events/service");
      return NextResponse.json({ ok: true, ...(await transitionEvent(auth, eventId, body.to)) });
    }

    return NextResponse.json({ code: "NOT_FOUND", message: "Ação desconhecida." }, { status: 404 });
  } catch (err) {
    const { status, body } = errorResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ action: string[] }> }) {
  const { action } = await ctx.params;
  const path = action.join("/");

  try {
    // PATCH /api/events/{id}
    if (action.length === 1) {
      const eventId = parse(UUID, action[0]);
      const auth = await requirePermission("event:update");
      const body = parse((await import("@/modules/events/schemas")).updateEventSchema, await req.json());
      const { updateEvent } = await import("@/modules/events/service");
      await updateEvent(auth, eventId, body);
      return NextResponse.json({ ok: true });
    }

    throw new NotFoundError("Rota");
  } catch (err) {
    const { status, body } = errorResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ action: string[] }> }) {
  const { action } = await ctx.params;
  const url = new URL(req.url);

  try {
    // GET /api/events (lista, filtro opcional ?status=PUBLISHED)
    if (action.length === 0) {
      const auth = await requirePermission("event:read");
      const { listEvents } = await import("@/modules/events/service");
      const statusParam = url.searchParams.get("status");
      const status = statusParam ? parse(statusSchema, statusParam) : undefined;
      const events = await listEvents(auth, status);
      return NextResponse.json({ ok: true, events });
    }

    // GET /api/events/{id}
    if (action.length === 1) {
      const eventId = parse(UUID, action[0]);
      const auth = await requirePermission("event:read");
      const { getEvent } = await import("@/modules/events/service");
      const event = await getEvent(auth, eventId);
      return NextResponse.json({ ok: true, event });
    }

    throw new NotFoundError("Rota");
  } catch (err) {
    const { status, body } = errorResponse(err);
    return NextResponse.json(body, { status });
  }
}
