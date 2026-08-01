type TelefoneBrasil = {
  ddd: string;
  local: string;
  nacional: string;
};

export function normalizarTelefoneBrasil(input: string | null | undefined): TelefoneBrasil | null {
  const digits = String(input || "").replace(/\D/g, "");
  if (!digits) return null;

  const nacional = digits.startsWith("55") && (digits.length === 12 || digits.length === 13)
    ? digits.slice(2)
    : digits;

  if (nacional.length !== 10 && nacional.length !== 11) return null;

  const ddd = nacional.slice(0, 2);
  const local = nacional.slice(2);
  if (ddd.length !== 2 || (local.length !== 8 && local.length !== 9)) return null;

  return { ddd, local, nacional };
}

/**
 * Máscara de exibição enquanto o atendente digita — só formatação visual,
 * nunca decide validade. Sem DDD fixo: o padrão (DD) DDDD-DDDD / (DD)
 * DDDDD-DDDD segue o comprimento real dos dígitos digitados, igual ao
 * cardápio público (ver formatTel em src/app/cardapio/page.tsx).
 */
export function formatarTelefoneExibicao(input: string | null | undefined): string {
  const d = String(input || "").replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function telefonesCorrespondem(a: string | null | undefined, b: string | null | undefined): boolean {
  const primeiro = normalizarTelefoneBrasil(a);
  const segundo = normalizarTelefoneBrasil(b);
  if (!primeiro || !segundo) return false;
  if (primeiro.nacional === segundo.nacional) return true;
  if (primeiro.ddd !== segundo.ddd) return false;

  const [maior, menor] = primeiro.local.length > segundo.local.length
    ? [primeiro.local, segundo.local]
    : [segundo.local, primeiro.local];

  return maior.length === 9
    && menor.length === 8
    && maior.startsWith("9")
    && maior.slice(1) === menor;
}
