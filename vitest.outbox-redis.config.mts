import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Somente o job de integracao hermetica utiliza este config. A suite comum
// continua com o guard global vitest.setup.ts, sem acesso a rede.
// O teste aplica allowlist estrita de fetch para SRH local e Evolution falsa.
export default defineConfig({
  test: {
    include: ["src/lib/whatsappOutbox.redis.integration.test.ts"],
    environment: "node",
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
});
