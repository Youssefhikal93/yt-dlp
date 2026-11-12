# YT Downloader

A simple point-and-click app for downloading videos and music. Under the hood it uses
[yt-dlp](https://github.com/yt-dlp/yt-dlp), so it works with YouTube and 1,800+ other sites, but you never touch a terminal.

## How to use

The easiest way is the standalone app: double-click `dist/YT-Downloader.exe` on Windows (no Node.js needed).
Your browser opens. Paste a link, pick **Video** or **Audio only**, and click **Download**.

Keep the app window open while you use it. Close it to quit.

All the ways to run it (standalone app, double-click launcher, terminal, shortcuts, start at login) and how to build
the Windows and Mac apps are in **[RUNNING.md](RUNNING.md)**.

The first launch downloads the yt-dlp program automatically (about 18 MB). If FFmpeg isn't installed,
the page shows an **Install FFmpeg** button (Windows). FFmpeg is needed for MP3s, the best video quality and subtitles.

## Features

| In the app | yt-dlp option it uses |
| --- | --- |
| Search YouTube by typing words instead of a link | `ytsearch12:` |
| Paste several links at once | one download per link |
| Video quality: Best, 4K … 360p | `-S res:N` |
| Video as MP4 (plays everywhere) or MKV (original quality) | `-S vcodec:h264,acodec:m4a`, `--merge-output-format mp4/mkv` |
| Audio only: MP3 / M4A / FLAC / WAV with cover art, bitrate 128–320 kbps | `-x --audio-format … --audio-quality … --embed-thumbnail --embed-metadata` |
| Whole playlist or channel, just one video, or chosen items (e.g. `1-10`) | `--yes-playlist` / `--no-playlist`, `-I` |
| Subtitles: built into the video, separate `.srt` file, or both | `--write-subs --write-auto-subs --embed-subs --convert-subs srt` |
| Only part of a video (e.g. 1:30 to 2:45) | `--download-sections` |
| Skip sponsor segments (YouTube) | `--sponsorblock-remove` |
| Record live streams, from the beginning or when they start | `--live-from-start`, `--wait-for-video` |
| Choose the file name before downloading (**Save as**) | renamed after download |
| TV4 Play links, including free episodes that need an account ([how](RUNNING.md#tv4-play)) | plugin in `plugins/`, `--plugin-dirs` |
| Faster downloads | `-N 4` |
| Extra yt-dlp options box for anything else | passed straight to yt-dlp |
| **Settings:** use my browser login (private / age-restricted / sign-in) | `--cookies-from-browser` |
| **Settings:** TV4 Play login | `--extractor-args tv4playapp:token=…` |
| **Settings:** skip videos I already downloaded | `--download-archive` |
| **Settings:** speed limit, proxy, downloads at the same time (1–4) | `-r`, `--proxy` |
| Progress, speed, time left, cancel, retry; download list kept after restart | `--progress-template`, `--newline` |
| Update downloader | `yt-dlp -U` (also runs automatically every 3 days) |

Downloads go to `Downloads\YT Downloader` by default. Click **Change** to pick another folder.

## Notes

- The app only listens on your own computer (`127.0.0.1`), and it rejects requests from other websites.
- No npm packages are needed to run it. `server.js` uses only built-in Node modules (`postject` is only used to build the apps).
- Only download content you have the right to download.
