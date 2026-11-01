"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

function makeSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
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

  function changeName(value: string) {
    setName(value);
    if (!slugEdited) setSlug(makeSlug(value));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/events/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          slug,
          description: description || undefined,
          category,
          coverImageUrl: coverImageUrl || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Não foi possível criar o evento.");
        return;
      }
      router.push("/painel");
      router.refresh();
    } catch {
      setError("Erro de rede ao criar o evento. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-wrap">
      <section className="auth-card" style={{ width: "min(100%, 680px)" }}>
        <span className="section-kicker">ÁREA DO ORGANIZADOR</span>
        <h1>Novo evento</h1>
        <p>Preencha os dados iniciais. O evento será guardado como rascunho e poderá ser configurado antes da publicação.</p>

        {error ? <div className="form-error" role="alert">{error}</div> : null}

        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label htmlFor="event-name">Nome do evento</label>
            <input id="event-name" required minLength={3} maxLength={150} value={name} onChange={(e) => changeName(e.target.value)} />
          </div>

          <div className="form-field">
            <label htmlFor="event-slug">Endereço do evento (slug)</label>
            <input id="event-slug" required minLength={3} maxLength={80} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={slug} onChange={(e) => { setSlugEdited(true); setSlug(makeSlug(e.target.value)); }} />
            <span className="form-help">Será usado no endereço público do evento: /eventos/{slug || "nome-do-evento"}</span>
          </div>

          <div className="form-field">
            <label htmlFor="event-category">Categoria</label>
            <select id="event-category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="CONCERT">Concerto</option>
              <option value="CONFERENCE">Conferência</option>
              <option value="SPORT">Desporto</option>
              <option value="THEATER">Teatro</option>
              <option value="FESTIVAL">Festival</option>
              <option value="WORKSHOP">Workshop</option>
              <option value="OTHER">Outro</option>
            </select>
          </div>

          <div className="form-field">
            <label htmlFor="event-description">Descrição</label>
            <textarea id="event-description" rows={5} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="form-field">
            <label htmlFor="event-cover">URL da imagem de capa (opcional)</label>
            <input id="event-cover" type="url" value={coverImageUrl} onChange={(e) => setCoverImageUrl(e.target.value)} placeholder="https://" />
          </div>

          <button className="button button-primary" type="submit" disabled={loading}>
            {loading ? "A criar evento…" : "Criar evento como rascunho"}
          </button>
        </form>

        <p className="auth-switch"><Link href="/painel">Voltar ao painel</Link></p>
      </section>
    </main>
  );
}
