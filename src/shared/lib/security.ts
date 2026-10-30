import { randomBytes, createHash, timingSafeEqual } from "crypto";

// ============================================================
// Utilitários de segurança (SEC-01, SEC-03, SEC-18)
// ============================================================

/** Hash de password com Argon2id — carregado dinamicamente para evitar
 *  problemas de bundling do binding nativo em SSR. */
export async function hashPassword(password: string): Promise<string> {
  const argon2 = await import("argon2");
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  const argon2 = await import("argon2");
  return argon2.verify(hash, password);
}

/** Token de sessão opaco: retorna (token_plano, hash_guardado). */
export function generateSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha256(token);
  return { token, tokenHash };
}

/** SHA-256 genérico (sessões, QR, payload de webhook). */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Comparação em tempo constante (evita timing attacks). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Segredo imprevisível do QR Code (SEC-18).
 *  O token plano NUNCA é persistido — apenas o hash vai para a base. */
export function generateQrSecret(): { secret: string; secretHash: string } {
  const secret = randomBytes(32).toString("base64url");
  return { secret, secretHash: sha256(secret) };
}

/** Chave de idempotência opaca para clientes. */
export function generateIdempotencyKey(): string {
  return randomBytes(16).toString("hex");
}

/** Rate limiting em memória (SEC-05) — substituível por Redis em produção.
 *  Uso: `if (rateLimit(key, 10, 60_000)) → bloqueado` */
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > max;
}
