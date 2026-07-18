import { redis } from "./redis";

export type Cliente = {
  clienteId: string;
  telefone: string;
  nome?: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
};

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
  return `cliente:${telefoneSanitizado}`;
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
