---
name: client-orders-ui
description: Padrão visual e de comportamento da tela "Meus pedidos" (/cliente/pedidos) do ChefeBot — histórico pesquisável de pedidos do cliente autenticado. Use ao criar ou alterar essa tela, o card de pedido, o buscador ou qualquer consumidor do menu inferior compartilhado (ClientBottomNav), para manter hierarquia, tokens de cor, comportamento responsivo e regras de segurança consistentes.
---

# UI de "Meus pedidos" (Área do Cliente — ChefeBot)

Referência viva para a tela de histórico de pedidos do cliente autenticado (`/cliente/pedidos`), irmã de `cliente-ui` (Perfil/Pontos). Segue o mesmo tema claro da Área do Cliente — **não** é o painel administrativo (`admin-ui`) nem o cardápio público. Sempre que esta tela for criada ou sofrer mudança visual relevante, seguir este padrão e atualizar esta Skill se o padrão evoluir.

## Propósito da tela

Antes, a aba "Pedido" do menu inferior só apontava para o rastreamento do último pedido feito no navegador (via `localStorage["cf_ultimo_pedido"]`). Isso quebrava em qualquer troca de aparelho/navegador e escondia o histórico completo. `/cliente/pedidos` substitui isso por uma listagem **completa, pesquisável e ordenada** de todos os pedidos do cliente autenticado — a fonte de verdade agora é o servidor (via `clienteId`/telefone verificado), não o `localStorage`.

## Não usar o design system administrativo

Esta tela reaproveita **somente a linguagem visual do buscador** de `/conversas` (formato, não a lógica de filtragem nem o layout de lista do painel). O resto da tela segue os tokens e a hierarquia já estabelecidos em `cliente-ui`:

- Tema **claro** como principal, mesmos tokens globais (`var(--background)`, `var(--surface)`, `var(--foreground)`, `var(--primary)` etc. — nunca hex fixo, nunca `#fff`).
- Sem tabela rígida, sem aparência de painel administrativo, sem sidebar.
- Container de conteúdo fluido com teto razoável (mesmo padrão de `cliente-ui`: `max-width: 1180px` centralizado), nunca `maxWidth: 375/390` fixo fora de mobile.

## Estrutura da tela (ordem fixa)

1. **Cabeçalho**: ícone simples relacionado a pedido (`Receipt`, mesmo ícone da aba "Pedido" do menu inferior) + título `Meus pedidos` + subtítulo `Acompanhe o status de todos os seus pedidos.`. Sem link "← Cardápio"/"← Pontos" aqui — a volta é pelo próprio menu inferior.
2. **Buscador** (ver seção própria abaixo).
3. **Rótulo de seção**: `SEUS PEDIDOS` — uppercase, pequeno, `letter-spacing`, cor `var(--foreground-muted)` (mesmo padrão de rótulo usado no extrato de `cliente-ui`).
4. **Lista de cards**, mais novo primeiro.
5. **Rodapé de contagem**: `"1 pedido encontrado"` / `"X pedidos encontrados"` — nunca "últimos N", a lista é o histórico completo (sem `.slice`).
6. **Menu inferior fixo** (`ClientBottomNav`), sempre visível, inclusive durante carregamento/erro.

## Buscador — fiel ao mock de Conversas (só o visual)

Referência: `.cv-search` em `src/app/conversas/page.tsx`. Reproduzir exatamente esse formato, adaptado aos tokens desta área:

- Cápsula horizontal, altura ~40–44px (mobile usa a borda superior do intervalo para acessibilidade de toque).
- Fundo cinza suave translúcido: `rgba(var(--overlay-rgb), 0.06–0.07)` (nunca cor sólida hardcoded).
- Sem borda visível — profundidade só por `box-shadow` inset sutil.
- `border-radius` total (pílula, ex. `22px`).
- Ícone de lupa em SVG absoluto à esquerda (`~14px`), `stroke: var(--foreground-secondary)`.
- Texto e placeholder em `var(--foreground)` / `var(--foreground-muted)` — nunca amarelo.
- Botão "×" para limpar, absoluto à direita, só aparece com texto digitado.
- **Sem** botão "Buscar" separado, **sem** caixa quadrada, **sem** borda amarela, **sem** painel extra em volta.
- Placeholder exato: `Buscar por número, nome ou informação do pedido...` (pode abreviar visualmente em telas muito estreitas via `text-overflow`, nunca truncar de verdade o valor digitado).
- Filtragem client-side, enquanto o usuário digita (sem debounce artificial, sem reload, sem chamada de rede por tecla).

## Estrutura do card

Cada pedido é **inteiramente clicável** (usar `Link`/`<a>` cobrindo o card, nunca botão pequeno dentro) e leva a `/rastrear/[pedidoId]`. Nunca abrir modal, nunca duplicar a timeline completa aqui — isso é exclusivo da tela de rastreamento.

Conteúdo do card, nesta ordem:
- Ícone de status em círculo discreto (fundo `soft`, ver seção de cores).
- `Pedido #N`.
- Data e horário.
- Total em reais.
- Chevron (`ChevronRight`) indicando que é clicável — sempre à direita, alinhado verticalmente ao centro.
- Resumo dos primeiros itens (2–3) + "e mais N item(ns)" quando houver mais.
- Quantidade total de itens.
- Status atual (label humano) + descrição curta de uma linha.

**Nunca** colorir o card inteiro pelo status — só o círculo do ícone, o texto do status e o pequeno destaque de cor (par `soft`/`soft-foreground`).

## Desktop vs. mobile

- **Desktop (≥ 1024px)**: cards em coluna única (não grid 2 colunas — histórico é uma lista, não um dashboard de métricas), `max-width` coerente com o resto da Área do Cliente, bastante espaço em branco, bordas sutis (`var(--border)`), divisão visual interna clara entre identificação / resumo de itens / status+chevron.
- **Tablet (768–1023px)**: mesma coluna única de mobile/desktop, só com mais respiro de padding (mesmo critério de `cliente-ui`).
- **Mobile (< 768px)**: card compacto em duas áreas —
  1. primeira linha: ícone + número + data/hora + total + status + chevron;
  2. segunda área: resumo de itens + quantidade.
  Nenhum texto pode se sobrepor; status longo pode quebrar em duas linhas antes de cortar texto. Área de toque mínima 44px (todo o card, não só o chevron).
- Menu inferior fixo (`position: fixed`) nunca cobre o último card — o container de conteúdo precisa de `padding-bottom` compatível com a altura do nav (mesmo valor já usado em `/cliente`: `calc(env(safe-area-inset-bottom) + 96px)`).

## Status → cor (tokens semânticos, nunca hex solto)

`em_preparo` **não** usa amarelo — a marca (`--primary`) é reservada para ação/identidade (regra de `chefebot-theme`: "pendente/atenção usa roxo `--attention`, nunca amarelo"). Mapeamento central em `src/lib/clientePedidos.ts` (`statusVisualPedido`):

| Situação | Cor semântica | Par de tokens |
|---|---|---|
| Recebido (`novo`) | Informativo (azul) | `--info-soft` / `--info-soft-foreground` |
| Em preparo | Atenção (roxo) | `--attention-soft` / `--attention-soft-foreground` |
| A caminho / pronto (retirada ou local) | Sucesso (verde) | `--success-soft` / `--success-soft-foreground` |
| Entregue / retirado / finalizado | Neutro (cinza) | `--surface-secondary` / `--foreground-muted` |
| Cancelado | Perigo (vermelho) | `--danger-soft` / `--danger-soft-foreground` |

Labels humanos variam por `tipoEntrega` (delivery/retirada/dine_in) — ver tabela completa em `statusVisualPedido`. Um status desconhecido nunca quebra a tela: cai num rótulo neutro (usa o próprio valor técnico) em vez de lançar erro.

## Estados obrigatórios

1. **Carregando**: cards neutros/skeleton simples, sem pulo de layout; menu inferior continua visível.
2. **Sem pedidos** (cliente novo): título `Você ainda não fez nenhum pedido.`, texto curto, CTA `Fazer meu primeiro pedido` → `/pedido`.
3. **Sem resultado de busca**: mensagem `Nenhum pedido encontrado para essa busca.` + ação `Limpar busca`. Nunca reaproveitar o texto do estado "sem pedidos" (são causas diferentes).
4. **Erro**: mensagem amigável (nunca stack trace/mensagem técnica), botão `Tentar novamente`.
5. **Sessão expirada** (401 da API): redireciona para `/cliente?next=/cliente/pedidos` — nunca mostra um erro genérico para esse caso específico.

## Atualização em tempo real (sem WebSocket neste escopo)

- `fetch` com `cache: "no-store"`.
- Poll a cada ~15s **só enquanto `document.visibilityState === "visible"`** — pausar/parar o intervalo quando a aba fica oculta, retomar ao voltar (`visibilitychange`).
- Nunca perder o texto digitado no buscador durante um refresh em segundo plano.
- Reordenação e atualização de status não podem "piscar" a lista inteira — atualizar os dados, não desmontar/remontar a árvore de cards sem necessidade.

## Menu inferior compartilhado (`ClientBottomNav`)

A partir desta tela, a aba "Pedido" deixou de ser um link condicional para o último pedido: é **sempre um link estático para `/cliente/pedidos`**, nunca desabilitada, independente de o cliente ter pedidos ou não (a própria tela cobre o estado vazio). `cf_ultimo_pedido` continua existindo só para outros usos (ex.: banner de "pedido em andamento" dentro do cardápio) — não decide mais se a aba existe.

Consumidores obrigatórios do mesmo componente: `/pedido`, `/cliente`, `/cliente/pedidos`, `/rastrear/[pedidoId]`. Ativa em `/cliente/pedidos` e em `/rastrear/[pedidoId]` (rastrear é "olhar um pedido específico", parte do mesmo domínio).

## Acessibilidade

- Card clicável é `<a>`/`Link`, nunca `<div onClick>` sem semântica de link/botão.
- Ícones de status são decorativos (o texto do status já comunica a informação) — sem `aria-label` redundante, mas nunca a única forma de saber o status.
- Contraste dos pares `soft`/`soft-foreground` já validado no restante do app — não inventar combinação nova.
- Área de toque mínima 44px em mobile para o card inteiro.

## Proteção de dados / regras de segurança (não decorativas — ver `src/app/api/cliente/pedidos/route.ts`)

- A API nunca aceita telefone/`clienteId` via query — a identidade vem só do cookie `CLIENTE_COOKIE` validado no servidor.
- Um pedido de outro cliente nunca aparece na resposta, mesmo que o cliente autenticado adivinhe um `id`.
- A resposta nunca inclui telefone completo, `clienteId`, `statusToken`, `acompanhamentoToken`, metadados de Pix, tokens ou campos operacionais do atendente — só o resumo público já exposto em outras telas do cliente (mesmo padrão de "sanitização" de `/api/pedido-status`).
- A tela em si nunca decide "de quem são os pedidos" a partir de dado vindo do navegador (nem query string, nem `localStorage`) — só exibe o que a API já filtrou no servidor.

## Regressões proibidas

- Não reintroduzir `.slice(-5)`/`.slice(-10)` ou qualquer corte arbitrário na lista — é histórico completo.
- Não usar amarelo (`--primary`) como cor de status.
- Não copiar o layout/lógica de `/pedidos` (painel administrativo) ou de `/conversas` (só o visual do buscador é referência).
- Não quebrar `/pedido`, `/cliente` ou `/rastrear/[pedidoId]` — todas continuam com o mesmo menu inferior, mesma preservação de `cf_draft`/`cf_resgate_pontos`, mesmo fluxo de login/OTP.
- Não criar redirecionamento aberto no parâmetro `next` do login — só destinos de uma allowlist explícita (`src/lib/clientePedidos.ts`).
- Não tocar autenticação administrativa, `/api/orders`, arquivamento, WhatsApp/Evolution/Railway ou cálculo de pedido/pontos/resgate.

## Processo (regra permanente do projeto)

Antes de qualquer mudança visual nova nesta tela: validar contra este documento e contra `cliente-ui`/`chefebot-theme`; só então codar em patch mínimo. Validar com screenshots reais (mobile 390×844, tablet 768×1024, desktop 1440×900, Light e Dark) antes de considerar a tarefa concluída.
