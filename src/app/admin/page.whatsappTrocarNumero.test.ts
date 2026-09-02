import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

describe("/admin — troca de número do WhatsApp", () => {
  test("oferece troca apenas no card conectado e usa endpoint autenticado do servidor", () => {
    expect(fonte).toContain("const trocarNumeroWhatsapp = async () =>")
    expect(fonte).toContain("fetch('/api/whatsapp/trocar-numero', { method: 'POST' })")
    expect(fonte).toContain("Trocar número")
    expect(fonte).toContain("getUserInfo()?.role === 'admin' || getUserInfo()?.role === 'dev'")
  })

  test("ao desconectar, aguarda estabilização e pede o QR pela rota dedicada", () => {
    expect(fonte).toContain("if (res.ok && d?.estado === 'disconnected')")
    expect(fonte).toContain("setWaStatus('disconnected')")
    expect(fonte).toContain("setTimeout(resolve, 1200)")
    expect(fonte).toContain("await fetchQrCode()")
  })

  test("continua aceitando QR direto se o backend já o entregar", () => {
    expect(fonte).toContain("aplicarQr(base64, d?.qrcode?.expiresAt, d?.qrcode?.generationId)")
  })

  test("não chama delete de instância nem expõe segredo no navegador", () => {
    expect(fonte).not.toContain("/instance/delete/")
    expect(fonte).not.toContain("EVOLUTION_API_KEY")
  })
})
