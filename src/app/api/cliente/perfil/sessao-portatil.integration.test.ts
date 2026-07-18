import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Teste de integração real (sem mockar clienteAuth/clientes): prova o
// cenário exigido — OTP válido → nome → PATCH do nome com o "Redis de
// sessão" indisponível → pontos. Só a leitura da CHAVE DE SESSÃO OPACA
// LEGADA (cliente:sessao:*) falha; o registro do cliente (cliente:*)
// continua funcionando normalmente — exatamente o incidente reproduzido em
// produção, onde uma leitura de sessão logo após a escrita falhava por
// atraso de réplica. A sessão portátil (JWE) nunca lê essa chave, então o
// PATCH deve funcionar mesmo com essa falha.
const redisStore = new Map<string, unknown>();
const falharLeituraSessaoOpaca = { ativo: false };
vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => {
      if (falharLeituraSessaoOpaca.ativo && key.startsWith("cliente:sessao:")) {
        throw new Error("redis indisponivel (sessao opaca)");
      }
      return redisStore.has(key) ? redisStore.get(key) : null;
    }),
    set: vi.fn(async (key: string, value: unknown) => { redisStore.set(key, value); return "OK"; }),
    del: vi.fn(async (key: string) => { redisStore.delete(key); return 1; }),
  },
}));

import { POST as verificar } from "@/app/api/cliente/verificar/route";
import { PATCH as patchPerfil } from "@/app/api/cliente/perfil/route";

const TELEFONE = "86988887777";

function armarOtp(telefone: string, codigo = "123456") {
  redisStore.set(`cliente:otp:${telefone}`, { codigo, tentativas: 0 });
}

beforeEach(() => {
  redisStore.clear();
  falharLeituraSessaoOpaca.ativo = false;
});

describe("fluxo real: OTP -> nome -> PATCH com redis de sessão indisponível -> pontos", () => {
  test("PATCH do nome funciona mesmo com a leitura da sessão opaca legada fora do ar", async () => {
    armarOtp(TELEFONE);
    const resVerificar = await verificar(new NextRequest("http://localhost/api/cliente/verificar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telefone: TELEFONE, codigo: "123456" }),
    }));
    const dataVerificar = await resVerificar.json();
    expect(resVerificar.status).toBe(200);
    expect(dataVerificar.next).toBe("name");
    const sessao = dataVerificar.sessao as string;
    expect(sessao.split(".")).toHaveLength(5); // sessão portátil (JWE), não a opaca

    // simula o "Redis de sessão" indisponível — só afeta o caminho legado
    falharLeituraSessaoOpaca.ativo = true;

    const resPatch = await patchPerfil(new NextRequest("http://localhost/api/cliente/perfil", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", authorization: `Bearer ${sessao}` },
      body: JSON.stringify({ nome: "Maria da Silva" }),
    }));
    const dataPatch = await resPatch.json();
    expect(resPatch.status).toBe(200);
    expect(dataPatch.ok).toBe(true);
    expect(dataPatch.next).toBe("points");
    expect(dataPatch.cliente.nome).toBe("Maria da Silva");

    const registro = redisStore.get(`perfil-cliente:${TELEFONE}`) as { fidelidadeAtivadaEm?: string };
    expect(registro?.fidelidadeAtivadaEm).toBeTruthy();
  });
});
