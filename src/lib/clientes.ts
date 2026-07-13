import { redis } from "./redis";

export type Cliente = {
  clienteId: string;
  telefone: string;
  nome?: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
  /** Participação individual no programa de pontos — opt-in explícito, separado da ativação global (ConfigFidelidadePontos.ativo). Ausente/false = cliente ainda não ativou. */
  pontosAtivos?: boolean;
  pontosAtivadoEm?: string;
};

/**
 * Telefone brasileiro canônico do ChefeBot: somente DDD + número, sem DDI 55.
 * Aceita números nacionais de 10/11 dígitos ou legados com 55 + 10/11 dígitos.
 * Retorna string vazia quando não há telefone brasileiro plausível.
 */
export function normalizarTelefoneClienteBr(telefone: string | null | undefined): string {
  const digitos = sanitizeTelefoneCliente(telefone ?? "");
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) {
    return digitos.slice(2);
  }
  if (digitos.length === 10 || digitos.length === 11) return digitos;
  return "";
}

export function sanitizeTelefoneCliente(telefone: string): string {
  return (telefone || "").replace(/\D/g, "");
}

export function variantesTelefoneClienteBr(telefone: string | null | undefined): string[] {
  const bruto = sanitizeTelefoneCliente(telefone ?? "");
  const canonico = normalizarTelefoneClienteBr(bruto);
  const variantes = new Set<string>();
  if (canonico) {
    variantes.add(canonico);
    variantes.add(`55${canonico}`);
  }
  if (bruto) variantes.add(bruto);
  return [...variantes].filter(Boolean);
}

function chaveCliente(telefone: string): string {
  return `cliente:${sanitizeTelefoneCliente(telefone)}`;
}

export function clienteIdDoTelefone(telefone: string): string {
  const canonico = normalizarTelefoneClienteBr(telefone);
  return `cli_${canonico || sanitizeTelefoneCliente(telefone)}`;
}

function menorDataValida(a?: string, b?: string): string | undefined {
  const datas = [a, b]
    .filter((v): v is string => !!v)
    .filter((v) => Number.isFinite(new Date(v).getTime()))
    .sort((x, y) => new Date(x).getTime() - new Date(y).getTime());
  return datas[0];
}

function maiorDataValida(a?: string, b?: string): string | undefined {
  const datas = [a, b]
    .filter((v): v is string => !!v)
    .filter((v) => Number.isFinite(new Date(v).getTime()))
    .sort((x, y) => new Date(y).getTime() - new Date(x).getTime());
  return datas[0];
}

function consolidarClientesMesmoTelefone(telefone: string, registros: Cliente[]): Cliente | null {
  const canonico = normalizarTelefoneClienteBr(telefone);
  if (!canonico || registros.length === 0) return null;

  const base = registros.find((c) => normalizarTelefoneClienteBr(c.telefone) === canonico) ?? registros[0];
  const pontosAtivos = registros.some((c) => c.pontosAtivos === true);
  const pontosAtivadoEm = registros
    .filter((c) => c.pontosAtivos === true)
    .reduce<string | undefined>((menor, c) => menorDataValida(menor, c.pontosAtivadoEm), undefined);

  return {
    ...base,
    clienteId: clienteIdDoTelefone(canonico),
    telefone: canonico,
    nome: registros.find((c) => typeof c.nome === "string" && c.nome.trim())?.nome ?? base.nome,
    createdAt: registros.reduce<string | undefined>((menor, c) => menorDataValida(menor, c.createdAt), undefined) ?? base.createdAt,
    updatedAt: registros.reduce<string | undefined>((maior, c) => maiorDataValida(maior, c.updatedAt), undefined) ?? base.updatedAt,
    lastLoginAt: registros.reduce<string | undefined>((maior, c) => maiorDataValida(maior, c.lastLoginAt), undefined) ?? base.lastLoginAt,
    pontosAtivos,
    ...(pontosAtivadoEm ? { pontosAtivadoEm } : {}),
  };
}

export async function buscarClientePorTelefone(telefone: string): Promise<Cliente | null> {
  const canonico = normalizarTelefoneClienteBr(telefone);
  if (!canonico) return null;
  const chaves = [...new Set(variantesTelefoneClienteBr(canonico).map(chaveCliente))];
  const registros = (await Promise.all(chaves.map((chave) => redis.get<Cliente>(chave)))).filter((c): c is Cliente => !!c);
  if (registros.length === 0) return null;

  const consolidado = consolidarClientesMesmoTelefone(canonico, registros);
  if (!consolidado) return null;
  await redis.set(chaveCliente(canonico), consolidado);
  return consolidado;
}

export async function buscarClientePorId(clienteId: string): Promise<Cliente | null> {
  const telefone = clienteId.startsWith("cli_") ? clienteId.slice(4) : clienteId;
  return buscarClientePorTelefone(telefone);
}

export async function obterOuCriarCliente(telefone: string, nome?: string): Promise<Cliente> {
  const tel = normalizarTelefoneClienteBr(telefone);
  if (!tel) throw new Error("Telefone brasileiro invalido");
  const agora = new Date().toISOString();
  const existente = await buscarClientePorTelefone(tel);

  if (existente) {
    const atualizado: Cliente = {
      ...existente,
      nome: nome || existente.nome,
      lastLoginAt: agora,
      updatedAt: agora,
    };
    await redis.set(chaveCliente(tel), atualizado);
    return atualizado;
  }

  const novo: Cliente = {
    clienteId: clienteIdDoTelefone(tel),
    telefone: tel,
    ...(nome ? { nome } : {}),
    createdAt: agora,
    updatedAt: agora,
    lastLoginAt: agora,
  };
  await redis.set(chaveCliente(tel), novo);
  return novo;
}

/**
 * Ativa a participação individual do cliente no programa de pontos.
 * Idempotente: se já estava ativo, retorna o registro como está, sem
 * sobrescrever `pontosAtivadoEm` nem tocar em saldo/histórico (que vivem em
 * chaves de fidelidade separadas, nunca lidas/escritas aqui) — ativar duas
 * vezes nunca duplica dados nem gera pontos retroativos.
 */
export async function ativarParticipacaoPontos(clienteId: string): Promise<Cliente | null> {
  const cliente = await buscarClientePorId(clienteId);
  if (!cliente) return null;
  if (cliente.pontosAtivos && cliente.pontosAtivadoEm) return cliente;

  const agora = new Date().toISOString();
  const atualizado: Cliente = {
    ...cliente,
    pontosAtivos: true,
    pontosAtivadoEm: cliente.pontosAtivadoEm ?? agora,
    updatedAt: agora,
  };
  await redis.set(chaveCliente(cliente.telefone), atualizado);
  return buscarClientePorId(atualizado.clienteId);
}
