export type PixCopiaEColaInput = {
  chavePix: string;
  valor: number;
  nomeRecebedor: string;
  cidade?: string | null;
  txid?: string | null;
};

function removerAcentos(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizarCampoEmv(value: string, max: number): string {
  return removerAcentos(value)
    .replace(/[^A-Za-z0-9 $%*+\-./:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .slice(0, max);
}

function normalizarTxid(value: string | null | undefined): string {
  const txid = removerAcentos(String(value || ""))
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 25);
  return txid || "***";
}

function campo(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

export function calcularCrc16Pix(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function validarCrcPixPayload(payload: string): boolean {
  const match = payload.match(/6304([0-9A-F]{4})$/);
  if (!match) return false;
  const semCrc = payload.slice(0, -4);
  return calcularCrc16Pix(semCrc) === match[1];
}

export function gerarPixCopiaEColaEstatico(input: PixCopiaEColaInput): string | undefined {
  const chavePix = String(input.chavePix || "").trim();
  const nomeRecebedor = normalizarCampoEmv(input.nomeRecebedor || "", 25);
  const cidade = normalizarCampoEmv(input.cidade || process.env.PIX_CIDADE || "BRASIL", 15);
  const valor = Number(input.valor);

  if (!chavePix || !nomeRecebedor || !cidade || !Number.isFinite(valor) || valor <= 0) return undefined;

  const merchantAccountInfo = campo("00", "br.gov.bcb.pix") + campo("01", chavePix);
  const additionalData = campo("05", normalizarTxid(input.txid));
  const semCrc = [
    campo("00", "01"),
    campo("01", "11"),
    campo("26", merchantAccountInfo),
    campo("52", "0000"),
    campo("53", "986"),
    campo("54", valor.toFixed(2)),
    campo("58", "BR"),
    campo("59", nomeRecebedor),
    campo("60", cidade),
    campo("62", additionalData),
    "6304",
  ].join("");

  return `${semCrc}${calcularCrc16Pix(semCrc)}`;
}
