# Segurança e Ambientes

## Preview vs Produção

- Preview **não pode** escrever em produção, sob nenhuma circunstância.
- Preview **não pode** gerar: Pix real, mensagem de WhatsApp real,
  impressão real, movimentação de estoque real, pontos de fidelidade
  reais, escrita em Redis real ou escrita em banco de dados real.
- Qualquer integração externa usada em Preview deve estar em modo de
  teste/sandbox/mock explícito. Se não houver como garantir isso, a
  tarefa deve parar e reportar o risco antes de prosseguir.

## Preços e dados sensíveis do cliente

- Preços devem sempre ser **recalculados e validados no servidor**.
- Nunca confiar no preço enviado pelo navegador/cliente como fonte de
  verdade.
- Usar **IDs permanentes**, independentes de nomes visíveis (nomes de
  produto, categoria, sabor podem mudar; IDs não).

## Segredos

- Nunca copiar, exibir, logar ou mover qualquer segredo existente
  (chaves de API, tokens, credenciais) durante qualquer tarefa.
- Se uma tarefa exigir um segredo, referenciar por variável de ambiente —
  nunca colar o valor em código, commit, PR, log ou nesta máquina de
  instruções.
- Se um segredo for encontrado exposto acidentalmente durante uma
  auditoria, isso deve ser reportado como risco — sem reproduzir o valor
  do segredo no relatório.

## Limites de execução

- Não usar `--no-verify`.
- Não usar force push.
- Não desativar branch protection.
- Não ignorar checks vermelhos reais (nem localmente, nem em CI).
- Não fazer merge sem aprovação explícita do usuário.
- Não apagar branches sem autorização explícita.
- Não alterar `~/.claude` (configuração global do usuário).
- Não alterar hooks globais.
- Não alterar `.claude/settings.local.json`.
- Não criar commit sem autorização explícita do usuário para essa etapa.
- Não dar push sem autorização explícita do usuário para essa etapa.
- Não abrir ou alterar PR sem autorização explícita do usuário para essa
  etapa.
- Autorizações são específicas: autorização para commit não autoriza
  push, PR, merge ou deploy. Cada etapa exige sua própria autorização.

## Referências externas

- São Francisco (ou qualquer outra referência externa de mercado) pode
  ser consultada **somente como referência técnica**, e apenas quando
  isso for explicitamente autorizado para a tarefa em questão.
- Nunca tratar referências externas como fonte comercial automática do
  ChefeBot — preços, cardápio e regras de negócio do ChefeBot vêm do
  repositório e de decisões explícitas do usuário, não de terceiros.
