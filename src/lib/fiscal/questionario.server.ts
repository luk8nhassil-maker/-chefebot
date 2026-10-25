import { createHash, randomBytes } from "node:crypto";
import { redis } from "@/lib/redis";
import { validarRespostas, VAZIO, type QuestionarioFiscal, type RespostasFiscais } from "./questionario";
import type { CadastroFiscalGuardado } from "./cadastroFiscal";

const DURA_SEGUNDOS = 72 * 60 * 60;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const nomeValido = (name: string) => /^[A-Za-z0-9_.-]{1,100}$/.test(name);
const chave = (owner: string) => {
  if (!nomeValido(owner)) throw new Error("Identidade inválida");
  return "fiscal:questionario:v1:" + hash(owner);
};
const conviteChave = (digest: string) => "fiscal:convite-contador:v1:" + digest;
const ativoChave = (owner: string) => "fiscal:convite-ativo:v1:" + hash(owner);

export function respostasPublicas(doc: QuestionarioFiscal) {
  return { versao: doc.versao, atualizadoEm: doc.atualizadoEm, respostas: doc.respostas };
}

export async function carregarQuestionario(owner: string): Promise<QuestionarioFiscal> {
  const existing = await redis.get<QuestionarioFiscal>(chave(owner));
  if (existing) {
    if (existing.schemaVersion !== 1 || existing.titularConta !== owner ||
        existing.situacao !== "rascunho_pendente_vinculo" ||
        !Number.isSafeInteger(existing.versao) || existing.versao < 1)
      throw new Error("Questionário incompatível");
    return existing;
  }
  // Importação de leitura: o registro v1 continua intocado. Somente campos informativos.
  const old = await redis.get<CadastroFiscalGuardado>("fiscal:cadastro-dono:v1:" + hash(owner));
  if (old && (old.titularConta !== owner || old.schemaVersion !== 1 ||
      old.situacao !== "rascunho_pendente_vinculo")) throw new Error("Cadastro incompatível");
  return {
    schemaVersion: 1, titularConta: owner, situacao: "rascunho_pendente_vinculo",
    versao: 0, atualizadoEm: "",
    respostas: { ...VAZIO, ...(old ? {
      cnpj: old.cnpj, razaoSocial: old.razaoSocial, nomeFantasia: old.nomeFantasia,
      inscricaoEstadual: old.inscricaoEstadual, uf: old.uf, municipio: old.municipio,
      regimeTributario: old.regimeTributario,
    } : {}) },
  };
}

// Escrita condicional atômica: impede que dono e contador se sobrescrevam.
const CAS = [
  "local old = redis.call('GET', KEYS[1])",
  "if not old then",
  "  if tonumber(ARGV[1]) ~= 0 then return 0 end",
  "  redis.call('SET', KEYS[1], ARGV[2])",
  "  return 1",
  "end",
  "local ok, data = pcall(cjson.decode, old)",
  "if not ok or type(data) ~= 'table' or tonumber(data.versao) ~= tonumber(ARGV[1]) then return 0 end",
  "redis.call('SET', KEYS[1], ARGV[2])",
  "return 1",
].join("\n");

export async function salvarQuestionario(
  owner: string, versao: number, respostas: RespostasFiscais,
): Promise<QuestionarioFiscal | null> {
  if (!Number.isSafeInteger(versao) || versao < 0) throw new Error("Versão inválida");
  const valid = validarRespostas(respostas);
  const doc: QuestionarioFiscal = {
    schemaVersion: 1, titularConta: owner, situacao: "rascunho_pendente_vinculo",
    versao: versao + 1, atualizadoEm: new Date().toISOString(), respostas: valid,
  };
  const ok = await redis.eval(CAS, [chave(owner)], [versao, JSON.stringify(doc)]);
  return ok === 1 ? doc : null;
}

type Convite = { owner: string; digest: string; expiresAt: number };
export async function criarConvite(owner: string) {
  chave(owner);
  const token = randomBytes(32).toString("base64url");
  const digest = hash(token);
  const expiresAt = Date.now() + DURA_SEGUNDOS * 1000;
  const registro: Convite = { owner, digest, expiresAt };
  // Rotacionar: mesmo que uma exclusão falhe, o token antigo não passa pela chave ativa.
  await redis.set(conviteChave(digest), registro, { ex: DURA_SEGUNDOS });
  await redis.set(ativoChave(owner), digest, { ex: DURA_SEGUNDOS });
  return { token, expiresAt };
}
export async function existeConvite(owner: string): Promise<boolean> {
  chave(owner);
  return Boolean(await redis.get<string>(ativoChave(owner)));
}
export async function revogarConvite(owner: string): Promise<void> {
  chave(owner);
  // Nunca deixar um convite antigo ativo; o seu registro expira por TTL.
  await redis.del(ativoChave(owner));
}
export async function donoPorConvite(token: unknown): Promise<string | null> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const digest = hash(token);
  const registro = await redis.get<Convite>(conviteChave(digest));
  if (!registro || registro.digest !== digest || registro.expiresAt <= Date.now() ||
      !nomeValido(registro.owner)) return null;
  const atual = await redis.get<string>(ativoChave(registro.owner));
  return atual === digest ? registro.owner : null;
}
