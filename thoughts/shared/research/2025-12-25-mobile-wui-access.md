---
date: 2025-12-25T03:03:14Z
researcher: claude
git_commit: 531d270ed839da44917ca4fef5d6c77111855d2b
branch: claude/research-mobile-wui-access-MVNar
repository: humanlayer
topic: "Exposing WUI for Mobile Device Access to Home Daemon"
tags: [research, codebase, humanlayer-wui, hld, mobile-access, network-configuration]
status: complete
last_updated: 2025-12-25
last_updated_by: claude
---

# Research: Exposing WUI for Mobile Device Access to Home Daemon

**Date**: 2025-12-25T03:03:14Z
**Researcher**: claude
**Git Commit**: 531d270ed839da44917ca4fef5d6c77111855d2b
**Branch**: claude/research-mobile-wui-access-MVNar
**Repository**: humanlayer

## Research Question

What would it take to expose the WUI (Web UI) used on desktop on a mobile device, assuming:
1. A running CodeLayer daemon on a machine at home
2. The daemon will be used for actual sessions
3. Mobile device wants to connect to and interact with this daemon

## Summary

The HumanLayer WUI is already architecturally capable of mobile access with configuration changes. The WUI is built as a **Tauri desktop application** with a **React SPA frontend** that communicates with the **hld daemon via HTTP REST API**. The frontend is browser-compatible and the daemon already includes an HTTP server with CORS enabled.

**Current state**: The daemon binds to `127.0.0.1:7777` by default (localhost-only) for security. The WUI can run as either a Tauri desktop app or a web application in a browser.

**What's needed for mobile access**:
1. **Configure daemon network binding** - Change from `127.0.0.1` to `0.0.0.0` to accept connections from network
2. **Serve frontend to mobile** - Either deploy the React SPA to a web server or access via the daemon's URL
3. **Network accessibility** - Expose the daemon's HTTP port on your home network
4. **Security considerations** - Currently no authentication on HTTP endpoints

The architecture already supports this use case - it's primarily a configuration and deployment task rather than a code modification task.

## Detailed Findings

### 1. WUI Architecture - Hybrid Desktop/Web Application

The humanlayer-wui is architecturally prepared for both desktop and web deployment:

#### Desktop Mode (Current Primary Use)
**Location**: `humanlayer-wui/src-tauri/` (Tauri backend)
- Tauri wraps the React SPA as a native desktop application
- Manages daemon lifecycle (auto-start, auto-stop)
- Provides desktop features: window management, global shortcuts, native notifications
- File system access for browsing directories

#### Browser Mode (Already Supported)
**Location**: `humanlayer-wui/src/lib/utils.ts:12-14`
```typescript
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window
}
```

The frontend uses runtime detection throughout the codebase to gracefully handle missing Tauri APIs:
- **Logging** (`src/lib/logging.ts:2`): Falls back to `console.*` in browser
- **Storage** (`src/lib/daemon/http-config.ts:16-22`): Uses localStorage when not in Tauri
- **Window management**: Disabled in browser, no errors
- **File operations**: File browser disabled without Tauri

**Key finding**: The React application is already a standard SPA that can run in browsers. The build output (`dist/`) contains static HTML/JS/CSS that can be served by any web server.

### 2. Daemon Communication - HTTP REST API (Network-Ready)

**Location**: `hld/daemon/http_server.go:59-115`

The daemon implements **dual transport protocols**:
1. **Unix socket** (JSON-RPC) - Used by hlyr CLI and local tools
2. **HTTP server** (REST API) - Used by WUI and can serve browser clients

#### HTTP Server Configuration
**Default binding** (`hld/config/config.go:113`):
```go
v.SetDefault("http_host", "127.0.0.1")  // Localhost only
v.SetDefault("http_port", 7777)
```

**Environment variable configuration**:
- `HUMANLAYER_DAEMON_HTTP_HOST` - Network interface to bind (default: `127.0.0.1`)
- `HUMANLAYER_DAEMON_HTTP_PORT` - TCP port (default: `7777`)

**Current state**: Binds to `127.0.0.1` which means:
- ✅ Secure by default (local-only access)
- ❌ Not accessible from network
- ❌ Cannot connect from mobile devices

**For network access**: Set `HUMANLAYER_DAEMON_HTTP_HOST=0.0.0.0` to bind to all interfaces.

#### CORS Configuration (Browser Access Enabled)
**Location**: `hld/daemon/http_server.go:80-88`
```go
router.Use(cors.New(cors.Config{
    AllowOrigins:     []string{"*"}, // TODO: Configure allowed origins
    AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
    AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization", "X-Client", "X-Client-Version"},
    ExposeHeaders:    []string{"X-Request-ID"},
    AllowCredentials: false,
    MaxAge:           12 * time.Hour,
}))
```

**Key finding**: CORS is already configured to allow browser clients from any origin. The daemon is prepared to serve browser-based clients.

#### REST API Endpoints
**Base path**: `/api/v1` (all endpoints implemented)

The daemon exposes a complete REST API:
- **Sessions**: Create, list, get, update, continue, interrupt, messages, snapshots
- **Approvals**: List, get, decide (approve/deny)
- **Settings**: User settings, daemon config
- **Files**: Fuzzy search, validate directory, create directory
- **Agents**: Discover agents
- **Events**: Server-sent events (SSE) for real-time updates
- **Health**: `/api/v1/health` endpoint

**Key finding**: All daemon functionality is available via HTTP REST API. No desktop-specific APIs required.

### 3. Frontend HTTP Client - Already Network-Capable

**Location**: `humanlayer-wui/src/lib/daemon/http-client.ts:40-111`

The WUI frontend uses the HLD TypeScript SDK (`@humanlayer/hld-sdk`) which is a generated OpenAPI client making standard HTTP requests.

#### Connection URL Resolution
**Location**: `humanlayer-wui/src/lib/daemon/http-config.ts:9-44`

Priority order for daemon URL:
1. Debug panel override: `window.__HUMANLAYER_DAEMON_URL`
2. localStorage (browser-only): `codelayer.daemon.url`
3. Environment variable: `VITE_HUMANLAYER_DAEMON_URL`
4. Managed daemon (Tauri): Dynamic port from `daemonService.getDaemonInfo()`
5. Fallback: `http://localhost:7777`

**For mobile access**, you would set:
```bash
VITE_HUMANLAYER_DAEMON_URL=http://<home-machine-ip>:7777
```

Or use localStorage in the browser:
```javascript
localStorage.setItem('codelayer.daemon.url', 'http://192.168.1.100:7777')
```

**Key finding**: The frontend already supports connecting to remote daemon URLs. It's designed to handle this use case.

#### Connection Features
- **Retry logic** (`http-client.ts:53-71`): 3 attempts with 500ms delay
- **Health check** (`http-client.ts:96-110`): Verifies daemon is responding
- **Event streaming** (`http-client.ts:599-652`): Server-sent events for real-time updates
- **Reconnection**: Automatic reconnection on errors

### 4. Vite Build System - Static Asset Generation

**Location**: `humanlayer-wui/vite.config.ts`

#### Build Configuration
```typescript
build: {
  sourcemap: process.env.NODE_ENV === 'production',
  rollupOptions: {
    output: {
      sourcemapExcludeSources: true,
    },
  },
}
```

**Build command**: `bun run build` (from `package.json:8`)
**Output directory**: `dist/` (default Vite output)

The build produces:
- `dist/index.html` - Entry point
- `dist/assets/*.js` - Bundled JavaScript
- `dist/assets/*.css` - Bundled styles
- Static assets (fonts, images, etc.)

#### Hash Routing
**Location**: `humanlayer-wui/src/router.tsx:12`
```typescript
export const router = createHashRouter([...])
```

Uses hash-based routing (`#/path`) which:
- Works with `file://` protocol (Tauri)
- Works with any web server (no server-side routing needed)
- Compatible with static file serving

**Key finding**: The build output is a standard static SPA that can be served by any web server (nginx, Apache, simple HTTP server, etc.).

### 5. Mobile Deployment Options

Based on the architecture, there are **three approaches** to mobile access:

#### Option A: Serve Frontend Separately (Recommended)
**Architecture**:
```
Mobile Browser → Web Server (serving WUI frontend) → HTTP API calls → Home Daemon
```

**Steps**:
1. Build WUI frontend: `cd humanlayer-wui && bun run build`
2. Serve `dist/` directory via web server (nginx, Apache, or simple HTTP server)
3. Configure daemon to bind to network: `HUMANLAYER_DAEMON_HTTP_HOST=0.0.0.0`
4. Set frontend to connect to daemon: `VITE_HUMANLAYER_DAEMON_URL=http://<home-ip>:7777`

**Advantages**:
- Separation of concerns (frontend serving vs daemon)
- Can serve frontend from different machine
- Standard web deployment

**Example with simple HTTP server**:
```bash
# Build frontend
cd humanlayer-wui
bun run build

# Serve on port 8080
cd dist
python3 -m http.server 8080

# Configure daemon
export HUMANLAYER_DAEMON_HTTP_HOST=0.0.0.0
hld start

# Access from mobile
# http://<home-ip>:8080
```

#### Option B: Direct Daemon Connection
**Architecture**:
```
Mobile Browser → Home Daemon (port 7777)
```

**Steps**:
1. Build and deploy WUI frontend somewhere accessible
2. Configure daemon: `HUMANLAYER_DAEMON_HTTP_HOST=0.0.0.0`
3. In mobile browser, set localStorage before loading app:
```javascript
localStorage.setItem('codelayer.daemon.url', 'http://<home-ip>:7777')
```

**Advantages**:
- Simpler setup
- Fewer moving parts

**Disadvantages**:
- Frontend and daemon must be network-accessible
- CORS already configured but less flexible

#### Option C: Progressive Web App (PWA)
The WUI could be enhanced with PWA capabilities:
- Service worker for offline functionality
- Add to home screen on mobile
- Push notifications (instead of Tauri notifications)

**Note**: This would require additional development work (manifest.json, service worker, etc.). Not currently implemented.

### 6. Security Considerations

**Current authentication**: None

The daemon currently has **no authentication layer** on HTTP endpoints:
- No API key validation
- No bearer token authentication
- No session cookies
- CORS allows all origins

**Security relies on**:
- Localhost binding (`127.0.0.1`) by default
- Network isolation (assumes trusted local network)

**For network exposure**, you should:

1. **Network-level security**:
   - Use firewall rules to restrict access
   - VPN for remote access (WireGuard, OpenVPN)
   - Reverse proxy with authentication (nginx + basic auth, Cloudflare Tunnel)

2. **Future enhancements** (would require code changes):
   - Add API key authentication
   - Implement user sessions
   - Add rate limiting
   - Restrict CORS origins
   - HTTPS/TLS support

**Current code locations**:
- HTTP server CORS: `hld/daemon/http_server.go:80-88`
- Unix socket permissions: `hld/daemon/daemon.go:23-24` (0600, owner-only)

### 7. Network Configuration Requirements

#### Daemon Configuration
**Location**: `hld/config/config.go:48-98`

**Environment variables**:
```bash
# Bind to all interfaces (allow network access)
export HUMANLAYER_DAEMON_HTTP_HOST=0.0.0.0

# Port (default 7777)
export HUMANLAYER_DAEMON_HTTP_PORT=7777

# Standard configs
export HUMANLAYER_DATABASE_PATH=~/.humanlayer/daemon.db
export HUMANLAYER_DAEMON_SOCKET=~/.humanlayer/daemon.sock
```

**Config file** (`~/.config/humanlayer/humanlayer.json`):
```json
{
  "http_host": "0.0.0.0",
  "http_port": 7777,
  "database_path": "~/.humanlayer/daemon.db",
  "socket_path": "~/.humanlayer/daemon.sock"
}
```

#### Home Network Setup
1. **Find home machine IP**: `ip addr` or `ifconfig` (e.g., `192.168.1.100`)
2. **Firewall**: Allow port 7777 (and frontend port if separate)
3. **Router**: No port forwarding needed if on same network
4. **mDNS** (optional): Use hostname instead of IP (e.g., `home-machine.local`)

#### Frontend Configuration
**Build-time** (`.env` file):
```bash
VITE_HUMANLAYER_DAEMON_URL=http://192.168.1.100:7777
```

**Runtime** (browser localStorage):
```javascript
localStorage.setItem('codelayer.daemon.url', 'http://192.168.1.100:7777')
```

### 8. Tauri-Specific Features Not Available on Mobile

These desktop features would not work in browser/mobile:

1. **Daemon lifecycle management** (`src-tauri/src/daemon.rs:37-407`):
   - Auto-start daemon
   - Auto-stop on app close
   - Process monitoring
   - Workaround: Manually manage daemon on home machine

2. **Global shortcuts** (`src/components/Layout.tsx:847`):
   - CommandOrControl+Shift+H hotkey
   - Workaround: None needed (mobile uses touch interface)

3. **Native notifications** (`src/services/NotificationService.tsx`):
   - Desktop notifications
   - Workaround: Already falls back to toast notifications in browser

4. **File browser** (`src/hooks/useFileBrowser.ts`):
   - Local directory browsing
   - Workaround: Type paths manually or use daemon's file operations API

5. **Window management** (`src/services/WindowStateService.ts`):
   - Save/restore window size and position
   - Workaround: None needed (browser handles this)

**Key finding**: Core functionality (sessions, approvals, conversations) works without Tauri. Desktop features are enhancements, not requirements.

## Code References

### WUI Frontend
- `humanlayer-wui/src/lib/utils.ts:12-14` - Tauri detection
- `humanlayer-wui/src/lib/daemon/http-client.ts:40-111` - HTTP client connection
- `humanlayer-wui/src/lib/daemon/http-config.ts:9-44` - URL resolution
- `humanlayer-wui/src/router.tsx:12` - Hash routing
- `humanlayer-wui/vite.config.ts:79-88` - Build configuration
- `humanlayer-wui/src/lib/logging.ts:2` - Browser detection and logging

### Daemon HTTP Server
- `hld/daemon/http_server.go:59-115` - HTTP server initialization
- `hld/daemon/http_server.go:80-88` - CORS configuration
- `hld/daemon/http_server.go:147-169` - TCP listener and port allocation
- `hld/config/config.go:100-115` - Default configuration
- `hld/config/config.go:48-75` - Environment variable bindings

### Architecture Documentation
- `humanlayer-wui/docs/ARCHITECTURE.md:1-131` - System architecture overview
- `humanlayer-wui/README.md:31-38` - External daemon connection docs
- `humanlayer-wui/CLAUDE.md:6-15` - Logging locations

## Architecture Documentation

### Current Data Flow (Desktop)
```
React SPA (Browser Context) → Tauri Commands (IPC) → Daemon Manager (Rust) → HLD Process
                           ↘
                             HTTP Client → HLD Daemon HTTP Server (:7777)
```

**Key insight**: Even in desktop mode, the frontend communicates with daemon via **HTTP**, not Tauri IPC. Tauri only manages daemon lifecycle.

### Proposed Data Flow (Mobile)
```
Mobile Browser → [Network] → HTTP → HLD Daemon (:7777 on home machine)
```

**Simplification**: Direct HTTP communication eliminates the Tauri layer entirely.

### Dual Transport Architecture
The daemon implements two independent server transports:

1. **Unix Socket** (`~/.humanlayer/daemon.sock`):
   - Protocol: JSON-RPC 2.0
   - Permissions: 0600 (owner-only)
   - Used by: hlyr CLI, local tools
   - Security: Filesystem permissions

2. **HTTP Server** (`127.0.0.1:7777`):
   - Protocol: REST API
   - Binding: Localhost by default
   - Used by: WUI, browser clients
   - Security: Network binding restriction

**Key finding**: These transports are independent. You can use HTTP from mobile while CLI tools still use Unix socket locally.

## Practical Implementation Steps

### Step 1: Configure Daemon for Network Access
On your home machine:

```bash
# Create config file
mkdir -p ~/.config/humanlayer
cat > ~/.config/humanlayer/humanlayer.json << EOF
{
  "http_host": "0.0.0.0",
  "http_port": 7777,
  "database_path": "~/.humanlayer/daemon.db",
  "socket_path": "~/.humanlayer/daemon.sock"
}
EOF

# Or use environment variables
export HUMANLAYER_DAEMON_HTTP_HOST=0.0.0.0
export HUMANLAYER_DAEMON_HTTP_PORT=7777

# Start daemon
hld start
```

**Verify**: Check daemon is listening on all interfaces
```bash
ss -tlnp | grep 7777
# Should show: 0.0.0.0:7777 or :::7777
```

### Step 2: Build WUI Frontend
On development machine (or home machine):

```bash
cd humanlayer-wui
bun install
bun run build
```

Output will be in `dist/` directory.

### Step 3A: Serve Frontend (Separate Server Option)
Copy `dist/` to home machine and serve:

```bash
# Simple HTTP server
cd dist
python3 -m http.server 8080

# Or nginx
sudo cp -r dist/* /var/www/html/codelayer/
# Configure nginx to serve from /var/www/html/codelayer

# Or any other web server
```

### Step 3B: Configure Frontend (Direct Connection Option)
If serving frontend elsewhere, configure daemon URL:

**Build-time** (`.env` in humanlayer-wui):
```bash
VITE_HUMANLAYER_DAEMON_URL=http://192.168.1.100:7777
```
Then rebuild: `bun run build`

**Runtime** (browser developer tools):
```javascript
localStorage.setItem('codelayer.daemon.url', 'http://192.168.1.100:7777')
```
Then refresh page.

### Step 4: Access from Mobile
1. Ensure mobile device is on same network as home machine
2. Open browser on mobile
3. Navigate to frontend URL:
   - Option A: `http://<home-ip>:8080` (separate server)
   - Option B: Wherever you deployed the `dist/` files
4. Verify connection in browser console

### Step 5: Firewall Configuration (if needed)
On home machine:

```bash
# Ubuntu/Debian (ufw)
sudo ufw allow 7777/tcp
sudo ufw allow 8080/tcp  # If serving frontend separately

# CentOS/RHEL (firewalld)
sudo firewall-cmd --permanent --add-port=7777/tcp
sudo firewall-cmd --permanent --add-port=8080/tcp
sudo firewall-cmd --reload

# macOS
# System Preferences → Security & Privacy → Firewall → Firewall Options
# Allow connections for hld and web server
```

## Open Questions

1. **Authentication**: How to secure the daemon when exposed to network? (requires code changes)
2. **HTTPS**: Should we require HTTPS for network access? (requires TLS termination proxy or code changes)
3. **Mobile-specific UI**: Does the current UI work well on mobile screens? (likely needs responsive design improvements)
4. **Offline support**: Should mobile have offline capabilities via PWA? (requires new development)
5. **Performance**: How well does SSE work on mobile networks? (needs testing)

## Related Research

This research builds on the existing architecture documented in:
- `humanlayer-wui/docs/ARCHITECTURE.md` - WUI system design
- `hld/PROTOCOL.md` - Daemon protocol specification
- `humanlayer-wui/docs/DEVELOPER_GUIDE.md` - Development practices

## Conclusions

**Mobile access to the WUI is architecturally feasible** with the current implementation. The key requirements are:

1. **Configuration**: Change daemon binding from localhost to network (environment variable or config file)
2. **Deployment**: Serve the WUI frontend build output via a web server
3. **Security**: Implement network-level security (VPN, reverse proxy, firewall rules)

**No code changes required** for basic functionality. The WUI was designed with browser compatibility in mind, and the daemon already exposes a complete HTTP REST API with CORS enabled.

**Recommended approach**:
- Use **Option A** (separate frontend server) for better separation of concerns
- Run daemon with `HUMANLAYER_DAEMON_HTTP_HOST=0.0.0.0`
- Serve frontend from simple HTTP server or nginx
- Access via VPN or reverse proxy with authentication for security
- Test on mobile to identify any UI/UX improvements needed

**Security warning**: The current implementation has no authentication. Before exposing to network, implement security measures at the network level (firewall, VPN, reverse proxy with auth) or add authentication to the daemon (requires code changes).
