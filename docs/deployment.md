# GemBots Arena — Deployment Guide

## Prerequisites

- **Node.js** 18+ (recommended: 20 LTS)
- **npm** 9+
- **Supabase** account (free tier works) or self-hosted PostgreSQL
- **BSC RPC** endpoint (free: `https://bsc-dataseed.binance.org/`)
- **Domain** (optional, for production)

## Quick Start (Development)

```bash
# Clone and install
git clone https://github.com/avnikulin35/gembots-arena.git
cd gembots
npm install

# Set up environment
cp .env.example .env.local
# Edit .env.local with your Supabase credentials

# Set up database
# Copy database/schema.sql into Supabase SQL Editor and run it

# Start dev server
npm run dev
# → http://localhost:3000
# Root page: src/app/page.tsx handles `/`. Update it when modifying the landing experience.
```

## Docker Setup (Fastest)

```bash
# Copy and configure environment
cp .env.example .env.local
# Edit .env.local — set at minimum:
#   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-jwt>

# Start everything
docker-compose up -d

# App runs at http://localhost:3000
# PostgreSQL at localhost:54322
# REST API at localhost:54321
```

## VPS Deployment (Production)

### 1. Server Setup

```bash
# Ubuntu 22.04+
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl nginx certbot python3-certbot-nginx

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install PM2
sudo npm install -g pm2
```

### 2. Deploy Application

```bash
# Clone repo
cd /opt
sudo git clone https://github.com/avnikulin35/gembots-arena.git
cd gembots

# Install dependencies
npm ci

# Set up environment
cp .env.example .env.local
nano .env.local  # Configure all required variables

# Build
npm run build
```

### 3. PM2 Process Manager

```bash
# Start the app
pm2 start npm --name "gembots" -- start

# Auto-restart on reboot
pm2 startup
pm2 save

# Useful commands
pm2 status
pm2 logs gembots
pm2 restart gembots
pm2 monit
```

### 4. Nginx Reverse Proxy

Create `/etc/nginx/sites-available/gembots`:

```nginx
server {
    listen 80;
    server_name gembots.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
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
# Enable site
sudo ln -s /etc/nginx/sites-available/gembots /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 5. SSL with Certbot

```bash
sudo certbot --nginx -d gembots.yourdomain.com
# Certbot auto-renews via systemd timer
```

## Environment Variables

See `.env.example` for the full list. At minimum you need:

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anonymous key |
| `SUPABASE_SERVICE_KEY` | ✅ | Supabase service role key |
| `NEXT_PUBLIC_APP_URL` | ✅ | Public URL of your deployment |
| `NEXT_PUBLIC_BSC_RPC` | ✅ | BSC RPC endpoint |

## Updating

```bash
cd /opt/gembots
git pull
npm ci
npm run build
pm2 restart gembots
```

## Troubleshooting

- **Build fails:** Check Node.js version (`node -v`, need 18+)
- **DB connection errors:** Verify Supabase URL and keys in `.env.local`
- **502 Bad Gateway:** PM2 process crashed — check `pm2 logs gembots`
- **WebSocket issues:** Ensure Nginx `Upgrade` headers are set (see config above)
