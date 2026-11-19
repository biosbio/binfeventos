import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ message: "CRON_SECRET não configurado." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  const { escalateStaleTicketCancellations } = await import("@/modules/finance/ticket-cancellations");
  return NextResponse.json({ ok: true, ...await escalateStaleTicketCancellations() });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
