---
name: MAC Project Overview
description: MAC (MBM AI Cloud) self-hosted campus AI platform — architecture, 3-PC cluster, key features
type: project
originSessionId: 97eb3ef1-f047-49ed-8434-0c6440cca16d
---
MAC is a fully self-hosted AI platform for MBM University, Jodhpur built with FastAPI + vanilla JS frontend + Docker.

**Repo location**: D:\MyMac\MAC

**Tech stack**: FastAPI 0.115, PostgreSQL 16, Redis 7, Qdrant (RAG), SearXNG (web search), vLLM (GPU inference), insightface (face recognition), Whisper STT, Veena TTS

**3-PC cluster setup**:
- PC1 (Host): `start-host-pc1.bat` — runs all infrastructure + Qwen2.5-7B-AWQ chat
- PC2 (Worker): `start-worker-pc2-mistral.bat` — Mistral-7B creative chat
- PC3 (Worker): `start-worker-pc3-vision.bat` — Qwen2-VL-7B vision/image model

**Key features**: Face attendance (insightface ArcFace), RAG knowledgebase, voice-to-voice chat, web search (SearxNG), plagiarism check, exam system, multi-language (19 languages)

**Why:** Because the face recognition was completely broken (SHA-512 hash instead of real ML embeddings). Fixed 2026-05-10 with insightface + ONNX ArcFace buffalo_sc model.

**How to apply:** When working on attendance system, use insightface embeddings (512D float32). The `FACE_MATCH_THRESHOLD=0.35` cosine similarity is the key tuning parameter.

**Migration chain**: 0001 → 0002 → 0003 → 0004 → 0005 → 0006 (latest: adds face_photo_path)
