# Streamdeck Ultra — Client-first static build

Upload `index.html`, `app.js`, and `sw.js` into the root of a GitHub repository and enable GitHub Pages.

## Processing model
- Direct media and controls run in the visitor's browser.
- HLS/DASH manifests and segments are fetched by the browser from the original source.
- Browser WebTorrent runs on the visitor's device and requires WebRTC-compatible peers or a reachable web seed.
- Normal TCP/UDP BitTorrent swarms require a separate engine (for example, the optional Node companion running locally in Termux). GitHub Pages does not run a Node backend.

No remote torrent backend is configured in this static build. External source CORS rules, peer availability, and browser codec support still apply. Use only authorized content.
