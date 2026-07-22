// janelaPico.ts — horário de Brasília (America/Sao_Paulo, UTC-3, sem
// horário de verão desde 2019) usado tanto pelo cron (marcar fim de semana
// movimentado) quanto pelo painel /dev/mcp (alerta de ausência de execução
// durante o período operacional). Mesma janela documentada no workflow
// .github/workflows/mcp-observer-cron.yml: sex/sáb/dom, 18:00–02:59.

const TZ_OPERACIONAL = 'America/Sao_Paulo';
const DIAS_PICO = new Set(['Fri', 'Sat', 'Sun']);

function partesDataLocal(data: Date): { ano: string; mes: string; dia: string; diaSemana: string; hora: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ_OPERACIONAL,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  const partes = fmt.formatToParts(data);
  const obter = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  return {
    ano: obter('year'),
    mes: obter('month'),
    dia: obter('day'),
    diaSemana: obter('weekday'),
    hora: Number(obter('hour')),
  };
}

// true se "agora" (horário de Brasília) cai em sex/sáb/dom 18:00–02:59 —
// a janela de pico coberta pelo cron a cada 10min do GitHub Actions.
export function estaNoPeriodoDePico(data: Date = new Date()): boolean {
  const { diaSemana, hora } = partesDataLocal(data);
  if (!DIAS_PICO.has(diaSemana)) return false;
  return hora >= 18 || hora < 3;
}

// Identifica o fim de semana (sex/sáb/dom) pela data do sábado
// correspondente — sexta e domingo do mesmo fim de semana caem no mesmo id.
// Fora de sex/sáb/dom retorna null.
export function idFimDeSemana(data: Date): string | null {
  const { ano, mes, dia, diaSemana } = partesDataLocal(data);
  if (!DIAS_PICO.has(diaSemana)) return null;
  const meioDiaUtc = Date.UTC(Number(ano), Number(mes) - 1, Number(dia), 12, 0, 0);
  const deslocamentoDias = diaSemana === 'Fri' ? 1 : diaSemana === 'Sun' ? -1 : 0;
  const sabadoUtc = new Date(meioDiaUtc + deslocamentoDias * 86_400_000);
  return sabadoUtc.toISOString().slice(0, 10);
}
