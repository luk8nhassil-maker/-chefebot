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
/** Chave de configuração já lida pelo caminho normal do app — leitura barata e sem PII. */
const CHAVE_SONDA = "bot_ativo";

type Veredito = {
  ok: boolean;
  configurado: boolean;
  variaveisAusentes: string[];
  latenciaMs: number;
  classe?: string;
  statusProvedor?: number | null;
  mensagem?: string;
  acao?: string;
  verificadoEm: string;
};

let ultimoVeredito: Veredito | null = null;
let ultimaSondaEm = 0;

async function sondar(): Promise<Veredito> {
  const iniciadoEm = Date.now();
  const ausentes = variaveisDatastoreAusentes();

  if (!datastoreConfigurado()) {
    return {
      ok: false,
      configurado: false,
      variaveisAusentes: ausentes,
      latenciaMs: 0,
      classe: "configuracao_ausente",
      statusProvedor: null,
      mensagem: "Variáveis do datastore ausentes no runtime.",
      acao: ACAO_SUGERIDA.configuracao_ausente,
      verificadoEm: new Date().toISOString(),
    };
  }

  try {
    // Leitura pura: o valor lido é descartado, só interessa se a chamada
    // completou. Nada do conteúdo é devolvido na resposta.
    await redis.get(CHAVE_SONDA);
    return {
      ok: true,
      configurado: true,
      variaveisAusentes: [],
      latenciaMs: Date.now() - iniciadoEm,
      verificadoEm: new Date().toISOString(),
    };
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
      configurado: true,
      variaveisAusentes: [],
      latenciaMs: Date.now() - iniciadoEm,
      classe: falha.classe,
      statusProvedor: falha.statusProvedor,
      mensagem: falha.mensagem,
      acao: ACAO_SUGERIDA[falha.classe],
      verificadoEm: new Date().toISOString(),
    };
  }
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
