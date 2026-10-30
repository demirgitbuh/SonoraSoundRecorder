# What is verified, and how

## Automated on every CI run

| Area | Test |
| --- | --- |
| Settings persistence, first-run theme, corrupt-file recovery, newer-version copies, profiles | `tests/settings.test.ts` |
| Schema migrations (settings and archive) | `tests/settings.test.ts`, `tests/update-data.test.ts` |
| Run state transitions, invalid commands, rapid repeated presses | `tests/state-machine.test.ts` |
| Separation of parallel sessions (files, manifests, levels) | `tests/recording.test.ts` |
| Temporary recording storage, crash detection, torn-frame repair, unsaved vs. crashed, cleanup | `tests/recording.test.ts` |
| Unique file names, OS-specific sanitizing, name reservation across sessions | `tests/naming.test.ts` |
| Trim/cut calculations, playback skipping, sample ranges | `tests/edit.test.ts` |
| Markers and transcript segments after edits | `tests/edit.test.ts`, `tests/ffmpeg-integration.test.ts` |
| Archive search (names, notes, tags, transcripts), filters, sorting | `tests/search.test.ts` |
| Trash, restore with name clashes and missing folders, permanent delete | `tests/trash.test.ts` |
| Settings import/export, machine-specific values never applied silently | `tests/settings-import.test.ts` |
| All six languages: same keys, same placeholders, no empty text, every key used in code exists | `tests/i18n.test.ts` |
| Shortcut parsing, conflicts, global registration, focus handling, suspension, cleanup | `tests/shortcuts.test.ts` |
| User data kept across an update; installer/update configuration | `tests/update-data.test.ts` |
| Developer settings (defaults, field-by-field fallback, no effect while off, reset, never imported paths/switches), Chromium start-up switches, whisper arguments, command quoting, log level filter and live log buffer, recovery of runs from a crashed recorder window, storage report and temporary-file cleanup, executable checks | `tests/developer.test.ts` |
| Real encodes of WAV, FLAC (24-bit), MP3, OGG Opus and M4A AAC; trims; separate tracks; normalization; content-based import; copy/replace edits; export without overwriting | `tests/ffmpeg-integration.test.ts` (bundled FFmpeg) |
| The real app end to end on a virtual display with a simulated microphone: first start with terms, keyboard recording, pause, marker and save, archive entry, side panel collapse/cards/resize, mini panel shortcuts (on and off), settings, About, developer page, update and consent dialogs, light/dark, Russian/English, persistence after a restart; any interface error fails | `scripts/e2e.mjs` (CI job "End-to-end test and screenshots", screenshots uploaded as an artifact) |
| Required binaries inside every package, binaries run, CPU architecture, DMG/AppImage/DEB contents, update metadata, transcription smoke test | `scripts/verify-package.mjs` on each packaging runner |

## Not verifiable on CI runners

CI machines have no microphone, no sound output, no interactive desktop session and no user who can approve permission prompts. The following are implemented, but **not** claimed as CI-verified. Check them manually on each platform:

| Behavior | How to check |
| --- | --- |
| Microphone capture | Record 10 s from the microphone; the waveform and the "Mic" meter move, and the saved file plays back. |
| System audio capture | Play music, record "System audio"; the System meter moves and the file contains the music. On macOS, grant Screen Recording first; on Wayland, confirm the portal dialog. |
| Mic + system, separate files | Record both with *Both* output; three files appear (`Name`, `Name_mic`, `Name_system`). |
| Device unplugged mid-recording | Unplug a USB microphone; the session pauses with a notice; reconnect and resume; the audio before and after is in one file. |
| Global shortcuts | With another app focused, press K / Space / L; check the status shown in Settings → Shortcuts. |
| Text fields don't trigger shortcuts | Type "k" and a space in the archive search box while a session is selected; nothing starts. |
| Tray & mini panel | Close the window during a recording; recording continues; control it from the tray and the mini panel. |
| Shortcuts in the mini panel | Click a button in the mini panel so it has focus, then press K, Space and L; the selected session starts/stops, pauses/resumes and gets a marker. Repeat with *Only in Sonora*. |
| Developer mode | Turn it on in Settings → Advanced; the Developer page opens. Check the live log, process list, a simulated microphone disconnect while recording (pause → reconnect → resume), a test tone import, and the crash test (the recording is offered as recovered). Turn it off; the sidebar entry disappears. |
| Quit with open recordings | Quit from the tray while recording; confirm; restart; the recording is offered under *Unsaved recordings*. |
| Crash recovery | Kill the process while recording (Task Manager / `kill -9`); restart; the recording is offered as *Recovered*. |
| Native share (macOS) | Detail panel → Share opens the macOS share sheet. |
| Launch at login | Enable it, sign out and in; Sonora starts in the tray. |
| Installer language selection | Run the Windows installer; the language dialog lists the six languages. |
| In-app update | Install an older version, publish a newer release, check for updates; confirm the dialog, download, install or open. |
| Screen reader | Start/stop/pause with NVDA, VoiceOver or Orca running; announcements are spoken. |

Report the platform, OS version and the relevant part of the exported log (*Settings → Advanced → Export logs*) for any issue.
