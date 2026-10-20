import { concederPremios, fechar, janelaAtual, janelaTemporada, ordenar, scoreCompetitivo, transicionarPremio, type Cohort, type Janela, type Premio, type Resultado } from "./domain";
import type { MovimentoPontos, EstadoPontosCliente } from "../fidelidade";
import type { MovimentoBonusTemporada } from "../rankingBonusTemporada";
import { createHash, randomUUID } from "node:crypto";

// Interface pequena: o MESMO código/Lua é exercitado com Redis descartável.
export interface BancoRanking3 {
  get<T>(key: string): Promise<T | null>;
  smembers<T = string>(key: string): Promise<T[]>;
  eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown>;
}
export type ConfigRanking3 = { versao: 3; ancora: string; auditoriaHistoricaRef: string };
const VAZIO: Cohort = { top10: [], nivel3: [], pendentes: [], meta: null };
export const prefixo = (tenant: string) => `ranking3:${tenant}`;
export const chaveFonte = (tenant: string) => `${prefixo(tenant)}:fonte`;
export const chaveClientes = (tenant: string) => `${prefixo(tenant)}:clientes`;

// Resultado, direitos, carteira por titular, índice de avisos e checkpoint são
// indivisíveis. CAS de fonte impede fechar sobre leitura mista de dois ledgers.
export const FECHAR_LUA = `
if redis.call('GET', KEYS[#KEYS]) ~= ARGV[6] then return 'lease_perdido' end
if redis.call('GET', KEYS[1]) then return 'existente' end
if (redis.call('GET', KEYS[2]) or '0') ~= ARGV[1] then return 'fonte_alterada' end
if (redis.call('GET', KEYS[3]) or '-1') ~= ARGV[2] then return 'checkpoint_alterado' end
local premios = cjson.decode(ARGV[4])
local function tipo(key) return redis.call('TYPE', key).ok end
local avisos = tipo(KEYS[4])
if avisos ~= 'none' and avisos ~= 'zset' then return 'indice_inconsistente' end
local indicePremios = tipo(KEYS[#KEYS - 1])
if indicePremios ~= 'none' and indicePremios ~= 'set' then return 'indice_premios_inconsistente' end
for i, premio in ipairs(premios) do
  if redis.call('EXISTS', KEYS[5 + (i-1)*2]) == 1 then return 'direito_inconsistente' end
  local carteira = tipo(KEYS[6 + (i-1)*2])
  if carteira ~= 'none' and carteira ~= 'set' then return 'carteira_inconsistente' end
end
redis.call('SET', KEYS[1], ARGV[3])
for i, premio in ipairs(premios) do
  redis.call('SET', KEYS[5 + (i-1)*2], cjson.encode(premio))
  redis.call('SADD', KEYS[6 + (i-1)*2], premio.id)
  redis.call('ZADD', KEYS[4], premio.proximoAvisoEm, premio.id)
  redis.call('SADD', KEYS[#KEYS - 1], premio.id)
end
redis.call('SET', KEYS[3], ARGV[5])
return 'gravado'
`;

export const PREMIO_CAS_LUA = `
local atual = redis.call('GET', KEYS[1])
if not atual then return 0 end
local p = cjson.decode(atual)
if p.revisao ~= tonumber(ARGV[1]) then return 0 end
local novo = cjson.decode(ARGV[2])
local avisos = redis.call('TYPE', KEYS[2]).ok
local vinculos = redis.call('TYPE', KEYS[3]).ok
if (avisos ~= 'none' and avisos ~= 'zset') or (vinculos ~= 'none' and vinculos ~= 'set') then return -1 end
redis.call('SET', KEYS[1], ARGV[2])
if novo.estado == 'disponivel' then
  redis.call('ZADD', KEYS[2], novo.proximoAvisoEm, novo.id)
else
  redis.call('ZREM', KEYS[2], novo.id)
end
if novo.estado == 'disponivel' or novo.estado == 'entregue' then
  redis.call('SREM', KEYS[3], novo.id)
else
  redis.call('SADD', KEYS[3], novo.id)
end
return 1
`;

export class Ranking3Store {
  constructor(readonly banco: BancoRanking3, readonly tenant = "default") {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tenant)) throw new Error("tenant_invalido");
  }
  chave(sufixo: string) { return `${prefixo(this.tenant)}:${sufixo}`; }
  async config(): Promise<ConfigRanking3 | null> {
    const config = await this.banco.get<ConfigRanking3>(this.chave("config"));
    if (!config) return null;
    if (config.versao !== 3 || !config.auditoriaHistoricaRef?.trim()) throw new Error("migracao_sem_auditoria");
    janelaTemporada(config.ancora, 0);
    return config;
  }
  async atual(agora = Date.now()): Promise<Janela | null> {
    const config = await this.config();
    return config ? janelaAtual(config.ancora, agora) : null;
  }
  async resultado(indice: number): Promise<Resultado | null> {
    return this.banco.get<Resultado>(this.chave(`resultado:${indice}`));
  }
  async cohort(indice: number): Promise<Cohort> {
    if (indice === 0) return { ...VAZIO, top10: [], nivel3: [], pendentes: [] };
    const anterior = await this.resultado(indice - 1);
    if (!anterior) throw new Error("fechamento_anterior_pendente");
    return anterior.proximo;
  }
  async classificacao(janela: Janela, elegivel: (id: string, corte: number) => Promise<boolean>) {
    const clientes = await this.banco.smembers<string>(chaveClientes(this.tenant));
    const entradas = [];
    // Lotes pequenos: não abre N conexões nem consulta perfis para exibir PII.
    for (let i = 0; i < clientes.length; i += 20) {
      const lote = await Promise.all(clientes.slice(i, i + 20).map(async (clienteId) => {
        const [estado, legado, bonus, participa] = await Promise.all([
          this.banco.get<EstadoPontosCliente>(`fidelidade:pontos:estado:${clienteId}`),
          this.banco.get<MovimentoPontos[]>(`fidelidade:pontos:extrato:${clienteId}`),
          this.banco.get<{ movimentos: MovimentoBonusTemporada[] }>(`ranking:bonus:temporada:${this.tenant}:${janela.id}:${clienteId}`),
          elegivel(clienteId, Date.parse(janela.fim)),
        ]);
        if (!participa) return null;
        const vistos = new Set<string>();
        const movimentos = [...(estado?.extrato ?? []), ...(legado ?? [])].filter((m) => {
          const id = m.eventoId || m.movimentoId;
          if (vistos.has(id)) return false;
          vistos.add(id); return true;
        });
        const score = scoreCompetitivo(movimentos, bonus?.movimentos ?? [], janela);
        // Mesma participação da main; sem evento válido não fabrica concorrente.
        return score.atingidoEm === null ? null : { clienteId, ...score };
      }));
      entradas.push(...lote.filter((e) => e !== null));
    }
    return ordenar(entradas);
  }
  async recuperar(agora: number, elegivel: (id: string, corte: number) => Promise<boolean>, limite = 3) {
    const config = await this.config();
    if (!config) return { fechados: 0, pendentes: false };
    let checkpoint = Number(await this.banco.get<number>(this.chave("checkpoint")) ?? -1);
    let fechados = 0;
    for (; fechados < limite; fechados++) {
      const janela = janelaTemporada(config.ancora, checkpoint + 1);
      if (Date.parse(janela.fim) > agora) break;
      const barreira = JSON.stringify({ token: randomUUID(), corte: Date.parse(janela.fim) });
      const chaveBarreira = this.chave("fechando");
      const adquirido = await this.banco.eval("return redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', 60000)", [chaveBarreira], [barreira]);
      if (!adquirido) return { fechados, pendentes: true };
      try {
        const fonte = String(await this.banco.get<number>(chaveFonte(this.tenant)) ?? 0);
        const entradas = await this.classificacao(janela, elegivel);
        const resultado = fechar(janela, entradas, await this.cohort(janela.indice));
        const snapshot = { ...resultado, auditoria: { versao: 3, fonteVersao: fonte, referencia: config.auditoriaHistoricaRef, sha256: createHash("sha256").update(JSON.stringify(resultado)).digest("hex") } };
        const premios = concederPremios(resultado);
        const keys = [this.chave(`resultado:${janela.indice}`), chaveFonte(this.tenant), this.chave("checkpoint"), this.chave("avisos")];
        for (const premio of premios) keys.push(this.chave(`premio:${premio.id}`), this.chave(`carteira:${premio.clienteId}`));
        keys.push(this.chave("premios"));
        keys.push(chaveBarreira);
        const gravado = String(await this.banco.eval(FECHAR_LUA, keys, [fonte, String(checkpoint), JSON.stringify(snapshot), JSON.stringify(premios), janela.indice, barreira]));
        if (!["gravado", "existente"].includes(gravado)) throw new Error(`fechamento_${gravado}`);
        checkpoint = janela.indice;
      } finally {
        await this.banco.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0", [chaveBarreira], [barreira]);
      }
    }
    return { fechados, pendentes: Date.parse(janelaTemporada(config.ancora, checkpoint + 1).fim) <= agora };
  }
  async premio(id: string) {
    if (!/^r3-\d{4}-\d{2}-\d{2}-\d+-liga-[12]$/.test(id)) throw new Error("premio_invalido");
    return this.banco.get<Premio>(this.chave(`premio:${id}`));
  }
  async carteira(clienteId: string): Promise<Premio[]> {
    const ids = await this.banco.smembers<string>(this.chave(`carteira:${clienteId}`));
    const premios = await Promise.all(ids.map((id) => this.premio(id)));
    return premios.filter((p): p is Premio => p !== null && p.clienteId === clienteId).sort((a, b) => b.concedidoEm.localeCompare(a.concedidoEm));
  }
  async transicionar(id: string, clienteId: string, pedidoId: string, evento: Parameters<typeof transicionarPremio>[2], agora = Date.now(), tentativaId?: string): Promise<Premio> {
    for (let i = 0; i < 5; i++) {
      const atual = await this.premio(id);
      if (!atual || atual.clienteId !== clienteId) throw new Error("premio_indisponivel");
      const novo = transicionarPremio(atual, pedidoId, evento, agora, tentativaId);
      if (novo === atual) return atual;
      if (await this.banco.eval(PREMIO_CAS_LUA, [this.chave(`premio:${id}`), this.chave("avisos"), this.chave("vinculos")], [atual.revisao, JSON.stringify(novo)]) === 1) return novo;
    }
    throw new Error("premio_concorrencia_tente_novamente");
  }
}
