# Stremio Phone Remote

Stremio Phone Remote is a Windows-focused fork of the official [Stremio Web](https://github.com/Stremio/stremio-web) interface. It adds a local, authenticated phone remote without replacing Stremio's native player.

## Features

- Play, pause, seek, volume, mute, and fullscreen controls
- Previous, next, and direct episode selection
- Stream continuity when selecting an episode from the season list
- Subtitle selection with embedded Portuguese and English tracks first, followed by addon tracks
- Audio track selection with readable language and country names
- Persistent phone pairing with local device management
- Native Windows dashboard with QR code, pairing PIN, link, ports, player status, and paired devices
- Bundled Windows installer source and support for a portable Stremio Desktop layout

## How it works

The local Node.js relay serves the modified Stremio Web build, proxies the native Stremio streaming server, and relays a strictly validated command set over authenticated WebSockets.

```text
Phone browser  <-- authenticated WebSocket -->  Local relay  <-- loopback only -->  Stremio player
```

The relay listens on the local network for the phone UI, while player sessions and device administration remain restricted to loopback addresses. A six-digit PIN is required once per phone. Paired-device tokens are generated locally and stored only on the computer.

## Development

Requirements:

- Node.js 22 or later
- pnpm 11 or later
- Windows and .NET Framework 4 for the native dashboard build

```bash
pnpm install
npm install --prefix remote-server
pnpm remote:test
pnpm lint
pnpm build
```

Start the development relay with:

```bash
pnpm remote
```

The production Windows package additionally contains a Node.js runtime and the official Stremio Desktop binaries. User profiles, logins, history, addon configuration, and caches must never be included in a distributed package.

## Local ports

- `9100`: modified Stremio interface, phone UI, API, and WebSocket relay
- `9101`: loopback-only bridge to the native Stremio streaming server

## Security notes

- The relay accepts connections only from loopback and private-network addresses.
- Player authentication and device administration are loopback-only.
- Remote commands are allowlisted and their payloads are range-checked.
- Pairing attempts are rate-limited.
- The phone UI uses a restrictive Content Security Policy.
- Do not expose ports `9100` or `9101` to the public internet.

## Upstream and license

This project is based on Stremio Web and retains its upstream Git history and attribution. Stremio Web is Copyright © 2017–2026 Smart Code OOD and licensed under GPL-2.0. See [LICENSE.md](LICENSE.md).

Stremio is a trademark of its respective owner. This community project is not an official Stremio release.
