const test = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedCommand, isLoopbackAddress, isPrivateAddress } = require('./protocol');

test('accepts the supported player commands', () => {
    assert.equal(isAllowedCommand({ type: 'command', command: 'play_pause' }), true);
    assert.equal(isAllowedCommand({ type: 'command', command: 'seek_by', seconds: -10 }), true);
    assert.equal(isAllowedCommand({ type: 'command', command: 'seek_to', seconds: 123.5 }), true);
    assert.equal(isAllowedCommand({ type: 'command', command: 'volume_set', volume: 200 }), true);
    assert.equal(isAllowedCommand({ type: 'command', command: 'subtitle_select', key: 'embedded:1' }), true);
    assert.equal(isAllowedCommand({ type: 'command', command: 'refresh_subtitles' }), true);
    assert.equal(isAllowedCommand({ type: 'command', command: 'previous' }), true);
    assert.equal(isAllowedCommand({ type: 'command', command: 'audio_select', key: 'audio:1' }), true);
    assert.equal(isAllowedCommand({ type: 'command', command: 'episode_select', key: 'series:2:8' }), true);
});

test('rejects unknown and out-of-range commands', () => {
    assert.equal(isAllowedCommand({ type: 'command', command: 'launch_program' }), false);
    assert.equal(isAllowedCommand({ type: 'command', command: 'seek_by', seconds: 1000 }), false);
    assert.equal(isAllowedCommand({ type: 'command', command: 'volume_set', volume: 201 }), false);
    assert.equal(isAllowedCommand({ type: 'state', command: 'pause' }), false);
});

test('recognizes loopback and private-network addresses', () => {
    assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
    assert.equal(isPrivateAddress('192.168.1.10'), true);
    assert.equal(isPrivateAddress('172.20.1.2'), true);
    assert.equal(isPrivateAddress('10.0.0.8'), true);
    assert.equal(isPrivateAddress('8.8.8.8'), false);
});
