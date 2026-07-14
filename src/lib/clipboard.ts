// Extraído de src/app/cardapio/page.tsx (Pix copia e cola) para ser
// reaproveitado pelo card premium de pagamento Pix sem duplicar a lógica.
export async function copiarTexto(texto: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(texto); return true } catch {}
  try {
    const ta = document.createElement("textarea")
    ta.value = texto
    ta.style.position = "fixed"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
