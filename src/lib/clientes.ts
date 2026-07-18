import { redis } from "./redis";

export type Cliente = {
  clienteId: string;
  telefone: string;
  nome?: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
  /**
   * Momento em que o cliente concluiu a PRIMEIRA ativação da fidelidade no
   * app (tela "Como podemos chamar você?"). É o estado explícito que decide
   * a próxima etapa após o OTP — um nome vindo de pedido/importação/legado
   * NUNCA pula a primeira ativação (campo ausente = ainda não ativou).
   */
  fidelidadeAtivadaEm?: string;
};

export type ProximaEtapaCliente = "name" | "points";

// Fonte única da decisão de próxima tela após um OTP válido.
export function clienteProximaEtapa(cliente: Pick<Cliente, "fidelidadeAtivadaEm"> | null | undefined): ProximaEtapaCliente {
  return cliente?.fidelidadeAtivadaEm ? "points" : "name";
}

export function sanitizeTelefoneCliente(telefone: string): string {
  return (telefone || "").replace(/\D/g, "");
}

// Nome exibível do cliente: colapsa espaços, remove caracteres de controle e
// limita o tamanho. Retorna "" quando não sobra nada utilizável — quem chama
// decide se isso é erro (cadastro) ou só ausência (nome opcional).
export function normalizarNomeCliente(nome: unknown): string {
  if (typeof nome !== "string") return "";
  const limpo = nome.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return limpo.slice(0, 60).trim();
}

function chaveCliente(telefoneSanitizado: string): string {
  return `perfil-cliente:${telefoneSanitizado}`;
}

export function clienteIdDoTelefone(telefone: string): string {
  return `cli_${sanitizeTelefoneCliente(telefone)}`;
}

export async function buscarClientePorTelefone(telefone: string): Promise<Cliente | null> {
  const tel = sanitizeTelefoneCliente(telefone);
  if (!tel) return null;
  return (await redis.get<Cliente>(chaveCliente(tel))) ?? null;
}

export async function buscarClientePorId(clienteId: string): Promise<Cliente | null> {
  const telefone = clienteId.startsWith("cli_") ? clienteId.slice(4) : clienteId;
  return buscarClientePorTelefone(telefone);
}

export async function obterOuCriarCliente(telefone: string, nome?: string): Promise<Cliente> {
  const tel = sanitizeTelefoneCliente(telefone);
  const agora = new Date().toISOString();
  const existente = await buscarClientePorTelefone(tel);

  if (existente) {
    const atualizado: Cliente = {
      ...existente,
      clienteId: clienteIdDoTelefone(tel),
      telefone: tel,
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
 * Conclui a primeira ativação da fidelidade: grava o nome E o marco
 * fidelidadeAtivadaEm na mesma escrita. Idempotente — reativar nunca
 * retrocede o marco original.
 */
export async function ativarFidelidadeCliente(telefone: string, nome: string): Promise<Cliente> {
  const tel = sanitizeTelefoneCliente(telefone);
  const agora = new Date().toISOString();
  const existente = await buscarClientePorTelefone(tel);
  const base = existente ?? {
    clienteId: clienteIdDoTelefone(tel),
    telefone: tel,
    createdAt: agora,
  };
  const atualizado: Cliente = {
    ...base,
    clienteId: base.clienteId,
    telefone: tel,
    nome,
    createdAt: base.createdAt,
    updatedAt: agora,
    lastLoginAt: agora,
    fidelidadeAtivadaEm: existente?.fidelidadeAtivadaEm ?? agora,
  };
  await redis.set(chaveCliente(tel), atualizado);
  return atualizado;
}
