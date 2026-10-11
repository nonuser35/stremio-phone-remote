// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const { useParams, useNavigate } = require('react-router');
const { useSearchParams } = require('react-router-dom');
const classnames = require('classnames');
const debounce = require('lodash.debounce');
const { useTranslation } = require('react-i18next');
const { default: useRouteFocused } = require('stremio/common/useRouteFocused');
const { useCore } = require('stremio/core');
const { useServices, useGamepad } = require('stremio/services');
const { useContentGamepadNavigation } = require('stremio/services/GamepadNavigation');
const { useSettings, useProfile, useFullscreen, useBinaryState, useToast, useStreamingServer, withCoreSuspender, usePlatform, useShortcut, getKeyboardShortcutKey, getKeyboardShortcutKeys, useDiscord, languages, EMPTY_DISCORD_TIMESTAMPS, getPlaybackDiscordActivity } = require('stremio/common');
const { EPG_PLAYER_NOW_REFRESH_INTERVAL, getEpgTimeRange, useLiveRefresh } = require('stremio/common/EPG');
const { default: toPath } = require('stremio-router/toPath');
const { useGoBack } = require('stremio-router');
const { HorizontalNavBar, Transition, ContextMenu } = require('stremio/components');
const { default: Buffering } = require('./Buffering');
const VolumeChangeIndicator = require('./VolumeChangeIndicator');
const Error = require('./Error');
const ControlBar = require('./ControlBar');
const NextVideoPopup = require('./NextVideoPopup');
const StatisticsMenu = require('./StatisticsMenu');
const OptionsMenu = require('./OptionsMenu');
const { default: CastDevicesMenu } = require('./CastDevicesMenu');
const SubtitlesMenu = require('./SubtitlesMenu');
const { default: AudioMenu } = require('./AudioMenu');
const SpeedMenu = require('./SpeedMenu');
const { default: SideDrawerButton } = require('./SideDrawerButton');
const { default: SideDrawer } = require('./SideDrawer');
const usePlayer = require('./usePlayer');
const { default: usePlayOnDevice } = require('./usePlayOnDevice');
const { default: useCastDevice } = require('./useCastDevice');
const { default: useKeyboardSeek } = require('./useKeyboardSeek');
const { default: usePlaybackSpeedHold } = require('./usePlaybackSpeedHold');
const { default: useStatistics } = require('./useStatistics');
const useVideo = require('./useVideo');
const { default: useAudio } = require('./useAudio');
const { default: useSubtitles } = require('./useSubtitles');
const styles = require('./styles');
const Video = require('./Video');
const { default: Indicator } = require('./Indicator/Indicator');
const { default: useMediaSession } = require('./useMediaSession');
const useRemoteControl = require('stremio/services/RemoteControl/useRemoteControl');

const GAMEPAD_HANDLER_ID = 'player';

const CAST_DEVICES_REFRESH_INTERVAL = 5000;

const SUBTITLE_LOCALE_ALIASES = {
    pob: 'pt-BR',
    'br-pt': 'pt-BR',
    'br_pt': 'pt-BR',
};

const capitalize = (value) => value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;

const subtitleLocale = (track) => {
    const raw = String(track.lang || '').trim();
    const hint = `${raw} ${track.label || ''} ${track.origin || ''}`.toLowerCase();
    const alias = SUBTITLE_LOCALE_ALIASES[raw.toLowerCase()];
    const language = languages.find(raw) || languages.find(raw.toLowerCase());
    const baseLanguageCode = raw.replace('_', '-').match(/^([a-z]{2,3})(?:-|$)/i)?.[1]?.toLowerCase();
    const explicitRegion = raw.replace('_', '-').match(/^[a-z]{2,3}-([a-z]{2})$/i)?.[1]?.toUpperCase();
    const hintedRegion = /(?:pt[-_ ]?br|brazil|brasil|brazilian|\bpob\b)/i.test(hint) ? 'BR' :
        /(?:pt[-_ ]?pt|portugal)/i.test(hint) ? 'PT' :
            null;
    const hintedLanguageCode = /(?:portugu[eê]s|brazil|brasil|\bpob\b)/i.test(hint) ? 'pt' :
        /(?:english|ingl[eê]s)/i.test(hint) ? 'en' :
            null;
    const code = alias || language?.alpha2 || (baseLanguageCode?.length === 2 ? baseLanguageCode : null) || hintedLanguageCode || 'und';

    try {
        const locale = new Intl.Locale(code);
        const languageCode = locale.language === 'und' ? null : locale.language;
        const regionCode = explicitRegion || hintedRegion || locale.maximize().region || null;
        const displayNames = new Intl.DisplayNames(['en-US'], { type: 'language' });
        const regionNames = new Intl.DisplayNames(['en-US'], { type: 'region' });
        return {
            language: capitalize(languageCode ? displayNames.of(languageCode) : null) || 'Unknown language',
            country: regionCode ? regionNames.of(regionCode) : 'Unknown country',
            languageCode,
            countryCode: regionCode,
        };
    } catch (_) {
        return {
            language: capitalize(language?.label) || 'Unknown language',
            country: 'Unknown country',
            languageCode: language?.alpha2 || null,
            countryCode: null,
        };
    }
};

const subtitleAddonName = (track, addons) => {
    const directName = [track.addonName, track.provider, track.source]
        .find((value) => typeof value === 'string' && value.trim() && !/^https?:/i.test(value));
    if (directName) return directName.trim();

    const origin = typeof track.origin === 'string' ? track.origin.trim() : '';
    const trackUrl = typeof track.url === 'string' ? track.url : '';
    const matchingAddon = (addons || []).find((addon) => {
        const manifest = addon?.manifest || {};
        if (origin && (origin === manifest.id || origin.toLowerCase().includes(String(manifest.name || '').toLowerCase()))) return true;
        try {
            return trackUrl && new URL(trackUrl).hostname === new URL(addon.transportUrl).hostname;
        } catch (_) {
            return false;
        }
    });
    if (matchingAddon?.manifest?.name) return matchingAddon.manifest.name;
    if (origin && !/^(embedded|local|exclusive|addon)$/i.test(origin) && !/^https?:/i.test(origin)) return origin;
    try {
        return trackUrl ? new URL(trackUrl).hostname.replace(/^www\./, '') : null;
    } catch (_) {
        return null;
    }
};

const remoteSubtitleTrack = (track, source, index, addons) => {
    const locale = subtitleLocale(track);
    const addonName = source === 'external' ? subtitleAddonName(track, addons) : null;
    const sourceLabel = source === 'embedded' ? 'Embedded' : addonName ? `Addon: ${addonName}` : 'Addon';
    return {
        key: `${source}:${track.id}`,
        label: `${locale.language} — ${locale.country} · ${sourceLabel} ${index + 1}`,
        languageCode: locale.languageCode,
        source,
    };
};

const addonResourceUrl = (request, videoId) => {
    if (!request?.base || !request?.path?.type || !videoId) return null;
    try {
        const url = new URL(request.base);
        url.pathname = `${url.pathname.replace(/\/?manifest\.json\/?$/i, '').replace(/\/$/, '')}/stream/${encodeURIComponent(request.path.type)}/${encodeURIComponent(videoId)}.json`;
        return url.toString();
    } catch (_) {
        return null;
    }
};

const streamIdentityMatches = (left, right) => {
    if (!left || !right) return false;
    if (left.infoHash && right.infoHash) {
        return left.infoHash.toLowerCase() === right.infoHash.toLowerCase() && Number(left.fileIdx || 0) === Number(right.fileIdx || 0);
    }
    return ['url', 'externalUrl', 'ytId'].some((field) => left[field] && left[field] === right[field]) ||
        (left.name === right.name && left.description === right.description);
};

const streamTraits = (stream) => {
    const text = `${stream?.name || ''} ${stream?.description || ''}`.toLowerCase();
    return ['2160p', '4k', '1080p', '720p', '480p', 'hdr', 'dolby vision', ' dv ', 'hevc', 'x265', 'h265', 'x264', 'h264', 'remux', 'web-dl', 'bluray']
        .filter((trait) => text.includes(trait));
};

const selectCoherentStream = (currentStream, currentStreams, targetStreams) => {
    if (!currentStream || !Array.isArray(targetStreams) || targetStreams.length === 0) return null;
    const bingeGroup = currentStream.behaviorHints?.bingeGroup;
    if (bingeGroup) {
        const sameGroup = targetStreams.find((stream) => stream.behaviorHints?.bingeGroup === bingeGroup);
        if (sameGroup) return sameGroup;
    }

    const currentIndex = Array.isArray(currentStreams) ? currentStreams.findIndex((stream) => streamIdentityMatches(stream, currentStream)) : -1;
    if (currentIndex >= 0 && targetStreams[currentIndex]) return targetStreams[currentIndex];

    const traits = streamTraits(currentStream);
    const ranked = targetStreams.map((stream, index) => {
        const candidateTraits = streamTraits(stream);
        const score = (stream.name === currentStream.name ? 40 : 0) +
            traits.filter((trait) => candidateTraits.includes(trait)).length * 8 - index / 1000;
        return { stream, score };
    }).sort((left, right) => right.score - left.score);
    return ranked[0]?.score > 0 ? ranked[0].stream : null;
};

const Player = () => {
    const { stream, streamTransportUrl, metaTransportUrl, type, id, videoId } = useParams();
    const urlParams = React.useMemo(() => ({
        stream,
        streamTransportUrl,
        metaTransportUrl,
        type,
        id,
        videoId
    }), [stream, streamTransportUrl, metaTransportUrl, type, id, videoId]);
    const [queryParams] = useSearchParams();
    const navigate = useNavigate();
    const goBack = useGoBack();
    const { t } = useTranslation();
    const services = useServices();
    const core = useCore();
    const gamepad = useGamepad();
    const forceTranscoding = React.useMemo(() => {
        return queryParams.has('forceTranscoding');
    }, [queryParams]);
    const profile = useProfile();
    const [player, videoParamsChanged, streamStateChanged, audioPreferenceChanged, subtitlePreferenceChanged, videoScaleChanged, timeChanged, seek, pausedChanged, ended, nextVideo] = usePlayer(urlParams);
    const [settings] = useSettings();
    const streamingServer = useStreamingServer();
    const statistics = useStatistics(player, streamingServer);
    const video = useVideo();
    const routeFocused = useRouteFocused();
    const platform = usePlatform();
    const toast = useToast();
    const discord = useDiscord();
    const discordTimestamps = React.useRef(EMPTY_DISCORD_TIMESTAMPS);

    const [seeking, setSeeking] = React.useState(false);

    const [casting, setCasting] = React.useState(() => {
        return services.chromecast.active && services.chromecast.transport.getCastState() === cast.framework.CastState.CONNECTED;
    });
    const playbackDevices = React.useMemo(() => streamingServer.playbackDevices !== null && streamingServer.playbackDevices.type === 'Ready' ? streamingServer.playbackDevices.content : [], [streamingServer]);

    const playerRef = React.useRef(null);
    const bufferingRef = React.useRef();
    const errorRef = React.useRef();

    const [immersed, setImmersed] = React.useState(true);
    const setImmersedDebounced = React.useCallback(debounce(setImmersed, 3000), []);
    const [fullscreen, , , toggleFullscreen, , setVideoElement] = useFullscreen();

    React.useEffect(() => {
        const el = video.containerRef.current?.querySelector('video');
        setVideoElement(el || null);
        return () => setVideoElement(null);
    }, [video.state.manifest]);

    const [optionsMenuOpen, , closeOptionsMenu, toggleOptionsMenu] = useBinaryState(false);
    const [subtitlesMenuOpen, , closeSubtitlesMenu, toggleSubtitlesMenu] = useBinaryState(false);
    const [audioMenuOpen, , closeAudioMenu, toggleAudioMenu] = useBinaryState(false);
    const [speedMenuOpen, , closeSpeedMenu, toggleSpeedMenu] = useBinaryState(false);
    const [statisticsMenuOpen, openStatisticsMenu, closeStatisticsMenu, toggleStatisticsMenu] = useBinaryState(false);
    const [castDevicesMenuOpen, , closeCastDevicesMenu, toggleCastDevicesMenu] = useBinaryState(false);
    const metaItemContent = player.metaItem !== null && player.metaItem.type === 'Ready' ? player.metaItem.content : null;

    const isEpg = (player.live ?? null) !== null;
    const currentEpgVideo = player.live?.currentProgram ?? null;
    const upcomingVideo = isEpg ? player.live?.nextProgram ?? null : player.nextVideo;
    const epgNow = useLiveRefresh('Player', 'player', isEpg, EPG_PLAYER_NOW_REFRESH_INTERVAL);
    const livePlayback = isEpg || video.state.live !== null;
    const seekStart = livePlayback ? video.state.live?.start : 0;
    const seekEnd = livePlayback ? video.state.live?.end : video.state.duration;
    const canSeek = Number.isFinite(seekStart) && Number.isFinite(seekEnd) && seekEnd > seekStart && Number.isFinite(video.state.time);
    const [nextVideoPopupDismissal, setNextVideoPopupDismissal] = React.useState(null);
    const liveEpgRange = currentEpgVideo === null ? null : getEpgTimeRange(currentEpgVideo);
    const nextVideoRemainingTime = isEpg ?
        liveEpgRange === null ? null : liveEpgRange.endTime - epgNow
        :
        video.state.time === null || video.state.duration === null ? null : video.state.duration - video.state.time;
    const nextVideoPopupOpen = upcomingVideo !== null &&
        (nextVideoPopupDismissal === null || nextVideoPopupDismissal.stream !== video.state.stream ||
            (isEpg && nextVideoPopupDismissal.programId !== currentEpgVideo?.id)) &&
        nextVideoRemainingTime !== null && nextVideoRemainingTime > 0 &&
        nextVideoRemainingTime <= settings.nextVideoNotificationDuration;
    const [sideDrawerOpen, , closeSideDrawer, toggleSideDrawer] = useBinaryState(false);

    const menusOpen = React.useMemo(() => {
        return optionsMenuOpen || subtitlesMenuOpen || audioMenuOpen || speedMenuOpen || statisticsMenuOpen || castDevicesMenuOpen || sideDrawerOpen || nextVideoPopupOpen;
    }, [optionsMenuOpen, subtitlesMenuOpen, audioMenuOpen, speedMenuOpen, statisticsMenuOpen, castDevicesMenuOpen, sideDrawerOpen, nextVideoPopupOpen]);

    const closeMenus = React.useCallback(() => {
        closeOptionsMenu();
        closeSubtitlesMenu();
        closeAudioMenu();
        closeSpeedMenu();
        closeStatisticsMenu();
        closeCastDevicesMenu();
        closeSideDrawer();
    }, []);

    const castDevices = React.useMemo(() => {
        return playbackDevices
            .filter(({ type }) => type === 'chromecast' || type === 'tv')
            .sort((a, b) => a.type === b.type ? 0 : a.type === 'chromecast' ? -1 : 1);
    }, [playbackDevices]);
    const [castDevicesSearching, setCastDevicesSearching] = React.useState(false);
    const castDevicesLoading = platform.shell.active && (castDevicesSearching || (streamingServer.playbackDevices !== null && streamingServer.playbackDevices.type === 'Loading'));
    const { streamingUrl: castStreamingUrl } = usePlayOnDevice(player.selected?.stream ?? null);
    const shellCastSupported = platform.shell.active && castStreamingUrl !== null;
    const refreshCastDevices = React.useCallback(() => {
        if (platform.shell.active) {
            core.transport.dispatch({
                action: 'StreamingServer',
                args: {
                    action: 'RefreshPlaybackDevices',
                }
            });
        }
    }, [platform.shell.active]);
    React.useEffect(() => {
        if (castDevicesMenuOpen && platform.shell.active) {
            setCastDevicesSearching(true);
            refreshCastDevices();
            const interval = setInterval(refreshCastDevices, CAST_DEVICES_REFRESH_INTERVAL);
            const timeout = setTimeout(() => setCastDevicesSearching(false), CAST_DEVICES_REFRESH_INTERVAL);
            return () => {
                clearInterval(interval);
                clearTimeout(timeout);
                setCastDevicesSearching(false);
            };
        }
    }, [castDevicesMenuOpen, refreshCastDevices]);

    const onAudioTrackSelected = useAudio({
        player,
        video,
        settings,
        streamStateChanged,
        audioPreferenceChanged,
    });

    const {
        streamSubtitles,
        allSubtitleTracks,
        extraSubtitleTracks,
        selectedExtraSubtitleTrackId,
        subtitlesMenuProps,
    } = useSubtitles({
        player,
        video,
        settings,
        streamStateChanged,
        subtitlePreferenceChanged,
        menusOpen,
        closeMenus,
        closeSubtitlesMenu,
        toggleSubtitlesMenu,
    });

    const playingOnExternalDevice = React.useRef(false);
    const { castToDevice, stopBeforeLocalPlay, isCasting } = useCastDevice(castStreamingUrl, streamingServer.casting, video, playingOnExternalDevice);
    const onCastDeviceSelected = (deviceId) => {
        castToDevice(deviceId);
        closeCastDevicesMenu();
    };
    const requestedVideoScale = React.useRef(null);
    const persistedVideoScale = React.useRef({ stream: null, scale: null });
    const [error, setError] = React.useState(null);

    const VIDEO_SCALES = ['contain', 'cover', 'fill'];
    const VIDEO_SCALE_LABELS = { contain: t('PLAYER_SCALE_FIT'), cover: t('PLAYER_SCALE_CROP'), fill: t('PLAYER_SCALE_STRETCH') };

    const {
        start: startPlaybackSpeedHold,
        finish: finishPlaybackSpeedHold,
        cancel: cancelPlaybackSpeedHold,
        isActive: isPlaybackSpeedHoldActive,
        consumeClick: consumePlaybackSpeedHoldClick,
    } = usePlaybackSpeedHold(routeFocused && !menusOpen, video.state.stream, video.state.playbackSpeed, video.setPlaybackSpeed);
    const detailsHold = React.useRef(null);
    const controlBarRef = React.useRef(null);

    const HOLD_DELAY = 400;

    const handleNextVideoNavigation = React.useCallback((deepLinks, bingeWatching, ended) => {
        if (ended) {
            if (bingeWatching) {
                if (deepLinks.player) {
                    navigate(toPath(deepLinks.player), { replace: true });
                } else if (deepLinks.metaDetailsStreams) {
                    navigate(toPath(deepLinks.metaDetailsStreams), { replace: true });
                }
            } else {
                goBack();
            }

        } else {
            if (deepLinks.player) {
                navigate(toPath(deepLinks.player), { replace: true });
            } else if (deepLinks.metaDetailsStreams) {
                navigate(toPath(deepLinks.metaDetailsStreams), { replace: true });
            }
        }
    }, [navigate, goBack]);

    const onEnded = React.useCallback(() => {
        ended();

        if (isEpg) {
            return;
        }

        if (player.nextVideo !== null) {
            nextVideo();

            const deepLinks = player.nextVideo.deepLinks;
            handleNextVideoNavigation(deepLinks, profile.settings.bingeWatching, true);
        } else {
            goBack();
        }
    }, [isEpg, player.nextVideo, profile.settings.bingeWatching, handleNextVideoNavigation, ended, nextVideo, goBack]);

    const onError = React.useCallback((error) => {
        console.error('Player', error);
        if (error.critical) {
            setError(error);
        } else {
            toast.show({
                type: 'error',
                title: t('ERROR'),
                message: error.message,
                timeout: 3000
            });
        }
    }, []);

    const onPlayRequested = React.useCallback(() => {
        setSeeking(false);
        if (stopBeforeLocalPlay()) return;
        playingOnExternalDevice.current = false;
        video.setPaused(false);
    }, []);

    const onPlayRequestedDebounced = React.useCallback(debounce(onPlayRequested, 200), []);

    const onPauseRequested = React.useCallback(() => {
        video.setPaused(true);
    }, []);

    const onPauseRequestedDebounced = React.useCallback(debounce(onPauseRequested, 200), []);
    const onMuteRequested = React.useCallback(() => {
        video.setMuted(true);
    }, []);

    const onUnmuteRequested = React.useCallback(() => {
        video.setMuted(false);
    }, []);

    const onVolumeChangeRequested = React.useCallback((volume) => {
        video.setVolume(volume);
    }, []);

    const commitSeek = React.useCallback((time) => {
        if (!canSeek) {
            return;
        }
        const target = Math.max(seekStart, Math.min(seekEnd, time));
        video.setTime(target);
        seek(target, video.state.duration, video.state.manifest?.name);
    }, [canSeek, seekStart, seekEnd, video.state.duration, video.state.manifest]);
    const {
        time: keyboardSeekTime,
        seekBy: seekByKeyboard,
        seekTo: onSeekRequested,
        cancel: cancelKeyboardSeek,
        flush: flushKeyboardSeek,
        release: releaseKeyboardSeek,
    } = useKeyboardSeek({
        time: video.state.time,
        duration: seekEnd,
        minimum: seekStart,
        onSeek: commitSeek,
        setSeeking,
    });
    const onKeyboardSeekRequested = React.useCallback((offset) => {
        if (!canSeek) {
            return;
        }
        setImmersedDebounced.cancel();
        setImmersed(false);
        seekByKeyboard(offset);
    }, [canSeek, seekByKeyboard]);
    const overlayHidden = React.useMemo(() => {
        return keyboardSeekTime === null && immersed && !casting && video.state.paused !== null && !video.state.paused && !menusOpen;
    }, [keyboardSeekTime, immersed, casting, video.state.paused, menusOpen]);

    React.useEffect(() => {
        if (!video.state.manifest?.props.includes('subtitlesOffsetMinimum')) {
            return;
        }

        const videoContainerElement = video.containerRef.current;
        const controlBarElement = controlBarRef.current;
        if (!videoContainerElement || !controlBarElement) {
            return;
        }

        const updateSubtitlesOffsetMinimum = () => {
            const videoHeight = videoContainerElement.getBoundingClientRect().height;
            const controlBarHeight = overlayHidden ? 0 : controlBarElement.getBoundingClientRect().height;
            const offsetMinimum = videoHeight > 0 ? Math.ceil(controlBarHeight / videoHeight * 100) : 0;
            video.setSubtitlesOffsetMinimum(offsetMinimum);
        };

        updateSubtitlesOffsetMinimum();

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', updateSubtitlesOffsetMinimum);
            return () => window.removeEventListener('resize', updateSubtitlesOffsetMinimum);
        }

        const resizeObserver = new ResizeObserver(updateSubtitlesOffsetMinimum);
        resizeObserver.observe(videoContainerElement);
        resizeObserver.observe(controlBarElement);
        return () => resizeObserver.disconnect();
    }, [overlayHidden, video.state.manifest, video.setSubtitlesOffsetMinimum]);

    const onPlaybackSpeedChanged = video.setPlaybackSpeed;

    const onVideoScaleChanged = React.useCallback(() => {
        const currentScale = video.state.videoScale || 'contain';
        const currentIndex = VIDEO_SCALES.indexOf(currentScale);
        const nextScale = VIDEO_SCALES[(currentIndex + 1) % VIDEO_SCALES.length];
        requestedVideoScale.current = nextScale;
        persistedVideoScale.current = { stream: video.state.stream, scale: nextScale };
        video.setVideoScale(nextScale);
        if (player.videoScale !== undefined) {
            videoScaleChanged(nextScale);
        }
        streamStateChanged({ videoScale: nextScale });
    }, [player.videoScale, video.state.stream, video.state.videoScale, streamStateChanged, videoScaleChanged]);

    const onDismissNextVideoPopup = React.useCallback(() => {
        setNextVideoPopupDismissal({ stream: video.state.stream, programId: currentEpgVideo?.id });
    }, [video.state.stream, currentEpgVideo?.id]);

    const onNextVideoRequested = React.useCallback(() => {
        if (isEpg) {
            return;
        }

        if (player.nextVideo !== null) {
            cancelKeyboardSeek();
            nextVideo();

            const deepLinks = player.nextVideo.deepLinks;
            handleNextVideoNavigation(deepLinks, profile.settings.bingeWatching, false);
        }
    }, [player.nextVideo, isEpg, handleNextVideoNavigation, profile.settings, cancelKeyboardSeek, nextVideo]);

    const seasonEpisodes = React.useMemo(() => {
        if (isEpg || player.seriesInfo === null || !Array.isArray(metaItemContent?.videos)) {
            return [];
        }
        return metaItemContent.videos
            .filter((item) => item.season === player.seriesInfo.season)
            .sort((left, right) => (left.episode || 0) - (right.episode || 0));
    }, [isEpg, metaItemContent?.videos, player.seriesInfo]);

    const selectedEpisodeId = player.selected?.streamRequest?.path?.id || videoId || '';
    const selectedEpisodeIndex = seasonEpisodes.findIndex((item) => item.id === selectedEpisodeId);
    const previousEpisode = selectedEpisodeIndex > 0 ? seasonEpisodes[selectedEpisodeIndex - 1] : null;

    const onEpisodeRequested = React.useCallback(async (episode) => {
        if (!episode || episode.id === selectedEpisodeId) return;
        cancelKeyboardSeek();

        const streamRequest = player.selected?.streamRequest;
        const metaRequest = player.selected?.metaRequest;
        const currentStream = player.selected?.stream;
        const currentStreamsUrl = addonResourceUrl(streamRequest, selectedEpisodeId);
        const targetStreamsUrl = addonResourceUrl(streamRequest, episode.id);

        if (currentStream && streamRequest && metaRequest && targetStreamsUrl) {
            try {
                const [currentResponse, targetResponse] = await Promise.all([
                    currentStreamsUrl ? fetch(currentStreamsUrl) : Promise.resolve(null),
                    fetch(targetStreamsUrl),
                ]);
                const currentPayload = currentResponse?.ok ? await currentResponse.json() : { streams: [] };
                const targetPayload = targetResponse.ok ? await targetResponse.json() : { streams: [] };
                const coherentStream = selectCoherentStream(currentStream, currentPayload.streams, targetPayload.streams);
                if (coherentStream) {
                    const encodedStream = await core.transport.encodeStream(coherentStream);
                    const playerPath = [
                        '/player',
                        encodeURIComponent(encodedStream),
                        encodeURIComponent(streamRequest.base),
                        encodeURIComponent(metaRequest.base),
                        encodeURIComponent(streamRequest.path.type),
                        encodeURIComponent(metaRequest.path.id),
                        encodeURIComponent(episode.id),
                    ].join('/');
                    navigate(playerPath, { replace: true });
                    return;
                }
            } catch (error) {
                console.warn('Remote episode stream matching failed', error);
            }
        }

        if (episode.deepLinks?.player) {
            navigate(toPath(episode.deepLinks.player), { replace: true });
        } else if (episode.deepLinks?.metaDetailsStreams) {
            navigate(toPath(episode.deepLinks.metaDetailsStreams), { replace: true });
        }
    }, [cancelKeyboardSeek, core.transport, navigate, player.selected, selectedEpisodeId]);

    const onPreviousVideoRequested = React.useCallback(() => {
        onEpisodeRequested(previousEpisode);
    }, [onEpisodeRequested, previousEpisode]);

    const onVideoClick = React.useCallback(() => {
        if (video.state.paused !== null && !consumePlaybackSpeedHoldClick()) {
            if (video.state.paused) {
                onPlayRequestedDebounced();
            } else {
                onPauseRequestedDebounced();
            }
        }
    }, [video.state.paused, consumePlaybackSpeedHoldClick, onPlayRequestedDebounced, onPauseRequestedDebounced]);

    const onVideoDoubleClick = React.useCallback(() => {
        onPlayRequestedDebounced.cancel();
        onPauseRequestedDebounced.cancel();
        toggleFullscreen();
    }, [toggleFullscreen]);

    const onContainerMouseDown = React.useCallback((event) => {
        if (!event.nativeEvent.optionsMenuClosePrevented) {
            closeOptionsMenu();
        }
        if (!event.nativeEvent.subtitlesMenuClosePrevented) {
            closeSubtitlesMenu();
        }
        if (!event.nativeEvent.audioMenuClosePrevented) {
            closeAudioMenu();
        }
        if (!event.nativeEvent.speedMenuClosePrevented) {
            closeSpeedMenu();
        }
        if (!event.nativeEvent.statisticsMenuClosePrevented) {
            closeStatisticsMenu();
        }
        if (!event.nativeEvent.castDevicesMenuClosePrevented) {
            closeCastDevicesMenu();
        }

        closeSideDrawer();
    }, []);

    const onContainerMouseMove = React.useCallback((event) => {
        setImmersed(false);
        if (!event.nativeEvent.immersePrevented) {
            setImmersedDebounced(true);
        } else {
            setImmersedDebounced.cancel();
        }
    }, []);

    const onContainerMouseLeave = React.useCallback(() => {
        setImmersedDebounced.cancel();
        setImmersed(true);
    }, []);

    const onBarMouseMove = React.useCallback((event) => {
        event.nativeEvent.immersePrevented = true;
    }, []);

    const onPlayPause = React.useCallback(() => {
        if (!menusOpen && !nextVideoPopupOpen && video.state.paused !== null) {
            if (video.state.paused) {
                onPlayRequested();
                setSeeking(false);
            } else {
                onPauseRequested();
            }
        }
    }, [menusOpen, nextVideoPopupOpen, video.state.paused]);

    const onSeekPrev = React.useCallback((event) => {
        if (canSeek && !menusOpen && !nextVideoPopupOpen && video.state.time !== null) {
            const seekDuration = event?.shiftKey ? settings.seekShortTimeDuration : settings.seekTimeDuration;
            const seekTime = video.state.time - seekDuration;
            setSeeking(true);
            onSeekRequested(Math.max(seekTime, 0));
        }
    }, [canSeek, menusOpen, nextVideoPopupOpen, video.state.time]);

    const onSeekNext = React.useCallback((event) => {
        if (canSeek && !menusOpen && !nextVideoPopupOpen && video.state.time !== null) {
            const seekDuration = event?.shiftKey ? settings.seekShortTimeDuration : settings.seekTimeDuration;
            setSeeking(true);
            onSeekRequested(video.state.time + seekDuration);
        }
    }, [canSeek, menusOpen, nextVideoPopupOpen, video.state.time]);

    const onVolumeUp = React.useCallback(() => {
        if (!menusOpen && !nextVideoPopupOpen && video.state.volume !== null) {
            onVolumeChangeRequested(Math.min(video.state.volume + 5, 200));
        }
    }, [menusOpen, nextVideoPopupOpen, video.state.volume]);

    const onVolumeDown = React.useCallback(() => {
        if (!menusOpen && !nextVideoPopupOpen && video.state.volume !== null) {
            onVolumeChangeRequested(Math.max(video.state.volume - 5, 0));
        }
    }, [menusOpen, nextVideoPopupOpen, video.state.volume]);

    const onGamepadSeekAndVol = React.useCallback((axis) => {
        switch(axis) {
            case 'left': {
                onSeekPrev();
                break;
            }
            case 'right': {
                onSeekNext();
                break;
            }
            case 'up': {
                onVolumeUp();
                break;
            }
            case 'down': {
                onVolumeDown();
                break;
            }
        }
    }, [onSeekPrev, onSeekNext, onVolumeUp, onVolumeDown]);

    const remoteSubtitleTracks = React.useMemo(() => {
        const embedded = (subtitlesMenuProps.subtitlesTracks || [])
            .map((track, index) => remoteSubtitleTrack(track, 'embedded', index, profile.addons));
        const external = (subtitlesMenuProps.extraSubtitlesTracks || [])
            .map((track, index) => remoteSubtitleTrack(track, 'external', index, profile.addons));
        return embedded.concat(external)
            .map((track, index) => ({ ...track, originalIndex: index }))
            .sort((left, right) => {
                const priority = (track) => {
                    if (track.source === 'embedded' && track.languageCode === 'pt') return 0;
                    if (track.source === 'embedded' && track.languageCode === 'en') return 1;
                    if (track.source === 'external' && track.languageCode === 'pt') return 2;
                    if (track.source === 'external' && track.languageCode === 'en') return 3;
                    return track.source === 'embedded' ? 4 : 5;
                };
                return priority(left) - priority(right) || left.originalIndex - right.originalIndex;
            })
            .map((track) => ({ key: track.key, label: track.label }));
    }, [profile.addons, subtitlesMenuProps.subtitlesTracks, subtitlesMenuProps.extraSubtitlesTracks]);

    const remoteAudioTracks = React.useMemo(() => {
        return (video.state.audioTracks || []).map((track, index) => {
            const locale = subtitleLocale(track);
            return {
                key: String(track.id),
                label: `${locale.language} — ${locale.country} · Track ${index + 1}`,
            };
        });
    }, [video.state.audioTracks]);

    const remoteEpisodes = React.useMemo(() => {
        return seasonEpisodes.map((episode) => ({
            key: String(episode.id),
            label: `S${episode.season || player.seriesInfo?.season || 0}:E${episode.episode || '?'} — ${episode.title || `Episode ${episode.episode || '?'}`}`,
            title: episode.title || `Episode ${episode.episode || '?'}`,
            season: episode.season || player.seriesInfo?.season || 0,
            episode: episode.episode || null,
            thumbnail: episode.thumbnail || '',
            overview: episode.overview || '',
        }));
    }, [seasonEpisodes, player.seriesInfo?.season]);

    const selectedRemoteSubtitleKey = subtitlesMenuProps.selectedSubtitlesTrackId ?
        `embedded:${subtitlesMenuProps.selectedSubtitlesTrackId}`
        :
        subtitlesMenuProps.selectedExtraSubtitlesTrackId ?
            `external:${subtitlesMenuProps.selectedExtraSubtitlesTrackId}`
            :
            '';

    const remoteState = React.useMemo(() => ({
        title: player.title || metaItemContent?.name || '',
        paused: video.state.paused,
        time: video.state.time,
        duration: video.state.duration,
        clockUnit: 'milliseconds',
        volume: video.state.volume,
        muted: video.state.muted,
        canSeek,
        hasNext: !isEpg && player.nextVideo !== null,
        hasPrevious: previousEpisode !== null,
        fullscreen,
        subtitleTracks: remoteSubtitleTracks,
        selectedSubtitleKey: selectedRemoteSubtitleKey,
        audioTracks: remoteAudioTracks,
        selectedAudioTrackKey: video.state.selectedAudioTrackId === null ? '' : String(video.state.selectedAudioTrackId),
        episodes: remoteEpisodes,
        selectedEpisodeKey: selectedEpisodeId,
    }), [
        player.title,
        player.nextVideo,
        previousEpisode,
        metaItemContent?.name,
        video.state.paused,
        video.state.time,
        video.state.duration,
        video.state.volume,
        video.state.muted,
        canSeek,
        isEpg,
        fullscreen,
        remoteSubtitleTracks,
        selectedRemoteSubtitleKey,
        remoteAudioTracks,
        video.state.selectedAudioTrackId,
        remoteEpisodes,
        selectedEpisodeId,
    ]);

    const onRemoteCommand = React.useCallback((message) => {
        switch (message.command) {
            case 'play_pause':
                onPlayPause();
                break;
            case 'play':
                onPlayRequested();
                break;
            case 'pause':
                onPauseRequested();
                break;
            case 'seek_by':
                if (canSeek && Number.isFinite(video.state.time)) {
                    commitSeek(video.state.time + (message.seconds * 1000));
                }
                break;
            case 'seek_to':
                commitSeek(message.seconds * 1000);
                break;
            case 'next':
                onNextVideoRequested();
                break;
            case 'previous':
                onPreviousVideoRequested();
                break;
            case 'volume_by':
                if (Number.isFinite(video.state.volume)) {
                    onVolumeChangeRequested(Math.max(0, Math.min(200, video.state.volume + message.amount)));
                }
                break;
            case 'volume_set':
                onVolumeChangeRequested(message.volume);
                break;
            case 'mute':
                video.state.muted ? onUnmuteRequested() : onMuteRequested();
                break;
            case 'fullscreen':
                toggleFullscreen();
                break;
            case 'subtitle_select': {
                const separator = message.key.indexOf(':');
                const source = separator === -1 ? '' : message.key.slice(0, separator);
                const id = separator === -1 ? '' : message.key.slice(separator + 1);
                if (!source) {
                    subtitlesMenuProps.onSubtitlesTrackSelected(null);
                } else if (source === 'embedded') {
                    const track = subtitlesMenuProps.subtitlesTracks.find((item) => String(item.id) === id);
                    if (track) subtitlesMenuProps.onSubtitlesTrackSelected(track);
                } else if (source === 'external') {
                    const track = subtitlesMenuProps.extraSubtitlesTracks.find((item) => String(item.id) === id);
                    if (track) subtitlesMenuProps.onExtraSubtitlesTrackSelected(track);
                }
                break;
            }
            case 'audio_select': {
                const track = video.state.audioTracks.find((item) => String(item.id) === message.key);
                if (track) onAudioTrackSelected(track.id);
                break;
            }
            case 'episode_select': {
                const episode = seasonEpisodes.find((item) => String(item.id) === message.key);
                if (episode) onEpisodeRequested(episode);
                break;
            }
        }
    }, [
        onPlayPause,
        onPlayRequested,
        onPauseRequested,
        canSeek,
        video.state.time,
        video.state.volume,
        video.state.muted,
        commitSeek,
        onNextVideoRequested,
        onPreviousVideoRequested,
        onVolumeChangeRequested,
        onUnmuteRequested,
        onMuteRequested,
        toggleFullscreen,
        subtitlesMenuProps,
        video.state.audioTracks,
        onAudioTrackSelected,
        seasonEpisodes,
        onEpisodeRequested,
    ]);

    useRemoteControl(remoteState, onRemoteCommand);

    useContentGamepadNavigation(playerRef, GAMEPAD_HANDLER_ID);

    React.useEffect(() => {
        gamepad?.on('buttonX', GAMEPAD_HANDLER_ID, onPlayPause);
        gamepad?.on('analogRight', GAMEPAD_HANDLER_ID, onGamepadSeekAndVol);

        return () => {
            gamepad?.off('buttonX', GAMEPAD_HANDLER_ID);
            gamepad?.off('analogRight', GAMEPAD_HANDLER_ID);
        };
    }, [onPlayPause, onGamepadSeekAndVol]);

    React.useEffect(() => {
        setError(null);
        cancelKeyboardSeek();
        video.unload();

        if (player.selected && player.stream?.type === 'Ready' && streamingServer.settings?.type !== 'Loading') {
            video.load({
                stream: {
                    ...player.stream.content,
                    subtitles: streamSubtitles
                },
                autoplay: true,
                time: !isEpg && player.libraryItem !== null &&
                    player.selected.streamRequest !== null &&
                    player.selected.streamRequest.path !== null &&
                    player.libraryItem.state.video_id === player.selected.streamRequest.path.id ?
                    player.libraryItem.state.timeOffset
                    :
                    0,
                forceTranscoding: forceTranscoding || casting,
                maxAudioChannels: settings.surroundSound ? 32 : 2,
                hardwareDecoding: settings.hardwareDecoding,
                assSubtitlesStyling: settings.assSubtitlesStyling,
                gpuVideoProcessing: settings.gpuVideoProcessing && platform.shell.capabilities.gpuVideoProcessing,
                videoMode: settings.videoMode,
                platform: platform.name,
                streamingServerURL: streamingServer.baseUrl ?
                    casting ?
                        streamingServer.baseUrl
                        :
                        streamingServer.selected.transportUrl
                    :
                    null,
                seriesInfo: player.seriesInfo,
            }, {
                chromecastTransport: services.chromecast.active ? services.chromecast.transport : null,
                shellTransport: platform.shell.active ? platform.shell : null,
            });
        }
    }, [streamingServer.baseUrl, player.selected, player.stream, streamSubtitles, forceTranscoding, casting, cancelKeyboardSeek]);

    React.useEffect(() => {
        !seeking && timeChanged(video.state.time, video.state.duration, video.state.manifest?.name);
    }, [video.state.time, video.state.duration, video.state.manifest, seeking]);

    React.useEffect(() => {
        if (playingOnExternalDevice.current && video.state.paused === false) {
            onPauseRequested();
        } else if (video.state.paused !== null) {
            pausedChanged(video.state.paused);
        }
    }, [video.state.paused]);

    React.useEffect(() => {
        videoParamsChanged(video.state.videoParams);
    }, [video.state.videoParams]);

    React.useEffect(() => {
        if (!isCasting()) playingOnExternalDevice.current = false;
    }, [video.state.stream, isCasting]);

    React.useEffect(() => {
        if (requestedVideoScale.current === player.videoScale) {
            requestedVideoScale.current = null;
        }
        if (player.selected === null) {
            requestedVideoScale.current = null;
            persistedVideoScale.current = { stream: null, scale: null };
            return;
        }
        if (!video.state.manifest?.props.includes('videoScale') || video.state.stream === null) {
            return;
        }
        if (persistedVideoScale.current.stream !== video.state.stream) {
            persistedVideoScale.current = { stream: video.state.stream, scale: null };
        }

        const sessionScale = requestedVideoScale.current ?? player.videoScale;
        const scale = sessionScale ?? player.streamState?.videoScale ?? 'contain';

        if (video.state.videoScale !== scale) {
            video.setVideoScale(scale);
        }
        if (sessionScale &&
            player.streamState?.videoScale !== sessionScale &&
            persistedVideoScale.current.scale !== sessionScale) {
            persistedVideoScale.current.scale = sessionScale;
            streamStateChanged({ videoScale: sessionScale });
        }
    }, [player.selected, player.streamState?.videoScale, player.videoScale, video.state.manifest, video.state.stream, video.state.videoScale, streamStateChanged]);

    React.useEffect(() => {
        if (!Array.isArray(video.state.audioTracks) || video.state.audioTracks.length === 0) {
            closeAudioMenu();
        }
    }, [video.state.audioTracks]);

    React.useEffect(() => {
        if (video.state.playbackSpeed === null) {
            closeSpeedMenu();
        }
    }, [video.state.playbackSpeed]);

    React.useEffect(() => {
        const toastFilter = (item) => item?.dataset?.type === 'CoreEvent';
        toast.addFilter(toastFilter);
        const onCastStateChange = () => {
            setCasting(services.chromecast.active && services.chromecast.transport.getCastState() === cast.framework.CastState.CONNECTED);
        };
        const onChromecastServiceStateChange = () => {
            onCastStateChange();
            if (services.chromecast.active) {
                services.chromecast.transport.on(
                    cast.framework.CastContextEventType.CAST_STATE_CHANGED,
                    onCastStateChange
                );
            }
        };
        const onCoreEvent = (name) => {
            if (name === 'PlayingOnDevice') {
                playingOnExternalDevice.current = true;
                onPauseRequested();
            }
        };
        services.chromecast.on('stateChanged', onChromecastServiceStateChange);
        core.on('event', onCoreEvent);
        onChromecastServiceStateChange();
        return () => {
            toast.removeFilter(toastFilter);
            services.chromecast.off('stateChanged', onChromecastServiceStateChange);
            core.off('event', onCoreEvent);
            if (services.chromecast.active) {
                services.chromecast.transport.off(
                    cast.framework.CastContextEventType.CAST_STATE_CHANGED,
                    onCastStateChange
                );
            }
        };
    }, []);

    React.useEffect(() => {
        if (settings.pauseOnMinimize && (platform.shell.state.windowClosed || platform.shell.state.windowHidden)) {
            onPauseRequested();
        }
    }, [settings.pauseOnMinimize, platform.shell.state.windowClosed, platform.shell.state.windowHidden]);

    React.useEffect(() => {
        if (video.state.stream === null || typeof player?.title !== 'string') {
            discordTimestamps.current = EMPTY_DISCORD_TIMESTAMPS;
            discord.setActivity(null);
            return;
        }

        const { activity, timestamps } = getPlaybackDiscordActivity({
            title: player.title,
            image: metaItemContent?.poster || metaItemContent?.background || null,
            paused: video.state.paused,
            time: video.state.time,
            duration: video.state.duration,
            timestamps: discordTimestamps.current,
        });

        discordTimestamps.current = timestamps;
        discord.setActivity(activity);
    }, [discord.setActivity, player?.title, metaItemContent, video.state.duration, video.state.paused, video.state.stream, video.state.time]);

    React.useEffect(() => {
        return () => {
            discord.setActivity(null);
        };
    }, [discord.setActivity]);

    useMediaSession(video.state, player, fullscreen, onPlayRequested, onPauseRequested, onNextVideoRequested);

    React.useEffect(() => {
        const onMediaKey = (action) => {
            switch (action) {
                case 'play-pause':
                    if (video.state.paused !== null) {
                        video.state.paused ? onPlayRequested() : onPauseRequested();
                    }
                    break;
                case 'play':
                    onPlayRequested();
                    break;
                case 'pause':
                    onPauseRequested();
                    break;
                case 'next-track':
                    if (!isEpg && player.nextVideo !== null) {
                        video.setTime(0);
                        onNextVideoRequested();
                    }
                    break;
            }
        };
        platform.shell.on('media-key', onMediaKey);
        return () => platform.shell.off('media-key', onMediaKey);
    }, [isEpg, video.state.paused, player.nextVideo, onPlayRequested, onPauseRequested, onNextVideoRequested]);

    useShortcut('seekForward', React.useCallback((combo) => {
        const seekDuration = combo === 1 ? settings.seekShortTimeDuration : settings.seekTimeDuration;
        onKeyboardSeekRequested(seekDuration);
    }, [settings.seekShortTimeDuration, settings.seekTimeDuration, onKeyboardSeekRequested]), !menusOpen && canSeek);

    useShortcut('seekBackward', React.useCallback((combo) => {
        const seekDuration = combo === 1 ? settings.seekShortTimeDuration : settings.seekTimeDuration;
        onKeyboardSeekRequested(-seekDuration);
    }, [settings.seekShortTimeDuration, settings.seekTimeDuration, onKeyboardSeekRequested]), !menusOpen && canSeek);

    useShortcut('mute', React.useCallback(() => {
        video.state.muted === true ? onUnmuteRequested() : onMuteRequested();
    }, [onMuteRequested, onUnmuteRequested, video.state.muted]), !menusOpen);

    useShortcut('volume', React.useCallback((combo) => {
        if (video.state.volume !== null) {
            const volume = combo === 0 ? Math.min(video.state.volume + 5, 200) : Math.max(video.state.volume - 5, 0);
            onVolumeChangeRequested(volume);
        }
    }, [onVolumeChangeRequested, video.state.volume]), !menusOpen);

    useShortcut('audioMenu', React.useCallback(() => {
        closeMenus();
        if (video.state?.audioTracks?.length > 0) {
            toggleAudioMenu();
        }
    }, [closeMenus, video.state?.audioTracks?.length, toggleAudioMenu]));

    useShortcut('infoMenu', React.useCallback(() => {
        closeMenus();
        if (player.metaItem?.type === 'Ready') {
            toggleSideDrawer();
        }
    }, [closeMenus, player.metaItem?.type, toggleSideDrawer]));

    useShortcut('speedMenu', React.useCallback(() => {
        closeMenus();
        if (video.state.playbackSpeed !== null) {
            toggleSpeedMenu();
        }
    }, [closeMenus, video.state.playbackSpeed, toggleSpeedMenu]));

    useShortcut('speed', React.useCallback((combo) => {
        if (video.state.playbackSpeed !== null) {
            const speed = combo === 0 ? Math.max(video.state.playbackSpeed - 0.25, 0.25) : Math.min(video.state.playbackSpeed + 0.25, 2);
            onPlaybackSpeedChanged(speed);
        }
    }, [video.state.playbackSpeed, onPlaybackSpeedChanged]), !menusOpen);

    useShortcut('videoScale', onVideoScaleChanged, !menusOpen && video.state.videoScale !== null);

    const selectedStream = player.selected?.stream;
    const statisticsMenuAvailable = streamingServer?.statistics?.type !== 'Err'
        && typeof selectedStream?.infoHash === 'string';

    const finishDetailsHold = React.useCallback(() => {
        const hold = detailsHold.current;
        if (hold === null) return null;

        detailsHold.current = null;
        if (hold.phase === 'pending') {
            clearTimeout(hold.timer);
        } else {
            closeStatisticsMenu();
        }
        return hold.phase;
    }, [closeStatisticsMenu]);

    const releaseDetailsHold = React.useCallback(() => {
        if (finishDetailsHold() !== 'pending') return;

        closeMenus();
        if (statisticsMenuAvailable) {
            toggleStatisticsMenu();
        }
    }, [finishDetailsHold, closeMenus, statisticsMenuAvailable, toggleStatisticsMenu]);

    useShortcut('statisticsMenu', React.useCallback(() => {
        if (detailsHold.current !== null || isPlaybackSpeedHoldActive()) return;

        const hold = { phase: 'pending', timer: null };
        hold.timer = setTimeout(() => {
            hold.phase = 'held';
            hold.timer = null;
            if (statisticsMenuAvailable) {
                closeMenus();
                openStatisticsMenu();
            }
        }, HOLD_DELAY);
        detailsHold.current = hold;
    }, [statisticsMenuAvailable, closeMenus, openStatisticsMenu, isPlaybackSpeedHoldActive]), routeFocused);

    useShortcut('playNext', React.useCallback(() => {
        closeMenus();
        if (!isEpg && player.nextVideo !== null) {
            nextVideo();
            const deepLinks = player.nextVideo.deepLinks;
            handleNextVideoNavigation(deepLinks, false, false);
        }
    }, [isEpg, closeMenus, player.nextVideo, nextVideo, handleNextVideoNavigation]));

    useShortcut('exit', React.useCallback(() => {
        closeMenus();
        // When escExitFullscreen is enabled, FullscreenProvider handles the first
        // Escape press by leaving fullscreen. Only skip navigating back in that case,
        // otherwise Escape would never exit the player in windowed mode.
        if (settings.escExitFullscreen && fullscreen) {
            return;
        }
        goBack();
    }, [closeMenus, settings.escExitFullscreen, fullscreen, goBack]));

    React.useLayoutEffect(() => {
        if (!routeFocused) {
            finishDetailsHold();
        }

        const onKeyDown = (e) => {
            const keyboardKey = getKeyboardShortcutKey(e);
            if (keyboardKey !== 'Space' || e.repeat) return;
            if (menusOpen || detailsHold.current !== null || e.ctrlKey || e.metaKey || e.altKey) return;

            startPlaybackSpeedHold('keyboard');
        };

        const onKeyUp = (e) => {
            const keyboardKeys = getKeyboardShortcutKeys(e);

            if (keyboardKeys.includes('KeyD') || keyboardKeys.includes('D')) {
                releaseDetailsHold();
                return;
            }

            if (!keyboardKeys.includes('Space') && !keyboardKeys.includes('ArrowRight') && !keyboardKeys.includes('ArrowLeft')) return;
            if (e.ctrlKey || e.metaKey || e.altKey) {
                if (keyboardKeys.includes('Space')) finishPlaybackSpeedHold('keyboard');
                return;
            }

            if (keyboardKeys.includes('ArrowRight') || keyboardKeys.includes('ArrowLeft')) {
                releaseKeyboardSeek();
                setImmersed(false);
                setImmersedDebounced(true);
                return;
            }
            if (keyboardKeys.includes('Space')) {
                const phase = finishPlaybackSpeedHold('keyboard');
                if (phase === 'pending' && !menusOpen && video.state.paused !== null) {
                    if (video.state.paused) {
                        onPlayRequested();
                        setSeeking(false);
                    } else {
                        onPauseRequested();
                    }
                }
            }
        };

        const onWheel = ({ deltaY }) => {
            if (menusOpen || video.state.volume === null) return;

            if (deltaY > 0) {
                onVolumeChangeRequested(Math.max(video.state.volume - 5, 0));
            } else {
                if (video.state.volume < 100) {
                    onVolumeChangeRequested(Math.min(video.state.volume + 5, 100));
                }
            }
        };

        const onMouseDownHold = (e) => {
            if (e.button !== 0) return; // left mouse button only
            if (menusOpen || detailsHold.current !== null) return;
            if (controlBarRef.current && controlBarRef.current.contains(e.target)) return;

            startPlaybackSpeedHold('pointer');
        };

        const onMouseUp = (e) => {
            if (e.button !== 0) return;

            finishPlaybackSpeedHold('pointer');
        };

        const onBlur = () => {
            cancelPlaybackSpeedHold();
            finishDetailsHold();
            flushKeyboardSeek();
            setImmersed(false);
            setImmersedDebounced(true);
        };

        if (routeFocused) {
            window.addEventListener('keyup', onKeyUp);
            window.addEventListener('keydown', onKeyDown);
            window.addEventListener('wheel', onWheel);
            window.addEventListener('mousedown', onMouseDownHold);
            window.addEventListener('mouseup', onMouseUp);
            window.addEventListener('blur', onBlur);
        } else {
            cancelKeyboardSeek();
        }
        return () => {
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('wheel', onWheel);
            window.removeEventListener('mousedown', onMouseDownHold);
            window.removeEventListener('mouseup', onMouseUp);
            window.removeEventListener('blur', onBlur);
        };
    }, [routeFocused, menusOpen, video.state.volume, video.state.paused, finishDetailsHold, releaseDetailsHold, cancelKeyboardSeek, flushKeyboardSeek, releaseKeyboardSeek, startPlaybackSpeedHold, finishPlaybackSpeedHold, cancelPlaybackSpeedHold]);

    React.useEffect(() => {
        video.events.on('error', onError);
        video.events.on('ended', onEnded);

        return () => {
            video.events.off('error', onError);
            video.events.off('ended', onEnded);
        };
    }, [onEnded]);

    React.useLayoutEffect(() => {
        return () => {
            clearTimeout(detailsHold.current?.timer);
            setImmersedDebounced.cancel();
            onPlayRequestedDebounced.cancel();
            onPauseRequestedDebounced.cancel();
        };
    }, []);

    return (
        <div ref={playerRef} className={classnames(styles['player-container'], { [styles['overlayHidden']]: overlayHidden })}
            onMouseDown={onContainerMouseDown}
            onMouseMove={onContainerMouseMove}
            onMouseOver={onContainerMouseMove}
            onMouseLeave={onContainerMouseLeave}>
            <Video
                ref={video.containerRef}
                className={styles['layer']}
                onClick={onVideoClick}
                onDoubleClick={onVideoDoubleClick}
            />
            {
                !video.state.loaded ?
                    <div className={classnames(styles['layer'], styles['background-layer'])}>
                        <img className={styles['image']} src={metaItemContent?.background} />
                    </div>
                    :
                    null
            }
            {
                (video.state.buffering || !video.state.loaded) && !error ?
                    <Buffering
                        ref={bufferingRef}
                        className={classnames(styles['layer'], styles['buffering-layer'])}
                        logo={metaItemContent?.logo}
                        progress={statistics.progress}
                    />
                    :
                    null
            }
            {
                error !== null ?
                    <Error
                        ref={errorRef}
                        className={classnames(styles['layer'], styles['error-layer'])}
                        stream={video.state.stream}
                        {...error}
                    />
                    :
                    null
            }
            {
                menusOpen ?
                    <div className={styles['layer']} />
                    :
                    null
            }
            {
                video.state.volume !== null && overlayHidden ?
                    <VolumeChangeIndicator
                        muted={video.state.muted}
                        volume={video.state.volume}
                    />
                    :
                    null
            }
            <ContextMenu on={[video.containerRef, bufferingRef, errorRef]} autoClose>
                <OptionsMenu
                    className={classnames(styles['layer'], styles['menu-layer'])}
                    stream={player?.selected?.stream}
                    playbackDevices={playbackDevices}
                    extraSubtitlesTracks={extraSubtitleTracks}
                    selectedExtraSubtitlesTrackId={selectedExtraSubtitleTrackId}
                />
            </ContextMenu>
            <HorizontalNavBar
                className={classnames(styles['layer'], styles['nav-bar-layer'])}
                title={player.title !== null ? player.title : ''}
                backButton={true}
                fullscreenButton={true}
                hdrInfo={video.state.hdrInfo}
                onMouseMove={onBarMouseMove}
                onMouseOver={onBarMouseMove}
            />
            {
                player.metaItem?.type === 'Ready' ?
                    <SideDrawerButton
                        className={classnames(styles['layer'], styles['side-drawer-button-layer'])}
                        onClick={toggleSideDrawer}
                    />
                    :
                    null
            }
            <ControlBar
                ref={controlBarRef}
                className={classnames(styles['layer'], styles['control-bar-layer'])}
                paused={video.state.paused}
                time={keyboardSeekTime ?? video.state.time}
                duration={video.state.duration}
                buffered={video.state.buffered}
                volume={video.state.volume}
                muted={video.state.muted}
                playbackSpeed={video.state.playbackSpeed}
                subtitlesTracks={allSubtitleTracks}
                audioTracks={video.state.audioTracks}
                metaItem={player.metaItem}
                nextVideo={isEpg ? null : player.nextVideo}
                stream={player.selected !== null ? player.selected.stream : null}
                statisticsAvailable={statisticsMenuAvailable}
                onPlayRequested={onPlayRequested}
                onPauseRequested={onPauseRequested}
                onNextVideoRequested={onNextVideoRequested}
                onMuteRequested={onMuteRequested}
                onUnmuteRequested={onUnmuteRequested}
                onVolumeChangeRequested={onVolumeChangeRequested}
                onSeekRequested={onSeekRequested}
                onToggleOptionsMenu={toggleOptionsMenu}
                shellCastSupported={shellCastSupported}
                onToggleCastDevicesMenu={toggleCastDevicesMenu}
                onToggleSubtitlesMenu={toggleSubtitlesMenu}
                onToggleAudioMenu={toggleAudioMenu}
                onToggleSpeedMenu={toggleSpeedMenu}
                videoScale={video.state.videoScale}
                videoScaleLabel={VIDEO_SCALE_LABELS[video.state.videoScale || 'contain']}
                live={livePlayback}
                liveTiming={video.state.live}
                seekable={canSeek}
                buffering={video.state.buffering || !video.state.loaded}
                onVideoScaleChanged={onVideoScaleChanged}
                onToggleStatisticsMenu={toggleStatisticsMenu}
                onToggleSideDrawer={toggleSideDrawer}
                onMouseMove={onBarMouseMove}
                onMouseOver={onBarMouseMove}
                onTouchEnd={onContainerMouseLeave}
            />
            <Indicator
                className={classnames(styles['layer'], styles['indicator-layer'])}
                videoState={video.state}
                disabled={subtitlesMenuOpen || speedMenuOpen}
            />
            {
                nextVideoPopupOpen ?
                    <NextVideoPopup
                        className={classnames(styles['layer'], styles['menu-layer'])}
                        metaItem={metaItemContent}
                        nextVideo={upcomingVideo}
                        isEpg={isEpg}
                        onDismiss={onDismissNextVideoPopup}
                        onNextVideoRequested={isEpg ? undefined : onNextVideoRequested}
                    />
                    :
                    null
            }
            <Transition when={statisticsMenuOpen} name={'fade'}>
                <StatisticsMenu
                    className={classnames(styles['layer'], styles['menu-layer'])}
                    {...statistics}
                />
            </Transition>
            <Transition when={castDevicesMenuOpen} name={'fade'}>
                <CastDevicesMenu
                    className={classnames(styles['layer'], styles['menu-layer'])}
                    devices={castDevices}
                    loading={castDevicesLoading}
                    onDeviceSelected={onCastDeviceSelected}
                />
            </Transition>
            <Transition when={sideDrawerOpen} name={'slide-left'}>
                <SideDrawer
                    className={classnames(styles['layer'], styles['side-drawer-layer'])}
                    metaItem={metaItemContent}
                    seriesInfo={player.seriesInfo}
                    isEpg={isEpg}
                    closeSideDrawer={closeSideDrawer}
                    selected={player.selected?.streamRequest?.path?.id}
                />
            </Transition>
            <Transition when={subtitlesMenuOpen} name={'fade'}>
                <SubtitlesMenu
                    className={classnames(styles['layer'], styles['menu-layer'])}
                    {...subtitlesMenuProps}
                />
            </Transition>
            <Transition when={audioMenuOpen} name={'fade'}>
                <AudioMenu
                    className={classnames(styles['layer'], styles['menu-layer'])}
                    audioTracks={video.state.audioTracks}
                    selectedAudioTrackId={video.state.selectedAudioTrackId}
                    onAudioTrackSelected={onAudioTrackSelected}
                />
            </Transition>
            <Transition when={speedMenuOpen} name={'fade'}>
                <SpeedMenu
                    className={classnames(styles['layer'], styles['menu-layer'])}
                    playbackSpeed={video.state.playbackSpeed}
                    onPlaybackSpeedChanged={onPlaybackSpeedChanged}
                />
            </Transition>
            <Transition when={optionsMenuOpen} name={'fade'}>
                <OptionsMenu
                    className={classnames(styles['layer'], styles['menu-layer'])}
                    stream={player.selected?.stream}
                    playbackDevices={playbackDevices}
                    extraSubtitlesTracks={extraSubtitleTracks}
                    selectedExtraSubtitlesTrackId={selectedExtraSubtitleTrackId}
                />
            </Transition>
        </div>
    );
};

const PlayerFallback = () => (
    <div className={classnames(styles['player-container'])} />
);

module.exports = withCoreSuspender(Player, PlayerFallback);
