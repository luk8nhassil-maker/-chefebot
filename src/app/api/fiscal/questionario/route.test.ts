import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m=vi.hoisted(()=>({preview:false,db:new Map<string, unknown>()}));
vi.mock("@/lib/previewSafety",()=>({emPreviewVercel:()=>m.preview}));
vi.mock("@/lib/redis",()=>({redis:{
  get:vi.fn(async(k:string)=>m.db.get(k)??null),
  set:vi.fn(async(k:string,v:unknown)=>{m.db.set(k,v);return "OK";}),
  del:vi.fn(async(k:string)=>m.db.delete(k)?1:0),
  eval:vi.fn(async(_lua:string,keys:string[],args:(number|string)[])=>{
    const old=m.db.get(keys[0]) as {versao:number}|undefined;
    if((old?.versao??0)!==Number(args[0]))return 0;
    m.db.set(keys[0],JSON.parse(String(args[1])));return 1;
  }),
}}));
vi.mock("@/lib/apiAuth",()=>({
  autenticarRequisicao:async(req:NextRequest)=>{
    const token=req.cookies.get("auth-token")?.value;
    return token==="owner" ? { username:"donoA",role:"admin",name:"Dono" } :
      token==="employee" ? {username:"staff",role:"atendente",name:"Staff"} : null;
  },
  exigirRole:(u:{role:string}|null,allowed:string[])=>
    !u? NextResponse.json({error:"sem login"},{status:401}) :
    allowed.includes(u.role)?null:NextResponse.json({error:"sem permissão"},{status:403}),
}));
import { GET,PUT,POST } from "@/app/api/fiscal/questionario/route";
import { POST as externo } from "@/app/api/fiscal/questionario/compartilhado/route";

const path="http://localhost/api/fiscal/questionario";
function request(url:string,method:"GET"|"PUT"|"POST",body?:unknown,auth?:string,origin="http://localhost") {
  return new NextRequest(url,{
    method,
    headers:{host:"localhost", ...(method!=="GET"?{origin,"content-type":"application/json"}:{}),
      ...(auth?{cookie:"auth-token="+auth}:{})},
    ...(method!=="GET"?{body:JSON.stringify(body)}:{}),
  });
}
beforeEach(()=>{m.preview=false;m.db.clear();vi.stubEnv("FISCAL_PREFILL_DOCUMENTO_202610","");});
afterEach(()=>vi.unstubAllEnvs());
describe("permissões do formulário compartilhado fiscal",()=>{
  it("sem login ou atendente não cria convite, nem lê formulário do dono",async()=>{
    expect((await GET(request(path,"GET"))).status).toBe(401);
    expect((await GET(request(path,"GET",undefined,"employee"))).status).toBe(403);
    expect((await POST(request(path,"POST",{acao:"criar"}))).status).toBe(401);
  });
  it("link dá acesso SOMENTE ao formulário, sem sessão da equipe",async()=>{
    const invite=await POST(request(path,"POST",{acao:"criar"},"owner"));
    expect(invite.status).toBe(200);
    const {token}=await invite.json();
    expect((await externo(request(path+"/compartilhado","POST",{acao:"ler",token}))).status).toBe(200);
    const denied=await externo(request(path+"/compartilhado","POST",{acao:"ler",token:"invalido"}));
    expect(denied.status).toBe(403);
    const doc=await (await externo(request(path+"/compartilhado","POST",{acao:"ler",token}))).json();
    expect(doc).not.toHaveProperty("titularConta");
    expect(doc).not.toHaveProperty("empresaId");
  });
  it("preenchimento parcial, conflito e revogação funcionam",async()=>{
    const {token}=await (await POST(request(path,"POST",{acao:"criar"},"owner"))).json();
    const r=await externo(request(path+"/compartilhado","POST",{acao:"salvar",token,versao:0,respostas:{razaoSocial:"Empresa fictícia"}}));
    expect(r.status).toBe(200);
    expect((await r.json()).respostas.razaoSocial).toBe("Empresa fictícia");
    expect((await PUT(request(path,"PUT",{versao:0,respostas:{razaoSocial:"atrasado"}},"owner"))).status).toBe(409);
    expect((await POST(request(path,"POST",{acao:"revogar"},"owner"))).status).toBe(200);
    expect((await externo(request(path+"/compartilhado","POST",{acao:"ler",token}))).status).toBe(403);
  });
  it("Preview proíbe acesso ao Redis e Origin cruzada não altera rascunho",async()=>{
    m.preview=true;
    expect((await GET(request(path,"GET",undefined,"owner"))).status).toBe(403);
    expect((await POST(request(path,"POST",{acao:"criar"},"owner"))).status).toBe(403);
    expect((await externo(request(path+"/compartilhado","POST",{acao:"ler",token:"bad"}))).status).toBe(403);
    m.preview=false;
    expect((await PUT(request(path,"PUT",{versao:0,respostas:{}},"owner","https://invasor.test"))).status).toBe(403);
    expect((await externo(request(path+"/compartilhado","POST",{acao:"ler",token:"x"},"","https://invasor.test"))).status).toBe(403);
  });
  it("importação privada só funciona no admin certo, na origem certa e fora do Preview", async () => {
    const dados = { versao:1, titularConta:"donoA", respostas:{
      cnpj:"11.222.333/0001-81", razaoSocial:"Empresa fictícia de Teste",
      inscricaoEstadual:"123456789", uf:"MA", municipio:"Cidade de Teste",
      cep:"65413000", logradouro:"Rua das Flores", numero:"49", bairro:"CENTRO",
    }};
    vi.stubEnv("FISCAL_PREFILL_DOCUMENTO_202610", JSON.stringify(dados));
    const user = await GET(request(path,"GET",undefined,"owner"));
    expect((await user.json()).importacaoDisponivel).toBe(true);
    expect((await POST(request(path,"POST",{acao:"importar_dados_da_nota"}))).status).toBe(401);
    expect((await POST(request(path,"POST",{acao:"importar_dados_da_nota"},"employee"))).status).toBe(403);
    expect((await POST(request(path,"POST",{acao:"importar_dados_da_nota"},"owner","https://invasor.test"))).status).toBe(403);
    m.preview=true;
    expect((await POST(request(path,"POST",{acao:"importar_dados_da_nota"},"owner"))).status).toBe(403);
    m.preview=false;
    const importado=await POST(request(path,"POST",{acao:"importar_dados_da_nota"},"owner"));
    expect(importado.status).toBe(200);
    expect((await importado.json()).respostas.cnpj).toBe("11222333000181");
    const novamente=await POST(request(path,"POST",{acao:"importar_dados_da_nota"},"owner"));
    expect((await novamente.json()).status).toBe("ja_preenchido");
    expect((await (await GET(request(path,"GET",undefined,"owner"))).json()).importacaoDisponivel).toBe(false);
  });
  it("não permite que corpo da requisição altere empresa, regras ou dados da importação", async () => {
    vi.stubEnv("FISCAL_PREFILL_DOCUMENTO_202610", JSON.stringify({
      versao:1,titularConta:"outro-dono",respostas:{cnpj:"11.222.333/0001-81",razaoSocial:"Empresa Outro"},
    }));
    const r=await POST(request(path,"POST",{acao:"importar_dados_da_nota"},"owner"));
    expect((await r.json()).status).toBe("nao_disponivel");
    const forjado=await POST(request(path,"POST",{
      acao:"importar_dados_da_nota",titularConta:"donoA",respostas:{cnpj:"11.222.333/0001-81"},
    },"owner"));
    expect(forjado.status).toBe(400);
    expect(m.db.size).toBe(0);
  });
  it("nunca aceita certificados ou status de emissão informados pelo cliente",async()=>{
    const {token}=await (await POST(request(path,"POST",{acao:"criar"},"owner"))).json();
    const r=await externo(request(path+"/compartilhado","POST",{acao:"salvar",token,versao:0,respostas:{clientSecret:"segredo"}}));
    expect(r.status).toBe(400);
    expect((await PUT(request(path,"PUT",{versao:0,respostas:{podeEmitir:true}},"owner"))).status).toBe(400);
  });
});
