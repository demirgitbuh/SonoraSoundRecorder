# On-device transcription

Sonora ships with the **whisper.cpp** command-line runtime (`whisper-cli`), built for each platform on GitHub Actions. Audio is processed on your computer and is never uploaded.

## Model format

- **Supported:** whisper.cpp **GGML** model files with the `.bin` extension, for example `ggml-tiny.bin`, `ggml-base.bin`, `ggml-small.bin`, `ggml-medium.bin`, `ggml-large-v3.bin`, and the English-only `*.en.bin` variants.
- **Not supported:** GGUF, PyTorch (`.pt`), safetensors and ONNX files.
- Models are **not** bundled and Sonora never downloads anything. Get a model from the official repository: <https://huggingface.co/ggerganov/whisper.cpp/tree/main>.

| Model | Size | Notes |
| --- | --- | --- |
| tiny / tiny.en | ~75 MB | fastest, lowest accuracy |
| base / base.en | ~142 MB | good starting point |
| small / small.en | ~466 MB | noticeably better accuracy |
| medium | ~1.5 GB | slow on older CPUs |
| large-v3 | ~3 GB | best accuracy, needs time and RAM |

## Choosing a model

1. Open **Settings → Transcription → Choose model file…** and select the `.bin` file.
2. Sonora reads the header: the GGML magic, vocabulary size, layer count and mel bins. It rejects anything else with a specific message, such as "GGUF files are not supported".
3. The model family (tiny/base/small/…) and whether it is English-only are shown.

If you move or delete the model file later, transcription shows "model file not found" and asks you to choose it again. The path is stored in the app data folder and survives updates. Imported settings from another computer only use a model path if you confirm it and the file exists here.

## Transcribing

Open a recording in the archive and press **Transcribe**.

1. FFmpeg converts the audio to 16 kHz mono.
2. `whisper-cli` runs as a separate process. Progress is shown and can be cancelled at any time.
3. The result is saved next to the archive metadata, linked to the recording and included in the archive search.

- Choose the spoken language in Settings, or keep *Detect automatically*.
- Threads default to automatic: CPU cores minus one, up to eight.
- If the recording is edited later, transcript timings are remapped and removed parts dropped; the transcript is marked accordingly.
- Logs never contain transcript text.

## Requirements

On x64 machines the bundled runtime needs a CPU with AVX2 (Intel Haswell / AMD Excavator or newer). Apple-silicon builds use Metal, with a fallback to the CPU.
