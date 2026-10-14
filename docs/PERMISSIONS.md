# Audio permissions per platform

## Windows 10 / 11

- **Microphone**: *Settings → Privacy & security → Microphone*. Both "Microphone access" and "Let desktop apps access your microphone" must be on. Sonora shows the current status and has a button that opens this page.
- **System audio**: captured with WASAPI loopback from the default output device. No extra permission is needed.

## macOS 12+

- **Microphone**: macOS asks once. If you denied it, enable *Sonora Sound Recorder* in *System Settings → Privacy & Security → Microphone* and restart Sonora.
- **System audio** (macOS 13 or newer): uses ScreenCaptureKit and needs the **Screen Recording** permission (*Privacy & Security → Screen & System Audio Recording*). Sonora uses only the audio and discards the video frame. On macOS 12, system audio is reported as unavailable.
- The app is ad-hoc signed and not notarized. The first time, right-click → **Open**, or remove the quarantine flag with `xattr -dr com.apple.quarantine "/Applications/Sonora Sound Recorder.app"`.

## Linux

- **Microphone**: managed by PipeWire or PulseAudio. There is no separate permission prompt; your desktop's sound settings decide which inputs exist.
- **System audio**: captured from the PulseAudio/PipeWire output (loopback). If monitor sources such as "Monitor of Built-in Audio" are listed, you can also select one directly in the session's *System audio* field.
- **Wayland**: the desktop portal asks which screen to share; this step authorizes the capture, and only the audio is recorded. On X11, no dialog appears.
- Global shortcuts on Wayland depend on the portal implementation of your desktop.

## What Sonora does when access is missing

Recording does not start, and the reason is shown: denied, device not found, device busy, no system audio stream, or no data received. Sonora never creates a silent file and reports it as a successful recording.
