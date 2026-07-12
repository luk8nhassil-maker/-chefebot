#!/bin/sh
# Primeiro provisionamento (ou redeploy completo) da infraestrutura da
# Evolution API do ChefeBot num VPS novo ou existente.
#
# Pré-requisitos no host: Docker + Docker Compose plugin instalados, DNS do
# EVOLUTION_DOMAIN já apontando pro IP deste servidor (ver
# docs/WHATSAPP_INFRASTRUCTURE.md), .env preenchido (copiado de .env.example).

set -eu
cd "$(dirname "$0")/.."

[ -f ".env" ] || { echo "ERRO: .env não encontrado. Copie .env.example para .env e preencha antes de continuar."; exit 1; }
# shellcheck disable=SC1091
. ./.env

for var in EVOLUTION_IMAGE_TAG EVOLUTION_DOMAIN EVOLUTION_API_KEY POSTGRES_PASSWORD REDIS_PASSWORD; do
  eval "valor=\${$var:-}"
  [ -n "$valor" ] || { echo "ERRO: variável $var não definida no .env"; exit 1; }
done
[ "$EVOLUTION_IMAGE_TAG" != "latest" ] || { echo "ERRO: EVOLUTION_IMAGE_TAG não pode ser 'latest' — fixe uma versão exata."; exit 1; }

echo "[deploy] validando sintaxe do compose"
docker compose config >/dev/null

echo "[deploy] subindo os serviços (postgres, redis, evolution-api, proxy, uptime-kuma)"
docker compose up -d postgres redis
echo "[deploy] aguardando banco/cache ficarem saudáveis antes de subir a Evolution API"
timeout=60
until docker compose ps --format '{{.Name}} {{.Health}}' | grep -q "postgres.*healthy"; do
  timeout=$((timeout - 2))
  [ "$timeout" -gt 0 ] || { echo "ERRO: postgres não ficou saudável a tempo"; exit 1; }
  sleep 2
done

docker compose up -d evolution-api proxy uptime-kuma

echo "[deploy] aguardando healthcheck geral"
sleep 10
sh ./scripts/healthcheck.sh || {
  echo "[deploy] AVISO: healthcheck falhou logo após subir — confira 'docker compose logs' antes de prosseguir"
  exit 1
}

echo "==================================================================="
echo " Deploy concluído."
echo " Confirme:"
echo "  - DNS de ${EVOLUTION_DOMAIN} propagado (scripts/healthcheck.sh cobre isso)"
echo "  - certificado HTTPS emitido (docker compose logs proxy | grep -i cert)"
echo "  - EVOLUTION_API_URL=https://${EVOLUTION_DOMAIN} configurado no Vercel (chefebot-pjif)"
echo "  - EVOLUTION_API_KEY configurada no Vercel com o mesmo valor deste .env"
echo "==================================================================="
