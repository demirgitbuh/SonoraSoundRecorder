# Changelog

## 0.2.0

Full notes: [docs/release-notes/0.2.0.md](docs/release-notes/0.2.0.md).

- **Security**
  - Electron 44.10.0 with Node.js 24.22.1, which includes the fix for CVE-2026-111497 and the other October 2026 Node.js fixes.
  - zod 4, patched undici and fast-uri, and vitest 5. `npm audit` reports no vulnerabilities.
- **Design**
  - Instrument Serif for titles and the recording clock.
  - A calmer recorder with the format line under the record button and no explanatory texts.
  - A resizable, collapsible side panel with collapsible cards.
  - An animated first start and update dialog, and a branded Windows installer.
- **Fixed**: automatic session names follow the interface language.
- **New**
  - Terms of Use and Privacy Policy in six languages, with a new Settings → About page.
  - "Also in the mini panel" shortcut setting.
- **Performance**
  - One shared animation loop that stops when idle or hidden, and a recorder that renders once per second.
  - Faster start, with lazily loaded pages and less disk writing during recording.
- **CI**: an end-to-end test of the real app with a simulated microphone and screenshots of every screen.

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
