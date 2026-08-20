import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Sem jsdom/testing-library neste repo para telas grandes com efeitos de
// browser (cookies, Notification, wake lock, push) — ver admin/page.test.ts
// e cliente/page.test.ts para o mesmo padrão. Os requisitos da
// auto-verificação de Pix Mercado Pago (Nível 6.3B/6.4) ficam garantidos
// estruturalmente na fonte, sem precisar montar a árvore inteira.
const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

// Corpo do useEffect de auto-verificação, isolado para os testes de cadência.
const inicioEfeitoMarcador = "useEffect(() => {\n    if (!isAdmin || loading) return";
const corpoEfeito = fonte.slice(
  fonte.indexOf(inicioEfeitoMarcador),
  fonte.indexOf("}, [isAdmin, loading])") + "}, [isAdmin, loading])".length
);

describe("/pedidos — 'Novo pedido' tem um único fluxo seguro (sem modal legado)", () => {
  test("não existe mais o modal de criação livre que confiava no total digitado pelo atendente", () => {
    // Esse modal antigo postava direto em POST /api/orders com `total` vindo
    // do campo de texto do atendente (preço como autoridade no frontend) e
    // sem clientRequestId — exatamente a fragilidade que o pedido manual em
    // 5 etapas (NovoPedidoManual.tsx) veio substituir. Ele não pode voltar a
    // existir como um segundo caminho paralelo para "Novo pedido".
    expect(fonte).not.toContain("modalNovoPedido");
    expect(fonte).not.toContain("salvarNovoPedido");
    expect(fonte).not.toContain("novoPedidoForm");
  });

  test("os dois botões de 'Novo pedido' do painel abrem o mesmo fluxo em etapas", () => {
    expect(fonte).toContain("onClick={abrirNovoPedido}");
    const ocorrencias = [...fonte.matchAll(/onClick=\{abrirNovoPedido\}/g)];
    expect(ocorrencias.length).toBe(2);
    expect(fonte).toContain("<NovoPedidoManual");
  });
});

describe("/pedidos — botão manual de verificação Pix Mercado Pago (preservado)", () => {
  test("botão manual continua renderizado, visível só para admin/dev, chamando reconciliarPixMercadoPago", () => {
    expect(fonte).toMatch(/\{isAdmin && <button onClick=\{reconciliarPixMercadoPago\}/);
    expect(fonte).toContain("Verificar pagamentos Pix Mercado Pago");
  });

  test("clique manual delega para executarReconciliacaoPix(true) — mesma função interna da auto-verificação", () => {
    expect(fonte).toContain("const reconciliarPixMercadoPago = () => executarReconciliacaoPix(true)");
  });

  test("clique manual continua mostrando o resumo em alert", () => {
    const corpo = fonte.slice(
      fonte.indexOf("const executarReconciliacaoPix = async"),
      fonte.indexOf("const reconciliarPixMercadoPago =")
    );
    expect(corpo).toMatch(/if \(manual\) alert\(`Pix Mercado Pago verificado:\\n\$\{resumo\}`\)/);
  });
});

describe("/pedidos — auto-verificação de Pix Mercado Pago (Nível 6.3B/6.4)", () => {
  test("dispara a mesma rota já validada (POST /api/admin/mercadopago/reconciliar-pix)", () => {
    const ocorrencias = fonte.match(/fetch\("\/api\/admin\/mercadopago\/reconciliar-pix", \{ method: "POST" \}\)/g) ?? [];
    // uma única chamada de fetch compartilhada entre manual e automática
    expect(ocorrencias.length).toBe(1);
  });

  test("useEffect de auto-verificação só roda para admin/dev e depois do painel carregar", () => {
    expect(fonte.indexOf(inicioEfeitoMarcador)).toBeGreaterThan(-1);
  });

  test("dispara a verificação automaticamente ao montar (uma vez), via rodar()", () => {
    expect(corpoEfeito).toContain("rodar()");
  });

  test("pausa quando a aba está oculta (document.hidden), mas continua reagendando o próximo ciclo", () => {
    expect(corpoEfeito).toContain("if (!document.hidden) {");
    expect(corpoEfeito).toContain("await executarReconciliacaoPix(false)");
    expect(corpoEfeito).toContain("agendarProxima()");
  });

  test("auto-verificação chama executarReconciliacaoPix(false) — nunca (true), nunca dispara alert direto", () => {
    expect(corpoEfeito).toContain("executarReconciliacaoPix(false)");
    expect(corpoEfeito).not.toContain("executarReconciliacaoPix(true)");
    expect(corpoEfeito).not.toContain("alert(");
  });

  test("alert só é chamado dentro de blocos condicionados a `manual`, nunca incondicionalmente", () => {
    const corpo = fonte.slice(
      fonte.indexOf("const executarReconciliacaoPix = async"),
      fonte.indexOf("const reconciliarPixMercadoPago =")
    );
    const linhas = corpo.split("\n");
    const indicesComAlert = linhas.reduce<number[]>((acc, l, i) => (l.includes("alert(") ? [...acc, i] : acc), []);
    expect(indicesComAlert.length).toBeGreaterThan(0);
    for (const i of indicesComAlert) {
      // "manual" aparece na própria linha (alert de uma linha) ou na guarda
      // imediatamente acima (if (manual) {\n  alert(...) — várias linhas).
      const janela = linhas.slice(Math.max(0, i - 1), i + 1).join("\n");
      expect(janela).toMatch(/manual/);
    }
  });
});

describe("/pedidos — cadência adaptativa da auto-verificação (Guardião Pix)", () => {
  test("importa a cadência de pixAutoCheckConfig.ts — nenhuma constante mágica local de intervalo", () => {
    expect(fonte).toMatch(/from ["']@\/lib\/pixAutoCheckConfig["']/);
    expect(fonte).toContain("calcularIntervaloPorIdade");
    expect(fonte).toContain("aplicarJitter");
    expect(fonte).not.toContain("const INTERVALO_PIX_RAPIDO");
    expect(fonte).not.toContain("const INTERVALO_PIX_LENTO");
  });

  test("agenda o próximo ciclo usando calcularProximoIntervaloAutoVerificacaoPix (não um valor fixo)", () => {
    const chamadasSetTimeout = fonte.match(/setTimeout\(rodar,\s*([^)]+)\)/g) ?? [];
    expect(chamadasSetTimeout.length).toBeGreaterThan(0);
    for (const chamada of chamadasSetTimeout) {
      expect(chamada).toContain("intervalo");
    }
    expect(corpoEfeito).toContain("const intervalo = calcularProximoIntervaloAutoVerificacaoPix(pedidosRef.current, Date.now())");
  });

  test("sem nenhum Pix Mercado Pago pendente, usa PIX_AUTO_CHECK_INTERVAL_SEM_PENDENTE_MS", () => {
    const corpoFuncao = fonte.slice(
      fonte.indexOf("function calcularProximoIntervaloAutoVerificacaoPix"),
      fonte.indexOf("function calcularProximoIntervaloAutoVerificacaoPix") + 700
    );
    expect(corpoFuncao).toContain("if (pendentes.length === 0) return PIX_AUTO_CHECK_INTERVAL_SEM_PENDENTE_MS");
  });

  test("com Pix Mercado Pago pendente, usa o intervalo do mais urgente (calcularIntervaloPorIdade) com jitter", () => {
    const corpoFuncao = fonte.slice(
      fonte.indexOf("function calcularProximoIntervaloAutoVerificacaoPix"),
      fonte.indexOf("function calcularProximoIntervaloAutoVerificacaoPix") + 700
    );
    expect(corpoFuncao).toContain("calcularIntervaloPorIdade(");
    expect(corpoFuncao).toContain("aplicarJitter(Math.min(...intervalos))");
  });

  test("temPixMercadoPagoPendente usa o mesmo critério de elegibilidade do backend (provider mercadopago + providerPaymentId + não confirmado)", () => {
    const corpoFuncao = fonte.slice(
      fonte.indexOf("function temPixMercadoPagoPendente"),
      fonte.indexOf("function getActionLabel")
    );
    expect(corpoFuncao).toContain('p.pix?.provider === "mercadopago"');
    expect(corpoFuncao).toContain("!!p.pix?.providerPaymentId");
    expect(corpoFuncao).toContain('p.pix?.status !== "confirmado"');
    expect(corpoFuncao).toContain("p.pixConfirmado !== true");
  });

  test("temPixMercadoPagoPendente é uma leitura pura — nunca escreve pix.status/pixConfirmado nem chama fetch", () => {
    const corpoFuncao = fonte.slice(
      fonte.indexOf("function temPixMercadoPagoPendente"),
      fonte.indexOf("function getActionLabel")
    );
    expect(corpoFuncao).not.toContain("fetch(");
    expect(corpoFuncao).not.toMatch(/pixConfirmado\s*=/);
  });

  test("pedidosRef é mantido sincronizado com o state `pedidos` (lista sempre atual, sem recriar o loop a cada mudança)", () => {
    expect(fonte).toContain("const pedidosRef = useRef<Pedido[]>([])");
    expect(fonte).toContain("useEffect(() => { pedidosRef.current = pedidos }, [pedidos])");
  });

  test("o loop se reagenda sozinho (setTimeout recursivo via agendarProxima), não usa setInterval fixo", () => {
    expect(corpoEfeito).not.toContain("setInterval(");
    expect(corpoEfeito).toContain("setTimeout(rodar, intervalo)");
  });

  test("cancela o agendamento pendente ao desmontar/reavaliar (sem vazar timers)", () => {
    expect(corpoEfeito).toContain("cancelado = true");
    expect(corpoEfeito).toContain("if (timeoutId) clearTimeout(timeoutId)");
  });
});

describe("/pedidos — reentrância e resiliência da verificação de Pix Mercado Pago", () => {
  test("não roda uma verificação se outra já está em andamento (guard por ref, compartilhado manual/automático)", () => {
    const corpo = fonte.slice(
      fonte.indexOf("const executarReconciliacaoPix = async"),
      fonte.indexOf("const reconciliarPixMercadoPago =")
    );
    expect(corpo).toMatch(/if \(reconciliandoPixRef\.current\) return/);
    expect(corpo).toContain("reconciliandoPixRef.current = true");
    expect(corpo).toContain("reconciliandoPixRef.current = false");
  });

  test("guard usa useRef (não só state), para não ter condição de corrida entre closures do interval", () => {
    expect(fonte).toContain("const reconciliandoPixRef = useRef(false)");
  });

  test("quando confirmados > 0, recarrega a lista de pedidos (carregarPedidos)", () => {
    const corpo = fonte.slice(
      fonte.indexOf("const executarReconciliacaoPix = async"),
      fonte.indexOf("const reconciliarPixMercadoPago =")
    );
    expect(corpo).toContain('if (typeof data.confirmados === "number" && data.confirmados > 0) carregarPedidos()');
  });

  test("falha de rede ou resposta não-ok nunca lança exceção não tratada (try/catch envolve o fetch)", () => {
    const corpo = fonte.slice(
      fonte.indexOf("const executarReconciliacaoPix = async"),
      fonte.indexOf("const reconciliarPixMercadoPago =")
    );
    expect(corpo).toMatch(/try \{[\s\S]*fetch\("\/api\/admin\/mercadopago\/reconciliar-pix"[\s\S]*\} catch \{/);
  });

  test("erro de rede na auto-verificação não propaga alert (só quando manual)", () => {
    const corpo = fonte.slice(
      fonte.indexOf("const executarReconciliacaoPix = async"),
      fonte.indexOf("const reconciliarPixMercadoPago =")
    );
    const blocoCatch = corpo.slice(corpo.lastIndexOf("} catch {"));
    expect(blocoCatch).toContain("if (manual) alert(");
  });
});

describe("/pedidos — segurança: nenhuma confirmação acontece no frontend", () => {
  test("frontend só chama a rota protegida; não escreve pix.status/pixConfirmado diretamente a partir da verificação", () => {
    const corpo = fonte.slice(
      fonte.indexOf("const executarReconciliacaoPix = async"),
      fonte.indexOf("const reconciliarPixMercadoPago =")
    );
    expect(corpo).not.toMatch(/pixConfirmado:\s*true/);
    expect(corpo).not.toMatch(/status:\s*["']confirmado["']/);
  });

  test("não importa/altera src/lib/mercadoPagoReconciliacao.ts nem o serializador/gerador de Pix (patch fica só na tela)", () => {
    expect(fonte).not.toMatch(/from ["']@\/lib\/mercadoPagoReconciliacao["']/);
    expect(fonte).not.toContain("pixCopiaECola");
    expect(fonte).not.toContain("serializarPixCliente");
  });
});


describe("/pedidos — cronômetro individual da etapa NA RUA", () => {
  test("o timer da rua usa a hora oficial da etapa e o limite de 20 minutos", () => {
    expect(fonte).toContain('pedido.status === "saiu_entrega" ? idadeDaEtapaMinutos(pedido, now) : 0');
    expect(fonte).toContain('p.status === "saiu_entrega" ? LIMIAR_ENTREGA_MIN : 40');
    expect(fonte).toContain('p.status === "saiu_entrega" ? `Na rua há ${mins} min`');
  });

  test("o clique que muda de etapa zera o relógio otimista imediatamente e rollback restaura o carimbo anterior", () => {
    const corpo = fonte.slice(
      fonte.indexOf("const avancarStatus = async"),
      fonte.indexOf("// Resolução de uma pendência do gate")
    );
    expect(corpo).toContain("const statusAtualizadoEmAnterior = pedido.statusAtualizadoEm");
    expect(corpo).toContain("const statusAtualizadoEmOtimista = new Date().toISOString()");
    expect(corpo).toContain("statusAtualizadoEm: statusAtualizadoEmOtimista");
    expect(corpo).toContain("statusAtualizadoEm: statusAtualizadoEmAnterior");
  });
});

describe("/pedidos — item 'Acesso do salão' no menu lateral (Equipe)", () => {
  test("liga showEquipeNav no PanelShell — mostra só 'Equipe', sem trazer o grupo Gestão inteiro", () => {
    const blocoPanelShell = fonte.slice(fonte.indexOf("<PanelShell"), fonte.indexOf("<PanelShell") + 400);
    expect(blocoPanelShell).toContain("showEquipeNav");
    expect(blocoPanelShell).not.toContain("showGestaoNav");
  });
});

describe("/pedidos — comanda do Salão como uma unidade operacional visual", () => {
  test("renderiza um único CTA operacional no rodapé da comanda", () => {
    expect(fonte).toContain("selecionarProximaAcaoFamilia")
    expect(fonte).toContain("!familiaSalao && <div onClick={e => e.stopPropagation()}>")
    expect(fonte).toContain("ultimaDaFamilia && familiaSalao && alvoAcaoFamilia && alvoScFamilia")
  })

  test("o CTA unificado avança somente a rodada-alvo, nunca a família em lote", () => {
    expect(fonte).toContain("avancarStatus(alvoAcaoFamilia.id, alvoNextStatusFamilia)")
    expect(fonte).not.toContain("familiaSalao.forEach(avancarStatus")
    expect(fonte).not.toContain("Promise.all(familiaSalao")
  })

  test("mantém status, valor, itens e tempo próprios em cada rodada", () => {
    expect(fonte).toContain("pedido.rodadaNumero === 1 ? \"Pedido inicial\"")
    expect(fonte).toContain("R${pedido.total.toFixed(2).replace(\".\", \",\")}")
    expect(fonte).toContain("{timerMins}m")
  })
})
