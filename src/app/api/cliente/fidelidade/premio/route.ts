import { NextRequest, NextResponse } from "next/server";
import { lerSessaoCliente } from "@/lib/clienteAuth";
import { buscarClientePorId } from "@/lib/clientes";
import { derivarClienteIdPorTelefone } from "@/lib/fidelidade";
import { obterResgatePremio, solicitarResgatePremio } from "@/lib/temporadaPremioResgate";

const TENANT_ID = "default";

function resposta(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

async function clienteAutenticado(req: NextRequest) {
  const sessao = await lerSessaoCliente(req);
  if (!sessao) return null;
  const cliente = await buscarClientePorId(sessao.clienteId);
  if (!cliente) return null;
  return { cliente, clienteId: derivarClienteIdPorTelefone(cliente.telefone) ?? cliente.clienteId };
}

// Consulta o resgate já solicitado. Não aceita clienteId vindo do navegador.
export async function GET(req: NextRequest) {
  const autenticado = await clienteAutenticado(req);
  if (!autenticado) return resposta({ error: "Nao autorizado" }, { status: 401 });
  const temporadaId = req.nextUrl.searchParams.get("temporadaId")?.trim() ?? "";
  if (!temporadaId) return resposta({ error: "temporadaId obrigatorio" }, { status: 400 });

  const resgate = await obterResgatePremio(TENANT_ID, temporadaId, autenticado.clienteId);
  return resposta({
    resgate: resgate
      ? {
          temporadaId: resgate.temporadaId,
          descricaoPremio: resgate.descricaoPremio,
          posicao: resgate.posicao,
          status: resgate.status,
          codigoPublico: resgate.codigoPublico,
          solicitadoEm: resgate.solicitadoEm,
        }
      : null,
  });
}

// Solicita o prêmio depois do encerramento. A elegibilidade vem do snapshot
// arquivado no servidor; o frontend nunca escolhe posição nem vencedor.
export async function POST(req: NextRequest) {
  const autenticado = await clienteAutenticado(req);
  if (!autenticado) return resposta({ error: "Nao autorizado" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return resposta({ error: "Body invalido" }, { status: 400 });
  }
  const temporadaId = typeof body.temporadaId === "string" ? body.temporadaId.trim() : "";
  if (!temporadaId) return resposta({ error: "temporadaId obrigatorio" }, { status: 400 });

  const resultado = await solicitarResgatePremio({
    tenantId: TENANT_ID,
    temporadaId,
    clienteId: autenticado.clienteId,
  });
  if (!resultado.ok) {
    const status = resultado.codigo === "nao_elegivel" ? 403 : resultado.codigo === "premio_nao_aprovado" ? 422 : 404;
    return resposta({ ok: false, codigo: resultado.codigo }, { status });
  }

  const { resgate } = resultado;
  return resposta({
    ok: true,
    jaExistia: resultado.jaExistia,
    resgate: {
      temporadaId: resgate.temporadaId,
      descricaoPremio: resgate.descricaoPremio,
      posicao: resgate.posicao,
      status: resgate.status,
      codigoPublico: resgate.codigoPublico,
      solicitadoEm: resgate.solicitadoEm,
    },
  });
}
