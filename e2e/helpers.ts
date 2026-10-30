import { test, expect, APIRequestContext } from "@playwright/test";

// ============================================================
// Helpers E2E — preparação de dados via API com o organizador.
//
// O fluxo de arranque (organizerBootstrap) cria conta, org,
// recinto, evento, sessão, tipo e lote ABERTO — o mínimo para o
// marketplace vender. Requer o seed aplicado (prestador sandbox).
// ============================================================

/** Credenciais derivadas do timestamp para isolamento entre execuções. */
export function e2eCredentials() {
  const stamp = Date.now();
  return {
    organizerEmail: `organizer-${stamp}@e2e.test`,
    buyerEmail: `buyer-${stamp}@e2e.test`,
    password: "E2eSenhaForte2026",
    buyerName: "Comprador E2E",
  };
}

/** Cria conta via API e devolve o cookie de sessão. */
export async function registerAndLogin(
  request: APIRequestContext,
  email: string,
  password: string
) {
  const reg = await request.post("/api/users/register", {
    data: { fullName: `E2E ${email}`, email, password },
  });
  // 201 criado; 409 se já existe (reuso em retries)
  expect([201, 409]).toContain(reg.status());

  const login = await request.post("/api/users/login", { data: { email, password } });
  expect(login.ok()).toBeTruthy();
  return login;
}

export interface BootstrapResult {
  organizerCookie: string;
  organizationId: string;
  sessionId: string;
  eventId: string;
  eventSlug: string;
  venueId: string;
}

/** Bootstrap do organizador: org → recinto → evento → sessão → tipo → lote OPEN. */
export async function organizerBootstrap(
  request: APIRequestContext,
  creds: ReturnType<typeof e2eCredentials>
): Promise<BootstrapResult> {
  // Sessão do organizador
  const login = await registerAndLogin(request, creds.organizerEmail, creds.password);
  const organizerCookie = login.headers()["set-cookie"] ?? "";
  const org = request;
  const headers = { cookie: organizerCookie, "content-type": "application/json" };

  // Organização
  const createOrg = await org.post("/api/organizations/create", {
    headers,
    data: {
      name: `Produtora E2E ${Date.now()}`,
      slug: `e2e-${Date.now()}`,
      country: "AO",
      currency: "AOA",
    },
  });
  expect(createOrg.ok()).toBeTruthy();
  const orgData = await createOrg.json();
  const organizationId = orgData.organization.id as string;

  // Re-login para a sessão ganhar o contexto organizacional
  const relogin = await registerAndLogin(request, creds.organizerEmail, creds.password);
  const cookie = relogin.headers()["set-cookie"] ?? "";
  const authHeaders = { cookie, "content-type": "application/json" };

  // Recinto
  const venue = await org.post("/api/events/venues", {
    headers: authHeaders,
    data: { name: `Arena E2E ${Date.now()}`, country: "AO", capacity: 5000 },
  });
  expect(venue.ok()).toBeTruthy();
  const venueId = (await venue.json()).venue.id as string;

  // Evento
  const slug = `show-e2e-${Date.now()}`;
  const event = await org.post("/api/events/create", {
    headers: authHeaders,
    data: { name: "Show E2E", slug, category: "CONCERT" },
  });
  expect(event.ok()).toBeTruthy();
  const eventId = (await event.json()).event.id as string;

  // Sessão futura (amanhã, 20h–23h)
  const startsAt = new Date(Date.now() + 24 * 3600 * 1000);
  startsAt.setUTCHours(20, 0, 0, 0);
  const endsAt = new Date(startsAt.getTime() + 3 * 3600 * 1000);
  const session = await org.post(`/api/events/${eventId}/sessions`, {
    headers: authHeaders,
    data: {
      eventId,
      venueId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    },
  });
  expect(session.ok()).toBeTruthy();
  const sessionId = (await session.json()).session.id as string;

  // Publicar
  const publish = await org.post(`/api/events/${eventId}/transition`, {
    headers: authHeaders,
    data: { to: "PUBLISHED" },
  });
  expect(publish.ok()).toBeTruthy();

  // Tipo de bilhete
  const tt = await org.post("/api/catalog/ticket-types", {
    headers: authHeaders,
    data: {
      eventId,
      name: "Entrada Geral",
      category: "NORMAL",
      basePriceCents: 500000, // 5.000,00 AOA
    },
  });
  expect(tt.ok()).toBeTruthy();
  const ticketTypeId = (await tt.json()).ticketType.id as string;

  // Lote com janela de comercialização ativa
  const batchStarts = new Date(Date.now() - 60_000);
  const batchEnds = new Date(Date.now() + 24 * 3600 * 1000);
  const batch = await org.post("/api/catalog/batches", {
    headers: authHeaders,
    data: {
      ticketTypeId,
      sessionId,
      name: "Lote 1",
      quantity: 100,
      priceCents: 450000, // 4.500,00 AOA
      startsAt: batchStarts.toISOString(),
      endsAt: batchEnds.toISOString(),
      maxPerBuyer: 4,
    },
  });
  expect(batch.ok()).toBeTruthy();
  const batchId = (await batch.json()).batch.id as string;

  // BUG FIX Parte 19: abrir o lote (antes não havia forma)
  const openBatch = await org.post("/api/catalog/batches/status", {
    headers: authHeaders,
    data: { batchId, to: "OPEN" },
  });
  expect(openBatch.ok()).toBeTruthy();

  return {
    organizerCookie: cookie,
    organizationId,
    sessionId,
    eventId,
    eventSlug: slug,
    venueId,
  };
}

/** Registo + login do comprador; devolve cookie de sessão. */
export async function buyerLogin(
  request: APIRequestContext,
  creds: ReturnType<typeof e2eCredentials>
): Promise<string> {
  const login = await registerAndLogin(request, creds.buyerEmail, creds.password);
  return login.headers()["set-cookie"] ?? "";
}
