import {
  randomBytes,
  createHash,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "crypto";
import { prisma } from "@/shared/lib/prisma";

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

/**
 * Encriptação AES-256-GCM dos segredos TOTP em repouso.
 * MFA_ENCRYPTION_KEY deve ser uma chave hexadecimal de 64 caracteres.
 * Valores legados em texto claro são lidos para migração gradual após login.
 */
function mfaEncryptionKey(): Buffer {
  const raw = process.env.MFA_ENCRYPTION_KEY?.trim();
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error("MFA_ENCRYPTION_KEY deve conter 64 caracteres hexadecimais (32 bytes).");
  }
  return Buffer.from(raw, "hex");
}

export function encryptMfaSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", mfaEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function isEncryptedMfaSecret(value: string): boolean {
  return value.startsWith("enc:v1:");
}

export function decryptMfaSecret(value: string): string {
  if (!isEncryptedMfaSecret(value)) return value; // migração legada
  const parts = value.split(":");
  if (parts.length !== 5) throw new Error("Formato de segredo MFA inválido.");
  const [, version, ivEncoded, tagEncoded, ciphertextEncoded] = parts;
  if (!version || !ivEncoded || !tagEncoded || !ciphertextEncoded) {
    throw new Error("Componentes de segredo MFA incompletos.");
  }
  if (version !== "v1") throw new Error("Versão de segredo MFA não suportada.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    mfaEncryptionKey(),
    Buffer.from(ivEncoded, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, "base64url")),
    decipher.final(),
  ]).toString("utf8");
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

/** Rate limiting persistente no PostgreSQL (partilhado entre instâncias). */
export async function rateLimit(
  key: string,
  max: number,
  windowMs: number
): Promise<boolean> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);
  // A chave persistida é hash para não guardar IP/email em claro.
  const bucketKey = sha256(key);
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "rate_limit_buckets" ("key", "count", "resetAt", "updatedAt")
    VALUES (${bucketKey}, 1, ${resetAt}, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "rate_limit_buckets"."resetAt" <= NOW() THEN 1
        ELSE "rate_limit_buckets"."count" + 1
      END,
      "resetAt" = CASE
        WHEN "rate_limit_buckets"."resetAt" <= NOW() THEN EXCLUDED."resetAt"
        ELSE "rate_limit_buckets"."resetAt"
      END,
      "updatedAt" = NOW()
    RETURNING "count"
  `;
  // Limpeza oportunista de buckets antigos para a tabela não crescer indefinidamente.
  if (Math.random() < 0.01) {
    await prisma.$executeRaw`DELETE FROM "rate_limit_buckets" WHERE "resetAt" < NOW() - INTERVAL '1 day'`;
  }
  return (rows[0]?.count ?? max + 1) > max;
}
