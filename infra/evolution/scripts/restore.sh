#!/bin/sh
# Restauração da infraestrutura da Evolution API do ChefeBot a partir de um
# backup gerado por backup.sh. Roda no HOST (não dentro de um container do
# compose), para poder parar/subir os serviços.
#
# Uso:
#   ./scripts/restore.sh <arquivo-local.tar.gz.enc>
#   ./scripts/restore.sh s3://bucket/diarios/chefebot-evolution-....tar.gz.enc
#
# Exige confirmação explícita. Nunca apaga o backup anterior (baixa uma cópia
# à parte antes de tocar em qualquer coisa).

set -eu

cd "$(dirname "$0")/.."

if [ -z "${1:-}" ]; then
  echo "Uso: $0 <arquivo.tar.gz.enc | s3://bucket/caminho/arquivo.tar.gz.enc>" >&2
  exit 1
fi
ORIGEM="$1"

if [ ! -f ".env" ]; then
  echo "ERRO: infra/evolution/.env não encontrado — copie de .env.example e preencha antes de restaurar." >&2
  exit 1
fi
# shellcheck disable=SC1091
. ./.env

[ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ] || { echo "ERRO: BACKUP_ENCRYPTION_PASSPHRASE ausente no .env"; exit 1; }

echo "==================================================================="
echo " RESTAURAÇÃO DA EVOLUTION API DO CHEFEBOT"
echo " Origem: ${ORIGEM}"
echo " Isso vai PARAR a Evolution API e SUBSTITUIR o banco de dados atual."
echo " O volume de instâncias atual (sessão do WhatsApp) também será"
echo " sobrescrito pelo conteúdo do backup."
echo "==================================================================="
printf "Digite exatamente RESTAURAR CHEFEBOT para confirmar: "
read -r CONFIRMACAO
if [ "$CONFIRMACAO" != "RESTAURAR CHEFEBOT" ]; then
  echo "Confirmação não corresponde — abortando sem alterar nada."
  exit 1
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "[restore] 1/8 baixando/copiando arquivo de origem"
case "$ORIGEM" in
  s3://*)
    aws s3 cp "$ORIGEM" "${WORKDIR}/backup.tar.gz.enc" --endpoint-url "${BACKUP_S3_ENDPOINT}" --only-show-errors
    ;;
  *)
    [ -f "$ORIGEM" ] || { echo "ERRO: arquivo local não encontrado: $ORIGEM"; exit 1; }
    cp "$ORIGEM" "${WORKDIR}/backup.tar.gz.enc"
    ;;
esac

echo "[restore] 2/8 validando arquivo (tamanho e magia do formato)"
TAMANHO=$(wc -c < "${WORKDIR}/backup.tar.gz.enc")
[ "$TAMANHO" -gt 100 ] || { echo "ERRO: arquivo de backup suspeito (muito pequeno: ${TAMANHO} bytes) — abortando"; exit 1; }

echo "[restore] 3/8 descriptografando"
openssl enc -d -aes-256-cbc -pbkdf2 \
  -in "${WORKDIR}/backup.tar.gz.enc" -out "${WORKDIR}/backup.tar.gz" \
  -pass env:BACKUP_ENCRYPTION_PASSPHRASE \
  || { echo "ERRO: falha ao descriptografar — senha errada ou arquivo corrompido. Nada foi alterado."; exit 1; }

echo "[restore] 4/8 extraindo bundle"
mkdir -p "${WORKDIR}/extraido"
tar -xzf "${WORKDIR}/backup.tar.gz" -C "${WORKDIR}/extraido"
DUMP_FILE=$(find "${WORKDIR}/extraido" -maxdepth 1 -name "*.sql" | head -n1)
INSTANCES_TAR=$(find "${WORKDIR}/extraido" -maxdepth 1 -name "*-instances.tar.gz" | head -n1)
[ -n "$DUMP_FILE" ] || { echo "ERRO: bundle não contém dump .sql — abortando, nada alterado."; exit 1; }

echo "[restore] 5/8 fazendo cópia de segurança do estado atual antes de sobrescrever"
SAFETY_DIR="./backups-pre-restore/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$SAFETY_DIR"
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB:-evolution}" > "${SAFETY_DIR}/pre-restore.sql" 2>/dev/null || echo "[restore] aviso: não foi possível gerar dump de segurança (banco pode já estar fora do ar) — seguindo mesmo assim"

echo "[restore] 6/8 parando a Evolution API (mantém Postgres/Redis de pé para restaurar)"
docker compose stop evolution-api

echo "[restore] 7/8 restaurando banco de dados"
docker compose exec -T postgres psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB:-evolution}" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker compose exec -T postgres psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB:-evolution}" < "$DUMP_FILE"

if [ -n "$INSTANCES_TAR" ]; then
  echo "[restore] 7b/8 restaurando volume de instâncias (sessão do WhatsApp)"
  VOLUME_NAME="$(basename "$(pwd)")_evolution_instances"
  docker run --rm \
    -v "${VOLUME_NAME}:/target" \
    -v "$(dirname "$INSTANCES_TAR")":/source:ro \
    alpine sh -c "rm -rf /target/* && tar -xzf /source/$(basename "$INSTANCES_TAR") -C /target"
else
  echo "[restore] aviso: backup não continha volume de instâncias — sessão do WhatsApp precisará de novo QR"
fi

echo "[restore] 8/8 subindo os serviços e checando saúde"
docker compose up -d
sh ./scripts/healthcheck.sh

echo "==================================================================="
echo " Restauração concluída. Backup de segurança pré-restore em: ${SAFETY_DIR}"
echo " Confira docs/WHATSAPP_DISASTER_RECOVERY.md para os próximos passos"
echo " (provavelmente será preciso um novo QR na área do admin do ChefeBot)."
echo "==================================================================="
