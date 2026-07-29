# Auditoria de sincronização — São Francisco → ChefeBot

Data da auditoria: 2026-07-29

## Escopo e referências imutáveis

- Destino público: `luk8nhassil-maker/-chefebot`
- Base auditada do destino: `526fc51dcd99f6adeffaa4f201355977230c2ada`
- Referência privada: `pizzariasaofrancisco2026-afk/pizzaria-sao-francisco`
- Base auditada da referência: `78abbf39096c1268c636202ab92e461a9a8f4dd0`
- Esta sincronização porta somente comportamento validado. Catálogo, credenciais, dados, identidade, URLs e infraestrutura da Pizzaria São Francisco não pertencem ao ChefeBot.
- Contratos protegidos no destino: Pix, WhatsApp real, Perfil/Fidelidade 3.0, Modo Sobrevivência, identidade visual e namespace Redis.
- PRs de destino serão apenas de revisão. Não haverá merge, publicação em Production ou alteração direta de `main`.

## Matriz de decisão

| Melhoria | PR(s) de origem | Estado no ChefeBot auditado | Decisão | Arquivos/áreas previstos | Contratos preservados | Risco | Teste de regressão/validação |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Remover dependência de servidor do módulo de cardápio usado no cliente | #9 | `src/lib/menu.ts` importa Redis e também é importado por `MenuCard.tsx` | Portar com separação `menu.ts`/`menu.server.ts` | `src/lib/menu.ts`, novo `src/lib/menu.server.ts`, imports de rotas e serviços | Catálogo e chaves Redis permanecem os oficiais do ChefeBot | Médio: quebra de bundle ou import circular | Teste de módulo client-safe, typecheck e build |
| Não vender com cardápio antigo quando a leitura dinâmica falhar | #9, #47 | Leitura Redis cai silenciosamente no cardápio estático em qualquer erro | Portar; fallback estático somente para chave realmente ainda não inicializada, nunca para falha de Redis | `menu.server.ts`, `/api/cardapio`, consumidores do cardápio | Nenhuma mudança de catálogo; indisponibilidade é explícita e segura | Alto: indisponibilidade temporária em vez de preço antigo | Testes de chave ausente, erro Redis e resposta 503 |
| Atualizar Next.js para correções de segurança | #3 | Next `16.2.7`; auditoria registra vulnerabilidades corrigidas em `16.2.11+` | Portar versão mínima corrigida e manter compatibilidade atual | `package.json`, `package-lock.json` | Sem mudança funcional de Pix/WhatsApp/Survival | Médio: regressão de framework | `npm audit --omit=dev`, testes focados e build |
| Remover `next-pwa` não utilizado | #3 | Dependência presente, sem configuração/uso, trazendo cadeia Workbox/Webpack antiga | Portar | `package.json`, `package-lock.json` | Nenhum service worker funcional será removido | Baixo | Busca de uso, instalação limpa e build |
| Atualizar dependências transitivas vulneráveis compatíveis | #3 | `postcss` e `sharp` transitivos desatualizados | Portar apenas overrides validados e compatíveis | `package.json`, `package-lock.json` | Sem alterar pipeline de negócio | Médio | `npm audit --omit=dev`, build de imagens e rotas |
| Normalizar espaços em credenciais administrativas | #10 | Usuário é normalizado por caixa, mas não por espaços | Portar somente `trim`; não importar aliases/usuários da referência | `src/lib/auth.ts`, testes de autenticação | Usuários, hashes, cookies e política do ChefeBot | Baixo | Testes com espaços e credenciais inválidas |
| Cabeçalho de impressão sem quebra | #44 | Delimitador longo pode quebrar em bobina estreita | Portar CSS `nowrap` e delimitador menor, mantendo marca | impressão de pedido | Nome e identidade Chefe da Pizza | Baixo | Build e inspeção da marcação de impressão |
| Leitura paralela de configuração, cardápio e estoque no webhook | #47 | Três leituras sequenciais aumentam latência | Portar | `/api/whatsapp/route.ts` | Protocolo, número e persistência do WhatsApp oficial | Médio: ordem de tratamento de erro | Teste de carregamento concorrente e erro seguro |
| Reduzir atrasos artificiais do WhatsApp | #47 | Atrasos de 400–600 ms, 900–2500 ms, 150/300 ms e 800 ms | Portar faixas validadas sem remover ordenação de mensagens | `/api/whatsapp/route.ts` | Conteúdo, destinatário e idempotência de envio | Médio: rate limit/ordem | Testes com timers falsos e revisão do encadeamento |
| “Adicionar outro” preserva carrinho e abre categorias | #47, #48 | Números adicionam bebidas diretamente no estado atual | Portar com uma subetapa explícita de categorias | `src/lib/bot.ts`, tipos de sessão, testes | Carrinho, preço oficial e fluxo existente | Alto: número ambíguo pode adicionar item errado | Regressão primeiro: ação `1` abre categorias; escolha posterior seleciona categoria; carrinho intacto |
| Priorizar ação sobre número de categoria | #48 | `1` tem significado de produto/categoria antes da intenção de adicionar | Portar na subetapa de “adicionar outro” | `src/lib/bot.ts` | Demais etapas numéricas permanecem inalteradas | Médio | Testes com `1`, `sim`, `quero`, `mais`, categoria e fechamento |
| Listar todas as bebidas disponíveis em blocos | #49 | Lista única, sem agrupamento/paginação robusta | Portar agrupamento e blocos de até oito itens com numeração contínua | `src/lib/bot.ts` | Esgotados, nomes e preços do cardápio oficial | Médio | Testes com mais de oito bebidas, estoque e escolha inválida |
| Fluxos de pizza, inválidos e entrega já robustos | #14–#16 | Comportamento equivalente já presente | Não portar código redundante; manter testes existentes | `src/lib/bot.ts` | WhatsApp oficial integral | Baixo | Rodar regressões focadas existentes |
| Horário de atendimento em fonte única | #11–#13, #25 | Cálculo duplicado; UI pública diz sempre “Aberto agora”; servidor aceita pedido novo fora do horário | Portar helper client-safe e normalização comum | novo `src/lib/horarioFuncionamento.ts`, configuração, cardápio, WhatsApp, pedido-app | Configuração oficial e pedidos idempotentes | Alto: bloqueio indevido de retry | Testes de abertura, fechamento, virada de dia, 24h e limite exato |
| Bloquear somente nova criação fora do horário | #25 | `pedido-app` não aplica horário na fronteira de criação | Portar após recuperação idempotente e antes de novos efeitos | `/api/pedido-app/route.ts` | Fases do Modo Sobrevivência, recuperação e Pix existentes | Crítico | Testes: pedido novo bloqueado; replay/recuperação continuam possíveis |
| Cardápio navegável quando fechado e status automático discreto | #25, #37–#40 | Cardápio navegável, mas status é fixo | Portar somente o status e mensagem; não bloquear navegação | `/cardapio`, `/api/cardapio` | Tema, marca, catálogo e CTA atuais | Baixo | Testes unitários do helper, build e acessibilidade |
| Compra contínua, quantidade, contador/total fixos e construtor direto | #37–#40 | Já existem de forma equivalente | Não duplicar | `/cardapio` | UX e identidade atuais | Baixo | Preservar testes/build; smoke local |
| Sabores simplificados, terceiro sabor substitui segundo | #37–#40 | Já existe de forma equivalente | Não duplicar | `/cardapio` | Regras e preços atuais | Baixo | Regressões do construtor atual |
| “A partir de” e acréscimo somente real | #37–#40 | Já existe: preço-base e acréscimo de leite | Não duplicar | `/cardapio` | Precificação oficial | Baixo | Revisão do cálculo e build |
| Acessibilidade por clique, Enter e Espaço | #42 | Cartões clicáveis usam `div` sem papel/teclado | Portar de forma mínima | opções clicáveis em `/cardapio` | Layout e tema permanecem idênticos | Médio: duplo disparo | Testes de teclado e lint focado |
| Sessão de cliente persistente até “Sair” | #36 | Token frontal fica apenas em `sessionStorage` | Portar com `localStorage`, migração e limpeza dupla | `clienteSessaoFront.ts`, telas de login/logout, testes | JWE/cookie opaco e autenticação oficial | Alto: sessão antiga ou logout incompleto | Testes de migração, renovação, leitura e logout |
| Retomar Pix somente autenticado e como dono do pedido | #34, #35 | Lista de pedidos não informa retomada; barra atual depende de estado local | Portar rota autenticada por pedido, resumo sanitizado e UI | APIs `/cliente/pedidos`, nova rota de pagamento Pix, `/cliente/pedidos` | Geração/confirmação Pix não é alterada; ownership obrigatório | Crítico | Testes de sem sessão, outro cliente, expirado, confirmado e payload válido |
| Não exibir ação Pix falsa | #35 | UI pode depender de estado local sem payload retomável garantido | Portar `podeRetomar` somente com payload ativo real | serialização da lista e UI do cliente | Estado Pix oficial | Alto | Testes com payload ausente/inativo e pedido já pago |
| CRUD seguro de cardápio | #17–#24, #26, #32, #41 | Configuração envia objeto inteiro; API aceita corpo sem validação suficiente | Portar validação server-side e edição granular; rejeitar catálogo inválido | `/configuracoes`, `/api/cardapio`, validações e testes | Catálogo oficial; esgotado continua separado | Alto | Testes de payload parcial/inválido, duplicatas, último bairro e preservação |
| Confirmação antes de excluir | #17–#24 | Exclusões locais são imediatas | Portar para entidades editáveis | `/configuracoes` | Sem apagar dados sem ação explícita | Médio | Teste de cancelamento/confirmação |
| Esgotado separado de edição de cadastro | #17–#24 | `/cardapio` administrativo já trata estoque separadamente | Manter; não misturar no CRUD | `/cardapio` admin, configuração | Chave e comportamento de estoque | Baixo | Regressões atuais |
| Preço ao vivo e recálculo no admin | #17–#24, #45 | Há edição parcial; pedido manual aceita total do cliente | Portar especialmente para pedido manual, com servidor autoritativo | `/pedidos`, `/api/orders`, `pedidoAppItens.ts` | Preço oficial e Pix criado a partir do total recalculado | Crítico | Testes de adulteração de total/preço, item inexistente e esgotado |
| Bairros com edição segura | #17–#24 | Apenas adição/exclusão, sem salvaguardas completas | Portar edição individual, número válido, unicidade e ao menos um bairro | configuração e API | Taxas oficiais | Alto | Testes de duplicata, número inválido e exclusão do último |
| Horário sem controles concorrentes/duplicados | #25 | Mais de uma área controla configuração relacionada | Consolidar no formulário oficial sem criar nova fonte | configuração e helper de horário | Configuração existente | Médio | Teste de round-trip da configuração |
| Pedido manual estruturado pelo catálogo oficial | #45 | Formulário envia `string[]` e total/taxa confiados ao cliente | Portar itens estruturados, seletor oficial e recálculo no servidor; manter leitura legada apenas para compatibilidade | novo componente de pedido manual, `/pedidos`, `/api/orders` | Pix e persistência de pedidos existentes | Crítico | Regressão primeiro: total adulterado é ignorado; preço/taxa oficiais vencem |
| Calzone por sabor | #46 | `officialUnitPrice` já exige sabor e usa a lista oficial de sabores | Equivalente; apenas garantir suporte no novo seletor manual | pedido manual e testes | Modelo de item atual | Médio | Teste de calzone sem/com sabor e indisponibilidade |
| Polling pausado com aba oculta | #5–#7, #27 | Algumas telas consultam em 3 s continuamente; outras já respeitam visibilidade | Portar apenas onde falta, sem alterar telemetria/Redis | pedidos, histórico, sessões e rastreio conforme auditoria final | Telemetria e Modo Sobrevivência | Médio | Testes com `visibilitychange`, timers falsos e desmontagem |
| Backup/telemetria/idempotência operacional | #5–#7 | ChefeBot já possui runbooks, telemetria e arquitetura própria | Não duplicar infraestrutura; apenas corrigir lacunas locais comprovadas | docs/operations e pontos de polling | Autoridade do Modo Sobrevivência | Alto se duplicado | Build, testes focados e revisão documental |
| Índice ativo/concor­rência da chave `pedidos` | #5–#7 e PR destino #252 | Decisão de concorrência ainda aberta; PR #252 não incorporado | Fora desta sincronização | nenhuma alteração | Modo Sobrevivência e chave `pedidos` | Crítico | Nenhum patch até decisão específica |
| Integrações externas da referência | #27 e outros | Ambientes e contratos não são equivalentes | Auditar apenas; não copiar tokens, URLs, IDs ou webhooks | documentação de auditoria | Infraestrutura oficial do ChefeBot | Crítico | Busca por identificadores da referência no diff |
| Alteração Pix removida e revertida | #30, revertida exatamente por #31 | Pix do ChefeBot é protegido e funcional | Excluir integralmente | nenhuma alteração Pix de negócio | Pix oficial | Crítico | Busca de diff e regressões existentes |
| PR de referência ainda em rascunho | #43 | Não validado/mergeado na referência | Excluir | nenhuma alteração | Todos | Alto | N/A |
| Conteúdo de PR fechado e republicado | #33, republicado em #37 | Só considerar o comportamento validado em #37 | Não portar o PR fechado isoladamente | `/cardapio` apenas se houver gap equivalente | Identidade e conteúdo oficiais | Baixo | Rastreabilidade pela origem efetiva |
| Mudanças efêmeras/substituídas | #28, #29 | Sem estado final validado aplicável | Excluir | nenhuma alteração | Todos | Médio | N/A |
| Catálogo, dados e identidade São Francisco | múltiplos | Não pertencem ao destino | Excluir explicitamente | qualquer arquivo de dados/branding | Marca Chefe da Pizza/ChefeBot | Crítico | Busca por nomes, telefones, URLs, IDs e dados da referência |

## Agrupamento planejado de patches/PRs

1. **Fundação e segurança:** módulo de cardápio client-safe/server-only, falha explícita, dependências, autenticação por `trim` e impressão.
2. **WhatsApp e horário:** carregamento concorrente, latência, adicionar-outro, bebidas e fonte única de horário.
3. **Cardápio público:** status de horário e acessibilidade por teclado; demais itens já equivalentes ficam intocados.
4. **Área do cliente:** persistência de sessão e retomada Pix autenticada/com ownership.
5. **Admin e pedido manual:** CRUD validado e itens estruturados com preço/taxa oficiais no servidor.
6. **Performance e operação:** polling consciente de visibilidade e atualização documental, sem duplicar infraestrutura.

Cada grupo terá teste de regressão antes do patch funcional, diff revisado, commit atômico e validação focada. Os PRs podem ser empilhados quando houver dependência real; nenhum será mesclado por esta execução.

## Baseline técnico

- `npm ci`: concluído com cache isolado.
- `npm run build`: aprovado na base, com avisos esperados de Redis ausente no ambiente local.
- `npm run lint`: baseline reprovado com 252 ocorrências preexistentes (193 erros e 59 avisos); cada patch será validado por lint focado nos arquivos alterados.
- `npm test`: a suíte agregada contém cenários com URLs externas/semântica de produção e não será executada contra serviços reais. Serão usados apenas testes locais inspecionados, com mocks e sem rede.
- `npm audit --omit=dev`: 24 vulnerabilidades altas e nenhuma crítica na base; a fundação deve reduzir esse total sem ampliar o escopo.

## Critérios globais de aceite

- Nenhum dado, identidade, credencial, URL, telefone ou recurso da Pizzaria São Francisco no diff.
- Nenhuma alteração de regras internas de geração/confirmação Pix, namespace de Perfil/Fidelidade ou fases do Modo Sobrevivência.
- Pedido novo fora do horário é bloqueado no servidor; replay e recuperação idempotentes continuam válidos.
- Totais e taxas de pedido manual são calculados no servidor a partir do cardápio oficial.
- Retomada Pix exige sessão válida, ownership e payload ativo real.
- Falha de Redis não é mascarada por um catálogo estático possivelmente antigo.
- Build completo aprovado; testes focados e lint dos arquivos alterados aprovados.
- Somente previews do projeto oficial `chefebot-pjif`, caso a permissão de escrita/deploy de preview seja disponibilizada.
