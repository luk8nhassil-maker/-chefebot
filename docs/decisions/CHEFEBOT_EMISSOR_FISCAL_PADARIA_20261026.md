# DECISÃO APROVADA — Emitente fiscal da padaria para produtos comercializados pela pizzaria

ID: CHEFEBOT-FISCAL-EMISSOR-PADARIA-20261026
Projeto: ChefeBot / Chefe da Pizza
Título: Padaria como única empresa emissora das notas de produtos da pizzaria
Status: APROVADA COMO REGRA DE NEGÓCIO INFORMADA PELO PROPRIETÁRIO
Data: 26/10/2026
Aprovado por: usuário responsável pelo projeto, nesta conversa

## Contexto confirmado pelo proprietário

O proprietário declarou expressamente que **já consultou o contador**, e que o contador **confirmou que a padaria pode ser usada para emitir as notas fiscais das vendas da pizzaria**, ainda que os negócios operem em locais diferentes. O proprietário solicitou que esta confirmação seja registrada e que **não se volte a perguntar se ele consultou o contador ou se o contador aprovou essa escolha**.

Esta seção documenta uma confirmação **relatada pelo usuário**, não uma consulta independente ao contador, à Receita ou à SEFAZ-MA. A informação contábil fornecida pelo usuário é a decisão de negócio vigente.

## Decisão operacional aprovada

1. **Empresa emissora única:** a padaria.
2. **Dados de identificação na NFC-e:** CNPJ, razão social, inscrição estadual e **endereço fiscal da padaria**, nunca inventar dados cadastrais da pizzaria para o emitente.
3. **Origem dos produtos no ChefeBot:** os produtos e vendas do cardápio da pizzaria podem alimentar a preparação dos documentos fiscais **em nome da padaria**, após configuração/validação técnica da emissão.
4. **Não exigir formulário extra** para dizer se a empresa é matriz ou filial ou onde fica a pizzaria. O formulário já foi simplificado (PR #536).
5. **Não repetir ao usuário** as perguntas sobre se o contador confirmou o uso do CNPJ da padaria, nem tratar essa decisão como pendente de escolha.
6. Não pressupor que o negócio ou o endereço da pizzaria constará dos dados de identificação do emissor no documento fiscal.

## Distinção técnica necessária (não reabre a decisão)

- A confirmação pelo contador, relatada pelo proprietário, **não equivale a prova independente** de credenciamento da inscrição estadual, configuração da SEFAZ-MA, CSC, certificado digital, autorização por documento ou integração WLG.
- **Não afirmar que o ChefeBot já emite notas.** Essa funcionalidade segue separada do cadastro informativo; antes de ativar emissões reais, validar requisitos técnicos/fiscais exigidos pelo sistema e pelo órgão competente, sem perguntar novamente sobre a aprovação já relatada do contador.
- Não habilitar envio de NFC-e, pedidos, Pix, WhatsApp, mutações de Redis ou produção com base apenas neste registro.
- Não inventar ou copiar regras fiscais de produtos da padaria: NCM/CFOP/CST/CSOSN e demais códigos precisam de configuração técnica e fiscal apropriada.
- A nota de compra usada para pré-preencher o cadastro só evidencia os campos identificadores de seu destinatário; a confirmação contábil consta **separadamente** neste registro.

## Impacto técnico

- Formulário: `/configuracoes/nota-fiscal/dados`.
- Questionário compartilhado do contador: `/configuracoes/nota-fiscal/contador`.
- Documento de importação: `docs/architecture/IMPORTACAO_NOTA_FISCAL_20261026.md`.
- Documentação de simplificação: `docs/architecture/CADASTRO_FISCAL_EMISSOR_UNICO_20261026.md`.
- Não alterar automaticamente nenhum campo salvo, credencial ou fluxo de emissão.

## Revisar quando

Somente se o proprietário relatar nova orientação de seu contador, mudança de empresa emissora, alteração relevante na legislação ou incompatibilidade concreta revelada em credenciamento/homologação. Não reabrir a pergunta antiga por rotina.
