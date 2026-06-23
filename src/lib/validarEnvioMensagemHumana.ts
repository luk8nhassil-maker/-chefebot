export interface EnvioMensagemHumanaInput {
  phone?: string;
  text?: string;
  senderName?: string;
}

export interface ValidacaoEnvio {
  ok: boolean;
  error?: string;
  phone?: string;
  text?: string;
  senderName: string;
}

export function validarEnvioMensagemHumana(
  input: EnvioMensagemHumanaInput,
): ValidacaoEnvio {
  const { phone, text, senderName = "Kellyne" } = input;

  if (!phone) return { ok: false, senderName, error: "phone obrigatório" };
  if (!text || !text.trim()) return { ok: false, senderName, error: "text obrigatório" };

  const digits = phone.replace(/\D/g, "");
  const phoneFinal = digits.startsWith("55") ? digits : "55" + digits;

  return { ok: true, phone: phoneFinal, text: text.trim(), senderName };
}
