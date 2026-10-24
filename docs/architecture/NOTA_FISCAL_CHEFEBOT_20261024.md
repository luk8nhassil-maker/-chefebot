# ChefeBot — NFC-e (modelo 65): integração e UX seguros — 24/10/2026

## Escopo auditado
Projeto `luk8nhassil-maker/-chefebot`, base `main` no commit `8a723415ea5443962295620d34a8f36d1a420acb`.
O painel `/pedidos` tem pedido, pagamento e impressão NÃO fiscal. A `main` não tem integração com SEFAZ nem classificação tributária por produto, certificado ou token fiscal cadastrados na Vercel. O `snapshotOficial` oferece quantidades e total calculados no servidor; não é um documento fiscal.

## Decisão técnica provisória: Focus NFe
- API: https://doc.focusnfe.com.br/reference/emitir_nfce
- Ambientes: https://doc.focusnfe.com.br/reference/ambiente
- Consulta: https://doc.focusnfe.com.br/reference/consultar_nfce
- Preços vigentes na página oficial: https://focusnfe.com.br/precos/
- API aceita referência única `ref`, informa autorização da SEFAZ e disponibiliza caminhos DANFC-e/XML após autorização.
- Não contratar nem carregar credencial sem autorização e dados do emitente.
- Nuvem Fiscal descartada para nova integração: comunicado público informa desativação em 31/07/2026 (https://www.nuvemfiscal.com.br/).
- A proposta prioriza baixo acoplamento; uma futura migração de emissor deve ocorrer na camada fiscal e não afetar pedidos.

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
- Implementar gateway FocusNFe com autenticação apenas servidor, ref fixa, lock, consulta após timeout, DANFC-e/XML, cancelamento e armazenamento auditável. Nunca enviar nota de teste para produção.
- Homologar casos com SEFAZ/provedor usando ambiente de teste isolado. Exigir evidências de aceitação e de não duplicação.
- Testes de regressão de pedidos, Pix, fila de impressão, delivery, Salão, fidelidade, ranking, stock e auth. Segurança do Preview e rollback sem afetar documentos fiscais.

## Fluxo de aceite da funcionalidade final
Pedido elegível/conta quitada -> abrir "Emitir NF" -> conferir resumo do pedido -> CPF/CNPJ opcional somente quando conforme regras -> emitir uma vez -> consulta SEFAZ -> autorização -> mostrar DANFC-e/QR/XML e compartilhar/imprimir.
Qualquer dúvida de estado -> consultar, nunca emitir de novo cegamente.

## Critério de conclusão
Esta branch entrega apenas **preparação técnica e UX isolada**, não "nota fiscal pronta". A funcionalidade NÃO está concluída até credenciamento, classificação aprovada, integração real, testes de homologação e verificação fiscal. Não fazer merge como se a NFC-e estivesse pronta, não alterar variáveis de produção e não fazer deploy por mera conveniência.
