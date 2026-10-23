const $ = (id) => document.getElementById(id);
const ui = {
  source: $('sourceInput'), sourceMode: $('sourceMode'), engineMode: $('engineMode'), bridgeBase: $('bridgeBase'), bridgeToken: $('bridgeToken'),
  load: $('loadBtn'), sample: $('sampleBtn'), chooseTorrent: $('chooseTorrentBtn'), torrentFile: $('torrentFileInput'), stop: $('stopBtn'), paste: $('pasteBtn'), checkBridge: $('checkBridgeBtn'),
  statusBox: $('statusBox'), status: $('statusText'), video: $('video'), stage: $('playerStage'), empty: $('emptyPlayer'), title: $('playerTitle'), subtitle: $('playerSubtitle'), badge: $('playerBadge'),
  fileList: $('fileList'), fileEmpty: $('fileEmpty'), fileCount: $('fileCount'), seek: $('seekBar'), play: $('playBtn'), mute: $('muteBtn'), volume: $('volumeBar'), speed: $('speedSelect'), fullscreen: $('fullscreenBtn'),
  peers: $('peerCount'), downloaded: $('downloaded'), downSpeed: $('downloadSpeed'), upSpeed: $('uploadSpeed'), progress: $('progressLabel'), progressFill: $('progressFill'),
  engineBadge: $('engineBadge'), statsEngine: $('statsEngine'), diagIntro: $('diagIntro'), diagnostics: $('diagnostics'),
};

const SINTEL_MAGNET = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A1337&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.fastcast.nz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com&ws=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2F&xs=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2Fsintel.torrent';
const BROWSER_TRACKERS = ['wss://tracker.openwebtorrent.com', 'wss://tracker.btorrent.xyz', 'wss://tracker.fastcast.nz'];
const MEDIA_EXTENSIONS = /\.(mp4|m4v|mkv|webm|mov|ogv|ogg|mp3|m4a|wav|flac|aac|opus|3gp|3g2|avi|ts|m4s)$/i;
const AUDIO_EXTENSIONS = /\.(mp3|m4a|wav|flac|aac|opus|ogg)$/i;
const state = {
  WebTorrent: null, client: null, torrent: null, selectedFile: null, statsTimer: null, noDataTimer: null,
  hls: null, dash: null, remote: null, remotePoll: null, remoteSnapshot: null, remoteFiles: [],
  currentKind: 'none', scrubbing: false, lastTransferAt: Date.now(), startedAt: 0, torrentReady: false, filePick: null,
  browserServerReady: false, cleaning: false, sourceUrl: '', remoteStartedAt: 0, remoteTimeoutShown: false
};

function setStatus(message, kind = 'idle') {
  ui.status.textContent = message;
  ui.statusBox.dataset.kind = kind;
  addDiagnostic(message, kind.toUpperCase());
}
function addDiagnostic(message, level = 'INFO') {
  const stamp = new Date().toLocaleTimeString();
  const prior = ui.diagnostics.textContent === 'No diagnostics yet.' ? '' : ui.diagnostics.textContent + '\n';
  const lines = `${prior}[${stamp}] ${level}: ${String(message)}`.split('\n');
  ui.diagnostics.textContent = lines.slice(-14).join('\n');
  ui.diagIntro.textContent = state.currentKind === 'none' ? 'No active source.' : `Source: ${state.currentKind}`;
}
function prettyBytes(value) {
  if (!Number.isFinite(Number(value))) return '—';
  const bytes = Math.max(0, Number(value));
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
function prettySpeed(value) {
  if (!Number.isFinite(Number(value))) return '—';
  const n = Math.max(0, Number(value));
  return n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(2)} MB/s` : `${(n / 1024).toFixed(1)} KB/s`;
}
function prettyTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
function setBadge(text) { ui.badge.textContent = text; }
function clearTimers() {
  clearInterval(state.statsTimer); state.statsTimer = null;
  clearInterval(state.remotePoll); state.remotePoll = null;
  clearTimeout(state.noDataTimer); state.noDataTimer = null;
}
function resetStats() {
  ui.peers.textContent = '—'; ui.downloaded.textContent = '—'; ui.downSpeed.textContent = '—'; ui.upSpeed.textContent = '—';
  ui.progress.textContent = '—'; ui.progressFill.style.width = '0%';
}
function resetFiles(message = 'No media files loaded.') {
  ui.fileList.replaceChildren(); ui.fileCount.textContent = '0 files'; ui.fileEmpty.textContent = message; ui.fileEmpty.classList.remove('hidden');
}
function destroyAdaptivePlayers() {
  try { state.hls?.destroy(); } catch (_) {}
  state.hls = null;
  try { state.dash?.reset(); } catch (_) {}
  state.dash = null;
}
function clearMediaElement() {
  ui.video.pause();
  try { ui.video.removeAttribute('src'); ui.video.srcObject = null; ui.video.load(); } catch (_) {}
  ui.video.classList.add('hidden'); ui.empty.classList.remove('hidden');
  ui.title.textContent = 'Custom player'; ui.subtitle.textContent = 'Your selected media appears here';
  ui.seek.value = '0'; ui.seek.disabled = true; ui.play.disabled = true; ui.mute.disabled = true; ui.volume.disabled = true; ui.speed.disabled = true; ui.fullscreen.disabled = true;
  ui.play.textContent = '▶'; ui.play.setAttribute('aria-label', 'Play'); ui.badge.textContent = 'IDLE';
  $('currentTime').textContent = '0:00'; $('duration').textContent = '0:00';
}
function enablePlayer() {
  ui.video.classList.remove('hidden'); ui.empty.classList.add('hidden');
  ui.play.disabled = false; ui.mute.disabled = false; ui.volume.disabled = false; ui.speed.disabled = false; ui.fullscreen.disabled = false;
}
function showVideoShell(title, subtitle, badge = 'LOADING') {
  ui.title.textContent = title || 'Media'; ui.subtitle.textContent = subtitle || ''; setBadge(badge); enablePlayer();
}
function resetAll() {
  destroyAdaptivePlayers(); clearMediaElement(); resetFiles(); resetStats();
  ui.statsEngine.textContent = 'IDLE'; ui.engineBadge.textContent = 'CLIENT FIRST'; state.currentKind = 'none'; state.selectedFile = null; state.filePick = null; state.sourceUrl = '';
  ui.diagIntro.textContent = 'No active source.';
}
function prepareBrowserMagnet(magnet) {
  const normalized = new Set();
  for (const m of magnet.matchAll(/[?&]tr=([^&]+)/gi)) {
    try { normalized.add(decodeURIComponent(m[1].replace(/\+/g, ' ')).replace(/\/+$/, '').toLowerCase()); }
    catch (_) { normalized.add(m[1].toLowerCase()); }
  }
  const added = BROWSER_TRACKERS.filter((t) => !normalized.has(t.replace(/\/+$/, '').toLowerCase()));
  if (!added.length) return { uri: magnet, added };
  const fragmentIndex = magnet.indexOf('#');
  const base = fragmentIndex >= 0 ? magnet.slice(0, fragmentIndex) : magnet;
  const fragment = fragmentIndex >= 0 ? magnet.slice(fragmentIndex) : '';
  return { uri: `${base}${base.includes('?') ? '&' : '?'}${added.map((t) => `tr=${encodeURIComponent(t)}`).join('&')}${fragment}`, added };
}
function detectSource(raw, selectedMode = 'auto') {
  const value = String(raw || '').trim();
  if (/^magnet:\?/i.test(value)) return 'magnet';
  if (/^https?:\/\//i.test(value)) {
    let url;
    try { url = new URL(value); } catch (_) { throw new Error('That URL is not valid.'); }
    if (url.username || url.password) throw new Error('URLs containing embedded usernames/passwords are not accepted.');
    if (selectedMode !== 'auto') return selectedMode;
    if (/\.m3u8$/i.test(url.pathname)) return 'hls';
    if (/\.mpd$/i.test(url.pathname)) return 'dash';
    return 'direct';
  }
  throw new Error('Paste a magnet URI or a valid HTTP(S) media/stream URL.');
}
function normalizeBase() {
  const text = (ui.bridgeBase.value || 'http://127.0.0.1:8765').trim();
  let url;
  try { url = new URL(text); } catch (_) { throw new Error('Local engine URL must be a full URL such as http://127.0.0.1:8765'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('The local engine URL must use HTTP or HTTPS.');
  return url.origin;
}
async function bridgeFetch(path, options = {}) {
  const base = normalizeBase();
  const headers = new Headers(options.headers || {});
  const token = ui.bridgeToken.value.trim();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${base}${path}`, { ...options, headers, cache: 'no-store' });
  let payload = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) payload = await response.json();
  else payload = await response.text();
  if (!response.ok) throw new Error((payload && payload.error) || (typeof payload === 'string' && payload) || `Phone engine returned HTTP ${response.status}`);
  return payload;
}
async function checkBridge(show = true) {
  try {
    const health = await bridgeFetch('/api/health');
    const message = `Phone engine reachable · v${health.version || '?'} · active torrents: ${health.activeTorrents ?? '—'}`;
    if (show) setStatus(message, 'success');
    addDiagnostic(message, 'OK'); return health;
  } catch (error) {
    if (show) setStatus(`Phone engine unavailable: ${error.message}. Run the companion on this phone, then open its local page.`, 'error');
    throw error;
  }
}

async function ensureBrowserClient() {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) throw new Error('Browser torrent mode requires HTTPS (or localhost) and service-worker support.');
  if (!state.WebTorrent) {
    setStatus('Loading browser torrent engine…', 'working');
    const mod = await import('https://esm.sh/webtorrent@3.0.21/dist/webtorrent.min.js');
    state.WebTorrent = mod.default || mod.WebTorrent;
    if (!state.WebTorrent) throw new Error('WebTorrent module did not expose a client constructor.');
  }
  if (!state.WebTorrent.WEBRTC_SUPPORT) throw new Error('WebRTC is not supported in this browser. Try a current Chrome or Firefox release.');
  if (!state.client) {
    state.client = new state.WebTorrent();
    state.client.on('error', (error) => setStatus(`Torrent client error: ${error.message || error}`, 'error'));
  }
  if (!state.browserServerReady) {
    setStatus('Preparing browser stream bridge…', 'working');
    const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    await navigator.serviceWorker.ready;
    state.client.createServer({ controller: registration });
    state.browserServerReady = true;
  }
}
function isPlayableFilename(name) { return MEDIA_EXTENSIONS.test(String(name || '')); }
function listSupportedFiles(torrent) {
  return torrent.files.filter((f) => isPlayableFilename(f.name)).sort((a, b) => {
    const aa = AUDIO_EXTENSIONS.test(a.name), ba = AUDIO_EXTENSIONS.test(b.name);
    if (aa !== ba) return aa ? 1 : -1;
    return b.length - a.length;
  });
}
function renderBrowserFiles(torrent, files) {
  ui.fileList.replaceChildren(); ui.fileCount.textContent = `${files.length} file${files.length === 1 ? '' : 's'}`; ui.fileEmpty.classList.toggle('hidden', files.length > 0);
  ui.fileEmpty.textContent = files.length ? '' : `Metadata loaded (${torrent.files.length} total files), but no supported media filename was detected.`;
  for (const file of files) {
    const button = createFileButton(file.name, file.length, AUDIO_EXTENSIONS.test(file.name) ? 'AUD' : 'VID');
    button.addEventListener('click', () => selectBrowserFile(file, torrent, button)); ui.fileList.append(button);
  }
}
function createFileButton(name, size, kind = 'VID') {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'file-row';
  const dot = document.createElement('span'); dot.className = 'file-dot'; dot.textContent = kind;
  const meta = document.createElement('span'); meta.className = 'file-meta';
  const title = document.createElement('span'); title.className = 'file-name'; title.textContent = name;
  const metaSize = document.createElement('span'); metaSize.className = 'file-size'; metaSize.textContent = prettyBytes(size);
  meta.append(title, metaSize); button.append(dot, meta); return button;
}
function markActiveFile(button) { for (const row of ui.fileList.querySelectorAll('.file-row')) row.classList.remove('active'); button?.classList.add('active'); }
function selectBrowserFile(file, torrent, button) {
  markActiveFile(button); state.selectedFile = file; state.currentKind = 'browser-torrent';
  destroyAdaptivePlayers(); ui.video.pause(); ui.video.removeAttribute('src'); ui.video.load();
  showVideoShell(file.name, `${prettyBytes(file.length)} · browser WebRTC torrent stream`, 'READY');
  ui.seek.disabled = false;
  try {
    file.streamTo(ui.video);
    setStatus('Browser media stream connected. Tap Play if playback does not begin automatically.', 'success'); setBadge('STREAM');
    ui.video.play().catch(() => setStatus('Media source is attached. Tap Play to begin, or check codec support.', 'warning'));
  } catch (error) { setStatus(`Could not open this media file: ${error.message || error}`, 'error'); setBadge('ERROR'); }
  updateBrowserStats();
}
function armBrowserDiagnostic(torrent) {
  clearTimeout(state.noDataTimer);
  state.noDataTimer = setTimeout(() => {
    if (state.torrent !== torrent || state.currentKind !== 'browser-torrent') return;
    const peers = Number(torrent.numPeers) || 0, downloaded = Number(torrent.downloaded) || 0;
    if (!torrent.ready) {
      setBadge('NO META'); setStatus('No torrent metadata arrived. The magnet may have no usable metadata source or no reachable peers.', 'error');
    } else if (peers === 0 && downloaded === 0) {
      setBadge('NO PEERS'); setStatus('No browser-compatible peer or web-seed data found. This swarm may have only regular TCP/UDP peers; switch to Phone engine (Termux) to test conventional peers.', 'error');
    } else if (downloaded === 0 && Date.now() - state.lastTransferAt > 25000) {
      setBadge('NO DATA'); setStatus('Peers were discovered, but no pieces arrived yet. Wait for seeding/availability or try the phone engine. A tracker warning alone is not proof the torrent is dead.', 'warning');
    }
  }, 32000);
}
function attachBrowserTorrent(torrent) {
  state.torrent = torrent; state.currentKind = 'browser-torrent'; state.startedAt = Date.now(); state.lastTransferAt = Date.now(); state.torrentReady = Boolean(torrent.ready);
  ui.stop.disabled = false; ui.load.disabled = true; ui.sample.disabled = true; ui.chooseTorrent.disabled = true; ui.statsEngine.textContent = 'BROWSER'; ui.engineBadge.textContent = 'BROWSER WEBRTC';
  ui.title.textContent = torrent.name || 'Torrent'; ui.subtitle.textContent = 'Looking up metadata and WebRTC peers…'; setBadge('FINDING'); setStatus('Torrent accepted. Looking for metadata and browser-compatible peers…', 'working');
  torrent.on('warning', (warning) => {
    const message = warning?.message || String(warning);
    if (/unsupported tracker protocol/i.test(message)) setStatus('Ignored unsupported tracker warning (often UDP). Browser mode still needs WebRTC peers or a reachable web seed.', 'warning');
    else setStatus(`Torrent warning: ${message}`, 'warning');
    addDiagnostic(message, 'WARN');
  });
  torrent.on('error', (error) => { setStatus(`Torrent error: ${error.message || error}`, 'error'); setBadge('ERROR'); });
  torrent.on('wire', () => { state.lastTransferAt = Date.now(); armBrowserDiagnostic(torrent); setStatus('A browser peer connected. Waiting for media pieces…', 'working'); });
  torrent.on('download', () => { state.lastTransferAt = Date.now(); if (ui.statusBox.dataset.kind !== 'success' && ui.statusBox.dataset.kind !== 'working') setStatus('Torrent data is arriving.', 'working'); armBrowserDiagnostic(torrent); });
  const onReady = () => {
    if (state.torrent !== torrent) return;
    state.torrentReady = true; setBadge('FOUND');
    const files = listSupportedFiles(torrent); renderBrowserFiles(torrent, files);
    ui.title.textContent = torrent.name || 'Torrent'; ui.subtitle.textContent = `${torrent.files.length} total file(s) · ${files.length} supported media file(s)`;
    setStatus(files.length ? `Torrent metadata loaded. Choose one of ${files.length} media file(s) below.` : 'Metadata loaded, but there are no supported media filenames.', files.length ? 'success' : 'warning');
    if (files.length === 1) selectBrowserFile(files[0], torrent, ui.fileList.querySelector('.file-row'));
    armBrowserDiagnostic(torrent);
  };
  torrent.on('ready', onReady); if (torrent.ready) onReady();
  clearInterval(state.statsTimer); state.statsTimer = setInterval(updateBrowserStats, 900); updateBrowserStats(); armBrowserDiagnostic(torrent);
}
function updateBrowserStats() {
  const t = state.torrent; if (!t || state.currentKind !== 'browser-torrent') return;
  ui.peers.textContent = String(t.numPeers ?? 0); ui.downloaded.textContent = prettyBytes(t.downloaded); ui.downSpeed.textContent = prettySpeed(t.downloadSpeed); ui.upSpeed.textContent = prettySpeed(t.uploadSpeed);
  const p = Math.max(0, Math.min(100, (Number(t.progress) || 0) * 100)); ui.progress.textContent = `${p.toFixed(1)}%`; ui.progressFill.style.width = `${p}%`;
}
async function loadBrowserTorrent(id, isFile = false) {
  await ensureBrowserClient();
  let torrentId = id;
  if (id instanceof File) {
    // WebTorrent expects the .torrent payload as bytes, not the DOM File wrapper.
    torrentId = new Uint8Array(await id.arrayBuffer());
  }
  const prepared = typeof torrentId === 'string' && torrentId.startsWith('magnet:') ? prepareBrowserMagnet(torrentId) : { uri: torrentId, added: [] };
  if (prepared.added.length) setStatus(`Added ${prepared.added.length} WebSocket tracker(s) for browser discovery. This cannot make a UDP/TCP-only swarm browser-compatible.`, 'working');
  const torrent = state.client.add(prepared.uri);
  attachBrowserTorrent(torrent);
  addDiagnostic(isFile ? 'Loaded a local .torrent file into browser engine.' : 'Added magnet to browser WebTorrent client.', 'INFO');
}

function buildDirectFileList(url, sourceName) {
  resetFiles('Direct media URL selected; torrent file list is not applicable.');
  ui.fileEmpty.classList.remove('hidden'); ui.fileCount.textContent = 'URL source';
}
async function playHttpSource(rawUrl, forcedType = 'direct') {
  let url;
  try { url = new URL(rawUrl); } catch (_) { throw new Error('Enter a valid URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS media URLs are supported.');
  if (url.username || url.password) throw new Error('URLs with embedded credentials are not supported.');
  const path = url.pathname.toLowerCase();
  const kind = forcedType === 'auto' ? (path.endsWith('.m3u8') ? 'hls' : path.endsWith('.mpd') ? 'dash' : 'direct') : forcedType;
  state.currentKind = kind; state.sourceUrl = url.href; state.selectedFile = null;
  resetFiles('Direct media URL selected; torrent file list is not applicable.'); ui.fileCount.textContent = 'URL source'; destroyAdaptivePlayers();
  ui.video.pause(); ui.video.removeAttribute('src'); ui.video.load(); showVideoShell(url.pathname.split('/').filter(Boolean).pop() || 'Remote media', `${kind.toUpperCase()} · source URL is played by your browser`, 'LOADING');
  ui.statsEngine.textContent = 'DIRECT'; ui.engineBadge.textContent = kind.toUpperCase(); resetStats();
  let nativeMediaLoad = false;
  if (kind === 'hls') {
    if (ui.video.canPlayType('application/vnd.apple.mpegurl')) {
      ui.video.src = url.href;
      nativeMediaLoad = true;
    } else {
      setStatus('Loading HLS playback engine…', 'working');
      const mod = await import('https://esm.sh/hls.js@1.7.3?bundle');
      const Hls = mod.default || mod.Hls || mod;
      if (!Hls || !Hls.isSupported()) throw new Error('HLS.js is not supported by this browser (Media Source Extensions unavailable).');
      state.hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      state.hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data?.fatal) setStatus(`HLS playback error: ${data.details || data.type || 'unknown error'}. Source CORS/access may be blocking playback.`, 'error');
      });
      state.hls.loadSource(url.href); state.hls.attachMedia(ui.video);
    }
  } else if (kind === 'dash') {
    setStatus('Loading DASH playback engine…', 'working');
    const mod = await import('https://esm.sh/dashjs@5.2.1?bundle');
    const dashjs = mod.default || mod;
    if (!dashjs.MediaPlayer) throw new Error('Could not load the dash.js player module.');
    state.dash = dashjs.MediaPlayer().create(); state.dash.initialize(ui.video, url.href, false);
    state.dash.on?.('error', (event) => setStatus(`DASH playback error: ${event?.error?.message || 'source inaccessible or unsupported'}`, 'error'));
  } else {
    // Native playback is the most compatible option for direct files; unknown codecs fail through video.error.
    ui.video.src = url.href;
    nativeMediaLoad = true;
  }
  if (nativeMediaLoad) ui.video.load(); setStatus(`${kind.toUpperCase()} source attached. The media server must be reachable; HLS/DASH segment requests may require CORS headers. Tap Play if autoplay is blocked.`, 'success');
  ui.video.play().catch(() => setStatus('Source attached. Tap Play to begin playback.', 'warning'));
}

async function startLocalTorrent(idOrFile) {
  const base = normalizeBase();
  await checkBridge(false);
  const isFile = idOrFile instanceof File;
  let response;
  if (isFile) {
    const bytes = await idOrFile.arrayBuffer();
    response = await bridgeFetch('/api/torrents/file', { method: 'POST', headers: { 'Content-Type': 'application/x-bittorrent' }, body: bytes });
  } else {
    response = await bridgeFetch('/api/torrents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ magnet: idOrFile }) });
  }
  state.remote = { id: response.id, base, name: response.name || 'Torrent', selectedIndex: null, streamKey: response.streamKey || null };
  state.remoteStartedAt = Date.now(); state.remoteTimeoutShown = false;
  state.currentKind = 'local-torrent'; state.sourceUrl = typeof idOrFile === 'string' ? idOrFile : idOrFile.name;
  ui.stop.disabled = false; ui.load.disabled = true; ui.sample.disabled = true; ui.chooseTorrent.disabled = true; ui.statsEngine.textContent = 'PHONE'; ui.engineBadge.textContent = 'LOCAL NODE';
  ui.title.textContent = 'Phone torrent engine'; ui.subtitle.textContent = 'Connecting to conventional BitTorrent peers…'; setBadge('CONNECTING');
  setStatus('Torrent was sent to the local engine. Waiting for metadata and peer discovery…', 'working');
  clearInterval(state.remotePoll); state.remotePoll = setInterval(pollRemoteTorrent, 1400); await pollRemoteTorrent();
}
async function pollRemoteTorrent() {
  if (!state.remote || state.currentKind !== 'local-torrent') return;
  try {
    const data = await bridgeFetch(`/api/torrents/${encodeURIComponent(state.remote.id)}`);
    state.remoteSnapshot = data;
    state.remote.streamKey = data.streamKey || state.remote.streamKey;
    ui.peers.textContent = String(data.peers ?? 0); ui.downloaded.textContent = prettyBytes(data.downloaded); ui.downSpeed.textContent = prettySpeed(data.downloadSpeed); ui.upSpeed.textContent = prettySpeed(data.uploadSpeed);
    const p = Math.max(0, Math.min(100, (Number(data.progress) || 0) * 100)); ui.progress.textContent = `${p.toFixed(1)}%`; ui.progressFill.style.width = `${p}%`;
    if (data.error) { setBadge('ERROR'); setStatus(`Phone engine: ${data.error}`, 'error'); return; }
    if (data.ready && Array.isArray(data.files)) {
      const signature = data.files.map((f) => `${f.index}:${f.name}:${f.length}`).join('|');
      if (!state.remoteFilesSignature || state.remoteFilesSignature !== signature) {
        state.remoteFilesSignature = signature; state.remoteFiles = data.files;
        renderRemoteFiles(data.files, data.streamKey);
        ui.title.textContent = data.name || 'Torrent'; ui.subtitle.textContent = `${data.files.length} supported media file(s) · native Node torrent engine`; setBadge('FOUND');
        setStatus(data.files.length ? 'Torrent metadata loaded by the phone engine. Choose a file below.' : 'Metadata loaded, but no supported media filenames were detected.', data.files.length ? 'success' : 'warning');
        if (data.files.length === 1) selectRemoteFile(data.files[0], ui.fileList.querySelector('.file-row'));
      }
    } else {
      setBadge(data.peers > 0 ? 'PEERS' : 'FINDING');
      ui.subtitle.textContent = `${data.peers ?? 0} peer(s) · waiting for torrent metadata`;
      if (!state.remoteTimeoutShown && Date.now() - state.remoteStartedAt > 45000) {
        state.remoteTimeoutShown = true; setBadge('NO META');
        setStatus(data.peers > 0 ? 'Phone engine found peer connections but metadata has not arrived after 45 seconds. Check the torrent metadata source and tracker/DHT connectivity.' : 'No peers or metadata after 45 seconds. The swarm may be unreachable, have no active peers, or be blocked by the current network. This is not a video-codec problem yet.', 'error');
      }
    }
  } catch (error) {
    setStatus(`Phone engine connection lost: ${error.message}. Check that the companion is running and the URL/token are correct.`, 'error'); setBadge('OFFLINE');
  }
}
function renderRemoteFiles(files, streamKey) {
  ui.fileList.replaceChildren(); ui.fileCount.textContent = `${files.length} file${files.length === 1 ? '' : 's'}`; ui.fileEmpty.classList.toggle('hidden', files.length > 0); ui.fileEmpty.textContent = files.length ? '' : 'No supported media files in this torrent.';
  for (const file of files) {
    const button = createFileButton(file.name, file.length, AUDIO_EXTENSIONS.test(file.name) ? 'AUD' : 'VID');
    button.addEventListener('click', () => selectRemoteFile(file, button)); ui.fileList.append(button);
  }
}
function selectRemoteFile(file, button) {
  if (!state.remote) return;
  markActiveFile(button); state.selectedFile = file; state.remote.selectedIndex = file.index;
  destroyAdaptivePlayers(); ui.video.pause(); ui.video.removeAttribute('src'); ui.video.load();
  const streamKey = state.remote.streamKey;
  if (!streamKey) { setStatus('The local engine has not returned a stream capability yet. Try selecting this file again.', 'error'); return; }
  const mediaUrl = `${state.remote.base}/media/${encodeURIComponent(state.remote.id)}/${encodeURIComponent(streamKey)}/${encodeURIComponent(file.index)}`;
  ui.video.src = mediaUrl; ui.video.referrerPolicy = 'no-referrer';
  showVideoShell(file.name, `${prettyBytes(file.length)} · streaming from your phone`, 'STREAM');
  ui.seek.disabled = false; setStatus('Local torrent stream attached. HTTP Range requests are used for seeking; media still needs available pieces.', 'success');
  ui.video.play().catch(() => setStatus('Phone stream attached. Tap Play if autoplay is blocked.', 'warning'));
}

async function startSource(raw = ui.source.value, file = null) {
  const value = String(raw || '').trim();
  if (!value && !file) { setStatus('Paste a magnet or HTTP(S) URL, or choose a .torrent file.', 'error'); return; }
  ui.load.disabled = true; ui.sample.disabled = true; ui.chooseTorrent.disabled = true;
  await stopActive(false);
  resetAll(); state.sourceUrl = file?.name || value;
  try {
    if (file || /^magnet:\?/i.test(value)) {
      const engine = ui.engineMode.value;
      if (engine === 'local') await startLocalTorrent(file || value);
      else await loadBrowserTorrent(file || value);
      return;
    }
    const kind = detectSource(value, ui.sourceMode.value);
    await playHttpSource(value, kind);
  } catch (error) {
    setStatus(error.message || String(error), 'error'); setBadge('ERROR'); addDiagnostic(error.stack || error, 'ERR');
    ui.load.disabled = false; ui.sample.disabled = false; ui.chooseTorrent.disabled = false; ui.stop.disabled = Boolean(state.torrent || state.remote);
  }
}
async function stopActive(showMessage = true) {
  clearTimers(); state.cleaning = true;
  const torrent = state.torrent; state.torrent = null; state.torrentReady = false;
  if (torrent && state.client) {
    try { await state.client.remove(torrent.infoHash); } catch (error) { addDiagnostic(`Browser torrent cleanup: ${error.message || error}`, 'WARN'); }
  }
  const remote = state.remote; state.remote = null; state.remoteSnapshot = null; state.remoteFiles = []; state.remoteFilesSignature = '';
  if (remote) {
    try { await bridgeFetch(`/api/torrents/${encodeURIComponent(remote.id)}`, { method: 'DELETE' }); }
    catch (error) { addDiagnostic(`Phone torrent cleanup (server may already be offline): ${error.message || error}`, 'WARN'); }
  }
  destroyAdaptivePlayers(); clearMediaElement(); resetFiles(); resetStats();
  ui.stop.disabled = true; ui.load.disabled = false; ui.sample.disabled = false; ui.chooseTorrent.disabled = false;
  ui.statsEngine.textContent = 'IDLE'; ui.engineBadge.textContent = 'CLIENT FIRST'; state.selectedFile = null; state.currentKind = 'none'; state.cleaning = false;
  if (showMessage) setStatus('Stopped. Torrent connections and playback resources were released where possible.', 'idle');
}

function syncPlayButton() {
  const paused = ui.video.paused; ui.play.textContent = paused ? '▶' : 'Ⅱ'; ui.play.setAttribute('aria-label', paused ? 'Play' : 'Pause'); ui.play.title = paused ? 'Play' : 'Pause';
}
ui.load.addEventListener('click', () => startSource());
ui.sample.addEventListener('click', () => { ui.source.value = SINTEL_MAGNET; ui.sourceMode.value = 'auto'; ui.engineMode.value = 'browser'; startSource(SINTEL_MAGNET); });
ui.stop.addEventListener('click', () => stopActive(true));
ui.chooseTorrent.addEventListener('click', () => ui.torrentFile.click());
ui.torrentFile.addEventListener('change', () => {
  const file = ui.torrentFile.files?.[0]; if (!file) return;
  if (!file.name.toLowerCase().endsWith('.torrent') && file.type !== 'application/x-bittorrent') { setStatus('Choose a .torrent file.', 'error'); ui.torrentFile.value = ''; return; }
  startSource('', file); ui.torrentFile.value = '';
});
ui.paste.addEventListener('click', async () => {
  try { if (!navigator.clipboard?.readText) throw new Error('Clipboard read is unavailable in this browser.'); ui.source.value = await navigator.clipboard.readText(); setStatus('Clipboard text pasted into the source box. Review it before loading.', 'success'); }
  catch (error) { setStatus(`Could not read clipboard: ${error.message}. Long-press the source box and select Paste instead.`, 'warning'); }
});
ui.checkBridge.addEventListener('click', () => checkBridge(true).catch(() => {}));
ui.engineMode.addEventListener('change', () => { ui.engineBadge.textContent = ui.engineMode.value === 'local' ? 'MY PHONE ENGINE' : 'CLIENT-SIDE WEBRTC'; });
ui.play.addEventListener('click', async () => {
  if (ui.video.paused) { try { await ui.video.play(); } catch (_) { setStatus('Playback was blocked or the media is not ready. Check the error status, then try Play again.', 'warning'); } }
  else ui.video.pause();
});
ui.video.addEventListener('click', () => { if (ui.video.paused) ui.video.play().catch(() => {}); else ui.video.pause(); });
ui.video.addEventListener('play', syncPlayButton); ui.video.addEventListener('pause', syncPlayButton);
ui.video.addEventListener('timeupdate', () => {
  $('currentTime').textContent = prettyTime(ui.video.currentTime);
  if (!state.scrubbing && Number.isFinite(ui.video.duration) && ui.video.duration > 0) ui.seek.value = String(Math.round((ui.video.currentTime / ui.video.duration) * 1000));
});
ui.video.addEventListener('loadedmetadata', () => { $('duration').textContent = prettyTime(ui.video.duration); ui.seek.disabled = !Number.isFinite(ui.video.duration) || ui.video.duration <= 0; });
ui.video.addEventListener('durationchange', () => { $('duration').textContent = prettyTime(ui.video.duration); });
ui.video.addEventListener('waiting', () => { if (state.currentKind !== 'none') setBadge('BUFFER'); });
ui.video.addEventListener('stalled', () => { if (state.currentKind !== 'none') setStatus('Media source stalled. The source may be slow, unavailable, or missing the requested range.', 'warning'); });
ui.video.addEventListener('playing', () => { if (state.currentKind !== 'none') setBadge('PLAYING'); });
ui.video.addEventListener('error', () => {
  const code = ui.video.error?.code;
  if (state.currentKind !== 'none' && code) {
    const desc = ({ 1: 'Playback aborted.', 2: 'Network error while fetching media (check source URL/CORS/range support).', 3: 'Media decode error (unsupported or damaged codec/container).', 4: 'Source format or media URL is not supported.' })[code] || 'Unknown HTML media error.';
    setStatus(`${desc} Test an H.264/AAC MP4 and confirm the source is accessible in this browser.`, 'error'); setBadge('ERROR');
  }
});
ui.seek.addEventListener('input', () => { state.scrubbing = true; if (Number.isFinite(ui.video.duration)) $('currentTime').textContent = prettyTime((Number(ui.seek.value) / 1000) * ui.video.duration); });
ui.seek.addEventListener('change', () => { if (Number.isFinite(ui.video.duration)) ui.video.currentTime = (Number(ui.seek.value) / 1000) * ui.video.duration; state.scrubbing = false; });
ui.mute.addEventListener('click', () => { ui.video.muted = !ui.video.muted; ui.mute.textContent = ui.video.muted ? '×)' : '◖))'; ui.mute.setAttribute('aria-label', ui.video.muted ? 'Unmute' : 'Mute'); });
ui.volume.addEventListener('input', () => { ui.video.volume = Number(ui.volume.value); ui.video.muted = ui.video.volume === 0; ui.mute.textContent = ui.video.muted ? '×)' : '◖))'; });
ui.speed.addEventListener('change', () => { ui.video.playbackRate = Number(ui.speed.value); });
ui.fullscreen.addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else if (ui.stage.requestFullscreen) await ui.stage.requestFullscreen(); else if (ui.video.webkitEnterFullscreen) ui.video.webkitEnterFullscreen(); }
  catch (_) { setStatus('Fullscreen is unavailable in this browser context.', 'warning'); }
});

// A prefilled ?magnet= or ?url= query can share a link without automatically starting playback.
try {
  const params = new URLSearchParams(location.search);
  const initial = params.get('magnet') || params.get('url');
  if (initial) ui.source.value = initial;
} catch (_) {}
window.addEventListener('pagehide', () => {
  clearTimers();
  try { state.hls?.destroy(); state.dash?.reset(); state.client?.destroy(); } catch (_) {}
});
