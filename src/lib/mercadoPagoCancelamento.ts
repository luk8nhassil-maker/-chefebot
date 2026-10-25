import { resolveActiveMercadoPagoToken } from "./mercadoPagoIntegracao";
import { buscarPagamentoMercadoPagoDetalhado } from "./mercadoPagoWebhook";

const MP_PAYMENTS_URL = "https://api.mercadopago.com/v1/payments";
const TIMEOUT_MS = 5_000;

export type EstadoPagamentoMercadoPago = "pago" | "pendente" | "nao_cobravel" | "inconclusivo";

export type ConsultaEstadoPagamentoMercadoPago = {
  estado: EstadoPagamentoMercadoPago;
  status?: string;
  motivo?: string;
};

export type ResultadoCancelamentoPagamentoMercadoPago = {
  estado: "cancelado" | "pago" | "ainda_pendente" | "nao_cobravel" | "inconclusivo";
  status?: string;
  motivo?: string;
};

function classificarStatus(statusBruto: string | undefined): ConsultaEstadoPagamentoMercadoPago {
  const status = String(statusBruto || "").trim().toLowerCase();
  if (status === "approved") return { estado: "pago", status };
  if (status === "pending" || status === "in_process" || status === "authorized") {
    return { estado: "pendente", status };
  }
  if (["cancelled", "canceled", "rejected", "refunded", "charged_back"].includes(status)) {
    return { estado: "nao_cobravel", status };
  }
  return { estado: "inconclusivo", ...(status ? { status } : {}), motivo: "status_desconhecido" };
}

export async function consultarEstadoPagamentoMercadoPago(paymentId: string): Promise<ConsultaEstadoPagamentoMercadoPago> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resultado = await buscarPagamentoMercadoPagoDetalhado(paymentId, controller.signal);
    if (!resultado.ok) return { estado: "inconclusivo", motivo: resultado.motivo };
    return classificarStatus(resultado.pagamento.status);
  } catch (error) {
    const timeout = error instanceof Error && error.name === "AbortError";
    return { estado: "inconclusivo", motivo: timeout ? "timeout" : "erro_consulta" };
  } finally {
    clearTimeout(timer);
  }
}

export async function cancelarPagamentoMercadoPagoPendente(paymentId: string): Promise<ResultadoCancelamentoPagamentoMercadoPago> {
  const token = await resolveActiveMercadoPagoToken();
  if (!token) return { estado: "inconclusivo", motivo: "token_indisponivel" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${MP_PAYMENTS_URL}/${encodeURIComponent(paymentId)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: "cancelled" }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (response.ok) {
      const classificado = classificarStatus(data?.status);
      if (classificado.estado === "nao_cobravel") {
        return { estado: "cancelado", status: classificado.status };
      }
      if (classificado.estado === "pago") return { estado: "pago", status: classificado.status };
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { estado: "inconclusivo", motivo: "timeout_cancelamento" };
    }
    // Resultado de rede ambíguo: consulta o estado oficial abaixo antes
    // de decidir qualquer coisa sobre o pedido local.
  } finally {
    clearTimeout(timer);
  }

  const atual = await consultarEstadoPagamentoMercadoPago(paymentId);
  if (atual.estado === "pago") return { estado: "pago", status: atual.status };
  if (atual.estado === "pendente") return { estado: "ainda_pendente", status: atual.status };
  if (atual.estado === "nao_cobravel") return { estado: "nao_cobravel", status: atual.status };
  return { estado: "inconclusivo", motivo: atual.motivo, status: atual.status };
}
