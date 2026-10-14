# Recording, sessions and shortcuts

## Sources

| Source | What is recorded |
| --- | --- |
| Microphone (default) | the selected input device, or the system default input |
| System audio | everything your computer plays through its default output |
| Microphone + system | both, each with its own level slider |

With two sources, **Output files** controls what is saved:

- **Combined**: one file in which the microphone and system audio are mixed.
- **Separate**: `Name_mic.ext` and `Name_system.ext`.
- **Both**: the combined file plus the two separate files.

Record levels and the live-monitoring level are independent; monitoring never changes the recording.

## Sessions

Use **Add session** to create up to six independent sessions. Each one has its own source, devices, levels, monitoring, format and quality.

- The selected session has a strong outline and appears in the title bar ("Shortcuts → Session 2"). The tray menu and the mini panel show which session they control.
- Global shortcuts, the tray and the mini panel always act on the selected session, so another session is never stopped by accident.
- If the operating system or device does not allow two sessions to use the same device at the same time, the second session reports the real error (for example "device busy").

## Controls

| | |
| --- | --- |
| Start / stop | record button, <kbd>K</kbd>, tray, mini panel |
| Pause / resume | <kbd>Space</kbd>, button, tray, mini panel |
| Time marker | <kbd>L</kbd> or the Marker button (time only, no note) |
| Countdown | off by default; 3, 5 or 10 seconds in Settings → Recording; cancel any time |
| Check input | shows live levels before recording, without writing anything |

During a recording you see the live mirrored waveform, separate level meters, the clip indicator, the elapsed time, the file size (marked *estimated* for compressed formats) and the free space on the target disk.

There is no maximum length and no automatic splitting. Silence is recorded normally and never pauses the recording.

## If a device disconnects

The affected session pauses immediately and everything recorded so far stays on disk. Reconnect the device, or pick another one, and choose **Use this device and resume**; recording continues into the same file.

## After recording

Choose the behavior in **Settings → Recording → After recording**:

1. **Open preview & edit** (default): the full workspace to check, trim, cut and name the recording.
2. **Ask for a name**, then save.
3. **Save automatically** to the archive.

Until you decide, the recording stays safely in the app data folder. It survives quitting and crashes, and is offered again under **Unsaved recordings**.

## File names

Recordings are named `Sonora_YYYY-MM-DD_HH-mm-ss.ext` by default. Existing files are never overwritten; `_2`, `_3`, … are added instead. Names you type are cleaned of characters your operating system does not allow.

## Schedules

**Schedule** sets a start and end time for a session. Schedules run only while Sonora is running, either as a window or in the tray. If Sonora was not running at the start time, the schedule is marked **Missed**; it is never started later. Invalid times and overlapping schedules for the same session are rejected. A warning appears when another schedule uses the same source at the same time.

## Shortcuts

Defaults: <kbd>K</kbd> start/stop · <kbd>Space</kbd> pause/resume · <kbd>L</kbd> marker.

- **Scope**: *Everywhere* (default) or *Only in Sonora*.
- While a Sonora window is focused, the keys are handled inside the app. Text fields, file-name inputs and the shortcut recorder never trigger recording commands.
- Global single-key shortcuts take over those keys in **other applications** while Sonora runs. If that gets in the way, use *Only in Sonora* or combinations such as <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>.
- Settings shows the real status of each key: active everywhere, active in Sonora, or not active. A key used by another application is reported, never silently replaced. All registrations are removed when Sonora quits.
- On Linux/Wayland, global shortcuts depend on the desktop's GlobalShortcuts portal.

## Tray and mini panel

Closing the window hides Sonora in the tray, and running recordings continue. The tray menu offers start/stop, pause/resume, the status and elapsed time, opening the recordings folder, settings, showing the window and quitting. **Quit** with recordings open asks first, then stops them safely: the audio is kept and offered again on the next start.

The **mini panel** is an optional always-on-top window with the time, status, start/stop, pause/resume and a button back to the main window. It never opens by itself.
