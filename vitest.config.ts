import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Config mínima do Vitest. Único objetivo: resolver o alias "@/..." usado pelas
// rotas (src/app/api/...). Testes com import relativo seguem funcionando igual.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
