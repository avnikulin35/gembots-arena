const fs = require("fs");
const path = require("path");
const envFile = path.join(__dirname, ".env");
const env = {};
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, "utf8").split("\n").forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim();
  });
}
module.exports = {
  apps: [{
    name: "gembot",
    script: "npx",
    args: "tsx telegram-bot.ts",
    cwd: __dirname,
    env: env,
    max_memory_restart: "256M",
    autorestart: true,
  }]
};
