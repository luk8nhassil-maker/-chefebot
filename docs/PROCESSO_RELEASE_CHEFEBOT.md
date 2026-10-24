# ChefeBot — processo único de auditoria, testes e publicação

**Escopo:** repositório luk8nhassil-maker/-chefebot, branch main, Vercel do time chefe-da-pizza, projeto oficial chefebot-contingencia, domínio chefedapizza.com.br. Nunca confundir com Pizzaria São Francisco ou projetos Vercel antigos.

## Precedência e autonomia

1. A instrução explícita mais recente do usuário para a tarefa prevalece sobre o padrão operacional.
2. O PROGRAMACAO.md em modo autônomo (decisão posterior às instruções antigas) permite implementar, testar, fazer merge e publicar sem solicitar aprovações repetidas **após cumprir os gates técnicos**. As cláusulas antigas de aprovação por tarefa são substituídas por essa delegação apenas nesse ponto; regras de segurança, negócio e branch protection continuam vigentes.
3. A falta de regra comercial ou bloqueio real de plataforma exige parar. Não inventar dados, provas, preços ou autorização.
4. **Para a tarefa de 24/10/2026, o usuário proibiu criar Preview para economizar.** Use prova local equivalente para este patch. Para futuras mudanças, reavaliar necessidade e autorização; nunca criar Preview por conveniência.

## Fluxo obrigatório e estados

- **Auditar:** confirmar repo/branch/commit, fluxo atual, baseline, fontes oficiais, testes, decisões e dependências. Separar fatos, hipóteses e lacunas.
- **Implementar:** branch isolada a partir de main, menor patch seguro, sem alterar produção, sem misturar outras tarefas.
- **Testar:** testes focados e regressões de acordo com risco; registrar nomes e logs. Build/lint/typecheck quando aplicáveis. Não chamar teste não executado de verde; registrar falhas preexistentes separadamente.
- **Validar:** revisar diff adversarialmente, verificar SHA exato do HEAD, isolar Preview quando utilizado; se dispensado, registrar motivo e evidência alternativa. Nenhum efeito real de Pix, pedidos, WhatsApp, impressão, Redis, estoque, fidelidade.
- **Merge:** PR mergeável; gates e checks obrigatórios efetivamente aprovados; nunca bypass/force push/edição direta na main. A autorização operacional válida dispensa nova pergunta, não substitui o gate.
- **Deploy:** confirmar projeto correto, SHA do merge igual ao publicado, target production, READY, health check e fluxos críticos. Se uma condição falhar, tarefa está bloqueada, não concluída.
- **Aprender:** registrar decisões e incidentes; passar para próxima tarefa somente depois de encerrar a atual.

Status distintos: **implementado** (código escrito), **testado** (evidência no SHA), **mergeado** (integrado à main), **publicado** (deploy READY), **concluído em produção** (saúde + não regressão). Não confundir esses estados.

## Gate automático local, sem serviços externos

Executar no checkout do repositório (Node já disponível):

    node --test scripts/ci/release-gate.test.mjs
    node scripts/ci/release-gate.mjs premerge evidencia.json
    node scripts/ci/release-gate.mjs postdeploy evidencia.json

O validador lê **somente o JSON de evidências**: verifica repo, main, headSha, validatedSha, revisão do diff, baseline, zero falhas novas, escopo protegido, testes realmente passados, build (dispensável apenas para risco baixo com justificativa), Preview validado ou dispensado com alternativa, ausência de efeitos reais, autorização e rollback. Em postdeploy exige mergeSha = deployedSha, Vercel correto, READY, healthCheck e regressionCheck com provas.

Campos mínimos do JSON em premerge: repository, baseBranch, headSha, validatedSha, risk (low/medium/high), diffReviewed (true), baselineCompared (true), newFailures (0), scopeProtected (true), tests (array de {name,status:'passed'}), build ({status:'passed' ou 'not_applicable',reason se dispensado}), preview ({status:'validated' ou 'skipped',reason e alternativeEvidence se dispensado}), productionSideEffects (false), approvalBasis e rollbackPlan. O modo postdeploy acrescenta mergeSha, deployedSha, vercelProject, target, deploymentState, healthCheck ({status:'passed',evidence}) e regressionCheck no mesmo formato.

**Limite explícito:** o script checa consistência do relatório, mas não pode comprovar sozinho que logs foram executados ou que a produção está saudável. Conferir provas externas antes da publicação. Não incluir dados pessoais ou secrets nas evidências.

## Custos, CI e Preview

GitHub Actions pode estar indisponível por faturamento; não criar workflow pago nem apresentá-lo como verde. Não usar deploy Preview para mudança documental/validador, especialmente quando o usuário proibiu. Em atualizações de risco médio/alto, testes e build continuam obrigatórios; se um check obrigatório estiver indisponível e bloquear o merge, reportar o bloqueio real. Não fazer bypass.

## Próxima tarefa independente

O PR #484 de proteção da pausa do WhatsApp e pedidos simultâneos exige **auditoria separada** comparando branch antiga e main atual. Não mesclar código antigo sem revisar. Nada de WhatsApp ou pedidos é alterado por este patch processual.
