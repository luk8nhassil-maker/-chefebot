# Runbook — uso do `postgres-volume` (Railway, projeto `zestful-liberation`)

Ver `docs/operations/railway-infra-monitor.md` para a arquitetura completa
do monitor que gera esses números (painel `/dev/mcp` → aba "Saúde da
Infraestrutura").

## Tabela de resposta

| Uso | Estado | Ação |
|---|---|---|
| < 70% | saudável | acompanhar |
| 70–79% | atenção | investigar crescimento (comparar com a tendência diária no painel) |
| 80–89% | crítico | identificar causa e preparar retenção/expansão do volume |
| 90–94% | emergência | agir imediatamente (expandir o volume ou reduzir o crescimento agora) |
| ≥ 95% | risco de queda | reduzir crescimento/expandir antes de qualquer paralisação — não esperar chegar a 100% |

**Nunca esperar o uso chegar a 100%.** Foi exatamente isso que causou o
incidente de 22/06–21/07/2026: o Postgres entrou em modo de recuperação e a
Evolution/Baileys ficou presa em QR congelado até o volume ser ampliado
manualmente.

## O que fazer em cada faixa

### 70–79% (atenção)
1. Abrir `/dev/mcp` → "Saúde da Infraestrutura" e olhar o crescimento de
   7/30 dias e a previsão para 80%/90%.
2. Se o crescimento estiver dentro do padrão histórico (~5,5 MB/dia antes do
   incidente), só acompanhar.
3. Se o painel sinalizar "salto anormal", investigar o que mudou nas
   últimas 24h antes de decidir.

### 80–89% (crítico)
1. Confirmar se o crescimento é sustentado (não um pico isolado).
2. Avaliar se há necessidade de reter menos dados no Postgres (nunca via
   limpeza automática/destrutiva feita por este monitor — decisão manual do
   time, fora deste sistema).
3. Preparar a expansão do volume na Railway UI (não é uma ação deste
   monitor — ele só lê; a expansão é sempre manual pelo painel da Railway).

### 90–94% (emergência)
1. Expandir o volume na Railway UI imediatamente, ou reduzir o crescimento
   na origem (ex.: revisar retenção de logs/tabelas que crescem rápido).
2. Não aguardar a próxima janela de 6h do monitor para decidir — este é o
   momento de agir com a informação que já se tem.

### ≥ 95% (risco de queda)
1. Tratar como o mesmo tipo de incidente de 22/06–21/07/2026: expandir o
   volume na Railway UI **agora**.
2. Depois de resolvido, validar que Postgres, Evolution/WhatsApp, pedidos e
   Pix continuam funcionando normalmente (mesmo checklist de
   `docs/DEPLOYMENT.md`).

## Coleta atrasada ("stale")

Se o painel mostrar "coleta atrasada" (mais de 18h sem amostra nova):
1. Conferir o histórico de execuções do workflow em Actions →
   `railway-infra-monitor`;
2. Rodar manualmente via `workflow_dispatch`;
3. Se o erro persistir, ver a seção "Como conferir falha do workflow" em
   `docs/operations/railway-infra-monitor.md`.

## O que este runbook NÃO autoriza

Nenhuma limpeza destrutiva automática do banco, nenhum comando de escrita
na Railway (deploy/redeploy/restart/delete/resize/variable/migration) e
nenhuma ação tomada automaticamente pelo monitor — todas as ações acima são
sempre manuais, feitas por uma pessoa, fora deste sistema de leitura.
