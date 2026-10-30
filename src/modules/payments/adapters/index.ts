import { registerAdapter } from "../adapter";
import { SandboxAdapter } from "./sandbox";

// ============================================================
// Bootstrap dos adaptadores — importar UMA vez no arranque
// (por exemplo, no instrumentation.ts do Next.js) para que
// getAdapter() encontre os prestadores instalados.
// ============================================================

export function registerAllAdapters(): void {
  registerAdapter(new SandboxAdapter());
}
