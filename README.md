# Streamdeck — Magnet Player Lab

A static, phone-friendly proof of concept for streaming torrent media from the viewer's browser using WebTorrent. The site itself does not run a torrent server or upload media files.

## Files

- `index.html` — responsive UI and custom player controls
- `app.js` — WebTorrent client setup, magnet handling, media file list, stats, player controls
- `sw.js` — service-worker bridge needed for browser streaming and seeking

## Important constraints

- Host over **HTTPS** (GitHub Pages, Cloudflare Pages, Netlify, etc.) or use `localhost`. Opening `index.html` directly with `file://` will not work because service workers require a secure context.
- The WebTorrent browser client uses WebRTC. A browser cannot connect directly to ordinary TCP/UDP-only torrent peers. The swarm must have WebRTC-capable peers, or the torrent must offer a reachable web seed.
- Browser codec support varies. Start testing with MP4/H.264/AAC media.
- Torrent clients can upload pieces while connected and peers may see your IP address. The Stop button removes the torrent from the client. Use only content you are authorized to access.
- The JS module is loaded from `esm.sh` at runtime, so an internet connection is needed to load the torrent engine.

## Quick deploy from an Android phone

1. Download and extract the ZIP.
2. Open GitHub in your browser and create a new public repository, e.g. `magnet-player-test`.
3. Upload these three files (`index.html`, `app.js`, `sw.js`) to the repository root and commit them.
4. Open **Settings → Pages**. Under Build and deployment, select **Deploy from a branch**, choose `main` and `/(root)`, then save.
5. When GitHub Pages gives you the HTTPS URL, open it in Chrome. Wait for the page to load, then tap **Try licensed sample** or paste a magnet URI.
6. If playback is blocked, tap the custom Play button once. For external links, you can send users to `https://YOUR-PAGES-URL/?magnet=URL_ENCODED_MAGNET_URI`.

## Verification

The project source is prepared for static HTTPS hosting. This environment could not connect to a live WebRTC swarm, so real-world peer discovery/playback still needs testing from the deployed URL.

## Reference

WebTorrent documentation: https://webtorrent.io/docs
WebTorrent source: https://github.com/webtorrent/webtorrent
