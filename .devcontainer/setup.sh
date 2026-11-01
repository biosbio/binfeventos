#!/usr/bin/env bash
set -euo pipefail

cd /workspaces/binfeventos

# Keep existing local credentials and settings; create secure development values only once.
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
Segredo MFA (introduzir manualmente na app autenticadora): $ADMIN_MFA_SECRET

Ficheiro local confidencial. Não partilhar nem enviar para o Git.
EOF
  chmod 600 .devcontainer/LOCAL-ADMIN-CREDENTIALS.txt
  printf '\nCredenciais locais de desenvolvimento criadas em .env (ficheiro ignorado pelo Git).\n'
fi

# Inside the Compose network, PostgreSQL is reachable as the service name `db`.
sed -i 's/@localhost:5432\//@db:5432\//g' .env

npm install
npx prisma generate
npx prisma migrate deploy
npm run db:seed

printf '\nBINF EVENTOS: ambiente preparado. Inicie a aplicação com a tarefa "BINF EVENTOS: iniciar".\n'
