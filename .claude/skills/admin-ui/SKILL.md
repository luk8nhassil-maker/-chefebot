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

## Cores e tipografia (tema fixo do painel — não é adaptativo a light/dark do host)

| Papel | Valor |
|---|---|
| Fundo página | `#060606` |
| Fundo card | `#101010` / gradiente `#101010→#0d0d0d` |
| Borda padrão | `#1f1d1a` |
| Texto principal | `#f4f1ec` |
| Texto secundário/muted | `#a39b8b` / `#6b665c` |
| Texto hint | `#4a4640` |
| Acento primário | `#ff6b00` (laranja da marca) |
| Sucesso | `#4ade80` / WhatsApp `#25d366` |
| Atenção | `#fbbf24` |
| Urgente/erro | `#e05050` / `#f87171` |
| Info secundária | `#3b82f6` (azul), `#8b5cf6` (roxo) — usar só para diferenciar categorias de card de acesso rápido, não como cor de estado |

- Fonte: `'Archivo', sans-serif` em todo o painel.
- Título de página: 18–20px / 700. Rótulo de métrica: 10px uppercase / 700 / letter-spacing. Valor de métrica: 22–30px / 800.
- Não introduzir nova paleta por tela — todo card novo reaproveita esta tabela.

## Estados a sempre considerar

Ao desenhar uma tela nova do painel, cobrir pelo menos:
- **Carregando**: mensagem/skeleton simples, sem pulo de layout.
- **Vazio**: quando a lista/métrica não tem dado (ex.: "nenhum pedido hoje"), nunca deixar um card em branco sem explicação.
- **Erro**: mensagem curta com ação de retry quando aplicável (ver padrão do card de WhatsApp em `/admin`).
- **Preenchido**: estado normal com dados reais.

## Acessibilidade e interação

- Item ativo da sidebar/nav: cor de acento + fundo `rgba(255,107,0,.08)` — nunca depender só de cor sem mudança de peso/fundo.
- Áreas clicáveis (cards de navegação) devem ser `<button>`, não `<div onClick>`.
- Ícones decorativos não carregam texto alternativo obrigatório; ícones que são o único conteúdo de um botão precisam de `aria-label` ou texto visível ao lado (o padrão atual sempre acompanha o ícone de um label em texto — manter).

## Processo (regra permanente do projeto)

Antes de implementar qualquer mudança visual nova no painel: gerar o artefato visual (desktop + mobile + estados relevantes) para aprovação, só então codar em patch mínimo e validar que as telas já funcionando (`/pedidos`, `/cardapio`, `/conversas`) continuam idênticas. Ver memória do projeto sobre o fluxo obrigatório de UI/UX.
