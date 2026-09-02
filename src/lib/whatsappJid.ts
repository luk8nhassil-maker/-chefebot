const SUFIXO_JID_INDIVIDUAL = "@s.whatsapp.net";
const SUFIXO_LID = "@lid";

function obterCampo(valor: unknown, chave: string): unknown {
  return typeof valor === "object" && valor !== null
    ? (valor as Record<string, unknown>)[chave]
    : undefined;
}

function extrairTelefoneDoJid(valor: unknown): string | undefined {
  if (typeof valor !== "string" || !valor.endsWith(SUFIXO_JID_INDIVIDUAL)) {
    return undefined;
  }

  const numero = valor.slice(0, -SUFIXO_JID_INDIVIDUAL.length);
  return numero || undefined;
}

/**
 * Resolve o telefone de uma conversa individual da chave de mensagem da
 * Evolution/Baileys. Em eventos novos, `remoteJid` pode ser um Linked ID
 * (`@lid`); nesses casos o telefone real vem em `remoteJidAlt`.
 *
 * Nunca usa o LID como número e nunca transforma grupo/broadcast em conversa
 * individual. Se a Evolution não fornecer o mapeamento, falha fechado.
 */
export function extrairTelefoneIndividualDaChave(chave: unknown): string | undefined {
  const remoteJid = obterCampo(chave, "remoteJid");
  const telefonePrimario = extrairTelefoneDoJid(remoteJid);
  if (telefonePrimario) return telefonePrimario;

  if (typeof remoteJid === "string" && remoteJid.endsWith(SUFIXO_LID)) {
    return extrairTelefoneDoJid(obterCampo(chave, "remoteJidAlt"));
  }

  return undefined;
}
