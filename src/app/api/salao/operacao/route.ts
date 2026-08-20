import { NextRequest, NextResponse } from "next/server";
import { lerSessaoSalao } from "@/lib/salaoAuth";
import { lerSessaoAdministrativa } from "@/lib/sessaoAdministrativa";
import { listarResumosOperacionais } from "@/lib/salaoConta.server";
import { descreverStatusPedidoSalao } from "@/lib/salaoConta";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const [salao, admin] = await Promise.all([lerSessaoSalao(req), lerSessaoAdministrativa(req)]);
  if (!salao && !admin) return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });

  try {
    const resumos = await listarResumosOperacionais();
    const comandas = resumos.map((resumo) => ({
      id: resumo.comanda.id,
      numero: resumo.comanda.numero,
      cliente: resumo.comanda.cliente,
      mesa: resumo.comanda.mesa,
      complemento: resumo.comanda.complemento,
      abertaEm: resumo.comanda.abertaEm,
      statusComanda: resumo.comanda.status,
      conta: resumo.conta,
      totalAtivoCentavos: resumo.totalAtivoCentavos,
      todosServidos: resumo.todosServidos,
      temRodadaEmAndamento: resumo.temRodadaEmAndamento,
      envios: resumo.envios.map((envio) => ({
        ...envio,
        estado: descreverStatusPedidoSalao(envio.status),
      })),
    }));
    return NextResponse.json({ ok: true, comandas }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[Salão] Falha ao listar operação:", error instanceof Error ? error.message : "erro desconhecido");
    return NextResponse.json({ ok: false, error: "Não foi possível carregar as comandas agora." }, { status: 503 });
  }
}
