import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type ManifestPwa = {
  id?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  lang?: string;
  icons?: Array<{ src?: string; sizes?: string; type?: string; purpose?: string }>;
};

const raiz = process.cwd();
const manifest = JSON.parse(
  readFileSync(resolve(raiz, "public/manifest.json"), "utf8"),
) as ManifestPwa;
const serviceWorker = readFileSync(resolve(raiz, "public/sw.js"), "utf8");
const layout = readFileSync(resolve(raiz, "src/app/layout.tsx"), "utf8");
const nextConfig = readFileSync(resolve(raiz, "next.config.ts"), "utf8");

describe("PWA do ChefeBot", () => {
  it("mantém a identidade instalada e amplia o escopo para todo o sistema", () => {
    expect(manifest.id).toBe("/pedidos");
    expect(manifest.start_url).toBe("/pedidos");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.lang).toBe("pt-BR");
  });

  it("declara os dois ícones mínimos de instalação sem prometer máscara não auditada", () => {
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          src: "/icon-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        }),
        expect.objectContaining({
          src: "/icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        }),
      ]),
    );
  });

  it("nunca intercepta API e nunca cacheia mutações operacionais", () => {
    expect(serviceWorker).toContain('if (request.method !== "GET") return;');
    expect(serviceWorker).toContain('if (url.pathname.startsWith("/api/")) return;');
    expect(serviceWorker).not.toContain('const OFFLINE = ["/pedidos", "/login"]');
  });

  it("mantém manifesto e worker fora do Cache Storage para evitar versões antigas", () => {
    expect(serviceWorker).toContain(
      'if (url.pathname === "/manifest.json" || url.pathname === "/sw.js") return;',
    );
    expect(serviceWorker).not.toContain('  "/manifest.json",\n  "/icon-192.png"');
  });

  it("usa somente uma tela neutra como fallback de navegação offline", () => {
    expect(serviceWorker).toContain('const OFFLINE_URL = "/offline";');
    expect(serviceWorker).toContain('if (request.mode === "navigate")');
    expect(serviceWorker).toContain("caches.match(OFFLINE_URL)");
  });

  it("registra o worker com escopo raiz e sem cachear a atualização do próprio worker", () => {
    expect(layout).toContain("scope: '/'");
    expect(layout).toContain("updateViaCache: 'none'");
    expect(nextConfig).toContain('source: "/sw.js"');
    expect(nextConfig).toContain('value: "public, max-age=0, must-revalidate"');
  });
});
