import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import {
  obterConfigFidelidadePontos,
  salvarConfigFidelidadePontos,
  CONFIG_FIDELIDADE_PONTOS_PADRAO,
  type ConfigFidelidadePontos,
} from "@/lib/fidelidade";

// GET/POST /api/fidelidade/config/pontos — configuração efetiva do programa
// de pontos (Nível 6.6): a MESMA que a área do cliente lê (config:fidelidade:
// pontos, via obterConfigFidelidadePontos/salvarConfigFidelidadePontos, já
// existentes em src/lib/fidelidade.ts mas nunca antes ligadas a uma rota).
// Antes desta rota, o painel admin só sabia escrever config:fidelidade (o
// modelo antigo de pizzas, /api/fidelidade/config) — chave que a tela do
// cliente nunca leu, deixando o programa de pontos sempre `ativo:false` em
// produção independente do que o admin fizesse. Não apaga nem migra
// config:fidelidade automaticamente: só passa a existir um lugar que
// realmente escreve a config que o cliente consome. Mesmo padrão de
// autenticação de /api/fidelidade/config (admin/dev escrevem, atendente só lê).

async function checkAuthLeitura(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || !["admin", "atendente", "dev"].includes(payload.role as string)) return null;
  return payload;
}

export async function GET(req: NextRequest) {
  const auth = await checkAuthLeitura(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  const config = await obterConfigFidelidadePontos();
  return NextResponse.json(config);
}

export async function POST(req: NextRequest) {
  const auth = await checkAuthLeitura(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  if (auth.role !== "admin" && auth.role !== "dev") {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 403 });
  }

  // Carrega a config atual e faz merge por cima dela — nunca cria um objeto
  // novo do zero. O formulário do admin só edita ativo/metaPontos/
  // descricaoRecompensa; campos que ele não conhece (valorPizzaFamiliaReferencia,
  // metaPizzasFamilia, validadeDias) precisam sobreviver ao salvamento, senão
  // o resgate (que usa valorPizzaFamiliaReferencia para calcular
  // valorDescontoMaximo) quebra silenciosamente depois do primeiro save.
  const atual = await obterConfigFidelidadePontos();

  const body = await req.json();

  const metaBruta = Number(body?.metaPontos);
  const metaAtualValida = Number.isFinite(Number(atual.metaPontos)) && Number(atual.metaPontos) > 0
    ? Number(atual.metaPontos)
    : CONFIG_FIDELIDADE_PONTOS_PADRAO.metaPontos;
  const metaPontos = Number.isFinite(metaBruta) && metaBruta > 0 ? Math.round(metaBruta) : metaAtualValida;

  const descricaoBruta = typeof body?.descricaoRecompensa === "string" ? body.descricaoRecompensa.trim() : "";
  const descricaoRecompensa = (descricaoBruta || atual.descricaoRecompensa || CONFIG_FIDELIDADE_PONTOS_PADRAO.descricaoRecompensa)
    .toString()
    .slice(0, 120);

  const config: ConfigFidelidadePontos = {
    ...atual,
    ativo: Boolean(body?.ativo),
    metaPontos,
    descricaoRecompensa,
  };

  await salvarConfigFidelidadePontos(config);
  return NextResponse.json({ ok: true, config });
}
