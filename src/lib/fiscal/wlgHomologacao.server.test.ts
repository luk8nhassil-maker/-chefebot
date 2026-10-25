import { describe, expect, it } from "vitest";
import { enviarEnvelopeHomologacaoWlg, validarEnvelopeHomologacaoWlg, type EnvelopeHomologacaoWlg } from "./wlgHomologacao.server";
import type { VinculoWlg } from "./wlgVinculos";

const vinculo: VinculoWlg = {
  tenantId: "pizza-teste", empresaId: "empresa-teste", cnpj: "11222333000181",
  habilitado: true, homologacaoConcluida: true,
};
const envelope: EnvelopeHomologacaoWlg = {
  empresaId: "empresa-teste", tipoAmbiente: 2,
  ide: { modelo: 65 }, emitente: { cnpj: vinculo.cnpj },
  itens: [{ codigoProduto: "produto-sintetico" }],
  totais: { valorCentavos: 1000 }, pagamento: { metodo: "simulado" },
};
const credenciais = { clientId: "client-teste", clientSecret: "secret-teste" };
const op = "6313f8c8-1111-4111-8111-123456789012";

function fake(statusEmissao = 202, bodyEmissao: unknown = { operationId: op, status: "PROCESSANDO" }) {
  const chamadas: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    chamadas.push({ url, init });
    if (url.endsWith("/auth/token"))
      return new Response(JSON.stringify({ accessToken: "token-de-teste" }), { status: 200 });
    return new Response(JSON.stringify(bodyEmissao), { status: statusEmissao });
  };
  return { chamadas, fetcher };
}

describe("WLG — transporte de homologação sem execução real", () => {
  it("exige empresa/CNPJ vinculados e modelo 65, somente ambiente 2", () => {
    expect(validarEnvelopeHomologacaoWlg(envelope, vinculo, vinculo.cnpj)).toBe(true);
    expect(validarEnvelopeHomologacaoWlg(envelope, {
      ...vinculo, habilitado: false, homologacaoConcluida: false,
    }, vinculo.cnpj)).toBe(true); // deve permitir preparar testes antes de habilitar produção
    expect(validarEnvelopeHomologacaoWlg({ ...envelope, empresaId: "outro" }, vinculo, vinculo.cnpj)).toBe(false);
    expect(validarEnvelopeHomologacaoWlg({
      ...envelope, emitente: { cnpj: "12345678000195" },
    }, vinculo, vinculo.cnpj)).toBe(false);
    expect(validarEnvelopeHomologacaoWlg({ ...envelope, tipoAmbiente: 1 as 2 }, vinculo, vinculo.cnpj)).toBe(false);
    expect(validarEnvelopeHomologacaoWlg({ ...envelope, ide: { modelo: 55 as 65 } }, vinculo, vinculo.cnpj)).toBe(false);
  });
  it("por padrão jamais envia quando contrato não aprovado", async () => {
    const { chamadas, fetcher } = fake();
    await expect(enviarEnvelopeHomologacaoWlg(envelope, vinculo, vinculo.cnpj, credenciais, false, fetcher)).rejects.toThrow();
    expect(chamadas).toHaveLength(0);
  });
  it("não envia usando empresa de outra pizzaria", async () => {
    const { chamadas, fetcher } = fake();
    await expect(enviarEnvelopeHomologacaoWlg(
      { ...envelope, empresaId: "empresa-b" }, vinculo, vinculo.cnpj, credenciais, true, fetcher,
    )).rejects.toThrow();
    expect(chamadas).toHaveLength(0);
  });
  it("aceita apenas 202 com operationId, nunca declara autorização", async () => {
    const { chamadas, fetcher } = fake();
    const resultado = await enviarEnvelopeHomologacaoWlg(
      envelope, vinculo, vinculo.cnpj, credenciais, true, fetcher,
    );
    expect(resultado).toEqual({ situacao: "processando", operationId: op });
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1].init?.method).toBe("POST");
    expect(chamadas[1].url).toBe("https://fiscal.wlgsistemas.com.br/api/v1/nfe");
    expect((chamadas[1].init?.body as string)).not.toContain(credenciais.clientSecret);
  });
  it("resposta 409, 500, 200 ou 202 sem operationId é estado incerto", async () => {
    for (const [code, body] of [[409, {}], [500, {}], [200, { operationId: op }], [202, {}]] as const) {
      const { chamadas, fetcher } = fake(code, body);
      await expect(enviarEnvelopeHomologacaoWlg(
        envelope, vinculo, vinculo.cnpj, credenciais, true, fetcher,
      )).rejects.toThrow("Proibido reenviar");
      expect(chamadas).toHaveLength(2);
    }
  });
});
