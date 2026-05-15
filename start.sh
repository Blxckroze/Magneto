#!/bin/bash
cd "$(dirname "$0")"
echo "========================================"
echo "  magneto v2 — AI Digital Product Machine"
echo "========================================"
echo ""

# Install node deps if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
  echo ""
fi

# Install reportlab if needed
python3 -c "import reportlab" 2>/dev/null || {
  echo "Installing reportlab for PDF generation..."
  pip3 install reportlab pillow 2>/dev/null || pip install reportlab pillow
  echo ""
}

echo "Starting magneto..."
open "http://localhost:3002" 2>/dev/null || xdg-open "http://localhost:3002" 2>/dev/null &
node magneto_server.js
