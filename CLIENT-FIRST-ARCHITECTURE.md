# Streamdeck Ultra — Client-first architecture

This build defaults to **processing on the visitor's own browser/device**. The optional Node.js companion is a deliberate local fallback, not an automatic remote backend.

## Where work happens

| Feature | Where it runs / transfers |
|---|---|
| Custom controls, UI, source detection | Visitor's browser |
| Direct HTTP(S) media playback | Browser fetches media from the original source |
| HLS / DASH | Browser loads manifests and segments from the original source; adaptive-player code is downloaded on demand |
| Browser WebTorrent | Torrent client runs in the browser; data moves between browser and compatible WebRTC peers/web seeds |
| Conventional TCP/UDP BitTorrent peers | Not available to an ordinary web page; optional Node/WebTorrent companion can run locally on the user's own phone in Termux |
| Optional remote torrent bridge | Not the default; it would consume server bandwidth and resources and would need production-grade security/abuse controls |

## Recommended hosting

For the client-first setup, host the static files (`index.html`, `app.js`, `sw.js`) on GitHub Pages. The `companion/` folder can remain in the repository as source code, but GitHub Pages does not execute it. A Railway deployment is not required for direct playback or browser-compatible torrents.

For torrents needing regular TCP/UDP peers, the privacy/bandwidth-preserving optional path is for the same user to run `companion/` locally in Termux and open `http://127.0.0.1:8765`. Do not point the public UI to a public bridge you do not control.

## Honest limitations

Client-side architecture does not guarantee every media source or torrent works. Browser torrents still require WebRTC-capable peers or a compatible web seed. The browser cannot directly join regular UDP/TCP BitTorrent swarms. External media sources can block access through CORS, and browser codec support varies. The original source and torrent peers still see normal connection metadata, including the visitor's public IP when applicable.
