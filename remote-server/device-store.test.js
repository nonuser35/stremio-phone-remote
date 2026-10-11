const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const DeviceStore = require('./device-store');

test('persists paired devices and revokes them explicitly', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stremio-remote-devices-'));
    const file = path.join(directory, 'devices.json');
    const store = new DeviceStore(file);
    const paired = store.pair({ name: 'Meu celular', address: '192.168.1.2', userAgent: 'Browser' });

    assert.equal(store.findByToken(paired.token).name, 'Meu celular');
    assert.equal(new DeviceStore(file).findByToken(paired.token).id, paired.id);
    assert.equal(store.publicList()[0].token, undefined);
    assert.equal(store.remove(paired.id), true);
    assert.equal(new DeviceStore(file).findByToken(paired.token), null);
});
