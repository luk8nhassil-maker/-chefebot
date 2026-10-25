import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ContoraCadastroBloqueado, prepararEmpresaContora,
  sincronizarEmpresaContoraHomologacao, type EnderecoFiscalCompleto,
} from "./contoraCadastro.server";
import type { CadastroFiscalGuardado } from "./cadastroFiscal";

const cadastro: CadastroFiscalGuardado = {
  schemaVersion: 1, titularConta: "empresario-teste",
  situacao: "rascunho_pendente_vinculo", atualizadoEm: "2026-10-24T21:00:00Z",
  cnpj: "11222333000181", razaoSocial: "Empresa Sintética",
  nomeFantasia: "Pizza Exemplo", inscricaoEstadual: "123456789",
  uf: "MA", municipio: "Cidade Exemplo",
  regimeTributario: "simples_nacional", declaracaoResponsavel: true,
};
const endereco: EnderecoFiscalCompleto = {
  codigoIBGE: "2101202", logradouro: "Rua de Teste",
  numero: "100", bairro: "Centro", cep: "65700000",
};
const escopo = {
  tenantId: "restaurante-sintetico", titularAutenticado: "empresario-teste",
  cnpjAutorizado: cadastro.cnpj, titularidadeConferidaNoServidor: true as const,
};
const uuid = "3d2e1b55-2b98-48f2-b55b-feb8d8d72111";
function mockHttp() {
  const chamadas: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    chamadas.push({url,init});
    if (url.endsWith("/me"))
      return new Response(JSON.stringify({ok:true,token:{name:"Homologacao"}}), {status:200});
    return new Response(JSON.stringify({
      ok:true,data:{id:uuid,document:cadastro.cnpj},
    }),{status:201});
  };
  return { fetcher, chamadas };
}
function habilitar() {
  vi.stubEnv("VERCEL_ENV","development");
  vi.stubEnv("FISCAL_CONTORA_CADASTRO_HOMOLOG_LIBERADO","true");
  vi.stubEnv("CONTORA_FISCAL_HOMOLOG_TOKEN","token-falso-unitario");
}
afterEach(()=>vi.unstubAllEnvs());

describe("Contora — alternativa WLG, cadastro automático seguro",()=>{
  it("não inventa dados e traduz regime declarado, homologação fixa",()=>{
    const e=prepararEmpresaContora(cadastro,endereco,"empresario-teste");
    expect(e.tax_regime).toBe("simples");
    expect(e.document).toBe(cadastro.cnpj);
    expect(e.default_environment).toBe("homologacao");
    expect(e.city_code).toBe(endereco.codigoIBGE);
    expect(e).not.toHaveProperty("certificate");
    expect(e).not.toHaveProperty("clientSecret");
  });
  it("rejeita regime não informado e ausência de endereço completo",()=>{
    expect(()=>prepararEmpresaContora({...cadastro,regimeTributario:"nao_informado"},endereco,"empresario-teste")).toThrow(ContoraCadastroBloqueado);
    expect(()=>prepararEmpresaContora(cadastro,{...endereco,codigoIBGE:""}, "empresario-teste")).toThrow();
    expect(()=>prepararEmpresaContora(cadastro,endereco,"outro-dono")).toThrow();
    expect(()=>prepararEmpresaContora(cadastro,{...endereco,cep:"12345"},cadastro.titularConta)).toThrow();
  });
  it("não chama o provedor sem token, sem flag ou em Preview",async()=>{
    const {fetcher,chamadas}=mockHttp();
    const e=prepararEmpresaContora(cadastro,endereco,cadastro.titularConta);
    await expect(sincronizarEmpresaContoraHomologacao(e,escopo,fetcher)).rejects.toThrow();
    habilitar();vi.stubEnv("VERCEL_ENV","preview");
    await expect(sincronizarEmpresaContoraHomologacao(e,escopo,fetcher)).rejects.toThrow();
    expect(chamadas).toHaveLength(0);
  });
  it("não permite enviar empresa de outro tenant ou CNPJ",async()=>{
    habilitar();
    const {fetcher,chamadas}=mockHttp();
    const e=prepararEmpresaContora(cadastro,endereco,cadastro.titularConta);
    await expect(sincronizarEmpresaContoraHomologacao(e,{...escopo,cnpjAutorizado:"12345678000195"},fetcher)).rejects.toThrow();
    expect(chamadas).toHaveLength(0);
  });
  it("verifica /me e executa o upsert oficial com idempotência e CNPJ autorizado",async()=>{
    habilitar();
    const {fetcher,chamadas}=mockHttp();
    const e=prepararEmpresaContora(cadastro,endereco,cadastro.titularConta);
    const result=await sincronizarEmpresaContoraHomologacao(e,escopo,fetcher);
    expect(result).toEqual({id:uuid,cnpj:cadastro.cnpj,ambiente:"homologacao"});
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0].url).toBe("https://fiscal.contora.com.br/api/v1/me");
    expect(chamadas[1].url).toBe("https://fiscal.contora.com.br/api/v1/companies/by-document/"+cadastro.cnpj);
    expect(chamadas[1].init?.method).toBe("PUT");
    const headers=chamadas[1].init?.headers as Record<string,string>;
    expect(headers["Idempotency-Key"]).toBe("empresa-homolog-"+cadastro.cnpj);
    expect(JSON.parse(chamadas[1].init?.body as string).default_environment).toBe("homologacao");
    expect(chamadas[1].init?.body).not.toContain("token-falso-unitario");
  });
  it("rejeita resposta com CNPJ ou identificador que não corresponde",async()=>{
    habilitar();
    const e=prepararEmpresaContora(cadastro,endereco,cadastro.titularConta);
    const fetcher=async (url:string) => new Response(url.endsWith("/me")
      ? JSON.stringify({ok:true})
      : JSON.stringify({data:{id:uuid,document:"12345678000195"}}),{status:200});
    await expect(sincronizarEmpresaContoraHomologacao(e,escopo,fetcher)).rejects.toThrow(ContoraCadastroBloqueado);
  });
  it("401 de autenticação não envia cadastro nem vaza segredo",async()=>{
    habilitar();
    const e=prepararEmpresaContora(cadastro,endereco,cadastro.titularConta);
    let requests=0;
    const fetcher=async ()=>{requests++;return new Response("indisponivel",{status:401})};
    await expect(sincronizarEmpresaContoraHomologacao(e,escopo,fetcher)).rejects.toThrow("não autorizado");
    expect(requests).toBe(1);
  });
});
