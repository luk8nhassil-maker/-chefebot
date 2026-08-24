import { readFileSync, writeFileSync } from "node:fs"

const path = "src/app/pedidos/page.tsx"
let source = readFileSync(path, "utf8")

function replaceOnce(before, after, label) {
  const first = source.indexOf(before)
  if (first < 0) throw new Error(`Trecho não encontrado: ${label}`)
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Trecho duplicado inesperado: ${label}`)
  source = source.slice(0, first) + after + source.slice(first + before.length)
}

replaceOnce(
  'import { iniciarPollingVisivel } from "@/lib/pollingVisivel"\n',
  'import { iniciarPollingVisivel } from "@/lib/pollingVisivel"\nimport { calcularMediaPreparoMinutos, contarPizzasVendidas } from "@/lib/pedidosMetricas"\n',
  "import de métricas"
)

replaceOnce(
  '  horarioInicio?: string\n  horarioEntrega?: string\n',
  '  horarioInicio?: string\n  horarioEntrega?: string\n  preparoIniciadoEm?: string\n  preparoConcluidoEm?: string\n  pizzasCount?: number\n  snapshotOficial?: {\n    itens?: Array<{ kind?: string; quantidade?: number }>\n  }\n',
  "campos de métricas no Pedido"
)

replaceOnce(
  '  const temposEntregaRef = useRef<Record<string, number>>({})\n',
  '',
  "ref legado de tempo até entrega"
)

replaceOnce(
  '      if (novoStatus === "entregue") { tocarSomEntrega(); temposEntregaRef.current[id] = tempoDesde(pedido.horario, undefined, Date.now()) }\n',
  '      if (novoStatus === "entregue") tocarSomEntrega()\n',
  "efeito de entrega sem métrica falsa"
)

replaceOnce(
  '  const totalHoje = pedidos.length\n  const contagemPorStatus = (s: Status) => pedidos.filter(p => p.status === s).length\n',
  '  const totalPedidos = pedidos.length\n  const pizzasVendidas = contarPizzasVendidas(pedidos)\n  const contagemPorStatus = (s: Status) => pedidos.filter(p => p.status === s).length\n',
  "métricas principais"
)

replaceOnce(
`  const tempoMedioPreparo = (() => {
    const tempos: number[] = []
    for (const p of pedidos.filter(q => q.status === "entregue")) {
      if (p.horarioEntrega) {
        const [h1, m1] = p.horario.split(":").map(Number)
        const [h2, m2] = p.horarioEntrega.split(":").map(Number)
        const diff = (h2 * 60 + m2) - (h1 * 60 + m1)
        if (diff > 0 && diff < 300) tempos.push(diff)
      } else if (temposEntregaRef.current[p.id] !== undefined) {
        const t = temposEntregaRef.current[p.id]
        if (t > 0 && t < 300) tempos.push(t)
      }
    }
    return tempos.length > 0 ? Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length) : null
  })()
`,
  '  const tempoMedioPreparo = calcularMediaPreparoMinutos(pedidos)\n',
  "média real de preparo"
)

replaceOnce(
  '        .cb-header { background:var(--background); border-bottom:1px solid var(--surface); padding:calc(env(safe-area-inset-top) + 12px) 16px 12px; position:sticky; top:0; z-index:10; }\n',
  '        .cb-header { background:var(--background); border-bottom:1px solid var(--surface); padding:calc(env(safe-area-inset-top) + 12px) 16px 12px; position:sticky; top:0; z-index:10; }\n        .cb-metrics { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; margin-bottom:10px; }\n',
  "grid responsivo de métricas"
)

replaceOnce(
  '        @media (min-width: 768px) {\n          .cb-header { border-bottom:1px solid var(--surface); padding:24px 28px 20px; position:static; }\n',
  '        @media (min-width: 768px) {\n          .cb-header { border-bottom:1px solid var(--surface); padding:24px 28px 20px; position:static; }\n          .cb-metrics { grid-template-columns:repeat(5,minmax(0,1fr)); }\n',
  "grid desktop de métricas"
)

replaceOnce(
`          {/* Métricas */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <div style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 10px" }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, color: "var(--foreground)" }}>{totalHoje}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--foreground-muted)", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 2 }}>Hoje</div>
            </div>
            <div style={{ flex: 1, background: emAberto > 0 ? "var(--background)" : "var(--surface)", border: \`1px solid \${emAberto > 0 ? "color-mix(in srgb, var(--primary) 50%, transparent)" : "var(--border)"}\`, borderRadius: 12, padding: "10px 10px" }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, color: emAberto > 0 ? "var(--brand-text)" : "var(--border-strong)" }}>{emAberto}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: emAberto > 0 ? "var(--brand-text)" : "var(--border-strong)", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 2 }}>Em aberto</div>
            </div>
            <div style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 10px" }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, color: "var(--success)" }}>{contagemPorStatus("entregue")}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--foreground-muted)", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 2 }}>Prontos</div>
            </div>
            <div style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 10px" }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, color: "var(--info)" }}>{tempoMedioPreparo !== null ? \`\${tempoMedioPreparo}\` : "—"}<span style={{ fontSize: 10, fontWeight: 700, marginLeft: 2 }}>{tempoMedioPreparo !== null ? "m" : ""}</span></div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--foreground-muted)", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 2 }}>⏱ Média</div>
            </div>
          </div>
`,
`          {/* Métricas operacionais: pedidos e pizzas são grandezas separadas. */}
          <div className="cb-metrics">
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 10px" }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, color: "var(--foreground)" }}>{totalPedidos}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--foreground-muted)", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 2 }}>Pedidos</div>
            </div>
            <div style={{ background: "color-mix(in srgb, var(--primary) 6%, var(--surface))", border: "1px solid color-mix(in srgb, var(--primary) 28%, transparent)", borderRadius: 12, padding: "10px 10px" }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, color: "var(--brand-text)" }}>{pizzasVendidas}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--brand-text)", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 2 }}>Pizzas</div>
            </div>
            <div style={{ background: emAberto > 0 ? "var(--background)" : "var(--surface)", border: \`1px solid \${emAberto > 0 ? "color-mix(in srgb, var(--primary) 50%, transparent)" : "var(--border)"}\`, borderRadius: 12, padding: "10px 10px" }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, color: emAberto > 0 ? "var(--brand-text)" : "var(--border-strong)" }}>{emAberto}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: emAberto > 0 ? "var(--brand-text)" : "var(--border-strong)", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 2 }}>Em aberto</div>
            </div>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 10px" }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, color: "var(--success)" }}>{contagemPorStatus("entregue")}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--foreground-muted)", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 2 }}>Entregues</div>
            </div>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 10px" }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, color: "var(--info)" }}>{tempoMedioPreparo !== null ? \`\${tempoMedioPreparo}\` : "—"}<span style={{ fontSize: 10, fontWeight: 700, marginLeft: 2 }}>{tempoMedioPreparo !== null ? "m" : ""}</span></div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--foreground-muted)", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 2 }}>⏱ Média preparo</div>
            </div>
          </div>
`,
  "cards de métricas"
)

source = source.replaceAll("{totalHoje}", "{totalPedidos}")
source = source.replaceAll(">Hoje</div>", ">Pedidos</div>")

if (source.includes("temposEntregaRef")) throw new Error("Referência legada de entrega ainda presente")
if (source.includes("const totalHoje")) throw new Error("Métrica ambígua totalHoje ainda presente")
if (!source.includes("const pizzasVendidas = contarPizzasVendidas(pedidos)")) throw new Error("Métrica de pizzas não aplicada")
if (!source.includes("const tempoMedioPreparo = calcularMediaPreparoMinutos(pedidos)")) throw new Error("Média real de preparo não aplicada")

writeFileSync(path, source)
