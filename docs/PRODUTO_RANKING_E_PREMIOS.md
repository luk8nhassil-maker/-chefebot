# Produto — Ranking, estrelas e benefícios

Data: 2026-09-22

Este documento registra a regra de produto para transformar compras em estrelas,
permitir participação voluntária no ranking e acionar benefícios quando o cliente
atingir uma meta.

## Princípio da experiência

O cliente deve sentir que está acompanhando o próprio progresso, e não entrando
em uma competição. A comunicação deve falar de estrelas, evolução e benefícios
da temporada.

Mensagem de convite aprovada para a interface:

> 🍕 **Suas estrelas podem valer prêmios**
>
> Você já está juntando estrelas. Quer ver seu nome no placar e acompanhar suas
> chances de ganhar?
>
> Para isso, vamos mostrar seu primeiro nome e seu telefone com alguns números
> escondidos. Exemplo: **(11) 9••••-4321**.

O convite deve informar, de forma curta e clara, que o nome e o telefone
mascarado serão usados no placar. A autorização não deve ficar escondida apenas
nas regras da promoção.

## Regras funcionais

1. Cada compra elegível continua somando estrelas, tenha o cliente autorizado o
   ranking ou não.
2. O cliente pode autorizar separadamente:
   - o primeiro nome no ranking;
   - o telefone mascarado no ranking.
3. Sem autorização ativa, o cliente não participa do ranking da campanha e não
   concorre ao prêmio dessa campanha.
4. Ao retirar uma autorização, a identidade deixa de aparecer no ranking na
   próxima leitura. A retirada não apaga nem reduz estrelas já conquistadas.
5. Se o cliente autorizar novamente, volta a aparecer usando o saldo atual de
   estrelas, sem recriar ou duplicar pontos.
6. O saldo de estrelas deve ser mantido em um histórico auditável. A tela pode
   usar o estado de autorização para filtrar quem participa publicamente.
7. Quando o saldo atingir a meta da temporada, o sistema pode iniciar o fluxo
   do benefício somente com um cliente que esteja autorizado e elegível para a
   campanha. Esse contato é uma finalidade separada da exibição pública e deve
   respeitar as regras de comunicação do programa.
8. Foto de perfil permanece desativada até existir uma fonte oficial autorizada
   e uma aprovação específica.

## Filtros do ranking

O painel terá duas visões principais:

- **Valendo prêmio:** mostra somente quem autorizou participar. A ordem dessa
  visão define quem pode ganhar o prêmio da campanha.
- **Visão geral:** mostra as estrelas de todos os clientes disponíveis. Quem não
  autorizou aparece sem nome e sem telefone, com o aviso **“Não participa do
  prêmio”**, mesmo que esteja em primeiro lugar.

O filtro **Minha posição** continua disponível para o cliente consultar o
próprio resultado e saber se está participando.

## Por que não apagar pontos na retirada

Apagar estrelas obtidas por compras transforma privacidade em punição e pode
gerar reclamações, perda de confiança e divergência entre o extrato do cliente
e o saldo do programa. O filtro de participação deve ser feito pela autorização
de exibição, não pela destruição do histórico de compras.

## Estado que o produto deve guardar

- saldo de estrelas e origem de cada crédito;
- meta vigente e versão da regra da temporada;
- autorização atual para nome;
- autorização atual para telefone mascarado;
- data, versão do texto e origem de cada autorização ou retirada;
- estado do benefício quando a meta for atingida.

## Critério para o bot

O bot só deve iniciar uma conversa de benefício quando:

- o cliente tiver atingido a meta vigente;
- os pontos tiverem sido confirmados como válidos;
- não existir processamento anterior do mesmo marco;
- o canal de comunicação estiver disponível e permitido pelas regras do
  programa.

Retirar a autorização do ranking não remove o saldo nem invalida uma compra.
Isso tira o cliente do ranking e da disputa da campanha. Ele continua podendo
usar as estrelas em benefícios gerais do programa, se houver.

## Regra do prêmio

O cliente precisa autorizar a participação antes do encerramento da campanha.
Se não autorizar até o prazo final, mesmo que tenha mais estrelas que todos, não
recebe o prêmio específico do ranking. Essa condição deve aparecer nas regras e
ser resumida no convite de autorização.

As estrelas válidas acumuladas antes da autorização podem contar para a
campanha quando o cliente entrar, desde que isso esteja previsto nas regras.
Essa é a opção recomendada: o cliente não perde compras passadas, mas precisa
entrar na campanha antes do prazo final para concorrer.

## Decisões ainda necessárias

- definir a meta de estrelas por temporada;
- definir quais benefícios existem e seus limites;
- aprovar os textos e versões de autorização;
- definir a política de contato do bot quando a meta for atingida;
- validar as regras da promoção com o responsável jurídico/DPO antes de
  publicar em produção.
