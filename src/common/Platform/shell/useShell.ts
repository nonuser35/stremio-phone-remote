import { useEffect, useState } from 'react';
import EventEmitter from 'eventemitter3';

const IPC = globalThis?.chrome?.webview;
const LEGACY_IPC = globalThis?.qt?.webChannelTransport;
if (LEGACY_IPC) LEGACY_IPC.onmessage = () => { /* empty */ };

const events = new EventEmitter();
const on = (name: string, listener: (arg: any) => void) => events.on(name, listener);
const off = (name: string, listener: (arg: any) => void) => events.off(name, listener);

const supportsStreamingServerUrl = (version: string | undefined) => {
    if (!version) return true;
    const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
    return major > 5 || (major === 5 && (minor > 0 || patch >= 26));
};

enum ShellEventType {
    SIGNAL = 1,
    INIT = 3,
    INVOKE_METHOD = 6,
}

type ShellEvent = {
    id: number;
    type: ShellEventType;
};

type ShellEventInit = ShellEvent & {
    data: {
        transport: {
            properties: string[][],
        }
    };
};

type ShellEventSignal = ShellEvent & {
    args: string[];
};

type ShellMessage = {
    data: string;
};

const send = (method: string, ...args: (string | number | object)[]) => {
    try {
        IPC?.postMessage(JSON.stringify({
            id: 0,
            type: ShellEventType.INVOKE_METHOD,
            args: [method, ...args],
        }));
    } catch (e) {
        console.error('Shell', 'Failed to send event', e);
    }
};

const useShell = (): Shell => {
    const [state, setState] = useState<ShellState>({
        initialized: false,
        version: null,
        streamingServerUrl: null,
        windowClosed: false,
        windowHidden: false,
    });
    const [capabilities, setCapabilities] = useState<ShellCapabilities>({
        gpuVideoProcessing: false,
        nativeAssSubtitles: false,
        cacheDirectoryPicker: false,
        nativeInterfaceScale: false,
    });

    useEffect(() => {
        const onWindowVisibilityChanged = (data: WindowVisibility) => {
            setState((state) => ({
                ...state,
                windowClosed: data.visible === false && data.visibility === 0,
            }));
        };

        const onWindowStateChanged = (data: WindowState) => {
            setState((state) => ({
                ...state,
                windowHidden: data.state === 9,
            }));
        };

        on('win-visibility-changed', onWindowVisibilityChanged);
        on('win-state-changed', onWindowStateChanged);

        return () => {
            off('win-visibility-changed', onWindowVisibilityChanged);
            off('win-state-changed', onWindowStateChanged);
        };
    }, []);

    useEffect(() => {
        let initRetryInterval: ReturnType<typeof setInterval> | null = null;

        const requestInit = () => {
            IPC?.postMessage(JSON.stringify({
                id: 0,
                type: ShellEventType.INIT,
            }));
        };

        const onMessage = (message: ShellMessage) => {
            try {
                const event = JSON.parse(message.data) as ShellEvent;

                if (event.type === ShellEventType.INIT) {
                    const { data } = event as ShellEventInit;
                    const shellProperties = Object.fromEntries(data.transport.properties
                        .filter((property) => property.length >= 4 && property[1])
                        .map(([, name,, value]) => [name, value]));

                    setState((state) => ({
                        ...state,
                        initialized: true,
                        version: shellProperties.shellVersion ?? null,
                        streamingServerUrl: shellProperties.streamingServerUrl || null,
                    }));
                    setCapabilities({
                        gpuVideoProcessing: shellProperties.gpuVideoProcessing === 'true',
                        nativeAssSubtitles: shellProperties.nativeAssSubtitles === 'true',
                        cacheDirectoryPicker: shellProperties.cacheDirectoryPicker === 'true',
                        nativeInterfaceScale: shellProperties.nativeInterfaceScale === 'true',
                    });

                    // With a custom --webui-url the shell does not append the local
                    // streaming server URL to the page URL. The first handshake can
                    // also happen before that server is ready, so keep asking until
                    // the shell advertises it.
                    if ((shellProperties.streamingServerUrl || !supportsStreamingServerUrl(shellProperties.shellVersion)) && initRetryInterval !== null) {
                        clearInterval(initRetryInterval);
                        initRetryInterval = null;
                    }
                }

                if (event.type === ShellEventType.SIGNAL) {
                    const { args } = event as ShellEventSignal;
                    const [methodName, methodArg] = args;
                    events.emit(methodName, methodArg);
                }
            } catch (e) {
                console.error('Shell', 'Failed to handle event', e);
            }
        };

        IPC?.addEventListener('message', onMessage);
        requestInit();
        if (IPC) initRetryInterval = setInterval(requestInit, 1000);

        return () => {
            if (initRetryInterval !== null) clearInterval(initRetryInterval);
            IPC?.removeEventListener('message', onMessage);
        };
    }, []);

    return {
        active: !!IPC,
        send,
        on,
        off,
        state,
        capabilities,
    };
};

export default useShell;
