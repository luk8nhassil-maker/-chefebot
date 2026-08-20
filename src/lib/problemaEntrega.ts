export const MOTIVOS_PROBLEMA_ENTREGA = [
  "endereco_nao_encontrado",
  "cliente_ausente",
  "cliente_nao_responde",
  "acesso_bloqueado",
  "problema_motoboy",
  "outro",
] as const;

export const MOTIVO_RETIRADA_ATRASADA = "retirada_atrasada" as const;
export type MotivoProblemaEntrega = (typeof MOTIVOS_PROBLEMA_ENTREGA)[number] | typeof MOTIVO_RETIRADA_ATRASADA;
export type StatusContatoEntrega = "enviando" | "enviado" | "falhou";

export type RegistroProblemaEntrega = {
  motivo: MotivoProblemaEntrega;
  registradoEm: string;
  registradoPor: string;
  contatoStatus: StatusContatoEntrega;
  tentativasContato: number;
  contatoId?: string;
  contatoEm?: string;
  erroContato?: string;
};

export const ROTULOS_PROBLEMA_ENTREGA: Record<MotivoProblemaEntrega, string> = {
  endereco_nao_encontrado: "Não encontrou o endereço",
  cliente_ausente: "Cliente não está no local",
  cliente_nao_responde: "Cliente não responde",
  acesso_bloqueado: "Problema com portaria ou acesso",
  problema_motoboy: "Motoboy teve um problema",
  outro: "Outro problema",
  retirada_atrasada: "Cliente ainda não retirou",
};

export function motivoProblemaEntregaValido(valor: unknown): valor is MotivoProblemaEntrega {
  return typeof valor === "string" && ((MOTIVOS_PROBLEMA_ENTREGA as readonly string[]).includes(valor) || valor === MOTIVO_RETIRADA_ATRASADA);
}

function primeiroNome(cliente: string): string {
  return String(cliente || "Cliente").trim().split(/\s+/)[0] || "Cliente";
}

export function mensagemProblemaEntrega(motivo: MotivoProblemaEntrega, cliente: string): string {
  const nome = primeiroNome(cliente);
  switch (motivo) {
    case "endereco_nao_encontrado": return `Oi, ${nome}. Nosso motoboy está próximo, mas não conseguiu localizar seu endereço. Pode responder com um ponto de referência ou enviar sua localização, por favor?`;
    case "cliente_ausente": return `Oi, ${nome}. Nosso motoboy chegou para entregar seu pedido, mas não encontrou ninguém para receber. Tem alguém no local ou você consegue orientar a gente?`;
    case "cliente_nao_responde": return `Oi, ${nome}. Nosso motoboy está tentando concluir sua entrega e não conseguiu falar com você. Responde aqui quando puder, por favor.`;
    case "acesso_bloqueado": return `Oi, ${nome}. Nosso motoboy chegou, mas não conseguiu acessar o local ou a portaria. Pode orientar como ele deve entrar?`;
    case "problema_motoboy": return `Oi, ${nome}. Tivemos um imprevisto durante sua entrega e ela pode levar alguns minutos a mais. Já estamos resolvendo e seguimos acompanhando por aqui.`;
    case "retirada_atrasada": return `Oi, ${nome}. Seu pedido já está pronto para retirada e está te esperando aqui. Se precisar de mais alguns minutos, responde por aqui pra gente acompanhar direitinho.`;
    case "outro": return `Oi, ${nome}. Tivemos um imprevisto na sua entrega e estamos resolvendo. Fica atento por aqui caso a equipe precise confirmar alguma informação com você.`;
  }
}
