$content = (Get-Content "src/app/api/whatsapp/route.ts" -Raw -Encoding UTF8)

$old = @'
async function salvarEscalonamento(phone: string, session: BotSession) {
  const pedidos = (await redis.get<Pedido[]>("pedidos")) || [];
  const jaExiste = pedidos.some((p) => p.telefone === phone && p.escalonado === true);
  if (jaExiste) return;
  const novoPedido: Pedido = {
    id: Date.now().toString(),
    cliente: session.customerName || phone,
    telefone: phone,
    itens: ["Cliente solicitou atendimento humano"],
    total: 0,
    status: "novo",
    horario: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    endereco: "-",
    escalonado: true,
  };
  await redis.set("pedidos", [...pedidos, novoPedido]);
}
'@

$new = @'
async function salvarEscalonamento(phone: string, session: BotSession) {
  const pedidos = (await redis.get<Pedido[]>("pedidos")) || [];
  const jaExisteAberto = pedidos.some((p) => p.telefone === phone && p.escalonado === true && p.status === "novo");
  if (jaExisteAberto) return;
  const novoPedido: Pedido = {
    id: Date.now().toString(),
    cliente: session.customerName || phone,
    telefone: phone,
    itens: ["Cliente precisa de atendimento humano"],
    total: 0,
    status: "novo",
    horario: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    endereco: "-",
    escalonado: true,
  };
  await redis.set("pedidos", [...pedidos, novoPedido]);
}
'@

$content = $content.Replace($old, $new)
Set-Content -Path "src/app/api/whatsapp/route.ts" -Value $content -Encoding UTF8
Write-Host "salvarEscalonamento corrigido com sucesso!"
