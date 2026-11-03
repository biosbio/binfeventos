import { NextRequest, NextResponse } from "next/server";
import { errorResponse, ValidationError } from "@/shared/errors";
import { z } from "zod";

// ============================================================
// Módulo users — rotas API (App Router do Next.js)
// Endpoints:
//   POST /api/users/register   — registo público
//   POST /api/users/login      — login (+ MFA obrigatório para administradores)
//   POST /api/users/logout     — revoga sessão
//   POST /api/users/mfa/setup  — inicia ativação TOTP (autenticado)
//   POST /api/users/mfa/confirm — confirma MFA
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
        const body = parseBody((await import("@/modules/users/schemas")).loginSchema, await req.json());
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
        const body = parseBody((await import("@/modules/users/schemas")).enableMfaSchema, await req.json());
        const { confirmEnableMfa } = await import("@/modules/users/service");
        await confirmEnableMfa(ctxAuth.userId, body.totpCode);
        return NextResponse.json({ ok: true });
      }

      case "panel-auth-verify": {
        const { requireAuth } = await import("@/shared/auth");
        const ctxAuth = await requireAuth();
        if (ctxAuth.platformRole === "PLATFORM_ADMIN") {
          const body = parseBody(z.object({ password: z.string().min(1), totpCode: z.string().regex(/^\d{6}$/) }), await req.json());
          const { verifyAdminPanelMfa } = await import("@/modules/users/panel-auth");
          await verifyAdminPanelMfa(ctxAuth, body.password, body.totpCode);
        } else {
          const body = parseBody(z.object({ password: z.string().min(1) }), await req.json());
          const { verifyOrganizerPanelPassword } = await import("@/modules/users/panel-auth");
          await verifyOrganizerPanelPassword(ctxAuth, body.password);
        }
        return NextResponse.json({ ok: true });
      }

      case "password-recovery-start": {
        const body = parseBody((await import("@/modules/users/schemas")).passwordRecoveryStartSchema, await req.json());
        const { startPasswordRecovery } = await import("@/modules/users/password-recovery");
        await startPasswordRecovery(body.email, body.channel, clientIp(req));
        return NextResponse.json({ ok: true, message: "Se a conta e o método forem elegíveis, receberá instruções para recuperar o acesso." });
      }

      case "password-recovery-confirm": {
        const body = parseBody((await import("@/modules/users/schemas")).passwordRecoveryConfirmSchema, await req.json());
        const { completePasswordRecovery } = await import("@/modules/users/password-recovery");
        await completePasswordRecovery(body, clientIp(req));
        return NextResponse.json({ ok: true, message: "Password atualizada. Entre novamente com a nova password." });
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
