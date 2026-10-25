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


## Consulta de operações WLG — preparação posterior (sem emissão)

A branch contém `src/lib/fiscal/wlgConsulta.server.ts` e `wlgConsulta.server.test.ts`:
- autentica exclusivamente em `https://fiscal.wlgsistemas.com.br/api/v1/auth/token` com credenciais de servidor;
- consulta operação EXISTENTE em `GET /api/v1/operacoes/{operationId}`;
- normaliza as situações `processando`, `autorizada`, `rejeitada` e `indeterminada`;
- só marca `autorizada` com status de sucesso + chave numérica de 44 dígitos + data de autorização;
- erros HTTP, timeout, payload malformado e mudanças no contrato são tratados como incertos, jamais como sucesso;
- nunca envia pedido de emissão, cancelamento ou consulta de XML.
- todos os testes são mocks locais, não acessam credenciais ou a API da WLG.
- não existe API pública para consultar `operationId` arbitrário; a consulta precisa ser vinculada a registro fiscal durável do pedido.

**NÃO homologado:** a especificação completa do Swagger em `https://fiscal.wlgsistemas.com.br/swagger` não pôde ser acessada para verificação do schema nesta execução. O estado `SUCCESSO` foi reproduzido conforme exemplo público do fornecedor, mas o JSON completo e os casos de rejeição devem ser confirmados no ambiente de homologação antes de produção. Nunca inferir campos tributários.

**Requisito de prova de idempotência:** a API do fornecedor é assíncrona; uma queda de rede após o POST pode gerar nota sem retornarmos `operationId`. A futura emissão precisa de vínculo e consulta fiscal confiável antes de qualquer reenvio. Enquanto não existir esse mecanismo, **não implementar nem expor POST de emissão** (a rota do ChefeBot continuará respondendo 423).


## Preparação multiempresa — auditoria e implementação 24/10/2026

### Documentação externa pesquisada
Fonte oficial WLG: https://wlgsistemas.com.br/api-emissao-nfe
Fonte oficial WLG multiempresa: https://wlgsistemas.com.br/emissor-nfe-multiempresas
Tela real autenticada da conta do integrador foi fornecida pelo usuário e transcrita em um documento do Drive: https://docs.google.com/document/d/1U1Bvz0OnuNUCqnMYRl1A0t3UduVrCiUove6DppoZwHg/edit
A WLG anuncia API REST gratuita, suporte a múltiplas empresas, `empresaId`, ambiente 2 de homologação, resposta assíncrona HTTP 202/`operationId`, consulta da operação e downloads.
A documentação pública de POST usa campos superiores `empresaId`, `tipoAmbiente`, `ide`, `emitente`, `destinatario`, `itens`, `totais` e `pagamento`. A tela de "Primeiros passos" mostra `nfe` aninhado como exemplo simplificado — **contrato COMPLETO permanece sem verificação**, não assumir mapeamento fiscal nem enviar.
O Swagger https://fiscal.wlgsistemas.com.br/swagger e o JSON não ficaram acessíveis pelas ferramentas públicas nesta execução, portanto não presumir schema completo.
Avisos e permissões comerciais ainda aguardam resposta da WLG; "várias empresas" publicamente descrito NÃO prova que uma pessoa física pode oferecer a API como serviço SaaS a terceiros, e custo total R$0 não inclui necessariamente certificados.

### Nova fronteira de segurança descoberta
O `src/lib/auth.ts` atual em produção autentica apenas `username/name/role` e NÃO inclui ID de estabelecimento no token. O ChefeBot é hoje uma única operação em diversos módulos, não um SaaS multi-tenant comprovado. Logo **não basta criar um empresaId global em env e chamar a API**, isso permitiria confundir quem emite. A rota fiscal GET em PR #527 foi ajustada para falhar fechada em `resolverVinculoWlg(null, [])`: enquanto não houver tenant assinado e vínculo cadastrado no servidor, configurações globais da WLG não liberam a emissão.

### Código criado nesta etapa no PR draft #527
- `src/lib/fiscal/wlgVinculos.ts`: contrato de vínculo entre tenant do ChefeBot, empresaId da WLG e CNPJ validado com dígitos verificadores; nega sem tenant, com duplicidade, sem homologação ou com dados inválidos. Apenas funções puras; NÃO há provisionamento de tenants nem manipulação de certificado.
- `src/lib/fiscal/wlgLedger.ts`: máquina pura de estados para registrar a reserva por RESTAURANTE+CONTA FINAL, marcar envio incerto, acompanhar operationId, receber autorização/rejeição e não reemitir automaticamente após timeout/erro. **Não é ledger persistido/atômico em Redis**: exigência de implementação futura, sujeita a testes de concorrência antes da primeira nota.
- `src/lib/fiscal/wlgHomologacao.server.ts`: transporte de envelope modelo 65 destinado SOMENTE a homologação; valida vínculo, CNPJ, ambiente 2 e contrato explicitamente aprovado no módulo servidor; rejeita operação na Vercel Preview/Produção. Ainda **não referenciado por endpoint HTTP**, sem interação real. A origem do envelope fiscal deve ser exclusivamente dados validados no backend (os campos fiscais não podem vir do browser).
- Testes com fetch mock, IDs e valores sintéticos para isolamento multiempresa, operação assíncrona, timeout, 202 vs autorizado, 409, 500 e não reenvio. Testes simulados não substituem homologação na WLG.

### Passos pendentes antes de emissão funcional
1. Confirmar contrato integrador/terceiros, limites e custos da API WLG, e baixar OpenAPI completo/autenticado em canal seguro.
2. Com uma pizzaria real, obter `empresaId`, credenciamento NFC-e, A1 e CSC e mapa tributário do contador. As credenciais vão para cofre/variáveis criptografadas, não o código/chat/Drive.
3. Criar autenticação/escopo por tenant assinados em **TODOS** os acessos fiscais e suporte a configuração por tenant, sem reutilizar usuário/cookie global entre pizzarias. Provar isolamento.
4. Com contrato real da WLG, construir payload fiscal completo a partir de snapshot do pedido + classificação por ID aprovada. Validar descontos, entrega, refeição no Salão, pagamento híbrido e CPF opcional segundo legislação.
5. Implementar ledger **atômico e durável** (incluindo reserva NX, conciliação de timeout, transições CAS), retenção dos XMLs, consulta segura, cancelamento e auditoria; testar 2 requisições simultâneas.
6. Provar execução de emissão NFC-e modelo 65 em homologação, verificar resultado e arquivo fiscal; somente depois definir a ativação real com aprovação.

Nenhuma chave real, CNPJ operacional ou segredo foi adicionada. A rota POST pública continua sempre com HTTP 423. Não dar merge neste PR como nota fiscal funcional; não alterar Vercel/produção nem criar Preview conectado ao Redis verdadeiro.


## 24/10/2026 — Verificação final para pedido de ativação real WLG

**Fonte oficial consultada nesta etapa:** https://wlgsistemas.com.br/api-emissao-nfe e https://wlgsistemas.com.br/emissor-nfe-multiempresas

**Fatos comprovados:** WLG disponibiliza `POST /api/v1/auth/token`, `POST /api/v1/nfe` (modelo 55/65, `empresaId`, `tipoAmbiente`, HTTP 202 + `operationId`), `GET /api/v1/operacoes/{operationId}`, XML/DANFE e cancelamento. Homologação = ambiente 2, produção = ambiente 1. O portal do integrador autenticado está com **zero empresas** e **zero credenciais** no estado observado. A WLG orienta cadastrar certificado digital e dados fiscais antes de emitir.

**Não comprovado:** endpoint, autenticação, payload, permissões e fluxo para **criação automática de empresas pela API**, mesmo havendo recurso multiempresa no portal Web. OpenAPI/Swagger oficial em `https://fiscal.wlgsistemas.com.br/swagger` não pôde ser acessado pela ferramenta pública de pesquisa. Também faltam CNPJ emissor vinculado/credenciado e classificação fiscal por item da pizzaria aprovada. Não inventar endpoint de cadastro nem payload de tributos.

**Código técnico adicional no PR draft #527:** `wlgLedgerPersistente.server.ts` fornece reserva atômica no Redis (SET NX), transição compare-and-set (EVAL + versão), marcação de envio incerto ANTES da chamada HTTP, rastreamento de `operationId` e conclusão por consulta. Chaves permanentes por tenant e conta final. Os testes são mocks e NENHUMA rota chama esse módulo; nenhuma chave, pedido, WhatsApp, Pix ou nota real foi utilizada.

**Gates impeditivos de produção que são externos e verificáveis:**
1. WLG confirmar/fornecer contrato de criação/vinculação de empresas pela API para SaaS de terceiros (ou fluxo oficial OAuth/delegação/integração), com OpenAPI completo;
2. identidade segura de empresário/pizzaria separada por tenant no ChefeBot: a autenticação atual identifica somente usuários globais; 
3. primeira pizzaria com CNPJ/IE, certificado, CSC, cadastro WLG `empresaId`, credenciamento na SEFAZ e tratamento fiscal aprovado por contador habilitado;
4. validação da emissão homologada com operação real e XML, sem usar dinheiro/pedido/clientes reais; só então aprovar mecanismo de produção e configurar secrets no servidor.

**Regra de segurança:** ausência desses elementos exige que POST público de emissão permaneça HTTP 423 e que um rascunho fiscal não desencadeie chamada externa. Teste unitário com mock ou CI verde não é prova de emissão fiscal na WLG.


## Alternativa confirmada — Contora, cadastro automático sem remover WLG (24/10/2026)

Fonte oficial de cadastro: https://fiscal.contora.com.br/documentacao/empresas — autenticação Bearer, `GET /api/v1/me` e **`PUT /api/v1/companies/by-document/{cnpj}`** idempotente. Exige CNPJ, razão social, regime fiscal real, endereço completo com código IBGE e IE quando aplicável. A API de NFC-e é documentada em https://fiscal.contora.com.br/documentacao/nfce e exige empresa, certificado A1 e CSC antes de qualquer emissão.
Preço público consultado: https://fiscal.contora.com.br/planos — plano gratuito até **500 eventos fiscais de produção/mês** e **100 de homologação/mês**, CNPJs ilimitados. Com saldo de crédito, eventos acima da franquia geram cobrança; não contratar nem consumir sem autorização. Política de expurgo por inatividade documentada em https://fiscal.contora.com.br/documentacao/limites — é necessário baixar e guardar XML/PDF por conta própria.

O novo adapter `src/lib/fiscal/contoraCadastro.server.ts` NÃO substitui nem importa `wlgHomologacao.server.ts`: prepara dados fiscais de rascunho validado, exige endereço declarado com código IBGE e regime concreto (sem inventar default), escolhe **somente homologação**, verifica `GET /me` antes do upsert e confere CNPJ da resposta para evitar vincular o emissor errado. Usa token exclusivamente de `CONTORA_FISCAL_HOMOLOG_TOKEN` no servidor, exige `FISCAL_CONTORA_CADASTRO_HOMOLOG_LIBERADO=true` e bloqueia Preview. O serviço exige confirmação da titularidade/tenant de origem servidor. **Nenhuma rota chama esse adapter** até existir autenticação de empresa real; logo não houve inscrição, teste fiscal real, credencial externa ou deploy.

Faltam: conta/credencial Contora legítima, KYC/vínculo forte tenant/CNPJ no ChefeBot, endereço comercial declarado de cada pizzaria, certificado A1/CSC seguro, catálogo fiscal NCM/CFOP/CST homologado, construção do fluxo NFC-e por pedidos, download/guarda de XML e aprovação da operação. O módulo é técnico e foi testado com fetch mock, não valida disponibilidade real do provedor. Nuvem Fiscal NÃO é opção: seu site anuncia desativação em 31/07/2026.
