// GET /api/dev/mcp — endpoint somente leitura para o painel dev MCP.
// Requer role 'dev' via JWT no cookie auth-token (mesmo padrão de /api/dev/reset).
// Nenhum método de escrita existe neste endpoint.

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { lerDadosMcp } from '@/mcp/lib/mcpReader';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.cookies.get('auth-token')?.value ?? null;
  if (!token) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }
  if (payload.role !== 'dev') {
    return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
  }

  const dados = await lerDadosMcp();
  return NextResponse.json(dados);
}

// Nenhum POST, PUT, DELETE ou PATCH — painel somente leitura
