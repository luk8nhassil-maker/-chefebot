#!/usr/bin/env bash
# ============================================================================
# Orquestra o E2E HTTP real do Ranking/Gamificação (item 13 da correção)
# localmente: sobe um redis-server descartável + o shim REST local
# (scripts/local-redis-http-shim.mjs — só usado quando não há Docker
# disponível; em CI o mesmo scripts/e2e-ranking-gamificacao-http.mjs roda
# contra SRH real via Docker, igual a .github/workflows/entregador-auth-
# e2e.yml), builda e sobe o Next.js real, roda o E2E, e derruba tudo no final
# (inclusive em caso de falha).
#
# Uso: bash scripts/run-e2e-ranking-http.sh
# ============================================================================
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

WORKDIR="$(mktemp -d)"
REDIS_PORT=6499
SHIM_PORT=8199
NEXT_PORT=3100

PIDS=()
cleanup() {
  # next dev gera um processo filho (next-server) separado do PID do `npx`
  # capturado em $!; -"$pid" mata o GRUPO inteiro (setsid abaixo garante que
  # cada processo iniciado tem seu próprio grupo), não só o processo pai.
  for pid in "${PIDS[@]:-}"; do
    kill -- "-$pid" >/dev/null 2>&1 || kill "$pid" >/dev/null 2>&1 || true
  done
  sleep 0.3
  for pid in "${PIDS[@]:-}"; do
    kill -9 -- "-$pid" >/dev/null 2>&1 || kill -9 "$pid" >/dev/null 2>&1 || true
  done
  wait >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

iniciar_em_grupo() {
  setsid "$@" &
  PIDS+=("$!")
}

echo "[run-e2e-ranking-http] subindo redis-server local descartável (porta $REDIS_PORT)..."
iniciar_em_grupo bash -c "exec redis-server --port '$REDIS_PORT' --daemonize no --save '' --appendonly no > '$WORKDIR/redis.log' 2>&1"
sleep 0.5

echo "[run-e2e-ranking-http] subindo shim REST local (porta $SHIM_PORT)..."
iniciar_em_grupo bash -c "exec node scripts/local-redis-http-shim.mjs --redis-port '$REDIS_PORT' --http-port '$SHIM_PORT' --token e2e-ranking-http-local > '$WORKDIR/shim.log' 2>&1"
sleep 0.5

export KV_REST_API_URL="http://127.0.0.1:$SHIM_PORT"
export KV_REST_API_TOKEN="e2e-ranking-http-local"
export E2E_BASE_URL="http://127.0.0.1:$NEXT_PORT"
export CHEFEBOT_E2E=1

echo "[run-e2e-ranking-http] subindo Next.js real (next dev, porta $NEXT_PORT)..."
iniciar_em_grupo bash -c "exec npx next dev --hostname 127.0.0.1 --port '$NEXT_PORT' > '$WORKDIR/next.log' 2>&1"

echo "[run-e2e-ranking-http] aguardando Next.js ficar pronto..."
for i in $(seq 1 60); do
  if curl -s -o /dev/null "http://127.0.0.1:$NEXT_PORT"; then
    echo "[run-e2e-ranking-http] Next.js pronto após ${i}s"
    break
  fi
  sleep 1
  if [ "$i" -eq 60 ]; then
    echo "[run-e2e-ranking-http] Next.js não respondeu a tempo. Log:"
    tail -n 60 "$WORKDIR/next.log"
    exit 1
  fi
done

echo "[run-e2e-ranking-http] rodando o E2E HTTP real..."
node scripts/e2e-ranking-gamificacao-http.mjs
STATUS=$?

if [ "$STATUS" -ne 0 ]; then
  echo "[run-e2e-ranking-http] FALHOU — logs do Next.js:"
  tail -n 100 "$WORKDIR/next.log"
fi

exit "$STATUS"
