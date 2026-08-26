// GET /api/diagnostico/datastore — sonda SOMENTE-LEITURA do datastore.
//
// Por que existe: no incidente de /pedidos preso em "Carregando...", a causa
// era o datastore respondendo erro, mas o 500 do Next chega sem corpo. Sem
// acesso ao painel do provedor não havia como dizer se era credencial, cota,
// cobrança ou rede — e sem isso não há ação possível. Esta rota responde
// exatamente essa pergunta.
//
// Garantias:
// - Só LÊ. Faz um único `get` de uma chave de configuração que o app já lê no
//   caminho normal. Nunca escreve, nunca apaga, nunca toca em pedido/cliente.
// - Nunca devolve URL do datastore, token, credencial ou PII: a mensagem do
//   provedor passa por higienizarMensagemDatastore antes de sair.
// - Estrangulada em memória (uma sonda real a cada JANELA_SONDA_MS por
//   instância quente): se a falha for justamente de cota, esta rota não vira
//   um amplificador de consumo.

import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import {
  ACAO_SUGERIDA,
  classificarFalhaDatastore,
  datastoreConfigurado,
  variaveisDatastoreAusentes,
} from "@/lib/datastoreDiagnostico";

export const dynamic = "force-dynamic";

const JANELA_SONDA_MS = 30_000;
/**
 * A falha observada no incidente é INTERMITENTE: leituras seguidas alternam
 * entre erro e sucesso. Uma única tentativa mentiria metade das vezes, então
 * a sonda faz algumas e relata TODAS.
 */
const TENTATIVAS = 3;
/** Chave de configuração já lida pelo caminho normal do app — leitura barata e sem PII. */
const CHAVE_SONDA = "bot_ativo";

type Tentativa = {
  ok: boolean;
  latenciaMs: number;
  classe?: string;
  statusProvedor?: number | null;
  mensagem?: string;
};

type Veredito = {
  ok: boolean;
  intermitente: boolean;
  configurado: boolean;
  variaveisAusentes: string[];
  tentativas: Tentativa[];
  classe?: string;
  acao?: string;
  verificadoEm: string;
};

let ultimoVeredito: Veredito | null = null;
let ultimaSondaEm = 0;

async function umaTentativa(): Promise<Tentativa> {
  const iniciadoEm = Date.now();
  try {
    // Leitura pura: o valor lido é descartado, só interessa se a chamada
    // completou. Nada do conteúdo é devolvido na resposta.
    await redis.get(CHAVE_SONDA);
    return { ok: true, latenciaMs: Date.now() - iniciadoEm };
  } catch (err) {
    const falha = classificarFalhaDatastore(err);
    console.error(
      "[ChefeBot] Sonda do datastore falhou:",
      falha.classe,
      falha.statusProvedor ?? "sem status",
      falha.mensagem
    );
    return {
      ok: false,
      latenciaMs: Date.now() - iniciadoEm,
      classe: falha.classe,
      statusProvedor: falha.statusProvedor,
      mensagem: falha.mensagem,
    };
  }
}

async function sondar(): Promise<Veredito> {
  if (!datastoreConfigurado()) {
    return {
      ok: false,
      intermitente: false,
      configurado: false,
      variaveisAusentes: variaveisDatastoreAusentes(),
      tentativas: [],
      classe: "configuracao_ausente",
      acao: ACAO_SUGERIDA.configuracao_ausente,
      verificadoEm: new Date().toISOString(),
    };
  }

  const tentativas: Tentativa[] = [];
  for (let i = 0; i < TENTATIVAS; i++) tentativas.push(await umaTentativa());

  const falhas = tentativas.filter((t) => !t.ok);
  const primeiraFalha = falhas[0];
  const classe = primeiraFalha?.classe as keyof typeof ACAO_SUGERIDA | undefined;

  return {
    ok: falhas.length === 0,
    // Falhar às vezes e funcionar outras muda o diagnóstico: não é credencial
    // errada nem variável ausente (essas falhariam sempre).
    intermitente: falhas.length > 0 && falhas.length < tentativas.length,
    configurado: true,
    variaveisAusentes: [],
    tentativas,
    classe,
    acao: classe ? ACAO_SUGERIDA[classe] : undefined,
    verificadoEm: new Date().toISOString(),
  };
}

export async function GET() {
  const agora = Date.now();
  const podeSondar = ultimoVeredito === null || agora - ultimaSondaEm >= JANELA_SONDA_MS;

  if (podeSondar) {
    ultimaSondaEm = agora;
    ultimoVeredito = await sondar();
  }

  const veredito = ultimoVeredito!;
  return NextResponse.json(
    { ...veredito, emCache: !podeSondar },
    {
      // 200 mesmo quando o datastore está fora: a SONDA funcionou. Devolver
      // 5xx aqui faria a rota mentir sobre o próprio diagnóstico.
      status: 200,
      headers: { "Cache-Control": "no-store, max-age=0" },
    }
  );
}
