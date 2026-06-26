import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Isolamento do módulo MCP: arquivos em src/mcp/ não podem importar
  // funções de envio ao WhatsApp, alteração de sessão, pedidos ou o bot core.
  // Garante que nenhuma mudança acidental quebre a separação de Fase 1.
  {
    files: ["src/mcp/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["**/api/whatsapp*"],         message: "MCP não pode importar o webhook (enviarMensagem, salvarPedido etc.)" },
          { group: ["**/lib/bot*"],               message: "MCP não pode importar o state machine (processMessage, BotSession mutável)" },
          { group: ["**/lib/claude*"],            message: "MCP Fase 1 não usa Claude API" },
          { group: ["**/lib/fallbackInteligente*"], message: "MCP não pode importar o fallback" },
          { group: ["**/lib/conversationBrain*"], message: "MCP não pode importar o guardião de venda" },
        ],
      }],
    },
  },
]);

export default eslintConfig;
