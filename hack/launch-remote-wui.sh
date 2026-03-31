#!/bin/bash

REMOTE_HOST="truenas-dev-2"
REMOTE_PORT=43237
LOCAL_PORT=7777

# Check if tunnel already exists by checking if port is listening
if lsof -Pi :$LOCAL_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "SSH tunnel already running on port $LOCAL_PORT"
else
    echo "Starting SSH tunnel: $LOCAL_PORT -> $REMOTE_HOST:$REMOTE_PORT"
    ssh -f -N -L $LOCAL_PORT:localhost:$REMOTE_PORT $REMOTE_HOST

    # Wait briefly for tunnel to establish
    sleep 1

    # Verify tunnel was established
    if lsof -Pi :$LOCAL_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo "SSH tunnel established successfully"
    else
        echo "ERROR: Failed to establish SSH tunnel"
        exit 1
    fi
fi

# Test tunnel connectivity
if curl -s -o /dev/null -w "%{http_code}" http://localhost:$LOCAL_PORT/api/v1/health | grep -q "200"; then
    echo "Tunnel verified: daemon is reachable"
else
    echo "WARNING: Tunnel exists but daemon may not be running on remote"
fi

# Launch Remote WUI
echo "Launching Remote WUI..."
export HUMANLAYER_WUI_AUTOLAUNCH_DAEMON=false
exec /Applications/CodeLayer-Remote.app/Contents/MacOS/humanlayer-wui
