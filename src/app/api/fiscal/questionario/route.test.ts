import { beforeEach, describe, expect, it, vi } from "vitest";
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
beforeEach(()=>{m.preview=false;m.db.clear();});
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
  it("nunca aceita certificados ou status de emissão informados pelo cliente",async()=>{
    const {token}=await (await POST(request(path,"POST",{acao:"criar"},"owner"))).json();
    const r=await externo(request(path+"/compartilhado","POST",{acao:"salvar",token,versao:0,respostas:{clientSecret:"segredo"}}));
    expect(r.status).toBe(400);
    expect((await PUT(request(path,"PUT",{versao:0,respostas:{podeEmitir:true}},"owner"))).status).toBe(400);
  });
});
