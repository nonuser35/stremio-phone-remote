const React = require('react');

const configuredServer = process.env.REMOTE_CONTROL_SERVER_URL || '';

const toWebSocketUrl = (baseUrl, websocketPath, token) => {
    const url = new URL(websocketPath, baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('role', 'player');
    url.searchParams.set('token', token);
    return url.toString();
};

const useRemoteControl = (state, onCommand) => {
    const onCommandRef = React.useRef(onCommand);
    const stateRef = React.useRef(state);
    const socketRef = React.useRef(null);
    const lastStatePayloadRef = React.useRef('');

    onCommandRef.current = onCommand;
    stateRef.current = state;

    React.useEffect(() => {
        let disposed = false;
        let reconnectTimer = null;
        let socket = null;
        const baseUrl = configuredServer.trim() || window.location.origin;

        const sendCurrentState = () => {
            if (socket?.readyState !== WebSocket.OPEN) return;
            const payload = JSON.stringify({ type: 'state', state: stateRef.current });
            lastStatePayloadRef.current = payload;
            socket.send(payload);
        };

        const connect = async () => {
            try {
                const response = await fetch(new URL('/api/player-session', baseUrl), {
                    cache: 'no-store',
                });
                if (!response.ok) throw new Error(`Remote server returned ${response.status}`);
                const session = await response.json();
                if (disposed) return;

                socket = new WebSocket(toWebSocketUrl(baseUrl, session.websocketPath, session.token));
                socketRef.current = socket;
                socket.addEventListener('open', sendCurrentState);
                socket.addEventListener('message', (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        if (message.type === 'command' && message.command === 'refresh_subtitles') {
                            sendCurrentState();
                        } else if (message.type === 'command') {
                            onCommandRef.current(message);
                        }
                    } catch (error) {
                        console.warn('RemoteControl', 'Invalid command ignored', error);
                    }
                });
                socket.addEventListener('close', () => {
                    if (socketRef.current === socket) socketRef.current = null;
                    if (!disposed) reconnectTimer = setTimeout(connect, 2000);
                });
                socket.addEventListener('error', () => socket.close());
            } catch (_error) {
                if (!disposed) reconnectTimer = setTimeout(connect, 3000);
            }
        };

        connect();
        return () => {
            disposed = true;
            clearTimeout(reconnectTimer);
            if (socketRef.current === socket) socketRef.current = null;
            socket?.close(1000, 'Player unmounted');
        };
    }, []);

    React.useEffect(() => {
        const payload = JSON.stringify({ type: 'state', state });
        if (payload === lastStatePayloadRef.current || socketRef.current?.readyState !== WebSocket.OPEN) {
            return;
        }
        lastStatePayloadRef.current = payload;
        socketRef.current.send(payload);
    }, [state]);
};

module.exports = useRemoteControl;
