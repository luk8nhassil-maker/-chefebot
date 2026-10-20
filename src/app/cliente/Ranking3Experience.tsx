'use client'
import type { painelRanking3 } from '@/lib/ranking3/server'
export type PainelRanking3 = NonNullable<Awaited<ReturnType<typeof painelRanking3>>>

export function Ranking3Experience({ painel, onClose, previewSeguro = false }: { painel: PainelRanking3; onClose: () => void; previewSeguro?: boolean }) {
  const disponiveis = painel.premios.filter((p) => p.estado === 'disponivel')
  return <section className="ranking3-card" aria-label="Ranking do Chefe — ligas">
    <style>{`.ranking3-card{width:100%;max-width:540px;margin:0 auto;padding:20px;background:var(--surface,#fff);border:1px solid var(--line,#ddd);border-radius:20px;color:var(--text,#1f2937)}.ranking3-card h1{font-size:24px;font-weight:800;margin:16px 0}.ranking3-card h2{font-size:20px;font-weight:750;margin:18px 0 10px}.ranking3-card p{line-height:1.5;margin:12px 0}.ranking3-card button,.ranking3-card a{display:inline-block;min-height:44px;padding:12px 16px;border-radius:12px;border:1px solid var(--line,#ddd);font-weight:700}.ranking3-card a{display:block;background:var(--brand,#ffcd00);color:#1f2937;text-align:center;text-decoration:none}.ranking3-card progress{width:100%;height:12px;accent-color:#8453c6;margin:12px 0 0}.ranking3-card details{margin-top:16px}.ranking3-card summary{min-height:44px;padding:10px 0;cursor:pointer}.ranking3-card button:disabled{opacity:.6}`}</style>
    <button type="button" onClick={onClose}>← Voltar</button>
    <h1>Ranking do Chefe</h1>
    {painel.atualizando ? <p role="status">Atualizando o resultado da temporada. Suas Estrelas e seus prêmios estão preservados.</p> : <>
      <p aria-label="Sua liga">{painel.liga === 1 ? '⭐ Nível 1 · Ranking Normal' : painel.liga === 2 ? '🏅 Nível 2 · Liga Top 10' : '✦ Nível 3 · Conquista desbloqueada'}</p>
      <h2>{painel.liga === 3 ? 'Seu avanço está registrado' : painel.posicao ? `Você está em ${painel.posicao}º lugar` : 'Sua próxima conquista começa aqui'}</h2>
      <p>{painel.score} Estrelas nesta temporada</p>
      {painel.liga === 2 && painel.meta !== null && <><label htmlFor="progresso-liga">Meta para o Nível 3: {painel.meta} Estrelas</label><progress id="progresso-liga" max={Math.max(1, painel.meta)} value={Math.min(painel.score, Math.max(1, painel.meta))} /><p>{Math.max(0, painel.meta - painel.score)} Estrelas para atingir a meta.</p></>}
      {painel.liga === 1 && <p>Os 10 melhores elegíveis avançam na próxima temporada. O campeão ganha uma pizza Família.</p>}
      {painel.liga === 3 && <p>Você chegou ao Nível 3. As próximas regras serão anunciadas depois da aprovação — nenhum benefício extra está prometido.</p>}
      <p>Virada em {new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(painel.janela.fim))} · Brasília</p>
      {painel.liga !== 3 && <p>Classificação em andamento. O resultado oficial é confirmado no fechamento.</p>}
      {painel.decisaoPendente && <p>A política para campanhas com menos participantes está em análise. Seu mérito permanece registrado.</p>}
      {painel.conquistaAnterior && <p>🥇 {painel.conquistaAnterior}</p>}
      {!disponiveis.length && painel.liga !== 3 && <details><summary>Classificação da sua liga</summary><ol>{painel.lista.map((e) => <li key={e.posicao}>{e.eVoce ? 'Você' : `Participante ${e.posicao}`} · {e.score} Estrelas</li>)}</ol></details>}
    </>}
    {disponiveis.length > 0 && <><h2>🎁 Sua pizza Família está disponível</h2><p>Seu prêmio não vence. Retirada grátis ou entrega com a taxa normal. Extras são opcionais e pagos.</p>{previewSeguro ? <button disabled>Prévia — sem pedido real</button> : <a className="cf-mobile-button" href="/cliente/premios">Escolher sabores e resgatar</a>}</>}
  </section>
}
