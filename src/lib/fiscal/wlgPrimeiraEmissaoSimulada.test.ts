import { afterEach, describe, expect, it, vi } from "vitest";
import { resolverVinculoWlg, type VinculoWlg } from "./wlgVinculos";
import { enviarEnvelopeHomologacaoWlg, type EnvelopeHomologacaoWlg } from "./wlgHomologacao.server";
import { consultarOperacaoWlg } from "./wlgConsulta.server";
import {
  reservarRegistroFiscal, registrarOperationId, aplicarResultadoConsulta,
  marcarEnvioIncerto, podeIniciarEmissao,
} from "./wlgLedger";

/**
 * PRIMEIRA EMISSÃO SIMULADA — TESTE DE INTEGRAÇÃO 100% LOCAL.
 * Não faz chamadas HTTP reais, não usa CNPJ/nota de cliente, não grava Redis,
 * não cria documento na WLG e não se comunica com a SEFAZ.
 * Os valores, produtos e códigos abaixo são exclusivamente sintéticos.
 */
const usuarioFiscalTeste: VinculoWlg = {
  tenantId: "restaurante-sintetico",
  empresaId: "empresa-sintetica",
  cnpj: "11222333000181",
  habilitado: true,
  homologacaoConcluida: true,
};
const modelo65DeTeste: EnvelopeHomologacaoWlg = {
  empresaId: "empresa-sintetica",
  tipoAmbiente: 2,
  ide: { modelo: 65 },
  emitente: { cnpj: usuarioFiscalTeste.cnpj },
  itens: [{ codigo: "ITEM_FICTICIO", quantidade: 1 }],
  totais: { totalCentavos: 2500 },
  pagamento: { forma: "SIMULACAO" },
};
const credenciaisSINTETICAS = { clientId: "CLIENT_ID_TESTE", clientSecret: "SECRET_TESTE" };
const operationId = "f6e8bba6-3d2c-425e-99c3-ae3909bed022";
const chaveSintetica = "1".repeat(44);

afterEach(() => { vi.unstubAllEnvs(); });

function apiFake(statusFinal: string = "SUCESSO") {
  const chamadas: string[] = [];
  const http = async (url: string, init?: RequestInit): Promise<Response> => {
    chamadas.push((init?.method ?? "GET") + " " + url);
    if (url.endsWith("/auth/token")) {
      return new Response(JSON.stringify({ accessToken: "TOKEN_APENAS_TESTE" }), { status: 200 });
    }
    if (url.endsWith("/api/v1/nfe")) {
      return new Response(JSON.stringify({ operationId, status: "PROCESSANDO" }), { status: 202 });
    }
    if (url.endsWith("/operacoes/" + operationId)) {
      return new Response(JSON.stringify({
        status: statusFinal, chaveNfe: chaveSintetica,
        dataAutorizacao: "2026-10-24T19:00:00Z",
      }), { status: 200 });
    }
    throw new Error("Endpoint inesperado, proibido o acesso externo");
  };
  return { http, chamadas };
}

describe("primeira NFC-e simulada ponta a ponta — sem empresa ou nota fiscal reais", () => {
  it("confere empresa, simula 202, consulta autorização e impede reemissão", async () => {
    vi.stubEnv("VERCEL_ENV", "development");
    const vinculo = resolverVinculoWlg("restaurante-sintetico", [usuarioFiscalTeste]);
    expect(vinculo.ok).toBe(true);
    if (!vinculo.ok) throw new Error("Vínculo sintético ausente");
    let registro = reservarRegistroFiscal(
      null, usuarioFiscalTeste.tenantId, "conta-final-sintetica", vinculo.vinculo.empresaId,
    );
    expect(registro?.situacao).toBe("reservada");
    if (!registro) throw new Error("Reserva não criada");
    expect(podeIniciarEmissao(registro)).toBe(false);

    const { http, chamadas } = apiFake();
    const protocolo = await enviarEnvelopeHomologacaoWlg(
      modelo65DeTeste, vinculo.vinculo, vinculo.vinculo.cnpj,
      credenciaisSINTETICAS, true, http,
    );
    expect(protocolo).toEqual({ situacao: "processando", operationId });
    registro = registrarOperationId(registro, protocolo.operationId);
    expect(registro.situacao).toBe("processando");

    const resultado = await consultarOperacaoWlg(operationId, credenciaisSINTETICAS, http);
    expect(resultado.situacao).toBe("autorizada");
    registro = aplicarResultadoConsulta(registro, resultado);
    expect(registro.situacao).toBe("autorizada");
    expect(registro.chaveNfe).toBe(chaveSintetica);
    expect(podeIniciarEmissao(registro)).toBe(false);
    expect(reservarRegistroFiscal(
      registro, usuarioFiscalTeste.tenantId, "conta-final-sintetica", usuarioFiscalTeste.empresaId,
    )).toBeNull();

    // 1 POST de emissão SINTÉTICO na API FAKE; nenhuma outra operação a emitiu.
    expect(chamadas.filter(chamada => chamada === "POST https://fiscal.wlgsistemas.com.br/api/v1/nfe")).toHaveLength(1);
    expect(chamadas).toHaveLength(4); // token, envio, token, consulta
  });

  it("rejeição simulada NÃO produz falso sucesso e não dispara segundo POST", async () => {
    vi.stubEnv("VERCEL_ENV", "development");
    const { http, chamadas } = apiFake("ERRO");
    const reservado = reservarRegistroFiscal(null, "restaurante-sintetico", "conta-rejeitada", "empresa-sintetica")!;
    const emit = await enviarEnvelopeHomologacaoWlg(
      modelo65DeTeste, usuarioFiscalTeste, usuarioFiscalTeste.cnpj, credenciaisSINTETICAS, true, http,
    );
    const emAndamento = registrarOperationId(reservado, emit.operationId);
    const consultado = await consultarOperacaoWlg(operationId, credenciaisSINTETICAS, http);
    const registro = aplicarResultadoConsulta(emAndamento, consultado);
    expect(registro.situacao).toBe("rejeitada");
    expect(podeIniciarEmissao(registro)).toBe(false);
    expect(chamadas.filter(chamada => chamada.endsWith("POST https://fiscal.wlgsistemas.com.br/api/v1/nfe"))).toHaveLength(1);
  });

  it("falha de comunicação é incerta: nenhum reenvio", () => {
    const reservado = reservarRegistroFiscal(null, "restaurante-sintetico", "conta-incerta", "empresa-sintetica")!;
    const incerto = marcarEnvioIncerto(reservado);
    expect(incerto.situacao).toBe("envio_incerto");
    expect(podeIniciarEmissao(incerto)).toBe(false);
    expect(reservarRegistroFiscal(incerto, incerto.tenantId, incerto.contaId, incerto.empresaId)).toBeNull();
  });

  it("protege Preview e Produção mesmo com fetch falso", async () => {
    for (const modo of ["preview", "production"]) {
      vi.stubEnv("VERCEL_ENV", modo);
      const chamadas: string[] = [];
      const fake = async (url: string) => { chamadas.push(url); return new Response("{}"); };
      await expect(enviarEnvelopeHomologacaoWlg(
        modelo65DeTeste, usuarioFiscalTeste, usuarioFiscalTeste.cnpj,
        credenciaisSINTETICAS, true, fake,
      )).rejects.toThrow();
      expect(chamadas).toHaveLength(0);
    }
  });

  it("bloqueia outro restaurante antes de transmitir", async () => {
    vi.stubEnv("VERCEL_ENV", "development");
    const chamadas: string[] = [];
    const fake = async (url: string) => { chamadas.push(url); return new Response("{}"); };
    await expect(enviarEnvelopeHomologacaoWlg(
      { ...modelo65DeTeste, empresaId: "empresa-invasora" },
      usuarioFiscalTeste, usuarioFiscalTeste.cnpj,
      credenciaisSINTETICAS, true, fake,
    )).rejects.toThrow();
    expect(chamadas).toHaveLength(0);
  });
});