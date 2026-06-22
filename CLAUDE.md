@AGENTS.md

## REGRA PERMANENTE: HIGIENIZAÇÃO DE MENSAGEM DO CLIENTE

Toda mensagem do cliente deve ser normalizada antes de qualquer interpretação pelo bot.

**Função central:** `normalizarMensagemCliente(texto)` em `src/lib/normalizarMensagem.ts`

- Emojis devem ser removidos do texto antes de qualquer parsing.
- Texto útil (letras, números, acentos, pontuação) deve ser preservado.
- Figurinha (`stickerMessage`), GIF (`videoMessage.gifPlayback`) e mídia sem texto devem ser ignorados sem alterar sessão, carrinho ou step.
- Mensagem composta apenas de emoji deve ser ignorada sem responder fallback, sem avançar step, sem alterar carrinho.
- A normalização é aplicada em `processMessage()` (bot.ts) e na extração de `messageText` (route.ts).

**Exemplos:**
- `"frango com catupiry e 3 queijo 😋"` → `"frango com catupiry e 3 queijo"`
- `"pix ✅"` → `"pix"`
- `"😋"` → `""` (ignorar, sessão intacta)
