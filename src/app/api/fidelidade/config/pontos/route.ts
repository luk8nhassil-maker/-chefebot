import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import {
  obterConfigFidelidadePontos,
  salvarConfigFidelidadePontos,
  CONFIG_FIDELIDADE_PONTOS_PADRAO,
  type ConfigFidelidadePontos,
  type RecompensaPontosConfig,
  type TipoRecompensaPontos,
} from "@/lib/fidelidade";

// Configuração administrativa da fidelidade por pontos (Etapa 5) — extensão
// aditiva e independente de /api/fidelidade/config (modelo antigo por
// pizzas, que continua funcionando sem alteração). Mesmo padrão de
// autenticação/permissões: leitura para admin/atendente/dev, escrita restrita
// a admin/dev. Nunca expõe chaves internas do Redis.

const TIPOS_RECOMPENSA_VALIDOS: TipoRecompensaPontos[] = ["desconto_fixo", "pizza_gratis"];

async function checkAuthLeitura(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || !["admin", "atendente", "dev"].includes(payload.role as string)) return null;
  return payload;
}

function validarRecompensa(bruto: unknown): { recompensa?: RecompensaPontosConfig; erro?: string } {
  if (!bruto || typeof bruto !== "object") return {};
  const r = bruto as Record<string, unknown>;

  const ativa = Boolean(r.ativa);
  const custoPontos = Math.max(0, Math.round(Number(r.custoPontos) || 0));
  const tipo: TipoRecompensaPontos = TIPOS_RECOMPENSA_VALIDOS.includes(r.tipo as TipoRecompensaPontos)
    ? (r.tipo as TipoRecompensaPontos)
    : "desconto_fixo";
  const descricao = (typeof r.descricao === "string" ? r.descricao : "").slice(0, 120).trim();

  if (!ativa) {
    // Recompensa desativada é sempre aceita, mesmo com campos incompletos —
    // fica só guardada, indisponível para resgate até ser ativada de novo.
    return {
      recompensa: {
        ativa: false,
        custoPontos,
        tipo,
        descricao,
        ...(r.valorDescontoCentavos ? { valorDescontoCentavos: Math.max(0, Math.round(Number(r.valorDescontoCentavos))) } : {}),
        ...(r.valorMaximoCentavos ? { valorMaximoCentavos: Math.max(0, Math.round(Number(r.valorMaximoCentavos))) } : {}),
      },
    };
  }

  if (custoPontos <= 0) return { erro: "Custo em pontos da recompensa deve ser maior que zero" };
  if (!descricao) return { erro: "Descrição da recompensa é obrigatória" };

  if (tipo === "desconto_fixo") {
    const valorDescontoCentavos = Math.round(Number(r.valorDescontoCentavos) || 0);
    if (valorDescontoCentavos <= 0) return { erro: "Valor do desconto (em centavos) deve ser maior que zero" };
    return { recompensa: { ativa, custoPontos, tipo, descricao, valorDescontoCentavos } };
  }

  // pizza_gratis
  const valorMaximoBruto = r.valorMaximoCentavos;
  const valorMaximoCentavos =
    valorMaximoBruto !== undefined && valorMaximoBruto !== null && valorMaximoBruto !== ""
      ? Math.max(0, Math.round(Number(valorMaximoBruto) || 0))
      : undefined;
  return {
    recompensa: {
      ativa,
      custoPontos,
      tipo,
      descricao,
      ...(valorMaximoCentavos ? { valorMaximoCentavos } : {}),
    },
  };
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

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Corpo da requisição inválido" }, { status: 400 });
  }

  const metaPontosBruto = Number(body.metaPontos);
  if (body.metaPontos !== undefined && (!Number.isFinite(metaPontosBruto) || metaPontosBruto <= 0)) {
    return NextResponse.json({ error: "Meta em pontos deve ser maior que zero" }, { status: 400 });
  }

  const { recompensa, erro } = validarRecompensa(body.recompensa);
  if (erro) return NextResponse.json({ error: erro }, { status: 400 });

  const config: ConfigFidelidadePontos = {
    ativo: Boolean(body.ativo),
    metaPontos: metaPontosBruto > 0 ? Math.round(metaPontosBruto) : CONFIG_FIDELIDADE_PONTOS_PADRAO.metaPontos,
    descricaoRecompensa: (typeof body.descricaoRecompensa === "string" ? body.descricaoRecompensa : CONFIG_FIDELIDADE_PONTOS_PADRAO.descricaoRecompensa).slice(0, 120),
    ...(body.validadeDias ? { validadeDias: Math.max(1, Number(body.validadeDias)) } : {}),
    ...(recompensa ? { recompensa } : {}),
  };

  await salvarConfigFidelidadePontos(config);
  return NextResponse.json({ ok: true, config });
}
