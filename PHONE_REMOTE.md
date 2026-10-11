# Windows package guide

## Installation

1. Extract the complete release ZIP.
2. Run `Install Stremio Remote.exe`.
3. Approve the Windows administrator prompt that allows TCP port `9100` for the bundled Node.js runtime on private networks only.
4. Open **Stremio Remote** from the desktop shortcut.

The release package includes the local Node.js runtime and a clean portable copy of Stremio Desktop. No separate Stremio or Node.js installation is required.

## Pairing a phone

1. Keep the computer and phone on the same Wi-Fi network.
2. Scan the QR code shown in the Windows dashboard, or open its link on the phone.
3. Enter the six-digit pairing PIN once.

The pairing remains saved until the device is explicitly unpaired in the Windows dashboard or on the phone.

## User data

The distributed ZIP must not contain a `stremio-shell-ng.exe.WebView2` directory. Each installation creates its own Stremio profile on first launch. Login, addons, history, cache, and paired devices remain local to that installation and are preserved by updates.

## Troubleshooting

- If the player does not connect, close any other Stremio installation and click **Open Stremio**.
- If the phone cannot open the link, confirm both devices are on the same private network and that the firewall allows the bundled Node.js runtime.
- Guest Wi-Fi and access-point isolation prevent devices on the same Wi-Fi name from reaching each other. Use a normal private home network instead.
- If the firewall approval was cancelled during installation, run the installer again and approve it.
- Do not forward the remote ports on the router or expose them to the public internet.
