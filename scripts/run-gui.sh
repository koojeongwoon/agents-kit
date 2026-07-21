#!/usr/bin/env bash
# agents-kit Desktop App & GUI Launcher Script

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

echo "========================================="
echo " 🚀 Launching agents-kit Desktop App"
echo "========================================="

cd "$PROJECT_ROOT/gui"

# Check node_modules
if [ ! -d "node_modules" ]; then
  echo "📦 Installing GUI dependencies..."
  npm install
fi

# Kill any existing server process on port 3710
lsof -ti :3710 | xargs kill -9 2>/dev/null || true

echo "⚙️ Starting Node.js Backend Server on port 3710..."
node server/index.js &
SERVER_PID=$!

sleep 1

# Check if Tauri dev mode can be launched or fallback to standalone app window
echo "💻 Launching agents-kit Desktop Window..."

if command -v cargo &> /dev/null; then
  echo "✨ Cargo detected. Running in Tauri Desktop mode..."
  npx tauri dev
else
  echo "🌐 Running in Standalone Desktop GUI mode..."
  npx vite --open
fi

# Cleanup on exit
trap "kill $SERVER_PID 2>/dev/null || true" EXIT
