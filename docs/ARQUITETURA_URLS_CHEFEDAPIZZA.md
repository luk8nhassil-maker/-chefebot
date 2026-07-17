# Arquitetura de URLs — Migração para chefedapizza.com.br

> **Status deste documento:** auditoria + plano técnico. Nenhum código funcional, middleware, DNS, cookie, PWA ou API foi alterado para produzi-lo. Todas as afirmações da seção 1 são comprovadas por arquivo real do repositório (citado como `arquivo:linha`). Recomendações e pontos que exigem validação em produção estão marcados explicitamente como tal — nunca apresentados como fato.
>
> Domínio oficial tratado neste documento: **`https://chefedapizza.com.br`** (não `chefedapizza.com`, que é outro domínio e não deve ser usado).

---

## Sumário

1. [Estado atual comprovado](#1-estado-atual-comprovado)
2. [Tabela completa de rotas atuais](#2-tabela-completa-de-rotas-atuais)
3. [Arquitetura final recomendada](#3-arquitetura-final-recomendada)
4. [Mapa de rota atual para rota canônica](#4-mapa-de-rota-atual-para-rota-canônica)
5. [Rotas que continuarão existindo por compatibilidade](#5-rotas-que-continuarão-existindo-por-compatibilidade)
6. [Estratégia de rewrite/redirect/alias por rota](#6-estratégia-de-rewrite-redirect-ou-alias-para-cada-rota)
7. [Arquitetura do subdomínio painel](#7-arquitetura-do-subdomínio-painel)
8. [Impacto em cookies e autenticação](#8-impacto-em-cookies-e-autenticação)
9. [Impacto em PWA e service worker](#9-impacto-em-pwa-e-service-worker)
10. [Impacto em APIs, Pix, WhatsApp e webhooks](#10-impacto-em-apis-pix-whatsapp-e-webhooks)
11. [Riscos](#11-riscos)
12. [Plano de rollback](#12-plano-de-rollback)
13. [Testes necessários](#13-testes-necessários)
14. [Implementação dividida em PRs pequenos e independentes](#14-implementação-dividida-em-prs-pequenos-e-independentes)
15. [Ordem recomendada de execução](#15-ordem-recomendada-de-execução)

---

## 1. Estado atual comprovado

Fatos verificados diretamente no repositório em `main` (commit `b6c2957`, PR #219 já mesclado):

### 1.1 Domínio e rewrite já existentes

- `middleware.ts:17,22-26` já implementa um rewrite condicional: quando `hostname === "chefedapizza.com.br"` **e** `pathname === "/"`, a resposta é reescrita internamente para `/cardapio` via `NextResponse.rewrite(req.nextUrl.clone())`. Isso é o único tratamento de domínio hoje existente no código — nenhuma outra rota do apex, e nenhum subdomínio, tem tratamento equivalente.
- `middleware.ts:11-15` — `getHostname()` já normaliza `x-forwarded-host`/`host` (lowercase, sem porta, primeiro host de lista separada por vírgula). Essa função só é usada para o rewrite da raiz, não para nenhuma outra decisão de host.
- `middleware.ts:55` — matcher atual: `["/", "/pedidos/:path*", "/relatorios/:path*", "/admin/:path*", "/dev/:path*", "/configuracoes/:path*", "/setup/:path*"]`. **Não inclui `/api/:path*` nem `/cliente/:path*`.**

### 1.2 Projeto Vercel oficial

- `docs/DEPLOYMENT.md:3-9` — projeto oficial é `chefebot-pjif`, branch `main`, ambiente `Production`. `chefebot` e `chefebot-3ke5` são projetos duplicados não oficiais (`docs/DEPLOYMENT.md:19`), a manter ignorados.

### 1.3 Autenticação — dois sistemas distintos e independentes

- **Equipe** (`src/lib/auth.ts:1-44`): JWT assinado via `jose`, cookie `auth-token`, papéis `admin | atendente | dev | contador | financeiro | entregador`. `ROUTE_ROLES` (`src/lib/auth.ts:34-44`) lista as regras de acesso por prefixo de rota, **incluindo `/api/orders`, `/api/padroes`, `/api/funcionarios`** — mas o matcher do middleware (item 1.1) não intercepta `/api/*`. Confirmado que essas três rotas de API se protegem sozinhas, chamando `verifyToken`/lendo `auth-token` internamente (`src/app/api/orders/route.ts:111,113`; `src/app/api/padroes/route.ts:13,15`; `src/app/api/funcionarios/route.ts:24,26`).
- **Cliente final** (`src/lib/clienteAuth.ts`): fluxo de OTP via WhatsApp, cookie `cliente-token` (`src/lib/clienteAuth.ts:5`), setado em `src/app/api/cliente/verificar/route.ts:24-30`. Sem relação com o JWT de equipe.

### 1.4 Gap de proteção pré-existente (fato, não introduzido por este documento)

- `/financeiro` (`src/app/financeiro/page.tsx`), `/contador` (`src/app/contador/page.tsx`) e `/entregador` (`src/app/entregador/page.tsx`) **não estão no matcher do middleware nem em `ROUTE_ROLES`**. Suas APIs de apoio (`src/app/api/financeiro/route.ts`, `src/app/api/entregadores/route.ts`, `src/app/api/entregador-pedidos/route.ts`, `src/app/api/anthropic/route.ts`) também não têm nenhuma checagem de `auth-token`/`verifyToken` (confirmado por grep — zero ocorrências). Essas páginas têm botão de "Sair" (sugerindo expectativa de sessão autenticada: `src/app/financeiro/page.tsx:247`, `src/app/contador/page.tsx:131`), mas hoje o acesso à URL/API não é bloqueado por falta de token. Isso é **anterior a qualquer mudança de domínio** e não deve ser confundido com um risco introduzido pela migração — mas é relevante porque `/financeiro` está listado na navegação do painel (`src/components/PanelShell.tsx:145`) e no escopo do subdomínio `painel.chefedapizza.com.br` proposto pelo usuário.

### 1.5 Cookies não têm `domain` definido

- `src/app/api/auth/login/route.ts:13-14`, `src/app/dev-login/route.ts` e `src/app/api/cliente/verificar/route.ts:24-30` setam seus cookies (`auth-token`, `auth-user`, `cliente-token`) **sem a opção `domain`**. Por padrão do navegador, isso restringe o cookie ao host exato que respondeu a requisição — não há propagação automática para um subdomínio. Este é o fato central por trás do risco descrito na seção 8.

### 1.6 Redirecionamento pós-login — dois padrões distintos, um sem validação

- Painel (equipe): parâmetro `callbackUrl`, lido em `src/app/login/page.tsx:20` e usado em `getDestino(role, callbackUrl)` (`src/app/login/page.tsx:7-15`) — **retorna o valor de `callbackUrl` diretamente, sem allowlist**. Usado por `src/app/admin/page.tsx:223`, `src/app/configuracoes/page.tsx:216`, `src/app/conversas/page.tsx:198`, `src/app/pedidos/page.tsx:558`, `src/app/relatorios/page.tsx:23,26,29`, `src/app/cardapio/promocoes/page.tsx:139`.
- Cliente: parâmetro `next`, validado por allowlist em `destinoNextPermitido()` (`src/lib/clientePedidos.ts:271-273`, testado contra `https://evil.example.com`, `//evil.example.com`, `javascript:alert(1)` em `src/lib/clientePedidos.test.ts:336-358`). Usado por `src/app/cliente/page.tsx:93,124,160` e originado em `src/app/cliente/pedidos/page.tsx:170`.
- **Fato relevante para a migração**: `callbackUrl` sem allowlist é uma condição pré-existente (open redirect potencial) independente do domínio, mas qualquer PR que toque o fluxo de login (ex.: para levar em conta um subdomínio painel) deve evitar piorar essa condição, e idealmente não deve estendê-la para tratar hosts externos sem validação.

### 1.7 URLs enviadas a usuários finais hoje apontam para o domínio Vercel antigo, não para chefedapizza.com.br

Confirmado por leitura direta de código (não apenas grep):

- `src/lib/bot.ts:1039` — `export const LINK_CARDAPIO_DIGITAL = "https://chefebot-pjif.vercel.app/cardapio";` — enviado repetidamente pelo bot via WhatsApp.
- `src/app/api/orders/route.ts:27` — `const APP_BASE_URL = 'https://chefebot-pjif.vercel.app'`, usada em `route.ts:241` (link `/entregador?id=...` ao motoboy) e `route.ts:252` (link `/rastrear/${pedido.id}` ao cliente).
- `src/app/api/whatsapp/route.ts:1363` — mensagem com **string duplicada** (não reaproveita `LINK_CARDAPIO_DIGITAL`): `` `Se preferir ver o cardápio digital, é só acessar:\nhttps://chefebot-pjif.vercel.app/cardapio` ``.
- `src/lib/evolutionApi.ts:13` — `WEBHOOK_URL_PADRAO = "https://chefebot-pjif.vercel.app/api/whatsapp"` — fallback só usado se `EVOLUTION_WEBHOOK_URL` não estiver setada (`src/lib/evolutionApi.ts:51`); a config real vem de env var, não é hardcode cego.
- Fallbacks com `process.env.VERCEL_URL` antes do hardcode: `src/app/api/whatsapp/route.ts:201`, `src/app/api/pedido-app/route.ts:280`, `src/lib/pixGuardiaoScheduler.ts:66`, `src/app/api/cardapio-imagens/route.ts:44` (este usa `NEXT_PUBLIC_URL`).
- **Não existe hoje nenhuma variável de ambiente do tipo `SITE_URL`/`BASE_URL`/`APP_URL` documentada em `.env.example`** — não há uma única fonte de verdade para "URL base do app".
- **Consequência direta**: o rewrite de `middleware.ts` (item 1.1) faz a *entrada* funcionar em `chefedapizza.com.br`, mas os links que o bot *envia* ao cliente continuam apontando para `chefebot-pjif.vercel.app`. Hoje isso ainda funciona (o domínio antigo continua servindo o app), mas gera inconsistência de marca e é o primeiro ponto a corrigir na migração — **e essa correção é código de produção, fora do escopo "somente auditoria" deste documento**.

### 1.8 QR Codes

- Toda ocorrência de "QR Code" encontrada no código (`src/app/setup/page.tsx`, `src/app/admin/page.tsx`, `src/app/api/whatsapp/qrcode/route.ts`, `src/lib/evolutionApi.ts`) refere-se ao **pareamento do WhatsApp/Evolution API** (QR Code de conexão do número, uso interno/admin) — **não existe QR Code de cardápio ou de pedido voltado ao cliente final** no código atual.

### 1.9 PWA — manifest orientado ao painel, registrado em todo o app

- `public/manifest.json:5` — `"start_url": "/pedidos"`; `"description": "Painel de pedidos ChefeBot"`; `shortcuts` (`manifest.json:14-38`) apontam para `/pedidos?filtro=novo` e `/pedidos?acao=pausar`. Não há `scope` nem `id` definidos.
- `src/app/layout.tsx:38` — `<link rel="manifest" href="/manifest.json" />` no `RootLayout`, aplicado a **todas** as rotas (cliente, cardápio, painel).
- `src/app/layout.tsx:57-67` — registro do service worker (`navigator.serviceWorker.register('/sw.js')`) também no `RootLayout`, sem condicional por rota.
- `public/sw.js:2` — `OFFLINE = ["/pedidos", "/login"]`, únicas URLs pré-cacheadas; estratégia é network-first com fallback ao cache (`sw.js:14-17`); `notificationclick` sempre abre `/pedidos` (`sw.js:38-43`). Nenhuma URL absoluta com domínio está hardcoded no service worker — tudo é relativo.
- **Fato relevante**: o manifest/PWA atual já é, por si só, pensado para a equipe (painel), mesmo sendo servido também nas páginas do cliente. Isso é uma condição pré-existente, não criada pela proposta de domínio — mas qualquer separação client vs. painel por host deve necessariamente lidar com isso (ver seção 9).

### 1.10 CORS

- Não há nenhuma configuração de CORS/`Access-Control-Allow-Origin` em `next.config.ts` (vazio: `const nextConfig: NextConfig = {}`), nem em nenhuma rota de API, nem middleware customizado. Toda chamada `fetch()` a APIs internas encontrada no código usa caminho relativo (`fetch("/api/...")`) — não há nenhuma chamada `fetch()` do cliente para uma URL absoluta do próprio sistema. **Isso significa que, enquanto o painel continuar servido pelo mesmo deployment/projeto Vercel (mudando apenas o alias de domínio), chamadas relativas a `/api/*` continuam same-origin e não exigem CORS.**

### 1.11 Integrações externas

- **Mercado Pago**: a criação de cobrança Pix (`src/lib/mercadoPagoPix.ts:53-66`) **não envia `notification_url`** no payload — o endpoint de webhook (`src/app/api/pix/webhook/route.ts`) é configurado manualmente no painel do Mercado Pago, fora do código. Validação por `MERCADOPAGO_WEBHOOK_SECRET` (`src/app/api/pix/webhook/route.ts:37`).
- **WhatsApp/Evolution API**: webhook recebido em `src/app/api/whatsapp/route.ts` (`POST`, linha 918); URL configurada via `EVOLUTION_WEBHOOK_URL` com fallback hardcoded (item 1.7).
- **QStash** (Guardião Pix): `src/app/api/interno/pix-guardiao/verificar/route.ts` — autenticado por assinatura `upstash-signature`, comentário explícito de que só o QStash deve chamar essa rota.
- **Cron interno da Vercel**: `src/app/api/cron/route.ts:22-23` (e demais `src/app/api/cron/*`) — protegido por `Authorization: Bearer ${CRON_SECRET}`.
- **Pix pendente** (`/pedido/pagamento/[token]`): o `statusToken` **nunca é enviado por WhatsApp** — trafega só dentro do app via `localStorage` (`src/lib/pixPendenteLocal.ts`, escrito em `src/app/cardapio/page.tsx:1453`, lido/exibido por `src/components/PixPendenteBar.tsx:119`). Não depende de link cross-domain.
- **Fidelidade**: não há nenhuma URL de fidelidade enviada por canal externo (WhatsApp/push) — acesso é só via navegação interna em `/cliente`.

### 1.12 Rotas legadas ou de uso incerto

- `src/app/loja/page.tsx` — já é um redirect puro para `/cardapio` (`redirect('/cardapio')`, linha 5), com comentário "Loja desativada". Não há mais navegação ativa para `/loja` no restante do código (nenhum `Link`/`router.push`/`<a>` encontrado apontando para `/loja`).
- `src/app/simulador/page.tsx` + `src/components/NavBar.tsx` — `NavBar` só é usado por `/simulador` e contém `<Link href="/">Dashboard</Link>` (`NavBar.tsx:91`), que hoje aponta para a landing page institucional (ou para o cardápio, dependendo do host, após o rewrite da seção 1.1) — não para um dashboard real. Indício de navegação obsoleta dentro dessa página specific.
- `src/app/sobre/page.tsx` — página institucional autocontida, sem nenhum link interno apontando para ela (`grep` não encontrou `"/sobre"` fora do próprio arquivo) — provavelmente usada só via link direto em campanhas externas.

---

## 2. Tabela completa de rotas atuais

Classificação: **cliente pública**, **cliente autenticada**, **equipe operacional**, **administração**, **configuração**, **desenvolvimento**, **API**, **webhook**, **legada/uso incerto**.

| Rota | Arquivo | Classificação | Proteção hoje |
|---|---|---|---|
| `/` | `src/app/page.tsx` | cliente pública (landing institucional Ominix) | nenhuma; rewrite condicional para `/cardapio` só se host = `chefedapizza.com.br` |
| `/cardapio` | `src/app/cardapio/page.tsx` | cliente pública | nenhuma |
| `/cardapio/promocoes` | `src/app/cardapio/promocoes/page.tsx` | cliente/equipe (gestão de promoções, exige login mas rota não está no matcher) | login client-side (`?callbackUrl=/cardapio/promocoes`), sem middleware |
| `/cliente` | `src/app/cliente/page.tsx` | cliente autenticada (cookie `cliente-token`) | verificação client-side + API `/api/cliente/verificar` |
| `/cliente/pedidos` | `src/app/cliente/pedidos/page.tsx` | cliente autenticada | idem |
| `/pedido` | `src/app/pedido/page.tsx` | cliente pública (fluxo de montagem de pedido) | nenhuma |
| `/pedido/editar/[id]` | `src/app/pedido/editar/[id]/page.tsx` | cliente pública (token na query) | token de edição via query string |
| `/pedido/pagamento/[token]` | `src/app/pedido/pagamento/[token]/page.tsx` | cliente pública (token na própria URL) | token opaco na URL |
| `/rastrear/[pedidoId]` | `src/app/rastrear/[pedidoId]/page.tsx` | cliente pública (id + token opcional na query) | nenhuma forte (id previsível; token opcional reforça) |
| `/loja` | `src/app/loja/page.tsx` | **legada** — redirect puro para `/cardapio` | n/a |
| `/simulador` | `src/app/simulador/page.tsx` | **legada/uso incerto** — demo interna | nenhuma |
| `/sobre` | `src/app/sobre/page.tsx` | cliente pública (institucional/marketing) | nenhuma |
| `/login` | `src/app/login/page.tsx` | equipe operacional (entrada) | nenhuma (é a própria tela de login) |
| `/dev-login` | `src/app/dev-login/route.ts` | desenvolvimento | só ativa fora de produção (`ENABLE_DEV_AUTH`) |
| `/pedidos` | `src/app/pedidos/page.tsx` | equipe operacional | middleware (`admin`, `atendente`, `dev`) |
| `/pedidos/[id]/imprimir` | `src/app/pedidos/[id]/imprimir/page.tsx` | equipe operacional | middleware via prefixo `/pedidos` |
| `/conversas` | `src/app/conversas/page.tsx` | equipe operacional | **não está no matcher do middleware** — proteção só client-side (`callbackUrl=/conversas`) |
| `/admin` | `src/app/admin/page.tsx` | administração | middleware (`admin`, `dev`) |
| `/configuracoes` | `src/app/configuracoes/page.tsx` | configuração | middleware (`admin`, `atendente`, `dev`) |
| `/relatorios` | `src/app/relatorios/page.tsx` | administração | middleware (`admin`, `dev`) |
| `/financeiro` | `src/app/financeiro/page.tsx` | administração | **nenhuma** (fora do matcher e de `ROUTE_ROLES`) |
| `/contador` | `src/app/contador/page.tsx` | equipe operacional (assistente IA) | **nenhuma** |
| `/entregador` | `src/app/entregador/page.tsx` | equipe operacional | **nenhuma** |
| `/setup` | `src/app/setup/page.tsx` | desenvolvimento/configuração inicial | middleware (`admin`, `dev`) |
| `/dev` | `src/app/dev/page.tsx` | desenvolvimento | middleware (`dev`) |
| `/dev/mcp` | `src/app/dev/mcp/page.tsx` | desenvolvimento | middleware via prefixo `/dev` |
| `/dev/pix` | `src/app/dev/pix/page.tsx` | desenvolvimento | middleware via prefixo `/dev` |
| `/dev/redis-status` | `src/app/dev/redis-status/page.tsx` | desenvolvimento | middleware via prefixo `/dev` |
| `/api/auth/login`, `/logout`, `/verify` | `src/app/api/auth/*` | API (auth equipe) | pública (login), self-check (verify) |
| `/api/cliente/*` | `src/app/api/cliente/*` | API (auth/dados cliente) | pública (login/verificar), cookie `cliente-token` nas demais |
| `/api/orders` | `src/app/api/orders/route.ts` | API | verificação interna de `auth-token` |
| `/api/padroes` | `src/app/api/padroes/route.ts` | API | verificação interna de `auth-token` (role `dev`) |
| `/api/funcionarios` | `src/app/api/funcionarios/route.ts` | API | verificação interna de `auth-token` |
| `/api/financeiro` | `src/app/api/financeiro/route.ts` | API | **nenhuma** |
| `/api/entregadores`, `/api/entregador-pedidos` | `src/app/api/*` | API | **nenhuma** |
| `/api/anthropic` | `src/app/api/anthropic/route.ts` | API | **nenhuma** |
| `/api/cardapio`, `/api/cardapio-imagens`, `/api/cardapio-whatsapp-session` | `src/app/api/*` | API | pública/interna conforme uso |
| `/api/pedido-app/*` | `src/app/api/pedido-app/*` | API | token de pedido |
| `/api/pedido-combinado`, `/api/pedido-loja`, `/api/pedido-status` | `src/app/api/*` | API | pública/token |
| `/api/pix/webhook` | `src/app/api/pix/webhook/route.ts` | **webhook** (Mercado Pago) | assinatura `MERCADOPAGO_WEBHOOK_SECRET` |
| `/api/whatsapp` | `src/app/api/whatsapp/route.ts` | **webhook** (Evolution API) | validação própria do provider |
| `/api/whatsapp/qrcode`, `/reset`, `/state` | `src/app/api/whatsapp/*` | API interna (admin/setup) | não auditado em detalhe (fora do escopo desta rodada) |
| `/api/interno/pix-guardiao/verificar` | `src/app/api/interno/pix-guardiao/verificar/route.ts` | **webhook interno** (QStash) | assinatura `upstash-signature` |
| `/api/cron`, `/api/cron/*` | `src/app/api/cron/*` | **webhook interno** (Vercel Cron) | `Authorization: Bearer CRON_SECRET` |
| `/api/push` | `src/app/api/push/route.ts` | API (push subscription) | não auditado em detalhe |
| `/api/fidelidade/config` | `src/app/api/fidelidade/config/route.ts` | API | não auditado em detalhe |
| `/api/avaliacoes`, `/api/ranking` | `src/app/api/*` | API | não auditado em detalhe |
| `/api/dev/*` | `src/app/api/dev/*` | API desenvolvimento | não auditado em detalhe |
| `/api/logs`, `/api/debug-keys` | `src/app/api/*` | API desenvolvimento/diagnóstico | não auditado em detalhe |
| demais `src/app/api/*` não listadas acima | — | API | não auditadas em detalhe nesta rodada — recomenda-se auditoria de autenticação dedicada antes de expor qualquer subdomínio novo |

> Nota: esta tabela cobre as ~90 rotas encontradas em `src/app` (via `page.tsx`/`route.ts`/`layout.tsx`). Onde a auditoria desta rodada não confirmou o mecanismo de proteção linha a linha, está marcado como "não auditado em detalhe" — não deve ser lido como "sem proteção", apenas como "não comprovado aqui".

---

## 3. Arquitetura final recomendada

Arquitetura-alvo proposta pelo usuário, adotada como recomendação (não implementada nesta etapa):

**Área do cliente** (apex `chefedapizza.com.br`):

- `https://chefedapizza.com.br` → `/cardapio`
- `https://chefedapizza.com.br/conta` → `/cliente`
- `https://chefedapizza.com.br/meus-pedidos` → `/cliente/pedidos`
- `https://chefedapizza.com.br/acompanhar/[pedidoId]` → `/rastrear/[pedidoId]`

**Área da equipe** (subdomínio `painel.chefedapizza.com.br`):

- `https://painel.chefedapizza.com.br` → futuramente `/pedidos`
- `/pedidos`, `/admin`, `/configuracoes`, `/relatorios`, `/login`

**Área técnica**: permanece em `chefebot-pjif.vercel.app` para `/dev`, `/setup` — sem `dev.chefedapizza.com.br`, sem exposição pública de rotas técnicas.

**APIs**: permanecem em `/api/*` do mesmo projeto — sem `api.chefedapizza.com.br`.

**`www`**: `www.chefedapizza.com.br` planejado como redirect permanente para o apex — não implementado nesta etapa (envolve DNS).

---

## 4. Mapa de rota atual para rota canônica

| Rota atual | Rota canônica alvo | Observação |
|---|---|---|
| `/cardapio` | `chefedapizza.com.br` (raiz) | já coberto por rewrite existente (`middleware.ts:22-26`) |
| `/cliente` | `chefedapizza.com.br/conta` | requer novo alias — rota atual deve continuar funcionando (ver seção 5) |
| `/cliente/pedidos` | `chefedapizza.com.br/meus-pedidos` | idem |
| `/rastrear/[pedidoId]` | `chefedapizza.com.br/acompanhar/[pedidoId]` | idem; **atenção**: hoje é usada com `?token=` na query em vários pontos (`src/app/cardapio/page.tsx:1954`, `src/app/rastrear/[pedidoId]/page.tsx:279`) — o alias precisa preservar query string |
| `/pedidos` | `painel.chefedapizza.com.br/pedidos` | rota já existe, só muda o host de entrada |
| `/admin` | `painel.chefedapizza.com.br/admin` | idem |
| `/configuracoes` | `painel.chefedapizza.com.br/configuracoes` | idem |
| `/relatorios` | `painel.chefedapizza.com.br/relatorios` | idem |
| `/login` | `painel.chefedapizza.com.br/login` | idem — mas `/login` também é usado por clientes de `/cardapio/promocoes`; ver seção 11 (risco) |
| `/dev`, `/setup` | permanece em `chefebot-pjif.vercel.app` | sem alias no domínio novo |
| `/api/*` | permanece relativo, mesmo projeto | nenhuma mudança de host |

---

## 5. Rotas que continuarão existindo por compatibilidade

Confirmação explícita, por exigência do escopo: as rotas abaixo **devem continuar respondendo exatamente como hoje**, independente de qualquer alias introduzido:

- `/cardapio` — continua a existir como path real (o alias da raiz é um rewrite, não uma remoção).
- `/cliente` — continua a existir; `/conta` seria um alias adicional, não substituição.
- `/cliente/pedidos` — idem, com `/meus-pedidos` como alias adicional.
- `/rastrear/[pedidoId]` — idem, com `/acompanhar/[pedidoId]` como alias adicional. **Crítico**: os links já enviados/gerados hoje (WhatsApp, `localStorage`) usam `/rastrear/...` — qualquer pedido em trânsito no momento de um deploy depende dessa rota continuar válida.
- `/pedidos`, `/admin`, `/configuracoes`, `/relatorios` — continuam a existir como paths reais; o subdomínio `painel.` seria apenas uma forma adicional de alcançá-las (rewrite/alias de host), nunca uma rota substituta que quebre a existente.

Nenhuma rota deve ser apagada, renomeada ou ter seu path original invalidado nesta migração — inclusive por exigência explícita do usuário.

---

## 6. Estratégia de rewrite, redirect ou alias para cada rota

Esta seção é **recomendação técnica**, não implementação. Compara as três abordagens disponíveis no Next.js Middleware/App Router e recomenda uma por caso.

| Alias desejado | Rota real | Estratégia recomendada | Por quê |
|---|---|---|---|
| `chefedapizza.com.br` (raiz) | `/cardapio` | **rewrite** (já implementado) | URL deve permanecer a raiz na barra — comprovado como requisito de negócio (PR #219) |
| `/conta` | `/cliente` | **rewrite** interno (`NextResponse.rewrite`), path exato `/conta` | mantém a marca "conta" na URL sem duplicar código; usar `req.nextUrl.clone()` para preservar query (ex.: `?next=`) |
| `/meus-pedidos` | `/cliente/pedidos` | **rewrite** interno | idem |
| `/acompanhar/[pedidoId]` | `/rastrear/[pedidoId]` | **rewrite** interno, preservando `[pedidoId]` e query string (`?token=`) | crítico preservar `?token=` — usado em `src/app/rastrear/[pedidoId]/page.tsx:279` e no link de edição de pedido |
| `painel.chefedapizza.com.br` (raiz do subdomínio) | `/pedidos` | **rewrite condicional por host** dentro do mesmo middleware, análogo ao já existente para `chefedapizza.com.br` | evita redirect visível; consistente com o padrão já aprovado no PR #219 |
| `painel.chefedapizza.com.br/pedidos`, `/admin`, `/configuracoes`, `/relatorios`, `/login` | rotas homônimas atuais | **nenhum rewrite necessário** — se o subdomínio apontar para o mesmo deployment, o path já bate 1:1 | mais simples; risco fica todo concentrado na detecção de host + cookies (seção 8), não em roteamento |
| `www.chefedapizza.com.br` | `chefedapizza.com.br` | **redirect permanente (308)** configurado na Vercel (domain redirect), não em código | é o padrão recomendado pela própria Vercel para canonicalização de `www`; não deve ser feito via middleware para não adicionar latência a toda requisição |

**Por que rewrite (não redirect) para os aliases do cliente**: o requisito de negócio original (PR #219) foi explícito — a URL deve permanecer a alternativa "bonita" na barra do navegador. Redirects (3xx) trocam a URL visível; rewrites não. Todos os aliases de cliente/painel devem seguir o mesmo padrão já validado, por consistência.

**Por que não usar `redirect` para `/rastrear` → `/acompanhar`**: um redirect quebraria links já distribuídos (WhatsApp) apontando para `/rastrear/...`, forçando um hop a mais; e a UI já usa `/rastrear/...` como path real em produção — inverter a direção (fazer `/rastrear` redirecionar para `/acompanhar`) tornaria o path novo a fonte de verdade prematuramente, antes de todos os pontos de geração de link serem migrados (ver seção 10).

---

## 7. Arquitetura do subdomínio painel

**Fatos que restringem o desenho** (não avaliados como "vai funcionar" sem prova):

1. `painel.chefedapizza.com.br` é, para fins de cookie e mesma-origem, um host **diferente** de `chefedapizza.com.br`. Cookies setados sem `domain` (seção 1.5) não cruzam entre os dois.
2. `PanelShell.tsx:126,174` (navegação principal do painel, botão "Cardápio") faz `router.push("/cardapio")` — uma navegação client-side relativa ao host atual. Se o painel estiver em `painel.chefedapizza.com.br` e `/cardapio` só existir no apex `chefedapizza.com.br`, esse botão navegaria para `painel.chefedapizza.com.br/cardapio`, que **não existiria nesse host** (a menos que o subdomínio sirva o app inteiro, não só as rotas do painel).
3. Da mesma forma, `src/app/pedidos/page.tsx:2704` (`router.push("/cardapio")`) e `src/app/pedidos/page.tsx:2696` (`router.push("/conversas")`) são navegações internas ao painel que cruzariam para fora do escopo "só rotas de equipe" se o subdomínio fosse restrito a um subconjunto de paths.
4. `src/app/admin/page.tsx:822-825` navega para `/pedidos`, `/configuracoes`, `/financeiro`, `/relatorios` — todas dentro do escopo "equipe", consistente com o subdomínio proposto.

**Duas opções de implementação técnica, ambas viáveis com o mesmo projeto Vercel (`chefebot-pjif`), a decidir antes da Fase 2 (seção 15):**

- **Opção A — mesmo deployment, alias de domínio + rewrite condicional por host** (recomendada): `painel.chefedapizza.com.br` aponta para o mesmo projeto Vercel; o middleware ganha uma segunda condição de host (`hostname === "painel.chefedapizza.com.br"`) que faz rewrite da raiz para `/pedidos`, e deixa todas as demais rotas do painel passarem por rewrite implícito 1:1 (sem alterar path). **Vantagem**: `/cardapio` continua existindo no mesmo deployment, então `router.push("/cardapio")` a partir do painel segue funcionando **desde que o navegador esteja em `chefedapizza.com.br` e não em `painel.chefedapizza.com.br`** — o que só é verdade se essas navegações forem convertidas para link absoluto (`<a href="https://chefedapizza.com.br/cardapio">` ou `window.location.href`) quando o app perceber que está rodando sob o host `painel.`. Isso é uma mudança de código real, fora do escopo desta auditoria, e deve virar um PR dedicado (seção 14).
- **Opção B — dois domínios apontando ao mesmo deployment sem rewrite de host**: `painel.chefedapizza.com.br` serve o app inteiro (todas as rotas, inclusive `/cardapio`), só que por convenção a equipe usa a raiz redirecionada para `/pedidos`. **Vantagem**: nenhuma navegação interna quebra, porque todas as rotas continuam existindo em ambos os hosts. **Desvantagem**: não isola de fato "área técnica" de "área do cliente" — um cliente poderia acidentalmente acessar `painel.chefedapizza.com.br/cardapio` e nada impediria tecnicamente (a separação seria só por não divulgar o link) — mais fraco como "arquitetura", mas zero risco de quebra de navegação interna.

Este documento **não recomenda uma opção final** sem validação em produção — ver "pontos que exigem validação" abaixo.

**Pontos que exigem validação em produção (não assumir):**

- Se um cookie `auth-token` setado com `domain: ".chefedapizza.com.br"` realmente propaga entre `chefedapizza.com.br` e `painel.chefedapizza.com.br` no ambiente real da Vercel (deveria, por especificação de cookies, mas não foi testado neste repositório).
- Se a Vercel aplica alguma política adicional de isolamento entre domínio raiz e subdomínio dentro do mesmo projeto (não encontrado nada no `vercel.json` ou `next.config.ts` que sugira isso, mas não é um dado que o código local possa confirmar).
- Comportamento do Service Worker (escopo por origem) quando o mesmo `sw.js` é registrado em dois hosts diferentes do mesmo projeto — teoricamente cada origem tem seu próprio registro/cache isolado, mas não testado.

---

## 8. Impacto em cookies e autenticação

- **Nenhuma rota de API de login seta `domain` no cookie hoje** (`auth-token`, `auth-user`, `cliente-token` — seção 1.5). Isso significa que, se `painel.chefedapizza.com.br` for adotado (Opção A da seção 7), o login precisa necessariamente acontecer **no mesmo host** que serve as rotas protegidas — ou seja, `/login` também precisaria estar em `painel.chefedapizza.com.br`, o que já é o desenho proposto pelo usuário (`painel.chefedapizza.com.br/login`).
- **Risco concreto**: `/cardapio/promocoes` (`src/app/cardapio/promocoes/page.tsx:139`) redireciona para `/login?callbackUrl=/cardapio/promocoes` quando não autenticado — mas `/cardapio` está previsto para ficar no apex, enquanto `/login` está previsto para ficar no subdomínio painel. Se essas duas rotas ficarem em hosts diferentes, o fluxo de login de `/cardapio/promocoes` precisa ser redesenhado (redirect cross-host para `painel.chefedapizza.com.br/login?callbackUrl=...`, e o cookie resultante precisa ter `domain` compartilhado para a promoção de volta a `/cardapio/promocoes` no apex funcionar). **Isso não foi resolvido pela arquitetura proposta pelo usuário e precisa de uma decisão explícita antes da Fase 2.**
- **Recomendação, não implementação**: se a Opção A for escolhida, os três `cookies().set(...)` (`src/app/api/auth/login/route.ts:14-15`, `src/app/dev-login/route.ts`, `src/app/api/cliente/verificar/route.ts:24-30`) precisariam ganhar `domain: ".chefedapizza.com.br"` para permitir compartilhamento entre apex e subdomínio — mas isso é uma mudança de comportamento de cookie e está fora do escopo "não alterar cookies" desta etapa.
- **Middleware**: hoje só há tratamento de host para `chefedapizza.com.br` (seção 1.1). Qualquer suporte a `painel.chefedapizza.com.br` exige nova lógica de host no mesmo arquivo, testada com os mesmos princípios do PR #219 (matcher explícito, sem captura global).

---

## 9. Impacto em PWA e service worker

- O manifest atual (`public/manifest.json`) e o service worker (`public/sw.js`) são **hoje compartilhados por todo o app**, mas conteúdo/`start_url`/`shortcuts` são todos orientados à equipe (`/pedidos`). Isso é uma condição pré-existente (seção 1.9), não introduzida por esta migração.
- **Se a Opção A (painel como host separado) for adotada**: o ideal seria ter dois manifests distintos — um para o cliente (servido em `chefedapizza.com.br`, `start_url: "/cardapio"` ou `/`) e outro para a equipe (servido em `painel.chefedapizza.com.br`, mantendo `start_url: "/pedidos"`). Isso exigiria servir `manifest.json` condicionalmente por host (rota dinâmica em vez de arquivo estático em `public/`) — mudança de código real, fora do escopo desta auditoria.
- **Risco de cache ao introduzir aliases**: o service worker faz cache network-first apenas de `/pedidos` e `/login` (`sw.js:2`) — introduzir `/conta`, `/meus-pedidos`, `/acompanhar/[id]` como aliases não quebra o SW (ele não teria essas URLs cacheadas de qualquer forma, cai sempre em rede), mas **um usuário que já instalou o PWA com o manifest atual** (`start_url: /pedidos`) manteria esse `start_url` até uma atualização de manifest ser detectada pelo navegador — instalar/desinstalar não é algo que o time controla remotamente.
- **Ponto que exige validação em produção**: se a Vercel/navegador tratam corretamente dois `manifest.json` diferentes por host dentro do mesmo projeto (não testado).

---

## 10. Impacto em APIs, Pix, WhatsApp e webhooks

- **APIs (`/api/*`)**: nenhuma mudança de rota necessária — permanecem no mesmo projeto, chamadas via path relativo (confirmado ausência de CORS e ausência de fetch absoluto — seção 1.10). O plano do usuário de "não criar `api.chefedapizza.com.br`" é consistente com o que já existe.
- **Pix/Mercado Pago**: nenhuma mudança de código necessária a princípio — o webhook é registrado manualmente no painel do Mercado Pago (seção 1.11), fora do repositório. **Ação operacional (não-código) a não esquecer**: se o host que responde `/api/pix/webhook` mudar (ex.: se o domínio oficial de produção migrar do Vercel para `chefedapizza.com.br` em algum momento futuro), a URL cadastrada no painel do Mercado Pago precisa ser atualizada manualmente — isso é orquestração externa, não uma mudança de PR.
- **WhatsApp (mensagens enviadas ao cliente)**: **requer mudança de código real** para os links ficarem corretos:
  - `LINK_CARDAPIO_DIGITAL` (`src/lib/bot.ts:1039`) e a string duplicada em `src/app/api/whatsapp/route.ts:1363` continuam apontando para `chefebot-pjif.vercel.app`.
  - `APP_BASE_URL` (`src/app/api/orders/route.ts:27`) idem, usada nos links de rastreio e entregador.
  - Essa correção é necessária **independente** da introdução de `/acompanhar` ou `painel.` — mesmo mantendo `/rastrear/[id]` como path real, o domínio enviado deveria ser `chefedapizza.com.br`, não o domínio Vercel. **Recomenda-se que isso seja o primeiro PR de código desta iniciativa** (antes de qualquer subdomínio), por ser isolado, de baixo risco, e já resolver a inconsistência de marca identificada na seção 1.7.
- **Evolution API (webhook recebido)**: `EVOLUTION_WEBHOOK_URL` já é configurável por env var (seção 1.7) — não depende de mudança de código, só de configuração de ambiente/infra, se o host de recebimento mudar.
- **QStash/Guardião Pix**: `PIX_GUARDIAO_QSTASH_CALLBACK_URL` já é configurável por env var (`.env.example:16-18`) — mesma situação.
- **Cron interno**: paths `/api/cron/*` não mudam de host (mesmo projeto Vercel sempre os executa).

---

## 11. Riscos

Ordenados por severidade, cada um com base em fato comprovado (não hipótese):

1. **Alto — Links enviados por WhatsApp continuam com o domínio antigo.** `LINK_CARDAPIO_DIGITAL`, `APP_BASE_URL` e a string duplicada em `whatsapp/route.ts:1363` (seção 1.7) não usam o domínio oficial. Enquanto não corrigido, toda a migração de domínio é "só de entrada" — o cliente que recebe uma mensagem do bot continua sendo levado ao Vercel antigo.
2. **Alto — Login cross-host não resolvido para `/cardapio/promocoes`.** Se `/cardapio` fica no apex e `/login` no subdomínio painel, o fluxo de login dessa página específica quebra sem uma decisão de cookie compartilhado (seção 8).
3. **Alto — Navegação interna do painel (`PanelShell`, `pedidos/page.tsx`) depende de rotas relativas que cruzam o limite proposto para o subdomínio.** `router.push("/cardapio")`, `router.push("/conversas")` a partir de páginas que ficariam em `painel.chefedapizza.com.br` (seção 7, itens 2-3) quebram se o subdomínio não servir essas rotas.
4. **Médio — Cookies sem `domain` não propagam entre apex e subdomínio por padrão do navegador.** Fato comprovado (seção 1.5); mitigação exige mudança de código de cookie, fora do escopo desta etapa.
5. **Médio — `callbackUrl` sem allowlist (open redirect) é uma condição pré-existente que qualquer PR que toque `/login` deve ter cuidado para não agravar** (seção 1.6) — por exemplo, ao adicionar suporte a redirecionar para um host diferente (painel), não se deve aceitar qualquer valor de host sem validação.
6. **Médio — Gap de proteção pré-existente em `/financeiro`, `/contador`, `/entregador` e suas APIs** (seção 1.4) — se essas rotas forem incluídas no subdomínio painel sem correção prévia, o subdomínio herdaria esse gap (hoje mitigado apenas por obscuridade de URL).
7. **Baixo/médio — PWA/manifest único orientado ao painel, servido em todas as rotas** (seção 1.9) — não bloqueia a migração, mas gera experiência inconsistente para quem instala o "app" a partir do cardápio do cliente.
8. **Baixo — Ação operacional externa esquecida (Mercado Pago).** Se o host de webhook mudar no futuro, precisa de atualização manual no painel do Mercado Pago — risco de esquecimento, não de código.
9. **Baixo — `/rastrear/[pedidoId]` sem autenticação forte** (id previsível, token opcional) — condição pré-existente, não criada por este plano, mas relevante se a rota ganhar um alias mais divulgado (`/acompanhar`) que aumente a superfície de descoberta.

---

## 12. Plano de rollback

Como nenhuma mudança de comportamento foi feita nesta etapa, não há rollback a executar agora. Para as fases futuras (seção 14), cada PR deve seguir o mesmo padrão usado no PR #219:

- Cada alias novo (rewrite condicional por host/path) deve ser **aditivo**: a rota original continua respondendo sem alteração, então reverter um PR de alias é sempre reverter apenas o commit do rewrite, sem efeito colateral nas rotas pré-existentes.
- Para qualquer PR que altere `middleware.ts`, o rollback padrão é `git revert` do commit específico — o histórico do PR #219 mostra que isso é seguro porque o matcher é explícito (não uma captura global) e cada condição de host é independente.
- Para o PR de correção de links do WhatsApp (`LINK_CARDAPIO_DIGITAL`, `APP_BASE_URL`), o rollback é trivial (reverter a constante) — mas deve-se documentar que qualquer pedido cujo link já foi enviado ao cliente antes do rollback continua válido, pois nenhuma rota é removida.
- Para a introdução do subdomínio `painel.chefedapizza.com.br` (Vercel domain), o rollback envolve remover o alias de domínio na Vercel — ação de infraestrutura, não reversível por `git revert` sozinho; deve ficar registrado como passo manual separado no PR correspondente.
- Nenhuma fase desta migração deve apagar ou renomear uma rota existente — isso by design elimina a necessidade de "recriar" algo em caso de rollback.

---

## 13. Testes necessários

Para cada fase futura (não implementada nesta etapa), replicando o padrão de teste já usado em `middleware.test.ts` (PR #219):

**Rewrites de alias do cliente** (`/conta`, `/meus-pedidos`, `/acompanhar/[id]`):

- alias faz rewrite para a rota real, preservando path dinâmico e query string;
- rota original (`/cliente`, `/cliente/pedidos`, `/rastrear/[id]`) continua respondendo sem rewrite quando acessada diretamente;
- alias não entra em loop (checar `x-middleware-rewrite` uma única vez, como já testado no PR #219);
- outro host/domínio não aciona o alias.

**Subdomínio painel** (qualquer que seja a opção escolhida na seção 7):

- host `painel.chefedapizza.com.br` + `/` faz rewrite para `/pedidos` (se Opção A);
- host `painel.chefedapizza.com.br` + rota protegida sem `auth-token` redireciona para `painel.chefedapizza.com.br/login` (não para o apex);
- cookie setado no login do painel é lido corretamente nas rotas protegidas do mesmo host (teste de integração, não só unitário de middleware);
- **teste manual em produção obrigatório** (não simulável em `vitest`): login real em `painel.chefedapizza.com.br`, verificar se o cookie aparece no DevTools com o `domain` esperado, navegar entre páginas do painel sem novo login.
- navegação `router.push("/cardapio")` a partir do painel: comportamento esperado documentado e testado (seja link absoluto para o apex, seja rota espelhada) — depende da decisão da seção 7.

**Correção de links do WhatsApp**:

- teste unitário confirmando que `LINK_CARDAPIO_DIGITAL` (e qualquer nova constante central) aponta para `chefedapizza.com.br`;
- teste garantindo que não há mais nenhuma string literal duplicada do domínio antigo (ex.: grep automatizado em CI, ou teste que falha se `"chefebot-pjif.vercel.app"` aparecer fora de testes/fallbacks documentados);
- teste de `anexarTokenAoLinkCardapio` continua passando com a constante atualizada (`src/lib/cardapioToken.ts:71-75` já depende do valor de `LINK_CARDAPIO_DIGITAL`, não deveria quebrar, mas deve ser reexecutado).

**Regressão geral**:

- suíte completa (`npm run test`) após cada PR;
- `npm run build`;
- validação manual do checklist de `docs/DEPLOYMENT.md:38-47` (fluxo de pedido, Pix, dinheiro, atendimento humano) sempre que o PR tocar middleware, cookies ou links de WhatsApp — já que esse checklist cobre exatamente as áreas de maior risco desta migração.

---

## 14. Implementação dividida em PRs pequenos e independentes

Cada PR abaixo é desenhado para ser revertível isoladamente e não depender dos seguintes para ficar em estado consistente:

1. **PR — Corrigir links do WhatsApp para o domínio oficial.** Atualiza `LINK_CARDAPIO_DIGITAL` (`src/lib/bot.ts:1039`), `APP_BASE_URL` (`src/app/api/orders/route.ts:27`), a string duplicada em `src/app/api/whatsapp/route.ts:1363`, e os fallbacks hardcoded (`src/lib/evolutionApi.ts:13`, `src/lib/pixGuardiaoScheduler.ts:66`, `src/app/api/cardapio-imagens/route.ts:44`, `src/app/api/whatsapp/route.ts:201`, `src/app/api/pedido-app/route.ts:280`) para `chefedapizza.com.br`. Idealmente introduz uma única constante/env var (`NEXT_PUBLIC_SITE_URL` ou similar) reaproveitada em todos esses pontos, eliminando a duplicação atual. **Sem dependência de domínio novo** — pode ir para produção assim que o domínio já estiver servindo o app (já está, pelo PR #219).
2. **PR — Aliases de rewrite do cliente** (`/conta`, `/meus-pedidos`, `/acompanhar/[pedidoId]`). Segue exatamente o padrão do PR #219: condição de path (não precisa nem de condição de host, já que são aliases dentro do mesmo apex), preservando query string via `req.nextUrl.clone()`. Testes conforme seção 13.
3. **PR — Decisão e prova de conceito de cookie cross-host** (`domain: ".chefedapizza.com.br"`). PR isolado, testável em ambiente de preview da Vercel com um subdomínio de teste, **antes** de comprometer a arquitetura do painel a uma opção. Este PR não deve ir para produção sem validação manual documentada (seção 8).
4. **PR — Correção do fluxo de login de `/cardapio/promocoes`** caso a decisão do PR 3 exija cross-host. Depende do PR 3.
5. **PR — Registro do domínio `painel.chefedapizza.com.br` na Vercel** (ação de infraestrutura, não necessariamente um PR de código — mas deve ser documentado e datado como os demais).
6. **PR — Rewrite condicional de host para `painel.chefedapizza.com.br`** no `middleware.ts`, seguindo o padrão do PR #219 (host normalizado, matcher explícito, sem captura global). Depende dos PRs 3-5.
7. **PR — Ajuste de navegação interna do painel** (`PanelShell.tsx`, `src/app/admin/page.tsx`, `src/app/pedidos/page.tsx`) para os botões que cruzam o limite apex/subdomínio (`/cardapio`, `/conversas` se aplicável) usarem link absoluto para o host correto quando detectado que a página está sob `painel.`. Depende do PR 6.
8. **PR — Fechar o gap de proteção pré-existente em `/financeiro`, `/contador`, `/entregador`** (seção 1.4) — recomendado **antes** do PR 6, já que essas rotas entrariam no escopo do subdomínio painel; tecnicamente independente da migração de domínio, mas relevante o bastante para não ser adiado indefinidamente.
9. **PR — Separação de manifest/PWA por host** (cliente vs. painel), se a Opção A da seção 7 for confirmada. Depende dos PRs 6-7.
10. **PR — `www.chefedapizza.com.br` → redirect permanente**, configurado via Vercel (não via middleware) — independente de todos os anteriores, pode ser feito a qualquer momento após validação de DNS (fora do escopo de código).

---

## 15. Ordem recomendada de execução

1. **PR 1** (links do WhatsApp) — maior impacto de marca, menor risco técnico, zero dependência de infraestrutura nova.
2. **PR 8** (fechar gap de proteção `/financeiro`/`/contador`/`/entregador`) — resolve uma condição de risco pré-existente antes de expandir a superfície do painel para um subdomínio público.
3. **PR 2** (aliases de cliente) — mesmo padrão já aprovado no PR #219, baixo risco, entrega valor de produto (URLs mais amigáveis) sem depender do subdomínio.
4. **PR 3** (prova de conceito de cookie cross-host) — feito em ambiente de preview, com validação manual documentada antes de prosseguir.
5. **PR 4** (login cross-host de `/cardapio/promocoes`), somente se PR 3 confirmar a necessidade.
6. **PR 5** (registrar domínio `painel.` na Vercel) — ação de infraestrutura, feita só depois da PoC de cookie ter uma resposta.
7. **PR 6** (rewrite de host para `painel.`) — depende de 3-5.
8. **PR 7** (ajuste de navegação interna do painel) — depende de 6; deve ser validado manualmente em produção antes de considerar o subdomínio "pronto" (não só testes automatizados).
9. **PR 9** (separação de PWA/manifest por host) — última etapa técnica, menor urgência.
10. **PR 10** (`www` → redirect) — pode ser feito em paralelo a qualquer momento, é o mais isolado de todos.

Esta ordem prioriza: (a) resolver a inconsistência de marca já existente primeiro, por ser isolada e de baixo risco; (b) fechar o gap de segurança pré-existente antes de aumentar a exposição pública das rotas afetadas; (c) só comprometer a arquitetura a um subdomínio real depois de uma prova de conceito de cookie validada em ambiente de preview — evitando o risco descrito na seção 11, item 3, de quebrar navegação interna do painel sem plano de mitigação já testado.
