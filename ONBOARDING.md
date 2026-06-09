5. Clica em **Deploy**
6. Anota a URL gerada (ex: `chefebot-magda.vercel.app`)

---

## PASSO 5 — Configurar o Webhook

1. Acessa a Evolution API
2. Na instância do cliente, configura o webhook:
   - URL: `https://[url-vercel]/api/whatsapp`
   - Evento: `messages.upsert`

---

## PASSO 6 — Configurar o Cardápio

Abre o arquivo `src/lib/menu.ts` e atualiza:

- [ ] `saltyFlavors` — sabores salgados das pizzas
- [ ] `sweetFlavors` — sabores doces
- [ ] `borders` — bordas disponíveis e preços
- [ ] `lanches` — lanches do cardápio
- [ ] `bebidas` — bebidas disponíveis
- [ ] `sucos` — sucos e vitaminas
- [ ] `neighborhoods` — bairros e taxas de entrega
- [ ] `payments` — formas de pagamento

---

## PASSO 7 — Configurar o Nome da Pizzaria

No painel admin (`/admin`), clica em **Configurar** e define:

- [ ] Nome da pizzaria
- [ ] Horário de abertura
- [ ] Horário de fechamento
- [ ] Chave Pix

---

## PASSO 8 — Teste Final

- [ ] Manda "oi" para o WhatsApp da pizzaria
- [ ] Faz um pedido completo do início ao fim
- [ ] Verifica se o pedido aparece no painel
- [ ] Marca como em preparo e verifica notificação
- [ ] Marca como saiu para entrega e verifica notificação
- [ ] Marca como entregue e verifica pesquisa de satisfação
- [ ] Testa o voltar em alguma etapa
- [ ] Testa digitar "atendente" para escalar
- [ ] Verifica se o painel admin está funcionando

---

## PASSO 9 — Entrega ao Cliente

- [ ] Envia o link do painel: `[url-vercel]/login`
- [ ] Envia as senhas de acesso
- [ ] Explica como usar o painel de pedidos
- [ ] Explica como pausar/ativar o robô
- [ ] Explica como resolver um atendimento escalado

---

## Custos por Cliente

| Serviço | Custo |
|---|---|
| Vercel | Gratuito |
| Upstash Redis | Gratuito |
| Evolution API | Já pago (compartilhado) |
| Anthropic API | ~R$ 5-10/mês |
| **Total** | **~R$ 5-10/mês** |

**Margem por cliente: R$ 140-145/mês** 💰

---

## Contatos de Suporte

- Dev: ominix / @Controle250
- GitHub: github.com/luk8nhassil-maker/-chefebot
- Vercel: vercel.com/luk8nhassil-makers-projects
- Evolution API: evolution-api-production-8f99.up.railway.app