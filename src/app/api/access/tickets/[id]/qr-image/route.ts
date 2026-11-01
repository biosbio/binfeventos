import { NextRequest, NextResponse } from "next/server";
import { errorResponse, ForbiddenError } from "@/shared/errors";
import { requireAuth } from "@/shared/auth";

// ============================================================
// GET /api/access/tickets/{id}/qr-image
// Devolve o QR como SVG (desenhável no browser), gerado com o
// token ROTADO no servidor. O token plano nunca é devolvido em
// JSON nem persistido — só o SVG renderizado (SEC-18).
// ============================================================

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id: ticketId } = await ctx.params;

    const auth = await requireAuth();
    const { getQrToken } = await import("@/modules/access/service");
    const token = await getQrToken(auth, ticketId);

    // Gera o SVG no servidor; o browser recebe apenas a imagem
    const QRCode = (await import("qrcode")).default;
    const svg = await QRCode.toString(token, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 320,
    });

    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "no-store", // QR rotativo: nunca cachear
      },
    });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      const { status, body } = errorResponse(err);
      return NextResponse.json(body, { status });
    }
    const { status, body } = errorResponse(err);
    return NextResponse.json(body, { status });
  }
}
