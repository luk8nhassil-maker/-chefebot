---
name: cliente-ui
description: Padrão visual do Perfil do Cliente e da Fidelidade por pontos do ChefeBot (tema claro, navy + amarelo #FFCD00). Use ao criar ou alterar qualquer tela da área do cliente autenticado (/cliente e telas de fidelidade/resgate) para manter hierarquia, tokens de cor, componentes e comportamento responsivo consistentes.
---

# UI da Área do Cliente / Fidelidade (ChefeBot)

Referência viva para as telas voltadas ao cliente final autenticado (perfil + fidelidade), distinta do painel administrativo (`admin-ui`) e do cardápio público. Sempre que uma tela desta área for criada ou sofrer mudança visual relevante, seguir este padrão e atualizar esta Skill se o padrão evoluir.

Para o grid de produtos do catálogo/cardápio (cards com foto, categorias, botão "+"), ver a Skill irmã `catalogo-ui` — ela reaproveita os mesmos tokens de cor definidos aqui.

## Decisão de marca desta área (diferente do resto do app)

Esta área **não** usa o tema escuro/laranja do restante do produto (admin, cardápio). É uma decisão explícita e isolada:

- Tema **claro** como principal (fundo `#FAFAF8`/`#FFFFFF`, texto `#10193A`).
- Acento primário: **amarelo `#FFCD00`**, nunca laranja `#ff6b00`.
- Texto sobre fundo amarelo é sempre navy escuro (nunca branco), para manter contraste.
- Se o app inteiro migrar de tema no futuro, isso é uma decisão à parte — não assumir esse tema como padrão de outras telas sem pedido explícito.

## Regra de negócio da fidelidade (não é "compre N, ganhe 1")

- A cada **R$1 gasto = 1 ponto**.
- Meta = equivalente ao valor de **12 Pizzas Família** (ex.: pizza de referência R$60 → meta de **720 pontos**). A meta é configurável, nunca hardcode `720` fora de config.
- O cliente acumula pontos com **qualquer pedido**, não precisa comprar pizzas específicas.
- Recompensa = 1 Pizza Família até o valor-base configurado; adicionais, borda e taxa de entrega ficam **fora** da recompensa.
- Pontos só entram quando o pedido é **entregue**. Taxa de entrega não gera pontos. Pedido cancelado não gera pontos (mas pode aparecer no extrato como "sem pontos", nunca some silenciosamente — reforça transparência da regra).
- Resgate desconta só os pontos usados; o saldo restante continua guardado.

Qualquer tela desta área que mostrar saldo/progresso deve refletir esse modelo por pontos — nunca voltar à contagem por unidade de pizza.

## Estrutura da tela de perfil

Ordem fixa (não reordenar sem justificativa forte — é a hierarquia de leitura testada no mockup):

1. Topbar discreta (marca + avatar/nome + sair) — sem repetir "Fidelidade" no topo.
2. Saudação curta com o nome do cliente.
3. **Card hero de saldo**: número grande do saldo + regra "A cada R$1 = 1 ponto" em uma linha, dentro do mesmo card.
4. **Card de progresso**: barra + fração atual/meta + "faltam X pontos". No mobile e tablet vem logo após o hero; no desktop fica na coluna esquerda.
5. **Card de próxima recompensa**: ícone + descrição + o que fica de fora (adicionais/borda/entrega).
6. **Card de previsão** (opcional, só quando há pedido em andamento): "Este pedido renderá +X pontos", com borda tracejada para sinalizar que é estimativa.
7. **Extrato**: lista das últimas movimentações, sempre por último — é histórico, não o motivo de abrir a tela.

Quando a meta é atingida, o card de progresso é **substituído** (não duplicado) pelo card de recompensa disponível: fundo navy sólido, selo amarelo, CTA amarelo. É o único lugar da tela com fundo escuro — contraste deliberado para sinalizar um estado especial.

## Breakpoints e layout

- **Mobile (< 768px)**: coluna única, `padding` 18–20px, cards empilhados na ordem da seção acima.
- **Tablet (768–1023px)**: mesma coluna única, mas com mais respiro (`padding` 28–36px) — não introduzir grid de 2 colunas ainda.
- **Desktop (≥ 1024px)**: grid de 2 colunas (`1.35fr 1fr`) — esquerda: hero + progresso (+ previsão); direita: recompensa + extrato. A ordem de leitura continua a mesma, só ganha uma segunda coluna.
- Container de conteúdo: fluido dentro de um teto razoável (ex. `max-width: 1180px` centralizado) — não usar `maxWidth: 420` fixo em telas grandes (mesmo erro documentado em `admin-ui` para o painel).

## Cores e tipografia

| Papel | Valor |
|---|---|
| Fundo de página | `#FAFAF8` |
| Fundo de moldura/sunk | `#F1EFEA` |
| Fundo de card | `#FFFFFF`, borda `#E7E4DC` |
| Texto principal | `#10193A` (navy) |
| Texto secundário | `#5B6478` |
| Texto terciário/hint | `#9AA1B4` |
| Acento primário | `#FFCD00` — só em barra de progresso, badges, ícones de destaque e CTA principal |
| Estado "meta atingida" | Fundo navy sólido `#10193A` + CTA amarelo — único uso de fundo escuro |
| Sucesso discreto (extrato, "+X pontos") | `#1F7A4D` |
| Fonte | `Archivo` (mesma fonte do resto do app) |

Não introduzir uma terceira cor de acento. Semântica de estado (sucesso no extrato) é intencionalmente discreta — não deve competir com o amarelo.

## Componentes de referência

- **Hero de saldo**: número em 800/56–72px, `tabular-nums`, regra da fidelidade em texto pequeno dentro do mesmo card (nunca em card separado).
- **Barra de progresso**: trilho `#F1EFEA`, preenchimento em gradiente amarelo, cantos em pílula (`border-radius: 999px`), altura 12px.
- **Card de recompensa**: ícone em navy sólido (não amarelo — o amarelo é reservado para progresso/CTA), título + subtítulo com o que fica de fora da recompensa.
- **Card de previsão**: borda tracejada, cor neutra — sinaliza "estimativa", não fato consumado. Só renderiza quando existe pedido não entregue.
- **Extrato**: linha com descrição + data à esquerda, delta à direita (`+X` verde, `−X` neutro, `—` cinza para "sem pontos" em cancelamentos).

## Estados a sempre considerar

- **Progresso** (padrão): saldo < meta.
- **Meta atingida / resgate disponível**: card de progresso substituído pelo card navy com CTA.
- **Sem fidelidade ativa**: mensagem curta e neutra, sem quebrar o layout dos outros cards.
- **Carregando**: mensagem simples, sem pulo de layout.
- **Extrato vazio**: cliente novo sem movimentações ainda — mostrar mensagem curta em vez de card em branco.

## Processo (regra permanente do projeto)

Antes de implementar qualquer mudança visual nova nesta área: gerar o artefato visual (mobile + tablet + desktop + estados relevantes) para aprovação, só então codar em patch mínimo. Ver mockup de referência aprovado na etapa de design do Perfil do Cliente + Fidelidade.
