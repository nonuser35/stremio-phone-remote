(() => {
    const pairing = document.querySelector('#pairing');
    const controller = document.querySelector('#controller');
    const pairForm = document.querySelector('#pair-form');
    const pinInput = document.querySelector('#pin');
    const pairError = document.querySelector('#pair-error');
    const connection = document.querySelector('#connection');
    const title = document.querySelector('#title');
    const timeline = document.querySelector('#timeline');
    const currentTime = document.querySelector('#current-time');
    const duration = document.querySelector('#duration');
    const playPause = document.querySelector('#play-pause');
    const next = document.querySelector('#next');
    const previous = document.querySelector('#previous');
    const episodePicker = document.querySelector('#episode-picker');
    const episodeList = document.querySelector('#episode-list');
    const episodeSummary = document.querySelector('#episode-summary');
    const mute = document.querySelector('#mute');
    const volume = document.querySelector('#volume');
    const volumeLabel = document.querySelector('#volume-label');
    const subtitles = document.querySelector('#subtitles');
    const audioTracks = document.querySelector('#audio-tracks');
    const refreshSubtitles = document.querySelector('#refresh-subtitles');
    const subtitleStatus = document.querySelector('#subtitle-status');
    const forget = document.querySelector('#forget');

    let socket = null;
    let reconnectTimer = null;
    let timelineSeekTimer = null;
    let lastTimelineSeekValue = null;
    let lastTimelineSeekAt = 0;
    let timelineDragging = false;
    let currentState = { connected: false };

    const tokenKey = 'stremio-remote-token';
    const MAX_MEDIA_SECONDS = 7 * 24 * 60 * 60;
    const normalizeClock = (state) => {
        let time = Number(state.time);
        let duration = Number(state.duration);
        if (!Number.isFinite(time)) time = 0;
        if (!Number.isFinite(duration) || duration <= 0) duration = 0;
        if (state.clockUnit === 'milliseconds' || (duration > MAX_MEDIA_SECONDS && duration / 1000 <= MAX_MEDIA_SECONDS)) {
            time /= 1000;
            duration /= 1000;
        }
        if (duration > MAX_MEDIA_SECONDS) duration = 0;
        return {
            time: Math.max(0, duration > 0 ? Math.min(time, duration) : time),
            duration,
        };
    };
    const formatTime = (seconds) => {
        const numeric = Number(seconds);
        if (!Number.isFinite(numeric) || numeric < 0 || numeric > MAX_MEDIA_SECONDS) return '--:--';
        const value = Math.floor(numeric);
        const hours = Math.floor(value / 3600);
        const minutes = Math.floor((value % 3600) / 60);
        const rest = value % 60;
        return hours > 0
            ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
            : `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
    };

    const setPaired = (paired) => {
        pairing.classList.toggle('hidden', paired);
        controller.classList.toggle('hidden', !paired);
        if (!paired) setTimeout(() => pinInput.focus(), 50);
    };

    const setConnection = (online, playerConnected = false) => {
        const ready = online && playerConnected;
        connection.textContent = ready ? 'Player connected' : online ? 'Waiting for Stremio' : 'Reconnecting…';
        connection.classList.toggle('offline', !ready);
        document.querySelectorAll('[data-command], #timeline, #volume, #subtitles, #audio-tracks, #refresh-subtitles').forEach((element) => {
            element.disabled = !ready;
        });
        next.disabled = !ready || !currentState.hasNext;
        previous.disabled = !ready || !currentState.hasPrevious;
        const episodesAvailable = ready && Array.isArray(currentState.episodes) && currentState.episodes.length > 0;
        episodePicker.classList.toggle('disabled', !episodesAvailable);
        episodePicker.setAttribute('aria-disabled', String(!episodesAvailable));
        if (!episodesAvailable) episodePicker.open = false;
    };

    const renderOptions = (select, tracks, selectedKey, emptyLabel) => {
        const options = Array.isArray(tracks) && tracks.length > 0 ? tracks : [{ key: '', label: emptyLabel }];
        const signature = JSON.stringify(options);
        if (select.dataset.signature !== signature) {
            select.replaceChildren(...options.map((track) => {
                const option = document.createElement('option');
                option.value = track.key;
                option.textContent = track.label;
                return option;
            }));
            select.dataset.signature = signature;
        }
        select.value = selectedKey || '';
    };

    const renderSubtitles = (state) => {
        const tracks = Array.isArray(state.subtitleTracks) ? state.subtitleTracks : [];
        const options = [{ key: '', label: 'Off' }, ...tracks];
        const signature = JSON.stringify(options);
        if (subtitles.dataset.signature !== signature) {
            subtitles.replaceChildren(...options.map((track) => {
                const option = document.createElement('option');
                option.value = track.key;
                option.textContent = track.label;
                return option;
            }));
            subtitles.dataset.signature = signature;
        }
        subtitles.value = state.selectedSubtitleKey || '';
        subtitleStatus.textContent = tracks.length > 0
            ? `${tracks.length} subtitle${tracks.length === 1 ? '' : 's'} available · list updates automatically`
            : 'No subtitles found yet. Wait for addons or tap Refresh list.';
    };

    const renderEpisodes = (state) => {
        const items = Array.isArray(state.episodes) ? state.episodes : [];
        const signature = JSON.stringify(items);
        if (episodeList.dataset.signature !== signature) {
            if (items.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'episode-empty';
                empty.textContent = 'No episode list available';
                episodeList.replaceChildren(empty);
            } else {
                episodeList.replaceChildren(...items.map((episode) => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'episode-item';
                    button.dataset.episodeKey = episode.key;

                    const artwork = document.createElement('span');
                    artwork.className = 'episode-artwork';
                    const fallback = document.createElement('span');
                    fallback.className = 'episode-artwork-fallback';
                    fallback.textContent = '▶';
                    artwork.append(fallback);
                    if (episode.thumbnail) {
                        const image = document.createElement('img');
                        image.src = episode.thumbnail;
                        image.alt = '';
                        image.loading = 'lazy';
                        image.addEventListener('load', () => fallback.classList.add('hidden'));
                        image.addEventListener('error', () => image.remove());
                        artwork.prepend(image);
                    }

                    const copy = document.createElement('span');
                    copy.className = 'episode-copy';
                    const number = document.createElement('small');
                    number.textContent = `SEASON ${episode.season || '?'} · EPISODE ${episode.episode || '?'}`;
                    const name = document.createElement('strong');
                    name.textContent = episode.title || episode.label;
                    copy.append(number, name);
                    if (episode.overview) {
                        const overview = document.createElement('span');
                        overview.className = 'episode-overview';
                        overview.textContent = episode.overview;
                        copy.append(overview);
                    }

                    const marker = document.createElement('span');
                    marker.className = 'episode-marker';
                    marker.textContent = '▶';
                    button.append(artwork, copy, marker);
                    return button;
                }));
            }
            episodeList.dataset.signature = signature;
        }

        episodeList.querySelectorAll('.episode-item').forEach((item) => {
            const selected = item.dataset.episodeKey === String(state.selectedEpisodeKey || '');
            item.classList.toggle('selected', selected);
            item.setAttribute('aria-current', selected ? 'true' : 'false');
        });
        episodeSummary.textContent = items.length > 0
            ? `${items.length} episode${items.length === 1 ? '' : 's'} · current season`
            : 'No episode list available';
    };

    const render = (state) => {
        currentState = state;
        setConnection(socket?.readyState === WebSocket.OPEN, state.connected === true);
        title.textContent = state.title || (state.connected ? 'Nothing is playing' : 'Open Stremio on the computer');
        playPause.textContent = state.paused === false ? '❚❚' : '▶';
        mute.textContent = state.muted ? '🔇' : '🔊';
        next.disabled = !state.connected || !state.hasNext;
        previous.disabled = !state.connected || !state.hasPrevious;

        renderEpisodes(state);
        renderOptions(audioTracks, state.audioTracks, state.selectedAudioTrackKey, 'Default audio');
        audioTracks.disabled = !state.connected || !Array.isArray(state.audioTracks) || state.audioTracks.length === 0;

        const clock = normalizeClock(state);
        if (!timelineDragging) {
            timeline.max = clock.duration > 0 ? clock.duration : 1;
            timeline.value = Math.min(clock.time, Number(timeline.max));
        }
        currentTime.textContent = formatTime(Number(timeline.value));
        duration.textContent = formatTime(clock.duration);

        if (document.activeElement !== volume) volume.value = Number.isFinite(state.volume) ? state.volume : 100;
        volumeLabel.textContent = `${Math.round(Number(volume.value))}%`;
        renderSubtitles(state);
    };

    const send = (command, data = {}) => {
        if (socket?.readyState !== WebSocket.OPEN || !currentState.connected) return;
        socket.send(JSON.stringify({ type: 'command', command, ...data }));
        if (navigator.vibrate) navigator.vibrate(12);
    };

    const sendTimelineSeek = () => {
        const seconds = Number(timeline.value);
        const now = Date.now();
        if (!Number.isFinite(seconds) || (seconds === lastTimelineSeekValue && now - lastTimelineSeekAt < 250)) return;
        lastTimelineSeekValue = seconds;
        lastTimelineSeekAt = now;
        send('seek_to', { seconds });
    };

    const websocketUrl = (token) => {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${location.host}/ws?role=remote&token=${encodeURIComponent(token)}`;
    };

    const connect = async () => {
        clearTimeout(reconnectTimer);
        const token = localStorage.getItem(tokenKey);
        if (!token) {
            setPaired(false);
            return;
        }

        try {
            const sessionResponse = await fetch(`/api/remote-session?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
            if (sessionResponse.status === 401) {
                localStorage.removeItem(tokenKey);
                setPaired(false);
                pairError.textContent = 'This phone was unpaired on the computer. Enter the PIN to pair it again.';
                return;
            }
            if (!sessionResponse.ok) throw new Error('session-check-failed');
        } catch {
            setPaired(true);
            setConnection(false, false);
            reconnectTimer = setTimeout(connect, 1500);
            return;
        }

        setPaired(true);
        socket = new WebSocket(websocketUrl(token));
        socket.addEventListener('open', () => setConnection(true, currentState.connected));
        socket.addEventListener('message', (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.type === 'state') render(message.state || {});
            } catch {
                // Ignore malformed state updates.
            }
        });
        socket.addEventListener('close', (event) => {
            setConnection(false, false);
            if (event.code === 4003) {
                localStorage.removeItem(tokenKey);
                setPaired(false);
                pairError.textContent = 'This phone was unpaired. Enter the PIN to pair it again.';
                return;
            }
            reconnectTimer = setTimeout(connect, 1500);
        });
        socket.addEventListener('error', () => socket.close());
    };

    pairForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        pairError.textContent = '';
        try {
            const response = await fetch('/api/pair', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pin: pinInput.value,
                    deviceName: navigator.userAgentData?.model || navigator.userAgentData?.platform || navigator.platform || 'Phone',
                }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            localStorage.setItem(tokenKey, result.token);
            pinInput.value = '';
            connect();
        } catch (error) {
            pairError.textContent = error.message === 'too-many-attempts'
                ? 'Too many attempts. Wait one minute and try again.'
                : 'Invalid PIN. Check the computer app.';
        }
    });

    document.querySelectorAll('[data-command]').forEach((button) => {
        button.addEventListener('click', () => {
            const seconds = Number(button.dataset.seconds);
            send(button.dataset.command, Number.isFinite(seconds) ? { seconds } : {});
        });
    });

    timeline.addEventListener('pointerdown', () => { timelineDragging = true; });
    timeline.addEventListener('input', () => {
        const seconds = Number(timeline.value);
        currentTime.textContent = formatTime(seconds);
        clearTimeout(timelineSeekTimer);
    });
    timeline.addEventListener('change', () => {
        clearTimeout(timelineSeekTimer);
        sendTimelineSeek();
        timelineDragging = false;
    });
    timeline.addEventListener('pointerup', () => {
        clearTimeout(timelineSeekTimer);
        sendTimelineSeek();
        timelineDragging = false;
    });
    timeline.addEventListener('pointercancel', () => { timelineDragging = false; });

    volume.addEventListener('input', () => { volumeLabel.textContent = `${volume.value}%`; });
    volume.addEventListener('change', () => send('volume_set', { volume: Number(volume.value) }));
    subtitles.addEventListener('change', () => send('subtitle_select', { key: subtitles.value }));
    audioTracks.addEventListener('change', () => send('audio_select', { key: audioTracks.value }));
    episodePicker.addEventListener('click', (event) => {
        if (episodePicker.classList.contains('disabled')) event.preventDefault();
    });
    episodeList.addEventListener('click', (event) => {
        const item = event.target.closest('.episode-item');
        if (!item?.dataset.episodeKey) return;
        send('episode_select', { key: item.dataset.episodeKey });
        episodePicker.open = false;
    });
    refreshSubtitles.addEventListener('click', () => {
        subtitleStatus.textContent = 'Refreshing subtitles…';
        send('refresh_subtitles');
    });
    forget.addEventListener('click', () => {
        localStorage.removeItem(tokenKey);
        socket?.close(1000, 'Unpaired');
        setPaired(false);
    });

    connect();
})();
