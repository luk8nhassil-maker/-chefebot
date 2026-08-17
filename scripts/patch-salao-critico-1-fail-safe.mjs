import fs from "node:fs";

function substituirUnico(texto, antigo, novo, rotulo) {
  const primeiro = texto.indexOf(antigo);
  if (primeiro < 0) throw new Error(`Trecho não encontrado: ${rotulo}`);
  if (texto.indexOf(antigo, primeiro + antigo.length) >= 0) throw new Error(`Trecho duplicado: ${rotulo}`);
  return texto.slice(0, primeiro) + novo + texto.slice(primeiro + antigo.length);
}

const paginaPath = "src/app/salao/page.tsx";
let pagina = fs.readFileSync(paginaPath, "utf8");

pagina = substituirUnico(
  pagina,
  `  const carregarComandas = useCallback(async (): Promise<Comanda[] | null> => {
    const r = await fetch("/api/salao/comandas", { cache: "no-store" })
    if (r.status === 401) { setNaoAutorizado(true); return null }
    const data = await r.json().catch(() => null)
    if (data?.ok) { setComandas(data.comandas); return data.comandas as Comanda[] }
    return null
  }, [])

  const carregarTudo = useCallback(async () => {
    try {
      const [rCardapio] = await Promise.all([fetch("/api/cardapio", { cache: "no-store" }), carregarComandas()])
      setErroCarregar(false)
      if (rCardapio.ok) {
        const validado = adaptarCardapioParaMontagem(await rCardapio.json())
        if (validado) setMenu(validado)
      }
    } catch {
      setErroCarregar(true)
    } finally {
      setCarregando(false)
    }
  }, [carregarComandas])
`,
  `  const marcarStatusOperacionalComoPendente = useCallback(() => {
    // Se a atualização falha, mantemos comanda/itens/total na tela, mas nunca
    // deixamos um status antigo parecer atual. Só o estágio operacional do
    // pedido oficial é invalidado; preço, carrinho e bookkeeping não mudam.
    setComandas((atuais) => atuais.map((comanda) => ({
      ...comanda,
      rodadas: comanda.rodadas?.map((rodada) => rodada.status === "enviada"
        ? { ...rodada, pedidoStatus: undefined, pedidoStatusAtualizadoEm: undefined }
        : rodada),
    })))
  }, [])

  const carregarComandas = useCallback(async (): Promise<Comanda[] | null> => {
    try {
      const r = await fetch("/api/salao/comandas", { cache: "no-store" })
      if (r.status === 401) { setNaoAutorizado(true); return null }
      const data = await r.json().catch(() => null)
      if (r.ok && data?.ok && Array.isArray(data.comandas)) {
        setComandas(data.comandas)
        return data.comandas as Comanda[]
      }
      marcarStatusOperacionalComoPendente()
      return null
    } catch {
      marcarStatusOperacionalComoPendente()
      return null
    }
  }, [marcarStatusOperacionalComoPendente])

  const carregarTudo = useCallback(async () => {
    try {
      const [rCardapio, listaComandas] = await Promise.all([fetch("/api/cardapio", { cache: "no-store" }), carregarComandas()])
      if (!rCardapio.ok || !listaComandas) {
        setErroCarregar(true)
        return
      }
      const validado = adaptarCardapioParaMontagem(await rCardapio.json())
      if (!validado) {
        setErroCarregar(true)
        return
      }
      setMenu(validado)
      setErroCarregar(false)
    } catch {
      setErroCarregar(true)
    } finally {
      setCarregando(false)
    }
  }, [carregarComandas])
`,
  "falha fechada da sincronização operacional",
)

fs.writeFileSync(paginaPath, pagina)

const testePath = "src/app/salao/page.test.tsx"
let teste = fs.readFileSync(testePath, "utf8")

teste = substituirUnico(
  teste,
  `let falharProximoEnvio = false;
let enviosCriados = 0;

function resetMock() {
  seq = 0;
  comandas = [];
  falharProximoEnvio = false;
  enviosCriados = 0;
}
`,
  `let falharProximoEnvio = false;
let falharProximaListagem = false;
let enviosCriados = 0;

function resetMock() {
  seq = 0;
  comandas = [];
  falharProximoEnvio = false;
  falharProximaListagem = false;
  enviosCriados = 0;
}
`,
  "controle de falha da listagem",
)

teste = substituirUnico(
  teste,
  `  if (url === "/api/salao/comandas" && method === "GET") {
    return jsonRes(200, { ok: true, comandas: comandas.map((c) => ({ ...c, totalParcial: totalParcialDe(c) })) });
  }
`,
  `  if (url === "/api/salao/comandas" && method === "GET") {
    if (falharProximaListagem) {
      falharProximaListagem = false;
      return jsonRes(503, { ok: false, error: "Falha simulada de sincronização" });
    }
    return jsonRes(200, { ok: true, comandas: comandas.map((c) => ({ ...c, totalParcial: totalParcialDe(c) })) });
  }
`,
  "mock de falha de listagem",
)

const marcador = `  it("não mente quando a rodada enviada ainda não conseguiu sincronizar com o pedido oficial", async () => {`
const novosTestes = `  it("se uma atualização falha, invalida o status antigo em vez de continuar mostrando informação velha como atual", async () => {
    const user = userEvent.setup();
    comandas.push({
      id: "c-stale", numero: 24, cliente: "Marta", mesa: "6", itens: [{ kind: "simple", name: "Água com gás", price: 6, qty: 1 }],
      status: "enviada", abertaEm: new Date().toISOString(), pedidoId: "ped-stale", pedidoNumero: 24,
      rodadas: [{
        id: "r-stale", numero: 1, status: "enviada", itens: [{ kind: "simple", name: "Água com gás", price: 6, qty: 1 }], subtotal: 6,
        criadaEm: new Date().toISOString(), atualizadaEm: new Date().toISOString(), enviadaEm: new Date().toISOString(), pedidoId: "ped-stale", pedidoNumero: 24,
        pedidoStatus: "saiu_entrega",
      }],
    });

    render(<SalaoPage />);
    await screen.findByText("Novo atendimento");
    await user.click(screen.getByRole("button", { name: /Pedidos abertos/ }));
    expect(await screen.findByText("Pronto para servir")).toBeInTheDocument();

    falharProximaListagem = true;
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(screen.getByText("Atualização pendente")).toBeInTheDocument());
    expect(screen.queryByText("Pronto para servir")).not.toBeInTheDocument();
  });

  it("em uma comanda com vários envios, o pedido pronto sobe como ação mais urgente", async () => {
    const user = userEvent.setup();
    const agora = new Date().toISOString();
    comandas.push({
      id: "c-multi", numero: 25, cliente: "Nina", mesa: "7", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }],
      status: "enviada", abertaEm: agora, pedidoId: "ped-multi-1", pedidoNumero: 25,
      rodadas: [
        { id: "r-multi-1", numero: 1, status: "enviada", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }], subtotal: 12, criadaEm: agora, atualizadaEm: agora, enviadaEm: agora, pedidoId: "ped-multi-1", pedidoNumero: 25, pedidoStatus: "em_preparo" },
        { id: "r-multi-2", numero: 2, status: "enviada", itens: [{ kind: "simple", name: "Água com gás", price: 6, qty: 1 }], subtotal: 6, criadaEm: agora, atualizadaEm: agora, enviadaEm: agora, pedidoId: "ped-multi-2", pedidoNumero: 26, pedidoStatus: "saiu_entrega" },
      ],
    });

    render(<SalaoPage />);
    await screen.findByText("Novo atendimento");
    await user.click(screen.getByRole("button", { name: /Pedidos abertos/ }));

    expect(await screen.findByText("Pronto para servir")).toBeInTheDocument();
    expect(screen.getByText(/Retire o pedido na cozinha e leve até a mesa/)).toBeInTheDocument();
  });

`
if (!teste.includes(marcador)) throw new Error("Marcador de testes não encontrado")
teste = teste.replace(marcador, novosTestes + marcador)
fs.writeFileSync(testePath, teste)
