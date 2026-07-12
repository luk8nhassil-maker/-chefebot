# Pesquisa técnica — banco de imagens de produto

Etapa de design do Perfil do Cliente + Fidelidade + Catálogo. Documento de apoio à
arquitetura de imagens de produto do cardápio, aprovado como base junto com o
mockup visual (ver Skill `catalogo-ui`). Nenhum código de produção foi implementado
a partir deste documento — é insumo para a próxima etapa.

## Comparação das fontes avaliadas

| Critério | Open Food Facts | Pexels | Unsplash | Cosmos (Bluesoft) |
|---|---|---|---|---|
| O que é | Banco aberto e colaborativo de produtos industrializados, indexado por código de barras (EAN/UPC) | Banco de fotos de estoque, licença livre | Banco de fotos de estoque, licença livre | Banco brasileiro de produtos por código de barras (comercial) |
| Cobertura BR | Parcial — marcas grandes (Coca-Cola, Guaraná, Heineken) geralmente presentes; produtos regionais/artesanais frequentemente ausentes ou sem foto | Não aplicável — estoque genérico, sem produtos de marca específicos | Não aplicável — mesmo caso do Pexels | Alta — focado especificamente no varejo brasileiro, inclusive marcas regionais |
| Produto exato por busca | Sim, por EAN exato (mesmo item, mesma embalagem) | Não — só imagem ilustrativa/genérica por palavra-chave | Não — mesmo caso do Pexels | Sim, por EAN exato |
| Qualidade da imagem | Irregular — depende do que o contribuidor enviou | Alta e consistente (banco curado) | Alta e consistente (banco curado) | Geralmente boa, foto de catálogo/embalagem padronizada |
| Licença comercial | Dados: ODbL. Imagens: variável por contribuição (majoritariamente CC-BY-SA) — uso comercial permitido, mas com atribuição obrigatória | Pexels License — uso comercial livre | Unsplash License — uso comercial livre | Licença comercial própria, dentro do plano contratado |
| Atribuição obrigatória | Sim, por imagem (varia por contribuidor) | Não exigida legalmente (apreciada, não obrigatória) | Não exigida para a imagem em si, mas as diretrizes de API pedem crédito ao fotógrafo + link, e o uso da API exige registrar o "download" via endpoint próprio | Não aplicável — imagem é do próprio catálogo do fabricante/varejo |
| Chave de API | Não exige chave para leitura | Exige chave (gratuita, cadastro simples) | Exige Access Key + aprovação da Unsplash para sair do modo demo | Exige token pago |
| Custo / limites | Gratuito; uso justo esperado (identificar User-Agent, cachear) | Gratuito; limite por hora no plano padrão | Gratuito, mas modo demo tem limite baixo (dezenas de req/hora); produção exige aprovação para 5.000/hora | Pago — poucas consultas grátis por dia, depois cobrança por consulta/plano |
| Cache permitido | Sim — recomendado pelo próprio termo de uso | Sim, permitido armazenar cópia | Sim, mantendo o crédito junto com a imagem armazenada | Sim, e essencial dado o custo por consulta |
| Risco de imagem errada | Médio — EAN garante o produto certo, mas embalagem pode estar desatualizada | Alto se usado sem revisão — busca por nome pode trazer produto diferente | Alto, mesmo risco do Pexels | Baixo — catálogo mantido comercialmente, atualizado com frequência |
| Estabilidade | Boa, mas projeto comunitário sem SLA formal | Boa, produto comercial (Canva) | Boa, mas política de acesso já mudou no histórico da API | Boa, produto comercial com contrato |
| Uso recomendado | **Prioridade 2** — primeira tentativa para produtos industrializados com código de barras | **Prioridade 4** — banco preferencial para imagem ilustrativa (licença mais simples) | **Prioridade 4 (secundária)** — mesmo uso do Pexels, se a busca lá não retornar nada adequado | **Prioridade 2 (complementar)** — só se o volume de produtos embalados justificar o custo |

## Recomendação final

- **Nenhuma fonte externa publica imagem automaticamente.** Toda sugestão — por
  código de barras ou por busca de nome — cai em fila de aprovação manual no
  painel antes de aparecer no cardápio do cliente.
- **Produto com código de barras:** tentar Open Food Facts primeiro (gratuito,
  sem chave, boa cobertura de bebidas/industrializados) → se não encontrar,
  Cosmos como complemento pago, só se o volume de itens embalados no cardápio
  justificar a assinatura.
- **Produto sem código de barras** (pizzas, itens da casa): não há busca exata
  possível. Foto própria é o único caminho realista; imagem ilustrativa
  (Pexels como padrão, Unsplash como alternativa) serve só como estado
  transitório, sinalizado como "foto ilustrativa" até a pizzaria enviar a foto
  real.
- **Pexels antes de Unsplash:** licença mais simples (sem exigência contratual
  de atribuição), sem processo de aprovação para produção, limite de taxa mais
  confortável no plano gratuito.

## Arquitetura proposta (desacoplada, resolução no servidor)

Ordem de prioridade da imagem exibida ao cliente:

1. Foto própria enviada pela pizzaria (`imageSource = "propria"`)
2. Imagem exata por código de barras, aprovada manualmente (`imageSource = "barcode"`)
3. Imagem externa aprovada manualmente por busca de nome (`imageSource = "externa_aprovada"`)
4. Imagem ilustrativa identificada (`imageSource = "ilustrativa"`) — sinalizada na UI como tal
5. Fallback visual do ChefeBot (`imageSource = "fallback"`)

**Regra central:** a consulta a qualquer API externa acontece só quando o admin
aciona a ação no painel (cadastro/edição de produto ou botão "Buscar imagem") —
nunca no carregamento do cardápio do cliente. O resultado aprovado é baixado e
armazenado no storage próprio do ChefeBot, não apenas referenciado por hotlink.

**Fluxo servidor:**

1. Admin cadastra/edita produto com código de barras → rota server-side chama
   Open Food Facts (depois Cosmos, se configurado) → resultado cru fica em
   cache curto (ex.: Redis, TTL de poucos dias) como *sugestão*, não como
   imagem final.
2. Admin abre "Visualizar sugestões" → vê as opções com licença e origem
   visíveis → aprova uma.
3. Ao aprovar, o servidor baixa o binário da imagem, salva no storage próprio
   já usado pelo projeto e grava os metadados — a partir daí o cardápio do
   cliente lê sempre do storage próprio, nunca da API externa em tempo real.
4. Checagem de link quebrado roda em job periódico (não a cada request) — se
   a imagem falhar ao servir, marca `imageStatus = "quebrada"` e o card cai
   automaticamente para o fallback via `onError` no componente de imagem.

**Compatibilidade com `next/image`:** como a imagem aprovada é baixada para o
storage próprio antes de qualquer exibição ao cliente, não é necessário
liberar domínios externos em `remotePatterns` — o único domínio servido em
produção é o do próprio storage do ChefeBot.

## Campos de dados sugeridos

| Campo | Uso |
|---|---|
| `imageUrl` | URL da imagem final no storage próprio (nunca URL direta da API externa) |
| `imageSource` | `propria` · `barcode` · `externa_aprovada` · `ilustrativa` · `fallback` |
| `imageExternalId` | ID/EAN na fonte original, para re-consultar ou re-baixar se necessário |
| `imageAttribution` | Texto de crédito (ex.: "Foto: João Silva / Open Food Facts") |
| `imageAttributionUrl` | Link de origem, quando a licença pedir referência à fonte |
| `imagePhotographer` | Nome do fotógrafo/contribuidor, quando informado pela fonte |
| `barcode` | Código de barras do produto (EAN/UPC), usado na busca por match exato |
| `imageStatus` | `pendente` · `aprovada` · `quebrada` · `removida` |
| `imageUpdatedAt` | Data da última mudança de imagem/status, para auditoria e para o job de checagem de link |

## Painel administrativo — ações

- **Enviar foto própria:** upload direto, vira `imageSource = "propria"` e
  passa a valer imediatamente (prioridade máxima).
- **Buscar imagem:** aciona a consulta server-side (código de barras primeiro,
  busca por nome como alternativa) e popula a lista de sugestões — nunca
  aplica nada automaticamente.
- **Visualizar sugestões:** lista com miniatura, origem e licença visíveis
  antes de decidir.
- **Aprovar:** baixa a imagem para o storage próprio, grava metadados,
  atualiza `imageStatus = "aprovada"`.
- **Trocar:** descarta a sugestão atual e busca novamente ou permite escolher
  outra sugestão da lista.
- **Remover:** limpa a imagem aprovada, volta o produto para o estado "sem
  imagem" no cardápio.
- **Restaurar fallback:** ação explícita e reversível a qualquer momento, sem
  perder o histórico de qual imagem estava aprovada antes.

## Riscos encontrados

- **Imagem errada por busca de nome:** Pexels/Unsplash não garantem que a
  foto é do produto exato — mitigado por aprovação manual obrigatória antes
  de qualquer imagem por nome ir ao ar.
- **Licença da Open Food Facts:** imagens contribuídas por terceiros sob
  CC-BY-SA exigem atribuição e, em uso de conteúdo derivado, a mesma licença
  — a atribuição precisa existir em algum lugar acessível (ex.: modal de
  detalhe do produto), sem poluir o card minimalista do catálogo.
- **Limite de produção da Unsplash:** uso em produção exige submissão e
  aprovação da própria Unsplash para sair do limite de 50 req/hora do modo
  demo — processo com prazo fora do nosso controle; por isso ela é fonte
  secundária, não primária.
- **Custo da Cosmos:** paga, cobra por consulta/plano — só compensa se o
  cardápio tiver volume relevante de itens industrializados com código de
  barras; caso contrário, Open Food Facts sozinho é suficiente.
- **Hotlink de longo prazo:** depender de URL direta de API externa é frágil
  (link muda, API sai do ar, termos mudam) — mitigado ao baixar e persistir a
  imagem aprovada no storage próprio, usada como única fonte real em
  produção.
- **Cobertura de produtos regionais/artesanais:** nenhuma das quatro fontes
  cobre bem produtos sem código de barras ou de marcas pequenas/regionais —
  por isso a foto própria da pizzaria é prioridade 1, não alternativa
  secundária.
- **Chave de API exposta:** todas as chamadas às fontes pagas/com chave devem
  rodar só no servidor, chave lida de variável de ambiente — nunca embutida
  em código de cliente ou expostas em resposta de API pública.
