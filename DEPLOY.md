# GigBuddy Deployment Guide

Deploy to a VPS using Docker, GitHub Actions CI/CD, Nginx reverse proxy, and Let's Encrypt HTTPS.

**Target server**: `129.121.90.105` (Ubuntu 24.04)  
**Stack**: Node 20 app container + Postgres container + Nginx reverse proxy

---

## Overview

```
Internet → Nginx (port 80/443) → app container (port 3002)
                                → postgres container (internal only)
```

The GitHub Actions workflow SSHs into the VPS on every push to `main` and runs `docker compose up -d --build`.

---

## Phase 1 — Local: Create Docker files

### 1. `Dockerfile`

Create this at the project root:

```dockerfile
# ---- build stage ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- production stage ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY server/ ./server/
COPY --from=builder /app/dist ./dist
EXPOSE 3002
CMD ["node", "server/index.js"]
```

### 2. `docker-compose.yml`

Create this at the project root:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${PGDATABASE}
      POSTGRES_USER: ${PGUSER}
      POSTGRES_PASSWORD: ${PGPASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${PGUSER} -d ${PGDATABASE}"]
      interval: 5s
      timeout: 5s
      retries: 5

  app:
    build: .
    restart: unless-stopped
    ports:
      - "3002:3002"
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy

  migrate:
    build: .
    command: node server/db/migrate.js
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
    restart: "no"

volumes:
  postgres_data:
```

### 3. `.dockerignore`

Create this at the project root:

```
node_modules
dist
.env
.env.*
!.env.example
.git
*.md
```

### 4. Update `server/index.js` — serve static frontend

Add these lines **before** the error handler middleware (after `app.use('/api', routes)`):

```js
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
app.use(express.static(join(__dirname, '../dist')))
app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, '../dist/index.html'))
})
```

---

## Phase 2 — GitHub Setup

### 5. Create the GitHub repository

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/FoggyFreek/gigbuddy.git
git push -u origin main
```

### 6. Add GitHub Secrets

Go to **GitHub → your repo → Settings → Secrets and variables → Actions → New repository secret** and add each of these:

| Secret name | Value |
|---|---|
| `VPS_HOST` | `129.121.90.105` |
| `VPS_USER` | `root` (or your deploy user) |
| `VPS_SSH_KEY` | Private SSH key (generated in Phase 3, step 9) |
| `PGDATABASE` | `gigbuddy` |
| `PGUSER` | your chosen postgres username |
| `PGPASSWORD` | a strong random password |
| `PGHOST` | `postgres` |
| `PGPORT` | `5432` |
| `SERVER_PORT` | `3002` |
| `CLIENT_ORIGIN` | `https://gigbuddy.jorisbos.nl` |
| `SESSION_SECRET` | a long random string (run `openssl rand -hex 32`) |
| `GOOGLE_CLIENT_ID` | from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | from Google Cloud Console |
| `OIDC_REDIRECT_URI` | `https://gigbuddy.jorisbos.nl/api/auth/callback` |
| `APP_URL` | `https://gigbuddy.jorisbos.nl` |
| `ADMIN_EMAIL` | `03jbos1981@gmail.com` |

### 7. Create GitHub Actions workflow

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to VPS

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /opt/gigbuddy
            git pull origin main
            cat > .env <<EOF
            PGHOST=postgres
            PGDATABASE=${{ secrets.PGDATABASE }}
            PGUSER=${{ secrets.PGUSER }}
            PGPASSWORD=${{ secrets.PGPASSWORD }}
            PGPORT=5432
            SERVER_PORT=3002
            CLIENT_ORIGIN=${{ secrets.CLIENT_ORIGIN }}
            SESSION_SECRET=${{ secrets.SESSION_SECRET }}
            GOOGLE_CLIENT_ID=${{ secrets.GOOGLE_CLIENT_ID }}
            GOOGLE_CLIENT_SECRET=${{ secrets.GOOGLE_CLIENT_SECRET }}
            OIDC_REDIRECT_URI=${{ secrets.OIDC_REDIRECT_URI }}
            APP_URL=${{ secrets.APP_URL }}
            ADMIN_EMAIL=${{ secrets.ADMIN_EMAIL }}
            NODE_ENV=production
            EOF
            docker compose up -d --build
            docker compose run --rm migrate
```

---

## Phase 3 — VPS Setup (one-time, manual)

SSH into your server: `ssh root@129.121.90.105`

### 8. Update the system

```bash
apt update && apt upgrade -y
```

### 9. Generate deploy SSH key pair

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github_deploy -N ""
cat ~/.ssh/github_deploy.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/github_deploy   # Copy this — paste it into GitHub Secret VPS_SSH_KEY
```

### 10. Install Docker

```bash
apt install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
docker --version   # confirm install
```

### 11. Clone the repo

```bash
mkdir -p /opt/gigbuddy
cd /opt/gigbuddy
git clone https://github.com/FoggyFreek/gigbuddy.git .
```

### 12. Create the production `.env`

```bash
nano /opt/gigbuddy/.env
```

Paste and fill in (use the same values as your GitHub Secrets):

```
PGHOST=postgres
PGDATABASE=gigbuddy
PGUSER=your_pg_user
PGPASSWORD=your_strong_password
PGPORT=5432
SERVER_PORT=3002
CLIENT_ORIGIN=https://gigbuddy.jorisbos.nl
SESSION_SECRET=your_long_random_secret
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
OIDC_REDIRECT_URI=https://gigbuddy.jorisbos.nl/api/auth/callback
APP_URL=https://gigbuddy.jorisbos.nl
ADMIN_EMAIL=03jbos1981@gmail.com
NODE_ENV=production
```

### 13. First deploy

```bash
cd /opt/gigbuddy
docker compose up -d --build
docker compose run --rm migrate
docker compose ps       # all services should show "running"
docker compose logs app # check for errors
```

### 13a. Restore a PostgreSQL backup (optional)

Do this **after** the postgres container is running but **before** or **after** migrations — restoring a full dump will overwrite the database anyway.

**Copy your backup file to the VPS first** (run this from your local machine):

```bash
scp /path/to/your/backup.sql root@129.121.90.105:/opt/gigbuddy/backup.sql
# or if it's a custom-format dump (.dump):
scp /path/to/your/backup.dump root@129.121.90.105:/opt/gigbuddy/backup.dump
```

**Then on the VPS**, restore it:

```bash
cd /opt/gigbuddy

# If your backup is a plain SQL file (.sql):
docker compose exec -T postgres psql -U your_pg_user -d gigbuddy < backup.sql

# If your backup is pg_dump custom format (.dump):
docker compose exec -T postgres pg_restore -U your_pg_user -d gigbuddy --no-owner --role=your_pg_user /dev/stdin < backup.dump
```

If the restore complains about existing objects (e.g. tables already created by migrations), drop and recreate the database first:

```bash
docker compose exec postgres psql -U your_pg_user -c "DROP DATABASE gigbuddy;"
docker compose exec postgres psql -U your_pg_user -c "CREATE DATABASE gigbuddy;"

# Then restore again:
docker compose exec -T postgres psql -U your_pg_user -d gigbuddy < backup.sql
```

Clean up the backup file once done:

```bash
rm /opt/gigbuddy/backup.sql
```

---

## Phase 4 — Nginx + HTTPS

### 14. Install Nginx and Certbot

```bash
apt install -y nginx certbot python3-certbot-nginx
```

### 15. Create Nginx site config

Create the Nginx site config:

```bash
nano /etc/nginx/sites-available/gigbuddy
```

Paste:

```nginx
server {
    listen 80;
    server_name gigbuddy.jorisbos.nl;

    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/gigbuddy /etc/nginx/sites-enabled/
nginx -t           # test config — must say "ok"
systemctl reload nginx
```

### 16. Point your domain DNS

`jorisbos.nl` is hosted elsewhere; you only need to add one **A record** for the `gigbuddy` subdomain in the DNS zone for `jorisbos.nl` (at whichever host manages that zone). Leave the existing `www.jorisbos.nl` record untouched.

```
Type:  A
Name:  gigbuddy          (some panels want the full "gigbuddy.jorisbos.nl")
Value: 129.121.90.105
TTL:   300
```

Wait for DNS to propagate (usually a few minutes). Verify resolution **before** running certbot — the HTTP-01 challenge fails if the domain doesn't yet resolve to the VPS:

```bash
dig +short gigbuddy.jorisbos.nl   # must print 129.121.90.105
curl http://gigbuddy.jorisbos.nl
```

### 17. Get a free HTTPS certificate

```bash
certbot --nginx -d gigbuddy.jorisbos.nl
```

Certbot will ask for your email, agree to ToS, and automatically update your Nginx config to redirect HTTP → HTTPS. Test renewal:

```bash
certbot renew --dry-run
```

Renewal runs automatically via a systemd timer — no cron needed.

---

## Phase 5 — Open firewall ports

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'   # opens 80 and 443
ufw enable
ufw status
```

---

## Verification checklist

- [ ] `https://gigbuddy.jorisbos.nl` loads the app with a valid certificate
- [ ] Login / Google OAuth works (`OIDC_REDIRECT_URI` matches the domain)
- [ ] `docker compose ps` shows all containers healthy
- [ ] Push a change to `main` → GitHub Actions deploys it automatically

---

## Useful commands (on the VPS)

```bash
# View live app logs
docker compose -f /opt/gigbuddy/docker-compose.yml logs -f app

# Restart the app without rebuilding
docker compose -f /opt/gigbuddy/docker-compose.yml restart app

# Run migrations manually
docker compose -f /opt/gigbuddy/docker-compose.yml run --rm migrate

# Rebuild and redeploy manually
cd /opt/gigbuddy && git pull && docker compose up -d --build

# Connect to the postgres database
docker compose -f /opt/gigbuddy/docker-compose.yml exec postgres psql -U your_pg_user -d gigbuddy

# Dump the current database (quick backup)
docker compose -f /opt/gigbuddy/docker-compose.yml exec postgres pg_dump -U your_pg_user gigbuddy > ~/gigbuddy_$(date +%Y%m%d).sql
```
