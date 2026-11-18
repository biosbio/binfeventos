import "dotenv/config";
import { randomBytes } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { authenticator } from "otplib";
import { prisma } from "../src/shared/lib/prisma";
import { encryptMfaSecret } from "../src/shared/lib/security";

/** Resets one admin's MFA. Rotating the global encryption key is allowed only
 * when there is a single admin, because every other encrypted secret depends on it. */
async function main() {
  const email = (process.argv[2] ?? process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!email) throw new Error("Informe o email: npm run admin:mfa-reset -- admin@dominio.com");

  const admins = await prisma.user.findMany({
    where: { platformRole: "PLATFORM_ADMIN" },
    select: { id: true, email: true },
  });
  const admin = admins.find((candidate) => candidate.email.toLowerCase() === email);
  if (!admin) throw new Error("Não encontrei uma conta de administrador com esse email.");

  const readline = createInterface({ input, output });
  try {
    const confirmation = await readline.question(`Isto substituirá o MFA de ${email} e terminará as sessões. Para confirmar, escreva RESET MFA: `);
    if (confirmation !== "RESET MFA") throw new Error("Operação cancelada.");
  } finally {
    readline.close();
  }

  const envPath = resolve(process.cwd(), ".env");
  const currentEncryptionKey = process.env.MFA_ENCRYPTION_KEY?.trim() ?? "";
  const rotateEncryptionKey = !/^[0-9a-fA-F]{64}$/.test(currentEncryptionKey);
  if (rotateEncryptionKey && admins.length !== 1) {
    throw new Error("A chave MFA atual não é válida e existem vários administradores. Restaure a chave original ou faça uma rotação coordenada para todas as contas.");
  }

  let previousEnv: string | null = null;
  if (rotateEncryptionKey) {
    try {
      previousEnv = await readFile(envPath, "utf8");
    } catch {
      throw new Error("Não encontrei .env na raiz para guardar a nova chave MFA.");
    }
  }

  const newEncryptionKey = rotateEncryptionKey ? randomBytes(32).toString("hex") : currentEncryptionKey;
  const newTotpSecret = authenticator.generateSecret();
  process.env.MFA_ENCRYPTION_KEY = newEncryptionKey;
  const encryptedSecret = encryptMfaSecret(newTotpSecret);
  const tempEnvPath = `${envPath}.mfa-reset.tmp`;

  if (rotateEncryptionKey && previousEnv !== null) {
    await writeFile(tempEnvPath, setEnvValue(previousEnv, "MFA_ENCRYPTION_KEY", newEncryptionKey), { mode: 0o600 });
    await rename(tempEnvPath, envPath);
  }
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id: admin.id, platformRole: "PLATFORM_ADMIN" },
        data: { mfaEnabled: true, mfaSecret: encryptedSecret },
      });
      if (updated.count !== 1) throw new Error("A conta de administrador mudou durante a operação.");
      await tx.session.updateMany({
        where: { userId: admin.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  } catch (error) {
    if (rotateEncryptionKey && previousEnv !== null) {
      await writeFile(tempEnvPath, previousEnv, { mode: 0o600 });
      await rename(tempEnvPath, envPath);
    }
    throw error;
  }

  const otpauth = authenticator.keyuri(email, "BINF EVENTOS", newTotpSecret);
  const recoveryDetailsPath = resolve(process.cwd(), ".admin-mfa-reset.txt");
  await writeFile(
    recoveryDetailsPath,
    `Conta: ${email}\nSegredo para registar na aplicação autenticadora: ${newTotpSecret}\nURI de configuração: ${otpauth}\n`,
    { mode: 0o600 },
  );
  console.log("\nMFA redefinido. Reinicie a aplicação antes de iniciar sessão.");
  console.log(rotateEncryptionKey ? "MFA_ENCRYPTION_KEY foi renovada e guardada no .env local." : "A chave MFA existente foi mantida para preservar os outros administradores.");
  console.log("Dados do novo MFA foram guardados em .admin-mfa-reset.txt (arquivo local com acesso restrito).");
  console.log("As sessões existentes foram terminadas. Registe o segredo na aplicação autenticadora e depois apague esse arquivo.");
}

function setEnvValue(contents: string, key: string, value: string): string {
  const lines = contents.split(/\r?\n/);
  const indexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => new RegExp(`^\\s*${key}\\s*=`).test(line))
    .map(({ index }) => index);
  if (indexes.length) {
    const firstIndex = indexes[0];
    if (firstIndex === undefined) throw new Error("Não foi possível atualizar MFA_ENCRYPTION_KEY no .env.");
    lines[firstIndex] = `${key}=${value}`;
    for (const index of indexes.slice(1).reverse()) lines.splice(index, 1);
  } else {
    lines.push(`${key}=${value}`);
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Falha ao redefinir MFA.");
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
