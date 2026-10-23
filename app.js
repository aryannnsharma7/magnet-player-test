const $ = (id) => document.getElementById(id);
const magnetInput = $('magnetInput');
const startBtn = $('startBtn');
const sampleBtn = $('sampleBtn');
const stopBtn = $('stopBtn');
const statusBox = $('statusBox');
const statusText = $('statusText');
const video = $('video');
const playerStage = $('playerStage');
const emptyPlayer = $('emptyPlayer');
const fileList = $('fileList');
const fileEmpty = $('fileEmpty');
const fileCount = $('fileCount');
const seekBar = $('seekBar');
const playBtn = $('playBtn');
const muteBtn = $('muteBtn');
const volumeBar = $('volumeBar');
const fullscreenBtn = $('fullscreenBtn');

const SINTEL_MAGNET = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A1337&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.fastcast.nz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com&ws=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2F&xs=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2Fsintel.torrent';
const MEDIA_EXTENSIONS = /\.(mp4|m4v|mkv|webm|mov|ogv|ogg|mp3|m4a|wav|flac|aac|opus|3gp|3g2)$/i;
const AUDIO_EXTENSIONS = /\.(mp3|m4a|wav|flac|aac|opus|ogg)$/i;

let WebTorrentClass = null;
let client = null;
let activeTorrent = null;
let selectedFile = null;
let serverCreated = false;
let statsTimer = null;
let scrubbing = false;

function setStatus(message, kind = 'idle') {
  statusText.textContent = message;
  statusBox.dataset.kind = kind;
}

function prettyBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function prettySpeed(value) {
  const n = Number(value) || 0;
  return n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(2)} MB/s` : `${(n / 1024).toFixed(1)} KB/s`;
}

function prettyTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function resetStats() {
  $('peerCount').textContent = '—';
  $('downloaded').textContent = '0 MB';
  $('downloadSpeed').textContent = '0 KB/s';
  $('uploadSpeed').textContent = '0 KB/s';
  $('progressLabel').textContent = '0%';
  $('progressFill').style.width = '0%';
}

function resetPlayer() {
  video.pause();
  video.removeAttribute('src');
  video.load();
  video.classList.add('hidden');
  emptyPlayer.classList.remove('hidden');
  $('playerTitle').textContent = 'Custom player';
  $('playerSubtitle').textContent = 'Your selected media will appear here';
  $('playerBadge').textContent = 'IDLE';
  $('currentTime').textContent = '0:00';
  $('duration').textContent = '0:00';
  seekBar.value = '0';
  seekBar.disabled = true;
  playBtn.disabled = true;
  muteBtn.disabled = true;
  volumeBar.disabled = true;
  fullscreenBtn.disabled = true;
  playBtn.textContent = '▶';
  playBtn.setAttribute('aria-label', 'Play');
  fileList.replaceChildren();
  fileEmpty.classList.remove('hidden');
  fileEmpty.textContent = 'No torrent files loaded.';
  fileCount.textContent = '0 files';
  selectedFile = null;
}

async function ensureClient() {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    throw new Error('This prototype needs an HTTPS website (or localhost) with service-worker support. Upload it to a static HTTPS host before testing.');
  }

  if (!WebTorrentClass) {
    setStatus('Loading browser torrent engine…', 'working');
    const mod = await import('https://esm.sh/webtorrent@3.0.21/dist/webtorrent.min.js');
    WebTorrentClass = mod.default || mod.WebTorrent;
    if (!WebTorrentClass) throw new Error('The WebTorrent module did not expose its browser client.');
  }

  if (!WebTorrentClass.WEBRTC_SUPPORT) {
    throw new Error('WebRTC is unavailable in this browser. Try an up-to-date Chrome or Firefox browser.');
  }

  if (!client) {
    client = new WebTorrentClass();
    client.on('error', (error) => setStatus(`Torrent client error: ${error.message || error}`, 'error'));
  }

  if (!serverCreated) {
    setStatus('Preparing secure streaming bridge…', 'working');
    const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    await navigator.serviceWorker.ready;
    client.createServer({ controller: registration });
    serverCreated = true;
  }
}

function supportedMediaFiles(torrent) {
  return torrent.files
    .filter((file) => MEDIA_EXTENSIONS.test(file.name))
    .sort((a, b) => {
      const aVideo = !AUDIO_EXTENSIONS.test(a.name);
      const bVideo = !AUDIO_EXTENSIONS.test(b.name);
      if (aVideo !== bVideo) return aVideo ? -1 : 1;
      return b.length - a.length;
    });
}

function renderFileList(torrent, files) {
  fileList.replaceChildren();
  fileCount.textContent = `${files.length} file${files.length === 1 ? '' : 's'}`;
  fileEmpty.classList.toggle('hidden', files.length > 0);
  fileEmpty.textContent = files.length
    ? ''
    : `Torrent metadata loaded (${torrent.files.length} total files), but no common playable media extension was detected.`;

  for (const file of files) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'file-row';
    const dot = document.createElement('span');
    dot.className = 'file-dot';
    dot.textContent = AUDIO_EXTENSIONS.test(file.name) ? 'AUD' : 'VID';
    const meta = document.createElement('span');
    meta.className = 'file-meta';
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = file.name;
    const size = document.createElement('span');
    size.className = 'file-size';
    size.textContent = prettyBytes(file.length);
    meta.append(name, size);
    button.append(dot, meta);
    button.addEventListener('click', () => selectMediaFile(file, torrent, button));
    fileList.append(button);
  }
}

function selectMediaFile(file, torrent, button) {
  selectedFile = file;
  for (const row of fileList.querySelectorAll('.file-row')) row.classList.remove('active');
  button?.classList.add('active');
  video.pause();
  video.removeAttribute('src');
  video.load();
  video.classList.remove('hidden');
  emptyPlayer.classList.add('hidden');

  $('playerTitle').textContent = file.name;
  $('playerSubtitle').textContent = `${prettyBytes(file.length)} · streaming from the browser client`;
  $('playerBadge').textContent = 'READY';
  seekBar.disabled = false;
  playBtn.disabled = false;
  muteBtn.disabled = false;
  volumeBar.disabled = false;
  fullscreenBtn.disabled = false;

  try {
    file.streamTo(video);
    setStatus('Media source connected. Tap Play if playback does not begin automatically.', 'success');
    $('playerBadge').textContent = 'STREAM';
    video.play().catch(() => {});
  } catch (error) {
    setStatus(`Could not open this media file: ${error.message || error}`, 'error');
    $('playerBadge').textContent = 'ERROR';
  }
}

function attachTorrent(torrent) {
  let readyRendered = false;
  activeTorrent = torrent;
  stopBtn.disabled = false;
  startBtn.disabled = true;
  sampleBtn.disabled = true;
  $('playerBadge').textContent = 'FINDING';
  $('playerSubtitle').textContent = 'Looking up torrent metadata and peers…';
  setStatus('Magnet accepted. Looking for metadata and compatible peers…', 'working');
  torrent.on('error', (error) => setStatus(`Torrent error: ${error.message || error}`, 'error'));
  torrent.on('warning', (warning) => setStatus(`Torrent warning: ${warning.message || warning}`, 'working'));

  const onReady = () => {
    if (activeTorrent !== torrent || readyRendered) return;
    readyRendered = true;
    $('playerBadge').textContent = 'FOUND';
    $('playerSubtitle').textContent = `${torrent.name || 'Torrent'} · ${torrent.files.length} file(s) discovered`;
    const files = supportedMediaFiles(torrent);
    renderFileList(torrent, files);
    setStatus(
      files.length
        ? `Torrent metadata loaded. Found ${files.length} playable media file(s); select one below.`
        : 'Metadata loaded, but this torrent does not contain a supported media filename.',
      files.length ? 'success' : 'idle'
    );
    if (files.length === 1) {
      const onlyButton = fileList.querySelector('.file-row');
      selectMediaFile(files[0], torrent, onlyButton);
    }
  };

  torrent.on('ready', onReady);
  if (torrent.ready) onReady();
  clearInterval(statsTimer);
  statsTimer = setInterval(updateStats, 800);
  updateStats();
}

function updateStats() {
  if (!activeTorrent) return;
  const t = activeTorrent;
  $('peerCount').textContent = String(t.numPeers ?? 0);
  $('downloaded').textContent = prettyBytes(t.downloaded);
  $('downloadSpeed').textContent = prettySpeed(t.downloadSpeed);
  $('uploadSpeed').textContent = prettySpeed(t.uploadSpeed);
  const p = Math.max(0, Math.min(100, (Number(t.progress) || 0) * 100));
  $('progressLabel').textContent = `${p.toFixed(1)}%`;
  $('progressFill').style.width = `${p}%`;
}

async function startMagnet(rawMagnet) {
  const magnet = (rawMagnet || '').trim();
  if (!/^magnet:\?/i.test(magnet) || !/[?&]xt=urn:btih:/i.test(magnet)) {
    setStatus('Please paste a valid magnet URI starting with magnet:?xt=urn:btih:', 'error');
    return;
  }

  startBtn.disabled = true;
  sampleBtn.disabled = true;
  try {
    await stopTorrent(false);
    resetPlayer();
    resetStats();
    await ensureClient();
    const torrent = client.add(magnet);
    attachTorrent(torrent);
  } catch (error) {
    setStatus(error.message || String(error), 'error');
    startBtn.disabled = false;
    sampleBtn.disabled = false;
    stopBtn.disabled = !activeTorrent;
  }
}

async function stopTorrent(showMessage = true) {
  clearInterval(statsTimer);
  statsTimer = null;
  const torrentToRemove = activeTorrent;
  activeTorrent = null;
  if (torrentToRemove && client) {
    try {
      await client.remove(torrentToRemove.infoHash);
    } catch (_) {
      // Continue resetting the interface even if torrent cleanup reports an error.
    }
  }
  resetPlayer();
  resetStats();
  stopBtn.disabled = true;
  startBtn.disabled = false;
  sampleBtn.disabled = false;
  if (showMessage) setStatus('Torrent stopped and disconnected.', 'idle');
}

function syncPlayButton() {
  const paused = video.paused;
  playBtn.textContent = paused ? '▶' : 'Ⅱ';
  playBtn.setAttribute('aria-label', paused ? 'Play' : 'Pause');
  playBtn.title = paused ? 'Play' : 'Pause';
}

startBtn.addEventListener('click', () => startMagnet(magnetInput.value));
sampleBtn.addEventListener('click', () => {
  magnetInput.value = SINTEL_MAGNET;
  startMagnet(SINTEL_MAGNET);
});
stopBtn.addEventListener('click', () => stopTorrent(true));
playBtn.addEventListener('click', async () => {
  if (!selectedFile) return;
  if (video.paused) {
    try { await video.play(); }
    catch (_) { setStatus('Playback was blocked. Tap Play once more or check the media codec.', 'working'); }
  } else {
    video.pause();
  }
});
video.addEventListener('click', () => {
  if (!selectedFile) return;
  if (video.paused) video.play().catch(() => {});
  else video.pause();
});
video.addEventListener('play', syncPlayButton);
video.addEventListener('pause', syncPlayButton);
video.addEventListener('timeupdate', () => {
  $('currentTime').textContent = prettyTime(video.currentTime);
  if (!scrubbing && Number.isFinite(video.duration) && video.duration > 0) {
    seekBar.value = String(Math.round((video.currentTime / video.duration) * 1000));
  }
});
video.addEventListener('loadedmetadata', () => {
  $('duration').textContent = prettyTime(video.duration);
  seekBar.disabled = !Number.isFinite(video.duration) || video.duration <= 0;
});
video.addEventListener('durationchange', () => { $('duration').textContent = prettyTime(video.duration); });
video.addEventListener('waiting', () => { if (selectedFile) $('playerBadge').textContent = 'BUFFER'; });
video.addEventListener('playing', () => { if (selectedFile) $('playerBadge').textContent = 'PLAYING'; });
video.addEventListener('error', () => {
  if (selectedFile && video.error) {
    setStatus('The browser could not play this container/codec, or the stream has no available pieces. Try an MP4 with H.264/AAC and WebRTC-capable peers.', 'error');
  }
});
seekBar.addEventListener('input', () => {
  scrubbing = true;
  if (Number.isFinite(video.duration)) $('currentTime').textContent = prettyTime((Number(seekBar.value) / 1000) * video.duration);
});
seekBar.addEventListener('change', () => {
  if (Number.isFinite(video.duration)) video.currentTime = (Number(seekBar.value) / 1000) * video.duration;
  scrubbing = false;
});
muteBtn.addEventListener('click', () => {
  video.muted = !video.muted;
  muteBtn.textContent = video.muted ? '×)' : '◖))';
  muteBtn.setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute');
});
volumeBar.addEventListener('input', () => {
  video.volume = Number(volumeBar.value);
  video.muted = video.volume === 0;
  muteBtn.textContent = video.muted ? '×)' : '◖))';
});
fullscreenBtn.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (playerStage.requestFullscreen) await playerStage.requestFullscreen();
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  } catch (_) { setStatus('Fullscreen is not available in this browser context.', 'working'); }
});

// Accept a magnet query parameter so a link can open this player directly:
// https://your-site.example/?magnet=<URL-encoded-magnet-uri>
try {
  const fromQuery = new URLSearchParams(window.location.search).get('magnet');
  if (fromQuery && fromQuery.startsWith('magnet:?')) magnetInput.value = fromQuery;
} catch (_) {}

window.addEventListener('pagehide', () => {
  clearInterval(statsTimer);
  if (client) {
    try { client.destroy(); } catch (_) {}
  }
});
