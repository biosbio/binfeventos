#!/usr/bin/env bash
set -euo pipefail

cd /workspaces/binfeventos

if [ ! -f .env ]; then
  ADMIN_PASSWORD="BinfDev-$(openssl rand -hex 18)"
  ADMIN_MFA_SECRET="$(openssl rand -hex 32)"
  MFA_ENCRYPTION_KEY="$(openssl rand -hex 32)"
  SESSION_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
  SANDBOX_WEBHOOK_SECRET="$(openssl rand -hex 32)"

  cat > .env <<EOF
DATABASE_URL="postgresql://postgres:postgres@db:5432/binf_eventos?schema=public"
ADMIN_EMAIL="moi7-@hotmail.com"
ADMIN_PASSWORD="$ADMIN_PASSWORD"
ADMIN_MFA_SECRET="$ADMIN_MFA_SECRET"
MFA_ENCRYPTION_KEY="$MFA_ENCRYPTION_KEY"
SESSION_SECRET="$SESSION_SECRET"
SANDBOX_WEBHOOK_SECRET="$SANDBOX_WEBHOOK_SECRET"
PAYMENT_PROVIDER_CODE="sandbox"
APP_URL="http://localhost:3000"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
RESEND_API_KEY=""
EMAIL_FROM="BINF EVENTOS <no-reply@example.invalid>"
TWILIO_ACCOUNT_SID=""
TWILIO_AUTH_TOKEN=""
TWILIO_FROM_NUMBER=""
EMAIL_API_KEY=""
SMS_API_KEY=""
EOF
  chmod 600 .env
  cat > .devcontainer/LOCAL-ADMIN-CREDENTIALS.txt <<EOF
BINF EVENTOS - ACESSO LOCAL DE DESENVOLVIMENTO
Email: moi7-@hotmail.com
Password: $ADMIN_PASSWORD
Segredo MFA: $ADMIN_MFA_SECRET

Ficheiro local confidencial. Não partilhar nem enviar para o Git.
EOF
  chmod 600 .devcontainer/LOCAL-ADMIN-CREDENTIALS.txt
fi

# The database is reached through the Compose service name, not localhost.
sed -i 's/@localhost:5432\//@db:5432\//g' .env

npm install
npx prisma generate
npx prisma migrate deploy
set -a
. ./.env
set +a
npm run db:seed
