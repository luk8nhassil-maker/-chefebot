#!/bin/sh
# Volta a Evolution API para a versão anterior à última execução de
# update.sh, usando a tag salva em .env.tag-anterior.

set -eu
cd "$(dirname "$0")/.."

[ -f ".env.tag-anterior" ] || { echo "ERRO: .env.tag-anterior não existe — nenhuma atualização recente registrada para reverter."; exit 1; }
[ -f ".env" ] || { echo "ERRO: .env não encontrado"; exit 1; }

TAG_ANTERIOR=$(grep -E '^EVOLUTION_IMAGE_TAG=' .env.tag-anterior | cut -d= -f2)
[ -n "$TAG_ANTERIOR" ] || { echo "ERRO: .env.tag-anterior está sem EVOLUTION_IMAGE_TAG válido"; exit 1; }

echo "[rollback] revertendo EVOLUTION_IMAGE_TAG para ${TAG_ANTERIOR}"
sed -i.bak "s/^EVOLUTION_IMAGE_TAG=.*/EVOLUTION_IMAGE_TAG=${TAG_ANTERIOR}/" .env
rm -f .env.bak

docker compose pull evolution-api
docker compose up -d --no-deps evolution-api

sleep 10
if sh ./scripts/healthcheck.sh; then
  echo "[rollback] revertido para ${TAG_ANTERIOR} com sucesso, healthcheck OK."
  mv .env.tag-anterior ".env.tag-anterior.usado-$(date -u +%Y%m%dT%H%M%SZ)"
else
  echo "[rollback] AVISO: healthcheck ainda falhando após reverter — verifique 'docker compose logs evolution-api' manualmente."
  exit 1
fi
