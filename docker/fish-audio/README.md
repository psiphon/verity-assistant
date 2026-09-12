# Fish Audio TTS server for Verity

[fish-speech](https://github.com/fishaudio/fish-speech) (a.k.a. OpenAudio) is an
open-weights TTS model with strong prosody and zero-shot voice cloning. Running
it locally gives Verity a much more natural voice than the OS `speechSynthesis`
voices, and keeps every reply on your machine.

Verity talks to this server from the **Electron main process** (`src/main/tts.ts`),
not the renderer. The renderer only asks `window.verity.tts.synthesize(text)`;
main adds the bearer token and does the HTTP call. If the server is down or
misconfigured, Verity silently falls back to the system voice.

```
renderer  ──IPC──▶  main (src/main/tts.ts)  ──POST /v1/tts──▶  fish-audio :<FISH_PORT>
```

---

## Prerequisites

- **Docker** with Compose v2 (`docker compose`, not `docker-compose`).
- For GPU inference (strongly recommended): an NVIDIA GPU with **16 GB VRAM**
  (with the step 3b tweak) or 24 GB (without), the
  [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html),
  and **no other model server holding the GPU** while this runs.
- **~24 GB free RAM** for the Docker/WSL2 VM (the model needs ~14 GB to load —
  see the crash-loop row in Troubleshooting).
- ~25 GB disk for the image, plus ~11 GB for the s2-pro weights.
- `git` + `git-lfs` for the weights (no Hugging Face account — s2-pro is public).

CPU-only works but is slow (~1-2 min per reply) and still needs the ~14 GB RAM.
Set `FISH_BACKEND=cpu` in `.env`, delete the `deploy:` block from `compose.yml`,
and rebuild.

---

## Setup

All commands are run from the repo root.

### 1. Configure

```bash
cp docker/fish-audio/.env.example docker/fish-audio/.env
# edit docker/fish-audio/.env — at minimum change FISH_API_KEY
```

### 2. Get the fish-speech source

The image is built from the upstream repo. A remote git build context is flaky
under `docker compose` (especially on Windows), so clone it into place — it's
gitignored:

```bash
git clone --depth 1 https://github.com/fishaudio/fish-speech.git docker/fish-audio/fish-speech
```

Update later with `git -C docker/fish-audio/fish-speech pull`, or pin a known-good
release with `git -C docker/fish-audio/fish-speech checkout <tag>` before building.

### 3. Download the model weights

The image ships **without** weights. Put them in `docker/fish-audio/checkpoints/`
(gitignored); the compose file mounts that at `/app/checkpoints`. `fishaudio/s2-pro`
is a public (non-gated) repo — no Hugging Face account needed. It's ~11 GB
(`codec.pth` 1.8 GB + two `model-*.safetensors` shards ~8.6 GB).

With `git` + `git-lfs` (nothing else to install):

```bash
git clone https://huggingface.co/fishaudio/s2-pro docker/fish-audio/checkpoints/s2-pro
```

Or with the Hugging Face CLI, if you'd rather:

```bash
pip install -U "huggingface_hub[cli]"
hf download fishaudio/s2-pro --local-dir docker/fish-audio/checkpoints/s2-pro
```

Either way you should end up with `docker/fish-audio/checkpoints/s2-pro/codec.pth`
plus `model-*.safetensors`, `config.json`, tokenizer files, etc. (If upstream
renames the default checkpoint, adjust `LLAMA_CHECKPOINT_PATH` /
`DECODER_CHECKPOINT_PATH` via `environment:` in `compose.yml` — the current
defaults are baked for `checkpoints/s2-pro`.)

### 3b. Fit the model to your VRAM (16 GB cards)

s2-pro reserves a KV cache for a 32k-token context it never uses for TTS. On a
16 GB GPU that pushes total usage to ~22 GB — it spills into system RAM and
generation drops to ~0.05 tok/s (minutes per sentence). Shrink the cache:

```bash
python - <<'PY'
import json, pathlib
p = pathlib.Path("docker/fish-audio/checkpoints/s2-pro/config.json")
d = json.loads(p.read_text())
d["text_config"]["max_seq_len"] = 4096          # was 32768
p.write_text(json.dumps(d, indent=1))
print("patched:", d["text_config"]["max_seq_len"])
PY
```

That drops peak VRAM to ~15 GB and generation to ~5 tok/s (~25 s for a
2-sentence reply) on an RTX 4060 Ti. 4096 leaves ~2k tokens for the prompt and
~2k for output — plenty for Verity's 1-3 sentence replies. Skip this on a 24 GB+
card. `--half` in `compose.yml` also helps and is on by default. If you
re-download the weights, re-apply this.

### 4. Build and start

```bash
docker compose -f docker/fish-audio/compose.yml up -d --build
```

The first build downloads a CUDA base image and compiles wheels — **10-20 min**
is normal. Follow along with:

```bash
docker compose -f docker/fish-audio/compose.yml logs -f
```

Wait for the health check to go healthy:

```bash
docker compose -f docker/fish-audio/compose.yml ps
```

### 5. Smoke test

```bash
PORT=$(grep -E '^FISH_PORT=' docker/fish-audio/.env | cut -d= -f2)
KEY=$(grep -E '^FISH_API_KEY=' docker/fish-audio/.env | cut -d= -f2)
curl -sS -X POST "http://localhost:${PORT}/v1/tts" \
  -H "Authorization: Bearer ${KEY}" \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello. I am Verity.","format":"wav"}' \
  --output /tmp/verity-tts-test.wav
# play /tmp/verity-tts-test.wav in any audio player
```

A non-empty WAV means the server is good.

### 6. Point Verity at it

Open Verity → tray → **Settings** → **Speak replies aloud**:

| Field           | Value                                                            |
| --------------- | ---------------------------------------------------------------- |
| Engine          | **Fish Audio (natural)**                                         |
| Server URL      | `http://localhost:<FISH_PORT>` (e.g. `http://localhost:8081`)    |
| API key         | the `FISH_API_KEY` from `.env`                                   |
| Voice reference | blank for the default voice, or a reference id (see below)       |
| Audio format    | `wav` (most compatible) — `mp3` is smaller, `opus` smaller still |

Save. The next reply Verity speaks is synthesized by the server. The **Rate**
slider still applies (it sets audio playback speed).

---

## Custom / cloned voices

fish-speech can clone a voice from a 10-30 s clean sample. Two ways to use one:

**Staged reference archive (recommended).** Drop a folder under
`docker/fish-audio/references/<name>/` containing matching `*.wav` + `*.lab`
(transcript) pairs, restart the container, then set **Voice reference** in
Verity to `<name>`. See the
[fish-speech docs](https://speech.fish.audio/inference/#reference-voices) for the
exact archive layout.

**Fish Audio hosted model id.** If you have a `reference_id` from the hosted
[fish.audio](https://fish.audio) playground and your server is configured to
resolve it, paste that id into **Voice reference**.

---

## Operating

```bash
# stop
docker compose -f docker/fish-audio/compose.yml down

# update to a newer fish-speech
git -C docker/fish-audio/fish-speech pull
docker compose -f docker/fish-audio/compose.yml build --no-cache
docker compose -f docker/fish-audio/compose.yml up -d

# logs
docker compose -f docker/fish-audio/compose.yml logs -f fish-audio
```

Pin a known-good version once it works:
`git -C docker/fish-audio/fish-speech checkout <tag>` before rebuilding.

---

## Troubleshooting

| Symptom                                                               | Likely cause / fix                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verity always uses the robotic OS voice                               | Server unreachable or auth wrong. Check `docker compose ... ps`, run the step-4 curl, check the URL/key in Settings. Verity logs the failure — Settings → **Open Log Folder**.                                                                        |
| `compose` refuses to start, mentions `FISH_API_KEY`                   | You didn't create `.env` or didn't set the key.                                                                                                                                                                                                       |
| Container crash-loops, log stops at `Loading model` with no traceback | Out of RAM inside the Docker/WSL2 VM (silent OOM kill). The model needs ~14 GB to load. On WSL2 raise the VM cap: create `C:\Users\<you>\.wslconfig` with `[wsl2]` / `memory=24GB`, then `wsl --shutdown`. Check with `docker info` → `Total Memory`. |
| Generation is ~0.05 tok/s, log says `GPU Memory used: 22 GB`          | Model overflowed VRAM into system RAM. Apply the KV-cache shrink in step 3b, keep `--half`, and stop other GPU apps (`docker stop llama-cpp-gpu-server` etc.).                                                                                        |
| Health check never passes but `/v1/tts` works                         | The old health check hit `/v1/health` (needs auth). Fixed to hit `/` — `docker compose ... up -d` to pick it up.                                                                                                                                      |
| `could not select device driver "nvidia"`                             | NVIDIA Container Toolkit not installed/configured on the host.                                                                                                                                                                                        |
| Out of VRAM even after step 3b                                        | Stop other GPU processes, or run `FISH_BACKEND=cpu` (rebuild; ~1-2 min per reply, needs the RAM bump too).                                                                                                                                            |

## Performance

On an RTX 4060 Ti (16 GB) with step 3b applied: ~5 tok/s, roughly **20-30 s to
synthesize a 2-sentence reply**, ~15 GB VRAM. Verity plays it once it arrives and
falls back to the system voice if the server is slow enough to time out (90 s).
Keep other GPU model servers stopped while this runs.

## Privacy

Every reply Verity speaks with this engine is sent as text to the Server URL you
configure. With the default `http://localhost:8081` that stays on your machine.
If you point it at a remote host, that host sees Verity's reply text.
