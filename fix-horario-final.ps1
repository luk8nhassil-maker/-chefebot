$content = (Get-Content "src/app/api/whatsapp/route.ts" -Raw -Encoding UTF8)

$old = '    const config = await getConfig();

    const sessionKey = `session:${phone}`;'

$new = '    const config = await getConfig();

    if (!estaAberto(config)) {
      await redis.del(`session:${phone}`);
      await enviarMensagem(phone, mensagemFechado(config));
      return NextResponse.json({ ok: true });
    }

    const sessionKey = `session:${phone}`;'

$content = $content.Replace($old, $new)
Set-Content -Path "src/app/api/whatsapp/route.ts" -Value $content -Encoding UTF8
Write-Host "Verificacao de horario recolocada com sucesso!"
