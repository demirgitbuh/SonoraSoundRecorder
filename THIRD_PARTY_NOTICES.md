# Third-party notices

Sonora Sound Recorder is free software licensed under the **GNU General Public License v3.0**
(see `LICENSE.txt`). It is built on and distributed together with the following components.
Full license texts of the bundled native tools are installed in the `licenses` folder next to
this file.

| Component | Use in Sonora | License |
| --- | --- | --- |
| [Electron](https://www.electronjs.org/) (includes Chromium and Node.js) | Desktop runtime | MIT (Chromium: BSD-style, see `LICENSES.chromium.html` in the installation) |
| [FFmpeg](https://ffmpeg.org/) via [ffmpeg-static builds](https://github.com/eugeneware/ffmpeg-static) b6.1.1 | Encoding, decoding, conversion, waveform peaks | GPL (see `licenses/FFmpeg-LICENSE.txt`, source: `licenses/FFmpeg-SOURCE.txt`) |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) v1.9.5 and ggml | On-device speech-to-text (`whisper-cli`) | MIT (see `licenses/whisper.cpp-LICENSE.txt`) |
| [React](https://react.dev/) / React DOM | User interface | MIT |
| [Framer Motion](https://www.framer.com/motion/) | Animations | MIT |
| [Lucide](https://lucide.dev/) icons | Icons | ISC |
| [Zustand](https://github.com/pmndrs/zustand) | UI state | MIT |
| [Zod](https://zod.dev/) | Data validation | MIT |
| [electron-updater](https://www.electron.build/auto-update) | Installer updates (NSIS, AppImage) | MIT |
| [Inter](https://rsms.me/inter/) via @fontsource-variable/inter | Bundled typeface | SIL Open Font License 1.1 |
| [Instrument Serif](https://github.com/Instrument/instrument-serif) | Bundled display typeface (headings, timer) | SIL Open Font License 1.1 — `licenses/OFL-InstrumentSerif.txt` |

Speech recognition models are **not** bundled. Models you select (for example the official
whisper.cpp GGML conversions of OpenAI Whisper, MIT licensed) remain under their own licenses.

The FFmpeg binaries are the unmodified builds published by the ffmpeg-static project; their
build configuration and the matching FFmpeg version are listed in `licenses/FFmpeg-BUILD-README.txt`.
The corresponding FFmpeg source code is available from https://ffmpeg.org/download.html.
