---
name: admin-ui
description: Padrão visual do painel administrativo ChefeBot (sidebar desktop + bottom nav mobile via PanelShell). Use ao criar ou alterar qualquer tela do painel (/admin, /pedidos, /cardapio, /conversas, /configuracoes, /financeiro, /relatorios) para manter hierarquia, espaçamento, grid, cores e comportamento responsivo consistentes entre telas.
---

# UI do painel administrativo (ChefeBot)

Referência viva para qualquer tela dentro do painel operacional (não o cardápio público do cliente). Sempre que uma tela do painel for criada ou sofrer mudança visual relevante, seguir este padrão e atualizar esta Skill se o padrão evoluir.

## Estrutura obrigatória

Toda tela do painel usa `src/components/PanelShell.tsx` como casca:

```tsx
<PanelShell pedidosCount={n} conversasCount={n} conversasUrgent={bool} showGestaoNav>
  {/* conteúdo da página */}
</PanelShell>
```

- `showGestaoNav` liga o grupo "Gestão" da sidebar (Dashboard/Configurações/Financeiro/Relatórios). Telas operacionais (`/pedidos`, `/cardapio`, `/conversas`) não passam essa prop — o grupo fica oculto e o comportamento delas não muda.
- Nunca duplicar a marca ChefeBot dentro do conteúdo da página — ela já vive na sidebar (desktop) e no topo do bottom-nav-frame (mobile). O conteúdo da página começa direto por uma barra de contexto + título da página.

## Breakpoints

- **< 768px (mobile)**: `PanelShell` mostra bottom nav fixo (3 itens: Pedidos, Conversas, Cardápio — não sobrecarregar com mais itens, o grid é fixo em 3 colunas). Conteúdo em coluna única, `padding` 12–16px.
- **≥ 768px (desktop)**: sidebar fixa de 220px à esquerda; bottom nav some.
- **≥ 1024px**: sidebar cresce para 240px.
- Qualquer novo breakpoint interno de uma página (ex.: colunas lista+detalhe) deve reaproveitar esses dois pontos de corte (768px, 1024px) em vez de inventar um novo.

## Largura de conteúdo — regra que corrigimos na Etapa 1/2

**Nunca usar `maxWidth: 375` (ou qualquer valor fixo em px) como limite de largura do conteúdo de uma página inteira.** Esse foi exatamente o bug que forçava layout de celular no desktop em `/admin`, `/configuracoes`, `/financeiro`, `/relatorios`.

- Largura fluida: o conteúdo ocupa `100%` do espaço restante ao lado da sidebar.
- Se for necessário um teto de largura em telas muito grandes (>1600px), usar algo como `max-width: 1400px; margin: 0 auto;` — nunca um valor de largura de celular.
- `maxWidth: 375`/`390` continua correto apenas dentro de **modais/bottom sheets no mobile** (ex.: sheets de ação em `/pedidos`), não no container da página.

## Grid de cards

- Métricas (4 números-chave): `grid-template-columns: repeat(4, minmax(0,1fr))` no desktop, `repeat(2, minmax(0,1fr))` no mobile. Nunca hardcode `1fr 1fr` sem responder ao breakpoint — isso trava o card pequeno mesmo com espaço sobrando.
- Cards de acesso rápido / navegação secundária: mesma lógica — linha horizontal de 4 no desktop, grid 2×2 no mobile.
- Áreas com conteúdo desigual (ex.: gráfico + ranking) viram 2 colunas no desktop (`1.4fr 1fr` ou similar) e empilham no mobile.

## Cores e tipografia (tokens semânticos — adaptativo Light/Dark)

**A cor do painel agora vem de tokens da Skill [[chefebot-theme]]** (`src/app/globals.css`).
O painel deixou de ser tema fixo escuro: usa o sistema oficial Light (padrão) / Dark.
Nunca hardcode hex — sempre `var(--token)`.

| Papel | Token |
|---|---|
| Fundo página | `var(--background)` |
| Fundo card | `var(--surface)` |
| Borda padrão | `var(--border)` |
| Texto principal | `var(--foreground)` |
| Texto secundário/muted | `var(--foreground-secondary)` / `var(--foreground-muted)` |
| Acento primário (marca) | `var(--primary)` (amarelo `#FFCD00`) — texto sobre ele `var(--primary-foreground)` |
| Texto/ícone com cor de marca | `var(--primary-text)` (nunca `--primary` puro como texto claro) |
| Sucesso | `var(--success)` / WhatsApp `var(--whatsapp)` |
| Pendente/atenção | `var(--attention)` (**roxo**, nunca amarelo) |
| Urgente/erro | `var(--danger)` |
| Info | `var(--info)` |

- **O acento de marca mudou de laranja `#ff6b00` para amarelo `#FFCD00`.** Detalhes e regras
  completas (hierarquia de ações, badges, botões, contraste) em [[chefebot-theme]].
- Fonte: `'Archivo', sans-serif` em todo o painel.
- Título de página: 18–20px / 700. Rótulo de métrica: 10px uppercase / 700 / letter-spacing. Valor de métrica: 22–30px / 800.
- Não introduzir nova paleta por tela — todo card novo reaproveita estes tokens.

## Formulários (telas tipo /configuracoes)

Páginas dominadas por formulário (não grid de métricas/cards) não devem esticar até 1400px.
Usar `max-width: 680px` no container do formulário, alinhado à esquerda da área de conteúdo
(não `margin: 0 auto` centralizado) — o espaço extra à direita em telas grandes é intencional,
evita inputs/labels ilegíveis. Regra de "nunca maxWidth:375" continua valendo — a diferença é
o valor do teto (680px pra formulário, não 375px de celular nem 1400px de dashboard).

## Estados a sempre considerar

Ao desenhar uma tela nova do painel, cobrir pelo menos:
- **Carregando**: mensagem/skeleton simples, sem pulo de layout.
- **Vazio**: quando a lista/métrica não tem dado (ex.: "nenhum pedido hoje"), nunca deixar um card em branco sem explicação.
- **Erro**: mensagem curta com ação de retry quando aplicável (ver padrão do card de WhatsApp em `/admin`).
- **Preenchido**: estado normal com dados reais.

## Acessibilidade e interação

- Item ativo da sidebar/nav: fundo `var(--primary-soft)` + texto escuro (`var(--foreground)`) — nunca depender só de cor sem mudança de peso/fundo, e nunca texto amarelo.
- Áreas clicáveis (cards de navegação) devem ser `<button>`, não `<div onClick>`.
- Ícones decorativos não carregam texto alternativo obrigatório; ícones que são o único conteúdo de um botão precisam de `aria-label` ou texto visível ao lado (o padrão atual sempre acompanha o ícone de um label em texto — manter).

## Processo (regra permanente do projeto)

Antes de implementar qualquer mudança visual nova no painel: gerar o artefato visual (desktop + mobile + estados relevantes) para aprovação, só então codar em patch mínimo e validar que as telas já funcionando (`/pedidos`, `/cardapio`, `/conversas`) continuam idênticas. Ver memória do projeto sobre o fluxo obrigatório de UI/UX.
