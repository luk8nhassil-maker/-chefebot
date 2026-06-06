$content = (Get-Content "src/app/api/whatsapp/route.ts" -Raw -Encoding UTF8)

$old = @'
    const config = await getConfig();

    if (!estaAberto(config)) {
      await enviarMensagem(phone, mensagemFechado(config));
      return NextResponse.json({ ok: true });
    }
'@

$new = @'
    const config = await getConfig();
'@

$content = $content.Replace($old, $new)
Set-Content -Path "src/app/api/whatsapp/route.ts" -Value $content -Encoding UTF8
Write-Host "Restricao de horario removida com sucesso!"
