$content = (Get-Content src/app/pedidos/page.tsx -Raw -Encoding UTF8)

$old = @'
  const assumirConversa = async (phone: string) => {
    try {
      await fetch('/api/bot-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, ativo: false }),
      })
      setManuais(prev => ({ ...prev, [phone]: true }))
      setNotificacao('👤 Conversa assumida — responda no celular')
      setTimeout(() => setNotificacao(''), 3000)
    } catch {}
  }
'@

$new = @'
  const assumirConversa = async (phone: string) => {
    try {
      await fetch('/api/bot-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, ativo: false }),
      })
      setManuais(prev => ({ ...prev, [phone]: true }))
      setNotificacao('👤 Conversa assumida — abrindo WhatsApp...')
      setTimeout(() => setNotificacao(''), 3000)
      window.open('https://wa.me/' + phone, '_blank')
    } catch {}
  }
'@

$content = $content.Replace($old, $new)
Set-Content -Path "src/app/pedidos/page.tsx" -Value $content -Encoding UTF8
Write-Host "Assumir com WhatsApp aplicado com sucesso!"
