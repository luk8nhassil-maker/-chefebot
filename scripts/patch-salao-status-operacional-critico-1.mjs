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
  'import { gerarClientRequestId } from "@/survival/clientRequestId"\n',
  'import { gerarClientRequestId } from "@/survival/clientRequestId"\nimport { descreverStatusPedidoSalao, prioridadeStatusPedidoSalao, type StatusPedidoSalao } from "@/lib/salaoOperacao"\n',
  "import salaoOperacao",
);

pagina = substituirUnico(
  pagina,
  '  pedidoNumero?: number\n  erroUltimaTentativa?: string\n',
  '  pedidoNumero?: number\n  pedidoStatus?: StatusPedidoSalao\n  pedidoStatusAtualizadoEm?: string\n  erroUltimaTentativa?: string\n',
  "campos de status oficial da rodada",
);

const blocoEstadoAntigo = `function estadoHumano(comanda: Comanda): string {
  const ativa = rodadaAtiva(comanda)
  if (!ativa) return "Aguardando cozinha"
  if (ativa.status === "falha_envio") return "Falha ao enviar"
  if (ativa.status === "enviando") return "Enviando para cozinha"
  if (ativa.itens.length > 0) return "Montando novo pedido"
  return "Em atendimento"
}

/** Prioridade de ordenação da lista de Pedidos abertos: 1) falha que precisa
 *  de ação; 2) rascunho em andamento; 3) mais antigas primeiro. */
function prioridadeOrdenacao(comanda: Comanda): number {
  const ativa = rodadaAtiva(comanda)
  if (ativa?.status === "falha_envio") return 0
  if (ativa && (ativa.status === "rascunho" || ativa.status === "enviando") && ativa.itens.length > 0) return 1
  return 2
}
`;

const blocoEstadoNovo = `function rodadaEnviadaMaisUrgente(comanda: Comanda): Rodada | undefined {
  return comanda.rodadas
    ?.filter((rodada) => rodada.status === "enviada")
    .slice()
    .sort((a, b) => prioridadeStatusPedidoSalao(a.pedidoStatus) - prioridadeStatusPedidoSalao(b.pedidoStatus))[0]
}

function estadoHumano(comanda: Comanda): string {
  const ativa = rodadaAtiva(comanda)
  if (ativa?.status === "falha_envio") return "Falha ao enviar"
  if (ativa?.status === "enviando") return "Enviando para cozinha"
  if (ativa?.status === "rascunho" && ativa.itens.length > 0) return "Montando novo pedido"
  const enviadaUrgente = rodadaEnviadaMaisUrgente(comanda)
  if (enviadaUrgente) return descreverStatusPedidoSalao(enviadaUrgente.pedidoStatus).rotulo
  return "Em atendimento"
}

function orientacaoHumana(comanda: Comanda): string | null {
  const enviadaUrgente = rodadaEnviadaMaisUrgente(comanda)
  return enviadaUrgente ? descreverStatusPedidoSalao(enviadaUrgente.pedidoStatus).orientacao : null
}

/** Prioriza primeiro falhas locais de envio e depois a situação REAL da
 * cozinha. Pedido pronto/cancelado/sincronização pendente sobe acima de
 * pedidos que só estão aguardando ou em preparo. */
function prioridadeOrdenacao(comanda: Comanda): number {
  const ativa = rodadaAtiva(comanda)
  if (ativa?.status === "falha_envio") return 0
  const enviadaUrgente = rodadaEnviadaMaisUrgente(comanda)
  if (enviadaUrgente) return 1 + prioridadeStatusPedidoSalao(enviadaUrgente.pedidoStatus)
  if (ativa && (ativa.status === "rascunho" || ativa.status === "enviando") && ativa.itens.length > 0) return 4
  return 8
}
`;
pagina = substituirUnico(pagina, blocoEstadoAntigo, blocoEstadoNovo, "estado operacional da comanda");

const efeitoInicial = `  useEffect(() => {
    (async () => { await carregarTudo() })()
  }, [carregarTudo])
`;
const efeitoComPolling = `${efeitoInicial}
  // O status da cozinha muda em outro aparelho. Sem atualização periódica o
  // garçom continuava vendo "Aguardando cozinha" até recarregar a página.
  // A leitura é silenciosa, não dispara impressão, WhatsApp nem mutação.
  useEffect(() => {
    const atualizar = () => { void carregarComandas() }
    const intervalo = window.setInterval(atualizar, 4000)
    window.addEventListener("focus", atualizar)
    return () => {
      window.clearInterval(intervalo)
      window.removeEventListener("focus", atualizar)
    }
  }, [carregarComandas])
`;
pagina = substituirUnico(pagina, efeitoInicial, efeitoComPolling, "polling seguro do salão");

pagina = substituirUnico(
  pagina,
  `function ComandaCard({ comanda, onAbrir }: { comanda: Comanda; onAbrir: () => void }) {
  const estado = estadoHumano(comanda)
  const envios = comanda.rodadas?.filter((r) => r.status === "enviada").length ?? 0
  const corEstado = estado === "Falha ao enviar" ? "var(--danger)" : estado === "Aguardando cozinha" ? "var(--success)" : "var(--attention-text)"
`,
  `function ComandaCard({ comanda, onAbrir }: { comanda: Comanda; onAbrir: () => void }) {
  const estado = estadoHumano(comanda)
  const orientacao = orientacaoHumana(comanda)
  const envios = comanda.rodadas?.filter((r) => r.status === "enviada").length ?? 0
  const corEstado = estado === "Falha ao enviar" || estado === "Pedido cancelado"
    ? "var(--danger)"
    : estado === "Servido"
      ? "var(--success)"
      : estado === "Pronto para servir" || estado === "Atualização pendente"
        ? "var(--attention-text)"
        : "var(--foreground-secondary)"
`,
  "resumo do card da comanda",
);

pagina = substituirUnico(
  pagina,
  `      <span style={{ fontSize: 12.5, color: "var(--foreground-secondary)" }}>
        {identificacaoMesa(comanda)} · Comanda #{comanda.numero} · {tempoDecorrido(comanda.abertaEm)}
      </span>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 800 }}>
`,
  `      <span style={{ fontSize: 12.5, color: "var(--foreground-secondary)" }}>
        {identificacaoMesa(comanda)} · Comanda #{comanda.numero} · {tempoDecorrido(comanda.abertaEm)}
      </span>
      {orientacao && (
        <span style={{ fontSize: 12.5, lineHeight: 1.4, color: "var(--foreground)", padding: "8px 10px", borderRadius: 9, background: "var(--background)" }}>
          <strong>O que fazer agora:</strong> {orientacao}
        </span>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 800 }}>
`,
  "orientação no card",
);

pagina = substituirUnico(
  pagina,
  `          const aberta2 = expandidas.has(r.id)
          const humano = r.status === "enviada" ? "Enviado" : r.status === "enviando" ? "Enviando…" : r.status === "falha_envio" ? "Falha ao enviar" : "Em rascunho"
          const horario = r.enviadaEm ? new Date(r.enviadaEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : null
`,
  `          const aberta2 = expandidas.has(r.id)
          const estadoPedido = r.status === "enviada" ? descreverStatusPedidoSalao(r.pedidoStatus) : null
          const humano = estadoPedido?.rotulo ?? (r.status === "enviando" ? "Enviando…" : r.status === "falha_envio" ? "Falha ao enviar" : "Em rascunho")
          const corHumano = r.status === "falha_envio" || estadoPedido?.tom === "perigo"
            ? "var(--danger)"
            : estadoPedido?.tom === "sucesso"
              ? "var(--success)"
              : estadoPedido?.tom === "atencao"
                ? "var(--attention-text)"
                : "var(--foreground-secondary)"
          const horario = r.enviadaEm ? new Date(r.enviadaEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : null
`,
  "estado por rodada no detalhe",
);

pagina = substituirUnico(
  pagina,
  `                  <span style={{ fontSize: 11, fontWeight: 800, color: r.status === "falha_envio" ? "var(--danger)" : r.status === "enviada" ? "var(--success)" : "var(--attention-text)", textTransform: "uppercase" }}>{humano}</span>
`,
  `                  <span style={{ fontSize: 11, fontWeight: 800, color: corHumano, textTransform: "uppercase" }}>{humano}</span>
`,
  "cor do status da rodada",
);

pagina = substituirUnico(
  pagina,
  `              </button>
              {aberta2 && (
                <div style={{ display: "grid", gap: 6 }}>
`,
  `              </button>
              {estadoPedido && (
                <div style={{ padding: "8px 10px", borderRadius: 9, background: "var(--background)", display: "grid", gap: 2 }}>
                  <strong style={{ fontSize: 11.5, color: corHumano }}>O que fazer agora</strong>
                  <span style={{ fontSize: 12.5, lineHeight: 1.4, color: "var(--foreground-secondary)" }}>{estadoPedido.orientacao}</span>
                </div>
              )}
              {aberta2 && (
                <div style={{ display: "grid", gap: 6 }}>
`,
  "orientação por rodada",
);

fs.writeFileSync(paginaPath, pagina);

const testePath = "src/app/salao/page.test.tsx";
let teste = fs.readFileSync(testePath, "utf8");

teste = substituirUnico(
  teste,
  '  enviadaEm?: string; pedidoId?: string; pedidoNumero?: number; erroUltimaTentativa?: string;\n',
  '  enviadaEm?: string; pedidoId?: string; pedidoNumero?: number; pedidoStatus?: "novo" | "em_preparo" | "saiu_entrega" | "entregue" | "cancelado"; pedidoStatusAtualizadoEm?: string; erroUltimaTentativa?: string;\n',
  "tipo RodadaMock",
);

const testesNovos = `

describe("/salao — acompanhamento operacional da cozinha", () => {
  it("mostra o estado real e uma orientação objetiva quando o pedido fica pronto", async () => {
    const user = userEvent.setup();
    comandas.push({
      id: "c-pronto", numero: 21, cliente: "Joana", mesa: "3", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }],
      status: "enviada", abertaEm: new Date().toISOString(), pedidoId: "ped-pronto", pedidoNumero: 21,
      rodadas: [{
        id: "r-pronto", numero: 1, status: "enviada", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }], subtotal: 12,
        criadaEm: new Date().toISOString(), atualizadaEm: new Date().toISOString(), enviadaEm: new Date().toISOString(), pedidoId: "ped-pronto", pedidoNumero: 21,
        pedidoStatus: "saiu_entrega",
      }],
    });

    render(<SalaoPage />);
    await screen.findByText("Novo atendimento");
    await user.click(screen.getByRole("button", { name: /Pedidos abertos/ }));

    expect(await screen.findByText("Pronto para servir")).toBeInTheDocument();
    expect(screen.getByText(/Retire o pedido na cozinha e leve até a mesa/)).toBeInTheDocument();
  });

  it("atualiza o estágio quando o aparelho volta ao foco, sem exigir recarregar a página", async () => {
    const user = userEvent.setup();
    comandas.push({
      id: "c-foco", numero: 22, cliente: "Rita", mesa: "4", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }],
      status: "enviada", abertaEm: new Date().toISOString(), pedidoId: "ped-foco", pedidoNumero: 22,
      rodadas: [{
        id: "r-foco", numero: 1, status: "enviada", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }], subtotal: 12,
        criadaEm: new Date().toISOString(), atualizadaEm: new Date().toISOString(), enviadaEm: new Date().toISOString(), pedidoId: "ped-foco", pedidoNumero: 22,
        pedidoStatus: "em_preparo",
      }],
    });

    render(<SalaoPage />);
    await screen.findByText("Novo atendimento");
    await user.click(screen.getByRole("button", { name: /Pedidos abertos/ }));
    expect(await screen.findByText("Em preparo")).toBeInTheDocument();

    comandas[0].rodadas[0].pedidoStatus = "saiu_entrega";
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(screen.getByText("Pronto para servir")).toBeInTheDocument());
  });

  it("não mente quando a rodada enviada ainda não conseguiu sincronizar com o pedido oficial", async () => {
    const user = userEvent.setup();
    comandas.push({
      id: "c-sync", numero: 23, cliente: "Lia", mesa: "5", itens: [{ kind: "simple", name: "Água com gás", price: 6, qty: 1 }],
      status: "enviada", abertaEm: new Date().toISOString(), pedidoId: "ped-sync", pedidoNumero: 23,
      rodadas: [{
        id: "r-sync", numero: 1, status: "enviada", itens: [{ kind: "simple", name: "Água com gás", price: 6, qty: 1 }], subtotal: 6,
        criadaEm: new Date().toISOString(), atualizadaEm: new Date().toISOString(), enviadaEm: new Date().toISOString(), pedidoId: "ped-sync", pedidoNumero: 23,
      }],
    });

    render(<SalaoPage />);
    await screen.findByText("Novo atendimento");
    await user.click(screen.getByRole("button", { name: /Pedidos abertos/ }));

    expect(await screen.findByText("Atualização pendente")).toBeInTheDocument();
    expect(screen.getByText(/Atualize antes de tomar uma decisão sobre a mesa/)).toBeInTheDocument();
  });
});
`;

teste += testesNovos;
fs.writeFileSync(testePath, teste);
