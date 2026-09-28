# CUSTOMER 360 — CAMADA COMPORTAMENTAL V1

## Objetivo

Construir uma linha do tempo comportamental que permita entender o que acontece
antes, durante e depois de uma compra sem transformar o navegador em autoridade
financeira e sem espalhar PII em cada evento.

Esta fase coleta e organiza sinais. Ela NÃO decide cupom, desconto, margem ou
tratamento comercial automaticamente.

## Separação de autoridade

### Observado pelo navegador

Pode registrar somente comportamento:

- abertura do app/site;
- ida para segundo plano e retorno;
- visualização de rota pública;
- etapa do funil;
- busca usada (somente tamanho da busca, nunca o texto);
- interação com produto por ID técnico quando disponível;
- aumento/redução do carrinho;
- saída observada durante checkout;
- abertura do Ranking;
- abertura futura do Cofre.

### Fato do servidor

Somente o backend pode registrar:

- pedido realmente criado;
- valor oficial do pedido em centavos;
- quantidade oficial de itens;
- forma de pagamento categorizada;
- tipo de entrega;
- vínculo da sessão com o cliente canônico.

O endpoint público nunca aceita "order_created", pagamento confirmado, Pix pago,
preço oficial ou clienteId enviado pelo navegador como fato.

## Identidade

A sessão do navegador usa UUID opaco guardado em sessionStorage.

Não existe identificador anônimo permanente cross-session nesta V1.

Quando o servidor consegue identificar o cliente, o clienteId canônico é
transformado em HMAC:

- armazenamento comportamental recebe customerRef pseudonimizado;
- telefone não entra no evento;
- nome/apelido não entram no evento;
- endereço não entra no evento;
- clienteId bruto não entra no evento.

Quando uma sessão começa anônima e depois se identifica, a sessão inteira pode
ser recuperada como parte da linha do tempo daquele cliente sem reescrever os
eventos anônimos anteriores.

Se a mesma sessionId aparecer vinculada a dois clientes diferentes, a gravação
falha fechada e o navegador recebe instrução para gerar uma nova sessão.

## Dados explicitamente não coletados

- senha;
- OTP;
- tokens de autenticação;
- QR/Payload/chave Pix;
- dados de cartão;
- telefone bruto dentro da trilha comportamental;
- nome/apelido dentro da trilha comportamental;
- endereço;
- observação do pedido;
- texto livre da busca;
- conteúdo de WhatsApp;
- localização GPS precisa;
- conteúdo digitado em formulários.

## Eventos V1

Eventos observados:

- app_open
- app_background
- app_resume
- page_view
- funnel_step
- search_used
- product_open
- cart_add
- cart_remove
- checkout_exit_observed
- ranking_open
- cofre_open

Fato server-side:

- order_created

## Estrutura Redis

Todos os dados respeitam retenção configurada.

- behavior:event:{tenant}:{eventId}
- behavior:session:{tenant}:{sessionId}
- behavior:session:start:{tenant}:{sessionId}
- behavior:session:owner:{tenant}:{sessionId}
- behavior:day:{tenant}:{YYYYMMDD}
- behavior:sessions:day:{tenant}:{YYYYMMDD}
- behavior:stage:{tenant}:{stage}:{YYYYMMDD}
- behavior:counter:{tenant}:{YYYYMMDD}
- behavior:customers:day:{tenant}:{YYYYMMDD}
- behavior:customer-sessions:day:{tenant}:{YYYYMMDD}
- behavior:customer:sessions:{tenant}:{customerRef}:{YYYYMM}

Não existe SCAN como fonte principal de leitura.

## Release gate

A coleta real só existe quando TODOS os itens estiverem configurados:

- BEHAVIOR_ANALYTICS_ENABLED=true
- BEHAVIOR_ANALYTICS_HMAC_SECRET com segredo server-side >= 32 caracteres
- BEHAVIOR_ANALYTICS_RETENTION_DAYS com inteiro positivo explícito
- ambiente não é Vercel Preview

Não existe retenção padrão inventada pelo código.

Em Vercel Preview a gravação é bloqueada pelo módulo server-side mesmo que outras
variáveis estejam presentes.

## Métricas produzidas

Overview agregado:

- sessões;
- clientes identificados;
- sessões identificadas;
- sessões com busca;
- sessões com carrinho;
- sessões que chegaram ao checkout;
- saídas observadas no checkout;
- sessões convertidas;
- sessões sem pedido;
- carrinhos sem pedido;
- checkouts sem pedido;
- taxa de conversão de sessão.

Linha do tempo individual pseudonimizada:

- sessões do cliente;
- início/fim da sessão;
- eventos em ordem;
- sessão convertida ou não;
- inclui eventos anônimos anteriores à identificação quando pertencem à mesma
  sessão posteriormente vinculada.

## Vetor comportamental

A camada pura behaviorInsights transforma eventos em sinais sem tomar decisão
comercial:

- sessões;
- dias ativos;
- sessões sem pedido;
- carrinhos sem pedido;
- checkouts sem pedido;
- conversões;
- duração média;
- buscas;
- produtos abertos;
- adições/remoções do carrinho;
- saídas observadas do checkout;
- Ranking/Cofre abertos;
- primeira/última atividade;
- última compra;
- sessões desde a última compra.

Isso é matéria-prima para um futuro modelo de intenção. Nesta V1 não existe
score mágico, probabilidade inventada nem threshold comercial automático.

## Cardápio instrumentado

O cardápio registra:

- mudança real de profundidade do funil;
- busca por categoria/sabor sem texto bruto;
- interação com produto por ID estável quando disponível;
- mudança agregada no carrinho;
- saída observada nas etapas Entrega/Pagamento;
- behaviorSessionId opaco enviado junto ao POST do pedido.

O servidor confirma order_created depois de o pedido existir e de os efeitos
críticos do fluxo estarem consistentes.

## Ranking

Abrir a tela real do Ranking gera ranking_open. Preview /dev não gera esse
evento.

## Segurança operacional

- observabilidade é best-effort;
- falha de analytics nunca bloqueia UX;
- analytics nunca altera preço;
- analytics nunca cria pedido/Pix;
- analytics nunca altera estoque;
- analytics nunca credita fidelidade;
- analytics nunca envia WhatsApp;
- navegador nunca é autoridade financeira.

## Estado da ativação

Nesta branch a arquitetura e instrumentação existem, mas nenhuma variável de
produção é criada ou alterada. Portanto a coleta real permanece desligada até
uma decisão explícita de ativação e configuração da retenção/segredo.
