---
name: chefebot-theme
description: Sistema oficial de temas e cores do ChefeBot (amarelo de marca #FFCD00, temas Light/Dark, tokens semânticos). Use SEMPRE que criar ou alterar qualquer tela, componente, botão, badge, status ou navegação — para nunca introduzir cor hardcoded, nunca usar amarelo como warning e manter Light como tema padrão fixo.
---

# Tema e cores do ChefeBot (fonte única da verdade)

Toda cor da interface vem de **tokens semânticos** definidos em `src/app/globals.css`.
Nunca escreva hex/rgb/rgba soltos em página ou componente — consuma `var(--token)`.
Documentação completa e exemplos: `docs/DESIGN_SYSTEM.md`.

## Marca

| Papel | Valor |
|---|---|
| primary (amarelo de marca) | `#FFCD00` |
| navy | `#192230` |
| slate | `#3D474E` |
| graphite | `#2C2F38` |

O amarelo é a **ação principal / identidade**. Use com **contenção**: botões primários,
CTA único por tela, item ativo de navegação, foco, barras de progresso, ícones/detalhes
estratégicos. **Nunca** pintar fundos inteiros, cards ou grandes áreas de amarelo.

## Temas

- **Light** é o tema **padrão e fixo**. Sempre inicia em Light.
- **Dark** só é ativado quando o usuário escolhe explicitamente.
- **Nunca** seguir o tema do SO/navegador. Sem preferência salva ⇒ Light.
- Ativação por atributo global: `data-theme="light"` (fallback) / `data-theme="dark"` no `<html>`.
- Persistência: `localStorage['chefebot-theme']`. Script anti-flash no `layout.tsx` aplica o
  atributo antes da hidratação. Hook/seletor: `src/components/ThemeToggle.tsx`
  (`useTheme()` + `<ThemeToggle />`). Seletor fica em **Configurações › Aparência**.

## Hierarquia de ações (uma dominante por área)

1. **Ação principal / destaque de marca** — `var(--primary)` (amarelo), texto `var(--primary-foreground)` (navy).
   Botão primário, CTA único da tela, item ativo, indicador selecionado, progresso, foco.
   **Nunca** texto amarelo sobre fundo claro — para texto/ícone com cor de marca use `var(--primary-text)`
   (ouro-escuro no Light, amarelo no Dark).
2. **Ação secundária** — `var(--secondary)` / `var(--secondary-foreground)` ou botão outline (borda `var(--secondary)`).
   **Nunca** um segundo amarelo concorrendo com o primary na mesma área.
3. **Ação terciária** — ghost / link / texto. Sem fundo amarelo.
4. **Sucesso / confirmação** — `var(--success)`; superfície `var(--success-soft)` + `var(--success-soft-foreground)`.
5. **Erro / cancelamento / destrutivo** — `var(--danger)`; superfície `var(--danger-soft)` + `var(--danger-soft-foreground)`.
6. **Informação / links** — `var(--info)`; superfície `var(--info-soft)` + `var(--info-soft-foreground)`.
7. **Pendente / aguardando / atenção** — `var(--attention)` (**roxo**); superfície `var(--attention-soft)` + `var(--attention-soft-foreground)`.
   **PROIBIDO** usar amarelo/amber/laranja para warning/pendente — o amarelo agora é a marca.
8. **Neutro / desabilitado** — cinzas: `var(--disabled-background)` / `var(--disabled-foreground)`. Nunca amarelo.

## Tokens de superfície e texto

`--background` · `--surface` · `--surface-secondary` · `--surface-elevated`
`--foreground` · `--foreground-secondary` · `--foreground-muted`
`--border` · `--border-strong`

Overlay adaptativo (divisores/hover translúcidos): `rgba(var(--overlay-rgb), α)`
(preto translúcido no Light, branco translúcido no Dark). Sombras: `var(--shadow-sm|md|lg)`.
Marca WhatsApp (externa, não muda por tema): `var(--whatsapp)`.

## Botões

- **Primary**: fundo `var(--primary)`, texto `var(--primary-foreground)`, hover `var(--primary-hover)`, active `var(--primary-active)`.
- **Secondary**: `var(--secondary)` sólido ou outline navy. Nunca outro amarelo.
- **Destructive**: `var(--danger)`.
- **Success**: `var(--success)` só quando a ação é confirmar/concluir.
- **Ghost**: sem fundo forte.
- **Disabled**: `var(--disabled-background)` / `var(--disabled-foreground)`, sem hover, sem amarelo.

## Badges / status

- Use o par soft: fundo `var(--<status>-soft)` + texto `var(--<status>-soft-foreground)`.
- Pendente = roxo (`attention`), nunca amarelo.
- Nunca depender só da cor: manter ícone/texto/forma junto (acessibilidade).

## Navegação

- **Light**: sidebar/header em superfície clara; item ativo = fundo amarelo suave (`var(--primary-soft)`)
  ou indicador amarelo, com **texto/ícone escuros** (`var(--foreground)`). Não pintar a sidebar inteira de amarelo.
- **Dark**: sidebar integrada ao fundo navy; item ativo com amarelo controlado + texto legível.

## Cards e superfícies

- **Light**: fundo geral levemente acinzentado (`--background`), cards `--surface` brancos, bordas discretas (`--border`), sombras suaves.
- **Dark**: nunca preto puro — navy/graphite; cards separados do fundo; bordas discretas; texto secundário legível.

## Contraste / acessibilidade

- Texto sobre `#FFCD00` **sempre** `#192230` (`--primary-foreground`).
- Foco de teclado visível nos dois temas (`:focus-visible` usa `--focus-ring`).
- Nunca usar cor como única indicação de estado.

## Como adicionar uma tela nova sem cor hardcoded

1. Consuma apenas `var(--token)`. Se faltar um papel de cor, **crie um token** em `globals.css`
   (Light em `:root`, Dark em `:root[data-theme="dark"]`) — não invente hex na página.
2. Uma única ação dominante (amarela) por área.
3. Estados (loading/vazio/erro/preenchido) usando os tokens de status corretos.
4. Valide Light **e** Dark em 390 / 768 / 1440 (ver Skill `browser-qa`).
