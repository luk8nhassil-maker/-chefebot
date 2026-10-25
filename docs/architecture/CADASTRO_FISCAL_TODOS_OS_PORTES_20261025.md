# Cadastro fiscal para empresas de qualquer porte — 25/10/2026

## Pedido e objetivo
O formulário existente deve aceitar informações de MEI, ME, EPP e empresas maiores, sem exigir que o dono escolha uma opção que desconhece. A padaria e a pizzaria do caso relatado têm o mesmo dono, mas funcionam em endereços distintos; o sistema não pode presumir que o CNPJ cadastrado na padaria autoriza a pizzaria a emitir.

## Fontes oficiais verificadas
- Receita Federal, CNPJ alfanumérico: https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/cnpj-alfanumerico/cnpj-alfa
- Portal do Empreendedor (FAQ): https://www.gov.br/empresas-e-negocios/pt-br/empreendedor/perguntas-frequentes — MEI não pode ter mais de um estabelecimento.
- Portal NF-e: https://www.nfe.fazenda.gov.br/Portal/perguntasFrequentes.aspx — estabelecimento contribuinte requer inscrição e credenciamento conforme aplicável.

## Implementação limitada e reversível
- No formulário **já compartilhado pelo dono e contador**, acrescentar porte da empresa (MEI, ME, EPP, demais, não informado), tipo de estabelecimento (matriz ou filial), informação de endereço diferente da venda e CNAE principal opcional.
- Separar porte do regime tributário: aceitar SIMEI, Simples, Lucro Presumido, Lucro Real, outro ou não informado, **sem inferir** a partir do porte.
- CNPJ (numérico/alfa) segue com validação já existente, nunca consulta titularidade ou situação legal por si só.
- Campos adicionais são opcionais para salvar rascunho e também para o contador com convite temporário.
- Alerta legível quando CNPJ informado pertence a outro endereço ou MEI está marcado como filial.
- Manter API, autenticação, CAS e convites, Redis e chaves de produção intocados. Nenhuma migração destrutiva; dados antigos sem os novos campos devem continuar legíveis e salváveis.

## Bloqueios explícitos
Os dados declarados no formulário não tornam o emitente regular nem liberam NF-e/NFC-e.
**Exigências ainda fora do escopo:** vínculo autenticado do estabelecimento emissor real, enquadramento e situação cadastral aprovados pelo contador, credenciamento adequado por UF/SEFAZ, contrato e credenciais confirmadas no provedor WLG, mapeamento fiscal de produtos por IDs estáveis, homologação real e idempotência/reconciliação da emissão.

Jamais tratar CNPJ da padaria como CNPJ autorizado para notas da pizzaria sem confirmação cadastral e fiscal. No MEI, não presumir existência de filial. Nem todo CNPJ terá obrigação/capacidade de emitir a mesma modalidade de nota; o emitente/UF/regime determinam a configuração apropriada.

## Verificação e rollback
Testes unitários de validação e compatibilidade, lint, tsc, build e regressões existentes. Preview sem ler/gravar Redis real. Reverter exclusivamente PR desta etapa em caso de regressão; rascunhos legados permanecem intactos.
