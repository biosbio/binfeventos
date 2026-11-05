"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

function nextCalendarDate(value: string): string | undefined {
  if (!value) return undefined;
  const next = new Date(`${value}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

type EditableEvent = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: "CONCERT" | "CONFERENCE" | "SPORT" | "THEATER" | "FESTIVAL" | "WORKSHOP" | "OTHER";
  coverImageUrl: string | null;
  sessions: {
    id: string;
    startsAt: Date;
    endsAt: Date;
    venue: { name: string; address: string | null; city: string | null; country: string } | null;
  }[];
};
type CountryOption = { code: string; name: string };

function dateInputValue(date: Date | undefined): string {
  return date?.toISOString().slice(0, 10) ?? "";
}

export default function EditEventForm({
  event,
  countryOptions,
}: {
  event: EditableEvent;
  countryOptions: CountryOption[];
}) {
  const firstSession = event.sessions.reduce<EditableEvent["sessions"][number] | undefined>(
    (first, session) => !first || session.startsAt < first.startsAt ? session : first,
    undefined,
  );
  const lastSession = event.sessions.reduce<EditableEvent["sessions"][number] | undefined>(
    (last, session) => !last || session.endsAt > last.endsAt ? session : last,
    undefined,
  );
  const initialStartDate = dateInputValue(firstSession?.startsAt);
  const initialEndDate = dateInputValue(lastSession?.endsAt);
  const initialVenue = firstSession?.venue;
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
  const [eventStartDate, setEventStartDate] = useState(initialStartDate);
  const [eventEndDate, setEventEndDate] = useState(initialEndDate);
  const [eventDuration, setEventDuration] = useState<"one-day" | "multiple-days">(
    initialStartDate === initialEndDate ? "one-day" : "multiple-days",
  );
  const [venueName, setVenueName] = useState(initialVenue?.name ?? "");
  const [venueAddress, setVenueAddress] = useState(initialVenue?.address ?? "");
  const [venueCity, setVenueCity] = useState(initialVenue?.city ?? "");
  const [venueCountry, setVenueCountry] = useState(initialVenue?.country ?? "AO");

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
        upload.set("eventId", event.id);
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
          venue: {
            name: venueName,
            address: venueAddress || undefined,
            city: venueCity,
            country: venueCountry,
          },
          startsAt: new Date(`${eventStartDate}T00:00:00.000Z`).toISOString(),
          endsAt: new Date(`${eventDuration === "one-day" ? eventStartDate : eventEndDate}T23:59:59.999Z`).toISOString(),
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

  return (
    <div className="event-edit-layout">
      <form className="panel event-edit-form" onSubmit={submit}>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {saved ? <p className="form-success" role="status">Alterações guardadas.</p> : null}
        <section className="event-edit-section">
          <div className="event-edit-section-heading">
            <span>01</span>
            <div><h2>Informações principais</h2><p>Defina como o evento será apresentado ao público.</p></div>
          </div>
        <div className="form-field">
          <label htmlFor="event-name">Nome do evento</label>
          <input id="event-name" required minLength={3} maxLength={150} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="event-slug">Endereço web (opcional)</label>
          <input id="event-slug" minLength={3} maxLength={80} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={slug} onChange={(e) => setSlug(e.target.value)} />
        </div>
        <div className="event-edit-grid">
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
        <fieldset className="event-duration-field">
          <legend>Duração do evento</legend>
          <div className="event-duration-options">
          <label className={eventDuration === "one-day" ? "event-duration-option is-selected" : "event-duration-option"}>
            <input
              type="radio"
              name="event-duration"
              checked={eventDuration === "one-day"}
              onChange={() => setEventDuration("one-day")}
            />
            <span><strong>Um dia</strong><small>Escolher uma única data</small></span>
          </label>
          <label className={eventDuration === "multiple-days" ? "event-duration-option is-selected" : "event-duration-option"}>
            <input
              type="radio"
              name="event-duration"
              checked={eventDuration === "multiple-days"}
              onChange={() => setEventDuration("multiple-days")}
            />
            <span><strong>Vários dias</strong><small>Definir início e fim</small></span>
          </label>
          </div>
        </fieldset>
        </div>
        </section>
        <section className="event-edit-section">
          <div className="event-edit-section-heading">
            <span>02</span>
            <div><h2>Data do evento</h2><p>Indique quando o evento acontece.</p></div>
          </div>
        <div className="event-edit-grid">
        <div className="form-field">
          <label htmlFor="event-start-date">
            {eventDuration === "one-day" ? "Data de realização *" : "Data de início *"}
          </label>
          <input
            id="event-start-date"
            type="date"
            required
            value={eventStartDate}
            onChange={(inputEvent) => setEventStartDate(inputEvent.target.value)}
          />
        </div>
        {eventDuration === "multiple-days" ? (
          <div className="form-field">
            <label htmlFor="event-end-date">Data de fim *</label>
            <input
              id="event-end-date"
              type="date"
              required
              min={nextCalendarDate(eventStartDate)}
              value={eventEndDate}
              onChange={(inputEvent) => setEventEndDate(inputEvent.target.value)}
            />
          </div>
        ) : null}
        </div>
        </section>
        <section className="event-edit-section">
          <div className="event-edit-section-heading">
            <span>03</span>
            <div><h2>Localização</h2><p>Onde será realizado o evento?</p></div>
          </div>
        <div className="form-field">
          <label htmlFor="event-venue-name">Nome do local *</label>
          <input id="event-venue-name" required minLength={2} maxLength={150} value={venueName} onChange={(inputEvent) => setVenueName(inputEvent.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="event-venue-address">Endereço</label>
          <input id="event-venue-address" maxLength={300} value={venueAddress} onChange={(inputEvent) => setVenueAddress(inputEvent.target.value)} />
        </div>
        <div className="event-edit-grid">
        <div className="form-field">
          <label htmlFor="event-venue-city">Cidade *</label>
          <input id="event-venue-city" required minLength={2} maxLength={100} value={venueCity} onChange={(inputEvent) => setVenueCity(inputEvent.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="event-venue-country">País *</label>
          <select id="event-venue-country" required value={venueCountry} onChange={(inputEvent) => setVenueCountry(inputEvent.target.value)}>
            {countryOptions.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}
          </select>
        </div>
        </div>
        </section>
        <section className="event-edit-section">
          <div className="event-edit-section-heading">
            <span>04</span>
            <div><h2>Detalhes adicionais</h2><p>Ajude os participantes a conhecer melhor o evento.</p></div>
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
        </section>
        <div className="event-edit-actions">
        <button className="button button-primary" type="submit" disabled={busy}>
          {busy ? "A guardar…" : "Guardar alterações"}
        </button>
        </div>
      </form>

    </div>
  );
}
