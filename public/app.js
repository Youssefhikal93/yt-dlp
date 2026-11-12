'use strict';

const $ = id => document.getElementById(id);
const state = {
  status: null,
  info: null,          // details of the looked-up video/playlist (single mode)
  url: '',
  batch: null,         // array of links when several were pasted
  mode: 'video',
  quality: 1080,
  container: 'mp4',
  audioFormat: 'mp3',
  audioQuality: '0',
  playlist: false,
  jobs: new Map(),
};

// ---------- helpers ----------
async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: 'The app stopped responding. Is its window still open?' }));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

function fmtDuration(s) {
  if (!s) return '';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(sec).padStart(2, '0')}`;
}
function fmtBytes(b) {
  if (!b) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(b < 10 && i ? 1 : 0)} ${u[i]}`;
}
function fmtEta(s) {
  if (s === null || s === undefined) return '';
  if (s < 60) return `${Math.max(1, Math.round(s))} s left`;
  if (s < 3600) return `${Math.round(s / 60)} min left`;
  return `${(s / 3600).toFixed(1)} h left`;
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

function setLoading(btn, on) { btn.disabled = on; btn.classList.toggle('loading', on); }

function setSeg(container, key, value) {
  for (const b of container.querySelectorAll(`[data-${key}]`)) b.classList.toggle('on', b.dataset[key] === value);
}

// ---------- status & banners ----------
let statusTimer;
async function refreshStatus() {
  try {
    state.status = await api('/api/status');
  } catch {
    $('statusPill').textContent = 'Not running';
    $('statusPill').className = 'pill';
    renderBanners(true);
    return schedule(4000);
  }
  renderStatus();
  const busy = state.status.ytdlp !== 'ready' && state.status.ytdlp !== 'error';
  const ff = state.status.ffmpegInstall && state.status.ffmpegInstall.state !== 'error';
  schedule(busy || ff ? 1000 : 15000);
}
function schedule(ms) { clearTimeout(statusTimer); statusTimer = setTimeout(refreshStatus, ms); }

function renderStatus() {
  const s = state.status;
  const pill = $('statusPill');
  const labels = { checking: 'Starting…', downloading: 'Setting up…', updating: 'Updating…', ready: 'Ready', error: 'Setup problem' };
  pill.textContent = labels[s.ytdlp] || s.ytdlp;
  pill.className = 'pill' + (s.ytdlp === 'ready' ? ' ok' : '');
  $('saveDir').textContent = s.downloadDir;
  $('versionText').textContent = s.ytdlpVersion ? `Downloader version ${s.ytdlpVersion}` : '';
  $('fetchBtn').disabled = s.ytdlp !== 'ready';
  renderBanners(false);
}

function renderBanners(offline) {
  const box = $('banners');
  box.replaceChildren();
  if (offline) {
    box.append(el('div', { class: 'banner err' }, el('p', {}, 'The app is not running. Start YT Downloader again, then reload this page.')));
    return;
  }
  const s = state.status;
  if (s.ytdlp === 'downloading') {
    box.append(el('div', { class: 'banner' }, el('p', {}, `Getting things ready for first use… ${s.progress ?? 0}%`)));
  } else if (s.ytdlp === 'checking' || s.ytdlp === 'updating') {
    box.append(el('div', { class: 'banner' }, el('p', {}, 'Checking for downloader updates…')));
  } else if (s.ytdlp === 'error') {
    box.append(el('div', { class: 'banner err' },
      el('p', {}, `Couldn't set up the downloader: ${s.error}. Check your internet connection and restart the app.`)));
  }

  const fi = s.ffmpegInstall;
  if (fi && fi.state !== 'error') {
    box.append(el('div', { class: 'banner' }, el('p', {},
      fi.state === 'downloading' ? `Installing FFmpeg… ${fi.percent}%` : 'Installing FFmpeg… unpacking')));
  } else if (!s.ffmpeg) {
    const isWin = s.platform === 'win32';
    const text = fi && fi.state === 'error'
      ? `FFmpeg install failed: ${fi.error}`
      : 'FFmpeg is missing. Without it you can\'t make MP3s, get the best video quality, or add subtitles.';
    box.append(el('div', { class: 'banner' },
      el('p', {}, text, isWin ? '' : ' Install it from ffmpeg.org (Mac: "brew install ffmpeg"), then restart the app.'),
      isWin ? el('button', { class: 'btn primary small', onclick: installFfmpeg }, 'Install FFmpeg (≈ 140 MB)') : null));
  }
}

async function installFfmpeg(e) {
  setLoading(e.currentTarget, true);
  try { state.status = await api('/api/install-ffmpeg', {}); renderStatus(); schedule(500); }
  catch (err) { toast(err.message); }
}

// ---------- link box: one link, several links, or a search ----------
function readInput() {
  const text = $('urlInput').value.trim();
  const links = [...new Set(text.match(/https?:\/\/[^\s<>"']+/g) || [])];
  if (links.length > 1) return { kind: 'batch', links };
  if (links.length === 1) return { kind: 'link', url: links[0] };
  return text ? { kind: 'search', query: text } : { kind: 'empty' };
}

function updateGoButton() {
  const input = readInput();
  $('fetchBtn').textContent = input.kind === 'search' ? 'Search'
    : input.kind === 'batch' ? `Use ${input.links.length} links` : 'Find video';
  const box = $('urlInput');
  box.style.height = 'auto';
  box.style.height = Math.min(box.scrollHeight, 220) + 'px';
}

async function go() {
  const input = readInput();
  if (input.kind === 'empty') return;
  $('linkError').hidden = true;
  $('searchResults').hidden = true;
  if (input.kind === 'batch') return showBatch(input.links);
  if (input.kind === 'search') return search(input.query);
  return findVideo(input.url);
}

function showError(msg) {
  $('linkError').textContent = msg;
  $('linkError').hidden = false;
}

// Each lookup gets a number; a slow answer to an older lookup is ignored when a newer one exists.
let lookupId = 0;
async function withBusy(label, fn) {
  const id = ++lookupId;
  const btn = $('fetchBtn');
  setLoading(btn, true);
  btn.textContent = label;
  const isCurrent = () => id === lookupId;
  try { await fn(isCurrent); } catch (err) { if (isCurrent()) showError(err.message); }
  finally { if (isCurrent()) { setLoading(btn, false); updateGoButton(); } }
}

function findVideo(url) {
  $('optionsCard').hidden = true;
  return withBusy('Looking…', async isCurrent => {
    const info = await api('/api/info', { url });
    if (!isCurrent()) return;
    state.info = info;
    state.url = url;
    state.batch = null;
    renderOptions();
  });
}

function search(query) {
  $('optionsCard').hidden = true;
  return withBusy('Searching…', async isCurrent => {
    const { results } = await api('/api/search', { query });
    if (!isCurrent()) return;
    if (!results.length) return showError('Nothing found. Try other words.');
    $('searchResults').replaceChildren(...results.map(r => el('li', {},
      el('button', { type: 'button', class: 'result', onclick: () => { $('urlInput').value = r.url; updateGoButton(); $('searchResults').hidden = true; findVideo(r.url); } },
        el('span', { class: 'r-thumb' }, el('img', { src: r.thumbnail || 'icon.svg', alt: '', loading: 'lazy' }),
          r.live ? el('span', { class: 'live-badge' }, 'LIVE') : r.duration ? el('span', { class: 'badge' }, fmtDuration(r.duration)) : null),
        el('span', { class: 'r-text' }, el('b', {}, r.title), el('small', { class: 'muted' }, r.channel || ''))))));
    $('searchResults').hidden = false;
  });
}

function showBatch(links) {
  lookupId++; // cancels any lookup still running
  setLoading($('fetchBtn'), false);
  state.batch = links;
  state.info = {
    title: `${links.length} links`,
    heights: [], hasVideo: true, subtitles: [], isPlaylist: false, live: null,
  };
  renderOptions();
}

// ---------- options ----------
const TIERS = [[2160, '4K'], [1440, '2K'], [1080, 'Full HD'], [720, 'HD'], [480, 'SD'], [360, 'Small file']];
const SUB_LANGS = ['en', 'es', 'fr', 'de', 'ar', 'pt', 'it', 'nl', 'sv', 'tr', 'ru', 'hi', 'ja', 'ko', 'zh-Hans'];

function renderOptions() {
  const info = state.info;
  const batch = state.batch;

  $('pvThumb').src = info.thumbnail || 'icon.svg';
  $('pvTitle').textContent = info.title;
  $('pvDuration').textContent = fmtDuration(info.duration);
  const meta = [info.uploader, info.site].filter(Boolean);
  if (info.isPlaylist) meta.unshift(`Playlist · ${info.count} items`);
  if (batch) meta.push('Each link is downloaded with the options below');
  $('pvMeta').textContent = meta.join(' · ');
  $('pvLinks').hidden = !batch;
  if (batch) {
    const items = batch.slice(0, 8).map(u => el('li', {}, u));
    if (batch.length > 8) items.push(el('li', {}, `…and ${batch.length - 8} more`));
    $('pvLinks').replaceChildren(...items);
  }

  // playlist
  state.playlist = !!info.isPlaylist;
  $('playlistChoice').hidden = !info.playlist;
  if (info.playlist) {
    $('plAllBtn').textContent = `Whole playlist (${info.playlist.count})`;
    setSeg($('playlistChoice'), 'pl', '0');
  }
  $('optItems').value = '';
  $('optName').value = batch ? '' : (info.title || '').replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim();
  updateItemsRow();

  // A clip range belongs to one video, so don't carry it over to the next one.
  $('optStart').value = '';
  $('optEnd').value = '';
  updateMoreSummary();

  // live streams
  $('pvLive').hidden = !info.live;
  $('pvLive').textContent = info.live === 'upcoming' ? 'SOON' : 'LIVE';
  $('liveRow').hidden = !info.live;
  $('optLiveStart').checked = info.live === 'upcoming';
  $('liveLabel').textContent = info.live === 'upcoming' ? 'Wait for the stream to start, then record it' : 'Record from the beginning of the stream';

  // quality chips
  const heights = info.heights || [];
  const tiers = heights.length
    ? TIERS.filter(([t]) => heights.some(h => Math.abs(h - t) <= t * 0.1))
    : TIERS;
  const chips = [['0', 'Best', 'highest'], ...tiers.map(([t, n]) => [String(t), `${t}p`, n])];
  $('qualityChips').replaceChildren(...chips.map(([v, label, sub]) =>
    el('button', { type: 'button', 'data-q': v }, label, ' ', el('small', {}, sub))));
  state.quality = tiers.some(([t]) => t === 1080) ? 1080 : 0;
  setSeg($('qualityChips'), 'q', String(state.quality));

  // audio-only sites (SoundCloud, podcasts…)
  const videoBtn = document.querySelector('[data-mode="video"]');
  videoBtn.disabled = !info.hasVideo;
  setMode(info.hasVideo ? state.mode : 'audio');

  // subtitles
  const names = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames([navigator.language], { type: 'language' }) : null;
  const available = info.subtitles || [];
  const langs = [...new Set([...available, ...SUB_LANGS])];
  $('optSubLang').replaceChildren(...langs.map(l => {
    let name = l;
    try { name = names ? `${names.of(l)}` : l; } catch {}
    return el('option', { value: l }, name + (available.includes(l) ? ' ✓' : ''));
  }));
  // Prefer English, else whatever the video actually has (e.g. only Swedish on TV4 Play).
  $('optSubLang').value = available.find(l => l.startsWith('en')) || available[0] || 'en';

  $('downloadLabel').textContent = batch ? `Download all ${batch.length}` : info.live ? 'Record' : 'Download';
  $('optionsCard').hidden = false;
  $('optionsCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Show on the collapsed "More options" line which options are switched on, so nothing applies unseen.
function updateMoreSummary() {
  const on = [];
  if ($('optSubs').checked && state.mode === 'video') on.push('subtitles');
  if ($('optStart').value || $('optEnd').value) on.push('only part');
  if ($('optSponsor').checked) on.push('skip sponsors');
  if ($('optExtra').value.trim()) on.push('extra options');
  $('moreSummary').textContent = on.length ? ` · on: ${on.join(', ')}` : '';
}

function updateItemsRow() {
  const info = state.info;
  const count = info.playlist ? info.playlist.count : info.count;
  $('itemsRow').hidden = !state.playlist;
  $('optItems').placeholder = count ? `all ${count}` : 'all';
  // Renaming only makes sense for a single file.
  $('nameRow').hidden = state.playlist || !!state.batch;
}

function setMode(mode) {
  state.mode = mode;
  setSeg($('modeChoice'), 'mode', mode);
  $('qualityStep').hidden = mode !== 'video';
  $('audioStep').hidden = mode !== 'audio';
  $('subsRow').hidden = mode !== 'video';
  updateBitrate();
  updateMoreSummary();
}

function updateBitrate() {
  // Bitrate only matters for lossy formats.
  $('bitrateBox').hidden = !['mp3', 'm4a'].includes(state.audioFormat);
}

// ---------- start download ----------
function currentOptions() {
  const info = state.info;
  return {
    mode: state.mode,
    quality: state.quality,
    container: state.container,
    audioFormat: state.audioFormat,
    audioQuality: state.audioQuality,
    subtitles: $('optSubs').checked,
    subLang: $('optSubLang').value,
    subMode: $('optSubMode').value,
    clipStart: $('optStart').value,
    clipEnd: $('optEnd').value,
    sponsorblock: $('optSponsor').checked,
    extraArgs: $('optExtra').value,
    live: !!info.live,
    liveFromStart: info.live === 'live' && $('optLiveStart').checked,
    waitForLive: info.live === 'upcoming' && $('optLiveStart').checked,
  };
}

async function startDownload() {
  const btn = $('downloadBtn');
  setLoading(btn, true);
  try {
    const opts = currentOptions();
    if (state.batch) {
      for (const url of state.batch) await api('/api/download', { ...opts, url, playlist: false });
      toast(`Added ${state.batch.length} downloads`);
    } else {
      const info = state.info;
      const plInfo = state.playlist && info.playlist ? info.playlist : null;
      await api('/api/download', {
        ...opts,
        url: state.url,
        title: plInfo ? plInfo.title : info.title,
        thumbnail: info.thumbnail,
        count: plInfo ? plInfo.count : info.count,
        playlist: state.playlist,
        items: state.playlist ? $('optItems').value : '',
        fileName: state.playlist ? '' : $('optName').value,
      });
      toast('Added to your downloads');
    }
    $('downloadsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    toast(err.message);
  } finally {
    setLoading(btn, false);
  }
}

// ---------- downloads list ----------
function jobStatusText(j) {
  const prefix = j.isPlaylist && j.item && j.item.index
    ? `Item ${j.item.index}${j.item.count || j.count ? ` of ${j.item.count || j.count}` : ''} · ` : '';
  switch (j.status) {
    case 'queued': return 'Waiting for another download to finish…';
    case 'cancelling': return 'Stopping…';
    case 'cancelled': return 'Stopped';
    case 'error': return j.error || 'Failed';
    case 'done': {
      const n = j.files.length;
      if (!n && j.warning) return j.warning;
      const base = n > 1 ? `Done · ${n} files saved` : 'Done · saved to your folder';
      return j.warning ? `${base}. ${j.warning}` : base;
    }
  }
  if (j.phase === 'processing') return prefix + (j.mode === 'audio' ? 'Converting audio…' : 'Finishing up…');
  if (j.phase === 'starting' || j.phase === null) return prefix + (j.live ? 'Waiting for the stream…' : 'Starting…');
  if (!j.size) {
    // Live streams and some sites don't say how big the file will be.
    const parts = [`${j.live ? 'Recording' : 'Downloading'} · ${fmtBytes(j.downloaded) || '0 B'}`];
    if (j.recorded) parts.push(`${fmtDuration(j.recorded)} recorded`);
    if (j.speed) parts.push(`${fmtBytes(j.speed)}/s`);
    return prefix + parts.join(' · ');
  }
  const parts = [`${j.phase === 'audio' ? 'Getting sound' : 'Downloading'} ${Math.floor(j.percent)}%`];
  parts.push(fmtBytes(j.size));
  if (j.speed) parts.push(`${fmtBytes(j.speed)}/s`);
  if (j.eta !== null && j.eta !== undefined) parts.push(fmtEta(j.eta));
  return prefix + parts.join(' · ');
}

function renderJob(j) {
  let li = document.querySelector(`[data-job="${j.id}"]`);
  if (!li) {
    li = el('li', { 'data-job': j.id });
    $('jobList').prepend(li);
  }
  li.className = `job ${j.status}`;
  const running = j.status === 'running' || j.status === 'cancelling';
  const indeterminate = running && (j.phase === 'processing' || j.phase === 'starting' || !j.phase || !j.size);
  const pct = j.status === 'done' ? 100 : j.percent || 0;

  const actions = [];
  if (j.status === 'queued' || j.status === 'running') actions.push(el('button', { class: 'btn ghost small', onclick: () => api('/api/cancel', { id: j.id }).catch(e => toast(e.message)) }, 'Cancel'));
  if (j.status === 'done' && j.files.length) actions.push(el('button', { class: 'btn primary small', onclick: () => api('/api/open', { id: j.id }) }, 'Show file'));
  if (j.status === 'error' || j.status === 'cancelled') actions.push(el('button', { class: 'btn ghost small', onclick: () => api('/api/retry', { id: j.id }).catch(e => toast(e.message)) }, 'Try again'));

  li.replaceChildren(
    el('img', { src: j.thumbnail || 'icon.svg', alt: '' }),
    el('div', { class: 'body' },
      el('div', { class: 'title', title: j.title }, el('span', { class: 'tag' }, j.label), j.title),
      el('div', { class: 'status' }, jobStatusText(j)),
      j.status === 'error' || j.status === 'cancelled' ? null
        : el('div', { class: 'bar' + (indeterminate ? ' indet' : '') }, el('i', { style: `width:${pct}%` }))),
    el('div', { class: 'actions' }, actions),
  );
  $('downloadsSection').hidden = false;
}

function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('snapshot', e => {
    state.jobs.clear();
    $('jobList').replaceChildren();
    const list = JSON.parse(e.data).sort((a, b) => a.createdAt - b.createdAt);
    for (const j of list) { state.jobs.set(j.id, j); renderJob(j); }
    $('downloadsSection').hidden = state.jobs.size === 0;
  });
  es.addEventListener('job', e => {
    const j = JSON.parse(e.data);
    const prev = state.jobs.get(j.id);
    state.jobs.set(j.id, j);
    renderJob(j);
    if (prev && prev.status !== 'done' && j.status === 'done' && j.files.length) toast(`Finished: ${j.title}`);
  });
  es.addEventListener('cleared', () => {
    for (const [id, j] of state.jobs) {
      if (['done', 'error', 'cancelled'].includes(j.status)) {
        state.jobs.delete(id);
        document.querySelector(`[data-job="${id}"]`)?.remove();
      }
    }
    $('downloadsSection').hidden = state.jobs.size === 0;
  });
  es.onerror = () => refreshStatus();
}

// ---------- folder & settings ----------
async function pickFolder() {
  // Opens the computer's own folder picker; returns false if that isn't possible.
  if (state.status.platform === 'linux') return false;
  try { state.status = await api('/api/pick-folder', {}); renderStatus(); return true; }
  catch { return false; }
}

async function changeFolder() {
  const btn = $('changeDirBtn');
  setLoading(btn, true);
  const ok = await pickFolder();
  setLoading(btn, false);
  if (!ok) openSettings();
}

function openSettings() {
  if (!state.status) return toast('The app is still starting. Try again in a moment.');
  const s = state.status.settings || {};
  $('setDir').value = state.status.downloadDir;
  $('setBrowser').value = s.browser || '';
  $('setArchive').checked = !!s.useArchive;
  $('setRate').value = s.rateLimit || '';
  if ($('setRate').value !== (s.rateLimit || '')) $('setRate').append(el('option', { value: s.rateLimit, selected: true }, s.rateLimit));
  $('setParallel').value = String(s.maxParallel || 2);
  $('setProxy').value = s.proxy || '';
  $('setTv4Token').value = '';
  $('setTv4Token').placeholder = s.hasTv4Token ? 'saved (paste a new one to replace it)' : 'not set';
  $('setTv4Clear').hidden = !s.hasTv4Token;
  state.clearTv4Token = false;
  $('settingsError').hidden = true;
  $('settingsDialog').showModal();
}

$('setDirBrowse').addEventListener('click', async e => {
  setLoading(e.currentTarget, true);
  const ok = await pickFolder();
  setLoading(e.currentTarget, false);
  if (ok) $('setDir').value = state.status.downloadDir;
  else toast('Type the folder path in the box instead.');
});

$('setTv4Clear').addEventListener('click', () => {
  state.clearTv4Token = true;
  $('setTv4Token').value = '';
  $('setTv4Token').placeholder = 'will be removed when you save';
  $('setTv4Clear').hidden = true;
});

$('settingsSave').addEventListener('click', async e => {
  e.preventDefault();
  try {
    state.status = await api('/api/settings', {
      downloadDir: $('setDir').value,
      browser: $('setBrowser').value,
      useArchive: $('setArchive').checked,
      rateLimit: $('setRate').value,
      maxParallel: Number($('setParallel').value),
      proxy: $('setProxy').value,
      // Empty box keeps the saved login; only a new value or "Remove" changes it.
      ...($('setTv4Token').value.trim() ? { tv4Token: $('setTv4Token').value } : state.clearTv4Token ? { tv4Token: '' } : {}),
    });
    renderStatus();
    $('settingsDialog').close();
    toast('Settings saved');
  } catch (err) {
    $('settingsError').textContent = err.message;
    $('settingsError').hidden = false;
  }
});

// ---------- wiring ----------
$('linkForm').addEventListener('submit', e => { e.preventDefault(); go(); });
$('urlInput').addEventListener('input', updateGoButton);
$('urlInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); }
});
$('urlInput').addEventListener('paste', () => setTimeout(() => {
  updateGoButton();
  if (readInput().kind !== 'search') go();
}, 0));
$('pasteBtn').addEventListener('click', async () => {
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (!text) return toast('Your clipboard is empty. Copy a video link first.');
    $('urlInput').value = text;
    updateGoButton();
    go();
  } catch {
    toast('Click in the box and press Ctrl+V to paste.');
    $('urlInput').focus();
  }
});
$('modeChoice').addEventListener('click', e => {
  const b = e.target.closest('[data-mode]');
  if (b && !b.disabled) setMode(b.dataset.mode);
});
$('qualityChips').addEventListener('click', e => {
  const b = e.target.closest('[data-q]');
  if (b) { state.quality = Number(b.dataset.q); setSeg($('qualityChips'), 'q', b.dataset.q); }
});
$('containerChips').addEventListener('click', e => {
  const b = e.target.closest('[data-ct]');
  if (b) { state.container = b.dataset.ct; setSeg($('containerChips'), 'ct', b.dataset.ct); }
});
$('audioChips').addEventListener('click', e => {
  const b = e.target.closest('[data-fmt]');
  if (b) { state.audioFormat = b.dataset.fmt; setSeg($('audioChips'), 'fmt', b.dataset.fmt); updateBitrate(); }
});
$('bitrateChips').addEventListener('click', e => {
  const b = e.target.closest('[data-br]');
  if (b) { state.audioQuality = b.dataset.br; setSeg($('bitrateChips'), 'br', b.dataset.br); }
});
$('playlistChoice').addEventListener('click', e => {
  const b = e.target.closest('[data-pl]');
  if (b) { state.playlist = b.dataset.pl === '1'; setSeg($('playlistChoice'), 'pl', b.dataset.pl); updateItemsRow(); }
});
for (const id of ['optSubs', 'optStart', 'optEnd', 'optSponsor', 'optExtra']) $(id).addEventListener('input', updateMoreSummary);
$('downloadBtn').addEventListener('click', startDownload);
$('changeDirBtn').addEventListener('click', changeFolder);
$('settingsBtn').addEventListener('click', openSettings);
$('openFolderBtn').addEventListener('click', () => api('/api/open', {}));
$('clearBtn').addEventListener('click', () => api('/api/clear', {}));
$('updateBtn').addEventListener('click', async e => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Updating…';
  try { const r = await api('/api/update', {}); toast(r.message); state.status = r; renderStatus(); }
  catch (err) { toast(err.message); }
  finally { btn.disabled = false; btn.textContent = 'Update downloader'; }
});

refreshStatus();
connectEvents();
