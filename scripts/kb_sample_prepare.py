#!/usr/bin/env python
"""Prepare a small, deterministic WixQA sample for schema/source verification.

Read-only with respect to raw_data; only writes under artifacts/kb-ingest-001.
"""
from __future__ import annotations

import json
import pathlib

from datasets import load_from_disk

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / "raw_data" / "WixQA-full"
OUT = ROOT / "artifacts" / "kb-ingest-001"
SAMPLE_N = 20
MAX_SOURCE_CHARS = 8000

OUT_SAMPLES = OUT / "samples"
OUT_SAMPLES.mkdir(parents=True, exist_ok=True)

qa = load_from_disk(str(RAW / "wixqa_expertwritten"))["train"]
kb = load_from_disk(str(RAW / "wix_kb_corpus"))["train"]
by_id = {row["id"]: row for row in kb}

records = []
for idx, row in enumerate(qa):
    article_ids = row.get("article_ids") or []
    if len(article_ids) != 1:
        continue
    article_id = article_ids[0]
    article = by_id.get(article_id)
    if not article:
        continue
    source = (article.get("contents") or "").strip()
    if len(source) < 300:
        continue
    records.append({
        "sample_id": f"wixqa_expertwritten_{idx:04d}",
        "config": "wixqa_expertwritten",
        "source_row_index": idx,
        "question": row["question"],
        "reference_answer": row["answer"],
        "article_id": article_id,
        "article_title": article.get("title") or "",
        "article_url": article.get("url") or "",
        "source_chars_original": len(source),
        "source_text": source[:MAX_SOURCE_CHARS],
        "source_truncated": len(source) > MAX_SOURCE_CHARS,
    })
    if len(records) >= SAMPLE_N:
        break

if len(records) < SAMPLE_N:
    raise SystemExit(f"only found {len(records)} suitable samples")

sample_path = OUT_SAMPLES / "wixqa_expertwritten_20.jsonl"
sample_path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records), encoding="utf-8")
print(f"wrote {sample_path} ({len(records)} records)")

schema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "KB candidate knowledge card (pilot)",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "card_id_candidate", "scope", "audience", "source_id", "document_id",
        "intent_id_candidate", "user_goal", "safe_answer_template",
        "evidence_quotes", "unsupported_claims", "confidence", "review_status", "notes"
    ],
    "properties": {
        "card_id_candidate": {"type": "string", "pattern": "^[a-z0-9][a-z0-9._-]{2,100}$"},
        "scope": {"const": "industry"},
        "audience": {"const": "seller"},
        "source_id": {"type": "string", "minLength": 1},
        "document_id": {"type": "string", "minLength": 1},
        "intent_id_candidate": {"type": "string", "pattern": "^[a-z0-9][a-z0-9._-]{2,100}$"},
        "user_goal": {"type": "string", "minLength": 10, "maxLength": 500},
        "safe_answer_template": {"type": "string", "minLength": 20, "maxLength": 2000},
        "evidence_quotes": {"type": "array", "minItems": 1, "maxItems": 5, "items": {"type": "string", "minLength": 15, "maxLength": 800}},
        "unsupported_claims": {"type": "array", "maxItems": 10, "items": {"type": "string"}},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "review_status": {"enum": ["candidate", "needs_human_review"]},
        "notes": {"type": "string", "maxLength": 1000}
    }
}
schema_path = OUT_SAMPLES / "candidate-card.schema.json"
schema_path.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8")
print(f"wrote {schema_path}")

manifest = {
    "sample_count": len(records),
    "source_config": "wixqa_expertwritten",
    "source_rows": len(qa),
    "kb_rows": len(kb),
    "max_source_chars": MAX_SOURCE_CHARS,
    "selection": "first 20 expertwritten rows with exactly one matching KB article and >=300 chars",
    "sample_path": str(sample_path.relative_to(ROOT)).replace("\\", "/"),
    "schema_path": str(schema_path.relative_to(ROOT)).replace("\\", "/"),
}
(OUT / "samples" / "sample_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(json.dumps(manifest, indent=2))
