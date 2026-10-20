import { createHash } from "node:crypto";
import { redis } from "./redis";

// Telemetria agregada dos messages.upsert recebidos, também no fluxo legado.
// Nunca armazena telefone, nome, conteúdo, JID ou ID bruto da mensagem.
const ROOT = "whatsapp:trafego:v1:";
const DAYS_TTL = 14 * 24 * 60 * 60;
const UNIQUE_TTL = 48 * 60 * 60;
const FUSO = "America/Sao_Paulo";

const CONTABILIZAR = `
-- Atomicidade para reentregas e callbacks concorrentes da Evolution.
if not redis.call("SET", KEYS[1], "1", "NX", "EX", tonumber(ARGV[1])) then return 0 end
redis.call("HINCRBY", KEYS[2], "h:" .. ARGV[2], 1)
redis.call("EXPIRE", KEYS[2], tonumber(ARGV[3]))
local minuto = redis.call("INCR", KEYS[3])
if minuto == 1 then redis.call("EXPIRE", KEYS[3], 180) end
if minuto > tonumber(redis.call("HGET", KEYS[2], "peakMinute") or "0") then
  redis.call("HSET", KEYS[2], "peakMinute", minuto, "peakMinuteAt", ARGV[4])
end
redis.call("SET", KEYS[4], ARGV[5], "NX")
return 1
`;

export function partesHorarioLocal(at: number) {
  const data = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(at));
  const p = Object.fromEntries(data.map(item => [item.type, item.value]));
  return {
    dia: `${p.year}-${p.month}-${p.day}`,
    hora: p.hour,
    minuto: `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`,
  };
}

export function identificadorAnonimoMensagem(telefone: string, messageId: string): string {
  return createHash("sha256").update(telefone).update(":").update(messageId).digest("hex");
}

export async function registrarTrafegoWhatsapp(telefone: string, messageId: string, at = Date.now()): Promise<void> {
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return;
  if (!telefone || !messageId || messageId.length > 300 || at <= 0) return;
  const { dia, hora, minuto } = partesHorarioLocal(at);
  const minutoUnix = Math.floor(at / 60_000);
  const hash = identificadorAnonimoMensagem(telefone, messageId);
  try {
    await redis.eval(CONTABILIZAR, [
      ROOT + "u:" + hash,
      ROOT + "dia:" + dia,
      ROOT + "minuto:" + minutoUnix,
      ROOT + "inicio",
    ], [String(UNIQUE_TTL), hora, String(DAYS_TTL), minuto, String(at)]);
  } catch {
    // Telemetria passiva. Nunca perder mensagem de cliente por falha da medição.
  }
}

export type DiaTrafego = {
  data: string;
  total: number;
  picoMinuto: number;
  picoMinutoEm: string | null;
  horas: number[];
};
export type ResumoTrafego = {
  desde: number | null;
  fuso: "America/Sao_Paulo";
  dias: DiaTrafego[];
  total7d: number;
  picoHora: { data: string; hora: number; mensagens: number } | null;
  picoMinuto: { quando: string; mensagens: number } | null;
  coberturaDias: number;
  suficienteParaRepresentatividade: boolean;
  observacao: string;
};

export function resumirTrafegoWhatsapp(raw: Array<{ data: string; hash: Record<string, unknown> | null }>, desde: number | null, now: number): ResumoTrafego {
  let total7d = 0;
  const dias: DiaTrafego[] = raw.map(({ data, hash }) => {
    const h = hash ?? {};
    const horas = Array.from({ length: 24 }, (_, hora) => {
      const v = Math.max(0, Number(h["h:" + String(hora).padStart(2, "0")]) || 0);
      return v;
    });
    const total = horas.reduce((a, b) => a + b, 0);
    const valorPico = Math.max(0, Number(h.peakMinute) || 0);
    const when = typeof h.peakMinuteAt === "string" ? h.peakMinuteAt : null;
    total7d += total;
    return { data, total, picoMinuto: valorPico, picoMinutoEm: when, horas };
  });
  const picoHora = dias
    .flatMap(dia => dia.horas.map((mensagens, hora) => ({ data: dia.data, hora, mensagens })))
    .reduce<ResumoTrafego["picoHora"]>((anterior, atual) =>
      !anterior || atual.mensagens > anterior.mensagens ? atual : anterior, null);
  const picoMinuto = dias
    .filter(d => d.picoMinutoEm !== null)
    .reduce<ResumoTrafego["picoMinuto"]>((anterior, atual) =>
      !anterior || atual.picoMinuto > anterior.mensagens
        ? { quando: atual.picoMinutoEm!, mensagens: atual.picoMinuto }
        : anterior, null);
  const coberturaDias = desde === null || !Number.isFinite(desde) || desde > now
    ? 0 : Math.max(0, Math.min(7, Math.floor((now - desde) / 86_400_000)));
  // Sete dias de coleta, por si só, não prova o pico máximo futuro.
  return {
    desde, fuso: FUSO, dias, total7d,
    picoHora: picoHora && picoHora.mensagens > 0 ? picoHora : null,
    picoMinuto: picoMinuto && picoMinuto.mensagens > 0 ? picoMinuto : null,
    coberturaDias,
    suficienteParaRepresentatividade: coberturaDias >= 7 && total7d > 0,
    observacao: "Mede mensagens recebidas de clientes identificáveis, deduplicadas por evento, desde a ativação desta coleta. Não é garantia de capacidade nem confirmação de entrega.",
  };
}

export async function lerPicosTrafegoWhatsapp(now = Date.now()): Promise<ResumoTrafego> {
  // Só sete leituras de hashes diárias + marcador de início; sem SCAN nem
  // percorrer mensagens de clientes, e sem escrever ao abrir o painel DEV.
  const dias = Array.from({ length: 7 }, (_, i) => partesHorarioLocal(now - i * 86_400_000).dia).reverse();
  const [inicio, ...hist] = await Promise.all([
    redis.get<number>(ROOT + "inicio"),
    ...dias.map(dia => redis.hgetall<Record<string, unknown>>(ROOT + "dia:" + dia)),
  ]);
  return resumirTrafegoWhatsapp(
    dias.map((data, i) => ({ data, hash: hist[i] })),
    inicio ? Number(inicio) : null,
    now,
  );
}
