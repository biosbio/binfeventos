"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function makeSlug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export default function PlatformEventForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("OTHER");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      let coverImageUrl: string | undefined;
      if (coverFile) {
        const upload = new FormData();
        upload.set("file", coverFile);
        const uploadResponse = await fetch("/api/events/upload-cover", { method: "POST", body: upload });
        const uploadData = await uploadResponse.json();
        if (!uploadResponse.ok) {
          setError(uploadData.message ?? "Não foi possível carregar a imagem.");
          return;
        }
        coverImageUrl = uploadData.url;
      }

      const response = await fetch("/api/events/platform-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          slug: slug || undefined,
          description: description || undefined,
          category,
          coverImageUrl,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message ?? "Não foi possível criar o evento.");
        return;
      }
      router.push("/admin/events");
      router.refresh();
    } catch {
      setError("Erro de rede ao criar o evento. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" style={{ maxWidth: 760 }}>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <form className="event-create-form" onSubmit={submit}>
        <div className="form-field">
          <label htmlFor="platform-event-name">Nome do evento *</label>
          <input id="platform-event-name" required minLength={3} maxLength={150} value={name} onChange={(e) => {
            setName(e.target.value);
            if (!slugEdited) setSlug(makeSlug(e.target.value));
          }} />
        </div>
        <div className="form-field">
          <label htmlFor="platform-event-slug">Endereço web (opcional)</label>
          <input id="platform-event-slug" minLength={3} maxLength={80} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={slug} onChange={(e) => {
            setSlugEdited(true);
            setSlug(makeSlug(e.target.value));
          }} />
          <span className="form-help">Se ficar vazio, será gerado a partir do nome.</span>
        </div>
        <div className="form-field">
          <label htmlFor="platform-event-category">Categoria</label>
          <select id="platform-event-category" value={category} onChange={(e) => setCategory(e.target.value)}>
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
          <label htmlFor="platform-event-description">Descrição</label>
          <textarea id="platform-event-description" rows={5} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="platform-event-cover">Imagem de capa (JPEG, PNG ou WebP, até 5 MB)</label>
          <input id="platform-event-cover" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)} />
        </div>
        <fieldset className="form-field">
          <legend>Sessão inicial *</legend>
          <label htmlFor="platform-event-start">Início</label>
          <input id="platform-event-start" type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          <label htmlFor="platform-event-end">Fim</label>
          <input id="platform-event-end" type="datetime-local" required value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </fieldset>
        <button className="button button-primary" type="submit" disabled={busy}>
          {busy ? "A criar evento…" : "Criar rascunho"}
        </button>
      </form>
    </section>
  );
}
