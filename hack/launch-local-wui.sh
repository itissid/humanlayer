#!/bin/bash

# Configuration
DAEMON_BINARY="/Applications/CodeLayer-Nightly.app/Contents/Resources/bin/hld"
WUI_BINARY="/Applications/CodeLayer-Nightly.app/Contents/MacOS/humanlayer-wui"
DAEMON_PORT=7778
DAEMON_DB="$HOME/.humanlayer/daemon-nightly.db"
DAEMON_SOCKET="$HOME/.humanlayer/daemon-nightly.sock"

# Check if daemon is already running
if ps aux | grep -v grep | grep -q "$DAEMON_BINARY"; then
    echo "Daemon already running (port $DAEMON_PORT)"
    DAEMON_PID=$(ps aux | grep -v grep | grep "$DAEMON_BINARY" | awk '{print $2}')
    echo "Daemon PID: $DAEMON_PID"
else
    echo "Starting local daemon: $DAEMON_PORT"

    # Ensure logs directory exists
    mkdir -p ~/.humanlayer/logs

    # Start daemon in background
    HUMANLAYER_DAEMON_HTTP_PORT=$DAEMON_PORT \
    HUMANLAYER_DATABASE_PATH="$DAEMON_DB" \
    HUMANLAYER_DAEMON_SOCKET="$DAEMON_SOCKET" \
    "$DAEMON_BINARY" > ~/.humanlayer/logs/daemon-launch.log 2>&1 &

    DAEMON_PID=$!
    echo "Daemon starting with PID: $DAEMON_PID"

    # Wait for daemon to start
    echo "Waiting for daemon to initialize..."
    sleep 2

    # Verify daemon is running
    if ! ps -p $DAEMON_PID > /dev/null 2>&1; then
        echo "ERROR: Daemon failed to start"
        echo "Check logs at: ~/.humanlayer/logs/daemon-launch.log"
        exit 1
    fi

    # Wait for port to be listening
    for i in {1..10}; do
        if lsof -Pi :$DAEMON_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
            echo "Daemon listening on port $DAEMON_PORT"
            break
        fi
        if [ $i -eq 10 ]; then
            echo "ERROR: Daemon didn't bind to port $DAEMON_PORT"
            echo "Check logs at: ~/.humanlayer/logs/daemon-launch.log"
            exit 1
        fi
        sleep 1
    done
fi

# Test daemon connectivity
echo "Testing daemon health..."
if curl -s -o /dev/null -w "%{http_code}" http://localhost:$DAEMON_PORT/api/v1/health | grep -q "200"; then
    echo "Daemon health check: OK"
else
    echo "WARNING: Daemon health check failed"
    echo "Daemon may still be initializing..."
fi

# Launch WUI
echo "Launching CodeLayer-Nightly WUI..."
HUMANLAYER_WUI_AUTOLAUNCH_DAEMON=false \
HUMANLAYER_DAEMON_HTTP_PORT=$DAEMON_PORT \
VITE_HUMANLAYER_DAEMON_HTTP_PORT=$DAEMON_PORT \
exec "$WUI_BINARY"
