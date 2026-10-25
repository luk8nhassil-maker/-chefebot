import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ db:new Map<string, unknown>(), preview:false }));
vi.mock("@/lib/redis", () => ({
  redis: {
    get:vi.fn(async (key:string)=>m.db.get(key)??null),
    set:vi.fn(async (key:string,value:unknown)=>{m.db.set(key,value);return "OK";}),
    del:vi.fn(async (key:string)=>m.db.delete(key)?1:0),
    eval:vi.fn(async (_lua:string, keys:string[], args:(number|string)[])=>{
      const current=m.db.get(keys[0]) as {versao:number}|undefined;
      const expected=Number(args[0]);
      if ((current?.versao??0)!==expected) return 0;
      m.db.set(keys[0],JSON.parse(String(args[1])));return 1;
    }),
  },
}));
import { criarConvite, donoPorConvite, revogarConvite, carregarQuestionario, salvarQuestionario, respostasPublicas } from "./questionario.server";
import { VAZIO } from "./questionario";

beforeEach(()=>m.db.clear());
describe("convite protegido e questionário atômico", () => {
  it("token aleatório de 256 bits expõe só dados do questionário", async () => {
    const {token,expiresAt}=await criarConvite("donoA");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect([...m.db.keys()].some(k=>k.includes(token))).toBe(false);
    expect(await donoPorConvite(token)).toBe("donoA");
    expect(respostasPublicas(await carregarQuestionario("donoA"))).not.toHaveProperty("titularConta");
  });
  it("expiração, revogação, troca de convite e token inválido negam acesso", async () => {
    const first=(await criarConvite("donoA")).token;
    expect(await donoPorConvite(first)).toBe("donoA");
    const second=(await criarConvite("donoA")).token;
    expect(await donoPorConvite(first)).toBeNull();
    expect(await donoPorConvite(second)).toBe("donoA");
    await revogarConvite("donoA");
    expect(await donoPorConvite(second)).toBeNull();
    expect(await donoPorConvite("abc")).toBeNull();
  });
  it("proprietários diferentes não veem ou alteram os mesmos dados", async () => {
    expect(await salvarQuestionario("donoA",0,{...VAZIO,razaoSocial:"Empresa A"})).not.toBeNull();
    expect((await carregarQuestionario("donoB")).respostas.razaoSocial).toBe("");
    expect(await salvarQuestionario("donoB",0,{...VAZIO,razaoSocial:"Empresa B"})).not.toBeNull();
    expect((await carregarQuestionario("donoA")).respostas.razaoSocial).toBe("Empresa A");
  });
  it("versão antiga recebe conflito e não perde alterações simultâneas", async () => {
    expect(await salvarQuestionario("donoA",0,{...VAZIO,razaoSocial:"Primeiro"})).not.toBeNull();
    expect(await salvarQuestionario("donoA",0,{...VAZIO,razaoSocial:"Sobrescrita"})).toBeNull();
    expect((await carregarQuestionario("donoA")).respostas.razaoSocial).toBe("Primeiro");
  });
});
