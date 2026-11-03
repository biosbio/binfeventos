"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

type EditableEvent = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: "CONCERT" | "CONFERENCE" | "SPORT" | "THEATER" | "FESTIVAL" | "WORKSHOP" | "OTHER";
  coverImageUrl: string | null;
  sessions: { id: string; startsAt: Date; endsAt: Date }[];
};

export default function EditEventForm({ event }: { event: EditableEvent }) {
  const router = useRouter();
  const [name, setName] = useState(event.name);
  const [slug, setSlug] = useState(event.slug);
  const [description, setDescription] = useState(event.description ?? "");
  const [category, setCategory] = useState(event.category);
  const coverImageUrl = event.coverImageUrl ?? undefined;
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sessionStartsAt, setSessionStartsAt] = useState("");
  const [sessionEndsAt, setSessionEndsAt] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [sessionBusy, setSessionBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      let uploadedCoverUrl = coverImageUrl;
      if (coverFile) {
        const upload = new FormData();
        upload.set("file", coverFile);
        const uploadResponse = await fetch("/api/events/upload-cover", { method: "POST", body: upload });
        const uploadData = await uploadResponse.json();
        if (!uploadResponse.ok) {
          setError(uploadData.message ?? "Não foi possível carregar a imagem.");
          return;
        }
        uploadedCoverUrl = uploadData.url;
      }
      const response = await fetch(`/api/events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          slug: slug || undefined,
          description,
          category,
          coverImageUrl: uploadedCoverUrl,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message ?? "Não foi possível guardar as alterações.");
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Erro de rede ao guardar as alterações. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  async function addSession(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSessionBusy(true);
    setSessionError("");
    try {
      const response = await fetch(`/api/events/${event.id}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startsAt: new Date(sessionStartsAt).toISOString(),
          endsAt: new Date(sessionEndsAt).toISOString(),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setSessionError(data.message ?? "Não foi possível adicionar a sessão.");
        return;
      }
      setSessionStartsAt("");
      setSessionEndsAt("");
      router.refresh();
    } catch {
      setSessionError("Erro de rede ao adicionar a sessão. Tente novamente.");
    } finally {
      setSessionBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 20, marginTop: 26 }}>
      <form className="panel" style={{ display: "grid", gap: 14 }} onSubmit={submit}>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {saved ? <p className="form-success" role="status">Alterações guardadas.</p> : null}
        <div className="form-field">
          <label htmlFor="event-name">Nome do evento</label>
          <input id="event-name" required minLength={3} maxLength={150} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="event-slug">Endereço web (opcional)</label>
          <input id="event-slug" minLength={3} maxLength={80} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={slug} onChange={(e) => setSlug(e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="event-category">Categoria</label>
          <select id="event-category" value={category} onChange={(e) => setCategory(e.target.value as EditableEvent["category"])}>
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
          <label htmlFor="event-cover">Carregar nova imagem de capa (JPEG, PNG ou WebP, até 5 MB)</label>
          <input id="event-cover" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)} />
          {coverImageUrl ? <Image src={coverImageUrl} alt="Imagem de capa atual" width={240} height={135} unoptimized style={{ maxWidth: 240, height: "auto", borderRadius: 12 }} /> : <span className="form-help">Ainda sem imagem de capa.</span>}
        </div>
        <button className="button button-primary" type="submit" disabled={busy}>
          {busy ? "A guardar…" : "Guardar alterações"}
        </button>
      </form>

      <section className="panel">
        <h2>Sessões</h2>
        {event.sessions.length ? (
          <ul>
            {event.sessions.map((session) => (
              <li key={session.id}>
                {new Intl.DateTimeFormat("pt-PT", { dateStyle: "long", timeStyle: "short" }).format(session.startsAt)}
                {" — "}
                {new Intl.DateTimeFormat("pt-PT", { dateStyle: "long", timeStyle: "short" }).format(session.endsAt)}
              </li>
            ))}
          </ul>
        ) : <p className="form-help">Adicione uma sessão futura antes de a proposta poder ser aprovada.</p>}
        <form style={{ display: "grid", gap: 14, marginTop: 16 }} onSubmit={addSession}>
          {sessionError ? <p className="form-error" role="alert">{sessionError}</p> : null}
          <div className="form-field">
            <label htmlFor="session-start">Início da sessão</label>
            <input id="session-start" type="datetime-local" required value={sessionStartsAt} onChange={(e) => setSessionStartsAt(e.target.value)} />
          </div>
          <div className="form-field">
            <label htmlFor="session-end">Fim da sessão</label>
            <input id="session-end" type="datetime-local" required value={sessionEndsAt} onChange={(e) => setSessionEndsAt(e.target.value)} />
          </div>
          <button className="button button-secondary" type="submit" disabled={sessionBusy}>
            {sessionBusy ? "A adicionar…" : "Adicionar sessão"}
          </button>
        </form>
      </section>
    </div>
  );
}
