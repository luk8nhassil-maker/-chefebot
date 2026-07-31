# Auditoria e proposta — Sistema de botões premium

**Status: proposta em revisão. Nenhum botão de produção foi migrado nesta rodada.**
Branch `claude/design-system-botoes-premium`, a partir de `565c703` (HEAD do PR #255).

Ver também: showcase visual (artifact) com todas as variantes/estados/temas e a
simulação da tela `/pedidos`; tokens em `src/app/globals.css` (seção
`--cb-button-*`); componentes `src/components/ui/Button.tsx` e `Chip.tsx`.

---

## 0. Achado crítico (prioridade máxima na migração)

A auditoria encontrou o **mesmo bug de contraste repetido dezenas de vezes**:
botões com fundo `var(--primary)` (amarelo `#FFCD00`) usando `color:
var(--background)` (quase branco) em vez do token correto `var(--primary-foreground)`
(navy). Resultado: contraste ≈ **1,4:1** — muito abaixo do mínimo AA (4,5:1) —
no texto de CTAs que são literalmente a ação mais usada de cada tela:

- `pedidos/page.tsx` — botão de avançar status do pedido (linha 1587/2329), `+ Novo pedido` (1755), `🧾 Pedido` (2036), `Finalizar pedido` (2682), `✅ Criar pedido` (2749), `Sim, arquivar entregues` (2416), `CONFIRMAR ... COMO RECEBIDO` (2645) — este último é a confirmação de recebimento de pagamento Pix, a ação financeira mais sensível do painel.
- `NovoPedidoManual.tsx` — indicador de etapa ativa (444), `Adicionar ao pedido`/`Continuar para X` (872/877), `Continuar para entrega` (900), `Continuar para pagamento`/`Criar pedido` (911/920).
- `LimpezaOperacionalPainel.tsx` — a ação principal (e único jeito de sair) do modal bloqueante de limpeza operacional (189).
- `TourGuiado.tsx` — passo "IMPORTANTE" do tour (gradiente danger→primary, metade vermelha com texto navy ≈3,2:1).
- `setup/page.tsx` — todos os "Continuar"/"Salvar e continuar" do wizard de onboarding.
- `sobre/page.tsx` — os dois CTAs de conversão do site institucional ("💬 Quero para minha pizzaria").

Um segundo padrão irmão, um pouco menos frequente: fundo `var(--danger)`/`var(--success)`
sólido com `color: var(--foreground)` em vez de `var(--on-danger)`/`var(--on-success)`
(contraste ≈3,1–3,2:1) — ex.: "🚨 Assumir conversa", "Sim, arquivar não resolvidos",
"Confirmar Entrega" no app do entregador.

**Recomendação:** independente do cronograma de migração visual completa, tratar
a correção `--background`→`--primary-foreground` (e o par danger/success
equivalente) como um fix de acessibilidade isolado e de baixo risco — é troca
de um token por outro, sem mudar layout, texto ou comportamento. Pode inclusive
ir antes da migração para o componente `Button`.

---

## 1. Taxonomia proposta

| Variante | Quando usar | Direção visual |
|---|---|---|
| **Primary** | Uma única ação dominante por tela/contexto | `--primary` (amarelo) + `--primary-foreground` (navy) — nunca texto claro |
| **Secondary** | Importante, não dominante | Fundo neutro (`--surface`), borda definida (`--border-strong`) |
| **Danger** | Destrutiva/crítica | Vermelho profundo + texto branco (nunca texto escuro sobre vermelho saturado) |
| **Danger · soft** | Destrutiva de risco menor/reversível | `--danger-surface` + `--danger-text` |
| **Success** | Ação positiva concluída | `--success` + `--on-success` |
| **Warning** | Exige atenção, não é destrutiva | `--attention` (**roxo** — nunca amarelo/laranja, que é a marca) |
| **Ghost** | Apoio, baixo destaque | Sem fundo forte, mas sempre reconhecível como ação (nunca texto solto) |
| **Icon** | Só ícone | Área mínima 40×40 (32 em `sm`), tooltip, `aria-label` obrigatório |
| **Toggle/Chip** | Seleção (categoria, filtro, sabor, pagamento) | Normal / hover / selecionado / desabilitado / esgotado — nunca só cor |

---

## 2. Tokens (`src/app/globals.css`)

Todos os tokens `--cb-button-*` e `--cb-chip-*` são **aliases** dos tokens
semânticos já existentes (`--primary`, `--danger`, `--attention`, etc.) — nenhuma
cor nova entrou no sistema. Valores de hover/active novos (danger/success/warning)
seguem a escala Tailwind red/green/violet 600→700→800, já usada como referência
em `--danger-text`/`--success-text`/`--attention-text`.

Também define: 3 alturas (`sm` 32 / `md` 40 / `lg` 48px — hoje o app varia de
26 a 58px sem critério), raio único (10px para botão, pill para chip), tipografia,
sombra, transição, opacidade de disabled/loading, e o par
`--cb-button-warning-*` mapeado para `--attention` (roxo), reforçando a regra
já existente do projeto: amarelo nunca é usado para warning/pendente.

## 3. Componente

`src/components/ui/Button.tsx` — `<Button variant size loading disabled icon
iconPosition fullWidth aria-label>`. `src/components/ui/Chip.tsx` —
`<Chip selected esgotado disabled>`. Nenhum arquivo de produção importa esses
componentes ainda; é só a especificação/implementação de referência para a
migração futura (fora do escopo desta rodada).

---

## 4. Auditoria completa por área

### 4.1 Painel operacional (`/pedidos`, `NovoPedidoManual`, `/conversas`, `/admin`, `PanelShell`, `NavBar`, `LimpezaOperacionalPainel`, `TourGuiado`, `ThemeToggle`)

**Achado sistêmico crítico:** botões `var(--primary)` + `color: var(--background)`
(contraste ≈1,4:1) e `var(--danger)`/`var(--success)` + `color: var(--foreground)`
(≈3,1–3,2:1) — ver seção 0.

| Arquivo | Tela | Texto/ícone | Finalidade | Cor de fundo atual | Cor de texto atual | Problema de contraste? | Tamanho aprox (px altura) | Estados implementados | Prioridade visual atual | Risco operacional | Variante recomendada |
|---|---|---|---|---|---|---|---|---|---|---|---|
| pedidos/page.tsx:1536 | Pedidos › Detalhe | "VERIFICAR PAGAMENTO" | Abrir modal de verificação manual de Pix | `var(--attention-text)` | `var(--background)` | Não (≈9:1) | 48 | sem loading dedicado | Alta | Baixo | WARNING |
| pedidos/page.tsx:1559 | Pedidos › Detalhe (pgto misto) | "VERIFICAR PAGAMENTO" (soft) | Mesma ação, pagamento híbrido | `var(--attention-surface)` | `var(--attention-text)` | Não | 46 | nenhum | Média | Baixo | WARNING |
| pedidos/page.tsx:1573 | Pedidos › Detalhe (dropdown) | Lista de status | Selecionar novo status manualmente | `transparent`/accentBg | `foreground-secondary`/accent | Não | 44 | disabled no status atual | Média | Médio (sem confirmação) | TOGGLE/CHIP |
| pedidos/page.tsx:1577 | Pedidos › Detalhe | "Cancelar" (fechar dropdown status) | Fechar seletor de status | transparent | `--foreground-muted` | Não | 44 | nenhum | Baixa (parece texto) | Baixo | GHOST |
| pedidos/page.tsx:1580 | Pedidos › Detalhe | "Alterar status" | Abrir seletor de status | transparent, borda `--surface-secondary` | `--foreground-secondary` | Não | 44 | nenhum | Média | Baixo | SECONDARY |
| pedidos/page.tsx:1587 / 2329 | Pedidos › Detalhe/Lista | Avançar status (ação mais usada) | Avançar status do pedido | `--primary`/`--info`/`--success` | **`--background`** | **Sim ⚠️** ≈1,4–3,1:1 | 58/30 | disabled+"...", opacity .6 | Muito alta | **Alto** | PRIMARY |
| pedidos/page.tsx:1600 | Pedidos › Detalhe | "Finalizar pedido" | Marcar entregue sem notificar | transparent | `--foreground-muted` | Não | 44 | nenhum | Baixa (parece link) | Médio | SUCCESS |
| pedidos/page.tsx:1607 | Pedidos › Detalhe | "Falar no WhatsApp" | Abrir WhatsApp externo | transparent, borda `--border` | `--foreground-secondary` | Não | 46 | nenhum | Média | Baixo | SECONDARY (usar `--whatsapp`) |
| pedidos/page.tsx:1615 | Pedidos › Detalhe | "Cancelar pedido" | Cancelar pedido | `color-mix(danger 6%)` | `--danger` | Não | 46 | disabled+"Cancelando..." | Média (deveria ser mais alta) | Alto | DANGER |
| pedidos/page.tsx:1622 | Pedidos › Detalhe | "🖨️ Imprimir pedido" | Reimprimir | transparent, borda overlay | `--foreground-secondary` | Não | 44 | nenhum | Baixa | Baixo | SECONDARY |
| pedidos/page.tsx:1627 | Pedidos › Detalhe | "Fechar" | Fechar painel de detalhe | transparent | `--foreground-secondary` | Não | 44 | nenhum | Baixa (parece texto) | Baixo | GHOST |
| pedidos/page.tsx:1755 | Pedidos › Header | "+ Novo pedido" | Abrir montagem manual | `--primary` | **`--background`** | **Sim ⚠️** ≈1,4:1 | 30 | disabled+"Abrindo…" | Alta | **Alto (CTA principal)** | PRIMARY |
| pedidos/page.tsx:1763 | Pedidos › Header | 🔇/🔊 mute | Ativar/desativar sons | transparent/danger 10% | herda ícone | Não | 28 | sem foco visível | Baixa | Baixo | ICON/TOGGLE |
| pedidos/page.tsx:1764 | Pedidos › Header | "Admin" | Ir para /admin | transparent, borda `--surface-secondary` | `--foreground-secondary` | Não | 28 | nenhum | Baixa | Baixo | SECONDARY |
| pedidos/page.tsx:1765 | Pedidos › Header | "Verificar pagamentos Pix Mercado Pago" | Forçar reconciliação Pix | transparent, borda `--surface-secondary` | `--foreground-secondary` | Não | 28 | disabled+"Verificando..." | Baixa (ação financeira pouco destacada) | Médio | WARNING |
| pedidos/page.tsx:1766 | Pedidos › Header | "Sair" | Logout | transparent, borda `--border` | `--foreground-muted` | Não | 28 | nenhum | Baixa | Baixo | GHOST |
| pedidos/page.tsx:1777 | Pedidos › Header | "Pausar"/"Ativar" (bot) | Ligar/desligar atendimento automático | `color-mix(success/primary 6%)` | `--foreground` | Não | 48 | pulso animado, disabled | Alta | **Alto** (visual de card, não de ação crítica) | WARNING |
| pedidos/page.tsx:1809/1813/1818 | Pedidos › Header | Chips de status/pipeline | Filtrar lista de pedidos | transparent/accentBg | accent/`--foreground-secondary` | Não | 30 | estado ativo | Média | Baixo | TOGGLE/CHIP |
| pedidos/page.tsx:1820 | Pedidos › Header | "📦" | Arquivar não resolvidos do expediente | `color-mix(attention 8%)` | `--attention` | Não | 32 | nenhum | Baixa (ação em massa sem rótulo) | Alto | WARNING |
| pedidos/page.tsx:1821 | Pedidos › Header | "+ Novo" (chip) | Abrir modal de novo pedido simplificado | `color-mix(primary 10%)` | `--brand-text` | Não | 32 | nenhum | Média | Baixo (⚠️ duplica "+ Novo pedido" com estilo diferente) | PRIMARY |
| pedidos/page.tsx:1822 | Pedidos › Header | 🗑️ | Limpar histórico (arquiva entregues) | transparent, borda `--surface-secondary` | `--foreground-muted` | Não | 32 | nenhum | Baixa | Alto (ícone neutro p/ ação em massa) | DANGER |
| pedidos/page.tsx:1830 | Pedidos › Header | "×" limpar busca | Limpar campo de busca | none | `--foreground-muted` | Não | 26 | nenhum | Baixa | Baixo | ICON |
| pedidos/page.tsx:1846 | Pedidos › Banner PWA | "Instalar" | Instalar PWA | `--primary` | `--primary-foreground` | Não (par correto) | 34 | nenhum | Média | Baixo | PRIMARY |
| pedidos/page.tsx:1847 | Pedidos › Banner PWA | "Agora não" | Dispensar banner | transparent | `--foreground-muted` | Não | 24 | nenhum | Baixa | Baixo | GHOST |
| pedidos/page.tsx:1860 | Pedidos › Urgência | "Assumir" | Assumir conversa urgente | `--danger` | **`--foreground`** | **Sim ⚠️** ≈3,2:1 | 26 | nenhum | Alta | Alto | DANGER |
| pedidos/page.tsx:1861 | Pedidos › Urgência | "×" dispensar | Fechar faixa de urgência | transparent, borda danger 25% | `--danger` | Não | 26 | nenhum | Baixa | Médio | ICON |
| pedidos/page.tsx:1968/2051/2189 | Pedidos › Tempo real | "Assumir e responder" (3 estilos!) | Assumir conversa do bot | `--primary`/color-mix cinza | **`--background`**/`--primary-foreground`/`--foreground-secondary` | **Sim** em 2 de 3 variantes | 24–30 | disabled+"..." | Alta, mas inconsistente | Alto | WARNING |
| pedidos/page.tsx:2020 | Pedidos › Tempo real | "←" voltar (mobile) | Fechar conversa aberta | none | `--brand-text` | Não | 28 | nenhum | Baixa | Baixo | ICON |
| pedidos/page.tsx:2033/2048/2056 | Pedidos › Chat header | "📦 Arquivar" | Arquivar conversa | `color-mix(danger 9%)` | `--danger` | Não | 30 | disabled+"..." | Média | Médio (irreversível, sem confirmação) | DANGER |
| pedidos/page.tsx:2036 | Pedidos › Chat header | "🧾 Pedido" | Abrir revisão de pedido combinado | `--success` | **`--background`** | **Sim ⚠️** ≈3,1:1 | 30 | disabled+"..." | Média | Médio | SUCCESS |
| pedidos/page.tsx:2039 | Pedidos › Chat header | "🤖 Robô" | Devolver conversa ao bot | `--info` | `--foreground` | Possível | 30 | disabled+"..." | Média | Médio | SECONDARY |
| pedidos/page.tsx:2119 | Pedidos › Chat | "N novas mensagens ↓" | Rolar até novas mensagens | `--whatsapp` | `--whatsapp-foreground` | Não | 28 | nenhum | Média | Baixo | ICON/CHIP |
| pedidos/page.tsx:2173 | Pedidos › Chat | Enviar mensagem | Enviar mensagem humana | `--whatsapp`/`--surface-secondary` | `--foreground`/`--border-strong` | Não | 42×42 | disabled visual | Alta | Baixo | ICON |
| pedidos/page.tsx:2313 | Pedidos › Card lista | "🚨 Assumir conversa" | Assumir pedido escalonado | `--danger` | **`--foreground`** | **Sim ⚠️** ≈3,2:1 | 30 | nenhum | Alta | Alto | DANGER |
| pedidos/page.tsx:2321 | Pedidos › Card lista | "VERIFICAR PAGAMENTO" | Verificar Pix pendente | `--attention-surface` | `--attention-text` | Não | 30 | nenhum | Média | Médio | WARNING |
| pedidos/page.tsx:2368 | Pedidos › Toast | "Desfazer · Ns" | Desfazer última mudança de status | `color-mix(primary 16%)` | `--brand-text` | Não | 34 | contador regressivo | Média | Baixo | SECONDARY |
| pedidos/page.tsx:2416 | Pedidos › Modal | "Sim, arquivar entregues" | Confirmar arquivamento em massa | `--danger` | **`--foreground`** | **Sim ⚠️** ≈3,2:1 | 56 | disabled+"Arquivando...", opacity .7 | Alta | Alto | DANGER |
| pedidos/page.tsx:2419/2441/2683/2517 | Pedidos › Modais | "Cancelar" (4 modais) | Fechar sem confirmar | transparent | `--foreground-secondary` | Não | 44–46 | parcial | Baixa (parece texto) | Baixo | GHOST |
| pedidos/page.tsx:2438 | Pedidos › Modal | "📦 Sim, arquivar não resolvidos" | Confirmar arquivamento de pendentes | `--attention` | `--foreground` | Possível | 56 | disabled+"Arquivando..." | Alta | Alto | WARNING |
| pedidos/page.tsx:2466 | Pedidos › Modal Novo Pedido | Chips tipo de entrega | Selecionar tipo de entrega | color-mix(primary 15%) ativo | `--text-primary`/`--text-muted` | Não | 40 | ativo | Média | Baixo | TOGGLE/CHIP |
| pedidos/page.tsx:2493 | Pedidos › Modal Novo Pedido | "×" remover item | Remover linha do formulário | transparent, borda `--surface-secondary` | `--danger` | Não | 40×46 | condicional | Baixa | Baixo | ICON |
| pedidos/page.tsx:2496 | Pedidos › Modal Novo Pedido | "+ Adicionar item" | Adicionar linha | transparent, borda tracejada | `--foreground-muted` | Não | 36 | nenhum | Baixa | Baixo | GHOST/SECONDARY |
| pedidos/page.tsx:2505 | Pedidos › Modal Novo Pedido | Chips de pagamento | Selecionar forma de pagamento | color-mix(primary 15%) ativo | `--text-primary`/`--text-muted` | Não | 36 | ativo | Média | Baixo | TOGGLE/CHIP |
| pedidos/page.tsx:2514 | Pedidos › Modal Novo Pedido | "Criar pedido" | Enviar pedido manual | gradient `--primary` | `--primary-foreground` | Não (correto) | 56 | disabled+"Salvando...", opacity .5 | Alta | Alto | PRIMARY |
| pedidos/page.tsx:2560 | Pedidos › Modal Pix | "✕" fechar | Fechar modal de verificação | rgba(overlay .06) | `--foreground-secondary` | Não | 36 | disabled durante confirmação | Baixa | Médio (modal financeiro) | ICON |
| pedidos/page.tsx:2622 | Pedidos › Modal Pix | 👁️/🙈 senha | Alternar visibilidade da senha | transparent | `--foreground-secondary` | Não | 38 | nenhum | Baixa | Baixo | ICON |
| pedidos/page.tsx:2645 | Pedidos › Modal Pix | "CONFIRMAR R$X COMO RECEBIDO" | Confirmar Pix manualmente (ação financeira crítica) | `--danger` | **`--foreground`** | **Sim ⚠️** ≈3,2:1 | 60 | disabled até checklist+senha, "Confirmando..." | Alta | **Muito alto** | DANGER (fricção via checklist, mantida) |
| pedidos/page.tsx:2660 | Pedidos › Modal Pix | "Voltar e conferir novamente" | Cancelar confirmação | transparent | `--foreground-secondary` | Não | 46 | disabled durante confirmação | Baixa | Baixo | GHOST |
| pedidos/page.tsx:2682 | Pedidos › Modal | "Finalizar pedido" | Confirmar finalização silenciosa | `--success` | **`--background`** | **Sim ⚠️** ≈3,1:1 | 56 | nenhum | Alta | Médio | SUCCESS |
| pedidos/page.tsx:2749 | Pedidos › Modal combinado | "✅ Criar pedido" | Enviar pedido combinado | `--success` | **`--background`** | **Sim ⚠️** ≈3,1:1 | 56 | disabled+"Criando...", opacity .7 | Alta | Alto | SUCCESS |
| pedidos/page.tsx:2755 | Pedidos › Modal combinado | "← Voltar para conversa" | Fechar modal | transparent | `--foreground-secondary` | Não | 46 | disabled durante criação | Baixa | Baixo | GHOST |
| NovoPedidoManual.tsx:444 | Novo Pedido Manual (header) | "×" fechar | Sair do fluxo | none | `--foreground-muted` | Não | 30 | nenhum | Baixa | Médio | ICON |
| NovoPedidoManual.tsx:453 | Novo Pedido Manual (stepper) | Indicador "1. Itens/2. Entrega/3. Pagamento" | Indicador de etapa (não clicável) | `--primary` ativo | **`--background`** | **Sim ⚠️** ≈1,4:1 | 30 | concluído muda p/ verde | Média | Baixo | — (indicador) |
| NovoPedidoManual.tsx:514 | Novo Pedido Manual | Chips de categoria | Filtrar catálogo | color-mix(primary 15%) ativo | `--foreground` | Não | 34 | ativo | Média | Baixo | TOGGLE/CHIP |
| NovoPedidoManual.tsx:548 | Novo Pedido Manual | Card de produto | Adicionar/abrir montagem | surface | `--foreground` | Não | 60 | disabled+opacity .5 esgotado | Alta | Baixo | GHOST (card) |
| NovoPedidoManual.tsx:587/589/590 | Novo Pedido Manual (carrinho) | "−"/"+"/"×" | Ajustar quantidade/remover | transparent, borda (−/+); sem borda (×, danger) | `--foreground`/`--danger` | Não | 30×30 | nenhum | Média | Baixo | ICON |
| NovoPedidoManual.tsx:612 | Montagem guiada | "← Voltar aos produtos" | Sair da montagem de item | none | `--brand-text` | Não | — | nenhum | Baixa (parece link) | Baixo | GHOST |
| NovoPedidoManual.tsx:658 | Montagem guiada | "{Etapa}: {resumo} ✎" | Pular para etapa preenchida | surface, borda `--surface-secondary` | `--foreground-secondary` | Não | 26 | nenhum | Baixa | Baixo | TOGGLE/CHIP |
| NovoPedidoManual.tsx:677 | Montagem guiada | Opção (sabor/borda/tamanho) | Selecionar opção | card/color-mix(primary 12%) sel. | `--foreground` | Não | 54 | disabled+opacity .45 esgotado | Alta | Baixo | TOGGLE/CHIP |
| NovoPedidoManual.tsx:721/774 | Entrega/Pagamento | Chips de tipo/forma | Selecionar opção | color-mix(primary 15%) ativo | `--foreground` | Não | 40 | ativo | Média | Baixo | TOGGLE/CHIP |
| NovoPedidoManual.tsx:810 | Pagamento | "Sem troco"/"Precisa de troco" | Definir troco | transparent, borda condicional | `--foreground` | Não | 40 | ativo (borda) | Média | Baixo | TOGGLE/CHIP |
| NovoPedidoManual.tsx:868 | Montagem (rodapé) | "Voltar"/"Cancelar item" | Recuar etapa/cancelar | transparent, borda `--surface-secondary` | `--foreground-secondary` | Não | 46 | nenhum | Média | Baixo | GHOST |
| NovoPedidoManual.tsx:872/877/900/911/912/918/920 | Montagem/Itens/Entrega/Pagamento (rodapé) | "Adicionar ao pedido"/"Continuar para X"/"Criar pedido" | CTAs de avanço/submissão | `--primary` | **`--background`** | **Sim ⚠️** ≈1,4:1 (todos) | 46 | disabled+opacity .5, "Criando pedido…" | Muito alta | **Muito alto** (submissão do pedido) | PRIMARY |
| NovoPedidoManual.tsx:938/939 | Modal descartar categoria | "Continuar montando"/"Trocar categoria" | Cancelar/confirmar descarte | transparent / `--danger` | `--foreground` / `#fff` hardcoded | Não (par ok, mas hex fora do tema) | 46 | nenhum | Média/Alta | Médio | GHOST / DANGER |
| NovoPedidoManual.tsx:951/952 | Modal sair | "Continuar montando"/"Descartar" | Cancelar/confirmar saída | transparent / `--danger` | `--foreground` / `#fff` hardcoded | Não | 46 | nenhum | Média/Alta | Alto (perda de dados) | GHOST / DANGER |
| conversas/page.tsx:788 | Conversas › Busca | "×" | Limpar busca | none | `--foreground-secondary` | Não | 26 | nenhum | Baixa | Baixo | ICON |
| conversas/page.tsx:810 | Conversas › Lista | Item de conversa (`div onClick`) | Abrir conversa | transparent/hover | `--brand-text` | Não | 68 | `:hover` | Alta | Baixo, mas **falha de acessibilidade** (não é `<button>`) | GHOST (trocar para `<button>`) |
| conversas/page.tsx:874 | Chat header | "←" voltar | Voltar à lista (mobile) | transparent | `--foreground-muted` | Não | 36 | `:hover` | Baixa | Baixo | ICON |
| conversas/page.tsx:888 | Chat header | "WA" (`<a>`) | Abrir WhatsApp externo | `--whatsapp` | `--foreground` (deveria ser `--whatsapp-foreground`) | Não (≈7,7:1) | 36 | `:hover`/`:active` | Média | Baixo | SECONDARY |
| conversas/page.tsx:895 | Chat header | "🤖" | Devolver ao robô | `color-mix(info 10%)` | `--info` | Não | 36 | `:disabled` opacity .4 | Baixa | Médio | SECONDARY |
| conversas/page.tsx:904 | Chat header | "Finalizar" | Finalizar atendimento | transparent, borda overlay 12% | `--foreground-muted` | Não | 36 | `:hover`/`:disabled` | Baixa | Médio | SUCCESS |
| conversas/page.tsx:975 | Composer | Enviar mensagem | Enviar mensagem humana | gradient `--primary`→`--danger` | `--foreground` | **Sim, parcial ⚠️** (metade vermelha ≈3,2:1) | 46 | `:hover`/`:active`/`:disabled` | Alta | Baixo | ICON |
| conversas/page.tsx:1031/1034 | Modal finalizar | "Sim, finalizar"/"Cancelar" | Confirmar/cancelar finalização | `--success-surface` / transparent | `--success-text` / `--foreground-secondary` | Não | 52/42 | nenhum | Alta/Baixa | Médio/Baixo | SUCCESS / GHOST |
| admin/page.tsx:626/627/628 | Admin › Header | "Dev"/"Cozinha"/"Sair" | Navegação/logout | `--surface-secondary` | `--info`/`--foreground`/`--border-strong` | Não | 32 | nenhum | Baixa | Baixo (⚠️ "Sair" com estilo próprio, 3º do sistema) | SECONDARY / GHOST |
| admin/page.tsx:641 | Admin › Abas | Painel/Cardápio/Config/Financeiro/Suporte | Navegar entre abas | transparent/color-mix(primary 8%) ativo | `--foreground-muted`/`--brand-text` | Não | 38 | ativo | Alta | Baixo | TOGGLE/CHIP |
| admin/page.tsx:678 | Admin › Dashboard | "Escanear QR Code" | Iniciar conexão WhatsApp | `--whatsapp` | `--whatsapp-foreground` | Não | 48 | disabled+"Gerando..." | Alta | Alto (bot depende disso) | PRIMARY |
| admin/page.tsx:689 | Admin › Dashboard | "Resetar conexão do WhatsApp" | Recriar instância (destrutivo) | transparent, borda `--danger` | `--danger` | Não | 40 | `confirm()` nativo, disabled | Baixa p/ ação destrutiva | Alto | DANGER |
| admin/page.tsx:712/722 | Admin › Dashboard | "Forçar agora"/"Novo QR" | Gerar novo QR | `--whatsapp`/transparent | `--whatsapp-foreground`/`--foreground-secondary` | Não | 34/28 | disabled | Média | Médio | SECONDARY |
| admin/page.tsx:738/742 | Admin › Dashboard | Período (Ontem/Hoje/Semana/📅) | Filtro de período | `--primary` ativo/`--surface` | `--foreground`/`--foreground-secondary` | Não | 48 | ativo | Média | Baixo | TOGGLE/CHIP |
| admin/page.tsx:758 | Admin › Dashboard | "Aplicar" | Confirmar intervalo custom | `--primary` | `--primary-foreground` | Não | 44 | nenhum | Média | Baixo | PRIMARY |
| admin/page.tsx:867 | Admin › Dashboard | Cards de atalho | Navegação | surface, borda `--border` | `--foreground` + ícone | Não | 90 | sem `:hover` real | Alta | Baixo | GHOST (card) |
| admin/page.tsx:919/935/986/1006/1026 | Admin › Cardápio | "x" remover item | Remover sabor/bebida/suco/bairro | none | `--danger` | Não | ~14px fonte | nenhum | Baixa (texto solto) | Médio (sem confirmação) | ICON |
| admin/page.tsx:925/941/994/1014/1034 | Admin › Cardápio | "+ Add"/"+" | Adicionar item ao cardápio | `--primary` | `--primary-foreground` | Não | 34 | nenhum | Média | Baixo | PRIMARY |
| admin/page.tsx:1038 | Admin › Cardápio | "Salvar Cardápio" | Persistir cardápio | `--primary`/`--surface-secondary` | `--foreground` | Não | 50 | disabled+"Salvando..." | Alta | Alto | PRIMARY |
| admin/page.tsx:1058 | Admin › Config | "Aberto 24h" | Toggle horário | `--success-soft`/`--surface-secondary` | `--success`/`--foreground-muted` | Não | 46 | ativo | Média | Médio (afeta operação) | TOGGLE |
| admin/page.tsx:1166/1170/1174/1184/1187 | Admin › Config MP | Salvar/Desativar/Ativar/Testar/Desconectar Pix | Config. Mercado Pago | vários (primary/danger-soft/success/surface-secondary) | vários | Não | 44–46 | disabled+"...", `title` | Alta | Alto (integração de pagamento) | PRIMARY/DANGER/SUCCESS/SECONDARY/DANGER |
| admin/page.tsx:1197 | Admin › Config | "Ativo"/"Inativo" (fotos) | Toggle exibição de imagens | `--success-soft`/`--surface-secondary` | `--success`/`--foreground-muted` | Não | 28 | ativo | Baixa | Baixo | TOGGLE |
| admin/page.tsx:1211 | Admin › Config | "Carregar" | Upload de imagem | `--surface-secondary` | `--brand-text` | Não | 36 | disabled+"..." | Baixa | Baixo | SECONDARY |
| admin/page.tsx:1218 | Admin › Config | "Salvar Configurações" | Salvar config geral | `--primary`/`--surface-secondary` | `--foreground` | Não | 50 | disabled+"Salvando..." | Alta | Alto | PRIMARY |
| admin/page.tsx:1225/1239/1250 | Admin › Funcionários | "+ Novo"/"Criar"/"Salvar" | Gerir credenciais de acesso | `--primary`/`--surface-secondary` | `--primary-foreground`/`--foreground` | Não | 30–44 | disabled | Média/Alta | Alto (cria/troca senha) | PRIMARY/PRIMARY/SECONDARY |
| admin/page.tsx:1344 | Admin › Financeiro | "Fotografar nota fiscal" | Upload+IA de nota | `--success-soft`, borda tracejada | `--success` | Não | 90 | disabled+"Analisando..." | Alta | Baixo | SECONDARY |
| admin/page.tsx:1365/1399 | Admin › Financeiro | Chips de categoria de custo | Selecionar categoria | cor da categoria ativa/`--surface-secondary` | `--foreground`/`--border-strong` | Possível em roxo+navy | 22–26 | ativo | Baixa | Baixo | TOGGLE/CHIP |
| admin/page.tsx:1377/1406/1407 | Admin › Financeiro | "+ Adicionar"/"Salvar"/"Cancelar" (custo) | Lançamento financeiro | `--success`/`--surface-secondary` | `--foreground`/`--foreground-muted` | Não | 36–44 | disabled+"Salvando..." | Alta/Média/Baixa | Alto | SUCCESS/SUCCESS/GHOST |
| admin/page.tsx:1420/1425 | Admin › Financeiro | "edit"/"x" (texto puro) | Editar/excluir lançamento | none | `--border-strong`/`--surface-elevated` | **Sim ⚠️** (token de superfície como texto) | 12–17px fonte | nenhum | Muito baixa (literalmente a palavra "edit") | Alto (exclusão sem confirmação, quase invisível) | ICON / DANGER |
| admin/page.tsx:1496 | Admin › Suporte | "Falar com suporte no WhatsApp" | Abrir WhatsApp da Ominix | `--success-soft` | `--success` | Não | 48 | nenhum | Média | Baixo (usa verde de sucesso, não `--whatsapp`) | SECONDARY |
| admin/page.tsx:1505/1506/1516 | Admin › Suporte (dev) | "Logs"/"Relatórios"/"Reset" | Navegação/reset de sessão | `--surface-secondary`/`--primary` | `--foreground`/`--primary-foreground` | Não | 40–48 | nenhum | Baixa/Média | Alto ("Reset" afeta cliente real sem confirmação) | SECONDARY/SECONDARY/WARNING |
| admin/page.tsx:1535 | Admin › Bottom nav | 5 ícones de navegação | Navegar (mobile) | none | `--primary`/`--border-strong` ativo/inativo | Não | 48 | indicador de bolinha | Alta | Baixo | TOGGLE/CHIP |
| jornada-chef/page.tsx:423 | Jornada do Chef › Config | Modo de rollout (Desligada/Canário/Todos) | Alterar alcance da feature | botaoPrimario/botaoSecundario | `--primary-foreground`/`--foreground-secondary` | Não | 40 | ativo | Alta | **Alto** (liga p/ todos os clientes, tratado como toggle simples) | WARNING |
| jornada-chef/page.tsx:466/481 | Jornada do Chef | "Salvar configuração"/"Adicionar" | Persistir config/adicionar canário | botaoPrimario | `--primary-foreground` | Não | 40 | disabled+"..." | Alta/Média | Alto/Baixo | PRIMARY |
| jornada-chef/page.tsx:490/519/520/524 | Jornada do Chef › Sequência | "Remover"/"↑"/"↓" | Remover/reordenar recompensa | botaoIcone | `--foreground-secondary` | Não | 30 | disabled nos extremos | Baixa | Alto (remove sem confirmar) | DANGER / ICON |
| jornada-chef/page.tsx:534-608 | Form recompensa | Tipo/Adicionar item | Configurar recompensa | botaoPrimario/botaoSecundario | idem | Não | 34–40 | disabled conforme validação | Média | Baixo | TOGGLE/CHIP / PRIMARY |
| jornada-chef/page.tsx:628/638 | Pendências/Consulta | "Marcar como revisado"/"Buscar" | Auditoria/consulta de cliente | botaoSecundario/botaoPrimario | idem | Não | 34 | disabled+"Buscando..." | Baixa/Alta | Médio/Baixo | SECONDARY/PRIMARY |
| jornada-chef/page.tsx:673/676/751/754/765 | Recompensas do cliente | "Revogar código"/"Substituir"/"Confirmar substituição"/"Cancelar"/"Aplicar resgate manual" | Ações de alto impacto no prêmio do cliente | botaoSecundario/botaoPrimario | idem | Não | 34 | parcial | Baixa | **Alto** (revoga/aplica sem confirmação) | DANGER/WARNING/WARNING/GHOST/WARNING |
| PanelShell.tsx:93-183 | Sidebar/Bottom nav (todas as telas) | Itens de navegação + badges | Navegação estrutural | transparent/`--primary-soft` ativo | `--foreground-muted`/`--text-primary` | Não | 40–52 | `:hover`, `.ps-active` | Alta | Baixo | TOGGLE/CHIP (nav) |
| NavBar.tsx:91-123 | Legado (`/simulador`) | Links de navegação, "Sair", "Entrar" | Navegação/sessão | vários (inclui gradient danger p/ "Entrar") | vários, um hex hardcoded | Possível no claro | 28 | parcial | Baixa/Média | Baixo (⚠️ 3º estilo de "Sair"; "Entrar" usa cor de perigo p/ ação neutra) | GHOST / PRIMARY |
| LimpezaOperacionalPainel.tsx:189/207 | Gate de limpeza operacional | Ação principal/secundária (labels dinâmicos) | Resolver pendência bloqueante | `--primary` / transparent | **`--background`** / `--danger` | **Sim ⚠️** ≈1,4:1 na principal | 46 | disabled+"Registrando…" | Muito alta (única saída do modal) | **Muito alto** | PRIMARY / DANGER |
| TourGuiado.tsx:293/294/298 | Tour guiado | "Pular"/avançar/checkbox | Navegar tour / preferência | rgba overlay / gradient dinâmico | rgba overlay / condicional | Possível/Sim ⚠️ no passo "IMPORTANTE" | 40–44/16 | parcial | Baixa/Alta | Médio (checkbox é `div onClick`, não controle real) | GHOST / PRIMARY / TOGGLE |
| ThemeToggle.tsx:82 | Configurações | "Claro"/"Escuro" | Alternar tema | `--primary-soft` ativo/transparent | `--foreground`/`--foreground-muted` | Não | 34 | `role="radio"`+`aria-checked` (referência de acessibilidade) | Média | Baixo | TOGGLE/CHIP |

### 4.2 Configurações, financeiro, relatórios, contador, setup, login, dev/*

| Arquivo | Tela | Texto/ícone | Finalidade | Cor de fundo atual | Cor de texto atual | Problema de contraste? | Tamanho (px) | Estados | Prioridade | Risco | Variante recomendada |
|---|---|---|---|---|---|---|---|---|---|---|---|
| configuracoes/page.tsx | Configurações | "←" voltar | Ir para /admin | rgba(overlay .06) | `--foreground-secondary` | Não | 48 | nenhum | Baixa | Baixo | GHOST |
| configuracoes/page.tsx | Configurações | Abas "Geral"/"Cardápio" | Trocar aba | `--primary` ativo | `--foreground` | **Sim** (amarelo+foreground, quebra no dark) | 48 | nenhum | Alta | Médio | TOGGLE/CHIP |
| configuracoes/page.tsx | Configurações | Toggles 24h/Fidelidade | Ligar/desligar | success 10%/rgba .04 | `--success`/`--foreground-secondary` | Não | 48 | disabled ao salvar | Média | Baixo | TOGGLE/CHIP |
| configuracoes/page.tsx | Configurações | "Salvar Fidelidade"/"Salvar Configurações"/"Salvar Cardápio" | Persistir config | gradient `--primary` | `--primary-foreground` | Não | 48–56 | disabled+opacity .6, "Salvando..." | Alta | Baixo | PRIMARY |
| configuracoes/page.tsx | Configurações | "×" remover tag (×5) | Excluir item de lista | none | `--danger` | Não | 32–44 | nenhum, sem confirmação | Baixa (parece pontuação) | Médio | ICON/DANGER |
| configuracoes/page.tsx | Configurações | "+ Add" (×5) | Adicionar item ao cardápio | `--danger` | `--foreground` | **Sim** (vermelho p/ ação construtiva — semântica errada) | 48 | nenhum | Alta | **Alto** (confunde adicionar com destrutivo) | PRIMARY |
| financeiro/page.tsx | Financeiro | "←"/"Sair" | Navegação/logout | rgba(overlay .05) | `--foreground-muted` | Não | 44 | nenhum | Baixa | Baixo | GHOST |
| financeiro/page.tsx | Financeiro | "1D/1S/1M" | Filtro de período | `--primary` ativo | `--foreground` | **Sim** (mesmo padrão amarelo+foreground) | 42 | nenhum | Alta | Médio | TOGGLE/CHIP |
| financeiro/page.tsx | Financeiro | "×" remover transação | Excluir custo | none | `--surface-secondary` | **Sim** (token de superfície como texto, quase invisível) | 26 | nenhum, sem confirmação | Muito baixa | **Alto** | ICON/DANGER |
| financeiro/page.tsx | Financeiro | "+" FAB | Novo custo | gradient `--primary` | `--primary-foreground` | Não | 56 | nenhum | Alta | Baixo | PRIMARY |
| financeiro/page.tsx | Financeiro | "Cancelar"/"+ Registrar" (modal) | Fechar/salvar custo | `--surface`/gradient primary | `--foreground-muted`/`--primary-foreground` | Não | 54 | disabled+"Salvando..." | Baixa/Alta | Baixo | SECONDARY/PRIMARY |
| financeiro/page.tsx | Financeiro | Chips de categoria (×8) | Selecionar categoria | cor da categoria/`--surface` | `--foreground`/`--foreground-muted` | **Sim** quando cor=primary | 40 | nenhum | Média | Médio | TOGGLE/CHIP |
| relatorios/page.tsx | Relatórios | "Sair" | Logout | `--surface` | `--foreground-secondary` | Não | 48 | nenhum | Baixa | Baixo | GHOST |
| contador/page.tsx | Painel do Contador | "Sair" | Logout | `--surface-secondary` | `--border-strong` | Não | ~28 (sem minHeight) | nenhum | Baixa | Médio (alvo &lt;44px) | GHOST |
| contador/page.tsx | Painel do Contador | Abas "Resumo"/"Assistente" | Trocar aba | `--success` ativo/`--surface-secondary` | `--foreground` | Não | ~36 | nenhum | Média | Baixo | TOGGLE/CHIP |
| contador/page.tsx | Painel do Contador | "🔒 Fechar {mês}" | Fechar mês (irreversível, `confirm()` nativo) | `--success` condicional | `--foreground` | Não | 48 | disabled+"Fechando..." | Alta | **Alto** (irreversível usando cor de sucesso, não de aviso) | WARNING |
| contador/page.tsx | Painel do Contador | "➤" enviar chat | Enviar pergunta ao assistente | `--success` condicional | `--foreground` | Não | ~45 | disabled | Média | Baixo | PRIMARY |
| setup/page.tsx | Setup (wizard, 6 passos) | "Continuar"/"Começar"/"Salvar e continuar"/"Ir para os pedidos" | Avançar wizard | `--primary` | `--foreground` | **Sim** (mesmo padrão amarelo+foreground) | 56 | opacity .3–.4 se inválido, sem `disabled` real em alguns | Alta | Médio (parece clicável mesmo inválido) | PRIMARY |
| setup/page.tsx | Setup | "Voltar" (×4) | Retroceder etapa | transparent | `--foreground-secondary` | Não | 56 | `disabled` sem alteração visual em alguns | Muito baixa (parece texto) | Baixo/Médio | GHOST |
| setup/page.tsx | Setup | Toggles (dinheiro/cartão/delivery/retirada/motoboy) | Ligar/desligar opção | `--surface` + trilho `--primary` | `--foreground` | Não | 54 | sem `role="switch"`/aria | Média | Médio (falta semântica) | TOGGLE/CHIP |
| login/page.tsx | Login | "Entrar" | Submeter login | gradient `--primary` | `--primary-foreground` | Não (par correto) | 56 | disabled+opacity .8, spinner, `:active{scale(.98)}` | Alta | Baixo | PRIMARY |
| login/page.tsx | Login | 👁️/🙈 mostrar senha | Alternar visibilidade | none | `--border-strong` | Não | 26 | nenhum | Baixa | Baixo | ICON |
| login/page.tsx | Login | "acessar sem login" (`<a>`) | Ir para /simulador | none | `--foreground-muted` | Não | texto inline | nenhum | Muito baixa | Baixo | GHOST |
| dev/page.tsx | Painel Dev | "Admin"/"IA"/"Redis"/"Sair" | Navegação/logout | color-mix por seção/rgba overlay | tokens variados, 1 sem token | Não | 34 | nenhum | Média/Baixa | Baixo | SECONDARY/GHOST |
| dev/page.tsx | Painel Dev | Abas "Padrões"/"Logs" | Trocar aba | `--attention` ativo | `--foreground` | Possível | 38 | nenhum | Alta | Baixo | TOGGLE/CHIP |
| dev/page.tsx | Painel Dev | "Limpar logs"/"Resetar sistema" | Ações destrutivas em massa | color-mix(danger)/condicional | `--danger`/`--foreground` | Não | 30–44 | "Resetar" tem validação de senha+frase (bom); "Limpar logs" não tem confirmação | Média/Alta | **Alto** ("Limpar logs" sem proteção) / Baixo ("Resetar" bem protegido) | DANGER |
| dev/page.tsx | Painel Dev | "+ Criar acesso admin" | Criar usuário admin de teste | condicional `--primary` | `--foreground` | **Sim** quando ativo | 44 | disabled+"Criando..." | Alta | Baixo | PRIMARY |
| dev/page.tsx | Painel Dev | WhatsApp (2 estilos diferentes p/ mesma ação) | Compartilhar acesso via wa.me | `--success-soft`/color-mix(whatsapp) | `--success`/`--whatsapp` | Não | 24–44 | nenhum | Média/Baixa | Baixo (token errado em 1 dos 2) | SECONDARY |
| dev/mcp, dev/pix, dev/redis-status, dev/whatsapp | Painéis Dev — subtelas | "Tentar novamente"/"← Dev"/"Atualizar" (padrões divergentes entre as 4 telas) | Recovery/navegação/refresh | attention ou info, variando por tela | variados | Possível | 34 | disabled+"Atualizando..." em parte | Média/Baixa | Baixo | SECONDARY/GHOST |
| dev/whatsapp/page.tsx | WhatsApp — Diagnóstico | "Executar teste real" | Disparar canário de round-trip real | `--attention` | **hex hardcoded `#1a1a1a`** | **Sim** (mistura token+hex, contraste não garantido) | 40 | disabled+opacity .5, "Enviando..." | Alta | Médio (mensagem real sem confirmação extra) | WARNING |

### 4.3 Área do cliente e cardápio (`/cardapio`, `/cliente`, `/pedido`, `/rastrear`, `ClientBottomNav`, `Simulator`)

*(tabela completa preservada do relatório do agente — 60+ linhas, cobrindo home do cardápio, montagem de pizza, sacola, entrega, pagamento, Pix, jornada do chef, meus pedidos, editar pedido)*

Pontos mais relevantes (tabela completa disponível no histórico de auditoria; resumo priorizado abaixo):

| Arquivo | Tela | Texto/ícone | Finalidade | Problema de contraste? | Risco operacional | Variante recomendada |
|---|---|---|---|---|---|---|
| cardapio/page.tsx (admin) | Cardápio (admin) | "Confirmar" (modal lote esgotar/disponibilizar) | Confirmar ação em massa | **Sim** — `var(--foreground)` sobre fundo `--danger`/`--success` sólido | Texto pode ficar ilegível conforme o tema | DANGER/SUCCESS |
| cardapio/page.tsx (cliente) | Sacola | Stepper "−"/"+", remover "×" | Alterar quantidade/remover item | Não, mas remover usa cinza neutro (parece texto comum) | Alvo 30×30/24×24, abaixo do mínimo recomendado | ICON / DANGER |
| cardapio/page.tsx (cliente) | Toda a jornada de compra | Cards `.opt` (tamanho/sabor/borda/entrega/pagamento) | Selecionar opção | Não | Padrão mais maduro do repo — ótima base p/ TOGGLE/CHIP oficial | TOGGLE/CHIP |
| cardapio/page.tsx (cliente) | Listas (lanches/bebidas/macarronada) | Item de lista (`.opt`) | **Adicionar direto ao carrinho** | Não | Visual de card neutro para a ação de venda mais importante da tela | PRIMARY |
| cardapio/PixPagamentoCard.tsx | Retomada Pix | "Copiar código Pix" | Copiar copia-e-cola | Não | Melhor padrão de microfeedback do app (ícone+texto+cor muda por ~1.8s) — referência para "copiar" em qualquer lugar | PRIMARY |
| pedido/pagamento/[token]/page.tsx | Pix pendente | "Falar com a Pizzaria" | Abrir WhatsApp | Não | Usa `--success` em vez de `--whatsapp` | (ação externa — token dedicado) |
| pedido/editar/[id]/page.tsx | Editar pedido | "Descartar alterações" (confirmar) | Confirmar descarte | Não visualmente, mas `color:#fff` hardcoded em vez de `--on-danger` | Cor fora do sistema de tokens | DANGER |
| cliente/pedidos/page.tsx | Meus pedidos | Card de pedido (`<Link>` inteiro) | Ir para rastreamento | Não | Card inteiro clicável sem indicação de "botão" além do chevron | GHOST (card) |
| Simulator.tsx | Simulador (demo) | Enviar mensagem | Enviar texto digitado | Possível — `var(--foreground)` usado como fundo "desabilitado" (token errado) | Uso de token semanticamente incorreto | ICON |

**Botões que parecem texto comum:** "Alterar nome/dados", "Usar outro WhatsApp" (×2), "×" de remover item do carrinho, "Cancelar" (form de promoções), "← Cardápio", "Fazer login" (única ação da tela de acesso restrito), "Este número não é meu"/"Reenviar código"/"Usar outro número"/"Prefiro pedir sem entrar agora", "Verificar agora" (Pix).

**Inconsistências de mesma função com estilos diferentes:** "Tentar novamente" tem 3 tratamentos visuais diferentes entre telas de erro vs. `pedido/page.tsx` vs. `cliente/*`; "remover item do carrinho" muda de "×" cinza para botão com borda dependendo da tela; formas de pagamento têm dois layouts completamente diferentes (`cardapio` vs. `pedido/editar`); CTA de WhatsApp externo não tem padrão visual único fora do `Simulator.tsx`.

### 4.4 Entregador e telas restantes

| Arquivo | Tela | Texto/ícone | Finalidade | Cor de fundo atual | Cor de texto atual | Problema de contraste? | Risco operacional | Variante recomendada |
|---|---|---|---|---|---|---|---|---|
| entregador/page.tsx | Entregador | "Enviar novo acesso" | Reenviar link via WhatsApp | `--primary` | `--primary-foreground` | Não | Baixo | PRIMARY |
| entregador/page.tsx | Entregador (header) | "Atualizar" | Recarregar lista | `--surface-secondary` | `--foreground` | Não | Médio — sem lock durante fetch (cliques duplicados) | SECONDARY |
| entregador/page.tsx | Entregador (header) | "Sair" | Logout | transparent | `--foreground-secondary` | Não | Baixo | GHOST |
| entregador/page.tsx | Card "pendente" | "🛵 Iniciar Entrega" | Iniciar rastreamento GPS | `--primary` | `--primary-foreground` | Não | **Médio-alto** — sem disable durante chamada assíncrona (clique duplo pode duplicar o start do GPS) | PRIMARY |
| entregador/page.tsx | Card "em rota" | "✓ Confirmar Entrega" | Finalizar entrega (irreversível) | `--success` | **`var(--foreground)`** (deveria ser `--on-success`) | **Sim** — falha em dark (~2,2:1) | **Alto** — ação irreversível + sem proteção contra duplo clique | SUCCESS |
| pedidos/[id]/imprimir/page.tsx | Cupom de impressão | "Imprimir agora" | `window.print()` | hex hardcoded `#000` | hex hardcoded `#fff` | Não (mas quebra o sistema de temas) | Baixo | SECONDARY |
| pedidos/error.tsx, conversas/error.tsx, cliente/error.tsx, rastrear/error.tsx | Telas de erro | "Tentar novamente" | Reset do error boundary | `color-mix(primary 15%)` (deveria ser `--primary-soft`) | `--brand-text` | Não | Médio — único caminho de recuperação com baixo destaque | PRIMARY |
| sobre/page.tsx | Landing institucional | "💬 Quero para minha pizzaria" (×2, CSS duplicado) | CTA de conversão (WhatsApp) | `--primary` | **`var(--foreground)`** | **Sim, crítico** — ≈1,4:1 no dark | **Alto** — CTA de conversão mais importante do site quase ilegível | WHATSAPP/PRIMARY (corrigir texto) |
| sobre/page.tsx | Landing institucional (rodapé) | "Acessar painel" | Ir para /login | none | `--border-strong` (token de borda como texto) | **Sim** | Baixo | GHOST |

Arquivo órfão encontrado (fora de produção): `src/app/pedidos/page.tsx.bak` — backup não compilado com cores hex hardcoded, fora do sistema de tokens. Não afeta produção; considerar remover em limpeza futura (fora do escopo desta tarefa).

---

## 5. Consolidado — problemas recorrentes

1. **Texto sobre fundo sólido usando o token errado** (`--background`/`--foreground` em vez de `--primary-foreground`/`--on-danger`/`--on-success`) — dezenas de ocorrências, ver seção 0. É o problema #1 em volume e severidade.
2. **A mesma função com 2–4 estilos diferentes** conforme o arquivo: "Sair" (4 variações), "Tentar novamente" (3), "Assumir e responder" (3, uma delas ilegível), "+ Novo pedido" vs. "+ Novo" (duplicado no mesmo header).
3. **Ações destrutivas sem affordance de botão**: "×"/"x"/"edit" como texto solto, sem fundo, sem confirmação — `admin/page.tsx` (financeiro), `financeiro/page.tsx`, `configuracoes/page.tsx`.
4. **Cor de perigo usada para ação construtiva** ("+ Add" em vermelho em `configuracoes/page.tsx`) e **cor de sucesso usada para ação irreversível sem aviso** ("🔒 Fechar mês" em `contador/page.tsx`, modo de rollout em `jornada-chef`).
5. **Alvos de toque abaixo de 44px**: stepper da sacola (30×30), remover item (24–26px), chips de categoria do admin de cardápio (29px).
6. **Elementos clicáveis que não são `<button>`**: item de conversa em `conversas/page.tsx`, checkbox "não mostrar tutorial" em `TourGuiado.tsx` — falha de teclado/leitor de tela.
7. **WhatsApp com token inconsistente**: ora `--whatsapp`, ora `--success`, ora cor genérica — mesma ação, sem identidade visual única.

## 6. Padrões existentes que valem ser formalizados (não descartar)

- Estado "salvando" (disabled + opacity + texto no gerúndio) — já consistente na maior parte do app.
- Par borda+fundo suave da marca para seleção (`--primary-soft`/`--primary`) — o padrão mais maduro do repo, base direta do `Chip` novo.
- `ThemeToggle.tsx` como referência de segmented control acessível (`role="radiogroup"`, `aria-checked`).
- Checklist obrigatório + senha antes de habilitar a confirmação de Pix manual — melhor padrão de fricção para ações financeiras críticas; vale estender a "Revogar código", "Desconectar Mercado Pago", "Resetar sistema".
- Feedback tátil `:active{transform:scale(.98)}`, hoje só na área pública do cardápio e no login.
- Microfeedback de copiar (ícone+texto+cor muda por ~2s) em `PixPagamentoCard.tsx`.

---

## 7. Recomendação de ordem de migração (após aprovação)

1. **Fix isolado de contraste** (seção 0) — trocar `--background`→`--primary-foreground` e `--foreground`→`--on-danger`/`--on-success` nos botões sólidos afetados. Baixíssimo risco (troca de token, zero mudança de layout/comportamento), altíssimo impacto de acessibilidade. Pode ser uma PR própria, antes até da migração para o componente `Button`.
2. **`/pedidos` e `NovoPedidoManual.tsx`** — tela mais usada operacionalmente, maior concentração de CTAs críticos (confirmação de Pix, criar pedido, avançar status).
3. **`/conversas`** — inclui o fix estrutural de trocar `div onClick` por `<button>` no item de lista.
4. **Painel `/admin`, `/configuracoes`, `/financeiro`, `/relatorios`, `/contador`** — maior volume de inconsistências de "Sair"/"Tentar novamente"/toggles, menor criticidade operacional.
5. **Área do cliente (`/cardapio`, `/cliente`, `/pedido`)** — maior volume de arquivos, mas padrão de seleção (`.opt`) já é o mais maduro; migração é principalmente de nomenclatura de classe para o componente `Chip`, não de redesenho visual.
6. **`/entregador`, `/dev/*`, `sobre`, telas legadas (`NavBar.tsx`)** — menor tráfego, migrar por último.

## 8. Riscos

- **Risco de regressão visual em massa**: qualquer migração para o componente `Button` toca dezenas de arquivos; recomenda-se migrar tela por tela, com validação visual (`browser-qa`) antes/depois de cada uma — nunca em uma única PR gigante.
- **Ações destrutivas hoje sem confirmação** (remover recompensa, revogar código, limpar logs, excluir lançamento financeiro) ganham variante `DANGER` mais visível nesta proposta, o que por si só já reduz cliques acidentais — mas fricção adicional (confirmação) é uma decisão de produto separada, fora do escopo visual desta tarefa.
- **Toggle "modo de rollout" da Jornada do Chef e "Aberto 24h"** mudam comportamento de negócio em produção; a variante `WARNING` proposta é só visual — não adiciona confirmação. Se o solicitante quiser fricção real nessas ações, é um pedido de produto separado.
- **`NavBar.tsx`** é usado só em `/simulador` (rota de demonstração) — baixo risco de migrar, mas também baixa prioridade.
- Nenhum arquivo de regra de negócio, preço, catálogo, API, Pix, WhatsApp, pedidos, impressão ou autenticação foi alterado nesta rodada — só `globals.css` (tokens, aditivo) e dois componentes novos não importados em produção.
