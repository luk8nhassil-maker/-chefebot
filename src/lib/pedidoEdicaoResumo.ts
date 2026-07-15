// Resumo humano das alterações feitas pelo cliente ao editar um pedido —
// exibido no painel da Kellyne (ver AGENTS.md, seção 11). Comparação simples
// por design: não precisa ser um diff perfeito, só deixar claro o que mudou.

export type PedidoResumoDiff = {
  itens: string[];
  total: number;
  pagamento?: string;
  tipoEntrega?: string;
  endereco?: string;
  troco?: string;
  observacao?: string;
};

function money(v: number): string {
  return `R$ ${v.toFixed(2).replace(".", ",")}`;
}

const TIPO_ENTREGA_LABEL: Record<string, string> = {
  delivery: "Entrega",
  retirada: "Retirada",
  pickup: "Retirada",
  dine_in: "Consumo no local",
};

export function montarResumoAlteracoes(anterior: PedidoResumoDiff, novo: PedidoResumoDiff): string[] {
  const linhas: string[] = [];

  if ((anterior.pagamento || "") !== (novo.pagamento || "")) {
    linhas.push(`Pagamento: ${anterior.pagamento || "—"} → ${novo.pagamento || "—"}`);
  }
  if (Math.round(anterior.total * 100) !== Math.round(novo.total * 100)) {
    linhas.push(`Total: ${money(anterior.total)} → ${money(novo.total)}`);
  }
  if ((anterior.tipoEntrega || "") !== (novo.tipoEntrega || "")) {
    const de = TIPO_ENTREGA_LABEL[anterior.tipoEntrega || ""] || anterior.tipoEntrega || "—";
    const para = TIPO_ENTREGA_LABEL[novo.tipoEntrega || ""] || novo.tipoEntrega || "—";
    linhas.push(`Entrega: ${de} → ${para}`);
  } else if ((anterior.endereco || "") !== (novo.endereco || "")) {
    linhas.push(`Endereço atualizado`);
  }
  if ((anterior.troco || "") !== (novo.troco || "")) {
    linhas.push(`Troco atualizado`);
  }
  if ((anterior.observacao || "") !== (novo.observacao || "")) {
    linhas.push(`Observação atualizada`);
  }

  const itensAnteriores = [...anterior.itens];
  const itensNovos = [...novo.itens];
  const removidos: string[] = [];
  for (const item of itensAnteriores) {
    const idx = itensNovos.indexOf(item);
    if (idx >= 0) itensNovos.splice(idx, 1);
    else removidos.push(item);
  }
  // itensNovos agora contém só o que sobrou (adicionados de fato)
  for (const item of itensNovos) linhas.push(`Adicionado: ${item}`);
  for (const item of removidos) linhas.push(`Removido: ${item}`);

  return linhas;
}
