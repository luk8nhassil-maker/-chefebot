export const FUSO_OPERACIONAL_PIX = "America/Sao_Paulo";
export const TOLERANCIA_HORARIO_COMPROVANTE_PIX_MINUTOS = 8;

const OFFSET_SAO_PAULO_MINUTOS = -180;

export type PixComprovanteHorarioExtraido = {
  data?: string;
  hora?: string;
  dataHora?: string;
  bruto?: string;
};

export type ResultadoHorarioComprovantePix = {
  ok: boolean;
  bloquear: boolean;
  motivo: "ok" | "sem_horario" | "data_diferente" | "pagamento_anterior" | "referencia_invalida";
  pedidoEm?: string;
  pagamentoEm?: string;
  diferencaMinutos?: number;
  horario?: PixComprovanteHorarioExtraido;
};

export type AvaliarHorarioComprovantePixInput = {
  horarioPedido?: string | null;
  dataPedido?: string | null;
  dataHoraComprovante?: string | null;
  dataComprovante?: string | null;
  horaComprovante?: string | null;
  textoComprovante?: string | null;
  fuso?: string;
  toleranciaMinutos?: number;
};

function doisDigitos(valor: number): string {
  return String(valor).padStart(2, "0");
}

function anoCompleto(valor: string): number {
  const ano = Number(valor);
  if (valor.length === 2) return 2000 + ano;
  return ano;
}

function formatarData(ano: number, mes: number, dia: number): string {
  return `${ano}-${doisDigitos(mes)}-${doisDigitos(dia)}`;
}

function formatarHora(hora: number, minuto: number): string {
  return `${doisDigitos(hora)}:${doisDigitos(minuto)}`;
}

function dataValida(ano: number, mes: number, dia: number): boolean {
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
}

function horaValida(hora: number, minuto: number): boolean {
  return Number.isInteger(hora) && Number.isInteger(minuto) && hora >= 0 && hora <= 23 && minuto >= 0 && minuto <= 59;
}

function montarExtraido(
  ano: number,
  mes: number,
  dia: number,
  hora?: number,
  minuto?: number,
  bruto?: string,
): PixComprovanteHorarioExtraido | undefined {
  if (!dataValida(ano, mes, dia)) return undefined;
  const data = formatarData(ano, mes, dia);

  if (hora === undefined || minuto === undefined) return { data, bruto };
  if (!horaValida(hora, minuto)) return undefined;

  const horaFormatada = formatarHora(hora, minuto);
  return {
    data,
    hora: horaFormatada,
    dataHora: `${data}T${horaFormatada}:00`,
    bruto,
  };
}

function normalizarTexto(valor: string): string {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function extrairHoraSolta(conteudo: string): { hora: number; minuto: number; bruto: string } | undefined {
  const hora = conteudo.match(/(?:^|[^0-9])(\d{1,2})[:h](\d{2})(?=$|[^0-9])/);
  if (!hora) return undefined;

  const horaNumero = Number(hora[1]);
  const minutoNumero = Number(hora[2]);
  if (!horaValida(horaNumero, minutoNumero)) return undefined;

  return { hora: horaNumero, minuto: minutoNumero, bruto: hora[0].trim() };
}

function extrairDataBase(dataBase?: string | null): string | undefined {
  if (!dataBase) return undefined;
  return extrairDataHoraComprovantePix(dataBase).data;
}

export function extrairDataHoraComprovantePix(
  texto: string | null | undefined,
  dataBase?: string | null,
): PixComprovanteHorarioExtraido {
  const conteudo = normalizarTexto(String(texto || "").trim());
  if (!conteudo) return {};

  const iso = conteudo.match(/\b(\d{4})-(\d{2})-(\d{2})[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/);
  if (iso) {
    return montarExtraido(
      Number(iso[1]),
      Number(iso[2]),
      Number(iso[3]),
      Number(iso[4]),
      Number(iso[5]),
      iso[0],
    ) || {};
  }

  const brComHora = conteudo.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*(?:(?:as|a|[-,])\s*)?(\d{1,2})[:h](\d{2})\b/i);
  if (brComHora) {
    return montarExtraido(
      anoCompleto(brComHora[3]),
      Number(brComHora[2]),
      Number(brComHora[1]),
      Number(brComHora[4]),
      Number(brComHora[5]),
      brComHora[0],
    ) || {};
  }

  const isoData = conteudo.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoData) {
    const hora = extrairHoraSolta(conteudo);
    return montarExtraido(Number(isoData[1]), Number(isoData[2]), Number(isoData[3]), hora?.hora, hora?.minuto, hora ? `${isoData[0]} ${hora.bruto}` : isoData[0]) || {};
  }

  const brData = conteudo.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (brData) {
    const hora = extrairHoraSolta(conteudo);
    return montarExtraido(anoCompleto(brData[3]), Number(brData[2]), Number(brData[1]), hora?.hora, hora?.minuto, hora ? `${brData[0]} ${hora.bruto}` : brData[0]) || {};
  }

  const hora = extrairHoraSolta(conteudo);
  const dataNormalizada = extrairDataBase(dataBase);
  if (hora && dataNormalizada) {
    const [ano, mes, dia] = dataNormalizada.split("-").map(Number);
    return montarExtraido(ano, mes, dia, hora.hora, hora.minuto, hora.bruto) || {};
  }

  return {};
}

function escolherHorarioComprovante(input: AvaliarHorarioComprovantePixInput, dataPedido?: string): PixComprovanteHorarioExtraido {
  const partes = [
    input.dataHoraComprovante,
    [input.dataComprovante, input.horaComprovante].filter(Boolean).join(" "),
    input.horaComprovante,
    input.textoComprovante,
  ].filter(Boolean);

  for (const parte of partes) {
    const extraido = extrairDataHoraComprovantePix(String(parte), dataPedido);
    if (extraido.data || extraido.hora) return extraido;
  }

  return {};
}

function instanteOperacional(extraido: PixComprovanteHorarioExtraido): number | undefined {
  if (!extraido.data || !extraido.hora) return undefined;
  const [ano, mes, dia] = extraido.data.split("-").map(Number);
  const [hora, minuto] = extraido.hora.split(":").map(Number);
  if (!dataValida(ano, mes, dia) || !horaValida(hora, minuto)) return undefined;
  return Date.UTC(ano, mes - 1, dia, hora, minuto, 0, 0) - OFFSET_SAO_PAULO_MINUTOS * 60_000;
}

export function avaliarHorarioComprovantePix(input: AvaliarHorarioComprovantePixInput): ResultadoHorarioComprovantePix {
  const toleranciaMinutos = input.toleranciaMinutos ?? TOLERANCIA_HORARIO_COMPROVANTE_PIX_MINUTOS;
  const dataPedido = extrairDataBase(input.dataPedido);
  const pedido = extrairDataHoraComprovantePix(input.horarioPedido, dataPedido);
  const comprovante = escolherHorarioComprovante(input, dataPedido);

  if (!comprovante.data && !comprovante.hora) {
    return { ok: true, bloquear: false, motivo: "sem_horario" };
  }

  if (pedido.data && comprovante.data && comprovante.data !== pedido.data) {
    return {
      ok: false,
      bloquear: true,
      motivo: "data_diferente",
      pedidoEm: pedido.dataHora,
      pagamentoEm: comprovante.dataHora || comprovante.data,
      horario: comprovante,
    };
  }

  if (!comprovante.hora) {
    return { ok: true, bloquear: false, motivo: "sem_horario", horario: comprovante };
  }

  const pedidoMs = instanteOperacional(pedido);
  const comprovanteMs = instanteOperacional(comprovante);
  if (pedidoMs === undefined || comprovanteMs === undefined) {
    return { ok: true, bloquear: false, motivo: "referencia_invalida", horario: comprovante };
  }

  const diferencaMinutos = Math.round((comprovanteMs - pedidoMs) / 60_000);
  if (diferencaMinutos < -toleranciaMinutos) {
    return {
      ok: false,
      bloquear: true,
      motivo: "pagamento_anterior",
      pedidoEm: pedido.dataHora,
      pagamentoEm: comprovante.dataHora,
      diferencaMinutos,
      horario: comprovante,
    };
  }

  return {
    ok: true,
    bloquear: false,
    motivo: "ok",
    pedidoEm: pedido.dataHora,
    pagamentoEm: comprovante.dataHora,
    diferencaMinutos,
    horario: comprovante,
  };
}
