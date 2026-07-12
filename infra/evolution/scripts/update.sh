#!/bin/sh
# Sobe a Evolution API para uma nova versão, de forma consciente e reversível.
#
# Uso: ./scripts/update.sh v2.3.0
#
# Nunca atualiza sozinho para "latest". Faz backup antes, troca a tag,
# recria só o container da Evolution API, confere healthcheck; se falhar,
# orienta a rodar rollback.sh.

set -eu
cd "$(dirname "$0")/.."

NOVA_TAG="${1:-}"
[ -n "$NOVA_TAG" ] || { echo "Uso: $0 <nova-tag, ex. v2.3.0>"; exit 1; }
[ "$NOVA_TAG" != "latest" ] || { echo "ERRO: não use 'latest' — informe uma tag exata."; exit 1; }

[ -f ".env" ] || { echo "ERRO: .env não encontrado"; exit 1; }
TAG_ATUAL=$(grep -E '^EVOLUTION_IMAGE_TAG=' .env | cut -d= -f2)
echo "[update] versão atual: ${TAG_ATUAL:-desconhecida} -> nova: ${NOVA_TAG}"

echo "[update] 1/4 backup de segurança antes de atualizar"
docker compose --profile backup run --rm backup

echo "[update] 2/4 guardando a tag atual para rollback (.env.tag-anterior)"
echo "EVOLUTION_IMAGE_TAG=${TAG_ATUAL}" > .env.tag-anterior

echo "[update] 3/4 atualizando EVOLUTION_IMAGE_TAG no .env"
sed -i.bak "s/^EVOLUTION_IMAGE_TAG=.*/EVOLUTION_IMAGE_TAG=${NOVA_TAG}/" .env
rm -f .env.bak

echo "[update] 4/4 recriando só o container da Evolution API"
docker compose pull evolution-api
docker compose up -d --no-deps evolution-api

sleep 10
if sh ./scripts/healthcheck.sh; then
  echo "==================================================================="
  echo " Atualizado para ${NOVA_TAG} com sucesso. Healthcheck OK."
  echo " Tag anterior salva em .env.tag-anterior — use rollback.sh se precisar voltar."
  echo "==================================================================="
else
  echo "==================================================================="
  echo " FALHA no healthcheck após atualizar para ${NOVA_TAG}."
  echo " Rode: ./scripts/rollback.sh"
  echo "==================================================================="
  exit 1
fi
