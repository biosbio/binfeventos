import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pathModule from "node:path";
import { errorResponse, AppError, ValidationError, NotFoundError, ForbiddenError } from "@/shared/errors";
import { requireAuth, requirePermission } from "@/shared/auth";
import { rateLimit } from "@/shared/lib/security";
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
  "DRAFT", "PUBLISHED", "SUSPENDED", "SOLD_OUT", "POSTPONED", "CANCELLED", "COMPLETED", "CLOSED",
]);
const transitionSchema = z.object({ to: statusSchema });
const MAX_COVER_SIZE = 5 * 1024 * 1024;

function isSupportedImage(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") {
    return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value);
  }
  if (mimeType === "image/webp") {
    return bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  }
  return false;
}

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
    if (path === "upload-cover") {
      const current = await requireAuth();
      const auth = current.platformRole === "PLATFORM_ADMIN"
        ? await requirePermission("admin:platform")
        : await requirePermission("event:create");
      if (await rateLimit(`event-cover-upload:${auth.userId}`, 20, 60 * 60 * 1000)) {
        throw new AppError("RATE_LIMITED", 429, "Limite de carregamentos de imagem atingido. Tente novamente mais tarde.");
      }
      const formData = await req.formData();
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0 || file.size > MAX_COVER_SIZE) {
        throw new ValidationError("Escolha uma imagem até 5 MB.");
      }
      const extensionByType: Record<string, string> = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
      };
      const extension = extensionByType[file.type];
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!extension || !isSupportedImage(bytes, file.type)) {
        throw new ValidationError("Formato de imagem inválido. Use JPEG, PNG ou WebP.");
      }
      const directory = pathModule.join(process.cwd(), "public", "uploads", "event-covers");
      await mkdir(directory, { recursive: true });
      const filename = `${randomUUID()}.${extension}`;
      await writeFile(pathModule.join(directory, filename), bytes, { flag: "wx" });
      return NextResponse.json({ ok: true, url: `/uploads/event-covers/${filename}` }, { status: 201 });
    }

    // POST /api/events/create
    if (path === "create") {
      const auth = await requirePermission("event:create");
      const body = parse((await import("@/modules/events/schemas")).createOrganizerEventSchema, await req.json());
      const { createEvent } = await import("@/modules/events/service");
      const event = await createEvent(auth, body);
      return NextResponse.json({ ok: true, event }, { status: 201 });
    }

    if (path === "platform-create") {
      const auth = await requirePermission("admin:platform");
      const body = parse(
        (await import("@/modules/events/schemas")).createPlatformEventSchema,
        await req.json(),
      );
      const { createPlatformEvent } = await import("@/modules/events/service");
      const event = await createPlatformEvent(auth, body);
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
      const current = await requireAuth();
      const auth = current.platformRole === "PLATFORM_ADMIN"
        ? await requirePermission("admin:platform")
        : await requirePermission("session:manage");
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

      // O administrador central gere todas as decisões de estado de qualquer
      // organização; o step-up TOTP é sempre exigido no painel administrativo.
      const current = await requireAuth();
      if (current.platformRole === "PLATFORM_ADMIN") {
        const auth = await requirePermission("admin:platform");
        const { transitionEvent } = await import("@/modules/events/service");
        return NextResponse.json({ ok: true, ...(await transitionEvent(auth, eventId, body.to)) });
      }
      // A publicação pública nunca pode ser executada pelo organizador.
      if (body.to === "PUBLISHED") {
        throw new ForbiddenError("admin-publication-approval-required");
      }
      if (["SUSPENDED", "SOLD_OUT"].includes(body.to)) {
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

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ action?: string[] }> }) {
  const { action = [] } = await ctx.params;

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

export async function GET(req: NextRequest, ctx: { params: Promise<{ action?: string[] }> }) {
  const { action = [] } = await ctx.params;
  const url = new URL(req.url);

  try {
    // GET /api/events (lista, filtro opcional ?status=PUBLISHED)
    if (action.length === 0) {
      const current = await requireAuth();
      const auth = current.platformRole === "PLATFORM_ADMIN"
        ? await requirePermission("admin:platform")
        : await requirePermission("event:read");
      const { listEvents } = await import("@/modules/events/service");
      const statusParam = url.searchParams.get("status");
      const status = statusParam ? parse(statusSchema, statusParam) : undefined;
      const events = await listEvents(auth, status);
      return NextResponse.json({ ok: true, events });
    }

    // GET /api/events/{id}
    if (action.length === 1) {
      const eventId = parse(UUID, action[0]);
      const current = await requireAuth();
      const auth = current.platformRole === "PLATFORM_ADMIN"
        ? await requirePermission("admin:platform")
        : await requirePermission("event:read");
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
