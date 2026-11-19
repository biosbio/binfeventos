/** O email configurado no seed identifica o administrador principal da plataforma. */
export function isPrimaryPlatformAdmin(email: string): boolean {
  const configuredEmail = (process.env.ADMIN_EMAIL ?? "admin@binf.local").trim().toLowerCase();
  return email.trim().toLowerCase() === configuredEmail;
}
