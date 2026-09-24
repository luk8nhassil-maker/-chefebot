import { createHash, createHmac } from "node:crypto";
import { redis } from "./redis";
import type { MomentoPesquisaId } from "./pesquisaPreferencia";
import type { ContatoPesquisaRegistrado } from "./pesquisaPreferenciaContato";

const TTL_LEDGER_SEGUNDOS = 100 * 24 * 60 * 60;
const JANELA_LEITURA_DIAS = 90;
const MS_DIA = 24 * 60 * 60 * 1000;
const CHAVE_INICIO_LEDGER = "pesquisa:contatos:v1:iniciado-em";

export type OrigemContatoPesquisa =
  | "motor_preferencia"
  | "avaliacao_pos_entrega_legada";

export type RegistroContatoPesquisa = {
  exposureId: string;
  questionId: string;
  momentId: MomentoPesquisaId | null;
  sentAtMs: number;
  origem: OrigemContatoPesquisa;
};

type RedisPesquisa = typeof redis & {
  zadd: (
    key: string,
    opts: { score: number; member: string }
  ) => Promise<number>;
  zrange: (
    key: string,
    min: number | string,
    max: number | string,
    opts?: { byScore?: boolean }
  ) => Promise<string[]>;
};

const aredis = redis as RedisPesquisa;

const REGISTRAR_CONTATO_LUA = \`
if redis.call("GET", KEYS[1]) then
  return 0
end
redis.call("SET", KEYS[1], "1", "EX", ARGV[3])
redis.call("ZADD", KEYS[2], ARGV[1], ARGV[2])
redis.call("EXPIRE", KEYS[2], ARGV[3])
redis.call("SET", KEYS[3], ARGV[1], "NX")
return 1
\`;

function segredoPseudonimo(): string | null {
  const segredo =
    process.env.PESQUISA_PSEUDONYM_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    "";
  return segredo || null;
}

function telefoneCanonicoPesquisa(telefone: string): string | null {
  const digitos = String(telefone || "").replace(/\D/g, "");
  if (digitos.length === 10 || digitos.length === 11) return "55" + digitos;
  if (
    (digitos.length === 12 || digitos.length === 13) &&
    digitos.startsWith("55")
  ) {
    return digitos;
  }
  return null;
}

export function customerKeyPesquisaDoTelefone(telefone: string): string | null {
  const canonico = telefoneCanonicoPesquisa(telefone);
  const segredo = segredoPseudonimo();
  if (!canonico || !segredo) return null;

  return createHmac("sha256", segredo)
    .update("research-contact:v1:" + canonico)
    .digest("hex");
}

function chaveLedger(customerKey: string): string {
  return "pesquisa:contatos:v1:" + customerKey;
}

function chaveDedup(exposureId: string): string {
  const hash = createHash("sha256").update(exposureId).digest("hex");
  return "pesquisa:contatos:v1:dedup:" + hash;
}

function registroValido(registro: RegistroContatoPesquisa): boolean {
  return (
    Boolean(registro.exposureId) &&
    Boolean(registro.questionId) &&
    Number.isFinite(registro.sentAtMs) &&
    registro.sentAtMs > 0
  );
}

export async function registrarContatoPesquisa(params: {
  telefone: string;
  registro: RegistroContatoPesquisa;
}): Promise<"registrado" | "duplicado" | "identidade_indisponivel"> {
  const { telefone, registro } = params;
  if (!registroValido(registro)) {
    throw new Error("Registro de contato de pesquisa inválido");
  }

  const customerKey = customerKeyPesquisaDoTelefone(telefone);
  if (!customerKey) return "identidade_indisponivel";

  const member = JSON.stringify(registro);
  const resultado = await redis.eval(
    REGISTRAR_CONTATO_LUA,
    [
      chaveDedup(registro.exposureId),
      chaveLedger(customerKey),
      CHAVE_INICIO_LEDGER,
    ],
    [
      String(registro.sentAtMs),
      member,
      String(TTL_LEDGER_SEGUNDOS),
    ]
  );

  return Number(resultado) === 1 ? "registrado" : "duplicado";
}

export async function registrarContatoPesquisaBestEffort(params: {
  telefone: string;
  registro: RegistroContatoPesquisa;
}): Promise<void> {
  try {
    await registrarContatoPesquisa(params);
  } catch {
    console.error("[ChefeBot] Falha ao registrar exposição de pesquisa.");
  }
}

export async function listarContatosPesquisa(params: {
  telefone: string;
  agoraMs?: number;
}): Promise<ContatoPesquisaRegistrado[] | null> {
  const { telefone, agoraMs = Date.now() } = params;
  const customerKey = customerKeyPesquisaDoTelefone(telefone);
  if (!customerKey) return null;

  const inicioMs = agoraMs - JANELA_LEITURA_DIAS * MS_DIA;

  try {
    const membros = await aredis.zrange(
      chaveLedger(customerKey),
      inicioMs,
      agoraMs,
      { byScore: true }
    );

    const contatos: ContatoPesquisaRegistrado[] = [];
    for (const member of membros) {
      try {
        const registro = JSON.parse(member) as Partial<RegistroContatoPesquisa>;
        if (
          typeof registro.questionId === "string" &&
          typeof registro.sentAtMs === "number" &&
          Number.isFinite(registro.sentAtMs)
        ) {
          contatos.push({
            momentId: registro.momentId ?? null,
            questionId: registro.questionId,
            sentAtMs: registro.sentAtMs,
          });
        }
      } catch {
      }
    }

    return contatos.sort((a, b) => a.sentAtMs - b.sentAtMs);
  } catch {
    return null;
  }
}

export async function obterInicioLedgerContatosPesquisa(): Promise<number | null> {
  try {
    const bruto = await redis.get<string | number>(CHAVE_INICIO_LEDGER);
    const valor = Number(bruto);
    return Number.isFinite(valor) && valor > 0 ? valor : null;
  } catch {
    return null;
  }
}

export function coberturaHistoricoContatos(params: {
  inicioLedgerMs: number | null;
  agoraMs: number;
}) {
  const { inicioLedgerMs, agoraMs } = params;
  if (inicioLedgerMs === null || inicioLedgerMs > agoraMs) {
    return {
      inicioLedgerIso: null,
      cooldown14DiasCompleto: false,
      orcamento90DiasCompleto: false,
    };
  }

  const idade = agoraMs - inicioLedgerMs;
  return {
    inicioLedgerIso: new Date(inicioLedgerMs).toISOString(),
    cooldown14DiasCompleto: idade >= 14 * MS_DIA,
    orcamento90DiasCompleto: idade >= 90 * MS_DIA,
  };
}
