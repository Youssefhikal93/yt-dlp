'use strict';
// Local web UI for yt-dlp. No npm dependencies: run with `node server.js`.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// When packed into a standalone app (Node single executable), the page files are embedded
// assets and the tools/settings live in the user's app-data folder instead of next to this file.
let sea = null;
try { const s = require('node:sea'); if (s.isSea()) sea = s; } catch {}
function appDataDir() {
  if (IS_WIN) return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'YT Downloader');
  if (IS_MAC) return path.join(os.homedir(), 'Library', 'Application Support', 'YT Downloader');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'yt-downloader');
}
const ROOT = __dirname;
const DATA_DIR = sea ? appDataDir() : ROOT;
const PUBLIC_DIR = path.join(ROOT, 'public');
const BIN_DIR = path.join(DATA_DIR, 'bin');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const EXE = IS_WIN ? '.exe' : '';
const YTDLP = path.join(BIN_DIR, 'yt-dlp' + EXE);
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/' +
  (IS_WIN ? 'yt-dlp.exe' : IS_MAC ? 'yt-dlp_macos' : 'yt-dlp_linux');
const FFMPEG_ZIP_URL = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
const START_PORT = Number(process.env.PORT) || 8765;
const MAX_PARALLEL = 2;
const CHILD_ENV = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };

let port = START_PORT;

// ---------- settings ----------
function loadSettings() {
  const defaults = {
    downloadDir: path.join(os.homedir(), 'Downloads', 'YT Downloader'),
    browser: '',          // --cookies-from-browser
    useArchive: false,    // --download-archive: skip things downloaded before
    rateLimit: '',        // -r, e.g. 2M
    proxy: '',            // --proxy
    maxParallel: 2,
  };
  try { return { ...defaults, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch { return defaults; }
}
let settings = loadSettings();
function saveSettings() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// ---------- setup (yt-dlp + ffmpeg) ----------
const setup = {
  ytdlp: 'checking',          // checking | downloading | updating | ready | error
  ytdlpVersion: null,
  ffmpeg: false,
  ffmpegLocation: null,       // folder passed to --ffmpeg-location, or null when ffmpeg is on PATH
  ffmpegInstall: null,        // null | { state: 'downloading'|'extracting'|'error', percent, error }
  progress: null,             // download percent while fetching yt-dlp
  error: null,
};

function fetchFile(url, dest, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'yt-downloader-ui' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirects > 8) return reject(new Error('Too many redirects'));
        return resolve(fetchFile(new URL(res.headers.location, url).toString(), dest, onProgress, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`Download failed (HTTP ${res.statusCode})`)); }
      const total = Number(res.headers['content-length']) || 0;
      let done = 0;
      const tmp = dest + '.part';
      const out = fs.createWriteStream(tmp);
      res.on('data', chunk => { done += chunk.length; if (total && onProgress) onProgress(done / total * 100); });
      res.on('error', reject);
      out.on('error', reject);
      out.on('finish', () => {
        try { fs.renameSync(tmp, dest); if (!IS_WIN) fs.chmodSync(dest, 0o755); resolve(); } catch (e) { reject(e); }
      });
      res.pipe(out);
    }).on('error', reject);
  });
}

function run(cmd, args, { timeout = 120000 } = {}) {
  return new Promise(resolve => {
    let out = '', err = '';
    let p;
    try { p = spawn(cmd, args, { windowsHide: true, env: CHILD_ENV }); } catch (e) { return resolve({ code: -1, out, err: e.message }); }
    p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8');
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => killTree(p), timeout);
    p.on('error', e => { clearTimeout(timer); resolve({ code: -1, out, err: err + e.message }); });
    p.on('close', code => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

function killTree(p) {
  if (!p || p.exitCode !== null) return;
  // The standalone yt-dlp.exe spawns a child process, so kill the whole tree on Windows.
  if (IS_WIN) spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true });
  else p.kill('SIGTERM');
}

async function detectFfmpeg() {
  const local = path.join(BIN_DIR, 'ffmpeg' + EXE);
  if (fs.existsSync(local)) { setup.ffmpeg = true; setup.ffmpegLocation = BIN_DIR; return; }
  const r = await run('ffmpeg', ['-version'], { timeout: 10000 });
  setup.ffmpeg = r.code === 0;
  setup.ffmpegLocation = null;
}

async function ensureYtdlp() {
  try {
    fs.mkdirSync(BIN_DIR, { recursive: true });
    if (!fs.existsSync(YTDLP)) {
      setup.ytdlp = 'downloading';
      await fetchFile(YTDLP_URL, YTDLP, pct => { setup.progress = Math.round(pct); });
      setup.progress = null;
    } else if (Date.now() - fs.statSync(YTDLP).mtimeMs > 3 * 864e5) {
      // Sites change often; keep the downloader fresh. Failure (e.g. offline) is fine.
      setup.ytdlp = 'updating';
      const u = await run(YTDLP, ['-U'], { timeout: 60000 });
      // Only count it as checked when the update worked, so an offline start retries next time.
      if (u.code === 0) { try { const now = new Date(); fs.utimesSync(YTDLP, now, now); } catch {} }
    }
    const v = await run(YTDLP, ['--version'], { timeout: 30000 });
    if (v.code !== 0) throw new Error('The downloader program could not start. ' + v.err.trim());
    setup.ytdlpVersion = v.out.trim();
    setup.ytdlp = 'ready';
    setup.error = null;
  } catch (e) {
    setup.ytdlp = 'error';
    setup.error = e.message;
  }
}

async function installFfmpeg() {
  if (!IS_WIN) throw new Error('Automatic FFmpeg install is only available on Windows.');
  if (setup.ffmpegInstall && setup.ffmpegInstall.state !== 'error') return;
  setup.ffmpegInstall = { state: 'downloading', percent: 0 };
  const zip = path.join(BIN_DIR, 'ffmpeg.zip');
  const tmpDir = path.join(BIN_DIR, 'ffmpeg-tmp');
  try {
    await fetchFile(FFMPEG_ZIP_URL, zip, pct => { setup.ffmpegInstall.percent = Math.round(pct); });
    setup.ffmpegInstall = { state: 'extracting', percent: 100 };
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    const r = await run('tar', ['-xf', zip, '-C', tmpDir], { timeout: 300000 });
    if (r.code !== 0) throw new Error('Could not unpack FFmpeg: ' + r.err.trim());
    const found = findFiles(tmpDir, ['ffmpeg.exe', 'ffprobe.exe']);
    if (!found['ffmpeg.exe']) throw new Error('FFmpeg was not found in the downloaded archive.');
    for (const [name, p] of Object.entries(found)) fs.renameSync(p, path.join(BIN_DIR, name));
    setup.ffmpegInstall = null;
    await detectFfmpeg();
  } catch (e) {
    setup.ffmpegInstall = { state: 'error', error: e.message };
  } finally {
    fs.rmSync(zip, { force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function findFiles(dir, names, found = {}) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) findFiles(p, names, found);
    else if (names.includes(entry.name.toLowerCase())) found[entry.name.toLowerCase()] = p;
  }
  return found;
}

// ---------- errors ----------
function friendlyError(stderr) {
  const lines = String(stderr).split(/\r?\n/).filter(l => l.startsWith('ERROR:'));
  const raw = (lines[0] || String(stderr).trim().split(/\r?\n/).pop() || 'Something went wrong.');
  const checks = [
    [/Unsupported URL/i, "This website isn't supported, or the link isn't a video page."],
    [/is not a valid URL/i, "That doesn't look like a valid link."],
    [/Private video|members[- ]only|This video is private/i, 'This video is private or for members only. Open Settings (gear icon) and set "Use my browser login".'],
    [/confirm your age|age[- ]restricted|inappropriate for some users/i, 'This video is age-restricted. Open Settings (gear icon) and pick the browser where you are logged in to the site.'],
    [/only works when logged-in|account credentials|login required|requires (a )?login|log ?in to/i, 'This site needs you to be logged in. Open Settings (gear icon) and choose the browser where you are logged in to it.'],
    [/not a bot|Sign in to confirm/i, 'The site wants you to sign in. Open Settings (gear icon) and pick the browser where you are logged in, or click "Update downloader".'],
    [/HTTP Error 404|Not Found/i, "Nothing was found at that link. Check that it's correct and opens a video page."],
    [/video (is )?unavailable|has been removed|no longer available/i, 'This video is unavailable (removed, or blocked in your country).'],
    [/HTTP Error 403|Forbidden/i, 'The site refused the download. Click "Update downloader" and try again.'],
    [/HTTP Error 429|Too Many Requests/i, 'The site is limiting requests. Wait a few minutes and try again.'],
    [/getaddrinfo|Failed to resolve|timed out|Connection refused|Network is unreachable/i, "Couldn't connect. Check your internet connection."],
    [/ffmpeg|ffprobe/i, 'This option needs FFmpeg. Click "Install FFmpeg" at the top of the page.'],
    [/could not (copy|find).*cookie|cookies database/i, "Couldn't read the browser login. Close that browser completely and try again, or choose another browser."],
  ];
  for (const [re, msg] of checks) if (re.test(raw)) return msg;
  return raw.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?([\w-]+:\s*)?/, '');
}

// ---------- info ----------
// Options from the Settings panel that apply to every yt-dlp call, lookups included.
function commonArgs() {
  const a = [];
  if (BROWSERS.includes(settings.browser)) a.push('--cookies-from-browser', settings.browser);
  if (settings.proxy) a.push('--proxy', settings.proxy);
  return a;
}

async function getInfo(url, extra) {
  const r = await run(YTDLP, ['-J', '--flat-playlist', '--no-warnings', '--ignore-config', '--color', 'never', ...commonArgs(), ...extra, '--', url], { timeout: 90000 });
  if (r.code !== 0) throw new Error(friendlyError(r.err));
  return JSON.parse(r.out);
}

function pickThumb(info) {
  const thumbs = (info.thumbnails || []).filter(t => t.url);
  return info.thumbnail || (thumbs.length ? thumbs[thumbs.length - 1].url : null);
}

function summarize(info) {
  const isPlaylist = info._type === 'playlist' || Array.isArray(info.entries);
  const formats = info.formats || [];
  const heights = [...new Set(formats.filter(f => f.height && f.vcodec !== 'none').map(f => f.height))].sort((a, b) => b - a);
  const entries = isPlaylist ? (info.entries || []) : [];
  const thumbnail = pickThumb(info) || (entries[0] ? pickThumb(entries[0]) : null);
  return {
    live: info.live_status === 'is_live' ? 'live' : info.live_status === 'is_upcoming' ? 'upcoming' : null,
    title: info.title || info.id || 'Untitled',
    uploader: info.uploader || info.channel || info.uploader_id || null,
    duration: info.duration || null,
    thumbnail,
    site: info.extractor_key || info.ie_key || null,
    isPlaylist,
    count: isPlaylist ? (info.playlist_count || entries.length) : 1,
    entries: entries.slice(0, 100).map(e => ({ title: e.title || e.id, duration: e.duration || null })),
    heights,
    hasVideo: formats.length === 0 || formats.some(f => f.vcodec !== 'none'),
    subtitles: Object.keys(info.subtitles || {}).filter(l => l !== 'live_chat'),
    autoSubtitles: Object.keys(info.automatic_captions || {}).length > 0,
  };
}

async function handleInfo(url) {
  const single = summarize(await getInfo(url, ['--no-playlist']));
  // A link like watch?v=...&list=... points at both a video and a playlist.
  if (!single.isPlaylist && /[?&]list=/.test(url)) {
    try {
      const pl = summarize(await getInfo(url, ['--yes-playlist']));
      if (pl.isPlaylist) single.playlist = { title: pl.title, count: pl.count, entries: pl.entries };
    } catch {}
  }
  return single;
}

async function handleSearch(query) {
  const info = await getInfo(`ytsearch12:${query}`, []);
  return (info.entries || []).map(e => ({
    url: e.url || `https://www.youtube.com/watch?v=${e.id}`,
    title: e.title || e.id,
    channel: e.channel || e.uploader || null,
    duration: e.duration || null,
    thumbnail: pickThumb(e),
    live: e.live_status === 'is_live',
  }));
}

// Splits the "Extra yt-dlp options" box like a shell would: spaces separate, quotes group.
function splitArgs(s) {
  const out = [];
  let cur = '', quote = null, started = false;
  for (const ch of String(s || '')) {
    if (quote) { if (ch === quote) quote = null; else cur += ch; }
    else if (ch === '"' || ch === "'") { quote = ch; started = true; }
    else if (/\s/.test(ch)) { if (cur || started) out.push(cur); cur = ''; started = false; }
    else { cur += ch; started = true; }
  }
  if (cur || started) out.push(cur);
  return out.filter(x => x !== '--');
}

// ---------- downloads ----------
const jobs = new Map();
const sseClients = new Set();
const TIME_RE = /^\d{1,2}(:\d{1,2}){0,2}(\.\d+)?$/;
const BROWSERS = ['chrome', 'edge', 'firefox', 'brave', 'opera', 'vivaldi', 'safari', 'chromium'];
const AUDIO_FORMATS = ['mp3', 'm4a', 'flac', 'wav', 'opus'];
const AUDIO_QUALITIES = ['0', '320K', '256K', '192K', '128K'];
const RATE_RE = /^\d+(\.\d+)?[KMG]?$/i;
const ARCHIVE_FILE = path.join(DATA_DIR, 'archive.txt');

function buildArgs(o) {
  const a = [
    '--ignore-config', '--newline', '--progress', '--color', 'never', '--no-simulate', '--no-mtime',
    '-N', '4', // download 4 pieces at a time: much faster on YouTube and other streaming sites
    '--progress-template', 'download:[[P]]%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.vcodec)s',
    '--progress-template', 'postprocess:[[PP]]%(progress.postprocessor)s',
    '--print', 'before_dl:[[ITEM]]%(playlist_index|)s|%(n_entries|)s|%(id|)s|%(thumbnail|)s|%(title)s',
    '--print', 'after_move:[[FILE]]%(filepath)s',
    '-P', settings.downloadDir,
    ...commonArgs(),
  ];
  if (setup.ffmpegLocation) a.push('--ffmpeg-location', setup.ffmpegLocation);
  if (settings.rateLimit && RATE_RE.test(settings.rateLimit)) a.push('-r', settings.rateLimit);
  if (settings.useArchive) a.push('--download-archive', ARCHIVE_FILE);

  if (o.playlist) {
    // The [id] in file names lets cancel/live-size find exactly this job's files.
    a.push('--yes-playlist', '-o', '%(playlist_title,playlist_id|Playlist).100B/%(playlist_index)03d - %(title).150B [%(id)s].%(ext)s');
    const items = String(o.items || '').replace(/\s/g, '');
    if (items) {
      if (!/^\d+(-\d*)?(,\d+(-\d*)?)*$/.test(items)) throw new Error('"Which items?" should look like 1-10 or 1,4,7-9.');
      a.push('-I', items);
    }
  } else {
    a.push('--no-playlist', '-o', '%(title).150B [%(id)s].%(ext)s');
  }

  if (o.mode === 'audio') {
    const fmt = AUDIO_FORMATS.includes(o.audioFormat) ? o.audioFormat : 'mp3';
    const quality = AUDIO_QUALITIES.includes(o.audioQuality) && ['mp3', 'm4a', 'opus'].includes(fmt) ? o.audioQuality : '0';
    if (setup.ffmpeg) {
      a.push('-f', 'ba/b', '-x', '--audio-format', fmt, '--audio-quality', quality, '--embed-metadata');
      if (['mp3', 'm4a', 'flac'].includes(fmt)) a.push('--embed-thumbnail');
    } else {
      a.push('-f', 'ba[ext=m4a]/ba/b');
    }
  } else {
    const h = Number(o.quality) || 0;
    const mkv = o.container === 'mkv';
    // MP4 prefers H.264 so it plays everywhere; MKV keeps the site's best codecs (VP9/AV1) untouched.
    a.push('-S', (h ? `res:${h}` : 'res') + (mkv ? '' : ',vcodec:h264,acodec:m4a'));
    if (setup.ffmpeg) a.push('-f', 'bv*+ba/b', '--merge-output-format', mkv ? 'mkv' : 'mp4', '--embed-metadata');
    else a.push('-f', 'b');
    if (o.subtitles) {
      const lang = /^[\w-]{1,20}$/.test(o.subLang || '') ? o.subLang : 'en';
      const subMode = ['embed', 'file', 'both'].includes(o.subMode) ? o.subMode : 'embed';
      // -i: a failed subtitle fetch (YouTube often rate-limits these) shouldn't fail the video.
      a.push('-i', '--write-subs', '--write-auto-subs', '--sub-langs', lang);
      if (setup.ffmpeg) {
        if (subMode !== 'embed') a.push('--convert-subs', 'srt');
        if (subMode !== 'file') a.push('--embed-subs');
        // no-keep-subs: delete the subtitle files once they are inside the video.
        if (subMode === 'embed') a.push('--compat-options', 'no-keep-subs');
      }
    }
  }

  const start = String(o.clipStart || '').trim();
  const end = String(o.clipEnd || '').trim();
  if ((start || end) && (!start || TIME_RE.test(start)) && (!end || TIME_RE.test(end))) {
    a.push('--download-sections', `*${start || '0'}-${end || 'inf'}`);
  }
  if (o.sponsorblock) a.push('--sponsorblock-remove', 'sponsor,selfpromo,interaction');
  if (o.liveFromStart) a.push('--live-from-start');
  if (o.waitForLive) a.push('--wait-for-video', '15-120');
  a.push(...splitArgs(o.extraArgs));
  a.push('--', o.url);
  return a;
}

const PRIVATE_FIELDS = ['proc', 'lastSent', 'timer', 'stderr', 'args', 'watch', 'seenIds', 'ffmpegNote'];
function publicJob(j) {
  const out = { ...j };
  for (const k of PRIVATE_FIELDS) delete out[k];
  delete out.opts;
  return out;
}

// ---------- history (download list survives restarts) ----------
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const FINISHED = ['done', 'error', 'cancelled'];
let historyTimer = null;
function saveHistory() {
  clearTimeout(historyTimer);
  historyTimer = setTimeout(() => {
    const list = [...jobs.values()].filter(j => FINISHED.includes(j.status)).slice(-200).map(j => {
      const out = { ...j };
      for (const k of PRIVATE_FIELDS) delete out[k];
      return out;
    });
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(HISTORY_FILE, JSON.stringify(list)); } catch {}
  }, 500);
}
function loadHistory() {
  try {
    for (const j of JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'))) {
      if (j && j.id && FINISHED.includes(j.status)) jobs.set(j.id, { ...j, proc: null, lastSent: 0, timer: null, stderr: '' });
    }
  } catch {}
}

function broadcast(job, force) {
  const now = Date.now();
  if (!force && now - job.lastSent < 250) {
    if (!job.timer) job.timer = setTimeout(() => { job.timer = null; broadcast(job, true); }, 250);
    return;
  }
  job.lastSent = now;
  const msg = `event: job\ndata: ${JSON.stringify(publicJob(job))}\n\n`;
  for (const res of sseClients) res.write(msg);
}

function num(s) { const n = parseFloat(s); return Number.isFinite(n) ? n : null; }

function handleLine(job, line) {
  line = line.trim();
  if (!line) return;
  if (line.startsWith('[[P]]')) {
    const [done, total, estimate, speed, eta, vcodec] = line.slice(5).split('|');
    const size = num(total) || num(estimate);
    job.phase = job.mode === 'video' && vcodec === 'none' ? 'audio' : 'downloading';
    if (size) job.percent = Math.min(100, (num(done) || 0) / size * 100);
    job.speed = num(speed);
    job.eta = num(eta);
    job.size = size;
    job.downloaded = num(done);
    job.lastProgress = Date.now();
    broadcast(job);
  } else if (line.startsWith('[[PP]]')) {
    job.phase = 'processing';
    job.speed = job.eta = null;
    broadcast(job, true);
  } else if (line.startsWith('[[ITEM]]')) {
    const [index, count, videoId, thumb, ...title] = line.slice(8).split('|');
    job.item = { index: num(index), count: num(count), id: videoId, title: title.join('|') };
    if (videoId) job.seenIds.add(videoId);
    if (!job.thumbnail && /^https?:/.test(thumb)) job.thumbnail = thumb;
    if (!job.isPlaylist) job.title = job.item.title || job.title;
    job.percent = 0;
    broadcast(job, true);
  } else if (line.startsWith('[[FILE]]')) {
    job.files.push(line.slice(8));
    job.completed = job.files.length;
    broadcast(job, true);
  } else if (line.startsWith('ERROR:')) {
    job.itemErrors.push(friendlyError(line));
  } else {
    // Live streams are recorded by FFmpeg, which reports e.g. "size=  2048KiB time=00:00:12.00 … speed=1x".
    const m = line.match(/\bsize=\s*(\d+(?:\.\d+)?)\s*(k|ki|m|mi|g|gi)?B\b/i);
    if (m) {
      const unit = { k: 1e3, ki: 1024, m: 1e6, mi: 1048576, g: 1e9, gi: 1073741824 }[(m[2] || '').toLowerCase()] || 1;
      job.phase = 'downloading';
      job.downloaded = Number(m[1]) * unit;
      job.size = job.speed = job.eta = null;
      const t = line.match(/\btime=(\d+):(\d+):(\d+)/);
      job.recorded = t ? Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]) : null;
      broadcast(job);
    }
  }
}

function startJob(job) {
  fs.mkdirSync(settings.downloadDir, { recursive: true });
  job.status = 'running';
  job.phase = 'starting';
  job.startedAt = Date.now();
  const p = spawn(YTDLP, job.args, { windowsHide: true, env: CHILD_ENV });
  job.proc = p;
  for (const stream of [p.stdout, p.stderr]) {
    stream.setEncoding('utf8');
    let buf = '';
    stream.on('data', d => {
      buf += d;
      const lines = buf.split(/\r\n|\r|\n/); // FFmpeg updates its progress line with bare \r
      buf = lines.pop();
      for (const l of lines) handleLine(job, l);
    });
    stream.on('end', () => { if (buf) handleLine(job, buf); });
  }
  if (p.stderr) p.stderr.on('data', d => { if (job.stderr.length < 20000) job.stderr += d; });
  // Live recordings (done by FFmpeg) report no progress, so show the recording file's size instead.
  job.watch = setInterval(() => {
    if (Date.now() - (job.lastProgress || 0) < 3000 || !job.item || !job.item.id) return;
    const size = recordingSize(job.dir, `[${job.item.id}]`, job.startedAt);
    if (!size) return;
    job.phase = 'downloading';
    job.downloaded = size;
    job.size = job.speed = job.eta = null;
    if (job.live) job.recorded = Math.round((Date.now() - job.startedAt) / 1000);
    broadcast(job);
  }, 2000);
  p.on('error', e => finishJob(job, -1, e.message));
  p.on('close', code => finishJob(job, code));
  broadcast(job, true);
}

function finishJob(job, code, errMsg) {
  if (job.status !== 'running' && job.status !== 'cancelling') return;
  clearInterval(job.watch);
  job.watch = null;
  job.proc = null;
  job.speed = job.eta = null;
  if (job.status === 'cancelling') {
    job.status = 'cancelled';
    const ids = [...job.seenIds];
    setTimeout(() => removePartials(job.dir, ids, job.startedAt), 1500);
  } else if (code === 0 && !job.files.length && job.itemErrors.length) {
    job.status = 'error';
    job.error = job.itemErrors[0];
  }
  else if (code === 0) {
    job.status = 'done';
    job.percent = 100;
    if (!job.files.length) job.warning = settings.useArchive ? 'You downloaded this before, so it was skipped.' : 'Nothing new to download.';
    else if (job.ffmpegNote) job.warning = job.ffmpegNote;
  }
  else if (job.files.length && job.isPlaylist) { job.status = 'done'; job.warning = `${job.itemErrors.length || 'Some'} item(s) could not be downloaded.`; }
  else { job.status = 'error'; job.error = errMsg || job.itemErrors[0] || friendlyError(job.stderr); }
  job.finishedAt = Date.now();
  broadcast(job, true);
  saveHistory();
  pumpQueue();
}

function recordingSize(dir, marker, since) {
  let total = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.includes(marker)) continue;
      const st = fs.statSync(path.join(dir, name));
      if (st.isFile() && st.mtimeMs >= since) total += st.size;
    }
  } catch {}
  return total;
}

// Delete half-finished files that a cancelled download left behind. Only files named with one of
// this job's video ids ("… [id].ext.part") are touched, so other running downloads are safe.
function removePartials(dir, ids, since, depth = 0) {
  if (!ids.length) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth < 1) removePartials(p, ids, since, depth + 1); continue; }
    if (!/\.(part|ytdl)$|\.part-Frag\d+(\.part)?$/.test(e.name)) continue;
    if (!ids.some(id => e.name.includes(`[${id}]`))) continue;
    try { if (fs.statSync(p).mtimeMs >= since) fs.rmSync(p, { force: true }); } catch {}
  }
}

function pumpQueue() {
  const running = [...jobs.values()].filter(j => j.status === 'running' || j.status === 'cancelling').length;
  const next = [...jobs.values()].filter(j => j.status === 'queued');
  const max = Math.min(4, Math.max(1, Number(settings.maxParallel) || MAX_PARALLEL));
  for (let i = 0; i < max - running && i < next.length; i++) startJob(next[i]);
}

// Without FFmpeg some choices can't be honoured; say so on the finished download instead of hiding it.
function ffmpegNote(o) {
  if (setup.ffmpeg) return null;
  if (o.mode === 'audio') return 'FFmpeg is missing, so the audio was saved in its original format instead of converting it.';
  if (o.subtitles && o.subMode !== 'embed') return 'FFmpeg is missing, so subtitles were saved as .vtt instead of .srt.';
  if (o.subtitles) return 'FFmpeg is missing, so subtitles were saved as a separate file instead of inside the video.';
  return 'FFmpeg is missing, so the video was saved in a lower quality single file.';
}

function createJob(o) {
  o.url = String(o.url || '').trim();
  if (!/^https?:\/\//i.test(o.url)) throw new Error("That doesn't look like a valid link.");
  const videoLabel = (Number(o.quality) ? `${o.quality}p` : 'Best') + (o.container === 'mkv' ? ' MKV' : '');
  const job = {
    id: crypto.randomBytes(6).toString('hex'),
    url: o.url,
    title: o.title || o.url,
    thumbnail: o.thumbnail || null,
    mode: o.mode === 'audio' ? 'audio' : 'video',
    label: o.mode === 'audio' ? String(o.audioFormat || 'mp3').toUpperCase() : videoLabel,
    isPlaylist: !!o.playlist,
    live: !!(o.liveFromStart || o.live),
    count: Number(o.count) || null,
    status: 'queued', phase: null, percent: 0, speed: null, eta: null, size: null, downloaded: null,
    item: null, files: [], completed: 0, itemErrors: [], error: null, warning: null,
    createdAt: Date.now(), opts: o, args: null, proc: null, lastSent: 0, timer: null, stderr: '',
    dir: settings.downloadDir, seenIds: new Set(), ffmpegNote: ffmpegNote(o),
  };
  job.args = buildArgs(o);
  jobs.set(job.id, job);
  broadcast(job, true);
  pumpQueue();
  return job;
}

function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) return;
  if (job.status === 'queued') { job.status = 'cancelled'; broadcast(job, true); saveHistory(); }
  else if (job.status === 'running') { job.status = 'cancelling'; broadcast(job, true); killTree(job.proc); }
}

// ---------- OS helpers ----------
function openInExplorer(target, select) {
  if (IS_WIN) spawn('explorer', select ? [`/select,${target}`] : [target], { windowsHide: true, detached: true }).unref();
  else if (IS_MAC) spawn('open', select ? ['-R', target] : [target], { detached: true }).unref();
  else spawn('xdg-open', [select ? path.dirname(target) : target], { detached: true }).unref();
}

async function pickFolder() {
  if (IS_WIN) {
    const ps = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
      '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
      '$d.Description = "Choose where to save your downloads"',
      '$d.ShowNewFolderButton = $true',
      'if (Test-Path $env:YTD_CURRENT) { $d.SelectedPath = $env:YTD_CURRENT }',
      '$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }',
      'if ($d.ShowDialog($owner) -eq "OK") { Write-Output $d.SelectedPath }',
    ].join('; ');
    return new Promise(resolve => {
      const p = spawn('powershell', ['-NoProfile', '-STA', '-Command', ps], { env: { ...CHILD_ENV, YTD_CURRENT: settings.downloadDir } });
      let out = '';
      p.stdout.setEncoding('utf8');
      p.stdout.on('data', d => { out += d; });
      p.on('close', () => resolve(out.trim() || null));
      p.on('error', () => resolve(null));
    });
  }
  const r = IS_MAC
    ? await run('osascript', ['-e', 'POSIX path of (choose folder with prompt "Choose where to save your downloads")'], { timeout: 600000 })
    : await run('zenity', ['--file-selection', '--directory'], { timeout: 600000 });
  return r.code === 0 ? r.out.trim() || null : null;
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', d => { body += d; if (body.length > 65536) { reject(new Error('Request too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Bad request')); } });
  });
}

// Only this page may control the app: blocks other websites and DNS-rebinding tricks.
function isTrusted(req) {
  const allowed = [`localhost:${port}`, `127.0.0.1:${port}`];
  if (!allowed.includes(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (origin && !allowed.map(h => 'http://' + h).includes(origin)) return false;
  if (req.method === 'POST' && !String(req.headers['content-type'] || '').startsWith('application/json')) return false;
  return true;
}

function statusPayload() {
  return { ...setup, downloadDir: settings.downloadDir, settings, platform: process.platform };
}

const routes = {
  'GET /api/status': async () => statusPayload(),
  'POST /api/info': async b => {
    if (setup.ytdlp !== 'ready') throw new Error('Still getting ready, please wait a moment.');
    const url = String(b.url || '').trim();
    if (!/^https?:\/\//i.test(url)) throw new Error("That doesn't look like a valid link. It should start with https://");
    return handleInfo(url);
  },
  'POST /api/download': async b => {
    if (setup.ytdlp !== 'ready') throw new Error('Still getting ready, please wait a moment.');
    return { id: createJob(b).id };
  },
  'POST /api/cancel': async b => { cancelJob(b.id); return { ok: true }; },
  'POST /api/retry': async b => {
    const old = jobs.get(b.id);
    if (!old || !['error', 'cancelled'].includes(old.status)) throw new Error('Nothing to retry.');
    // Rebuild the options so a retry picks up changed settings (folder, browser login, …).
    const args = old.opts ? buildArgs(old.opts) : old.args;
    if (!args) throw new Error('This download is too old to retry. Paste the link again.');
    Object.assign(old, {
      args, dir: settings.downloadDir, ffmpegNote: ffmpegNote(old.opts || {}), seenIds: new Set(),
      status: 'queued', percent: 0, error: null, warning: null, files: [], completed: 0, itemErrors: [], stderr: '',
      item: null, phase: null, downloaded: null, size: null, speed: null, eta: null, recorded: null, lastProgress: 0,
    });
    broadcast(old, true);
    pumpQueue();
    return { ok: true };
  },
  'POST /api/clear': async () => {
    for (const [id, j] of jobs) if (FINISHED.includes(j.status)) jobs.delete(id);
    for (const res of sseClients) res.write('event: cleared\ndata: {}\n\n');
    saveHistory();
    return { ok: true };
  },
  'POST /api/search': async b => {
    if (setup.ytdlp !== 'ready') throw new Error('Still getting ready, please wait a moment.');
    const q = String(b.query || '').trim();
    if (!q) throw new Error('Type something to search for.');
    return { results: await handleSearch(q.slice(0, 200)) };
  },
  'POST /api/open': async b => {
    const job = b.id && jobs.get(b.id);
    const file = job && job.files[job.files.length - 1];
    if (file && fs.existsSync(file)) openInExplorer(file, true);
    else { fs.mkdirSync(settings.downloadDir, { recursive: true }); openInExplorer(settings.downloadDir, false); }
    return { ok: true };
  },
  'POST /api/pick-folder': async () => {
    const dir = await pickFolder();
    if (dir) { settings.downloadDir = dir; saveSettings(); }
    return statusPayload();
  },
  'POST /api/settings': async b => {
    // Partial update: only the fields that were sent change.
    const next = { ...settings };
    if ('downloadDir' in b) {
      const dir = String(b.downloadDir || '').trim();
      if (!dir || !path.isAbsolute(dir)) throw new Error('Please enter a full folder path, for example C:\\Users\\You\\Videos');
      fs.mkdirSync(dir, { recursive: true });
      next.downloadDir = dir;
    }
    if ('browser' in b) {
      if (b.browser && !BROWSERS.includes(b.browser)) throw new Error('Unknown browser.');
      next.browser = b.browser || '';
    }
    if ('useArchive' in b) next.useArchive = !!b.useArchive;
    if ('rateLimit' in b) {
      const r = String(b.rateLimit || '').trim().toUpperCase();
      if (r && !RATE_RE.test(r)) throw new Error('Speed limit should look like 500K, 2M or 10M.');
      next.rateLimit = r;
    }
    if ('proxy' in b) {
      const p = String(b.proxy || '').trim();
      if (p && !/^(https?|socks[45]h?):\/\/\S+$/i.test(p)) throw new Error('Proxy should look like http://host:port or socks5://host:port');
      next.proxy = p;
    }
    if ('maxParallel' in b) next.maxParallel = Math.min(4, Math.max(1, Number(b.maxParallel) || 2));
    settings = next;
    saveSettings();
    pumpQueue();
    return statusPayload();
  },
  'POST /api/install-ffmpeg': async () => { installFfmpeg(); return statusPayload(); },
  'POST /api/update': async () => {
    if ([...jobs.values()].some(j => j.status === 'running')) throw new Error('Wait for downloads to finish before updating.');
    setup.ytdlp = 'updating';
    const r = await run(YTDLP, ['-U'], { timeout: 120000 });
    await ensureYtdlp();
    const msg = (r.out + r.err).match(/(up to date|Updated yt-dlp to[^\n]*)/i);
    return { ...statusPayload(), message: msg ? msg[0] : (r.code === 0 ? 'Updated.' : 'Update failed. Check your internet connection.') };
  },
};

const server = http.createServer(async (req, res) => {
  if (!isTrusted(req)) { res.writeHead(403); return res.end('Forbidden'); }
  const { pathname } = new URL(req.url, 'http://localhost');

  if (pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`event: snapshot\ndata: ${JSON.stringify([...jobs.values()].map(publicJob))}\n\n`);
    sseClients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
    return;
  }

  const route = routes[`${req.method} ${pathname}`];
  if (route) {
    try { send(res, 200, await route(req.method === 'POST' ? await readJson(req) : {})); }
    catch (e) { send(res, 400, { error: e.message }); }
    return;
  }

  if (req.method !== 'GET') { res.writeHead(404); return res.end(); }
  const name = pathname === '/' ? 'index.html' : pathname.slice(1);
  readPublic(name, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(name)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

function readPublic(name, cb) {
  if (sea) {
    // Asset keys are the file names inside public/ (see scripts/build.js).
    try { return cb(null, Buffer.from(sea.getAsset(name))); } catch (e) { return cb(e); }
  }
  const file = path.normalize(path.join(PUBLIC_DIR, name));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return cb(new Error('Not found'));
  fs.readFile(file, cb);
}

function openBrowser(url) {
  if (process.env.NO_BROWSER) return;
  if (IS_WIN) spawn('cmd', ['/c', 'start', '', url], { windowsHide: true, detached: true }).unref();
  else spawn(IS_MAC ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}

server.on('error', e => {
  if (e.code === 'EADDRINUSE' && port < START_PORT + 20) { port++; server.listen(port, '127.0.0.1'); }
  else { console.error(e); process.exit(1); }
});
server.on('listening', () => {
  const url = `http://localhost:${port}`;
  console.log(`\n  YT Downloader is running at ${url}\n  Keep this window open while you use it. Close it to quit.\n`);
  openBrowser(url);
});

loadHistory();
server.listen(port, '127.0.0.1');
detectFfmpeg();
ensureYtdlp();
