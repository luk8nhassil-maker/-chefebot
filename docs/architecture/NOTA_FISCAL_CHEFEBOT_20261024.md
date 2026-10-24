# ChefeBot — NFC-e (modelo 65): integração e UX seguros — 24/10/2026

## Escopo auditado
Projeto `luk8nhassil-maker/-chefebot`, base `main` no commit `8a723415ea5443962295620d34a8f36d1a420acb`.
O painel `/pedidos` tem pedido, pagamento e impressão NÃO fiscal. A `main` não tem integração com SEFAZ nem classificação tributária por produto, certificado ou token fiscal cadastrados na Vercel. O `snapshotOficial` oferece quantidades e total calculados no servidor; não é um documento fiscal.

## Decisão técnica após comparação de custo — 24/10/2026

### Primeiro candidato: WLG Sistemas (gratuito declarado; homologação obrigatória)
- Oferta oficial: https://wlgsistemas.com.br/api-emissao-nfe — REST para NF-e/NFC-e modelo 65, **R$ 0/mês, sem limite anunciado de notas, sem cartão**. Declaração comercial do fornecedor, NÃO preço contratual nem estabilidade/verificação independente.
- Documentação pública: https://fiscal.wlgsistemas.com.br/swagger — foi possível abrir a interface Swagger publicamente, **mas não validar a especificação JSON completa nem fazer emissão autenticada**.
- Fluxo documentado: `POST /api/v1/auth/token` com ClientId/ClientSecret -> `POST /api/v1/nfe` com `tipoAmbiente:2`, `ide.modelo:65` e cadastro fiscal -> recebe `operationId` -> `GET /api/v1/operacoes/{operationId}` até obter status -> XML/DANFE, conforme contrato final.
- Como a emissão é **assíncrona**, é indispensável guardar e consultar `operationId`; após timeout nunca repetir emissão sem conciliar o protocolo e o status fiscal. É preciso confirmar com WLG se há idempotência por referência e como recuperar uma emissão cujo retorno HTTP se perdeu.
- **Antes de confiança em produção:** confirmar custo/API sem limites por escrito, termos/LGPD, suporte, uptime, compatibilidade real SEFAZ MA, retenção/portabilidade do XML, suporte ao layout tributário 2026, limites técnicos/rate limit, cancelamento NFC-e e documentação OpenAPI completa. Testar homologação com cadastro fiscal real da empresa, mas dados de consumo sintéticos e ambiente 2. Sem isso a WLG é **candidata preferida**, não emissor operacional validado.
- Credenciais previstas SOMENTE server-side: `WLG_FISCAL_CLIENT_ID`, `WLG_FISCAL_CLIENT_SECRET`, `WLG_FISCAL_EMPRESA_ID` e `FISCAL_EMITENTE_CNPJ`; nenhuma foi configurada. A UI permanece desligada e o POST fiscal retorna 423 mesmo que todas estejam preenchidas.

### Alternativas/fallback
- Notaas https://www.notaas.com.br/: 50 notas mensais no plano gratuito e valor anunciado R$ 0,50 por nota excedente. Apesar de anunciar NFC-e, falta verificar fluxo fiscal real no Maranhão, estabilidade e documentação.
- Focus NFe https://focusnfe.com.br/precos/ : oferta Retail com franquia de NFC-e, paga, e API própria em https://doc.focusnfe.com.br/reference/emitir_nfce. Fallback se WLG falhar em homologação, custeio ou confiabilidade.
- Notavia https://www.notavia.com.br/: plano gratuito de **NF-e (modelo 55)** com limite de 3/dia. Não confundir com NFC-e modelo 65, que é o documento alvo; não escolhida para esta integração.
- O emissor gratuito da NF-e do Sebrae não garante API de **NFC-e**; não atende ao objetivo técnico de emissão via botão.
- Custos adicionais possíveis: certificado digital A1, contador/assessoria fiscal, regularização/cadastro e operação de suporte. Custo TOTAL zero ainda não comprovado.
- Evitar acoplamento: a configuração fiscal e o adapter por emissor devem ser separados de preços/pedidos; manter Focus como fallback sem reescrever o painel.
- Nuvem Fiscal descartada para nova integração devido a aviso do fornecedor de encerramento (https://www.nuvemfiscal.com.br/).

## Perspectivas técnicas (NÃO substituem avaliação assinada por contador ou advogado)
1. **Contabilidade e tributação**: confirmar cadastro regular, regime tributário, IE, credenciamento NFC-e MA, certificado digital A1, CSC/ID do CSC, NCM/CEST quando aplicável, CFOP, CST/CSOSN, PIS/COFINS, unidade de medida e regras de descontos, frete, cortesia e pagamentos. Para pizzas com vários sabores, bordas ou adicionais, aprovar se a linha fiscal é o item composto ou linhas separadas; não inferir por nome.
2. **Jurídico/regulatório**: documento válido exige autorização fiscal do órgão competente. O comprovante de pagamento e o cupom da cozinha NÃO são NFC-e. Definir política de dados pessoais do CPF/CNPJ do destinatário, conservação XML e logs, consulta, cancelamento e contingência segundo as normas aplicáveis; não reemitir em falha de rede sem consulta ao documento anterior.
3. **Engenharia/segurança**: chave fiscal exclusiva por pedido/comanda, lock e persistência durável para idempotência. Falha ou timeout torna estado incerto: consultar a referência no provedor antes de qualquer tentativa adicional. Nenhum valor fiscal vindo do browser. Somente equipe autenticada. Configuração por CNPJ/tenant e servidor. Credenciais nunca nos logs/client.
4. **UX/UI**: ação no detalhe do pedido, modal curto com produtos, total e situação real. Se habilitado no futuro, mostrar "Conferir e emitir" e depois "Nota autorizada: imprimir/compartilhar"; estados distintos: configuração pendente, aguardando, autorizada, rejeitada, incerta e cancelada. Nunca mostrar "emitida" antes da autorização do provedor.

## Estado desta branch (preparação sem emissão)
- `src/lib/fiscal/nfcePreflight.ts`: confere coerência do snapshot em centavos, status do pedido, Pix, descontos/frete e Salão sem alterar nada. Sempre `podeEmitir=false` até habilitação por implementação separada, testada e com documentação fiscal aprovada.
- `src/app/api/fiscal/nfce/preparar/route.ts`: GET autenticado (admin/atendente/dev), somente leitura Redis, sem-cache, bloqueio Preview. POST autenticado sempre responde 423; nenhuma emissão possível.
- `src/components/FiscalNfcePreflight.tsx`: modal com resumo fiel, erros claros e ação de emissão indisponível. É montado em `/pedidos` apenas quando `NEXT_PUBLIC_FISCAL_NFCE_UI=true`, variável NOVA, propositalmente não definida em produção. Não altera visual corrente.
- `src/lib/fiscal/nfcePreflight.test.ts`: checagem de divergência, valores inválidos, Pix, Salão, cancelamento, acesso, Preview e inexistência de escritas.
- `.github/workflows/fiscal-nfce-seguro-ci.yml`: testes unitários, lint, TypeScript, sem segredos ou chamadas reais.
- Nenhum dado fiscal, CNPJ real, certificado, código tributário ou preço comercial foi inventado. Não foi criado pedido, Pix, estoque, mensagem, nota ou assinatura paga.

## Requisitos antes de ativação real (bloqueio externo real)
- Cadastro do emitente e confirmação do responsável fiscal, sem enviar credenciais no chat.
- Credenciamento e ambiente fiscal SEFAZ MA, CSC e certificado A1 vigente; cadastro do CNPJ junto ao emissor.
- Tabela por ID estável de produto com campos fiscais **aprovados por contador habilitado**. Definir tratamento de meio a meio, adicionais, descontos, entrega e cortesias.
- Validar natureza da operação e modelo correto nas vendas do Salão (uma comanda fechada pode conter várias rodadas), delivery e retirada; pagamento real confirmado.
- Definir e testar mapeamento das formas de pagamento e regras de CPF/CNPJ.
- Implementar adapter WLG com token de servidor, certificado configurado no fornecedor, envio somente homologação, guarda durável de operationId, lock/idempotência por venda, consulta após timeout, protocolo, XML/DANFC-e, cancelamento e armazenamento auditável. Se WLG não cumprir os critérios, trocar apenas adapter por provedor alternativo. Nunca enviar nota de teste para produção.
- Homologar casos com SEFAZ/provedor usando ambiente de teste isolado. Exigir evidências de aceitação e de não duplicação.
- Testes de regressão de pedidos, Pix, fila de impressão, delivery, Salão, fidelidade, ranking, stock e auth. Segurança do Preview e rollback sem afetar documentos fiscais.

## Fluxo de aceite da funcionalidade final
Pedido elegível/conta quitada -> abrir "Emitir NF" -> conferir resumo do pedido -> CPF/CNPJ opcional somente quando conforme regras -> emitir uma vez -> consulta SEFAZ -> autorização -> mostrar DANFC-e/QR/XML e compartilhar/imprimir.
Qualquer dúvida de estado -> consultar, nunca emitir de novo cegamente.

## Critério de conclusão
Esta branch entrega apenas **preparação técnica e UX isolada**, não "nota fiscal pronta". A funcionalidade NÃO está concluída até credenciamento, classificação aprovada, integração real, testes de homologação e verificação fiscal. Não fazer merge como se a NFC-e estivesse pronta, não alterar variáveis de produção e não fazer deploy por mera conveniência.
