# Changelog

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
