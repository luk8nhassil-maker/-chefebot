$content = (Get-Content src/app/api/whatsapp/route.ts -Raw -Encoding UTF8)

$old = @'
    if (!estaAberto(config)) {
      const jaAvisado = await redis.get<boolean>(`fechado:${phone}`);
      if (!jaAvisado) {
        await enviarMensagem(phone, mensagemFechado(config));
        await redis.set(`fechado:${phone}`, true, { ex: 3600 });
      }
      return NextResponse.json({ ok: true });
    }

    await redis.del(`fechado:${phone}`);
'@

$new = @'
    if (!estaAberto(config)) {
      await enviarMensagem(phone, mensagemFechado(config));
      return NextResponse.json({ ok: true });
    }
'@

$content = $content.Replace($old, $new)
Set-Content -Path "src/app/api/whatsapp/route.ts" -Value $content -Encoding UTF8
Write-Host "Flag de fechado removido com sucesso!"
