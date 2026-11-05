import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/shared/auth";
import { prisma } from "@/shared/lib/prisma";
import { SiteFooter, SiteHeader } from "@/app/_components/site-shell";

export const dynamic = "force-dynamic";

export default async function CheckoutReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order: orderId } = await searchParams;
  const auth = await getAuthContext();
  if (!auth) redirect("/login");
  if (!orderId) notFound();
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      buyerUserId: true,
      channel: true,
      orderNumber: true,
      status: true,
      totalCents: true,
      currency: true,
      cashShift: { select: { operatorUserId: true } },
    },
  });
  if (!order) notFound();
  const isBuyer = order.buyerUserId === auth.userId;
  const isCashier = order.channel === "BOX_OFFICE" && order.cashShift?.operatorUserId === auth.userId;
  if (!isBuyer && !isCashier) notFound();
  const isConfirmed = order.status === "CONFIRMED";

  return (
    <>
      <SiteHeader />
      <main className="container checkout-page">
        <span className="section-kicker">ESTADO DO PAGAMENTO</span>
        <h1>{isConfirmed ? "Pagamento confirmado" : "Pagamento em processamento"}</h1>
        <section className="panel checkout-panel">
          <strong>Encomenda {order.orderNumber}</strong>
          <p>{isConfirmed
            ? "O pagamento foi confirmado e os bilhetes foram emitidos."
            : "Aguarde a confirmação do prestador. Se esta página continuar aberta, atualize-a para consultar o estado mais recente."}</p>
          <div className="ticket-row">
            <span>Total</span>
            <strong>{new Intl.NumberFormat("pt-PT", { style: "currency", currency: order.currency }).format(order.totalCents / 100)}</strong>
          </div>
          <Link className="button button-primary" href={isCashier ? "/bilheteira" : "/minha-conta"}>
            {isCashier ? "Voltar à bilheteira" : "Ver os meus bilhetes"}
          </Link>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
