# Auditoria do monitor e da evidência da outbox — 19/10/2026

## Base e escopo

Base: `main` em `7f60a63dab4b8b1cc6b24f6a65a52ff9e94503e9` (merge do #503).
Branch: `fix/whatsapp-monitor-evidence-20261019`.

Foram consultados AGENTS.md, docs/DEPLOYMENT.md e a documentação versionada
do monitor/outbox. PROGRAMACAO.md, MAPA_DE_FONTES.md, ORQUESTRADOR.md,
PROCESSO_OBRIGATORIO.md, AUDITORIA_DE_CODIGO.md e CHEFEBOT_* não constam da
árvore desta main. Páginas públicas dos PRs #493–#503 foram consultadas;
#502 está Draft, não faz parte desta main e não foi incorporado silenciosamente.

## Causa comprovada versus evidência operacional pendente

- O #503 documenta e corrige a divergência de DDI entre origem do canário e
  seleção da outbox. Um roundtrip pelo caminho direto pode ter HTTP 201 sem
  criar job nem incrementar `monitor:metrics.delivered`. O canário histórico
  não comprova funcionamento da fila após o patch. A descrição do #503
  explicitamente registra que nenhum novo canário foi executado após o deploy.
- O código atual incrementa o contador cumulativo somente ao finalizar o job.
  Campo ausente não equivale a zero nem a falha comprovada; a instrumentação
  Lua é melhor esforço. Não foram fabricadas métricas nem alterados contadores.
- Reproduzido um defeito adicional do monitor: uma exceção no HGETALL de
  métricas apagava também a leitura válida da fila e indicava Redis indisponível.
- Reproduzida a ambiguidade diagnóstica: falha lendo o canário, canário sem
  vínculo, job ausente e falha lendo job não eram distinguíveis.
- Não há acesso autenticado atual para atribuir a leitura de 10h22 a uma
  falha de produção nova. A informação do usuário e o registro do #503 são
  evidências históricas, não uma leitura de produção realizada nesta execução.

## Patch mínimo

- Leituras de fila e contadores independentes; falha dos incidentes também
  não descarta dados válidos. Falha de leitura da fila continua bloqueante.
- Diagnósticos explícitos e sem identificadores: contador não registrado ou
  ilegível; canário sem vínculo, job ausente, leitura falha ou estado conhecido.
  Estado inválido vindo do Redis não é propagado como texto arbitrário.
- Painel explica a evidência faltante e diferencia aceitação HTTP de entrega
  no aparelho. Nenhum gate foi relaxado.
- Teste Redis real ampliado até o monitor. Corrigida somente a allowlist local
  do teste: o SDK usa raiz sem barra para comandos individuais, /pipeline para
  pipelines. A origem continua limitada ao SRH descartável.

Sem mudanças em envio, Lua de produção, pedidos, Pix, preços, fidelidade,
conversas, QStash, autenticação DEV, rollout ou reconciliação. Nenhum reenvio.

## Validação executada

- Testes novos antes do patch reproduziram as falhas; após o patch passaram.
- Suíte completa: **6.686 aprovados, 6 ignorados**, 451 arquivos aprovados e
  1 ignorado. Inclui os cenários existentes de 50/100/200 mensagens simuladas,
  concorrência, falhas, pedidos, pagamentos e proteções de Preview.
- Após os últimos refinamentos diagnósticos: **26 testes focados aprovados**
  (monitor, gates e autenticação da rota). Não se repetiu a suíte inteira.
- Redis 6.2.14 + SRH 0.0.10 em rede Docker interna descartável: **3/3**.
  Evolution falsa; nenhuma conexão com serviços de produção. Comprovados:
  reserva/finalização Lua, falha ambígua sem reenvio, canário roundtrip com
  job preservado, contador real legível pelo monitor e consulta sem novo envio.
  Isso não calibra capacidade real de Evolution, Meta, Vercel ou Upstash.
- Typecheck: passou após `next typegen` + `tsc --noEmit`.
- Lint global: **5 erros e 150 avisos**. Os cinco erros também foram
  reproduzidos nos arquivos da main via stdin: custos-produtos (1), conversas
  (2), MonitorWhatsappClient (2). Não são regressões deste patch. Lint dos
  três arquivos TypeScript de serviço/teste alterados passou.
- Build normal Turbopack: bloqueado no download de fontes Google. Tentativa
  alternativa Webpack: mesmo impedimento. CURL para fonts.gstatic.com
  confirmou CONNECT 403. Não se declara build aprovado. O fallback Webpack
  gerou validadores antigos que rejeitam exports de rotas já existentes;
  foram preservados em /tmp e regenerados pela ferramenta canônica typegen,
  sem alterar código ou relaxar o TypeScript.
- Revisão adversarial do delta: nenhuma escrita acrescentada ao monitor,
  nenhum segredo/telefone/jobId novo na resposta; leituras faltantes não viram
  sucesso; autenticação e gates preservados; comparação com main e diff check.

## Infraestrutura e bloqueios reais

- Git fetch/ls-remote e páginas públicas GitHub funcionam. API autenticada
  GitHub (`gh api`) retorna Forbidden; não há conector GitHub/Vercel/browser
  autenticado disponível nesta sessão. Não contornar autenticação.
- Domínio de produção, inclusive health check, retorna CONNECT 403 neste
  ambiente. Não foi acessado Redis, Evolution ou QStash de produção.
- O #503 relata deployment Production READY no SHA da base acima; isso não
  foi reconfirmado diretamente na Vercel nesta execução e não comprova E2E.
- Agendamento no código: QStash persistente `*/5 * * * *`, ID estável, callback
  canônico assinado; publicação imediata deduplicada desperta o worker.
  Worker recupera leases, drena lote, sincroniza histórico e registra execução.
  A existência/saúde da agenda real não foi confirmada. Não se criou agenda.
- `vercel.json` conserva ignoreCommand para branches diferentes de main.
  Nenhum Preview foi solicitado; nenhuma configuração Vercel foi modificada.

## Gate de encerramento

**Etapa 1 não aprovada operacionalmente nesta execução.** É indispensável
acesso autenticado DEV para ler a fila e, somente se segura, executar uma única
vez o canário autorizado, receber a resposta e conferir o mesmo job delivered
e contador positivo. Não se enviou mensagem real nem se alterou rollout.

Etapa 2 continua exigindo agenda real e recuperação observada, sem pendências;
etapa 3 exige mecanismo gradual e histórico/aprovação; etapa 4 exige aprovação
geral e conferência de custos/limites. O monitor já explicita essas pendências.

Sem acesso à API GitHub e Vercel não é possível conferir checks/proteções,
concluir merge normal, confirmar o novo deployment pelo SHA e fazer health
check. Não usar push direto na main ou bypass como alternativa. A correção
local não deve ser confundida com encerramento do incidente em produção.
