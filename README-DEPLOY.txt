# 1) Node installieren (Userland)
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm install 22
nvm use 22

# 2) Abhängigkeiten
cd ~/retell-agent
npm install

# 3) PM2 global (User)
npm install -g pm2

# 4) Starten
pm2 start pm2.config.cjs
pm2 status
pm2 logs retell-agent

# 5) Autostart (User-Level)
pm2 startup
pm2 save

# 6) Lokal testen
curl -s http://localhost:3000/healthz
# -> {"ok":true,"node":"v22.x.x"}

# 7) Cloudflare Tunnel (separat, siehe unten)
