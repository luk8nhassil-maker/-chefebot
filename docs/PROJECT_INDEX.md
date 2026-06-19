# PROJECT_INDEX

## Objetivo

Este arquivo serve como índice técnico do projeto ChefeBot.

## Documentos principais

### `CLAUDE.md`

Regras permanentes do projeto, stack, fluxo principal e padrão de execução do Claude Code.

### `docs/BOT_FLOW_BASELINE.md`

Mapa do estado atual do fluxo do bot em `src/lib/bot.ts`.

Usar quando:

* o bug envolver atendimento do WhatsApp
* o bug envolver steps do bot
* o bug envolver pedido completo
* o bug envolver delivery, retirada, consumo no local, pagamento, borda, bebida ou sabor

### `docs/BUG_FIX_PROTOCOL.md`

Protocolo oficial para corrigir bugs.

Usar sempre antes de qualquer correção.

### `docs/BOT_TEST_CHECKLIST.md`

Checklist de testes manuais do bot.

Usar depois de alterar `src/lib/bot.ts` ou qualquer fluxo relacionado ao atendimento.

### `docs/BUG_REPORT_TEMPLATE.md`

Modelo para registrar bugs antes da correção.

Usar quando um bug novo for identificado.

## Regra de ouro

Para qualquer bug:

1. Entender o problema.
2. Identificar apenas o arquivo necessário.
3. Corrigir um bug por vez.
4. Fazer a menor alteração possível.
5. Rodar `npm run build`.
6. Testar o fluxo afetado.
7. Só commitar quando solicitado.
