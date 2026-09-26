import "@testing-library/jest-dom/vitest";
import { Socket } from "node:net";
// Sem rede real por padrão na suíte: cada teste que usa fetch deve fornecer
// seu próprio mock. Isso protege produção mesmo quando variáveis locais
// apontam, por engano, para um endpoint operacional.
// Atribuição direta é intencional: vi.unstubAllGlobals() deve restaurar este
// guard (o original do arquivo de teste), não o fetch de rede do Node.
globalThis.fetch = async () => {
  throw new Error("Rede externa bloqueada em testes: use um mock explícito de fetch");
};

// Cobre também clientes que ignoram globalThis.fetch (https/undici/Redis).
// Sockets locais e Unix continuam disponíveis para o próprio runner.
const conectarOriginal = Socket.prototype.connect;
Socket.prototype.connect = function (this: Socket, ...args: unknown[]) {
  const destino = args[0];
  const host = typeof destino === "object" && destino !== null
    ? (destino as { host?: string; hostname?: string; path?: string }).path
      ? "localhost"
      : ((destino as { host?: string; hostname?: string }).host ?? (destino as { hostname?: string }).hostname ?? "localhost")
    : typeof destino === "number" && typeof args[1] === "string" ? args[1] : "localhost";
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error("Rede externa bloqueada em testes: use um mock explícito de transporte");
  }
  return Reflect.apply(conectarOriginal, this, args);
} as typeof Socket.prototype.connect;

// jsdom não implementa matchMedia — polyfill mínimo (sempre "não corresponde",
// nunca dispara "change") só para os testes de componente que rodam em
// ambiente jsdom; testes em ambiente "node" (a maioria) nunca veem `window`.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}
