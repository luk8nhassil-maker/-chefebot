import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Config mínima do Vitest. Objetivo: resolver o alias "@/..." usado pelas
// rotas (src/app/api/...) e habilitar matchers do jest-dom para os poucos
// testes de componente que rodam em ambiente jsdom (via pragma
// `// @vitest-environment jsdom` no topo do arquivo — o ambiente padrão
// continua "node" para não afetar a suíte existente).
export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
  },
});
