# Privacidade do ranking — auditoria e patch seguro

Data da revisão: 2026-09-22
Branch isolada: `codex/privacy-ranking-consent-20260922`
Escopo: código local; sem deploy, sem leitura/escrita de produção e sem publicação de dados pessoais.

## 1. Fontes efetivamente revisadas

- `AGENTS.md` e a documentação local do Next.js 16.3.5 em `node_modules/next/dist/docs/` (Route Handlers, autenticação e segurança de dados).
- Ranking e fidelidade: `src/lib/rankingClientes.ts`, `src/app/api/cliente/fidelidade/painel/route.ts`, `src/app/cliente/page.tsx`, `src/lib/clientes.ts`, `src/lib/fidelidade.ts`, rotas administrativas e testes relacionados.
- Identidade/sessão: `src/lib/clienteAuth.ts`, `src/lib/clienteSessaoFront.ts` e rotas de perfil/sessão.
- Dados/analytics: `docs/architecture/DATA_ARCHITECTURE.md`, `DATABASE_MIGRATION_PLAN.md`, `REDIS_KEY_INVENTORY.md`, `src/lib/jornadaChef.ts` e `src/lib/historicoAnalitico.ts`.
- Fonte `CHEFEBOT_*`: a árvore atual não contém arquivo com esse padrão. O único arquivo localizado no histórico Git foi `.claude/machine/CHEFEBOT_CONTEXTO.md`, no commit `1ea3380`. Ele foi lido como baseline técnico antigo, não como regra jurídica ou comercial.

## 2. Estado encontrado

### Controles já existentes

- O endpoint autenticado do painel não enviava `clienteId` de terceiros ao navegador.
- A interface mostrava terceiros como `Participante N`, sem nome, telefone ou foto.
- A telemetria da Jornada possui sanitização e referências HMAC; o painel de fidelidade trabalha com métricas agregadas.
- A máscara de telefone já existente é produzida no servidor e revela, no máximo, DDD, primeiro dígito do número e quatro dígitos finais.

### Lacunas e riscos

| Risco | Severidade | Evidência/impacto |
|---|---:|---|
| Identificador do ranking contém telefone | Alta | O membro do sorted set é `cli_{telefone}`. Não chegava ao browser, mas persiste PII legível no Redis. |
| Redis como arquivo permanente | Alta | Consentimento, fidelidade, pedidos e analytics ainda dependem do mesmo Redis. O projeto já decidiu migrar dados permanentes para PostgreSQL, mas a migração não ocorreu. |
| Sem consentimento/auditoria/revogação | Alta | Não havia finalidade granular, versão do texto, origem, estado nem trilha de mudanças. |
| Foto sem fonte oficial integrada | Alta se ativada | Não existe adaptador de fonte oficial/autorizada no código. Qualquer promessa de foto do provedor seria inventada. |
| Retenção e eliminação indefinidas | Alta | Não há prazo aprovado nem workflow amplo de direitos do titular. Apagar só o registro de consentimento seria incompleto e poderia destruir evidência necessária. |
| Analytics histórico identificável na camada de armazenamento | Média/alta | `historicoAnalitico.ts` usa `clienteId` em índices Redis; como `clienteId` embute telefone, isso é pseudonimização insuficiente, embora as respostas administrativas sejam agregadas. |
| Perfil e pedidos duplicam telefone | Média/alta | O telefone é identidade canônica em várias chaves/objetos. Uma resposta de acesso/eliminação exige inventário e operação transversal, não só ranking. |

## 3. Patch técnico implementado agora

### Consentimento granular e registro auditável

Foram criadas três finalidades independentes:

1. `ranking_primeiro_nome`;
2. `ranking_telefone_mascarado`;
3. `ranking_foto_perfil`.

Cada evento registra somente:

- ID aleatório do evento;
- finalidade;
- estado (`concedido` ou `revogado`);
- versão do texto apresentado;
- data/hora do servidor;
- origem fixa `area_cliente_autenticada`.

O titular é referenciado nas chaves por HMAC-SHA256 com segredo dedicado. Telefone e `clienteId` não são gravados na trilha. A atualização do estado atual e o acréscimo ao histórico usam uma única transação Redis.

### Falha fechada e texto jurídico externo

- Nenhum texto de consentimento foi inventado ou incorporado ao código.
- Nome e telefone só podem ser concedidos quando texto e versão aprovados forem configurados no servidor.
- A versão enviada pela interface precisa coincidir exatamente com a versão atual do servidor.
- Alterar a versão configurada volta a anonimizar automaticamente até nova escolha do titular.
- Ausência de segredo, texto ou versão bloqueia novas concessões.
- Revogação continua possível depois que o texto aprovado for retirado, desde que o segredo estável permaneça configurado.

### Bloqueio server-side e minimização

- Uma DAL marcada `server-only` decide a projeção pública.
- Sem consentimento ativo, erro de Redis, erro de perfil, versão divergente ou configuração ausente, o DTO fica anônimo.
- O perfil completo nunca é entregue à rota/renderização do ranking.
- O nome é reduzido ao primeiro nome, sanitizado e limitado.
- O telefone é mascarado no servidor; o número completo nunca entra no DTO.
- O endpoint continua omitindo `clienteId` dos participantes.

### Foto

- A finalidade existe separadamente para não misturar autorizações.
- Toda concessão de foto responde `fonte_oficial_indisponivel`.
- A projeção sempre devolve foto nula.
- Não foi criada chamada, scraping, URL ou capacidade atribuída a WhatsApp/outro provedor.

### Revogação e acesso do titular

- A área autenticada permite desligar cada finalidade imediatamente.
- Há ação única para revogar todas as autorizações do ranking.
- `GET /api/cliente/privacidade/ranking?historico=1&offset=0` entrega ao próprio titular a primeira página do histórico; páginas seguintes usam `proximoOffset`.
- `DELETE /api/cliente/privacidade/ranking` significa **revogar todas as autorizações**, preservando auditoria. Não é apresentado como pedido amplo de eliminação LGPD.

### Analytics

- O patch não envia nomes, telefones, consentimentos ou eventos de clique para analytics.
- A exibição continua anônima por padrão.
- Métricas existentes podem continuar agregadas na saída, mas o risco do `clienteId` identificável nos índices de `historicoAnalitico.ts` permanece pendente de migração/correção própria.

## 4. O que exige advogado/DPO

Nenhum item abaixo foi decidido no código:

1. base legal aplicável a cada tratamento e se consentimento é a base adequada;
2. texto completo e versão de cada finalidade;
3. demonstração de liberdade, destaque, granularidade e consequências da recusa;
4. tratamento de menores/representantes, se aplicável;
5. prazo de retenção do estado atual e da trilha de auditoria;
6. hipóteses de preservação versus eliminação da prova de consentimento;
7. SLA, identidade/verificação e escopo da resposta a direitos do titular;
8. política para mudança material ou não material de versão;
9. transparência sobre ranking, critérios, compartilhamento e eventual exposição pública;
10. papéis de controlador/operador e necessidade de RIPD/LIA ou documento equivalente.

## 5. O que depende da API oficial do provedor

Antes de qualquer foto, a revisão humana deve comprovar:

- que a API oficial realmente oferece a foto para este caso de uso;
- que a conta/aplicação possui autorização e escopos válidos;
- que termos do provedor permitem exibição em ranking;
- proveniência, atualização, revogação na origem e expiração;
- hospedagem/proxy seguro, allowlist de domínio e proteção contra rastreamento por URL remota;
- retenção e exclusão da referência/cache;
- comportamento quando a autorização do provedor expira.

Sem essas evidências, manter `ranking_foto_perfil` bloqueado.

## 6. Retenção, eliminação e arquitetura alvo

Não foi criado TTL nem apagamento automático, pois qualquer número seria uma política jurídica inventada. Também não foi exposto endpoint de eliminação ampla: os dados relacionados ao titular aparecem em perfil, pedidos, fidelidade, conversas e analytics.

Próximo passo arquitetural aprovado tecnicamente, mas ainda não executado:

- mover consentimentos e eventos para PostgreSQL transacional;
- usar identificador interno aleatório, nunca `cli_{telefone}`;
- separar tabela de estado atual e tabela append-only de eventos;
- aplicar política de retenção versionada e job auditável somente após aprovação;
- construir workflow de DSAR que exporte/localize todos os domínios e aplique exclusão, anonimização ou retenção justificada por categoria;
- manter no Redis apenas cache/coordenação com TTL curto.

## 7. Checklist exato para revisão humana

1. Advogado/DPO aprova e identifica a versão dos textos de primeiro nome e telefone mascarado. Não configurar foto.
2. Segurança gera um segredo aleatório estável de pelo menos 32 caracteres exclusivamente para `PRIVACY_CONSENT_HMAC_SECRET`; registrar custódia e plano de rotação/migração. Trocar o segredo sem migração torna os registros anteriores inacessíveis.
3. Em ambiente de Preview, configurar:
   - `PRIVACY_CONSENT_HMAC_SECRET`;
   - `RANKING_CONSENT_FIRST_NAME_TEXT`;
   - `RANKING_CONSENT_FIRST_NAME_TEXT_VERSION`;
   - `RANKING_CONSENT_MASKED_PHONE_TEXT`;
   - `RANKING_CONSENT_MASKED_PHONE_TEXT_VERSION`.
4. Confirmar visualmente que os dois controles aparecem separados e reproduzem exatamente o texto aprovado.
5. Validar quatro contas de teste: sem consentimento; só nome; só telefone; ambos.
6. Confirmar por inspeção de resposta que não aparecem `clienteId`, telefone completo, sobrenome ou URL de foto.
7. Revogar individualmente e por “revogar todas”; confirmar anonimização na requisição seguinte, inclusive em outra sessão autenticada.
8. Alterar a versão somente no Preview; confirmar que concessões antigas deixam de expor dados.
9. Exportar o histórico paginado da própria conta e conferir finalidade, versão, data, origem e estado.
10. Definir política de retenção/eliminação e workflow de direitos antes de produção.
11. Planejar a remoção de `cli_{telefone}` do ranking e analytics antes de classificar o conjunto como anonimizado.
12. Só depois de todas as aprovações, executar o checklist de deploy de `docs/DEPLOYMENT.md`. Esta branch não executou essa etapa.
