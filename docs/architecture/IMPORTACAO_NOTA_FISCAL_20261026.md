# Importação orientada por documento fiscal — ChefeBot, 26/10/2026

## Objetivo
O usuário autorizou transcrever exclusivamente nove campos legíveis da nota fiscal de COMPRA (destinatário/remetente) para o rascunho fiscal do proprietário. A nota não comprova que o destinatário pode emitir NFC-e da pizzaria.

## Fonte e isolamento
- Origem: documento enviado pelo usuário na conversa de 26/10/2026.
- Não gravar nome, CNPJ, inscrição estadual ou endereço da empresa em arquivos deste repositório.
- Usar SOMENTE variável PRIVADA Vercel de produção `FISCAL_PREFILL_DOCUMENTO_202610`, tipo encrypted/sensitive, JSON `{versao:1,titularConta:"<admin login>",respostas:{...}}` com exatos campos autorizados: `cnpj`, `razaoSocial`, `inscricaoEstadual`, `logradouro`, `numero`, `bairro`, `cep`, `municipio`, `uf`.
- A variável é específica da instância `chefebot-contingencia`, jamais reutilizar em outro produto/ambiente/tenant.
- O código carrega configuração no servidor e não a devolve ao navegador antes da importação. Se não configurada ou dono diferente, ignora.
- Só a rota ADMIN autenticada da própria origem pode importar, via POST; Preview bloqueia Redis real e importação.
- O navegador do admin faz importação automaticamente uma única vez na abertura de `/configuracoes/nota-fiscal/dados`, depois de GET confirmar haver campos vazios. O contador convidado não executa a importação.
- O serviço compara todos os campos já preenchidos, e se algum divergir **não realiza escrita** (409), evitando mistura de estabelecimentos.
- Não altera valores existentes. Completa apenas lacunas com CAS/versionamento atômico; idempotente quando já importado.
- Permanece `rascunho_pendente_vinculo`, sem CPF de cliente, impostos, porte/regime, CNAE, código IBGE, liberação de emissão, WLG ou segredo.

## Evidência e limites
- Passar testes isolados do importador, rota auth/CSRF/preview, compatibilidade, lint, tsc e build.
- Deploy após aprovação técnica do SHA do PR; verificação Vercel (status READY, commit e logs).
- A publicação **não prova** que a escrita no Redis já ocorreu: somente após o dono fazer login e abrir a tela, validar que foi persistido, sem solicitar dados adicionais do contador.
- Se conta do administrador não corresponder à instância autorizada, importar é bloqueado por `titularConta`.
- A variável de importação pode ser removida quando persistência for confirmada; não excluir rascunho do Redis.

## Rollback
Reverter o PR e remover variável `FISCAL_PREFILL_DOCUMENTO_202610`. Nenhuma migração destrutiva, nenhum pedido real, nenhum Pix, nota, estoque ou WhatsApp afetado.
