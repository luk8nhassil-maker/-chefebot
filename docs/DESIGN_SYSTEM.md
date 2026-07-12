# ChefeBot — Design System (temas e cores)

Fonte única da verdade de cor do produto. Regras completas de aplicação na Skill
[`chefebot-theme`](../.claude/skills/chefebot-theme/SKILL.md).

## 1. Princípios

- **Amarelo `#FFCD00` é a marca e a ação principal** — usado com contenção (botões,
  CTA único, item ativo, foco, detalhes). Nunca em fundos inteiros/cards.
- **Light é o tema padrão fixo.** Dark é opcional e só entra por escolha do usuário.
  Nunca seguir o tema do SO/navegador.
- Toda cor vem de **tokens semânticos** (CSS variables) em `src/app/globals.css`.
  Nenhuma página/componente deve conter hex/rgb hardcoded.

## 2. Paleta oficial de marca

| Token | Valor | Papel |
|---|---|---|
| primary | `#FFCD00` | amarelo de marca / ação principal |
| navy | `#192230` | base escura / texto sobre amarelo |
| slate | `#3D474E` | neutro médio |
| graphite | `#2C2F38` | superfície escura |

## 3. Tokens semânticos

Definidos em `:root` (Light, padrão) e sobrescritos em `:root[data-theme="dark"]` (Dark).

### Superfícies e texto

| Token | Light | Dark |
|---|---|---|
| `--background` | `#F6F7F9` | `#192230` |
| `--surface` | `#FFFFFF` | `#232A33` |
| `--surface-secondary` | `#EEF1F4` | `#2C2F38` |
| `--surface-elevated` | `#FFFFFF` | `#343A43` |
| `--foreground` | `#192230` | `#F8FAFC` |
| `--foreground-secondary` | `#3D474E` | `#D1D5DB` |
| `--foreground-muted` | `#66727C` | `#9CA3AF` |
| `--border` | `#DCE1E6` | `#3D474E` |
| `--border-strong` | `#C7CDD3` | `#59636B` |

### Marca / ações

| Token | Light | Dark |
|---|---|---|
| `--primary` | `#FFCD00` | `#FFCD00` |
| `--primary-hover` | `#E6B900` | `#FFD633` |
| `--primary-active` | `#CCA400` | `#E6B900` |
| `--primary-foreground` | `#192230` | `#192230` |
| `--primary-soft` | `#FFF6CC` | `rgba(255,205,0,.14)` |
| `--primary-text` (texto/ícone de marca) | `#7A5C00` | `#FFCD00` |
| `--secondary` | `#192230` | `#3D474E` |
| `--secondary-hover` | `#2C2F38` | `#4B565E` |
| `--secondary-foreground` | `#FFFFFF` | `#FFFFFF` |

> **Regra de ouro:** texto/ícone com cor de marca usa `--primary-text` (nunca `--primary`
> puro, que é amarelo ilegível sobre fundo claro). Texto **sobre** um fundo `--primary`
> usa sempre `--primary-foreground` (navy).

### Status

| Papel | sólido | soft (fundo) | soft (texto) |
|---|---|---|---|
| Sucesso | `--success` | `--success-soft` | `--success-soft-foreground` |
| Erro/destrutivo | `--danger` | `--danger-soft` | `--danger-soft-foreground` |
| Informação/links | `--info` | `--info-soft` | `--info-soft-foreground` |
| Pendente/atenção (**roxo**) | `--attention` | `--attention-soft` | `--attention-soft-foreground` |

Valores sólidos — Light: success `#16A34A`, danger `#DC2626`, info `#2563EB`, attention `#7C3AED`.
Dark: success `#22C55E`, danger `#EF4444`, info `#60A5FA`, attention `#A78BFA`.

> **Pendente/aguardando/atenção usa roxo (`--attention`), nunca amarelo/amber/laranja** —
> o amarelo agora é exclusivamente marca/ação principal.

### Neutros / utilitários

| Token | Light | Dark |
|---|---|---|
| `--disabled-background` | `#E5E7EB` | `#343A43` |
| `--disabled-foreground` | `#9CA3AF` | `#6B7280` |
| `--focus-ring` | `#CCA400` | `#FFD633` |
| `--overlay-rgb` | `25,34,48` | `255,255,255` |
| `--whatsapp` | `#25D366` | `#25D366` |

Translúcidos adaptativos (divisores/hover): `rgba(var(--overlay-rgb), α)`.
Cor com alpha derivada de um status: `color-mix(in srgb, var(--success) 12%, transparent)`.
Sombras prontas: `var(--shadow-sm | --shadow-md | --shadow-lg)`.

## 4. Hierarquia de ações

Uma única ação **visualmente dominante** (amarela) por área.

1. Principal → `--primary` + `--primary-foreground`
2. Secundária → `--secondary` sólido ou outline navy (**nunca** um segundo amarelo)
3. Terciária → ghost / link
4. Sucesso → `--success` (confirmar/concluir)
5. Erro/destrutivo → `--danger`
6. Info/links → `--info`
7. Pendente/atenção → `--attention` (roxo)
8. Desabilitado → tokens `disabled-*`

## 5. Componentes

- **Button**: primary (amarelo+navy), secondary (navy/outline), destructive (vermelho),
  success (verde para conclusão), ghost, disabled (cinza, sem hover).
- **Badge/Status**: par `--<status>-soft` + `--<status>-soft-foreground`; pendente = roxo;
  nunca só cor (acompanhar ícone/texto).
- **Input/Select/Textarea**: fundo `--surface`/`--surface-secondary`, borda `--border`,
  texto `--foreground`, foco com `--focus-ring`.
- **Card/Modal**: `--surface` + `--border` + sombra suave.
- **Navegação (sidebar/nav/bottom-nav)**: item ativo com `--primary-soft`/indicador amarelo e
  texto escuro no Light; amarelo controlado no Dark. Nunca sidebar inteira amarela.
- **Toast/Alert**: usa os pares de status soft.

## 6. Tema: como funciona

- Atributo global `data-theme` no `<html>` (`light` = fallback / `dark`).
- Script anti-flash em `src/app/layout.tsx` aplica o atributo antes da hidratação lendo
  `localStorage['chefebot-theme']` (ausente ⇒ `light`).
- Estado/troca no cliente: `useTheme()` de `src/components/ThemeToggle.tsx`
  (usa `useSyncExternalStore`, sem flash e sem erro de hidratação).
- **Seletor Light/Dark**: componente `<ThemeToggle />` em **Configurações › Aparência**.

## 7. Adicionando uma tela nova sem cor hardcoded

1. Use apenas `var(--token)`. Falta um papel de cor? Crie o token em `globals.css`
   (Light em `:root`, Dark em `:root[data-theme="dark"]`). Nunca hex na página.
2. Uma ação dominante amarela por área; texto de marca via `--primary-text`.
3. Cubra loading/vazio/erro/preenchido com os tokens de status certos.
4. Valide **Light e Dark** em 390 / 768 / 1440 (Skill `browser-qa`).

## 8. Acessibilidade

- Texto sobre `#FFCD00` sempre `#192230`.
- Foco de teclado visível nos dois temas (`:focus-visible` → `--focus-ring`).
- Cor nunca é a única indicação de estado — manter ícone/texto/forma.
