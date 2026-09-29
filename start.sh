#!/bin/bash
# TBQ Practice Scheduler Launcher
cd "$(dirname "$0")"

echo "=================================================="
echo " Starting TBQ Coaching Slot Booking Server..."
echo "=================================================="

# Kill any previous instance running on port 3000
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
killall cloudflared 2>/dev/null || true

# Start Node server
node server.js > server.log 2>&1 &
SERVER_PID=$!

echo "Server started (PID: $SERVER_PID) on http://localhost:3000"
sleep 1

# Start Cloudflare Tunnel
echo "Generating secure public HTTPS link via Cloudflare..."
./cloudflared tunnel --url http://localhost:3000 --protocol http2 --no-autoupdate > tunnel.log 2>&1 &
TUNNEL_PID=$!

sleep 4

# Extract Public URL
PUBLIC_URL=$(grep -o 'https://.*\.trycloudflare.com' tunnel.log | head -n 1)

echo ""
echo "=================================================="
echo "🎉 SUCCESS! YOUR TBQ SIGNUP PAGE IS LIVE:"
echo ""
echo "👉 $PUBLIC_URL"
echo ""
echo "📱 Share this link with parents via WhatsApp/Text/Email!"
echo "👑 Coach Passcode for Admin Panel: coach2026"
echo "=================================================="
echo ""
echo "Press Ctrl+C to stop the server."

trap "kill $SERVER_PID $TUNNEL_PID 2>/dev/null; exit" SIGINT SIGTERM
wait
