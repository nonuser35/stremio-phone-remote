# Changelog

## 1.0.0

- Added an authenticated local phone remote for the native Stremio player.
- Added playback, seeking, volume, mute, fullscreen, subtitle, audio, and episode controls.
- Added coherent stream matching for direct episode selection.
- Added persistent paired devices and local device revocation.
- Added a native Windows dashboard, QR code, pairing PIN, and installer.
- Added support for a bundled Node.js runtime and portable Stremio Desktop files.
- Fixed the pairing PIN being obscured by connection instructions.
- Prevented multiple dashboard instances from competing for the same relay.
- Added request timeouts and cleanup for local polling and reload timers.
- Added security headers to the phone UI and tightened local-network address selection.
- Updated runtime dependencies; the production dependency audit reports no known vulnerabilities.
- Standardized all project-owned user interfaces and documentation in English.
