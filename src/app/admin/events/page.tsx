import Link from "next/link";
import { prisma } from "@/shared/lib/prisma";
import LogoutButton from "../../_components/logout-button";
import ProposalActions from "./proposal-actions";

export const dynamic = "force-dynamic";

export default async function EventProposalsPage() {
  const proposals = await prisma.event.findMany({
    where: { status: "DRAFT" },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      category: true,
      createdAt: true,
      organization: { select: { name: true } },
      sessions: { select: { startsAt: true, endsAt: true }, orderBy: { startsAt: "asc" } },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  const now = new Date();

  return (
    <main className="container dashboard-page">
      <div className="dashboard-heading">
        <div>
          <span className="section-kicker">ADMINISTRAÇÃO CENTRAL</span>
          <h1>Propostas de eventos</h1>
          <p>Os eventos em análise não aparecem ao público. Só ficam visíveis depois da aprovação.</p>
        </div>
        <div className="dashboard-heading-actions">
          <Link className="button button-secondary" href="/admin">Voltar ao painel</Link>
          <LogoutButton />
        </div>
      </div>

      {proposals.length === 0 ? (
        <div className="empty-state">Não há propostas pendentes de análise.</div>
      ) : (
        <div style={{ display: "grid", gap: 18 }}>
          {proposals.map((proposal) => {
            const hasFutureSession = proposal.sessions.some((session) => session.endsAt > now);
            return (
              <article className="panel" key={proposal.id}>
                <span className="section-kicker">{proposal.category}</span>
                <h2>{proposal.name}</h2>
                <p className="form-help">Organização: {proposal.organization.name}</p>
                <p>{proposal.description || "Sem descrição."}</p>
                <p className="form-help">
                  Submetido em {new Intl.DateTimeFormat("pt-PT", { dateStyle: "long" }).format(proposal.createdAt)}
                  {" · "}
                  {proposal.sessions.length} sessão(ões)
                </p>
                {proposal.sessions.length ? (
                  <ul>
                    {proposal.sessions.map((session, index) => (
                      <li key={`${session.startsAt.toISOString()}-${index}`}>
                        {new Intl.DateTimeFormat("pt-PT", { dateStyle: "long", timeStyle: "short" }).format(session.startsAt)}
                        {" — "}
                        {new Intl.DateTimeFormat("pt-PT", { dateStyle: "long", timeStyle: "short" }).format(session.endsAt)}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {!hasFutureSession ? (
                  <p className="form-help">Não pode aprovar ainda: o organizador precisa adicionar uma sessão futura.</p>
                ) : null}
                <ProposalActions eventId={proposal.id} canApprove={hasFutureSession} />
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
