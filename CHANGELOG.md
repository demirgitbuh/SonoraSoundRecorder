# Changelog

## 0.1.2

Full notes: [docs/release-notes/0.1.2.md](docs/release-notes/0.1.2.md).

- **Fixed**
  - Stopping a recording no longer collides with the periodic disk write, which could show a false "recording failed" message or offer the recording as a crashed one.
  - A recording whose last write fails (disk full) is closed and offered for recovery right away.
  - Failed saves and exports no longer leave hidden `.sonora-partial` files behind.
  - Long Cyrillic, Chinese or emoji names fit the 255-byte file name limit of Linux and macOS.
  - *Check now* keeps an update that is already downloaded or waiting to install; a download that cannot be written shows an error instead of hanging.
  - Notifications close after their own time, the mini panel remembers its position on Linux, and folders and tags cannot be renamed to an existing name.
- **Security**
  - Electron 44.9.3 with Chromium and V8 security backports and the eMudhra certificate mitigation.
  - CI and releases run on the patched Node.js 24.22.1 (October 21, 2026 security release, CVE-2026-111497 and others); `engines` requires a patched Node.js.
  - Vitest 4.1.12 removes the critical Tinypool advisories from the development tooling.

## 0.1.1

Full notes: [docs/release-notes/0.1.1.md](docs/release-notes/0.1.1.md).

- **Fixed**
  - Recording shortcuts (K, Space, L) now work while the mini panel has focus. Space no longer re-presses a button clicked with the mouse, and the button tooltips show the keys.
  - A recording that was running when the recorder window crashed is closed safely and offered as a recovered recording after the window reloads.
  - Electron's default application menu is no longer installed, so its reload and DevTools shortcuts cannot interrupt a recording.
- **New: developer mode** (*Settings → Advanced*), with these sections:
  - **Overview:** runtime and process diagnostics.
  - **Live log:** level filter, IPC trace and command-line logging.
  - **Audio engine:** tuning and live state, plus simulated device loss.
  - **FFmpeg & whisper:** custom FFmpeg, FFprobe and whisper-cli builds, advanced whisper.cpp options and an FFprobe inspector.
  - **System:** Chromium switches, a performance overlay, internal IDs, a DevTools shortcut and pre-release updates.
  - **Tools:** key tester, test tones, data files viewer, temporary file cleanup, onboarding re-run, crash test and restart.

## 0.1 — first release

First public version of Sonora Sound Recorder. The full notes are in [docs/release-notes/0.1.md](docs/release-notes/0.1.md).

- **Recording**
  - Microphone, system audio, or both, with separate levels.
  - Combined, separate, or both kinds of output files.
  - Parallel sessions, pause/resume, markers, countdown, schedules and live monitoring.
- **Safety**: audio is written to disk continuously, recordings are recovered after a crash, a disconnected device pauses the session, and existing files are never overwritten.
- **Editing**: preview and edit workspace with trim, cut, selection playback and edit preview, plus a "new copy or replace" choice.
- **Formats**: export to WAV, MP3, FLAC, OGG Opus and M4A AAC with the bundled FFmpeg, and optional normalization.
- **Archive**
  - List and card views, folders, tags, favorites, notes, search, filters and bulk actions.
  - Import, and Sonora's own trash.
- **Transcription**: on-device with whisper.cpp, using a model you choose.
- **Desktop integration**: tray, mini panel, notifications, launch at login, and update checks from GitHub Releases.
- **Interface**: six languages, light and dark themes, high contrast, interface scaling, reduced motion, and full keyboard use.
