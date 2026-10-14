# Developer mode

Developer mode adds a **Developer** page with advanced settings, diagnostics and test tools. It is off by default.

- **Turn it on:** *Settings → Advanced → Developer mode*. Sonora asks for confirmation and then opens the page. While it is on, a **Developer** entry appears in the sidebar above *Settings*.
- **Turn it off:** use *Turn off developer mode* on the page, or the switch in *Settings → Advanced*. The standard behavior returns right away; your developer values are kept for the next time.
- **Reset:** *Reset developer settings* returns every developer value to its default and leaves developer mode on. The same reset is available through `settings:reset` with the `developer` category.

Every developer IPC channel is refused by the main process unless developer mode is on.

## Overview

| Area | What it shows |
| --- | --- |
| Runtime | Sonora, Electron, Chromium, Node.js and V8 versions, the OS, package type, processor, memory, system language, uptime, active and waiting recordings, transcription jobs |
| Processes | CPU and memory of every Sonora process (`app.getAppMetrics()`), refreshed every 2 s, plus system memory |
| Executables | FFmpeg, FFprobe and whisper-cli in use: bundled or custom, whether they start, and their version |
| Folders and files | App data, logs, unsaved recordings, temporary files, recordings folder, bundled tools, application and resources, with *Open folder* for Sonora's own folders |
| Chromium | Switches applied at start-up, a notice when the configured switches need a restart, and the graphics feature status |

*Copy diagnostics* copies everything above, plus the live audio engine state, as JSON.

## Live log

- **Lowest level written:** debug, info (default), warnings and errors, or errors only. Errors are always written.
- **Trace IPC calls:** logs each call from the interface to the main process with its duration and result. The developer page's own channels are left out so the trace does not feed itself.
- **Log command lines:** writes every FFmpeg, FFprobe and whisper-cli command with exit code and duration. Commands contain file paths.

The live view keeps the last 3,000 entries; the main process keeps the last 1,000 in memory. You can filter by level, source and text, pause the view (new entries are counted), clear it, and copy what is shown. Logs never contain audio or transcript text.

## Audio engine

Changes apply to the next recording or input check; running recordings keep their settings.

| Setting | Default | Range | Effect |
| --- | --- | --- | --- |
| Latency mode | interactive | interactive / balanced / playback | `AudioContext` `latencyHint` |
| Chunk size | 4096 frames | 1024 – 16384 | Frames the capture worklet collects before handing them over |
| Meter refresh rate | 30 Hz | 10 – 60 Hz | Level meter and live waveform updates |
| Clip indicator threshold | −0.01 dBFS | −12 – 0 dBFS | Sample level that lights the clip indicator |
| Send interval | 250 ms | 50 – 2000 ms | How often batched audio is sent to the main process |
| Disk sync interval | 2000 ms | 250 – 10000 ms | How often audio and peaks are forced onto the disk (`fdatasync`) |
| No-audio timeout | 4 s | 1 – 30 s | A recording fails to start when no audio arrives in time |

*Live engine* shows, for each session, the `AudioContext` state and sample rate, base and output latency, latency mode, chunk size, tracks, captured frames, the data sent for writing and the run ID.

*Fault injection* simulates an unplugged microphone or lost system audio on the selected session while it records. The session follows exactly the real device-loss path: it pauses, shows the reconnect notice, and can be resumed into the same recording.

## FFmpeg & whisper

- **Executables:** choose your own `ffmpeg`, `ffprobe` or `whisper-cli`. A file is only accepted if it starts and identifies itself: `ffmpeg -version` / `ffprobe -version` must print their own name, and `whisper-cli -h` must exit successfully and print its usage. *Use bundled* switches back. The paths are never taken from imported settings files or profiles.
- **whisper.cpp options:** only values that differ from the default are passed. The page shows the resulting command line.

  | Option | whisper-cli flag |
  | --- | --- |
  | Beam size, best of (0 = default) | `-bs`, `-bo` |
  | Temperature | `-tp` |
  | Maximum segment length (0 = no limit) | `-ml` |
  | Maximum text context (−1 = default) | `-mc` |
  | Initial prompt | `--prompt` |
  | Translate to English | `-tr` |
  | Split on words | `-sow` |
  | No temperature fallback | `-nf` |
  | Suppress non-speech tokens | `-sns` |
  | Use the GPU (off) | `-ng` |
  | Flash attention (off) | `-nfa` |

- **Keep work files:** keeps the converted 16 kHz WAV and the raw JSON output of each transcription in the temporary folder.
- **FFprobe inspector:** shows the complete `ffprobe -show_format -show_streams` JSON of a recording or any file.

## System

- **Chromium switches**, applied at the next start: hardware acceleration, Sonora's platform feature switches (system audio loopback on macOS and Linux, the shortcut portal on Linux), and extra `--enable-features` / `--disable-features` names. Invalid names are listed and ignored. The switches are read from `settings.json` before the app is ready; a missing or broken file falls back to the defaults, so a bad value can never stop Sonora from starting. They are never taken from imported settings or profiles.
- **Interface:** performance overlay (frame rate, slowest frame, JS heap, long tasks, DOM size), internal IDs in the archive detail panel, and the DevTools shortcut (F12, or Ctrl+Shift+I / ⌥⌘I).
- **Updates:** *Include pre-releases* also offers test versions. Pre-releases are downloaded and opened instead of installing themselves.
- **Windows:** open the developer tools of the main window or the mini panel, or reload the main window. Reloading is refused while a recording runs.

Outside developer mode the default application menu is not installed, so reload and DevTools keyboard shortcuts do nothing.

## Tools

- **Key tester:** shows `key`, `code`, modifiers, the Electron accelerator and which recording shortcut matches, plus the registration state of each shortcut. Recording shortcuts never fire inside the test area.
- **Test recording:** creates a sine tone (20 Hz – 20 kHz, 1 – 600 s, 48 kHz stereo, 24-bit WAV) with FFmpeg and imports it, so the archive, editor, export and transcription can be tested without a microphone.
- **Sonora data:** sizes of the settings, archive index, schedules, profiles, unsaved recordings, transcripts, waveform cache, logs and temporary files, a read-only JSON viewer, and *Clear temporary files*, which keeps the work folders of transcriptions that are still running.
- **Recovery and stability:** run the first-start setup again (settings and recordings are kept), crash the recorder window on purpose to test crash recovery, or restart Sonora through the normal quit flow.

When the recorder window crashes, for real or on purpose, the main process first closes its open recordings and keeps them in the *recording* state, then reloads the window, which offers them as recovered recordings.
