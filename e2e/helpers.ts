import "dotenv/config";
import { expect, APIRequestContext } from "@playwright/test";
import { createHash } from "crypto";
import { prisma } from "../src/shared/lib/prisma";

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
    data: { fullName: `E2E ${email}`, email, phone: "+245900000001", password },
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
  await verifyOrganizerPanelForE2E(cookie);
  const authHeaders = { cookie, "content-type": "application/json" };

  // Evento
  const slug = `show-e2e-${Date.now()}`;
  const eventStartsAt = new Date(Date.now() + 24 * 3600 * 1000);
  eventStartsAt.setUTCHours(0, 0, 0, 0);
  const eventEndsAt = new Date(eventStartsAt);
  eventEndsAt.setUTCHours(23, 59, 59, 999);
  const event = await org.post("/api/events/create", {
    headers: authHeaders,
    data: {
      name: "Show E2E",
      slug,
      category: "CONCERT",
      venue: {
        name: `Arena E2E ${Date.now()}`,
        city: "Luanda",
        country: "AO",
      },
      startsAt: eventStartsAt.toISOString(),
      endsAt: eventEndsAt.toISOString(),
    },
  });
  expect(event.ok()).toBeTruthy();
  const createdEvent = (await event.json()).event as {
    id: string;
    sessions: { id: string; venueId: string | null }[];
  };
  const eventId = createdEvent.id;
  const initialSession = createdEvent.sessions[0];
  if (!initialSession?.venueId) {
    throw new Error("A sessão inicial não foi criada com o local do evento.");
  }
  const sessionId = initialSession.id;
  const venueId = initialSession.venueId;

  // A publicação exige aprovação de administrador; este cenário foca a compra.
  await prisma.event.update({
    where: { id: eventId },
    data: { status: "PUBLISHED", publishedAt: new Date() },
  });

  // Tipo de bilhete
  const tt = await org.post("/api/catalog/ticket-types", {
    headers: authHeaders,
    data: {
      eventId,
      name: "Entrada Geral",
      category: "NORMAL",
      basePriceCents: 500000, // 5.000,00 AOA
      quantity: 100,
      maxPerBuyer: 4,
    },
  });
  expect(tt.ok()).toBeTruthy();
  const ticketTypeId = (await tt.json()).ticketType.id as string;
  expect(ticketTypeId).toBeTruthy();
  return {
    organizerCookie: cookie,
    organizationId,
    sessionId,
    eventId,
    eventSlug: slug,
    venueId,
  };
}

async function verifyOrganizerPanelForE2E(setCookie: string): Promise<void> {
  const token = setCookie.split(";")[0]?.split("=")[1];
  if (!token) throw new Error("Cookie de sessão do organizador ausente.");

  const result = await prisma.session.updateMany({
    where: {
      tokenHash: createHash("sha256").update(token).digest("hex"),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { panelVerifiedUntil: new Date(Date.now() + 10 * 60 * 1000) },
  });
  expect(result.count).toBe(1);
}

/** Registo + login do comprador; devolve cookie de sessão. */
export async function buyerLogin(
  request: APIRequestContext,
  creds: ReturnType<typeof e2eCredentials>
): Promise<string> {
  const login = await registerAndLogin(request, creds.buyerEmail, creds.password);
  return login.headers()["set-cookie"] ?? "";
}
