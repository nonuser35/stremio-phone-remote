// Copyright (C) 2017-2023 Smart code 203358507

require('spatial-navigation-polyfill');
const React = require('react');
const { useTranslation } = require('react-i18next');
const { createPath, useLocation, useNavigate } = require('react-router');
const { useCore } = require('stremio/core');
const { Routes, useGoBack } = require('stremio-router');
const { Chromecast, ServicesProvider, GamepadProvider } = require('stremio/services');
const { FullscreenProvider, ToastProvider, TooltipProvider, ShortcutsProvider, DiscordProvider, CONSTANTS, useBinaryState, useProfile, useStreamingServer, withCoreSuspender, usePlatform } = require('stremio/common');
const ServicesToaster = require('./ServicesToaster');
const SearchParamsHandler = require('./SearchParamsHandler');
const DeepLinkHandler = require('./DeepLinkHandler');
const { default: ShellOpenHandler } = require('./ShellOpenHandler');
const { default: UpdaterBanner } = require('./UpdaterBanner');
const { default: ShortcutsModal } = require('./ShortcutsModal');
const { default: GamepadModal } = require('./GamepadModal');
const { default: useInterfaceScale } = require('./useInterfaceScale');
const styles = require('./styles');

const ProtectedRoutes = withCoreSuspender(Routes);
const NAVIGATE_TABS_ROUTES = ['/', '/discover', '/library', '/calendar', '/addons', '/settings'];
const REMOTE_MODE = ['127.0.0.1', 'localhost'].includes(window.location.hostname);

const App = () => {
    const core = useCore();
    const profile = useProfile();
    const streamingServer = useStreamingServer();
    const changeInterfaceScale = useInterfaceScale(profile);
    const { i18n } = useTranslation();
    const { shell } = usePlatform();
    const location = useLocation();
    const navigate = useNavigate();
    const goBack = useGoBack();
    const locationPath = createPath(location);
    const previousPathRef = React.useRef(locationPath);
    const appliedShellStreamingServerUrlRef = React.useRef(null);
    const [remoteStreamingServerUrl, setRemoteStreamingServerUrl] = React.useState(null);
    const [gamepadSupportEnabled, setGamepadSupportEnabled] = React.useState(false);
    const services = React.useMemo(() => {
        return {
            chromecast: new Chromecast(),
        };
    }, []);
    const [shortcutModalOpen,, closeShortcutsModal, toggleShortcutModal] = useBinaryState(false);
    const [gamepadModalOpen,, closeGamepadModal, toggleGamepadModal] = useBinaryState(false);

    const onShortcut = React.useCallback((name, combo, key) => {
        switch (name) {
            case 'interfaceScale':
                changeInterfaceScale(['decrease', 'increase', 'reset'][combo]);
                break;
            case 'shortcuts':
                toggleShortcutModal();
                break;
            case 'gamepadGuide':
                toggleGamepadModal();
                break;
            case 'navigateSearch':
                navigate('/search');
                break;
            case 'navigateTabs': {
                const index = Number(key) - 1;
                if (index >= 0 && index < NAVIGATE_TABS_ROUTES.length)
                    navigate(NAVIGATE_TABS_ROUTES[index]);
                break;
            }
            case 'navigateHistory':
                if (combo === 0) {
                    goBack();
                } else {
                    navigate(1);
                }
                break;
        }
    }, [toggleShortcutModal, toggleGamepadModal, changeInterfaceScale, navigate, goBack]);

    React.useEffect(() => {
        if (!REMOTE_MODE) return undefined;
        let disposed = false;
        fetch('/api/desktop-config', { cache: 'no-store' })
            .then((response) => response.ok ? response.json() : null)
            .then((config) => {
                if (!disposed && typeof config?.streamingServerUrl === 'string') {
                    const parsed = new URL(config.streamingServerUrl);
                    if (parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
                        setRemoteStreamingServerUrl(parsed.href);
                    }
                }
            })
            .catch(() => { /* Running outside the phone-remote server. */ });
        return () => { disposed = true; };
    }, []);

    React.useEffect(() => {
        if (!REMOTE_MODE || remoteStreamingServerUrl === null) return undefined;

        let selectedUrl = null;
        try {
            selectedUrl = new URL(profile.settings.streamingServerUrl).href;
        } catch (_) {
            // Invalid or missing profile URL: replace it with the local proxy.
        }
        if (selectedUrl === remoteStreamingServerUrl) return undefined;

        core.transport.dispatch({
            action: 'Ctx',
            args: {
                action: 'AddServerUrl',
                args: remoteStreamingServerUrl,
            },
        });
        const applyTimer = setTimeout(() => {
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'UpdateSettings',
                    args: {
                        ...profile.settings,
                        streamingServerUrl: remoteStreamingServerUrl,
                    },
                },
            });
        }, 150);
        const reloadTimer = setTimeout(() => {
            core.transport.dispatch({
                action: 'StreamingServer',
                args: { action: 'Reload' },
            });
        }, 600);
        return () => {
            clearTimeout(applyTimer);
            clearTimeout(reloadTimer);
        };
    }, [core.transport, profile.settings, remoteStreamingServerUrl]);

    React.useEffect(() => {
        if (!REMOTE_MODE) return;
        const status = {
            profileUrl: profile.settings.streamingServerUrl ?? null,
            baseUrl: streamingServer.baseUrl ?? null,
            transportUrl: streamingServer.selected?.transportUrl ?? null,
            settingsType: streamingServer.settings?.type ?? null,
        };
        fetch('/api/desktop-status', {
            method: 'POST',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(status),
        }).catch(() => { /* Diagnostics are only available in remote mode. */ });
    }, [
        profile.settings.streamingServerUrl,
        streamingServer.baseUrl,
        streamingServer.selected?.transportUrl,
        streamingServer.settings?.type,
    ]);

    React.useEffect(() => {
        const prevPath = previousPathRef.current;
        previousPathRef.current = locationPath;
        if (prevPath !== locationPath) {
            core.transport.analytics({
                event: 'LocationPathChanged',
                args: { prevPath }
            });
        }
    }, [locationPath, core.transport]);

    React.useEffect(() => {
        const onChromecastStateChange = () => {
            if (services.chromecast.active) {
                services.chromecast.transport.setOptions({
                    receiverApplicationId: CONSTANTS.CHROMECAST_RECEIVER_APP_ID,
                    autoJoinPolicy: chrome.cast.AutoJoinPolicy.PAGE_SCOPED,
                    resumeSavedSession: false,
                    language: null,
                    androidReceiverCompatible: true
                });
            }
        };
        services.chromecast.on('stateChanged', onChromecastStateChange);
        services.chromecast.start();

        window.services = services;
        return () => {
            services.chromecast.stop();
            services.chromecast.off('stateChanged', onChromecastStateChange);
        };
    }, [services]);

    React.useEffect(() => {
        if (typeof profile.settings?.interfaceLanguage === 'string') {
            i18n.changeLanguage(profile.settings.interfaceLanguage);
        }

        if (typeof profile.settings?.gamepadSupport === 'boolean') {
            setGamepadSupportEnabled(profile.settings.gamepadSupport);
        }

        if (profile.settings?.quitOnClose && shell.state.windowClosed) {
            shell.send('quit');
        }
    }, [profile.settings, i18n, shell]);

    React.useEffect(() => {
        const streamingServerUrl = shell.state.streamingServerUrl;
        if (!shell.active || typeof streamingServerUrl !== 'string' ||
            appliedShellStreamingServerUrlRef.current === streamingServerUrl) {
            return;
        }

        let parsed;
        try {
            parsed = new URL(streamingServerUrl);
        } catch (_) {
            return;
        }
        if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
            return;
        }

        const normalizedUrl = parsed.href;
        appliedShellStreamingServerUrlRef.current = normalizedUrl;
        core.transport.dispatch({
            action: 'Ctx',
            args: {
                action: 'AddServerUrl',
                args: normalizedUrl,
            },
        });
        core.transport.dispatch({
            action: 'Ctx',
            args: {
                action: 'UpdateSettings',
                args: {
                    ...profile.settings,
                    streamingServerUrl: normalizedUrl,
                },
            },
        });
    }, [core.transport, profile.settings, shell.active, shell.state.streamingServerUrl]);

    React.useEffect(() => {
        const onWindowFocus = () => {
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'PullAddonsFromAPI'
                }
            });
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'PullUserFromAPI',
                    args: {}
                }
            });
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'SyncLibraryWithAPI'
                }
            });
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'PullNotifications'
                }
            });
        };

        onWindowFocus();
        window.addEventListener('focus', onWindowFocus);

        return () => {
            window.removeEventListener('focus', onWindowFocus);
        };
    }, [core.transport]);

    return (
        <ServicesProvider services={services}>
            <ToastProvider className={styles['toasts-container']}>
                <TooltipProvider className={styles['tooltip-container']}>
                    <GamepadProvider enabled={gamepadSupportEnabled} onGuide={toggleGamepadModal}>
                        <ShortcutsProvider onShortcut={onShortcut}>
                            <FullscreenProvider>
                                <DiscordProvider>
                                    {
                                        shortcutModalOpen && <ShortcutsModal onClose={closeShortcutsModal}/>
                                    }
                                    {
                                        gamepadModalOpen && <GamepadModal onClose={closeGamepadModal}/>
                                    }
                                    <ServicesToaster />
                                    <SearchParamsHandler />
                                    <DeepLinkHandler />
                                    <ShellOpenHandler />
                                    <UpdaterBanner className={styles['updater-banner-container']} />
                                    <ProtectedRoutes />
                                </DiscordProvider>
                            </FullscreenProvider>
                        </ShortcutsProvider>
                    </GamepadProvider>
                </TooltipProvider>
            </ToastProvider>
        </ServicesProvider>
    );
};

module.exports = withCoreSuspender(App);
