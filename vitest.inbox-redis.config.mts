import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Config exclusiva da carga integrada; conecta APENAS ao Redis/SRH Docker
// descartavel e nunca acessa dados, telefones ou provedores reais.
export default defineConfig({
  test: {
    include: [
      "src/lib/whatsappPico50.http.integration.test.ts",
      "src/lib/whatsappPico50.worker.integration.test.ts",
      "src/lib/whatsappInboxReadiness.test.ts",
    ],
    environment: "node",
    fileParallelism: false,
    testTimeout: 120000,
    hookTimeout: 30000,
    maxWorkers: 1,
  },
  resolve: { alias: {
    "@": fileURLToPath(new URL("./src", import.meta.url)),
    "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
  } },
});
