# Inbox: capacidade de ativação gradual
A publicação não ativa nenhum número. O padrão continua off e nenhuma variável produtiva é alterada por este patch.

Modos: off (legado preservado), allowlist (somente telefones explicitamente selecionados) e all (compatibilidade; proibido ativar sem autorização específica). Preview sempre bloqueia a inbox.

Uma ativação futura autorizada usa WHATSAPP_INBOX_ROLLOUT=allowlist e WHATSAPP_INBOX_ALLOWED_PHONES com números completos 55+DDD+número separados por vírgulas. Não commitar valores reais. Sem curingas, números parciais ou expansão por semelhança. Qualquer entrada inválida desabilita a lista inteira; nunca há fallback para all. A lista tem limite técnico de parsing de 8192 caracteres.

O endpoint DEV somente leitura expõe modo, validade e quantidade; nunca a lista. O monitor reconhece a capacidade, mas mantém os gates de estabilidade e aprovação humana bloqueados. Não altera worker, Lua, retries, quarentena, outbox, pedidos, Pix ou bot_ativo.

Canário diagnóstico permanece separado: seu round-trip não aprova o processamento comercial da inbox. Testes HTTP isolados cobrem remetente selecionado, remetente excluído e lista inválida, além da carga já existente. Ativação gradual ainda exige autorização do grupo, segurança do ingresso Evolution, credencial revogada/rotacionada comprovada, margem QStash e acompanhamento. Não mudar flags para obter prova.
