from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 anchor, got {count}")
    return text.replace(old, new)

# This script runs after the main temporary patch has generated/updated tests.
p = Path("src/lib/limpezaOperacionalPedidos.paridadeSf.test.ts")
s = p.read_text()
s = replace_once(
    s,
    'expect(pendencia).toMatchObject({ motivo: "novo_sem_aceite", expedienteAnterior: true });',
    'expect(pendencia).toMatchObject({ motivo: "novo_sem_aceite", titulo: "Esse pedido ficou do expediente anterior" });',
    "old-shift expectation",
)
s = replace_once(
    s,
    '    expect(pronto.podeRelatarProblema).toBe(true);\n    expect(acaoSecundaria(pronto)).toBeNull();',
    '    expect(pronto.modalidade).toBe("retirada");\n    expect(pronto.podeRelatarProblema).toBe(false);\n    expect(acaoSecundaria(pronto)).toBeNull();',
    "pickup contact expectation",
)
p.write_text(s)

p = Path("src/lib/limpezaOperacionalPedidos.test.ts")
s = p.read_text()
s = replace_once(
    s,
    '      status: "saiu_entrega",\n      statusAtualizadoEm: new Date(AGORA - 19 * MIN).toISOString(),',
    '      status: "saiu_entrega",\n      tipoEntrega: "delivery",\n      statusAtualizadoEm: new Date(AGORA - 19 * MIN).toISOString(),',
    "explicit delivery in initial route test",
)
p.write_text(s)
