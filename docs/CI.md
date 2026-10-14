# Building with GitHub Actions (no local toolchain)

All type checks, tests, builds and packages run on GitHub Actions. You do not need Node, compilers or packagers on your own machine.

## Workflows

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | push to `main`, pull requests, manual | runs `build.yml` |
| `build.yml` | reusable | checks + native packaging on four runners |
| `release.yml` | tag such as `0.1` | verifies tag ↔ version, runs `build.yml`, publishes the GitHub Release |

### `build.yml`

1. **Checks** (`ubuntu-22.04`): `npm ci` from the lockfile, pinned FFmpeg download (SHA-256 verified), `tsc` for the main and renderer projects, `vitest` (including real FFmpeg encodes), and the production build with `electron-vite`.
2. **Package** matrix, one runner per OS and CPU architecture:

   | Runner | Target | Output |
   | --- | --- | --- |
   | `windows-2022` | win x64 | NSIS installer + blockmap, portable, `latest.yml` |
   | `macos-15` | mac arm64 | DMG |
   | `macos-15-intel` | mac x64 | DMG |
   | `ubuntu-22.04` | linux x64 | AppImage, DEB, `latest-linux.yml` |

   Steps on each runner:
   - fetch pinned FFmpeg/FFprobe,
   - build `whisper-cli` from whisper.cpp v1.9.5 with CMake (static, portable CPU flags, cached),
   - render icons from SVG,
   - `electron-vite build`,
   - `electron-builder` with explicit targets and architecture,
   - `scripts/verify-package.mjs`, which:
     - checks the package contents (binaries, licenses, icons, update metadata),
     - runs `ffmpeg`/`ffprobe`/`whisper-cli` from the packaged location,
     - encodes all five export formats,
     - checks the CPU architecture of every binary,
     - inspects the DMG, AppImage and DEB,
     - runs a real transcription of whisper.cpp's `jfk.wav` with the tiny model, which is used only for this test and never packaged,
   - upload the packages as workflow artifacts (kept for 14 days).

### `release.yml`

1. Checks that the tag normalizes to the `package.json` version (`0.1` → `0.1.0`) and that `docs/release-notes/<tag>.md` exists.
2. Runs the full build. If any platform fails, nothing is published.
3. Collects the nine required files, writes `SHA256SUMS.txt` and creates the release **"Sonora Sound Recorder &lt;tag&gt;"** with the notes file. Re-running the workflow updates the same release instead of moving the tag.

## Making a release

```bash
git tag 0.1.1
git push origin 0.1.1
```

The tag is used exactly as written. Bump `version` in `package.json` and add `docs/release-notes/<tag>.md` before tagging a new version.

## Reading CI results

```bash
gh run list --limit 5
gh run view --log-failed
```

Packages from any run can be downloaded from the run page under **Artifacts**.
