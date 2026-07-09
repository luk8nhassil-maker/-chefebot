// Gerador de Pix "copia e cola" ESTATICO (BR Code / payload EMV do Bacen),
// 100% local, sem API bancaria. E o mesmo formato de um QR estatico impresso:
// carrega chave, valor, nome do recebedor, cidade e um txid de referencia.
// Nao ha confirmacao bancaria embutida — a confirmacao continua sendo pelo
// comprovante no WhatsApp. Se um app bancario recusar o codigo, o cliente
// ainda tem o fallback de copiar a chave Pix pura.

const ID_PAYLOAD_FORMAT = "00";
const ID_MERCHANT_ACCOUNT = "26";
const ID_MERCHANT_CATEGORY = "52";
const ID_CURRENCY = "53";
const ID_AMOUNT = "54";
const ID_COUNTRY = "58";
const ID_MERCHANT_NAME = "59";
const ID_MERCHANT_CITY = "60";
const ID_ADDITIONAL_DATA = "62";
const ID_CRC = "63";

const GUI_PIX = "br.gov.bcb.pix";

// CRC16/CCITT-FALSE (poly 0x1021, init 0xFFFF), exigido pelo padrao EMV.
export function crc16CcittFalse(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function campoEmv(id: string, valor: string): string {
  return `${id}${String(valor.length).padStart(2, "0")}${valor}`;
}

// Nome/cidade no BR Code: ASCII simples, sem acento, maiusculas, tamanho
// limitado pela especificacao (nome 25, cidade 15). Apps bancarios costumam
// rejeitar payloads fora disso.
function sanitizarTextoEmv(valor: string, maxLen: number): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

function sanitizarTxid(valor: string | undefined): string {
  const txid = String(valor || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 25);
  return txid || "***";
}

export type GerarPixCopiaEColaInput = {
  chave: string;
  valor: number;
  nome?: string;
  cidade?: string;
  txid?: string;
};

export function gerarPixCopiaEColaEstatico(input: GerarPixCopiaEColaInput): string | undefined {
  const chave = String(input.chave || "").trim();
  if (!chave || chave.length > 77) return undefined;
  if (typeof input.valor !== "number" || !Number.isFinite(input.valor) || input.valor <= 0) return undefined;

  const nome = sanitizarTextoEmv(input.nome || "", 25) || "RECEBEDOR PIX";
  const cidade = sanitizarTextoEmv(input.cidade || "", 15) || "BRASIL";
  const valor = input.valor.toFixed(2);
  if (valor.length > 13) return undefined;

  const contaPix = campoEmv("00", GUI_PIX) + campoEmv("01", chave);
  if (contaPix.length > 99) return undefined;

  const semCrc =
    campoEmv(ID_PAYLOAD_FORMAT, "01") +
    campoEmv(ID_MERCHANT_ACCOUNT, contaPix) +
    campoEmv(ID_MERCHANT_CATEGORY, "0000") +
    campoEmv(ID_CURRENCY, "986") +
    campoEmv(ID_AMOUNT, valor) +
    campoEmv(ID_COUNTRY, "BR") +
    campoEmv(ID_MERCHANT_NAME, nome) +
    campoEmv(ID_MERCHANT_CITY, cidade) +
    campoEmv(ID_ADDITIONAL_DATA, campoEmv("05", sanitizarTxid(input.txid))) +
    `${ID_CRC}04`;

  return semCrc + crc16CcittFalse(semCrc);
}
