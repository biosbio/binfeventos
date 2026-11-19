import Link from "next/link";
import { prisma } from "@/shared/lib/prisma";
import LogoutButton from "../../_components/logout-button";
import ProposalActions from "./proposal-actions";
import EventAdminActions from "./event-admin-actions";
import PaymentAgreementActions from "./payment-agreement-actions";

export const dynamic = "force-dynamic";

const FILTERS = {
  upcoming: { label: "A realizar", statuses: ["PUBLISHED", "SUSPENDED", "SOLD_OUT", "POSTPONED"] as const },
  completed: { label: "Realizados", statuses: ["COMPLETED", "CLOSED"] as const },
  cancelled: { label: "Cancelados", statuses: ["CANCELLED"] as const },
  drafts: { label: "Propostas", statuses: ["DRAFT"] as const },
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Em análise",
  PUBLISHED: "Publicado",
  SUSPENDED: "Suspenso",
  SOLD_OUT: "Esgotado",
  POSTPONED: "Adiado",
  CANCELLED: "Cancelado",
  COMPLETED: "Realizado",
  CLOSED: "Encerrado",
};

type FilterKey = keyof typeof FILTERS;

export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const { estado } = await searchParams;
  const filterKey: FilterKey = estado && estado in FILTERS ? estado as FilterKey : "upcoming";
  const filter = FILTERS[filterKey];
  const [events, counts] = await Promise.all([
    prisma.event.findMany({
      where: { status: { in: [...filter.statuses] } },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      category: true,
      status: true,
      createdAt: true,
      organization: { select: { name: true, currency: true } },
      paymentAgreement: { select: { mode: true, value: true, currency: true } },
      sessions: {
        select: {
          startsAt: true,
          endsAt: true,
          orders: {
            where: { status: { in: ["CONFIRMED", "PARTIALLY_REFUNDED", "REFUNDED"] } },
            select: { totalCents: true, commissionCents: true },
          },
        },
        orderBy: { startsAt: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    }),
    Promise.all(Object.entries(FILTERS).map(async ([key, value]) => [
      key,
      await prisma.event.count({ where: { status: { in: [...value.statuses] } } }),
    ] as const)),
  ]);
  const countsByFilter = Object.fromEntries(counts) as Record<FilterKey, number>;
  const now = new Date();

  return (
    <main className="container dashboard-page">
      <div className="dashboard-heading">
        <div>
          <span className="section-kicker">ADMINISTRAÇÃO CENTRAL</span>
          <h1>Gestão de eventos</h1>
          <p>Consulte os eventos por estado e encerre os eventos realizados.</p>
        </div>
        <div className="dashboard-heading-actions">
          <Link className="button button-primary" href="/admin/events/new">Criar evento</Link>
          <Link className="button button-secondary" href="/admin">Voltar ao painel</Link>
          <LogoutButton />
        </div>
      </div>

      <nav className="admin-dashboard-actions" aria-label="Filtros de eventos">
        {(Object.entries(FILTERS) as [FilterKey, typeof FILTERS[FilterKey]][]).map(([key, item]) => (
          <Link key={key} className={`button ${key === filterKey ? "button-primary" : "button-secondary"}`} href={`/admin/events?estado=${key}`}>
            {item.label} ({countsByFilter[key]})
          </Link>
        ))}
      </nav>

      {events.length === 0 ? (
        <div className="empty-state">Não há eventos nesta lista.</div>
      ) : (
        <div style={{ display: "grid", gap: 18 }}>
          {events.map((event) => {
            const hasFutureSession = event.sessions.some((session) => session.endsAt > now);
            const confirmedOrders = event.sessions.flatMap((session) => session.orders);
            const soldCents = confirmedOrders.reduce((sum, order) => sum + order.totalCents, 0);
            const commissionCents = confirmedOrders.reduce((sum, order) => sum + order.commissionCents, 0);
            const money = (value: number) => new Intl.NumberFormat("pt-PT", {
              style: "currency", currency: event.paymentAgreement?.currency ?? event.organization.currency,
            }).format(value / 100);
            const agreementLabel = event.paymentAgreement?.mode === "FIXED_PACKAGE"
              ? `Pacote fixo · ${money(event.paymentAgreement.value)}`
              : event.paymentAgreement?.mode === "PERCENTAGE"
                ? `Percentagem · ${(event.paymentAgreement.value / 100).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
                : event.paymentAgreement?.mode === "TICKET_DISCOUNT"
                  ? `Desconto por bilhete · ${money(event.paymentAgreement.value)}`
                  : "Acordo comercial por definir";
            return (
              <article className="panel admin-event-card" key={event.id}>
                <span className="section-kicker">{event.category} · {STATUS_LABELS[event.status] ?? event.status}</span>
                <h2>{event.name}</h2>
                <div className="admin-event-meta">
                  <span>Organização: {event.organization.name}</span>
                  <span><strong>Acordo:</strong> {agreementLabel}</span>
                </div>
                <p>{event.description || "Sem descrição."}</p>
                <p className="form-help">
                  Criado em {new Intl.DateTimeFormat("pt-PT", { dateStyle: "long" }).format(event.createdAt)}
                  {" · "}
                  {event.sessions.length} sessão(ões)
                </p>
                {event.sessions.length ? (
                  <ul className="admin-event-sessions">
                    {event.sessions.map((session, index) => (
                      <li key={`${session.startsAt.toISOString()}-${index}`}>
                        {new Intl.DateTimeFormat("pt-PT", { dateStyle: "long", timeZone: "UTC" }).format(session.startsAt)}
                        {" — "}
                        {new Intl.DateTimeFormat("pt-PT", { dateStyle: "long", timeZone: "UTC" }).format(session.endsAt)}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {event.paymentAgreement?.mode === "FIXED_PACKAGE" ? (
                  <div className="form-help"><strong>Valor acordado a pagar pelo organizador:</strong> {money(event.paymentAgreement.value)}</div>
                ) : event.paymentAgreement ? (
                  <div className="form-help">
                    <strong>Vendas confirmadas:</strong> {money(soldCents)} · {" "}
                    <strong>Comissão:</strong> {money(commissionCents)} · {" "}
                    <strong>Valor a receber:</strong> {money(soldCents - commissionCents)}
                  </div>
                ) : null}
                {event.paymentAgreement ? (
                  <PaymentAgreementActions
                    eventId={event.id}
                    initialMode={event.paymentAgreement.mode}
                    initialValue={event.paymentAgreement.value}
                  />
                ) : null}
                {filterKey === "drafts" && !hasFutureSession ? (
                  <p className="form-help">Não pode aprovar ainda: o organizador precisa adicionar uma sessão futura.</p>
                ) : null}
                {filterKey === "drafts" ? <ProposalActions eventId={event.id} canApprove={hasFutureSession} /> : null}
                {event.status === "PUBLISHED" ? <EventAdminActions eventId={event.id} /> : null}
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
