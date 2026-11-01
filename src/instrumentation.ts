export const runtime = "nodejs";

export async function register() {
  // Bootstrap único no arranque do servidor (Next.js instrumentation).
  const { registerAllAdapters } = await import("@/modules/payments/adapters");
  registerAllAdapters();
}
