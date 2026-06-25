# Testing the fork in Docker (isolated from your existing ABS)

This runs the fork in a container that is **completely separate** from any Audiobookshelf
you already have installed — different port, different data. Nothing here touches your real
library database.

## Why Docker for testing

- It builds and runs the fork exactly as it would ship (client + server + ffmpeg + the
  nunicode SQLite extension), so it's a true end-to-end check.
- It's isolated: a separate port (`13379`) and fork-only volumes (`./.fork-data/`). Your
  existing ABS (default `:13378`, its own config) is never read or written.
- Audiobookshelf's own docs treat Docker as the baseline deployment, so this is the
  highest-fidelity way to dogfood AI features before worrying about Windows packaging.

## Prerequisites

1. **Docker Desktop** running.
2. **Ollama** running on your host with a model pulled:
   ```bash
   ollama pull llama3.1
   ```
3. A handful of **test audiobooks**. Copy a few into `./.fork-data/audiobooks/`
   (a copy is safest — the mount is read-only, but a copy removes all doubt).

## Run it

From `D:\ABS-FORK-AI\audiobookshelf`:

```bash
docker compose -f docker-compose.fork.yml up --build
```

Then open **http://localhost:13379** and create the initial admin user.
Your existing ABS on `:13378` keeps running, untouched.

## Turn on AI curation

1. **Settings** → **AI Curation** → enable **AI metadata curation**.
   - Base URL is preset to `http://host.docker.internal:11434` (your host's Ollama) via the
     compose env. Model defaults to `llama3.1`.
2. Add the `./.fork-data/audiobooks` folder as a library and let it scan.
3. Per item: open a book → **AI Suggestions** tab → **Generate** → accept/reject.
4. Library-wide: the **AI Inbox** in the left rail → **Generate** fills the queue in
   bounded batches; review everything in one place.

## Isolation guarantees

| Concern | How it's isolated |
|---|---|
| Port | `13379` (host) → `80` (container); never the ABS default `13378` |
| Config / DB | `./.fork-data/config` — a fresh `absdatabase.sqlite`, not your real one |
| Metadata | `./.fork-data/metadata` — separate from your install |
| Media files | `./.fork-data/audiobooks` mounted **read-only** (`:ro`); files can't be modified |
| Provider | Local Ollama only; AI is **off by default** until you enable it |

## Teardown

```bash
docker compose -f docker-compose.fork.yml down     # stop + remove the container
rm -rf ./.fork-data                                # wipe all fork test data
```

`./.fork-data/` is gitignored, so test data never gets committed.
