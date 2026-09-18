# Status atual do ChefeBot

Fonte da verdade do projeto. Objetivo: evitar reabrir diagnóstico ou trabalho em problemas que já foram resolvidos e validados, e dar contexto rápido antes de qualquer nova tarefa.

## 1. Regras fixas do projeto

- **Não quebrar o que já funciona.** Qualquer mudança precisa preservar o comportamento validado das telas e fluxos já resolvidos (seção 2).
- **Patch mínimo por vez.** Escopo pequeno, isolado, reversível — não misturar correções não relacionadas no mesmo patch.
- **Uma tarefa por vez.** Não abrir múltiplas frentes de código em paralelo no mesmo working tree.
- **Usar worktree isolado para trabalho paralelo.** Quando houver mais de uma tarefa/sessão rodando ao mesmo tempo no projeto, cada uma deve usar seu próprio `git worktree` a partir da `main` atualizada, para não colidir branch/commit com outra sessão no mesmo diretório.
- **Antes de diagnosticar, ler este documento.** Qualquer auditoria ou diagnóstico de bug/UX deve começar conferindo a seção 2 (resolvido) e a seção 3 (não reabrir sem evidência nova) antes de propor trabalho novo.

## 2. Fluxos já resolvidos / validados

- **Scroll da conversa no Tempo Real (aba "⚡ Tempo real" dentro de `/pedidos`)** — resolvido. Usa `isNearBottomRef`/`prevMsgCountRef` para só rolar automaticamente quando o usuário já estava perto do fim da conversa; não interrompe leitura de mensagens antigas durante o polling.
  - **Nota importante:** essa correção existe **só na aba Tempo Real dentro de `/pedidos`** (`src/app/pedidos/page.tsx`). A rota separada `/conversas` (`src/app/conversas/page.tsx`), acessível pelo item "Conversas" da sidebar, é uma implementação diferente e **ainda não tem essa correção** — ver seção 4.
- **Histórico permanente da conversa** — resolvido. O histórico de mensagens permanece acessível mesmo depois que a conversa sai da lista de "recentes" (finalizada ou após a janela de 30 min), sem fechar sozinho.
- **Prioridade pós-pedido** — resolvida na aba Tempo Real de `/pedidos`. Ordenação real por prioridade: nova mensagem não vista → urgente pós-pedido (`postOrderPriority`) → alerta (`conversationAlert`) → já assumido manualmente → mais recente. Sinalização visual por item (cor de borda, badge "Assumir e responder").
- **Pix pendente/confirmado no painel** — resolvido. Badge "PIX⏳" na lista de conversas/pedidos e aviso visual no cabeçalho do chat quando há Pix pendente de confirmação; finalizar atendimento com Pix pendente exige confirmação extra do usuário.
- **Proteção de `/api/configuracoes`** — resolvida pelo PR #161. `GET`/`POST` exigem `auth-token` válido (401 sem sessão); `atendente` não recebe nem consegue alterar `chavePix`/`nomeTitularPix` (preservados no servidor mesmo se enviados no body); `admin`/`dev` têm acesso completo. Testes automatizados em `src/app/api/configuracoes/route.test.ts` (Redis mockado).
- **Proteção de `/setup`** — resolvida pelo PR #162. `/setup` exige login, só `admin`/`dev` acessam (`atendente` bloqueado). O wizard não avança mais silenciosamente se o `POST /api/configuracoes` falhar (401/403 ou qualquer erro mostra alerta claro e não avança o step).
- **Fluxo público `/cardapio`** — validado em produção (checklist manual, ver `docs/DEPLOYMENT.md`): pedido completo, bebida/suco, entrega com taxa por bairro, retirada sem endereço, Pix com badge no painel, dinheiro com troco, atendimento humano assumido e devolvido corretamente.
- **Montagem/checkout dinâmico** — validado em produção junto com o checklist acima.

## 3. Problemas que não devem ser reabertos sem nova evidência

Estes itens já foram corrigidos e validados. Só investigar de novo se houver **evidência concreta e nova** (reprodução real, log, print) de que voltaram a acontecer — não assumir que ainda existem só por lembrança de auditoria antiga.

- Scroll da conversa puxando sozinho para o final durante o atendimento (resolvido na aba Tempo Real de `/pedidos` — ver ressalva da seção 2 sobre `/conversas`).
- Histórico de conversa sumindo/fechando sozinho no Tempo Real.
- `/api/configuracoes` respondendo publicamente sem autenticação, expondo `chavePix`/`nomeTitularPix`.
- `/setup` avançando de step sem realmente salvar a configuração.
- Fluxo de pedido público (`/cardapio`) quebrado ponta a ponta.

## 4. Pendências reais

### Estrelas V1 + Indicação — PR #422 (branch `codex/chefebot-estrelas-v1`)

**Estado: implementado, aguardando merge.**

#### O que foi implementado

**Estrelas V1 (`src/lib/estrelas.ts`, `src/lib/fidelidade.ts`)**
- Regra `"estrelas-faixas-v1"`, meta = 50 estrelas.
- Faixas por valor elegível (subtotal − desconto fidelidade):
  - 0 cent → 0 ★; 1–3 999 → 3 ★; 4 000–6 999 → 5 ★; 7 000–9 999 → 7 ★; 10 000–14 999 → 9 ★; ≥ 15 000 → 12 ★.
- Gated por `estrelasV1Ativa(config)` que verifica `config.regraVersao === "estrelas-faixas-v1"`.
- Novo campo `saldoEstrelas`/`metaEstrelas`/`estrelasFaltantes`/`marcoEstrelasAtingido` na API `GET /api/cliente/fidelidade`.

**Indicação (`src/lib/indicacaoToken.ts`)**
- Token opaco 18 bytes → 24 chars base64url, TTL 90 dias (`indicacao:token:{token}`).
- Relação permanente `indicacao:relacao:{indicadoId}` — first-write-wins, self-referral bloqueado.
- API `GET /api/cliente/indicacao` — retorna (criando se necessário) o token do cliente autenticado.
- API `POST /api/cliente/indicacao { ref: TOKEN }` — registra a relação indicador→indicado. Idempotente.

**Efeitos de indicação (`src/lib/fidelidadeEfeitos.ts`)**
- Novo efeito `"indicacao"` adicionado à cadeia do pedido entregue.
- Primeira compra comercial válida → `creditarEstrelasIndicacaoValida` → +6 ★ para o indicador.
- Todo pedido entregue com relação → `creditarEstrelaApoioRecorrente` → +1 ★ por relação por expediente (idempotente via `apoio:{indicadoId}:expediente:{expedienteId}`).
- Todas as operações são idempotentes: se o processo cair após `"jornada"` mas antes de persistir `"indicacao"`, o retry executa somente o efeito pendente.

#### Dry-run histórico (Bloqueio 1)

Simulação pura sobre dataset sintético de 524 pedidos / 436 clientes (`src/lib/estrelasDryRun.test.ts`):

| Métrica | Resultado |
|---|---|
| Pedidos analisados | 524 |
| Clientes únicos | 436 |
| Estrelas distribuídas | 2 046 |
| Clientes na meta (≥ 50 ★) | 0 |
| Média por cliente | ~4,69 ★ |
| Mediana por cliente | 0 ★ |
| Impacto +1 indicação (+6 ★) | 0 clientes adicionais |
| Impacto +2 indicações (+12 ★) | 0 clientes adicionais |

Interpretação: com 1–3 pedidos por cliente e valores típicos de R$45–R$120, nenhum cliente chega a 50 ★ no dataset histórico. O marco de recompensa será atingido naturalmente à medida que a base acumular pedidos ao longo do tempo.

## 5. Como usar este documento

- Todo novo diagnóstico ou auditoria deve **começar lendo este arquivo inteiro** antes de propor investigação ou patch.
- Se o código encontrado divergir do que este documento descreve como resolvido/validado, **reportar a divergência antes de codar** — não corrigir silenciosamente nem assumir que o documento está desatualizado sem confirmar.
- **Atualizar este documento depois de cada PR validado e mesclado**, movendo o item da seção 4 (pendências) para a seção 2 (resolvido), ou registrando novo problema na seção 3 se for uma regressão de algo já dado como resolvido.
