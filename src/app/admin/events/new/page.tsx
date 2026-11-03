import Link from "next/link";
import PlatformEventForm from "./platform-event-form";
import { getCountryOptions } from "@/shared/lib/locale-options";

export default function NewPlatformEventPage() {
  return (
    <main className="container dashboard-page">
      <div className="dashboard-heading">
        <div>
          <span className="section-kicker">ADMINISTRAÇÃO CENTRAL · BINF EVENTOS</span>
          <h1>Criar evento</h1>
          <p>O evento será criado como rascunho na organização central, com uma sessão inicial, e ficará sujeito a aprovação antes de ser público.</p>
        </div>
        <div className="dashboard-heading-actions">
          <Link className="button button-secondary" href="/admin">Voltar à administração</Link>
        </div>
      </div>
      <PlatformEventForm countryOptions={getCountryOptions()} />
    </main>
  );
}
