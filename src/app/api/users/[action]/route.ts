import { NextRequest, NextResponse } from "next/server";
import { errorResponse, ValidationError } from "@/shared/errors";
import { z } from "zod";

// ============================================================
// Módulo users — rotas API (App Router do Next.js)
// Endpoints:
//   POST /api/users/register   — registo público
//   POST /api/users/login      — login (+ MFA quando ativado)
//   POST /api/users/logout     — revoga sessão
//   POST /api/users/mfa/setup  — inicia ativação TOTP (autenticado)
//   POST /api/users/mfa/confirm — confirma MFA
//   POST /api/users/mfa/disable — desativa MFA
//   POST /api/users/password   — altera password
// ============================================================

/** Extrai IP do request (rate limiting de login). */
function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

/** Valida o corpo contra um schema Zod (SEC-09). */
function parseBody<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return result.data;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;

  try {
    switch (action) {
      case "register": {
        const body = parseBody((await import("@/modules/users/schemas")).registerSchema, await req.json());
        const { registerUser } = await import("@/modules/users/service");
        const { id } = await registerUser(body, clientIp(req));
        return NextResponse.json({ ok: true, userId: id }, { status: 201 });
      }

      case "login": {
        const body = parseBody((await import("./schemas")).loginSchema, await req.json());
        const { loginUser } = await import("@/modules/users/service");
        const result = await loginUser(body, clientIp(req));
        return NextResponse.json({ ok: true, ...result });
      }

      case "logout": {
        const { logoutUser } = await import("@/modules/users/service");
        await logoutUser();
        return NextResponse.json({ ok: true });
      }

      case "mfa/setup": {
        const { requireAuth } = await import("@/shared/auth");
        const ctxAuth = await requireAuth();
        const { beginEnableMfa } = await import("@/modules/users/service");
        const result = await beginEnableMfa(ctxAuth.userId);
        return NextResponse.json({ ok: true, ...result });
      }

      case "mfa/confirm": {
        const { requireAuth } = await import("@/shared/auth");
        const ctxAuth = await requireAuth();
        const body = parseBody((await import("./schemas")).enableMfaSchema, await req.json());
        const { confirmEnableMfa } = await import("@/modules/users/service");
        await confirmEnableMfa(ctxAuth.userId, body.totpCode);
        return NextResponse.json({ ok: true });
      }

      case "mfa/disable": {
        const { requireAuth } = await import("@/shared/auth");
        const ctxAuth = await requireAuth();
        const body = parseBody((await import("./schemas")).disableMfaSchema, await req.json());
        const { disableMfa } = await import("@/modules/users/service");
        await disableMfa(ctxAuth.userId, body.totpCode);
        return NextResponse.json({ ok: true });
      }

      case "password": {
        const { requireAuth } = await import("@/shared/auth");
        const ctxAuth = await requireAuth();
        const body = parseBody((await import("./schemas")).changePasswordSchema, await req.json());
        const { changePassword } = await import("@/modules/users/service");
        await changePassword(ctxAuth.userId, body.currentPassword, body.newPassword);
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json(
          { code: "NOT_FOUND", message: "Ação desconhecida." },
          { status: 404 }
        );
    }
  } catch (err) {
    const { status, body } = errorResponse(err);
    return NextResponse.json(body, { status });
  }
}
