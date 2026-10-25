# ChefeBot — Formulário fiscal compartilhado do dono/contador (25/10/2026)

## Objetivo
O proprietário, autenticado como admin do ChefeBot, poderá preparar um questionário e gerar um link para que o contador preencha dados **somente fiscais**, sem abrir outras telas.

## Escopo técnico
- Página do dono `/configuracoes/nota-fiscal/dados`, autenticada no servidor.
- Página do convite `/configuracoes/nota-fiscal/contador#convite=...` sem login, liberada no proxy **só nesse caminho exato**.
- API pública recebe token **somente no corpo do POST**, nunca na query; token 32 bytes aleatórios, apenas SHA-256 armazenado em Redis com TTL de 72h e ponteiro ativo por dono.
- Criar outro convite invalida o anterior; revogar remove ponteiro ativo; formulário rejeita convite inválido/expirado/revogado.
- Dono e contador enxergam e editam **o mesmo rascunho** usando versão monotônica e EVAL/CAS, sem escrita silenciosa concorrente; conflitos geram HTTP 409.
- Dados do cadastro fiscal anterior v1 usados somente como pré-preenchimento se o novo questionário não existir; registro anterior não é alterado.
- Todos os campos podem ficar em branco no rascunho; se um campo for preenchido ele deve passar pela validação correspondente.
- Campos arbitrários, certificado, token WLG, senha, payloads acima de 8KiB e tentativas de marcar situação `emitir` são bloqueados.
- `Cache-Control: no-store`, Origin conferida, owner requer JWT e admin em todas as ações protegidas.
- Preview bloqueia leitura e gravação em Redis de produção antes de acessar qualquer dado.
- O formulário é só declaratório. Não é autorização do contador, confirmação de titularidade, vínculo WLG ou emissão NFC-e.

## Atenções antes da emissão real
- O ChefeBot ainda usa identidade global de funcionário. O rascunho pertence à conta autenticada, **não é tenant multiempresa**.
- Não expor outros dados do admin ao portador do link; no máximo as respostas do questionário.
- Não inserir A1, CSC, ClientSecret, token nem XML sigiloso nos campos livres.
- Configuração tributária **por ID estável de produto** e homologação SEFAZ/WLG continuam pendentes. Comentários do contador são orientação preliminar, não substituem classificação por item.
- Identificação de titularidade/empresa, contrato do provedor e mecanismos de transmissão e conciliação fiscal são uma fase futura, com aprovação dedicada.
- Não gerar Pix, pedidos nem notas reais em Preview ou testes.

## Plano de rollback
Reverter PR desta feature sem migrar/excluir registros Redis. As chaves novas `fiscal:questionario:v1:*` permanecem inertes; convites têm TTL de 72h. O cadastro legado continua preservado.
