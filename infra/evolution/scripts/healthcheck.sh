#!/bin/sh
# Healthcheck externo/manual da infraestrutura da Evolution API.
# Chamado por: monitoramento externo (a cada minuto), scripts/deploy.sh,
# scripts/update.sh e scripts/restore.sh (depois de subir os serviços).
#
# Saída: 0 se tudo saudável, != 0 caso contrário (para uso em cron/CI).
# Nunca imprime segredos.

set -eu
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
[ -f ".env" ] && . ./.env

FALHAS=0

checar_container() {
  nome="$1"
  status=$(docker compose ps --format '{{.Name}} {{.Health}}' 2>/dev/null | grep "^${nome} " || true)
  if [ -z "$status" ]; then
    echo "[healthcheck] FALHA: container ${nome} não encontrado/não está rodando"
    FALHAS=$((FALHAS + 1))
    return
  fi
  case "$status" in
    *healthy*) echo "[healthcheck] OK: ${nome}" ;;
    *) echo "[healthcheck] FALHA: ${nome} -> ${status}"; FALHAS=$((FALHAS + 1)) ;;
  esac
}

checar_container postgres
checar_container redis
checar_container evolution-api
checar_container proxy

if [ -n "${EVOLUTION_DOMAIN:-}" ]; then
  if curl -fsS -o /dev/null -m 5 "https://${EVOLUTION_DOMAIN}/"; then
    echo "[healthcheck] OK: https://${EVOLUTION_DOMAIN}/ responde"
  else
    echo "[healthcheck] FALHA: https://${EVOLUTION_DOMAIN}/ não respondeu"
    FALHAS=$((FALHAS + 1))
  fi
fi

if [ "$FALHAS" -gt 0 ]; then
  echo "[healthcheck] ${FALHAS} verificação(ões) falharam"
  exit 1
fi
echo "[healthcheck] tudo saudável"
