#!/usr/bin/env bash
# context-economy dashboard launcher (Mac / Linux).
# Run once: chmod +x dashboard.sh
# Then: ./dashboard.sh
# Starts the local server and opens the dashboard at http://127.0.0.1:3847
# (that's the mode where the skill on/off buttons work).
# Keep the terminal open while you use the dashboard. Press Ctrl+C to stop.

if ! command -v node >/dev/null 2>&1; then
  echo "Error: 'node' not found in PATH."
  echo "Install Node.js or, if you use nvm, run: nvm use --lts && ./dashboard.sh"
  exit 1
fi

cd "$(dirname "$0")"
node scripts/dashboard-serve.cjs
echo ""
echo "Dashboard server stopped."
