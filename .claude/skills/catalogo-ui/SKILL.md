---
name: catalogo-ui
description: Padrão visual dos cards de produto do catálogo do cliente ChefeBot (categorias, foto como elemento principal, botão "+", badges, estados normal/promocional/configurável/sem imagem/indisponível). Use ao criar ou alterar qualquer grid de produtos voltado ao cliente (cardápio, busca, destaques) para manter card, grid responsivo e regra de "adicionar direto vs. personalizar" consistentes.
---

# UI do catálogo de produtos (ChefeBot)

Referência viva para telas que exibem produtos ao cliente final em formato de card com foto (cardápio, listas de destaque, resultados de busca). Usa os mesmos tokens de cor da Skill `cliente-ui` (tema claro, navy + amarelo `#FFCD00`) — não confundir com `admin-ui` (tema escuro/laranja do painel operacional). A gestão de imagem por trás desses cards é feita no painel administrativo e segue os tokens de `admin-ui`, mesmo que o card final apareça com os tokens de `cliente-ui` para o cliente.

## Estrutura do card

1. **Foto** — elemento dominante do card, proporção 1:1, ocupa toda a largura.
2. **Botão "+"** — círculo amarelo com borda branca, sempre no canto inferior direito da foto. Aparência idêntica em todo card; o que muda é o comportamento ao tocar (ver seção de comportamento).
3. **Badge** (opcional, no máximo 1 por card) — canto superior esquerdo da foto.
4. **Nome do produto** — 1–2 linhas, peso 700.
5. **Metadado** — tamanho (P/M/G) para pizzas OU volume (ml/L) para bebidas, nunca os dois juntos.
6. **Preço** — valor fixo para produto simples; `"A partir de R$X"` para produto configurável; preço riscado + novo preço quando há promoção ativa.

## Categorias

Chips horizontais roláveis acima do grid, categoria ativa preenchida em amarelo sólido (`#FFCD00`, texto navy), inativas em contorno neutro. Título de categoria acima de cada grid é só um rótulo separador — nunca um card.

## Grid responsivo

| Breakpoint | Colunas |
|---|---|
| Mobile (< 768px) | 2 |
| Tablet (768–1023px) | 3 |
| Desktop (≥ 1024px) | 4 (1024–1279px) ou 5 (≥ 1280px) |

Gap cresce com o breakpoint (12px mobile → 16px tablet → 18px desktop). Nunca hardcode um número fixo de colunas sem responder ao breakpoint.

## Badges — regra de cor

- **"Oferta"** (promocional): única badge preenchida em amarelo sólido — reservada para promoção real, nunca decorativa.
- **"Mais pedido" / "Só pra você"** (informativa): contorno neutro (fundo branco translúcido, borda cinza clara, texto navy) — no máximo uma por card, nunca competindo com o amarelo da oferta.

## Comportamento — adicionar direto vs. personalizar

Regra permanente, não é só estética:

- **Produtos simples** (bebidas, itens sem variação): tocar no "+" adiciona 1 unidade direto ao carrinho, sem sair da tela.
- **Produtos com opções** (pizzas, qualquer item com tamanho/sabor/borda/variação de preço): tocar no "+" **sempre** abre o fluxo de personalização já existente — **nunca** adiciona uma versão incompleta do produto ao carrinho.
- O único sinal visual de que um produto é configurável é o preço em formato `"A partir de R$X"` + metadado `"Escolha o tamanho"` — o botão "+" em si não muda de aparência entre os dois casos, para manter consistência visual do grid.

## Estados obrigatórios do card

1. **Normal** — foto + nome + metadado + preço fixo.
2. **Promocional** — badge "Oferta" + preço riscado/novo preço.
3. **Configurável** — preço em "A partir de", metadado "Escolha o tamanho".
4. **Sem imagem** — fundo em gradiente suave da marca (amarelo claro → neutro) com o monograma do ChefeBot centrado, nunca um ícone de imagem quebrada.
5. **Indisponível** — foto dessaturada, selo central "Indisponível hoje", botão "+" desabilitado (cinza, sem sombra, sem interação), nome e preço em tom apagado. O card continua visível no grid — produto indisponível não some do catálogo.

## Cores e tipografia

Reaproveita a tabela de `cliente-ui` (fundo `#FAFAF8`, card `#FFFFFF`/borda `#E7E4DC`, texto `#10193A`, acento `#FFCD00`, fonte `Archivo`). Não introduzir paleta nova para o catálogo.

## Imagem de produto — de onde ela vem

O card do cliente só lê `imageUrl` do storage próprio do ChefeBot — nunca chama API externa em tempo de renderização do catálogo. A imagem exibida segue esta prioridade (resolvida e aprovada previamente no painel administrativo):

1. Foto própria enviada pela pizzaria
2. Imagem exata por código de barras, aprovada manualmente
3. Imagem externa aprovada manualmente por busca de nome
4. Imagem ilustrativa (claramente sinalizada como tal fora do card, ex. no modal de detalhe)
5. Fallback visual do ChefeBot (estado "sem imagem" acima)

Detalhe completo da arquitetura (fontes avaliadas, campos de dados, fluxo de aprovação no painel) está documentado no artefato de mockup da etapa de catálogo — ver histórico de design do Perfil do Cliente + Fidelidade + Catálogo.

## Processo (regra permanente do projeto)

Antes de implementar qualquer mudança visual nova no catálogo: gerar o artefato visual (mobile + tablet + desktop + os 5 estados) para aprovação, só então codar em patch mínimo.
