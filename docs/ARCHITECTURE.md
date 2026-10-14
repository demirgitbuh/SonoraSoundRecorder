# Architecture

Sonora is an Electron application written in TypeScript, organized into four layers:

```
src/
├─ shared/     Pure TypeScript used by every process (no Node or DOM APIs)
│  ├─ types.ts           domain model (recordings, sessions, schedules…)
│  ├─ state-machine.ts   run lifecycle + re-entrancy guard
│  ├─ settings.ts        zod schema, defaults, versioned migrations, import/export
│  ├─ library-schema.ts  archive schema and migrations
│  ├─ edit.ts            trim/cut maths, marker and transcript remapping
│  ├─ formats.ts         formats, quality profiles, FFmpeg arguments
│  ├─ naming.ts          Sonora_YYYY-MM-DD_HH-mm-ss, sanitizing, unique names
│  ├─ search.ts          archive filtering and sorting
│  ├─ shortcuts.ts       accelerator parsing and validation
│  ├─ ipc.ts             typed IPC contract and channel whitelists
│  └─ i18n/              translator + six complete catalogs
├─ main/       Electron main process
│  ├─ index.ts           lifecycle, permissions, system-audio handler, quit flow
│  ├─ ipc.ts             every channel validated with zod, sender checked
│  ├─ protocol.ts        app:// (renderer, strict CSP) and sonora-media:// (audio)
│  ├─ windows.ts / tray.ts
│  └─ services/
│     ├─ run-store.ts         in-progress recordings on disk + recovery
│     ├─ audio-service.ts     save, export, edit, import, move (FFmpeg)
│     ├─ library-store.ts     archive, folders, tags, trash, transcripts, peaks
│     ├─ settings-store.ts    settings + named profiles
│     ├─ transcription.ts     whisper.cpp jobs (child process, cancellable)
│     ├─ updater.ts           GitHub Releases + electron-updater
│     ├─ shortcut-service.ts  global shortcut registration
│     ├─ platform.ts          capabilities, permissions, autostart
│     └─ logger.ts            rotating technical log (no audio, no transcripts)
├─ preload/    contextBridge with whitelisted channels only
└─ renderer/   React UI
   ├─ public/worklets/capture-processor.js   AudioWorklet (real PCM)
   └─ src/
      ├─ audio/     engine (sessions, commands, schedules), session controller, capture
      ├─ stores/    zustand stores
      ├─ components/ and pages/
      └─ styles/    design tokens, light/dark/high-contrast themes
```

## Security model

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` in every window.
- The renderer reaches the system only through `window.sonora`. Every channel is whitelisted in the preload and validated again in the main process with a zod schema; messages from unknown origins are rejected.
- The renderer is served from `app://sonora` with a strict Content-Security-Policy. Audio files are served through `sonora-media://`, which only resolves ids known to the archive or the run store, never arbitrary paths.
- Media permissions are granted only to Sonora's own origin. Navigation and new windows are blocked; links open in the system browser only when they point to the project or the model documentation.

## Recording pipeline

```
getUserMedia / getDisplayMedia ──► MediaStreamSource ──► GainNode (record level) ──► AudioWorklet
                                          └──► GainNode (monitor level) ──► speakers (optional)
AudioWorklet ──(PCM chunks ~85 ms)──► renderer batches (250 ms) ──IPC──► RunStore (append-only .f32 files)
            └──(peaks/RMS/clip, 30 Hz)──► LiveData ring buffer ──► canvas waveform + meters (rAF)
```

- Each recording ("run") gets its own directory in the app data folder: `manifest.json`, one raw float32 file per track (`mic`, `system`, `mix`) and waveform peaks. Data is synced to disk every two seconds, and memory use does not grow with the length of the recording.
- The worklet counts recorded frames, so the elapsed time excludes paused time and is sample-accurate.
- Microphone processing (noise suppression, echo cancellation, AGC) is always requested explicitly. The value the device reports is shown to the user, so an option that was requested but not applied is never presented as active.
- System audio uses WASAPI loopback on Windows, ScreenCaptureKit on macOS 13+, and PulseAudio/PipeWire loopback or monitor sources on Linux. If no audio track is delivered, or no frames arrive within four seconds, recording fails with an explanation and is never written as silence.

## Run states

`ready → countdown → recording ⇄ paused → finalizing → preview → exporting → ready`, plus `recoverable` and `error`. Transitions that are not in the table are ignored, and async steps run exclusively, so rapid double presses cannot start two captures or finalize twice.

## Saving and editing

- Saving converts the raw tracks with FFmpeg into the chosen format. Edits are applied as sample-accurate `atrim` ranges joined with `concat`, and optional normalization raises or lowers the peak to −1 dBFS.
- Output is first written to a temporary file in the target folder and verified with FFprobe. It is then moved into place with a no-clobber rename: a hard link that fails if the target exists, with a fallback to an existence check.
- "Replace original" renames the original to a hidden backup, moves the new file into place and only then deletes the backup. An interrupted replace is undone on the next start.
- After an edit, markers and transcript segments are remapped to the new timeline.

## Data and persistence

| Data | Location |
| --- | --- |
| Recordings | the folder you choose (flat or `YYYY-MM-DD` subfolders) |
| Settings, profiles, archive metadata, folders, tags, notes, trash state, transcripts, peaks, schedules, model path, unsaved runs, logs | OS user-data directory (`%APPDATA%\Sonora Sound Recorder`, `~/Library/Application Support/Sonora Sound Recorder`, `~/.config/Sonora Sound Recorder`) |

JSON files are written atomically: a temporary file is fsynced and then renamed. Each file has a schema version with migrations. A corrupt file is moved aside and the last good `.bak` copy is used instead.

## Processes and threads

- Real-time capture runs on the audio rendering thread (AudioWorklet).
- FFmpeg encoding and whisper.cpp transcription run as child processes, so the UI never blocks. At most two encodes and one transcription run at a time.
- The main window keeps working while hidden in the tray (`backgroundThrottling: false`), so recordings continue when the window is closed.
