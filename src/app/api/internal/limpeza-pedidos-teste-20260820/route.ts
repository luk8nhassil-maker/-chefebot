import { createHash, randomUUID, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { adquirirMutexPedidos, liberarMutexPedidos } from "@/lib/pedidosConcorrencia";
import {
  faturamentoDosPedidosEntregues,
  resumirRiscosLaterais,
  selecionarComandasDeTeste,
  selecionarPedidosDeTeste,
  totalDosPedidos,
  type RegistroComandaTeste,
  type RegistroPedidoTeste,
} from "@/lib/limpezaPedidosTeste";

export const dynamic = "force-dynamic";

const MIGRATION_ID = "limpeza-pedidos-teste-20260820";
const TOKEN_HASH_HEX = "0eb5c1daa98d8601dc4cf6dc778f91a9c6ea74aa8d0225abe58fe144459f9063";
const BACKUP_KEY = `backup:migracao:${MIGRATION_ID}`;
const MIGRATION_KEY = `migracao:${MIGRATION_ID}`;
const ROLLBACK_KEY = `migracao:${MIGRATION_ID}:rollback`;
const BACKUP_TTL = 30 * 24 * 60 * 60;
const CHAVE_COMANDAS = "salao:comandas";
const CHAVE_MUTEX_COMANDAS = "salao:comandas:mutex";
const MUTEX_COMANDAS_TTL = 5;
const MUTEX_COMANDAS_TENTATIVAS = 20;
const MUTEX_COMANDAS_ESPERA_MS = 50;
const MAX_REGISTROS_AUTORUN = 20;

const LIBERAR_MUTEX_COMANDAS_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

type Pedido = RegistroPedidoTeste & Record<string, unknown>;
type Comanda = RegistroComandaTeste & Record<string, unknown>;

type Backup = {
  migrationId: string;
  criadoEm: string;
  fingerprint: string;
  pedidos: Pedido[];
  comandas: Comanda[];
};

type RegistroMigracao = {
  migrationId: string;
  executadoEm: string;
  fingerprint: string;
  pedidosRemovidos: number;
  comandasRemovidas: number;
  faturamentoRemovido: number;
  backupKey: string;
};

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tokenValido(token: string | null): boolean {
  if (!token) return false;
  const recebido = createHash("sha256").update(token).digest();
  const esperado = Buffer.from(TOKEN_HASH_HEX, "hex");
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

function stringSegura(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

function numeroSeguro(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

function resumoPedido(pedido: Pedido) {
  return {
    id: stringSegura(pedido.id),
    numero: numeroSeguro(pedido.numero),
    cliente: stringSegura(pedido.cliente),
    total: numeroSeguro(pedido.total),
    status: stringSegura(pedido.status),
  };
}

function resumoComanda(comanda: Comanda) {
  return {
    id: stringSegura(comanda.id),
    numero: numeroSeguro(comanda.numero),
    cliente: stringSegura(comanda.cliente),
    status: stringSegura(comanda.status),
  };
}

function construirAlvos(pedidos: Pedido[], comandas: Comanda[]) {
  const pedidosTeste = selecionarPedidosDeTeste(pedidos);
  const comandasTeste = selecionarComandasDeTeste(comandas);
  const baseFingerprint = {
    pedidos: pedidosTeste.map(resumoPedido).sort((a, b) => a.id.localeCompare(b.id)),
    comandas: comandasTeste.map(resumoComanda).sort((a, b) => a.id.localeCompare(b.id)),
  };
  const fingerprint = createHash("sha256").update(JSON.stringify(baseFingerprint)).digest("hex");
  return {
    pedidosTeste,
    comandasTeste,
    fingerprint,
    faturamentoAfetado: faturamentoDosPedidosEntregues(pedidosTeste),
    totalNominal: totalDosPedidos(pedidosTeste),
    riscosLaterais: resumirRiscosLaterais(pedidosTeste),
    pedidos: baseFingerprint.pedidos,
    comandas: baseFingerprint.comandas,
  };
}

function autorunTemRisco(alvos: ReturnType<typeof construirAlvos>): boolean {
  const riscos = alvos.riscosLaterais;
  // pizzasCount isolado não é suficiente para gerar fidelidade: sem telefone
  // ou clienteId não existe identidade para creditar. Ele continua exposto no
  // dry-run como sinal informativo, mas não bloqueia sozinho o autorun.
  return riscos.comTelefone > 0
    || riscos.comClienteId > 0
    || riscos.comResgate > 0
    || riscos.comRecompensaJornada > 0
    || riscos.comItensJornada > 0;
}

async function adquirirMutexComandas(): Promise<string> {
  for (let tentativa = 0; tentativa < MUTEX_COMANDAS_TENTATIVAS; tentativa++) {
    const token = randomUUID();
    const obtido = await redis.set(CHAVE_MUTEX_COMANDAS, token, { nx: true, ex: MUTEX_COMANDAS_TTL }).catch(() => null);
    if (obtido) return token;
    await esperar(MUTEX_COMANDAS_ESPERA_MS);
  }
  throw new Error("mutex_comandas_indisponivel");
}

async function liberarMutexComandas(token: string): Promise<void> {
  await redis.eval(LIBERAR_MUTEX_COMANDAS_LUA, [CHAVE_MUTEX_COMANDAS], [token]).catch(() => null);
}

async function lerDados(): Promise<{ pedidos: Pedido[]; comandas: Comanda[] }> {
  const [pedidos, comandas] = await Promise.all([
    redis.get<Pedido[]>("pedidos"),
    redis.get<Comanda[]>(CHAVE_COMANDAS),
  ]);
  return {
    pedidos: Array.isArray(pedidos) ? pedidos : [],
    comandas: Array.isArray(comandas) ? comandas : [],
  };
}

async function comLocks<T>(fn: () => Promise<T>): Promise<T> {
  const tokenPedidos = await adquirirMutexPedidos();
  let tokenComandas: string | null = null;
  try {
    tokenComandas = await adquirirMutexComandas();
    return await fn();
  } finally {
    if (tokenComandas) await liberarMutexComandas(tokenComandas);
    await liberarMutexPedidos(tokenPedidos);
  }
}

async function verificarEstado() {
  const [{ pedidos, comandas }, migracao, backup] = await Promise.all([
    lerDados(),
    redis.get<RegistroMigracao>(MIGRATION_KEY),
    redis.get<Backup>(BACKUP_KEY),
  ]);
  const alvos = construirAlvos(pedidos, comandas);
  return {
    restantesPedidosTeste: alvos.pedidosTeste.length,
    restantesComandasTeste: alvos.comandasTeste.length,
    faturamentoTesteRestante: alvos.faturamentoAfetado,
    migracao: migracao ?? null,
    backupDisponivel: !!backup,
  };
}

async function executarLimpeza(opcoes: { fingerprintConfirmado?: string; autorun: boolean }) {
  return comLocks(async () => {
    const jaExecutada = await redis.get<RegistroMigracao>(MIGRATION_KEY);
    if (jaExecutada) {
      return NextResponse.json({ ok: true, mode: opcoes.autorun ? "auto" : "execute", idempotente: true, ...(await verificarEstado()) });
    }

    const { pedidos, comandas } = await lerDados();
    const alvos = construirAlvos(pedidos, comandas);

    if (opcoes.autorun) {
      const totalRegistros = alvos.pedidosTeste.length + alvos.comandasTeste.length;
      if (totalRegistros > MAX_REGISTROS_AUTORUN) {
        return NextResponse.json({ ok: false, error: "Autorun bloqueado: quantidade acima do limite seguro", totalRegistros }, { status: 409 });
      }
      if (autorunTemRisco(alvos)) {
        return NextResponse.json({ ok: false, error: "Autorun bloqueado: pedidos de teste possuem vínculos que exigem tratamento manual", riscosLaterais: alvos.riscosLaterais }, { status: 409 });
      }
    } else if (alvos.fingerprint !== opcoes.fingerprintConfirmado) {
      return NextResponse.json(
        { ok: false, error: "Os dados mudaram desde o dry-run. Execute um novo dry-run.", fingerprintAtual: alvos.fingerprint },
        { status: 409 },
      );
    }

    if (alvos.pedidosTeste.length === 0 && alvos.comandasTeste.length === 0) {
      return NextResponse.json({ ok: true, mode: opcoes.autorun ? "auto" : "execute", noop: true, ...(await verificarEstado()) });
    }

    const backupExistente = await redis.get<Backup>(BACKUP_KEY);
    if (backupExistente) {
      return NextResponse.json({ ok: false, error: "Backup pré-existente sem migração concluída. Operação interrompida." }, { status: 409 });
    }

    const backup: Backup = {
      migrationId: MIGRATION_ID,
      criadoEm: new Date().toISOString(),
      fingerprint: alvos.fingerprint,
      pedidos: alvos.pedidosTeste,
      comandas: alvos.comandasTeste,
    };
    await redis.set(BACKUP_KEY, backup, { ex: BACKUP_TTL });
    const backupLido = await redis.get<Backup>(BACKUP_KEY);
    if (!backupLido || backupLido.fingerprint !== backup.fingerprint || backupLido.pedidos.length !== backup.pedidos.length || backupLido.comandas.length !== backup.comandas.length) {
      await redis.del(BACKUP_KEY).catch(() => null);
      return NextResponse.json({ ok: false, error: "Falha ao validar o backup. Nada foi apagado." }, { status: 503 });
    }

    const idsPedidos = new Set(alvos.pedidosTeste.map((p) => stringSegura(p.id)));
    const idsComandas = new Set(alvos.comandasTeste.map((c) => stringSegura(c.id)));
    const pedidosRestantes = pedidos.filter((p) => !idsPedidos.has(stringSegura(p.id)));
    const comandasRestantes = comandas.filter((c) => !idsComandas.has(stringSegura(c.id)));

    try {
      await redis.set("pedidos", pedidosRestantes);
      await redis.set(CHAVE_COMANDAS, comandasRestantes);
    } catch {
      await redis.set("pedidos", pedidos).catch(() => null);
      await redis.set(CHAVE_COMANDAS, comandas).catch(() => null);
      return NextResponse.json({ ok: false, error: "Falha durante a exclusão; rollback imediato solicitado." }, { status: 503 });
    }

    const pos = construirAlvos((await redis.get<Pedido[]>("pedidos")) || [], (await redis.get<Comanda[]>(CHAVE_COMANDAS)) || []);
    if (pos.pedidosTeste.length !== 0 || pos.comandasTeste.length !== 0) {
      await redis.set("pedidos", pedidos).catch(() => null);
      await redis.set(CHAVE_COMANDAS, comandas).catch(() => null);
      return NextResponse.json({ ok: false, error: "Verificação pós-exclusão falhou; rollback imediato solicitado." }, { status: 500 });
    }

    const registro: RegistroMigracao = {
      migrationId: MIGRATION_ID,
      executadoEm: new Date().toISOString(),
      fingerprint: alvos.fingerprint,
      pedidosRemovidos: alvos.pedidosTeste.length,
      comandasRemovidas: alvos.comandasTeste.length,
      faturamentoRemovido: alvos.faturamentoAfetado,
      backupKey: BACKUP_KEY,
    };
    await redis.set(MIGRATION_KEY, registro, { ex: BACKUP_TTL }).catch(() => null);

    return NextResponse.json({
      ok: true,
      mode: opcoes.autorun ? "auto" : "execute",
      pedidosRemovidos: alvos.pedidosTeste.length,
      comandasRemovidas: alvos.comandasTeste.length,
      faturamentoRemovido: alvos.faturamentoAfetado,
      riscosLaterais: alvos.riscosLaterais,
      backupKey: BACKUP_KEY,
      backupValidoPorDias: 30,
      restantesPedidosTeste: 0,
      restantesComandasTeste: 0,
    });
  });
}

export async function GET(req: NextRequest) {
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json({ ok: false, error: "Manutenção permitida somente em produção" }, { status: 403 });
  }

  const url = new URL(req.url);
  const modo = url.searchParams.get("mode") || "dry-run";
  const autorun = modo === "auto";

  // `auto` é um gatilho público deliberadamente estreito e de uso único:
  // só consegue executar ESTA migração fixa, apenas em produção, no máximo
  // 20 registros e apenas quando não há telefone/cliente/resgate/Jornada.
  // Todos os demais modos continuam exigindo o token secreto temporário.
  if (!autorun && !tokenValido(url.searchParams.get("token"))) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }

  if (modo === "verify") {
    return NextResponse.json({ ok: true, mode: "verify", ...(await verificarEstado()) });
  }

  if (modo === "dry-run") {
    const { pedidos, comandas } = await lerDados();
    const alvos = construirAlvos(pedidos, comandas);
    return NextResponse.json({
      ok: true,
      mode: "dry-run",
      criterio: "palavra isolada teste/testes no nome do cliente, sem diferenciar maiúsculas",
      fingerprint: alvos.fingerprint,
      pedidosEncontrados: alvos.pedidosTeste.length,
      comandasEncontradas: alvos.comandasTeste.length,
      totalNominal: alvos.totalNominal,
      faturamentoAfetado: alvos.faturamentoAfetado,
      riscosLaterais: alvos.riscosLaterais,
      pedidos: alvos.pedidos,
      comandas: alvos.comandas,
    });
  }

  if (modo === "auto") {
    return executarLimpeza({ autorun: true });
  }

  if (modo === "execute") {
    const fingerprintConfirmado = url.searchParams.get("fingerprint") || "";
    if (!fingerprintConfirmado) {
      return NextResponse.json({ ok: false, error: "Fingerprint do dry-run obrigatório" }, { status: 400 });
    }
    return executarLimpeza({ autorun: false, fingerprintConfirmado });
  }

  if (modo === "rollback") {
    return comLocks(async () => {
      const backup = await redis.get<Backup>(BACKUP_KEY);
      if (!backup) {
        return NextResponse.json({ ok: false, error: "Backup não encontrado" }, { status: 404 });
      }
      const { pedidos, comandas } = await lerDados();
      const idsPedidos = new Set(pedidos.map((p) => stringSegura(p.id)));
      const idsComandas = new Set(comandas.map((c) => stringSegura(c.id)));
      const restaurarPedidos = backup.pedidos.filter((p) => !idsPedidos.has(stringSegura(p.id)));
      const restaurarComandas = backup.comandas.filter((c) => !idsComandas.has(stringSegura(c.id)));

      await redis.set("pedidos", [...pedidos, ...restaurarPedidos]);
      await redis.set(CHAVE_COMANDAS, [...comandas, ...restaurarComandas]);
      await redis.del(MIGRATION_KEY).catch(() => null);
      await redis.set(ROLLBACK_KEY, { realizadoEm: new Date().toISOString(), pedidos: restaurarPedidos.length, comandas: restaurarComandas.length }, { ex: BACKUP_TTL }).catch(() => null);

      return NextResponse.json({
        ok: true,
        mode: "rollback",
        pedidosRestaurados: restaurarPedidos.length,
        comandasRestauradas: restaurarComandas.length,
        ...(await verificarEstado()),
      });
    });
  }

  return NextResponse.json({ ok: false, error: "Modo inválido" }, { status: 400 });
}
