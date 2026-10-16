start

# Running YT Downloader

There are two ways to use YT Downloader:

|            | [Part 1: Run locally from the code](#part-1-run-locally-from-the-code) | [Part 2: Standalone app](#part-2-standalone-app)       |
| ---------- | --------------------------------------------------------------------- | ----------------------------------------------------- |
| What it is | You run the project's code with Node.js                               | One program file you double-click, like any other app |
| You need   | Git and Node.js                                                       | Nothing                                               |
| Good for   | Changing the code, trying things out                                  | Everyday use                                          |

Both open the same page in your browser at `http://localhost:8765`. Everything runs on your own computer,
and the page is only reachable from this machine.

---

# Part 1: Run locally from the code

## 1. Install the tools (once)

| Tool                        | Why                                 | Get it                                                                                | Check it works      |
| --------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------- | ------------------- |
| **Git**               | To download the code                | [git-scm.com/downloads](https://git-scm.com/downloads)                                 | `git --version`   |
| **Node.js 18+** (LTS) | Runs the app                        | [nodejs.org](https://nodejs.org)                                                       | `node --version`  |
| **FFmpeg** (optional) | MP3s, best video quality, subtitles | Windows: the app has an **Install FFmpeg** button. Mac: `brew install ffmpeg` | `ffmpeg -version` |

You do **not** need Python or yt-dlp. The app downloads yt-dlp by itself on first start.

## 2. Get the code

Open a terminal (Windows: **PowerShell**, Mac: **Terminal**) and run:

```sh
git clone -b yt-downloader-app --single-branch https://github.com/Youssefhikal93/yt-dlp.git yt-downloader
cd yt-downloader
```

The app lives on the `yt-downloader-app` branch of the yt-dlp fork. Its other branches hold yt-dlp's own source code, which this app doesn't need.

## 3. Start the app

```sh
npm start
```

You'll see:

```
  YT Downloader is running at http://localhost:8765
  Keep this window open while you use it. Close it to quit.
```

Your browser opens the app. If it doesn't, open `http://localhost:8765` yourself.

The first start takes a few seconds longer while it downloads yt-dlp into the project's `bin/` folder.

## 4. Stop the app

Press **Ctrl+C** in the terminal, or close the terminal window.

## All commands

Run these inside the project folder.

| Command           | What it does                                                                         |
| ----------------- | ------------------------------------------------------------------------------------ |
| `npm start`     | Starts the app (same as `node server.js`)                                          |
| `npm install`   | Installs the build tool. Only needed before `npm run build`, not for `npm start` |
| `npm run build` | Builds the standalone app into `dist/` (see [Part 2](#build-it-yourself))           |
| `git pull`      | Gets the latest version of the code. Restart the app afterwards                      |

Options (set before `npm start`):

| Option         | What it does                                                             | Windows (PowerShell)             | Mac / Linux                |
| -------------- | ------------------------------------------------------------------------ | -------------------------------- | -------------------------- |
| `PORT`       | Use another port (default 8765; if it's busy, the next free one is used) | `$env:PORT=9000; npm start`    | `PORT=9000 npm start`    |
| `NO_BROWSER` | Don't open the browser automatically                                     | `$env:NO_BROWSER=1; npm start` | `NO_BROWSER=1 npm start` |

## Shortcut: start without typing commands

After cloning, you can double-click a launcher instead of running `npm start`:

- **Windows:** `Start YT Downloader.bat`
- **Mac / Linux:** `start.sh` (on a Mac, rename it to `start.command` to make it double-clickable)

## Where files go (Part 1)

| What                                               | Where                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Your downloads                                     | `Downloads/YT Downloader` (click **Change** in the app to pick another folder) |
| yt-dlp and FFmpeg                                  | `bin/` inside the project folder                                                     |
| Settings, download list, "already downloaded" list | `settings.json`, `history.json`, `archive.txt` inside the project folder         |

---

# Part 2: Standalone app

This is YT Downloader as a normal program on your computer: one file, no Git, no Node.js, no commands.

## Get the app

| Computer                              | File                            |
| ------------------------------------- | ------------------------------- |
| Windows                               | `YT-Downloader.exe`           |
| Mac with Apple Silicon (M1 and newer) | `YT-Downloader-mac-arm64.zip` |
| Mac with Intel                        | `YT-Downloader-mac-x64.zip`   |

Not sure which Mac you have? Click the Apple menu → **About This Mac**. "Chip: Apple M…" means Apple Silicon.

To get the files, [build them yourself](#build-it-yourself). Once the GitHub build is switched on, you can also
download them from the repository's **Releases** page (see [Build on GitHub](#build-on-github-windows--mac)).

## Install

**Windows**

1. Move `YT-Downloader.exe` somewhere permanent, for example a new folder `C:\Apps\YT Downloader`.
2. Double-click it.
3. The first time, Windows may say "Windows protected your PC". Click **More info**, then **Run anyway**.
   This happens because the app isn't signed with a paid certificate.

**Mac**

1. Double-click the zip to unzip it, and move `YT-Downloader` into your **Applications** folder.
2. Double-click it. It opens in a Terminal window.
3. The first time, macOS may say it's from an unidentified developer. Right-click the app, choose **Open**, then **Open** again.
   If macOS says the app "is damaged", run this once in Terminal, then try again:

   ```sh
   xattr -dr com.apple.quarantine /Applications/YT-Downloader
   ```

## Use

1. Open the app. A small window appears and your browser opens the app page.
2. Paste a link, pick **Video** or **Audio only**, and click **Download**.
3. Keep the small window open while you use the app. Close it to quit.

## Make it easy to open

**Windows**

- Desktop shortcut: right-click `YT-Downloader.exe` → **Show more options** → **Send to** → **Desktop (create shortcut)**.
- Start menu or taskbar: right-click it → **Pin to Start** or **Pin to taskbar**.
- Start when you log in: press **Win+R**, type `shell:startup`, press Enter, and put a shortcut to the app in that folder.
- Run with no window: `Start-Process -WindowStyle Hidden -FilePath "C:\Apps\YT Downloader\YT-Downloader.exe"`.
  To stop it, end **YT-Downloader** in Task Manager.

**Mac**

- Dock: drag `YT-Downloader` from Applications into the Dock.
- Start when you log in: **System Settings** → **General** → **Login Items** → **+** → choose `YT-Downloader`.

## Where files go (Part 2)

| What                                               | Windows                                                                                  | Mac                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Your downloads                                     | `Downloads\YT Downloader`                                                              | `~/Downloads/YT Downloader`                                     |
| yt-dlp and FFmpeg                                  | `%LOCALAPPDATA%\YT Downloader\bin`                                                     | `~/Library/Application Support/YT Downloader/bin`               |
| Settings, download list, "already downloaded" list | `settings.json`, `history.json`, `archive.txt` in `%LOCALAPPDATA%\YT Downloader` | the same files in `~/Library/Application Support/YT Downloader` |

## Update

- **yt-dlp** (the part that talks to YouTube and other sites) updates itself every 3 days.
  If downloads start failing, click **Update downloader** at the bottom of the page.
- **The app itself:** replace the file with a newer build.

## Uninstall

Delete the app file and the yt-dlp/settings folder from the table above. Your downloaded videos stay where they are.

## Build it yourself

You need [Part 1](#part-1-run-locally-from-the-code) set up (Git, Node.js 22 or newer, the code cloned). Then, in the project folder:

```sh
npm install
npm run build
```

The app appears in `dist/` and is built for the computer you run this on:

- On Windows → `dist/YT-Downloader.exe`
- On a Mac → `dist/YT-Downloader-mac-arm64.zip` or `dist/YT-Downloader-mac-x64.zip`

On Windows the build prints `warning: The signature seems corrupted!`. That's expected: the app is a modified copy of the signed `node.exe`.

## Build on GitHub (Windows + Mac)

You can't build the Mac app on Windows, but GitHub can build all three versions for free.

**This is switched off for now:** every line in `.github/workflows/build.yml` is commented out. To switch it on:

1. Remove the `# ` at the start of each line in `.github/workflows/build.yml`, then commit and push.
2. Open the repository → **Actions** tab → **Build apps** → **Run workflow**.
3. When the run finishes (about 2 minutes), download the files under **Artifacts** at the bottom of the run page.

To get the files on a **Releases** page instead, push a version tag:

```sh
git tag v1.0.0
git push --tags
```

---

# Troubleshooting

| Problem                                                                              | Fix                                                                                                                                              |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm` or `node` is "not recognized"                                              | Node.js isn't installed, or the terminal was open while you installed it. Install Node.js, then open a new terminal.                             |
| Page says "The app is not running"                                                   | The app window was closed. Start the app again, then reload the page.                                                                            |
| Browser didn't open                                                                  | Open `http://localhost:8765` yourself. If that port was busy, the app window shows the port it used instead.                                   |
| "FFmpeg is missing"                                                                  | Windows: click **Install FFmpeg** on the page. Mac: install [Homebrew](https://brew.sh), run `brew install ffmpeg`, then restart the app. |
| "Sign in to confirm you're not a bot" / age-restricted / "needs you to be logged in" | Open **Settings** (gear icon, top right) and set **Use my browser login** to a browser where you're signed in to the site.           |
| Downloads suddenly fail                                                              | Click **Update downloader** at the bottom of the page.                                                                                     |
| Mac: "Operation not permitted" when saving to Downloads                              | **System Settings** → **Privacy & Security** → **Files and Folders** → allow Terminal to access the Downloads folder.       |
