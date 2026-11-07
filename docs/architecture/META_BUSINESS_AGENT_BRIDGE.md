# Ponte de consulta — Meta Business Agent

## Estado

- Código preparado na branch `feat/meta-business-agent-bridge-20261107`.
- Integração desligada por padrão.
- A conta Meta ainda não tem uma WABA vinculada e a criação anterior foi bloqueada por dados de contato da empresa.
- Nenhum agente ou número foi cadastrado pela aplicação.
- O WhatsApp atual continua usando Evolution API/Baileys sem alteração.

## Primeira etapa

`GET /api/integrations/meta-business-agent/catalog` devolve somente dados de consulta:

- catálogo público de pizzas e demais produtos, com IDs e valores em centavos;
- disponibilidade atual;
- horário de funcionamento;
- bairros e taxa de entrega em centavos.

A rota não cria pedido, Pix, estoque, mensagem, impressão ou registro de conversa. Não retorna formas de pagamento nem dados de clientes.

## Proteções

- `META_BUSINESS_AGENT_CONNECTOR_ENABLED` precisa ser `true`.
- `META_BUSINESS_AGENT_CONNECTOR_SECRET` precisa ter ao menos 32 bytes e é enviado como `Authorization: Bearer ...`.
- Sem a configuração ou com token incorreto, a rota não consulta os dados.
- A rota é bloqueada em Preview para impedir leitura acidental do Redis de produção.
- A resposta usa `Cache-Control: no-store`.

As variáveis não foram adicionadas a nenhum ambiente. Para habilitar no futuro, confirmar WABA e número de teste elegíveis, configurar somente um segredo de teste e registrar a ferramenta de consulta no conector Meta. Não apontar o conector para o número Evolution/Baileys existente.

## Próximas etapas

1. Liberar a pendência de contato empresarial na Meta.
2. Confirmar elegibilidade do número exclusivo de teste na WhatsApp Business Platform.
3. Configurar e testar o conector Meta em ambiente isolado, primeiro só com consulta.
4. Só depois amadurecer pedidos, pagamento e controle de conversa como uma etapa separada, com autorização e testes próprios.
