const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class DeviceStore {
    constructor(filePath) {
        this.filePath = filePath;
        this.devices = [];
        this.load();
    }

    load() {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            this.devices = Array.isArray(parsed.devices) ? parsed.devices.filter((device) => device?.id && device?.token) : [];
        } catch (error) {
            if (error.code !== 'ENOENT') console.warn(`Could not read paired devices: ${error.message}`);
            this.devices = [];
        }
    }

    save() {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        fs.writeFileSync(this.filePath, JSON.stringify({ version: 1, devices: this.devices }, null, 2), 'utf8');
    }

    pair({ name, address, userAgent }) {
        const now = new Date().toISOString();
        const device = {
            id: crypto.randomUUID(),
            token: crypto.randomBytes(32).toString('base64url'),
            name: String(name || 'Phone').trim().slice(0, 80) || 'Phone',
            address: String(address || '').slice(0, 80),
            userAgent: String(userAgent || '').slice(0, 300),
            createdAt: now,
            lastSeenAt: now,
        };
        this.devices.push(device);
        this.save();
        return device;
    }

    findByToken(token) {
        return typeof token === 'string' ? this.devices.find((device) => device.token === token) || null : null;
    }

    touch(id, address) {
        const device = this.devices.find((item) => item.id === id);
        if (!device) return null;
        device.lastSeenAt = new Date().toISOString();
        if (address) device.address = String(address).slice(0, 80);
        this.save();
        return device;
    }

    remove(id) {
        const previousLength = this.devices.length;
        this.devices = this.devices.filter((device) => device.id !== id);
        if (this.devices.length !== previousLength) this.save();
        return this.devices.length !== previousLength;
    }

    publicList() {
        return this.devices.map((device) => ({
            id: device.id,
            name: device.name,
            address: device.address,
            userAgent: device.userAgent,
            createdAt: device.createdAt,
            lastSeenAt: device.lastSeenAt,
        }));
    }
}

module.exports = DeviceStore;
