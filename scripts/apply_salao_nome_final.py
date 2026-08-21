from pathlib import Path
import re


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: esperado 1 match exato, encontrado {count}: {old[:80]!r}")
    p.write_text(text.replace(old, new, 1))


def sub_once(path: str, pattern: str, repl: str) -> None:
    p = Path(path)
    text = p.read_text()
    novo, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{path}: esperado 1 match regex, encontrado {count}: {pattern[:100]!r}")
    p.write_text(novo)


# ---------------------------------------------------------------------------
# Backend: comanda pode nascer sem nome; nome é salvo explicitamente no final.
# ---------------------------------------------------------------------------
replace_once(
    "src/app/api/salao/comandas/route.ts",
    '''  const cliente = (body.cliente || "").trim();\n  if (!cliente) {\n    return NextResponse.json({ ok: false, error: "Informe o nome do cliente" }, { status: 400 });\n  }\n\n  const resultado = await abrirComanda({ cliente, mesa: body.mesa, complemento: body.complemento });''',
    '''  // O nome agora é coletado somente no fim da montagem do pedido. A\n  // comanda pode nascer como rascunho sem cliente, mas a rota de ENVIO\n  // continua fail-closed e não deixa nenhum pedido chegar à cozinha sem nome.\n  const cliente = (body.cliente || "").trim();\n\n  const resultado = await abrirComanda({\n    ...(cliente ? { cliente } : {}),\n    mesa: body.mesa,\n    complemento: body.complemento,\n  });''',
)

replace_once(
    "src/app/api/salao/comandas/[id]/enviar/route.ts",
    'import { buscarComanda, identificacaoClienteComanda, marcarComandaEnviada, PAGAMENTO_COMANDA_EM_ABERTO } from "@/lib/comandas";',
    'import { buscarComanda, marcarComandaEnviada, PAGAMENTO_COMANDA_EM_ABERTO } from "@/lib/comandas";',
)
replace_once(
    "src/app/api/salao/comandas/[id]/enviar/route.ts",
    '''  if (comanda.itens.length === 0) {\n    await liberarEnvioInicialSalao(id, claimToken);\n    return NextResponse.json({ ok: false, error: "Adicione pelo menos um item antes de enviar" }, { status: 422 });\n  }\n\n  const identificacaoCliente = identificacaoClienteComanda(comanda);''',
    '''  if (comanda.itens.length === 0) {\n    await liberarEnvioInicialSalao(id, claimToken);\n    return NextResponse.json({ ok: false, error: "Adicione pelo menos um item antes de enviar" }, { status: 422 });\n  }\n\n  // Barreira server-side: a UI pede o nome no último passo, mas esta rota\n  // também exige o campo persistido para impedir bypass por requisição direta.\n  const identificacaoCliente = comanda.cliente?.trim();\n  if (!identificacaoCliente) {\n    await liberarEnvioInicialSalao(id, claimToken);\n    return NextResponse.json({ ok: false, error: "Informe o nome do cliente antes de enviar" }, { status: 422 });\n  }''',
)

# Fonte única para gravar/alterar o nome sem tocar nos itens de nenhuma rodada.
replace_once(
    "src/lib/comandas.ts",
    '''export type CriarRodadaResultado =\n  | { ok: true; rodada: Rodada; comanda: Comanda; criada: boolean }\n  | { ok: false; motivo: "nao_encontrada" | "comanda_fechada" };''',
    '''export type AtualizarClienteComandaResultado = Comanda | "nao_encontrada" | "comanda_fechada" | "cliente_invalido";\n\n/**\n * Atualiza somente a identificação humana da comanda. Não toca em itens,\n * preços, rodadas, status ou pagamento. Pode ser chamado enquanto a comanda\n * estiver aberta ou já enviada, mas nunca depois de fechada.\n */\nexport async function atualizarClienteComanda(id: string, cliente: string): Promise<AtualizarClienteComandaResultado> {\n  const clienteTrim = cliente.trim();\n  if (!clienteTrim) return "cliente_invalido";\n\n  return comMutexComandas(async () => {\n    const lista = await listarComandas();\n    const idx = lista.findIndex((c) => c.id === id);\n    if (idx < 0) return "nao_encontrada";\n    if (lista[idx].status === "fechada") return "comanda_fechada";\n\n    lista[idx] = { ...lista[idx], cliente: clienteTrim };\n    await salvarComandas(lista);\n    return lista[idx];\n  });\n}\n\nexport type CriarRodadaResultado =\n  | { ok: true; rodada: Rodada; comanda: Comanda; criada: boolean }\n  | { ok: false; motivo: "nao_encontrada" | "comanda_fechada" };''',
)

# Rota dedicada: nome final sem regravar Rodada 1 ou complemento.
cliente_route = Path("src/app/api/salao/comandas/[id]/cliente/route.ts")
cliente_route.parent.mkdir(parents=True, exist_ok=True)
cliente_route.write_text('''import { NextRequest, NextResponse } from "next/server";\nimport { lerSessaoSalao } from "@/lib/salaoAuth";\nimport { atualizarClienteComanda } from "@/lib/comandas";\nimport { executarMutacaoComContaAbertaSalao } from "@/lib/salaoConta.server";\nimport { ERRO_ESCRITA_SALAO_PREVIEW, escritaSalaoBloqueadaNoPreview } from "@/lib/salaoAmbiente";\n\nexport const dynamic = "force-dynamic";\n\nexport async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {\n  const sessaoSalao = await lerSessaoSalao(req);\n  if (!sessaoSalao) {\n    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });\n  }\n  if (escritaSalaoBloqueadaNoPreview()) {\n    return NextResponse.json({ ok: false, error: ERRO_ESCRITA_SALAO_PREVIEW }, { status: 403 });\n  }\n\n  let body: { cliente?: unknown };\n  try {\n    body = await req.json();\n  } catch {\n    return NextResponse.json({ ok: false, error: "Payload inválido" }, { status: 400 });\n  }\n\n  const cliente = typeof body.cliente === "string" ? body.cliente.trim() : "";\n  if (!cliente) {\n    return NextResponse.json({ ok: false, error: "Informe o nome do cliente" }, { status: 400 });\n  }\n\n  const { id } = await params;\n  const mutacao = await executarMutacaoComContaAbertaSalao(id, () => atualizarClienteComanda(id, cliente));\n  if (!mutacao.ok) {\n    return NextResponse.json({ ok: false, error: mutacao.error }, { status: mutacao.status });\n  }\n\n  const resultado = mutacao.valor;\n  if (resultado === "nao_encontrada") {\n    return NextResponse.json({ ok: false, error: "Comanda não encontrada" }, { status: 404 });\n  }\n  if (resultado === "comanda_fechada") {\n    return NextResponse.json({ ok: false, error: "Esta comanda já está fechada" }, { status: 409 });\n  }\n  if (resultado === "cliente_invalido") {\n    return NextResponse.json({ ok: false, error: "Informe o nome do cliente" }, { status: 400 });\n  }\n\n  return NextResponse.json({ ok: true, comanda: resultado });\n}\n''')

cliente_test = Path("src/app/api/salao/comandas/[id]/cliente/route.test.ts")
cliente_test.write_text('''import { beforeEach, describe, expect, it, vi } from "vitest";\n\nconst { store, redisMock } = vi.hoisted(() => {\n  const store = new Map<string, unknown>();\n  const redisMock = {\n    get: vi.fn(async (key: string) => store.get(key) ?? null),\n    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {\n      if (opts?.nx && store.has(key)) return null;\n      store.set(key, value);\n      return "OK";\n    }),\n    del: vi.fn(async (key: string) => { store.delete(key); return 1; }),\n    incr: vi.fn(async (key: string) => {\n      const next = Number(store.get(key) || 0) + 1;\n      store.set(key, next);\n      return next;\n    }),\n    expire: vi.fn(async () => 1),\n  };\n  return { store, redisMock };\n});\n\nvi.mock("@/lib/redis", () => ({ redis: redisMock }));\n\nimport { PATCH } from "./route";\nimport { POST as abrir } from "../../route";\nimport { SALAO_COOKIE, criarTokenSalao } from "@/lib/salaoAuth";\n\nfunction req(body: unknown, token?: string) {\n  return {\n    json: async () => body,\n    cookies: { get: (n: string) => (token && n === SALAO_COOKIE ? { value: token } : undefined) },\n  } as never;\n}\nfunction paramsFor(id: string) { return { params: Promise.resolve({ id }) }; }\n\nbeforeEach(() => { store.clear(); vi.clearAllMocks(); });\n\ndescribe("PATCH /api/salao/comandas/[id]/cliente", () => {\n  it("bloqueia sem sessão do Salão", async () => {\n    const res = await PATCH(req({ cliente: "Ana" }), paramsFor("x"));\n    expect(res.status).toBe(401);\n  });\n\n  it("grava o nome no final sem tocar nos itens da comanda", async () => {\n    const token = await criarTokenSalao();\n    const abertaRes = await abrir(req({ mesa: "5" }, token));\n    expect(abertaRes.status).toBe(200);\n    const aberta = await abertaRes.json();\n    expect(aberta.comanda.cliente).toBeUndefined();\n\n    const res = await PATCH(req({ cliente: "  Ana  " }, token), paramsFor(aberta.comanda.id));\n    expect(res.status).toBe(200);\n    const data = await res.json();\n    expect(data.comanda.cliente).toBe("Ana");\n    expect(data.comanda.itens).toEqual([]);\n  });\n\n  it("recusa nome vazio", async () => {\n    const token = await criarTokenSalao();\n    const aberta = await (await abrir(req({}, token))).json();\n    const res = await PATCH(req({ cliente: "   " }, token), paramsFor(aberta.comanda.id));\n    expect(res.status).toBe(400);\n  });\n});\n''')

# ---------------------------------------------------------------------------
# UI: primeiro mesa/produtos; nome aparece apenas na revisão final.
# ---------------------------------------------------------------------------
replace_once(
    "src/app/salao/page.tsx",
    'function identificacaoCliente(c: Pick<Comanda, "cliente" | "mesa">): string {\n  return c.cliente || (c.mesa ? `Mesa ${c.mesa}` : "Cliente")\n}',
    'function identificacaoCliente(c: Pick<Comanda, "cliente" | "mesa">): string {\n  return c.cliente || "Nome pendente"\n}',
)
replace_once(
    "src/app/salao/page.tsx",
    '''type Tela =\n  | { tipo: "home" }\n  | { tipo: "identificacao"; clientePreenchido?: string; mesaPreenchida?: string }\n  | { tipo: "mesa_ocupada"; cliente: string; mesa: string; comandaExistenteId: string }''',
    '''type Tela =\n  | { tipo: "home" }\n  | { tipo: "identificacao"; mesaPreenchida?: string }\n  | { tipo: "mesa_ocupada"; mesa: string; comandaExistenteId: string }''',
)
replace_once(
    "src/app/salao/page.tsx",
    '''      <AtendimentoForm\n        clienteInicial={tela.clientePreenchido || ""}\n        mesaInicial={tela.mesaPreenchida || ""}\n        comandas={comandas}\n        onVoltar={voltarParaInicio}\n        onMesaOcupada={(cliente, mesa, comandaExistenteId) => setTela({ tipo: "mesa_ocupada", cliente, mesa, comandaExistenteId })}\n        onCriada={(comandaId) => { setTela({ tipo: "catalogo", comandaId }); carregarComandas() }}\n      />''',
    '''      <AtendimentoForm\n        mesaInicial={tela.mesaPreenchida || ""}\n        comandas={comandas}\n        onVoltar={voltarParaInicio}\n        onMesaOcupada={(mesa, comandaExistenteId) => setTela({ tipo: "mesa_ocupada", mesa, comandaExistenteId })}\n        onCriada={(comandaId) => { setTela({ tipo: "catalogo", comandaId }); carregarComandas() }}\n      />''',
)
replace_once(
    "src/app/salao/page.tsx",
    '''      <MesaOcupadaResolver\n        cliente={tela.cliente}\n        mesa={tela.mesa}\n        onAbrirExistente={() => setTela({ tipo: "comanda", comandaId: tela.comandaExistenteId })}\n        onEscolherOutraMesa={() => setTela({ tipo: "identificacao", clientePreenchido: tela.cliente })}\n        onContinuarSemMesa={(comandaId) => { setTela({ tipo: "catalogo", comandaId }); carregarComandas() }}\n      />''',
    '''      <MesaOcupadaResolver\n        mesa={tela.mesa}\n        onAbrirExistente={() => setTela({ tipo: "comanda", comandaId: tela.comandaExistenteId })}\n        onEscolherOutraMesa={() => setTela({ tipo: "identificacao" })}\n        onContinuarSemMesa={(comandaId) => { setTela({ tipo: "catalogo", comandaId }); carregarComandas() }}\n      />''',
)

sub_once(
    "src/app/salao/page.tsx",
    r'function AtendimentoForm\([\s\S]*?\n}\n\nfunction MesaOcupadaResolver',
    '''function AtendimentoForm({\n  mesaInicial,\n  comandas,\n  onVoltar,\n  onMesaOcupada,\n  onCriada,\n}: {\n  mesaInicial: string\n  comandas: Comanda[]\n  onVoltar: () => void\n  onMesaOcupada: (mesa: string, comandaExistenteId: string) => void\n  onCriada: (comandaId: string) => void\n}) {\n  const [mesa, setMesa] = useState(mesaInicial)\n  const [semMesa, setSemMesa] = useState(false)\n  const [enviando, setEnviando] = useState(false)\n  const [erro, setErro] = useState<string | null>(null)\n  const mesaRef = useRef<HTMLInputElement>(null)\n\n  useEffect(() => { mesaRef.current?.focus() }, [])\n\n  async function escolherProdutos() {\n    if (enviando) return\n    setEnviando(true)\n    setErro(null)\n    try {\n      const mesaFinal = semMesa ? undefined : mesa.trim() || undefined\n      const r = await fetch("/api/salao/comandas", {\n        method: "POST",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({ ...(mesaFinal ? { mesa: mesaFinal } : {}) }),\n      })\n      const data = await r.json().catch(() => null)\n      if (r.status === 409) {\n        const existente = comandas.find((c) => c.mesa === mesaFinal && c.status !== "fechada")\n        if (existente && mesaFinal) {\n          onMesaOcupada(mesaFinal, existente.id)\n          return\n        }\n        setErro("Esta mesa já possui uma comanda aberta.")\n        return\n      }\n      if (!r.ok || !data?.ok) {\n        setErro(data?.error || "Não foi possível abrir o atendimento agora.")\n        return\n      }\n      onCriada(data.comanda.id)\n    } catch {\n      setErro("Não foi possível abrir o atendimento agora. Verifique a conexão.")\n    } finally {\n      setEnviando(false)\n    }\n  }\n\n  return (\n    <div className="sal-shell">\n      <EstiloSalao />\n      <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--surface)", flexShrink: 0, display: "flex", alignItems: "center" }}>\n        <button onClick={onVoltar} style={{ background: "none", border: "none", color: "var(--foreground-secondary)", fontSize: 14, fontWeight: 800, cursor: "pointer", minHeight: 44 }}>‹ Voltar</button>\n      </div>\n      <div className="sal-content" style={{ flex: 1 }}>\n        <p style={{ margin: 0, fontSize: 20, fontWeight: 900, color: "var(--foreground)" }}>Novo atendimento</p>\n        <p style={{ margin: 0, fontSize: 13, color: "var(--foreground-secondary)" }}>Monte o pedido primeiro. O nome do cliente fica para o final.</p>\n\n        <div style={{ display: "grid", gap: 6 }}>\n          <label htmlFor="sal-mesa" style={rotulo}>Mesa (opcional)</label>\n          <input\n            id="sal-mesa"\n            ref={mesaRef}\n            style={{ ...input, opacity: semMesa ? 0.5 : 1 }}\n            placeholder="Número da mesa"\n            value={mesa}\n            onChange={(e) => setMesa(e.target.value)}\n            disabled={semMesa}\n          />\n          <button\n            onClick={() => setSemMesa((v) => !v)}\n            aria-pressed={semMesa}\n            style={{ ...btnSecundario, height: 40, width: "fit-content", padding: "0 14px", border: "1px solid " + (semMesa ? "var(--primary)" : "var(--surface-secondary)"), background: semMesa ? "color-mix(in srgb, var(--primary) 15%, transparent)" : "transparent" }}\n          >\n            Sem mesa\n          </button>\n        </div>\n\n        {erro && <p role="alert" style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)", margin: 0 }}>{erro}</p>}\n      </div>\n      <div style={{ borderTop: "1px solid var(--surface)", padding: "12px 16px calc(12px + env(safe-area-inset-bottom))", flexShrink: 0 }}>\n        <button onClick={escolherProdutos} disabled={enviando} style={{ ...btnPrimario, width: "100%", ...(enviando ? btnDesabilitado : {}) }}>\n          {enviando ? "Abrindo…" : "Escolher produtos"}\n        </button>\n      </div>\n    </div>\n  )\n}\n\nfunction MesaOcupadaResolver''',
)

sub_once(
    "src/app/salao/page.tsx",
    r'function MesaOcupadaResolver\([\s\S]*?\n}\n\n// ---------------------------------------------------------------------------\n// Fluxo 3',
    '''function MesaOcupadaResolver({\n  mesa,\n  onAbrirExistente,\n  onEscolherOutraMesa,\n  onContinuarSemMesa,\n}: {\n  mesa: string\n  onAbrirExistente: () => void\n  onEscolherOutraMesa: () => void\n  onContinuarSemMesa: (comandaId: string) => void\n}) {\n  const [enviando, setEnviando] = useState(false)\n  const [erro, setErro] = useState<string | null>(null)\n\n  async function continuarSemMesa() {\n    setEnviando(true)\n    setErro(null)\n    try {\n      const r = await fetch("/api/salao/comandas", {\n        method: "POST",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({}),\n      })\n      const data = await r.json().catch(() => null)\n      if (!r.ok || !data?.ok) {\n        setErro(data?.error || "Não foi possível abrir o atendimento agora.")\n        return\n      }\n      onContinuarSemMesa(data.comanda.id)\n    } catch {\n      setErro("Não foi possível abrir o atendimento agora. Verifique a conexão.")\n    } finally {\n      setEnviando(false)\n    }\n  }\n\n  return (\n    <div className="sal-shell" style={{ alignItems: "center", justifyContent: "center", padding: 20 }}>\n      <EstiloSalao />\n      <div style={{ ...card, width: "100%", maxWidth: 380, display: "grid", gap: 12 }}>\n        <p style={{ margin: 0, fontSize: 17, fontWeight: 900, color: "var(--foreground)" }}>Esta mesa já possui uma comanda aberta.</p>\n        <p style={{ margin: 0, fontSize: 13.5, color: "var(--foreground-secondary)" }}>Mesa {mesa}</p>\n        {erro && <p role="alert" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--danger)", margin: 0 }}>{erro}</p>}\n        <button onClick={onAbrirExistente} style={btnPrimario}>Abrir comanda existente</button>\n        <button onClick={onEscolherOutraMesa} style={btnSecundario}>Escolher outra mesa</button>\n        <button onClick={continuarSemMesa} disabled={enviando} style={{ ...btnSecundario, ...(enviando ? btnDesabilitado : {}) }}>\n          {enviando ? "Abrindo…" : "Continuar sem mesa"}\n        </button>\n      </div>\n    </div>\n  )\n}\n\n// ---------------------------------------------------------------------------\n// Fluxo 3''',
)

# Deixa rascunhos sem nome fáceis de distinguir na home.
replace_once(
    "src/app/salao/page.tsx",
    '{identificacaoCliente(emAndamento[0])} · {identificacaoMesa(emAndamento[0])}',
    '{identificacaoCliente(emAndamento[0])} · {identificacaoMesa(emAndamento[0])} · Comanda #{emAndamento[0].numero}',
)
replace_once(
    "src/app/salao/page.tsx",
    '{identificacaoCliente(c)} · {identificacaoMesa(c)}</span>',
    '{identificacaoCliente(c)} · {identificacaoMesa(c)} · Comanda #{c.numero}</span>',
)

# Review: nome obrigatório é o último dado antes do envio.
replace_once(
    "src/app/salao/page.tsx",
    '''  const [erroEnviar, setErroEnviar] = useState<string | null>(rodada.erroUltimaTentativa || null)\n  const enviandoRef = useRef(false)''',
    '''  const [erroEnviar, setErroEnviar] = useState<string | null>(rodada.erroUltimaTentativa || null)\n  const [cliente, setCliente] = useState(comanda.cliente || "")\n  const [erroCliente, setErroCliente] = useState<string | null>(null)\n  const enviandoRef = useRef(false)''',
)
replace_once(
    "src/app/salao/page.tsx",
    '''  async function enviarParaCozinha() {\n    if (enviandoRef.current || itens.length === 0) return\n    enviandoRef.current = true\n    setEnviando(true)\n    setErroEnviar(null)\n    try {\n      if (!clientRequestIdRef.current) clientRequestIdRef.current = gerarClientRequestId()''',
    '''  async function enviarParaCozinha() {\n    if (enviandoRef.current || itens.length === 0) return\n    const clienteFinal = cliente.trim()\n    if (!clienteFinal) {\n      setErroCliente("Informe o nome do cliente.")\n      return\n    }\n\n    enviandoRef.current = true\n    setEnviando(true)\n    setErroEnviar(null)\n    setErroCliente(null)\n    try {\n      // O nome é persistido antes do envio, em rota própria, sem regravar\n      // itens da Rodada 1 nem de complementos. Se falhar, nada vai à cozinha.\n      const rCliente = await fetch(`/api/salao/comandas/${comanda.id}/cliente`, {\n        method: "PATCH",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({ cliente: clienteFinal }),\n      })\n      const dataCliente = await rCliente.json().catch(() => null)\n      if (!rCliente.ok || !dataCliente?.ok) {\n        setErroCliente(dataCliente?.error || "Não foi possível salvar o nome agora.")\n        return\n      }\n\n      if (!clientRequestIdRef.current) clientRequestIdRef.current = gerarClientRequestId()''',
)
replace_once(
    "src/app/salao/page.tsx",
    '''        <button onClick={onAdicionarMaisItens} style={btnSecundario}>Adicionar mais itens</button>\n      </div>\n\n      <div className="sal-action-footer">''',
    '''        <button onClick={onAdicionarMaisItens} style={btnSecundario}>Adicionar mais itens</button>\n\n        <div style={{ ...card, display: "grid", gap: 6 }}>\n          <label htmlFor="sal-cliente-final" style={rotulo}>Nome do cliente</label>\n          <input\n            id="sal-cliente-final"\n            style={input}\n            placeholder="Ex.: Ana"\n            value={cliente}\n            onChange={(e) => { setCliente(e.target.value); setErroCliente(null) }}\n            autoFocus={!comanda.cliente}\n          />\n          <p style={{ margin: 0, fontSize: 12, color: "var(--foreground-muted)" }}>Obrigatório para enviar o pedido à cozinha.</p>\n          {erroCliente && <p role="alert" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--danger)", margin: 0 }}>{erroCliente}</p>}\n        </div>\n      </div>\n\n      <div className="sal-action-footer">''',
)
replace_once(
    "src/app/salao/page.tsx",
    '''          disabled={itens.length === 0 || enviando}\n          style={{ ...btnPrimario, ...(itens.length === 0 || enviando ? btnDesabilitado : {}) }}''',
    '''          disabled={itens.length === 0 || enviando || cliente.trim().length === 0}\n          style={{ ...btnPrimario, ...(itens.length === 0 || enviando || cliente.trim().length === 0 ? btnDesabilitado : {}) }}''',
)

# ---------------------------------------------------------------------------
# Testes de API existentes.
# ---------------------------------------------------------------------------
replace_once(
    "src/app/api/salao/comandas/route.test.ts",
    '''  it("abre uma comanda nova com cliente obrigatório e mesa opcional", async () => {\n    const token = await criarTokenSalao();\n    const semCliente = await POST(postReqSalao({ mesa: "5" }, token));\n    expect(semCliente.status).toBe(400);\n\n    const res = await POST(postReqSalao({ cliente: "Ana", mesa: "5", complemento: "Varanda" }, token));\n    expect(res.status).toBe(200);\n    const data = await res.json();\n    expect(data.comanda.cliente).toBe("Ana");\n    expect(data.comanda.mesa).toBe("5");\n    expect(data.comanda.complemento).toBe("Varanda");\n    expect(data.comanda.status).toBe("aberta");\n  });''',
    '''  it("abre rascunho sem nome e continua aceitando nome quando já informado", async () => {\n    const token = await criarTokenSalao();\n    const semCliente = await POST(postReqSalao({ mesa: "5" }, token));\n    expect(semCliente.status).toBe(200);\n    const rascunho = await semCliente.json();\n    expect(rascunho.comanda.cliente).toBeUndefined();\n    expect(rascunho.comanda.mesa).toBe("5");\n\n    const res = await POST(postReqSalao({ cliente: "Ana", complemento: "Varanda" }, token));\n    expect(res.status).toBe(200);\n    const data = await res.json();\n    expect(data.comanda.cliente).toBe("Ana");\n    expect(data.comanda.complemento).toBe("Varanda");\n    expect(data.comanda.status).toBe("aberta");\n  });''',
)

replace_once(
    "src/app/api/salao/comandas/[id]/enviar/route.test.ts",
    '''  it("recusa enviar uma comanda sem itens", async () => {\n    const token = await criarTokenSalao();\n    const aberta = await (await abrir(reqSalao({ cliente: "Ana", mesa: "7" }, token))).json();\n    const res = await enviar(reqSalao({}, token), paramsFor(aberta.comanda.id));\n    expect(res.status).toBe(422);\n  });''',
    '''  it("recusa enviar uma comanda sem itens", async () => {\n    const token = await criarTokenSalao();\n    const aberta = await (await abrir(reqSalao({ cliente: "Ana", mesa: "7" }, token))).json();\n    const res = await enviar(reqSalao({}, token), paramsFor(aberta.comanda.id));\n    expect(res.status).toBe(422);\n  });\n\n  it("recusa enviar à cozinha enquanto o nome final ainda não foi informado", async () => {\n    const token = await criarTokenSalao();\n    const aberta = await (await abrir(reqSalao({ mesa: "7" }, token))).json();\n    await atualizarComanda(\n      reqSalao({ itens: [{ kind: "simple", name: "Refrigerante 2L", qty: 1 }] }, token),\n      paramsFor(aberta.comanda.id)\n    );\n\n    const res = await enviar(reqSalao({}, token), paramsFor(aberta.comanda.id));\n    const data = await res.json();\n    expect(res.status).toBe(422);\n    expect(data.error).toContain("nome do cliente");\n    expect(store.get("pedidos")).toBeUndefined();\n  });''',
)

# ---------------------------------------------------------------------------
# Testes de UI: mock acompanha o contrato novo e fluxo prova nome só no final.
# ---------------------------------------------------------------------------
sub_once(
    "src/app/salao/page.test.tsx",
    r'  if \(url === "/api/salao/comandas" && method === "POST"\) \{[\s\S]*?\n  \}\n\n  const patchComanda',
    '''  if (url === "/api/salao/comandas" && method === "POST") {\n    const cliente = String(body.cliente || "").trim() || undefined;\n    const mesa = body.mesa ? String(body.mesa).trim() || undefined : undefined;\n    if (mesa && comandas.some((c) => c.mesa === mesa && c.status !== "fechada")) {\n      return jsonRes(409, { ok: false, error: "Esta mesa já tem uma comanda aberta" });\n    }\n    seq += 1;\n    const agora = new Date().toISOString();\n    const nova: ComandaMock = {\n      id: `comanda_${seq}`, numero: seq, ...(cliente ? { cliente } : {}), mesa, itens: [], status: "aberta", abertaEm: agora,\n      rodadas: [{ id: `rodada_${seq}_1`, numero: 1, status: "rascunho", itens: [], subtotal: 0, criadaEm: agora, atualizadaEm: agora }],\n    };\n    comandas.push(nova);\n    return jsonRes(200, { ok: true, comanda: nova });\n  }\n\n  const patchCliente = url.match(/^\\/api\\/salao\\/comandas\\/([^/]+)\\/cliente$/);\n  if (patchCliente && method === "PATCH") {\n    const c = comandas.find((x) => x.id === patchCliente[1]);\n    if (!c) return jsonRes(404, { ok: false, error: "Comanda não encontrada" });\n    const cliente = String(body.cliente || "").trim();\n    if (!cliente) return jsonRes(400, { ok: false, error: "Informe o nome do cliente" });\n    c.cliente = cliente;\n    return jsonRes(200, { ok: true, comanda: c });\n  }\n\n  const patchComanda''',
)
replace_once(
    "src/app/salao/page.test.tsx",
    '''    if (!c) return jsonRes(404, { ok: false, error: "Comanda não encontrada" });\n    if (c.itens.length === 0) return jsonRes(422, { ok: false, error: "Adicione pelo menos um item antes de enviar" });''',
    '''    if (!c) return jsonRes(404, { ok: false, error: "Comanda não encontrada" });\n    if (c.itens.length === 0) return jsonRes(422, { ok: false, error: "Adicione pelo menos um item antes de enviar" });\n    if (!c.cliente?.trim()) return jsonRes(422, { ok: false, error: "Informe o nome do cliente antes de enviar" });''',
)

sub_once(
    "src/app/salao/page.test.tsx",
    r'describe\("/salao — identificação do atendimento", \(\) => \{[\s\S]*?\n\}\);\n\ndescribe\("/salao — escolher produtos e revisar",',
    '''describe("/salao — identificação do atendimento", () => {\n  it("começa pelo pedido: nome não aparece antes dos produtos", async () => {\n    const user = userEvent.setup();\n    render(<SalaoPage />);\n    await user.click(await screen.findByRole("button", { name: "Começar novo atendimento" }));\n\n    const botao = await screen.findByRole("button", { name: "Escolher produtos" });\n    expect(botao).toBeEnabled();\n    expect(screen.queryByLabelText("Nome do cliente")).not.toBeInTheDocument();\n    expect(screen.getByText("Monte o pedido primeiro. O nome do cliente fica para o final.")).toBeInTheDocument();\n  });\n\n  it("'Sem mesa' desabilita o campo de mesa e permite avançar direto aos produtos", async () => {\n    const user = userEvent.setup();\n    render(<SalaoPage />);\n    await user.click(await screen.findByRole("button", { name: "Começar novo atendimento" }));\n    await user.click(screen.getByRole("button", { name: "Sem mesa" }));\n    expect(screen.getByPlaceholderText("Número da mesa")).toBeDisabled();\n\n    await user.click(screen.getByRole("button", { name: "Escolher produtos" }));\n    expect(await screen.findByText("Nome pendente")).toBeInTheDocument();\n    expect(screen.getByText(/Sem mesa/)).toBeInTheDocument();\n  });\n\n  it("mesa ocupada mostra as três saídas — nunca só um erro técnico", async () => {\n    comandas.push({\n      id: "c1", numero: 1, cliente: "Bia", mesa: "5", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }],\n      status: "aberta", abertaEm: new Date().toISOString(),\n      rodadas: [{ id: "r1", numero: 1, status: "rascunho", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }], subtotal: 12, criadaEm: "", atualizadaEm: "" }],\n    });\n    const user = userEvent.setup();\n    render(<SalaoPage />);\n    await user.click(await screen.findByRole("button", { name: "Começar novo atendimento" }));\n    await user.type(screen.getByPlaceholderText("Número da mesa"), "5");\n    await user.click(screen.getByRole("button", { name: "Escolher produtos" }));\n\n    expect(await screen.findByText("Esta mesa já possui uma comanda aberta.")).toBeInTheDocument();\n    expect(screen.getByRole("button", { name: "Abrir comanda existente" })).toBeInTheDocument();\n    expect(screen.getByRole("button", { name: "Escolher outra mesa" })).toBeInTheDocument();\n    expect(screen.getByRole("button", { name: "Continuar sem mesa" })).toBeInTheDocument();\n  });\n\n  it("'Abrir comanda existente' leva direto para a comanda da mesa ocupada", async () => {\n    comandas.push({\n      id: "c1", numero: 1, cliente: "Bia", mesa: "5", itens: [],\n      status: "aberta", abertaEm: new Date().toISOString(),\n      rodadas: [{ id: "r1", numero: 1, status: "rascunho", itens: [], subtotal: 0, criadaEm: "", atualizadaEm: "" }],\n    });\n    const user = userEvent.setup();\n    render(<SalaoPage />);\n    await user.click(await screen.findByRole("button", { name: "Começar novo atendimento" }));\n    await user.type(screen.getByPlaceholderText("Número da mesa"), "5");\n    await user.click(screen.getByRole("button", { name: "Escolher produtos" }));\n    await user.click(await screen.findByRole("button", { name: "Abrir comanda existente" }));\n\n    expect(await screen.findByRole("button", { name: /Continuar pedido|Adicionar itens/ })).toBeInTheDocument();\n    expect(screen.getByText("Bia")).toBeInTheDocument();\n  });\n});\n\ndescribe("/salao — escolher produtos e revisar",''',
)
replace_once(
    "src/app/salao/page.test.tsx",
    '''    await user.click(await screen.findByRole("button", { name: "Começar novo atendimento" }));\n    await user.type(screen.getByLabelText("Nome do cliente"), "Ana");\n    await user.click(screen.getByRole("button", { name: "Sem mesa" }));''',
    '''    await user.click(await screen.findByRole("button", { name: "Começar novo atendimento" }));\n    await user.click(screen.getByRole("button", { name: "Sem mesa" }));''',
)

# Prova principal da mudança: nome só aparece na revisão e trava o envio.
replace_once(
    "src/app/salao/page.test.tsx",
    '''  it("enviar para cozinha mostra 'Enviando…' e depois a tela de sucesso com cliente/mesa/total", async () => {\n    const user = userEvent.setup();\n    await iniciarAtendimento(user);\n    await user.type(screen.getByPlaceholderText("Buscar produto…"), "Refrigerante");\n    await user.click(await screen.findByRole("button", { name: /Refrigerante 2L/ }));\n    await user.click(screen.getByRole("button", { name: "Revisar pedido" }));\n    await user.click(await screen.findByRole("button", { name: "Enviar para cozinha" }));''',
    '''  it("nome aparece só no final, é obrigatório e depois o pedido é enviado normalmente", async () => {\n    const user = userEvent.setup();\n    await iniciarAtendimento(user);\n    expect(screen.queryByLabelText("Nome do cliente")).not.toBeInTheDocument();\n    await user.type(screen.getByPlaceholderText("Buscar produto…"), "Refrigerante");\n    await user.click(await screen.findByRole("button", { name: /Refrigerante 2L/ }));\n    await user.click(screen.getByRole("button", { name: "Revisar pedido" }));\n\n    const enviar = await screen.findByRole("button", { name: "Enviar para cozinha" });\n    const nome = screen.getByLabelText("Nome do cliente");\n    expect(nome).toBeInTheDocument();\n    expect(enviar).toBeDisabled();\n    await user.type(nome, "Ana");\n    expect(enviar).toBeEnabled();\n    await user.click(enviar);''',
)
replace_once(
    "src/app/salao/page.test.tsx",
    '''    await user.click(screen.getByRole("button", { name: "Revisar pedido" }));\n\n    falharProximoEnvio = true;\n    await user.click(await screen.findByRole("button", { name: "Enviar para cozinha" }));''',
    '''    await user.click(screen.getByRole("button", { name: "Revisar pedido" }));\n    await user.type(await screen.findByLabelText("Nome do cliente"), "Ana");\n\n    falharProximoEnvio = true;\n    await user.click(await screen.findByRole("button", { name: "Enviar para cozinha" }));''',
)

# ---------------------------------------------------------------------------
# CI: inclui os novos contratos e o gate server-side do envio.
# ---------------------------------------------------------------------------
replace_once(
    ".github/workflows/salao-operacional-ci.yml",
    '''          src/app/api/salao/comandas/route.test.ts\n          src/app/salao/page.test.tsx''',
    '''          src/app/api/salao/comandas/route.test.ts\n          src/app/api/salao/comandas/[id]/cliente/route.test.ts\n          src/app/api/salao/comandas/[id]/enviar/route.test.ts\n          src/app/salao/page.test.tsx''',
)
replace_once(
    ".github/workflows/salao-operacional-ci.yml",
    '''          src/app/api/salao/comandas/[id]/route.ts\n          src/app/api/salao/comandas/[id]/enviar/route.ts''',
    '''          src/app/api/salao/comandas/[id]/route.ts\n          src/app/api/salao/comandas/[id]/cliente/route.ts\n          src/app/api/salao/comandas/[id]/cliente/route.test.ts\n          src/app/api/salao/comandas/[id]/enviar/route.ts\n          src/app/api/salao/comandas/[id]/enviar/route.test.ts''',
)

print("Patch do nome no final aplicado com sucesso.")
