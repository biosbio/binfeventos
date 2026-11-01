"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

function makeSlug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export default function NewEventPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("OTHER");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/events/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug, description: description || undefined, category, coverImageUrl: coverImageUrl || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Não foi possível submeter o evento.");
        return;
      }
      router.push("/painel");
      router.refresh();
    } catch {
      setError("Erro de rede ao submeter o evento. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <header className="site-header event-create-header"><Link className="brand" href="/"><span className="brand-mark">B</span><span>BINF EVENTOS</span></Link><Link className="button button-secondary" href="/painel">Voltar ao painel</Link></header>
      <main className="event-create-page">
        <div className="event-create-container">
          <Link className="event-back-link" href="/painel">← Voltar ao painel</Link>
          <div className="event-create-layout">
            <section className="event-create-intro">
              <span className="section-kicker">BINF EVENTOS · ORGANIZADORES</span>
              <h1>Vamos dar vida ao seu evento.</h1>
              <p>Apresente os dados principais. A equipa BINF EVENTOS irá analisar a proposta antes de a disponibilizar publicamente.</p>
              <div className="approval-note">
                <span className="approval-icon">✓</span>
                <div><strong>Publicação sujeita a aprovação</strong><p>O evento não será apresentado aos compradores enquanto não for aprovado pela administração.</p></div>
              </div>
              <div className="event-create-steps">
                <div><span>01</span><p><strong>Submeta</strong><small>Indique as informações do evento.</small></p></div>
                <div><span>02</span><p><strong>Análise</strong><small>A administração verifica os dados.</small></p></div>
                <div><span>03</span><p><strong>Publicação</strong><small>Após aprovação, poderá avançar.</small></p></div>
              </div>
            </section>

            <section className="event-create-card">
              <div className="event-create-card-heading">
                <span>FORMULÁRIO DE SUBMISSÃO</span>
                <h2>Informações do evento</h2>
                <p>Os campos assinalados com * são obrigatórios.</p>
              </div>
              {error ? <div className="form-error" role="alert">{error}</div> : null}
              <form onSubmit={handleSubmit} className="event-create-form">
                <div className="form-field">
                  <label htmlFor="event-name">Nome do evento *</label>
                  <input id="event-name" required minLength={3} maxLength={150} value={name} onChange={(e) => { setName(e.target.value); if (!slugEdited) setSlug(makeSlug(e.target.value)); }} placeholder="Ex.: Festival de Música de Bissau" />
                </div>
                <div className="form-field">
                  <label htmlFor="event-slug">Endereço web *</label>
                  <input id="event-slug" required minLength={3} maxLength={80} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={slug} onChange={(e) => { setSlugEdited(true); setSlug(makeSlug(e.target.value)); }} placeholder="festival-musica-bissau" />
                  <span className="form-help">Endereço previsto: binfeventos.com/eventos/{slug || "nome-do-evento"}</span>
                </div>
                <div className="form-field">
                  <label htmlFor="event-category">Categoria *</label>
                  <select id="event-category" value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="CONCERT">Concerto</option><option value="CONFERENCE">Conferência</option><option value="SPORT">Desporto</option><option value="THEATER">Teatro</option><option value="FESTIVAL">Festival</option><option value="WORKSHOP">Workshop</option><option value="OTHER">Outro</option>
                  </select>
                </div>
                <div className="form-field">
                  <label htmlFor="event-description">Descrição do evento</label>
                  <textarea id="event-description" rows={5} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Explique o objetivo, o programa e o que os participantes podem esperar." />
                </div>
                <div className="form-field">
                  <label htmlFor="event-cover">Imagem de capa (opcional)</label>
                  <input id="event-cover" type="url" value={coverImageUrl} onChange={(e) => setCoverImageUrl(e.target.value)} placeholder="https://..." />
                </div>
                <button className="button button-primary event-submit-button" type="submit" disabled={loading}>{loading ? "A submeter..." : "Submeter evento para análise"}</button>
                <p className="event-privacy-note">Ao submeter, confirma que tem autorização para organizar este evento e fornecer estas informações.</p>
              </form>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
