# BUG_REPORT_TEMPLATE

## Identificação

Data:
Área afetada: bot / painel / simulador / WhatsApp / Redis / financeiro / entregador / outro
Prioridade: baixa / média / alta / crítica

## Bug

Descrição curta:

Comportamento atual:

Comportamento esperado:

## Evidência

Print, log ou mensagem do cliente:

```txt
cole aqui
```

## Contexto do teste

Onde aconteceu: simulador / WhatsApp real / painel / build / produção / local

Mensagem enviada pelo cliente, se for bot:

```txt
cole aqui
```

Step provável do bot, se souber:

```txt
ex: name, add_more, delivery_type, payment
```

## Diagnóstico inicial

Arquivo suspeito:

Função suspeita:

Risco de quebrar outros fluxos:

## Checklist antes de corrigir

* Ler `CLAUDE.md`
* Ler `docs/BUG_FIX_PROTOCOL.md`
* Ler `docs/BOT_FLOW_BASELINE.md` se envolver o bot
* Confirmar arquivo provável
* Corrigir apenas um bug por vez
* Fazer menor alteração possível

## Checklist depois de corrigir

* Rodar `npm run build`
* Rodar `git status --short`
* Testar fluxo afetado
* Confirmar se não quebrou fluxo principal
* Informar arquivos alterados
* Informar causa e correção
