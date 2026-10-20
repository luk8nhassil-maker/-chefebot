import "server-only";
import { redis } from "../redis";
import { ranking3, ranking3Ativo } from "./server";
import { avisoDevido, copyPremio, FUSO, QUINZE_DIAS, type Premio } from "./domain";
import { clienteTemOptOutConviteRankingWhatsapp } from "../rankingConviteWhatsapp";
import { buscarClientePorId } from "../clientes";
import { obterParticipacaoRanking } from "../consentimentoRanking";
import { normalizarTelefoneCanarioWhatsapp } from "../whatsappCanaryPhone";
import { agendarDrenoWhatsapp, configuracaoOutboxWhatsapp, enfileirarMensagemWhatsapp, obterJobWhatsapp, type JobOutboxWhatsapp } from "../whatsappOutbox";
import { PREMIO_CAS_LUA } from "./store";
import { VERCEL_PROJECT_CHEFEBOT_OFICIAL } from "../vercelProjeto";

type Aviso = { estado: "preparado" | "enfileirado" | "enviado" | "ambiguo" | "suprimido" | "falha"; criadoEm: number; jobId?: string; premioId?: string; revisao?: number; devidoEm?: number };
async function quarentena(premio: Premio, chave: string, aviso: Aviso) {
  const store = ranking3();
  // Retira da agenda, não do controle. Não remove uma nova janela criada
  // por cancelamento concorrente. Revisões ficam em índice DURÁVEL separado.
  const resultado = await redis.eval(`
    local p = redis.call('GET', KEYS[2])
    local revisao = redis.call('TYPE', KEYS[4]).ok
    local pendentes = redis.call('TYPE', KEYS[5]).ok
    local agenda = redis.call('TYPE', KEYS[3]).ok
    if (revisao ~= 'none' and revisao ~= 'set') or (pendentes ~= 'none' and pendentes ~= 'set') or (agenda ~= 'none' and agenda ~= 'zset') then return -1 end
    redis.call('SET', KEYS[1], ARGV[1])
    redis.call('SADD', KEYS[4], KEYS[1])
    redis.call('SREM', KEYS[5], KEYS[1])
    if p then
      p = cjson.decode(p)
      if p.revisao == tonumber(ARGV[2]) and p.proximoAvisoEm == tonumber(ARGV[3]) then redis.call('ZREM', KEYS[3], p.id) end
    end
    return 1
  `, [chave, store.chave(`premio:${premio.id}`), store.chave("avisos"), store.chave("avisos-revisao"), store.chave("avisos-reconciliar")], [JSON.stringify(aviso), premio.revisao, premio.proximoAvisoEm]);
  if (resultado !== 1) throw new Error("indice_revisao_indisponivel");
}
export function notificacoesPermitidas() {
  // Não existe caminho que habilite público geral nesta entrega.
  return ranking3Ativo() && process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_ID === VERCEL_PROJECT_CHEFEBOT_OFICIAL && process.env.RANKING3_WHATSAPP_CANARY_ENABLED === "true" && process.env.RANKING3_PROACTIVE_POLICY_APPROVED === "true";
}
async function horarioPermitido(agora: number) {
  const hora = Number(new Intl.DateTimeFormat("en", { timeZone: FUSO, hour: "2-digit", hourCycle: "h23" }).format(agora));
  // Sem configuração operacional comprovada, não inventa fechamento às 23h.
  const config = await redis.get<{ horaAbertura?: number; horaFechamento?: number }>("config:pizzaria");
  const abertura = config?.horaAbertura, fechamento = config?.horaFechamento;
  return typeof abertura === "number" && typeof fechamento === "number" && abertura >= 0 && abertura < 24 && fechamento > abertura && fechamento <= 24 && hora >= Math.max(18, abertura) && hora < fechamento;
}
async function destinatarioPermitido(premio: Premio, phone: string, agora: number) {
  const canario = normalizarTelefoneCanarioWhatsapp(process.env.WHATSAPP_CANARY_PHONE);
  if (!canario || normalizarTelefoneCanarioWhatsapp(phone) !== canario) return false;
  if (await redis.get<boolean>("bot_ativo") === false || !await horarioPermitido(agora)) return false;
  if (!await obterParticipacaoRanking(premio.clienteId) || await clienteTemOptOutConviteRankingWhatsapp(phone)) return false;
  const consentimento = await redis.get<{ aprovado?: boolean; evidencia?: string }>(ranking3().chave(`consentimento-proativo:${premio.clienteId}`));
  return consentimento?.aprovado === true && Boolean(consentimento.evidencia?.trim());
}

// Revalidação no WORKER: pausa, opt-out, expediente e pedido ativo podem mudar
// depois do enfileiramento. Uma tarefa antiga não pode ignorar esses estados.
export async function autorizarJobPremio(job: JobOutboxWhatsapp, agora = Date.now()) {
  if (!notificacoesPermitidas() || !job.rankingPrize) return false;
  const premio = await ranking3().premio(job.rankingPrize.id);
  return Boolean(premio && premio.revisao === job.rankingPrize.revisao && avisoDevido(premio, agora) && await destinatarioPermitido(premio, job.phone, agora));
}

// Índice separado da agenda de novos envios. Continua reconciliando após
// checkout/cancelamento, quando o direito já saiu do índice de avisos devidos.
export async function reconciliarAvisosPendentes(agora = Date.now()) {
  const contadores = { enviados: 0, ambiguos: 0, suprimidos: 0, falhas: 0 };
  if (!ranking3Ativo() || process.env.VERCEL_ENV !== "production" || process.env.VERCEL_PROJECT_ID !== VERCEL_PROJECT_CHEFEBOT_OFICIAL) return contadores;
  const store = ranking3();
  const pendentes = await redis.smembers<string[]>(store.chave("avisos-reconciliar"));
  for (const chave of pendentes) {
    const aviso = await redis.get<Aviso>(chave);
    if (!aviso?.premioId || aviso.revisao === undefined || aviso.devidoEm === undefined) throw new Error("aviso_pendente_inconsistente");
    const premio = await store.premio(aviso.premioId);
    if (!premio) throw new Error("direito_do_aviso_indisponivel");
    const esperado = { ...premio, revisao: aviso.revisao, proximoAvisoEm: aviso.devidoEm };
    if (["falha", "ambiguo"].includes(aviso.estado)) { await quarentena(esperado, chave, aviso); continue; }
    if (["enviado", "suprimido"].includes(aviso.estado)) { await redis.srem(store.chave("avisos-reconciliar"), chave); continue; }
    if (!aviso.jobId) {
      if (agora - aviso.criadoEm > 86_400_000) { await quarentena(esperado, chave, { ...aviso, estado: "ambiguo" }); contadores.ambiguos++; }
      continue;
    }
    const job = await obterJobWhatsapp(aviso.jobId);
    if (!job || job.state === "ambiguous") { await quarentena(esperado, chave, { ...aviso, estado: "ambiguo" }); contadores.ambiguos++; continue; }
    if (["pending", "leased"].includes(job.state)) continue;
    const mesmoDireito = premio.revisao === aviso.revisao && premio.proximoAvisoEm === aviso.devidoEm && premio.estado === "disponivel";
    if (job.state === "delivered") {
      if (mesmoDireito) {
        const novo = { ...premio, revisao: premio.revisao + 1, proximoAvisoEm: Math.max(job.updatedAt, aviso.devidoEm) + QUINZE_DIAS };
        // Se houver corrida com o checkout, a confirmação continua verdadeira,
        // mas a agenda do direito mais novo nunca é sobrescrita.
        const atualizado = await redis.eval(PREMIO_CAS_LUA, [store.chave(`premio:${premio.id}`), store.chave("avisos"), store.chave("vinculos")], [premio.revisao, JSON.stringify(novo)]);
        if (atualizado === -1) throw new Error("indice_premio_inconsistente");
      }
      await redis.multi().set(chave, { ...aviso, estado: "enviado" }).srem(store.chave("avisos-reconciliar"), chave).exec(); contadores.enviados++; continue;
    }
    const antesDoProvider = job.state !== "failed" && ["expired_before_provider_send", "global_pause_promotional", "ranking_prize_no_longer_eligible"].includes(job.result?.motivo ?? "");
    if (antesDoProvider) {
      if (mesmoDireito) {
        const novo = { ...premio, revisao: premio.revisao + 1, proximoAvisoEm: agora + 86_400_000 };
        const atualizado = await redis.eval(PREMIO_CAS_LUA, [store.chave(`premio:${premio.id}`), store.chave("avisos"), store.chave("vinculos")], [premio.revisao, JSON.stringify(novo)]);
        if (atualizado === -1) throw new Error("indice_premio_inconsistente");
        await redis.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0", [store.chave(`contato:${premio.clienteId}`)], [chave]);
      }
      await redis.multi().set(chave, { ...aviso, estado: "suprimido" }).srem(store.chave("avisos-reconciliar"), chave).exec(); contadores.suprimidos++; continue;
    }
    await quarentena(esperado, chave, { ...aviso, estado: "falha" }); contadores.falhas++;
  }
  return contadores;
}

export async function processarAvisosRanking3(agora = Date.now()) {
  const contadores = { enfileirados: 0, ...await reconciliarAvisosPendentes(agora), desativado: false };
  if (!notificacoesPermitidas() || !configuracaoOutboxWhatsapp().ready) return { ...contadores, desativado: true };
  const store = ranking3();
  const cursor = await redis.get<number>(store.chave("avisos-cursor")) ?? 0;
  const ids = await redis.zrange<string[]>(store.chave("avisos"), 0, agora, { byScore: true, offset: cursor, count: 50 });
  for (const id of ids) {
    const premio = await store.premio(id);
    if (!premio || !avisoDevido(premio, agora)) continue;
    const chave = store.chave(`aviso:${id}:${premio.proximoAvisoEm}`);
    let aviso = await redis.get<Aviso>(chave);
    if (aviso?.estado === "enviado") continue;
    if (aviso?.estado === "ambiguo" || aviso?.estado === "falha" || aviso?.estado === "suprimido") { await quarentena(premio, chave, aviso); contadores.suprimidos++; continue; }
    if (aviso?.jobId) continue; // Reconciliação independe desta agenda.
    if (aviso && agora - aviso.criadoEm > 86_400_000) {
      // Pode ter caído entre enqueue e gravação do jobId. Dedupe da outbox
      // expira em 7 dias; após esta margem nunca presumir que não houve envio.
      await quarentena(premio, chave, { ...aviso, estado: "ambiguo" }); contadores.ambiguos++; continue;
    }
    const perfil = await buscarClientePorId(premio.clienteId);
    if (!perfil || !await destinatarioPermitido(premio, perfil.telefone, agora)) { contadores.suprimidos++; continue; }
    // Um contato por pessoa/janela, mesmo com vários prêmios legítimos.
    const contato = store.chave(`contato:${premio.clienteId}`);
    await redis.set(contato, chave, { nx: true, px: QUINZE_DIAS });
    if (await redis.get<string>(contato) !== chave) { contadores.suprimidos++; continue; }
    if (!aviso) {
      await redis.multi().set(chave, { estado: "preparado", criadoEm: agora, premioId: id, revisao: premio.revisao, devidoEm: premio.proximoAvisoEm } satisfies Aviso, { nx: true }).sadd(store.chave("avisos-reconciliar"), chave).exec();
      aviso = await redis.get<Aviso>(chave);
    }
    if (!aviso || aviso.estado !== "preparado") continue;
    const job = await enfileirarMensagemWhatsapp({ phone: perfil.telefone, text: copyPremio(perfil.nome ?? "cliente", "https://chefedapizza.com.br/cliente/premios"), priority: "promocional", idempotencyKey: chave, expiresAt: agora + 120_000, rankingPrize: { id, revisao: premio.revisao } });
    await redis.set(chave, { ...aviso, estado: "enfileirado", jobId: job.jobId } satisfies Aviso);
    await agendarDrenoWhatsapp();
    contadores.enfileirados++;
  }
  await redis.set(store.chave("avisos-cursor"), ids.length < 50 ? 0 : cursor + ids.length);
  return contadores;
}
