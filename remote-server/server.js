#!/usr/bin/env node
/* eslint-disable no-console */

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { WebSocketServer, WebSocket } = require('ws');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode-terminal/vendor/QRCode');
const QRErrorCorrectLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');
const { isAllowedCommand, isLoopbackAddress, isPrivateAddress } = require('./protocol');
const DeviceStore = require('./device-store');

const PORT = Number.parseInt(process.env.STREMIO_REMOTE_PORT || '8765', 10);
const HOST = process.env.STREMIO_REMOTE_HOST || '0.0.0.0';
const STREAM_PROXY_PORT = Number.parseInt(process.env.STREMIO_STREAM_PROXY_PORT || String(PORT + 1), 10);
const STREAMING_SERVER_PORT = Number.parseInt(process.env.STREMIO_STREAMING_SERVER_PORT || '11470', 10);
const STREAM_PROXY_HOST = '127.0.0.1';
const DESKTOP_ORIGIN = `http://127.0.0.1:${PORT}`;
const BUILD_DIR = path.resolve(__dirname, '..', 'build');
const REMOTE_DIR = path.resolve(__dirname, 'public');
const MAX_BODY_BYTES = 4096;
const DEVICES_FILE = process.env.STREMIO_REMOTE_DEVICES_FILE || path.resolve(__dirname, 'remote-devices.json');
const HEADLESS = process.env.STREMIO_REMOTE_HEADLESS === '1';

const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
};

const pairingPin = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
const playerToken = crypto.randomBytes(32).toString('base64url');
const deviceStore = new DeviceStore(DEVICES_FILE);
const failedPairingAttempts = new Map();
const remoteSockets = new Set();
let playerSocket = null;
let latestState = { connected: false };
let latestDesktopStatus = { connected: false };

const json = (response, status, payload, headers = {}) => {
    const body = JSON.stringify(payload);
    response.writeHead(status, {
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(body),
        'Content-Type': 'application/json; charset=utf-8',
        ...headers,
    });
    response.end(body);
};

const readJsonBody = (request) => new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
            reject(new Error('body-too-large'));
            request.destroy();
            return;
        }
        chunks.push(chunk);
    });
    request.on('end', () => {
        try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
        } catch {
            reject(new Error('invalid-json'));
        }
    });
    request.on('error', reject);
});

const withProxyCors = (headers = {}) => ({
    ...headers,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Origin': DESKTOP_ORIGIN,
    'Access-Control-Expose-Headers': '*',
    Vary: 'Origin',
});

const proxyRequestHeaders = (headers) => {
    const forwarded = {
        ...headers,
        host: `127.0.0.1:${STREAMING_SERVER_PORT}`,
    };
    delete forwarded.origin;
    return forwarded;
};

const streamingProxyServer = http.createServer((request, response) => {
    if (request.method === 'OPTIONS') {
        response.writeHead(204, withProxyCors({
            'Access-Control-Allow-Headers': request.headers['access-control-request-headers'] || '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
        }));
        response.end();
        return;
    }

    const upstream = http.request({
        hostname: '127.0.0.1',
        port: STREAMING_SERVER_PORT,
        method: request.method,
        path: request.url,
        headers: proxyRequestHeaders(request.headers),
    }, (upstreamResponse) => {
        const responseHeaders = { ...upstreamResponse.headers };
        delete responseHeaders['access-control-allow-origin'];
        delete responseHeaders['access-control-allow-credentials'];
        response.writeHead(upstreamResponse.statusCode || 502, withProxyCors(responseHeaders));
        upstreamResponse.pipe(response);
    });
    upstream.on('error', (error) => {
        if (!response.headersSent) {
            response.writeHead(502, withProxyCors({ 'Content-Type': 'text/plain; charset=utf-8' }));
        }
        response.end(`Streaming server proxy error: ${error.message}`);
    });
    request.pipe(upstream);
});

streamingProxyServer.on('upgrade', (request, socket, head) => {
    const upstream = http.request({
        hostname: '127.0.0.1',
        port: STREAMING_SERVER_PORT,
        method: request.method,
        path: request.url,
        headers: proxyRequestHeaders(request.headers),
    });
    upstream.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
        const lines = [`HTTP/1.1 ${upstreamResponse.statusCode} ${upstreamResponse.statusMessage}`];
        for (const [name, value] of Object.entries(upstreamResponse.headers)) {
            if (Array.isArray(value)) {
                for (const item of value) lines.push(`${name}: ${item}`);
            } else if (value !== undefined) {
                lines.push(`${name}: ${value}`);
            }
        }
        socket.write(`${lines.join('\r\n')}\r\n\r\n`);
        if (upstreamHead.length) socket.write(upstreamHead);
        if (head.length) upstreamSocket.write(head);
        upstreamSocket.pipe(socket).pipe(upstreamSocket);
    });
    upstream.on('response', (upstreamResponse) => {
        socket.write(`HTTP/1.1 ${upstreamResponse.statusCode || 502} Proxy Error\r\nConnection: close\r\n\r\n`);
        socket.destroy();
    });
    upstream.on('error', () => socket.destroy());
    upstream.end();
});

const safeFile = (root, relativePath) => {
    const target = path.resolve(root, relativePath);
    return target === root || target.startsWith(`${root}${path.sep}`) ? target : null;
};

const serveFile = (response, root, relativePath, fallbackToIndex = false, headOnly = false) => {
    let file = safeFile(root, relativePath);
    if (!file) {
        response.writeHead(403).end('Forbidden');
        return;
    }

    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
        file = path.join(file, 'index.html');
    }
    if ((!fs.existsSync(file) || !fs.statSync(file).isFile()) && fallbackToIndex) {
        file = path.join(root, 'index.html');
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        response.writeHead(404).end('Not found');
        return;
    }

    const extension = path.extname(file).toLowerCase();
    const securityHeaders = root === REMOTE_DIR ? {
        'Content-Security-Policy': "default-src 'self'; base-uri 'none'; connect-src 'self' ws: wss:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: http: https:; object-src 'none'; script-src 'self'; style-src 'self'",
        'Referrer-Policy': 'no-referrer',
        'X-Frame-Options': 'DENY',
    } : {};
    response.writeHead(200, {
        'Cache-Control': extension === '.html' ? 'no-store' : 'public, max-age=3600',
        'Content-Type': contentTypes[extension] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        ...securityHeaders,
    });
    if (headOnly) {
        response.end();
        return;
    }
    fs.createReadStream(file).pipe(response);
};

const remoteDeviceForToken = (token) => deviceStore.findByToken(token);

const isRateLimited = (address) => {
    const now = Date.now();
    const previous = failedPairingAttempts.get(address) || [];
    const recent = previous.filter((timestamp) => now - timestamp < 60_000);
    failedPairingAttempts.set(address, recent);
    return recent.length >= 8;
};

const recordFailedPairing = (address) => {
    const attempts = failedPairingAttempts.get(address) || [];
    attempts.push(Date.now());
    failedPairingAttempts.set(address, attempts);
};

const requestHandler = async (request, response) => {
    const address = request.socket.remoteAddress || '';
    if (!isPrivateAddress(address)) {
        response.writeHead(403).end('Local network only');
        return;
    }

    const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(requestUrl.pathname);

    if (request.method === 'GET' && pathname === '/api/player-session') {
        if (!isLoopbackAddress(address)) {
            json(response, 403, { error: 'loopback-only' });
            return;
        }
        json(response, 200, { token: playerToken, websocketPath: '/ws' }, {
            'Access-Control-Allow-Origin': request.headers.origin && /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?$/i.test(request.headers.origin) ? request.headers.origin : 'http://127.0.0.1',
        });
        return;
    }

    if (request.method === 'GET' && pathname === '/api/desktop-config') {
        if (!isLoopbackAddress(address)) {
            json(response, 403, { error: 'loopback-only' });
            return;
        }
        json(response, 200, {
            streamingServerUrl: `http://${STREAM_PROXY_HOST}:${STREAM_PROXY_PORT}/`,
        });
        return;
    }

    if (request.method === 'POST' && pathname === '/api/desktop-status') {
        if (!isLoopbackAddress(address)) {
            json(response, 403, { error: 'loopback-only' });
            return;
        }
        try {
            const body = await readJsonBody(request);
            latestDesktopStatus = {
                connected: true,
                profileUrl: typeof body.profileUrl === 'string' ? body.profileUrl : null,
                baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : null,
                transportUrl: typeof body.transportUrl === 'string' ? body.transportUrl : null,
                settingsType: typeof body.settingsType === 'string' ? body.settingsType : null,
                updatedAt: new Date().toISOString(),
            };
            json(response, 200, { ok: true });
        } catch {
            json(response, 400, { error: 'invalid-request' });
        }
        return;
    }

    if (request.method === 'GET' && pathname === '/api/desktop-status') {
        if (!isLoopbackAddress(address)) {
            json(response, 403, { error: 'loopback-only' });
            return;
        }
        json(response, 200, latestDesktopStatus);
        return;
    }

    if (request.method === 'POST' && pathname === '/api/pair') {
        if (isRateLimited(address)) {
            json(response, 429, { error: 'too-many-attempts' });
            return;
        }
        try {
            const body = await readJsonBody(request);
            const submitted = String(body.pin || '').replace(/\D/g, '');
            const valid = submitted.length === pairingPin.length &&
                crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(pairingPin));
            if (!valid) {
                recordFailedPairing(address);
                json(response, 401, { error: 'invalid-pin' });
                return;
            }
            const device = deviceStore.pair({
                name: body.deviceName,
                address,
                userAgent: request.headers['user-agent'],
            });
            failedPairingAttempts.delete(address);
            json(response, 200, { token: device.token, deviceId: device.id, websocketPath: '/ws' });
            renderDashboard(false, `${device.name} was paired.`);
        } catch {
            json(response, 400, { error: 'invalid-request' });
        }
        return;
    }

    if (request.method === 'GET' && pathname === '/api/remote-session') {
        const device = remoteDeviceForToken(requestUrl.searchParams.get('token'));
        if (!device) {
            json(response, 401, { valid: false, error: 'device-revoked' });
            return;
        }
        deviceStore.touch(device.id, address);
        json(response, 200, { valid: true, device: { id: device.id, name: device.name }, websocketPath: '/ws' });
        return;
    }

    if (request.method === 'GET' && pathname === '/api/devices') {
        if (!isLoopbackAddress(address)) {
            json(response, 403, { error: 'loopback-only' });
            return;
        }
        json(response, 200, { devices: deviceStore.publicList() });
        return;
    }

    if (request.method === 'GET' && pathname === '/api/dashboard') {
        if (!isLoopbackAddress(address)) {
            json(response, 403, { error: 'loopback-only' });
            return;
        }
        const addresses = localAddresses();
        const urls = addresses.map((networkAddress) => `http://${networkAddress}:${PORT}/remote/`);
        const primaryUrl = urls[0] || `http://127.0.0.1:${PORT}/remote/`;
        const qr = new QRCode(-1, QRErrorCorrectLevel.L);
        qr.addData(primaryUrl);
        qr.make();
        const online = onlineDeviceIds();
        json(response, 200, {
            port: PORT,
            bridgePort: STREAM_PROXY_PORT,
            pin: pairingPin,
            playerConnected: playerSocket?.readyState === WebSocket.OPEN,
            primaryUrl,
            urls,
            qrMatrix: qr.modules,
            devices: deviceStore.publicList().map((device) => ({ ...device, online: online.has(device.id) })),
        });
        return;
    }

    if (request.method === 'DELETE' && pathname.startsWith('/api/devices/')) {
        if (!isLoopbackAddress(address)) {
            json(response, 403, { error: 'loopback-only' });
            return;
        }
        const deviceId = pathname.slice('/api/devices/'.length);
        const removed = revokeDevice(deviceId);
        json(response, removed ? 200 : 404, removed ? { ok: true } : { error: 'device-not-found' });
        return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD, POST, DELETE' }).end('Method not allowed');
        return;
    }

    if (pathname === '/remote') {
        response.writeHead(302, { Location: '/remote/' }).end();
        return;
    }
    if (pathname.startsWith('/remote/')) {
        const relative = pathname.slice('/remote/'.length) || 'index.html';
        serveFile(response, REMOTE_DIR, relative, true, request.method === 'HEAD');
        return;
    }

    if (!fs.existsSync(path.join(BUILD_DIR, 'index.html'))) {
        response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('A interface do Stremio ainda nao foi compilada. Execute: pnpm build');
        return;
    }
    serveFile(response, BUILD_DIR, pathname.slice(1) || 'index.html', true, request.method === 'HEAD');
};

const server = http.createServer((request, response) => {
    requestHandler(request, response).catch((error) => {
        console.error(error);
        if (!response.headersSent) response.writeHead(500);
        response.end('Internal server error');
    });
});

const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

const broadcastState = () => {
    const payload = JSON.stringify({ type: 'state', state: latestState });
    for (const socket of remoteSockets) {
        if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
};

server.on('upgrade', (request, socket, head) => {
    const address = request.socket.remoteAddress || '';
    const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const role = requestUrl.searchParams.get('role');
    const token = requestUrl.searchParams.get('token');
    const validPlayer = role === 'player' && isLoopbackAddress(address) && token === playerToken;
    const remoteDevice = role === 'remote' && isPrivateAddress(address) ? remoteDeviceForToken(token) : null;
    const validRemote = remoteDevice !== null;

    if (requestUrl.pathname !== '/ws' || (!validPlayer && !validRemote)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        webSocket.role = role;
        webSocket.deviceId = remoteDevice?.id || null;
        webSocket.deviceName = remoteDevice?.name || null;
        webSocket.remoteAddress = address;
        webSocket.isAlive = true;
        webSocketServer.emit('connection', webSocket);
    });
});

webSocketServer.on('connection', (socket) => {
    socket.on('pong', () => { socket.isAlive = true; });

    if (socket.role === 'player') {
        if (playerSocket && playerSocket.readyState === WebSocket.OPEN) {
            playerSocket.close(4000, 'Replaced by a newer player connection');
        }
        playerSocket = socket;
        latestState = { connected: true };
        broadcastState();
        renderDashboard(false, 'Stremio player connected.');

        socket.on('message', (raw) => {
            try {
                const message = JSON.parse(raw.toString());
                if (message.type === 'state' && message.state && typeof message.state === 'object') {
                    latestState = { ...message.state, connected: true };
                    broadcastState();
                }
            } catch {
                // Ignore malformed messages from the local player connection.
            }
        });
        socket.on('close', () => {
            if (playerSocket === socket) {
                playerSocket = null;
                latestState = { ...latestState, connected: false };
                broadcastState();
                renderDashboard(false, 'Stremio player disconnected.');
            }
        });
        return;
    }

    remoteSockets.add(socket);
    if (socket.deviceId) deviceStore.touch(socket.deviceId, socket.remoteAddress);
    renderDashboard(false, `${socket.deviceName || 'Remote'} connected.`);
    socket.send(JSON.stringify({ type: 'state', state: latestState }));
    socket.on('message', (raw) => {
        try {
            const message = JSON.parse(raw.toString());
            if (isAllowedCommand(message) && playerSocket?.readyState === WebSocket.OPEN) {
                playerSocket.send(JSON.stringify(message));
            }
        } catch {
            // Ignore malformed remote messages.
        }
    });
    socket.on('close', () => {
        remoteSockets.delete(socket);
        renderDashboard(false, `${socket.deviceName || 'Remote'} disconnected.`);
    });
});

const heartbeat = setInterval(() => {
    for (const socket of webSocketServer.clients) {
        if (socket.isAlive === false) {
            socket.terminate();
            continue;
        }
        socket.isAlive = false;
        socket.ping();
    }
}, 30_000);
heartbeat.unref();

const localAddresses = () => Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal && isPrivateAddress(entry.address))
    .map((entry) => entry.address)
    .sort((left, right) => {
        const priority = (address) => address.startsWith('192.168.') ? 0 : address.startsWith('10.') ? 1 : 2;
        return priority(left) - priority(right) || left.localeCompare(right, 'en');
    });

const onlineDeviceIds = () => new Set([...remoteSockets].map((socket) => socket.deviceId).filter(Boolean));

const revokeDevice = (deviceId) => {
    const removed = deviceStore.remove(deviceId);
    if (!removed) return false;
    for (const socket of remoteSockets) {
        if (socket.deviceId === deviceId) socket.close(4003, 'Device unlinked');
    }
    renderDashboard(false, 'Device unpaired.');
    return true;
};

const formatLastSeen = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'unknown' : date.toLocaleString('en-US');
};

const renderDashboard = (includeQr = false, message = '') => {
    if (HEADLESS) return;
    const addresses = localAddresses();
    const urls = addresses.length > 0 ? addresses.map((address) => `http://${address}:${PORT}/remote/`) : [`http://IP-DO-PC:${PORT}/remote/`];
    const online = onlineDeviceIds();
    const devices = deviceStore.publicList();
    console.clear();
    console.log('============================================================');
    console.log('                 STREMIO PHONE REMOTE');
    console.log('============================================================');
    console.log(`Player status : ${playerSocket?.readyState === WebSocket.OPEN ? 'CONNECTED' : 'waiting for Stremio'}`);
    console.log(`Remote port  : ${PORT}`);
    console.log(`Bridge port  : ${STREAM_PROXY_PORT}`);
    console.log(`Pairing PIN  : ${pairingPin}`);
    console.log('');
    console.log('HOW TO CONNECT YOUR PHONE');
    console.log('1. Keep the computer and phone on the same Wi-Fi network.');
    console.log('2. Open one of the addresses below in the phone browser.');
    console.log('3. Enter the PIN above once.');
    urls.forEach((url) => console.log(`   ${url}`));
    if (includeQr && addresses.length > 0) {
        console.log('');
        console.log('Scan this QR code with the phone camera:');
        qrcode.generate(urls[0], { small: true }, (code) => console.log(code));
    }
    console.log('');
    console.log(`PAIRED DEVICES (${devices.length})`);
    if (devices.length === 0) {
        console.log('   No paired devices yet.');
    } else {
        devices.forEach((device, index) => {
            console.log(`   ${index + 1}. ${device.name} - ${online.has(device.id) ? 'ONLINE' : `last seen ${formatLastSeen(device.lastSeenAt)}`}`);
        });
    }
    console.log('');
    console.log('COMMANDS:  qr  |  list  |  remove NUMBER  |  help');
    if (message) console.log(`NOTICE: ${message}`);
    console.log('Keep this window open while using the remote.');
    process.stdout.write('> ');
};

const terminal = HEADLESS ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
terminal?.on('line', (line) => {
    const [command, argument] = line.trim().toLowerCase().split(/\s+/, 2);
    if (command === 'remove') {
        const devices = deviceStore.publicList();
        const index = Number.parseInt(argument, 10) - 1;
        if (!Number.isInteger(index) || !devices[index]) {
            renderDashboard(false, 'Invalid device number. Use "list" to check the list.');
        } else {
            revokeDevice(devices[index].id);
        }
    } else if (command === 'qr') {
        renderDashboard(true);
    } else if (command === 'list' || command === 'help' || command === '') {
        renderDashboard(false);
    } else {
        renderDashboard(false, 'Unknown command. Use: qr, list, or remove NUMBER.');
    }
});

server.listen(PORT, HOST, () => {
    renderDashboard(true);
});

streamingProxyServer.listen(STREAM_PROXY_PORT, STREAM_PROXY_HOST, () => {
    // The bridge status is shown in the dashboard.
});

const shutdown = () => {
    clearInterval(heartbeat);
    terminal?.close();
    for (const socket of webSocketServer.clients) socket.close(1001, 'Server shutting down');
    let pendingServers = 2;
    const onServerClosed = () => {
        pendingServers -= 1;
        if (pendingServers === 0) process.exit(0);
    };
    server.close(onServerClosed);
    streamingProxyServer.close(onServerClosed);
    setTimeout(() => process.exit(1), 2000).unref();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { server, streamingProxyServer };
