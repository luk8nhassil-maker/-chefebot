# Rotação da credencial da Evolution

Use este procedimento quando houver suspeita ou confirmação de exposição da
chave da Evolution. Não registre a chave antiga ou a nova em ticket, chat,
commit, log ou comando de terminal.

1. Gere uma chave substituta no painel/instância Evolution autorizado.
2. Atualize `EVOLUTION_API_KEY` apenas nas variáveis **Production** do projeto
   Vercel `chefebot-contingencia` da equipe `chefe-da-pizza`.
3. Confirme que `EVOLUTION_API_URL`, `EVOLUTION_INSTANCE_NAME` e
   `EVOLUTION_WEBHOOK_URL` ainda apontam à instância e ao domínio oficiais.
4. Publique somente o commit aprovado na `main`; aguarde o deployment
   **Production / Ready** no projeto oficial.
5. Faça o health check configuracional e um único canário autorizado, conforme
   `docs/DEPLOYMENT.md`. Não envie mensagens a clientes durante a rotação.
6. Invalide a chave anterior no provedor somente depois da confirmação do novo
   deployment e do canário.
7. Revogue qualquer sessão, integração ou log de auditoria que ainda referencie
   a chave anterior e registre apenas a data, o responsável e o identificador
   não sensível da rotação.

O arquivo rastreado que continha a chave literal foi removido do HEAD. A remoção
não apaga o histórico Git: até a invalidação no provedor, trate a chave antiga
como comprometida.
