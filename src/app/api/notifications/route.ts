import { NextRequest, NextResponse } from "next/server";
import { errorResponse, ValidationError } from "@/shared/errors";
import { requireAuth } from "@/shared/auth";
import { z } from "zod";

// ============================================================
// Rotas de notificações do utilizador (Domínio 10)
//   GET  /api/notifications            — minhas IN_APP (?unread=1)
//   POST /api/notifications/read       — marcar lida
//   POST /api/notifications/preference — opt-out por tipo+canal
// Enviar notificações é AÇÃO INTERNA dos módulos (nunca rota pública).
// ============================================================

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new ValidationError(
      r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    );
  }
  return r.data;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth();
    const { listMyNotifications, listMyNotificationsSchema } = await import(
      "@/modules/notifications/service"
    ).then(async (m) => ({
      listMyNotifications: m.listMyNotifications,
      listMyNotificationsSchema: (await import("@/modules/notifications/schemas"))
        .listMyNotificationsSchema,
    }));
    const onlyUnread = req.nextUrl.searchParams.get("unread") === "1";
    const input = parse(listMyNotificationsSchema, {
      onlyUnread,
      limit: Number(req.nextUrl.searchParams.get("limit") ?? 30),
    });
    const items = await listMyNotifications(ctx, input);
    return NextResponse.json({ ok: true, items });
  } catch (err) {
    const { status, body } = errorResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function POST(req: NextRequest) {
  const { action } = await req.json().catch(() => ({ action: undefined as string | undefined }));
  try {
    const ctx = await requireAuth();
    const svc = await import("@/modules/notifications/service");
    const schemas = await import("@/modules/notifications/schemas");
    const body = await req.clone().json().catch(() => ({}));

    if (action === "read") {
      const input = parse(schemas.markReadSchema, body);
      await svc.markNotificationRead(ctx, input);
      return NextResponse.json({ ok: true });
    }

    if (action === "preference") {
      const input = parse(schemas.preferenceSchema, body);
      await svc.setNotificationPreference(ctx, input);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ code: "NOT_FOUND", message: "Ação desconhecida." }, { status: 404 });
  } catch (err) {
    const { status, body } = errorResponse(err);
    return NextResponse.json(body, { status });
  }
}
