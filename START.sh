#!/bin/bash

set -e

echo "🚀 Minecraft Rendering Client - Phase 2.5"
echo ""

# Check if server.jar exists
if [ ! -f server.jar ]; then
  echo "⚠️  server.jar not found. Downloading..."
  curl -C - -o server.jar https://launcher.mojang.com/v1/objects/8f3112a1049751cc472ec13e397eade5336ca7ae/server.jar
  echo "✅ Server jar downloaded"
fi

echo ""
echo "📦 Installing dependencies..."
cd bridge && npm install > /dev/null 2>&1 && cd ..
cd rendering-client && npm install > /dev/null 2>&1 && cd ..
echo "✅ Dependencies installed"

echo ""
echo "🎯 Ready to start:"
echo ""
echo "Terminal 1 (Minecraft Server):"
echo "  cd ~/Desktop/minecraft-bot"
echo "  java -Xmx1024M -Xms512M -jar server.jar nogui"
echo ""
echo "Terminal 2 (Bridge):"
echo "  cd ~/Desktop/minecraft-bot/bridge"
echo "  npm run dev"
echo ""
echo "Terminal 3 (Client):"
echo "  cd ~/Desktop/minecraft-bot/rendering-client"
echo "  npm run dev"
echo ""
echo "Then open: http://localhost:3000"
echo ""
