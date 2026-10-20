import { NextRequest } from "next/server";
import { autenticarRequisicao, exigirRole } from "@/lib/apiAuth";
import { ranking3, ranking3Ativo } from "@/lib/ranking3/server";
import { redis } from "@/lib/redis";

export async function GET(req: NextRequest) {
  const denied = exigirRole(await autenticarRequisicao(req), ["dev"]);
  if (denied) return denied;
  const store = ranking3();
  try {
    const [config, checkpoint, vinculos] = await Promise.all([store.config(), redis.get<number>(store.chave("checkpoint")), redis.scard(store.chave("vinculos"))]);
    const resultado = checkpoint !== null ? await store.resultado(checkpoint) : null;
    const ids = await redis.smembers<string[]>(store.chave("premios"));
    const direitos = await Promise.all(ids.map((id) => store.premio(id)));
    const premios: Record<string, number> = {};
    for (const direito of direitos) {
      if (!direito) throw new Error("indice_premios_inconsistente");
      premios[direito.estado] = (premios[direito.estado] ?? 0) + 1;
    }
    return Response.json({ ativo: ranking3Ativo(), configurado: Boolean(config), atual: await store.atual(), ultimoIndiceFechado: checkpoint, ultimoCorteFechado: resultado?.janela.fim ?? null, campeoesUltimoFechamento: resultado?.campeoes.length ?? 0, decisaoPendente: resultado?.decisaoPendente ?? null, premios, vinculosPendentes: vinculos, avisosDevidos: await redis.zcount(store.chave("avisos"), 0, Date.now()), avisosParaReconciliar: await redis.scard(store.chave("avisos-reconciliar")), avisosEmRevisao: await redis.scard(store.chave("avisos-revisao")), whatsappGeral: false }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Auditoria indisponível" }, { status: 503 });
  }
}
