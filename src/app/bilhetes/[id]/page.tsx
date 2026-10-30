import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/shared/lib/prisma";
import { requireAuth } from "@/shared/auth";
import { SiteHeader, SiteFooter } from "../../_components/site-shell";

export const dynamic = "force-dynamic";

// ============================================================
// Página do bilhete: mostra dados públicos do bilhete + o QR
// carregado como IMAGEM da rota que roda o segredo no servidor.
// O token plano nunca chega ao browser em texto (SEC-18).
// ============================================================

const TICKET_LABELS: Record<string, string> = {
  ISSUED: "Válido",
  USED: "Utilizado",
  TRANSFERRED: "Transferido",
  CANCELLED: "Cancelado",
  EXPIRED: "Expirado",
  REVOKED: "Revogado",
};

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let ticket;
  try {
    const auth = await requireAuth();

    // Escopo: bilhete da organização do contexto E comprador = utilizador
    ticket = await prisma.ticket.findUnique({
      where: { id },
      select: {
        id: true,
        ticketNumber: true,
        status: true,
        entryCount: true,
        reentryAllowed: true,
        orderAttendee: { select: { fullName: true } },
        ticketType: { select: { name: true, category: true, requiresIdentity: true } },
        session: {
          select: {
            startsAt: true,
            endsAt: true,
            doorsOpenAt: true,
            event: { select: { name: true, slug: true, entryRules: true } },
          },
        },
        order: { select: { buyerUserId: true, orderNumber: true } },
      },
    });

    if (!ticket || ticket.order.buyerUserId !== auth.userId) {
      if (!ticket || !auth.permissions.has("ticket:read")) notFound();
    }
  } catch {
    redirect("/login");
  }

  const startsAt = new Intl.DateTimeFormat("pt-PT", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ticket!.session.startsAt);

  return (
    <>
      <SiteHeader />
      <main className="container" style={{ padding: "45px 0 70px", maxWidth: 640 }}>
        <div className="breadcrumb">
          <Link href="/minha-conta">← A minha conta</Link>
        </div>

        <div className="panel" style={{ marginTop: 22, textAlign: "center" }}>
          <span className="section-kicker">{ticket!.session.event.name}</span>
          <h1 style={{ margin: "10px 0 4px", fontSize: 30, letterSpacing: "-.04em" }}>
            {ticket!.ticketType.name}
          </h1>
          <p className="form-help">{startsAt}</p>

          <div
            style={{
              display: "inline-block",
              margin: "20px auto",
              padding: 14,
              borderRadius: 18,
              background: "#fff",
              border: "1px solid var(--line)",
            }}
          >
            {/* QR gerado no servidor (SVG); cada acesso roda o segredo */}
            <img
              src={`/api/access/tickets/${ticket!.id}/qr-image`}
              alt="QR Code do bilhete"
              width={260}
              height={260}
            />
          </div>

          <div style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
            <p style={{ margin: "0 0 6px", fontWeight: 800 }}>
              Titular: {ticket!.orderAttendee?.fullName}
            </p>
            <p className="form-help">
              {ticket!.ticketNumber} · {TICKET_LABELS[ticket!.status] ?? ticket!.status}
              {ticket!.reentryAllowed ? " · Reentrada permitida" : ""}
            </p>
          </div>

          {ticket!.ticketType.requiresIdentity ? (
            <p className="notice" style={{ marginTop: 14, textAlign: "left" }}>
              Este bilhete exige identificação do titular na entrada. Apresente
              o QR e um documento com foto.
            </p>
          ) : null}

          <p className="form-help" style={{ marginTop: 12 }}>
            Encomenda {ticket!.order.orderNumber} · Cada consulta deste QR
            gera um código novo — o anterior deixa de funcionar.
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
