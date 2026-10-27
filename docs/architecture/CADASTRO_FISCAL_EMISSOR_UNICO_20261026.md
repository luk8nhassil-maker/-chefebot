# ChefeBot — simplificação do formulário fiscal para um emissor (26/10/2026)

## Pedido
O dono só quer cadastrar um CNPJ e seu endereço fiscal para o emissor das notas da pizzaria. Não quer responder no formulário se é matriz/filial nem se a pizzaria opera em outro endereço. O contador terá o mesmo formulário compartilhado.

## Menor patch
- Ocultar exclusivamente as perguntas `tipoEstabelecimento` e `vendaOutroEndereco` no formulário do dono e do contador.
- Mostrar claramente o CNPJ e o endereço fiscal do emitente único; contar apenas os campos visíveis.
- Manter schema/API/Redis/tokens/convites e os campos antigos persistidos, preservando compatibilidade.
- Manter fiscalmente bloqueada qualquer emissão. O formulário não comprova regularidade nem liberação da SEFAZ-MA.
- Nunca inferir que CNPJ da padaria esteja apto a emitir notas das vendas de pizzaria em endereço diverso. A legalidade do emitente é uma verificação externa obrigatória do contador/SEFAZ, não pergunta a leigo.
- Não alterar credenciais WLG, pedidos, preço, Pix, dados de clientes ou emissão de notas.

## Regra oficial
Resolução Administrativa GABIN nº 25/2022 do Maranhão, art. 231-N-B e art. 231-N-G: credenciamento e regularidade do emissor exigidos antes da autorização de NFC-e. Fonte: https://www.legisweb.com.br/legislacao/?id=430334

## Testes/rollback
Vitest de campos visíveis, preservação de dados legados; CI fiscal: lint, tsc, build; regressões. Preview não lê/grava dados reais. Reverter o PR para restaurar as perguntas sem eliminar os dados do formulário. Emissão continua desativada.

## Atualização de decisão — 26/10/2026

O proprietário confirmou que **o contador já autorizou, segundo informação recebida pelo proprietário, o uso do CNPJ da padaria como emitente das notas dos produtos vendidos pela pizzaria**. Para este projeto, **todos os dados de identificação do emitente (inclusive endereço fiscal) serão os da padaria**. A pergunta ao proprietário sobre essa aprovação contábil está encerrada e **não deve ser repetida**.

Fonte vigente de decisão: [CHEFEBOT_EMISSOR_FISCAL_PADARIA_20261026](../decisions/CHEFEBOT_EMISSOR_FISCAL_PADARIA_20261026.md). Isso não comprova por si só credenciamento SEFAZ-MA nem habilita emissão no ChefeBot; os requisitos técnicos continuam sujeitos a verificação antes da ativação.
