#!/bin/sh
# Backup idempotente da infraestrutura da Evolution API do ChefeBot.
# Roda dentro do serviço "backup" do docker-compose (profile "backup"),
# chamado pelo cron do host (ver README.md — sugestão: diário às 3h).
#
# Faz: pg_dump do Postgres + tar do volume de instâncias + config essencial,
# compacta, criptografa (openssl) e envia pra um storage S3-compatível.
# Mantém local: 7 diários, 4 semanais (domingo), 6 mensais (dia 1).
# NUNCA imprime credenciais (nem em erro — usa `set +x` e evita `echo "$VAR"`
# de segredo).

set -eu

# Imagem base é postgres:16-alpine (já tem pg_dump) — instala só o que falta
# (aws-cli para enviar ao storage S3-compatível; openssl já vem no Alpine).
# apk é idempotente: se já instalado, não faz nada.
if ! command -v aws >/dev/null 2>&1; then
  apk add --no-cache aws-cli >/dev/null
fi

STAGING_DIR="/backup-staging"
SOURCE_INSTANCES_DIR="/backup-source/instances"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DIA_SEMANA="$(date -u +%u)"   # 1=segunda ... 7=domingo
DIA_MES="$(date -u +%d)"

BACKUP_NAME="chefebot-evolution-${TIMESTAMP}"
DUMP_FILE="${STAGING_DIR}/${BACKUP_NAME}.sql"
INSTANCES_TAR="${STAGING_DIR}/${BACKUP_NAME}-instances.tar.gz"
BUNDLE_TAR="${STAGING_DIR}/${BACKUP_NAME}.tar.gz"
ENCRYPTED_FILE="${BUNDLE_TAR}.enc"

log() { echo "[backup] $(date -u +%H:%M:%S) $1"; }

fail() {
  log "ERRO: $1"
  exit 1
}

[ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ] || fail "BACKUP_ENCRYPTION_PASSPHRASE não definida — recuse rodar sem criptografia"
[ -n "${BACKUP_S3_BUCKET:-}" ] || fail "BACKUP_S3_BUCKET não definido"

mkdir -p "$STAGING_DIR"

log "1/6 pg_dump do banco ${POSTGRES_DB:-evolution}"
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  -h postgres -U "$POSTGRES_USER" -d "${POSTGRES_DB:-evolution}" \
  --format=plain --no-owner --no-privileges \
  > "$DUMP_FILE"
[ -s "$DUMP_FILE" ] || fail "pg_dump gerou arquivo vazio — abortando sem enviar backup inválido"

log "2/6 empacotando volume de instâncias (sessões Baileys)"
if [ -d "$SOURCE_INSTANCES_DIR" ] && [ "$(ls -A "$SOURCE_INSTANCES_DIR" 2>/dev/null)" ]; then
  tar -czf "$INSTANCES_TAR" -C "$SOURCE_INSTANCES_DIR" .
else
  log "aviso: diretório de instâncias vazio ou ausente — backup só terá o banco"
  INSTANCES_TAR=""
fi

log "3/6 compactando bundle final"
if [ -n "$INSTANCES_TAR" ]; then
  tar -czf "$BUNDLE_TAR" -C "$STAGING_DIR" "$(basename "$DUMP_FILE")" "$(basename "$INSTANCES_TAR")"
else
  tar -czf "$BUNDLE_TAR" -C "$STAGING_DIR" "$(basename "$DUMP_FILE")"
fi

log "4/6 criptografando (AES-256, sem imprimir a senha)"
openssl enc -aes-256-cbc -pbkdf2 -salt \
  -in "$BUNDLE_TAR" -out "$ENCRYPTED_FILE" \
  -pass env:BACKUP_ENCRYPTION_PASSPHRASE
rm -f "$DUMP_FILE" "$INSTANCES_TAR" "$BUNDLE_TAR"

log "5/6 enviando para storage S3-compatível"
DESTINO_CATEGORIA="diarios"
if [ "$DIA_MES" = "01" ]; then
  DESTINO_CATEGORIA="mensais"
elif [ "$DIA_SEMANA" = "7" ]; then
  DESTINO_CATEGORIA="semanais"
fi

aws s3 cp "$ENCRYPTED_FILE" \
  "s3://${BACKUP_S3_BUCKET}/${DESTINO_CATEGORIA}/$(basename "$ENCRYPTED_FILE")" \
  --endpoint-url "${BACKUP_S3_ENDPOINT}" \
  --only-show-errors

log "6/6 aplicando retenção (7 diários, 4 semanais, 6 mensais)"
aplicar_retencao() {
  categoria="$1"
  manter="$2"
  # Lista do mais antigo pro mais novo, apaga tudo além dos N mais recentes.
  total=$(aws s3 ls "s3://${BACKUP_S3_BUCKET}/${categoria}/" --endpoint-url "${BACKUP_S3_ENDPOINT}" | wc -l)
  excesso=$((total - manter))
  if [ "$excesso" -gt 0 ]; then
    aws s3 ls "s3://${BACKUP_S3_BUCKET}/${categoria}/" --endpoint-url "${BACKUP_S3_ENDPOINT}" \
      | sort | head -n "$excesso" | awk '{print $4}' \
      | while read -r arquivo; do
          [ -n "$arquivo" ] && aws s3 rm "s3://${BACKUP_S3_BUCKET}/${categoria}/${arquivo}" --endpoint-url "${BACKUP_S3_ENDPOINT}" --only-show-errors
        done
  fi
}
aplicar_retencao "diarios" 7
aplicar_retencao "semanais" 4
aplicar_retencao "mensais" 6

rm -f "$ENCRYPTED_FILE"
log "backup concluído: ${DESTINO_CATEGORIA}/$(basename "$ENCRYPTED_FILE")"
