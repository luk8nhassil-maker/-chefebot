---
name: pix-pendente-ui
description: Padrão visual e de comportamento do fluxo de "Pix pendente" persistente do ChefeBot — barra global fixa, indicador na aba Pedidos e tela de retomada `/pedido/pagamento/[token]`. Use ao implementar ou alterar qualquer parte desse fluxo (barra, badge do menu inferior, tela de retomada) e ao limpar cards de estado operacional da home do cliente/cardápio.
---

# UI de "Pix pendente" persistente (ChefeBot)

Referência viva para a Etapa 2 (implementação) do fluxo de retomada de pagamento Pix, aprovado na auditoria de 2026-07-15. Nasce de um problema real: hoje o QR Code e o "copia e cola" existem só em `useState` na tela `sc-done` de `src/app/cardapio/page.tsx` — saem de memória ao trocar de tela, sem nenhuma forma de recuperação (ver causa raiz completa no relatório da auditoria). Este documento descreve **como a solução deve se parecer e se comportar**, não a lógica de backend (essa fica em `docs/DEPLOYMENT.md`/PRs específicos quando implementada).

## Regra de ouro: fora do conteúdo, nunca dentro da home

A barra de "Pix pendente" é um elemento de **layout global fixo**, igual ao `ClientBottomNav` — nunca um card dentro do corpo rolável de nenhuma tela, e nunca dentro da home (`/pedido` tela `sc-start`, nem `/cliente`). Ela fica *acima* do `ClientBottomNav`, empilhada, com o mesmo `max-width: 540px` centralizado e mesmo tratamento de `env(safe-area-inset-bottom)`.

## Onde a barra aparece e onde não aparece

**Aparece** (qualquer tela que renderize `ClientBottomNav`, exceto a exclusão abaixo): `/pedido` (todas as telas do cardápio, inclusive `sc-start`), `/cliente`, `/cliente/pedidos`, `/rastrear/[pedidoId]`.

**Nunca aparece**:
- Na própria tela de retomada do Pix (`/pedido/pagamento/[token]`) — redundante, o usuário já está resolvendo o pagamento.
- Quando não há pagamento Pix pendente (nenhum pedido com `pagamentoStatus === "aguardando_pix"` para aquele cliente/token local).
- Sobrepondo CTAs fixos de carrinho/checkout já existentes (`sc-cart`, `sc-pay` têm seus próprios botões fixos de ação — nesses casos a barra Pix não deve competir; a prioridade é o CTA da etapa atual do checkout. Ver "Conflito com CTAs fixos" abaixo).

## Anatomia da barra

Uma linha só, altura ~44–52px, largura total (`max-width: 540px` centralizado, igual ao bottom nav):

```
[ícone Pix]  Pix pendente · Pedido #1234 · R$ 89,90         [Pagar agora →]
```

- Fundo: `var(--attention-soft)`, texto: `var(--attention-soft-foreground)` — pendente é **roxo**, nunca amarelo (regra de `chefebot-theme`; amarelo é ação/marca, não status).
- CTA "Pagar agora": botão pequeno sólido `var(--primary)`/`var(--primary-foreground)` (a única ação amarela daquela tela) OU link de texto sublinhado se já houver um CTA amarelo dominante na tela atual — nunca dois amarelos competindo na mesma viewport.
- Ícone: relógio/raio Pix, decorativo (`aria-hidden`), o texto já comunica o estado.
- Toda a barra é clicável (não só o CTA) e leva a `/pedido/pagamento/[token]`.
- Sem botão de fechar/dispensar — ela não é uma notificação descartável, é um estado persistente do pedido; some sozinha quando o Pix deixa de estar pendente (pago, cancelado, ou não há mais nenhum pedido pendente).
- `role="status"`/`aria-live="polite"` como o `pix-alerta` de `PixPagamentoCard.tsx` — mesma convenção já usada no app.

## Conflito com CTAs fixos do carrinho/checkout

Nas telas onde já existe um CTA fixo na base (ex.: `sc-cart`/`sc-pay` do cardápio), a barra de Pix pendente **empilha acima desse CTA também** (ela é a camada mais externa: barra Pix → CTA da tela → bottom nav, de baixo para cima é bottom nav → CTA → barra Pix) **ou**, se a pilha ficar alta demais em telas pequenas (< 700px de altura), vira uma versão compacta (só ícone + "Pix pendente" + chevron, sem o valor por extenso) — nunca esconder ou remover o CTA principal daquela etapa do checkout.

## Indicador na aba "Pedidos" do `ClientBottomNav`

Ponto discreto (dot, ~8px, `background: var(--attention)`) no canto superior direito do ícone `Receipt` da aba "Pedido" — mesmo padrão visual do `cbn-badge` de contagem da sacola, mas sem número dentro (é indicador binário: existe pendência ou não). Presente **sempre que existir Pix pendente**, mesmo quando a barra global não está visível (ex.: já sumiu por regra de conflito de CTA). Consistente com `aria-label`/texto alternativo (ex. `aria-label="Pedido — pagamento Pix pendente"`) para não depender só de cor.

## Tela de retomada — `/pedido/pagamento/[token-publico]`

Reaproveita a estrutura visual de `PixPagamentoCard.tsx` (mesmo alerta, mesmo card de QR, mesmo campo copia-e-cola, mesmo botão copiar) — **não recria do zero**. Diferenças da tela original (`sc-done` dentro do fluxo de checkout):

1. Cabeçalho próprio, mesmo padrão de `/rastrear/[pedidoId]`: ícone + `Pedido #N` + link secundário para `/cliente/pedidos`.
2. Sem “Como funciona” redundante se o usuário já viu (opcional, não obrigatório na primeira versão).
3. Estado de carregamento inicial: skeleton do card, nunca layout pulando.
4. Estado "QR indisponível/expirado": mensagem clara + CTA único "Gerar novo Pix para este pedido" (não recria pedido nem carrinho — ver auditoria, item 6 dos requisitos). Usa o par `--danger-soft`/`--danger-soft-foreground` só no aviso, não pinta o card inteiro.
5. Após confirmação (`pagamentoStatus === "pago"`): mesma transição já usada em `PixPagamentoCard` (`is-pago`, headline "Pagamento confirmado! ✅") + CTA para `/rastrear/[pedidoId]` (acompanhamento de preparo/entrega) em vez de ficar parado na tela de pagamento.
6. Verificação automática ~20s (cadência adaptativa do Guardião Pix já validada) + botão de verificação manual explícito (nunca só automático — usuário precisa de controle percebido, mesmo padrão de "Tentar novamente" já usado no app).
7. `ClientBottomNav` sempre visível nesta tela também, com `active={null}` (não é nenhuma das 4 abas) — mas **sem** a barra de Pix pendente (regra de "nunca na própria tela").

## Limpeza da home — regra permanente

Cards de notificação/estado operacional (pedido em andamento, lembretes, acompanhamento, pagamento) **não pertencem à home** (`/pedido` tela `sc-start`, `/cliente`). Único tipo de card/carrossel permitido na home: promoção ativa (`promos.length > 0`). Convites estáticos não-operacionais (ex.: "Entre com seu WhatsApp e acompanhe suas pizzas") podem continuar — não são estado de pedido, são CTA de produto.

**Regressão proibida**: reintroduzir o card `pedidoRecente` ("Acompanhar pedido #X — está em andamento", hoje em `src/app/cardapio/page.tsx` linhas ~1530–1541, alimentado por `localStorage["cf_ultimo_pedido"]`) dentro do corpo da home. Esse tipo de aviso vira responsabilidade da barra global (quando o pendente é Pix) ou do indicador da aba Pedidos + `/cliente/pedidos` (para status geral do pedido, não só Pix).

## Cores e tokens (nunca hex solto)

Segue `chefebot-theme`/`docs/DESIGN_SYSTEM.md` sem exceção:
- Pendente/Pix aguardando → `--attention` / `--attention-soft` / `--attention-soft-foreground` (roxo).
- Ação principal (Pagar agora, Copiar código) → `--primary` + `--primary-foreground`.
- Sucesso (pago) → `--success` / `--success-soft` / `--success-soft-foreground`.
- Erro (QR expirado/indisponível) → `--danger-soft` / `--danger-soft-foreground`.
- Nunca usar `--primary` (amarelo) como cor de status — só como ação.

## Desktop vs. mobile

- **Mobile (< 768px)**: barra fixa full-width (`max-width: 540px` centralizado, igual bottom nav), texto pode abreviar (`Pedido #1234` sem "Pix pendente ·" por extenso se faltar espaço, nunca cortar o valor).
- **Desktop (≥ 1024px)**: o layout do cliente já é centralizado com `max-width: 1180px` (`cliente-ui`); a barra de Pix pendente mantém `max-width: 540px` centralizado (não estica para a largura toda) para não competir visualmente com o conteúdo mais largo da página — fica como uma "pill" fixa na base, alinhada ao centro. A tela de retomada do Pix segue o mesmo container de `PixPagamentoCard` (que já funciona em ambas larguras).

## Acessibilidade

- Barra: `role="status"`, `aria-live="polite"`, área de toque ≥ 44px, texto nunca depende só de cor (ícone + palavra "pendente" sempre presentes).
- Indicador da aba: nunca a única pista — o texto "Pedido" continua visível; o dot é reforço, não substituição.
- Foco de teclado visível em ambos os temas (`:focus-visible` → `--focus-ring`), mesmo em Light fixo (regra do produto: Light é o tema padrão da Área do Cliente).

## O que esta Skill não cobre

Lógica de geração/expiração/regeneração de Pix, conciliação, webhook, cron, lock/lote/timeout/rate-limit/cooldown do Guardião Pix — essas regras são protegidas e não fazem parte de UI (ver `AGENTS.md`/regras da tarefa de auditoria). Esta Skill documenta apenas como o resultado desses sistemas deve ser exibido.
