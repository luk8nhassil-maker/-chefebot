// Durante a apuração, tráfego do NOVO ciclo não invalida a leitura do ciclo
// encerrado. Eventos anteriores ao corte continuam invalidando o CAS.
export const FONTE_DEVE_MUDAR_LUA = `
local function fonteDeveMudar(chave, instante)
  local barreira = redis.call('GET', chave)
  if not barreira then return true end
  return tonumber(instante) < cjson.decode(barreira).corte
end
`;
export const INVALIDAR_FONTE_LUA = `${FONTE_DEVE_MUDAR_LUA}
if fonteDeveMudar(KEYS[2], ARGV[1]) then return redis.call('INCR', KEYS[1]) end
return 0
`;
export function ultimaDataDaFonte(movimentos: readonly { createdAt: string }[]): number {
  return movimentos.reduce((maior, m) => Math.max(maior, Date.parse(m.createdAt) || 0), 0) || Date.now();
}
