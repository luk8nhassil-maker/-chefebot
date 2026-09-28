# COFRE DO CHEFE V1 — Produto, economia e arquitetura

## 1. Objetivo

Transformar Estrelas em uma ferramenta de crescimento para participantes do Ranking do Chefe sem transformar o programa em desconto permanente e sem comprometer margem.

O Cofre não existe para "dar desconto". Ele existe para escolher a próxima melhor ação comercial para cada cliente e só permitir benefício financeiro quando houver proteção econômica comprovada.

## 2. Decisões aprovadas

1. O Cofre é exclusivo para clientes que participam do Ranking.
2. Estrelas conquistadas na temporada e Estrelas disponíveis para gastar são conceitos diferentes.
3. Gastar Estrelas no Cofre reduz apenas o saldo disponível.
4. Gastar Estrelas não reduz o score já conquistado no Ranking.
5. Estorno/correção de uma conquista inválida continua podendo reduzir score.
6. O sistema compara o cliente principalmente com o próprio histórico.
7. Cliente que já compraria normalmente não deve receber desconto desnecessário.
8. Sem CMV, margem, orçamento e regra econômica aprovados, benefício financeiro fica bloqueado.
9. Nenhum valor comercial pode ser inventado pelo motor.
10. Nesta fase não existe aplicação de cupom real, débito real de Estrelas ou alteração de checkout.

## 3. Achados da main que orientam a arquitetura

### Reaproveitar

- O ledger de Estrelas vive no domínio de fidelidade por pontos, com extrato, saldo, locks, idempotência, reservas e reversão.
- O Ranking já calcula score por temporada a partir desse ledger.
- O histórico analítico já registra pedidos entregues com cliente derivado, valor elegível, canal, data operacional e Estrelas geradas.
- O Ranking já possui posição, Top 3, alvo de ultrapassagem, Coroa e consentimento.
- O cardápio/promocões já trabalha com IDs de produto e validação server-side.

### Não reaproveitar como fundação nova

A Jornada do Chef está marcada como descontinuada na main. O Cofre não deve criar dependência nova de jornada:* nem usar a antiga carteira como novo sistema oficial.

## 4. Modelo mental

O cliente vê duas coisas:

- Conquistadas na temporada: tudo que já valeu para o Ranking.
- Disponíveis no Cofre: saldo que ainda pode ser usado em vantagens.

Exemplo conceitual:

- conquistou 80 Estrelas;
- gastou 20 no Cofre;
- Ranking continua 80;
- Cofre passa a mostrar 60 disponíveis.

## 5. Motor de Próxima Melhor Ação

O motor não começa procurando um cupom. Primeiro decide se existe algum comportamento que vale a pena provocar.

Possíveis decisões:

### coletando_dados

Ainda não existe histórico suficiente para comparar o cliente com ele mesmo. Nenhum desconto é inventado.

### sem_incentivo

O comportamento está normal. A melhor decisão econômica é não subsidiar uma compra que provavelmente aconteceria de qualquer forma.

### retorno

O cliente está demorando mais do que o próprio intervalo normal de recompra. Pode fazer sentido oferecer uma oportunidade de retorno, desde que a economia passe no guard.

### aumentar_ticket

O ticket recente ficou materialmente abaixo do padrão do próprio cliente. Pode fazer sentido condicionar uma vantagem a um pedido mínimo maior.

### podio_exclusivo

Cliente Top 3 recebe status/exclusividade. Isso não significa desconto obrigatório. A vantagem pode ser acesso, prioridade ou uma oferta econômica previamente aprovada.

## 6. Dados usados

Primeira camada, já disponível no ChefeBot:

- pedidos entregues;
- valor elegível por pedido;
- data/hora operacional;
- intervalo entre compras;
- ticket médio e mediano;
- ticket do último pedido;
- posição no Ranking;
- participação no Ranking;
- Estrelas conquistadas;
- Estrelas disponíveis.

O motor não precisa de nome, endereço, telefone em claro ou conteúdo completo do pedido para decidir recorrência/ticket.

## 7. Comparar o cliente com ele mesmo

O sinal mais útil de retorno não é "X dias sem comprar" para todos.

Exemplo conceitual:

- cliente A normalmente compra a cada 7 dias;
- cliente B normalmente compra a cada 20 dias.

Depois de 12 dias, A pode estar atrasado e B pode estar completamente normal.

A V1 recebe parâmetros comportamentais configuráveis e não possui thresholds comerciais hardcoded.

## 8. Proteção econômica

Todo benefício financeiro passa por um guard server-side.

Entradas obrigatórias:

- receita elegível oficial do pedido;
- CMV/custo oficial;
- custos variáveis considerados na política;
- custo do benefício;
- margem mínima que deve sobrar;
- orçamento restante da campanha/período;
- aprovação explícita de cobertura econômica;
- verificação de outra promoção incompatível.

Regra:

benefício só é liberável quando:

1. cobertura econômica está aprovada;
2. todos os dados econômicos existem;
3. o benefício é válido;
4. orçamento suporta o custo;
5. margem depois do benefício continua acima do piso aprovado;
6. não existe promoção incompatível.

Qualquer ausência bloqueia. Não há fallback otimista.

## 9. Configuração das ofertas

O motor só escolhe entre ofertas previamente configuradas.

Uma oferta futura pode declarar:

- ID estável;
- ação comportamental associada;
- ativa/inativa;
- Estrelas necessárias;
- pedido mínimo;
- restrição ao Pódio;
- tipo de benefício;
- validade;
- regras de combinação.

O motor nunca cria sozinho:

- R$ de desconto;
- percentual;
- quantidade de Estrelas;
- pedido mínimo;
- produto grátis;
- validade.

Esses dados são regras de negócio.

## 10. Reserva e gasto de Estrelas

Quando a fase de resgate real for aprovada, usar o mesmo princípio já validado no ledger atual:

1. cliente escolhe a vantagem;
2. servidor revalida saldo e elegibilidade;
3. Estrelas são reservadas, não gastas imediatamente;
4. checkout recalcula preço oficial;
5. guard econômico revalida o pedido final;
6. pedido é criado;
7. só então o resgate é confirmado;
8. cancelamento/reversão devolve o saldo de forma idempotente.

O Ranking não deve ser recalculado para baixo por causa do resgate.

## 11. Antifraude e antirregressão

- servidor é autoridade;
- navegador nunca envia preço confiável;
- benefício tem ID/configuração server-side;
- reserva e confirmação precisam ser idempotentes;
- um pedido cancelado não pode manter vantagem indevida;
- item grátis/desconto não pode gerar Estrelas sobre valor não pago;
- promoções incompatíveis não acumulam;
- Preview não escreve Redis de produção;
- Preview não cria pedido/Pix/WhatsApp/impressão;
- nenhuma vantagem real existe sem cobertura econômica.

## 12. UX do Cofre

O Cofre deve mostrar poucas oportunidades e um único foco principal.

Estrutura proposta:

- cabeçalho: Cofre do Chefe;
- Estrelas disponíveis;
- Estrelas conquistadas na temporada;
- "melhor oportunidade agora";
- até poucos cards de vantagem, nunca uma lista infinita;
- estados claros: bloqueado, quase liberado, disponível, reservado;
- Top 3 pode receber sinal visual exclusivo;
- quando não fizer sentido incentivar, o sistema pode simplesmente não mostrar desconto.

O cliente sente progresso; a pizzaria mantém controle econômico.

## 13. Aprendizado do sistema

Registrar futuramente, sem PII desnecessária:

- oferta exibida;
- oferta ativada;
- oferta ignorada;
- pedido concluído com oferta;
- pedido concluído sem oferta;
- ticket antes/depois;
- custo do benefício;
- margem estimada/aprovada;
- retorno após oferta;
- frequência de uso.

O objetivo é descobrir quais incentivos geram venda incremental e quais apenas entregam margem para pedidos que aconteceriam sozinhos.

## 14. Métricas de sucesso

O Cofre não deve ser julgado por "quantos cupons foram usados".

Métricas principais:

- aumento de ticket elegível;
- redução do tempo de retorno quando havia atraso real;
- receita incremental por custo de benefício;
- margem depois do benefício;
- percentual de clientes que compraram sem precisar de incentivo;
- custo de benefício por pedido incremental;
- repetição de compra após uso;
- participação/engajamento do Ranking sem inflação artificial de desconto.

## 15. Fases

### Fase 0 — branch/Preview (esta implementação)

- motor comportamental puro;
- guard econômico puro;
- separação score competitivo x saldo gastável;
- documentação;
- Preview com fixtures;
- zero efeito real.

### Fase 1 — leitura real, ainda sem resgate

**IMPLEMENTADA NESTA BRANCH, MAS DESLIGADA POR PADRÃO.**

- read-model autenticado em `/api/cliente/cofre`;
- usa somente o cliente derivado da sessão — não aceita clienteId arbitrário;
- lê o ledger atual de Estrelas;
- lê o histórico analítico somente desse cliente;
- lê a temporada ativa por caminho estritamente read-only;
- calcula a posição entre participantes do Ranking sem expor identidades;
- expõe score conquistado da temporada separado do saldo disponível;
- não cria/reserva/debita Estrelas;
- não cria cupom;
- não escreve analytics, Ranking, temporada ou fidelidade;
- não ativa thresholds de retorno/ticket vindos das fixtures;
- benefícios financeiros continuam bloqueados;
- endpoint real exige `COFRE_CHEFE_READMODEL_ATIVO=true` no servidor; ausência/qualquer outro valor retorna 404.

Próximo uso seguro desta fase: observar distribuição dos sinais reais e calibrar thresholds com dados suficientes antes de transformar qualquer classificação em regra comercial.

### Fase 1.5 — calibração observacional

**IMPLEMENTADA NESTA BRANCH, DESLIGADA POR PADRÃO.**

- endpoint admin `/api/admin/cofre/calibracao`;
- roles permitidas: admin/dev;
- release gate separado: `COFRE_CHEFE_CALIBRACAO_ATIVA=true`;
- períodos permitidos: 30, 60 ou 90 dias;
- usa uma leitura agregada do analytics e o Ranking atual;
- considera somente participantes ativos do Ranking;
- não devolve clienteId, telefone ou nome;
- mede distribuição de intervalos entre pedidos;
- mede distribuição do gap atual contra a mediana individual;
- mede ticket elegível;
- mede último ticket contra a mediana dos pedidos anteriores;
- informa cobertura observada e quantidade de clientes com base suficiente;
- nunca transforma p25/p50/p75/p90 em threshold operacional;
- `ativacaoAutomatica.permitida` permanece sempre `false` nesta fase.

A calibração responde à pergunta "o que os dados mostram?". A decisão "qual regra comercial usar?" continua separada e depende de evidência suficiente + aprovação econômica.

### Fase 2 — configuração econômica

- cadastrar CMV/custos oficiais;
- definir piso de margem;
- orçamento;
- ofertas canário;
- aprovação comercial explícita.

### Fase 3 — canário

- poucos clientes;
- reserva real de Estrelas;
- checkout revalida;
- sem WhatsApp automático no primeiro ciclo;
- telemetria e rollback.

### Fase 4 — expansão

Só depois de provar que o benefício gera resultado incremental sustentável.

## 15.1 Estado técnico desta branch

- PR: #467 (DRAFT).
- Main não recebe nenhuma alteração nesta etapa.
- Preview continua baseado em fixture isolada.
- O read-model real existe no código, mas o release gate server-side está fechado por padrão.
- A calibração agregada também existe, com release gate próprio fechado por padrão.
- Nenhum dado real precisa ser escrito para validar a Fase 1.
- A antiga Jornada do Chef continua fora da arquitetura nova.
- Fonte de saldo: ledger atual de Estrelas.
- Fonte de comportamento: analytics por cliente.
- Fonte competitiva: Ranking/temporada existentes.
- Fonte econômica: ainda não configurada; por isso o guard financeiro permanece bloqueado.

## 16. Informações ainda faltantes para ativação real

Não preencher por suposição:

- CMV por produto/categoria;
- custos variáveis que devem entrar na conta;
- margem mínima aceitável por pedido;
- orçamento máximo de benefício por período;
- limites de frequência de cupom;
- regras de combinação com promoções;
- catálogo de ofertas reais;
- quantidade de Estrelas por oferta;
- validade dos cupons.

Enquanto isso não existir, o sistema deve permanecer economicamente bloqueado.

## 17. Princípio final

O Cofre deve saber três coisas:

1. quando incentivar;
2. quanto pode custar;
3. quando é melhor não oferecer nada.

Se o sistema não consegue provar que a vantagem é segura, ele não libera a vantagem.
