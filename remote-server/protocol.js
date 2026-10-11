const COMMANDS_WITHOUT_PAYLOAD = new Set([
    'play_pause',
    'play',
    'pause',
    'next',
    'previous',
    'mute',
    'fullscreen',
    'refresh_subtitles',
]);

const finiteInRange = (value, minimum, maximum) =>
    typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;

const isAllowedCommand = (message) => {
    if (!message || message.type !== 'command' || typeof message.command !== 'string') {
        return false;
    }

    if (COMMANDS_WITHOUT_PAYLOAD.has(message.command)) {
        return true;
    }

    switch (message.command) {
        case 'seek_by':
            return finiteInRange(message.seconds, -600, 600) && message.seconds !== 0;
        case 'seek_to':
            return finiteInRange(message.seconds, 0, 604800);
        case 'volume_by':
            return finiteInRange(message.amount, -100, 100) && message.amount !== 0;
        case 'volume_set':
            return finiteInRange(message.volume, 0, 200);
        case 'subtitle_select':
        case 'audio_select':
        case 'episode_select':
            return typeof message.key === 'string' && message.key.length <= 512;
        default:
            return false;
    }
};

const normalizeAddress = (address = '') => address.startsWith('::ffff:') ? address.slice(7) : address;

const isLoopbackAddress = (address) => {
    const value = normalizeAddress(address);
    return value === '::1' || value === '127.0.0.1' || value.startsWith('127.');
};

const isPrivateAddress = (address) => {
    const value = normalizeAddress(address).toLowerCase();
    if (isLoopbackAddress(value)) return true;
    if (value.startsWith('10.') || value.startsWith('192.168.')) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(value)) return true;
    return value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:');
};

module.exports = {
    isAllowedCommand,
    isLoopbackAddress,
    isPrivateAddress,
};
