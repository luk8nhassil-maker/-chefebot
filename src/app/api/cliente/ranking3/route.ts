import { NextRequest } from "next/server";
import { lerSessaoCliente } from "@/lib/clienteAuth";
import { buscarClientePorId } from "@/lib/clientes";
import { derivarClienteIdPorTelefone } from "@/lib/fidelidade";
import { ranking3, ranking3Ativo } from "@/lib/ranking3/server";
import { saboresElegiveis, premioPublico } from "@/lib/ranking3/domain";
import { getMENUDinamico } from "@/lib/menu.server";
import { obterEsgotadosLegado, obterEstoqueItens } from "@/lib/estoque";
import { buildPizzaCatalog } from "@/lib/catalog/pizzas";

export async function GET(req: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  const sessao = await lerSessaoCliente(req);
  if (!sessao) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const perfil = await buscarClientePorId(sessao.clienteId);
  if (!perfil) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  if (!ranking3Ativo()) return Response.json({ painel: null, premios: [] }, { headers });
  try {
    const clienteId = derivarClienteIdPorTelefone(perfil.telefone) ?? perfil.clienteId;
    const [carteira, menu, esgotados, estoque] = await Promise.all([ranking3().carteira(clienteId), getMENUDinamico(), obterEsgotadosLegado(), obterEstoqueItens()]);
    const catalogo = buildPizzaCatalog(menu, esgotados, Object.values(estoque).filter((i) => i.esgotado).map((i) => i.id));
    const premios = carteira.map((premio) => ({ ...premioPublico(premio), sabores: saboresElegiveis(premio, catalogo).map((f) => ({ id: f.id, nome: f.name })) }));
    return Response.json({ painel: null, premios }, { headers });
  } catch {
    return Response.json({ error: "Ranking indisponível. Seus direitos estão preservados." }, { status: 503, headers });
  }
}
