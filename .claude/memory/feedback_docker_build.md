---
name: Docker Build Lessons
description: Fixes required when rebuilding the MAC Docker image — package names, compiler, env_file
type: feedback
originSessionId: 97eb3ef1-f047-49ed-8434-0c6440cca16d
---
Always required when rebuilding MAC Docker image from scratch:

1. **`libgl1` not `libgl1-mesa-glx`** — mesa-glx was removed in Debian Trixie (python:3.11-slim now uses Trixie). Use `libgl1`.

2. **Add `gcc g++`** — insightface compiles Cython extensions (`mesh_core_cython.cpp`) that need g++. Without it, `pip install -r requirements.txt` fails.

3. **`env_file: .env` crashes if .env missing** — docker compose v2 fails hard if env_file path doesn't exist. Fixed to `env_file: [{path: .env, required: false}]`. Also: `start-mac.bat` now copies `.env.example → .env` if missing.

4. **TTS GPU reservation crashes no-GPU machines** — Removed `deploy.resources.reservations.devices` from `tts` service. Veena uses `VEENA_DEVICE=auto` which detects GPU at runtime — no Docker reservation needed.

5. **`mac-tts` image naming** — docker compose project `mac` builds `mac-tts:latest`. Older runs used `macmac-tts:latest`. start-mac.bat retagging step handles this.

**Why:** All of these were discovered when running `start-mac.bat` on the no-GPU dev PC (2026-05-10).

**How to apply:** When build fails, check these in order: libgl1 → gcc g++ → env_file → GPU reservation.

Dev seed credentials (MAC_ENV=development):
- Admin:   abhisek.cse@mbm.ac.in / Admin@1234
- Faculty: raj.cse@mbm.ac.in     / Faculty@1234
- Student: 21CS045               / Student@1234
