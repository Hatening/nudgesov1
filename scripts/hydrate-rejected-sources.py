#!/usr/bin/env python
"""Hydrate rejected recycle-pool rows with the original answer and source text.

The rejected JSONL kept only question/reason. For cloud rescue and the local
evidence gate we need:
  - the original answer (WixQA row / candidates.skills.jsonl row);
  - the full source article or markdown file.

This script is read-only against raw_data and writes one local JSONL:
  raw_data/rejected_with_sources.jsonl

It never calls a model or a cloud API.
"""
from __future__ import annotations

import argparse
import ast
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw_data"
POOL = RAW / "recycle_pool.jsonl"
OUT = RAW / "rejected_with_sources.jsonl"
WIX = RAW / "WixQA-full"
CANDIDATES = RAW / "candidates.skills.jsonl"


def parse_ids(value):
    if isinstance(value, (list, tuple)):
        return list(value)
    if isinstance(value, str):
        try:
            parsed = ast.literal_eval(value)
            if isinstance(parsed, (list, tuple)):
                return list(parsed)
        except Exception:
            pass
        return [value]
    return []


def article_text(article_ids, corpus):
    texts = []
    refs = []
    for article_id in article_ids:
        article = corpus.get(article_id)
        if not article:
            continue
        texts.append("\n".join(str(article.get(key) or "") for key in ("title", "url", "contents")))
        refs.append({
            "article_id": article_id,
            "title": article.get("title") or "",
            "url": article.get("url") or "",
        })
    return "\n\n".join(texts), refs


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pool", default=str(POOL))
    parser.add_argument("--out", default=str(OUT))
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    pool_path = Path(args.pool)
    out_path = Path(args.out)
    rows = [json.loads(line) for line in pool_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if args.limit:
        rows = rows[: args.limit]

    candidates = []
    if CANDIDATES.exists():
        candidates = [
            json.loads(line)
            for line in CANDIDATES.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

    corpus_ds = None
    corpus = None
    configs = {}
    hydrated = 0
    missing = 0
    source_chars = []
    by_source_type = {}

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as handle:
        for row in rows:
            source = str(row.get("source") or "")
            source_type = str(row.get("source_type") or "")
            by_source_type[source_type] = by_source_type.get(source_type, 0) + 1
            idx = int(row.get("idx") or 0)
            question = str(row.get("question") or "").strip()
            original_answer = ""
            source_text = ""
            source_title = ""
            source_url = ""
            language = "en" if source_type == "wixqa" else "zh"
            category = "平台规则" if source_type == "wixqa" else "其他"
            hydrate_error = ""

            if source.startswith("wixqa_"):
                ds = configs.get(source)
                if ds is None:
                    ds = load_config(source)
                    configs[source] = ds
                if idx >= len(ds):
                    hydrate_error = f"row index {idx} outside {source} ({len(ds)})"
                else:
                    item = ds[idx]
                    original_answer = str(item.get("answer") or "")
                    if not question:
                        question = str(item.get("question") or "").strip()
                    if corpus is None:
                        corpus_ds = load_corpus()
                        corpus = {article["id"]: article for article in corpus_ds}
                    article_ids = parse_ids(item.get("article_ids"))
                    source_text, refs = article_text(article_ids, corpus)
                    if refs:
                        source_title = refs[0]["title"]
                        source_url = refs[0]["url"]
                    if not source_text:
                        hydrate_error = "no source article matched article_ids"
                    if not original_answer:
                        hydrate_error = hydrate_error or "empty original answer"
            elif source.startswith("raw_data/ecommerce-ai-skills/"):
                if idx >= len(candidates):
                    hydrate_error = f"candidate index {idx} outside candidates.skills.jsonl ({len(candidates)})"
                else:
                    candidate = candidates[idx]
                    original_answer = str(candidate.get("answer") or "")
                    if not question:
                        question = str(candidate.get("question") or "").strip()
                    category = str(candidate.get("category") or "其他")
                    language = str(candidate.get("language") or "zh")
                    source_path = ROOT / source
                    if not source_path.exists():
                        hydrate_error = f"source file missing: {source}"
                    else:
                        source_text = source_path.read_text(encoding="utf-8", errors="replace")
                        source_title = source_path.name
                    if not original_answer:
                        hydrate_error = hydrate_error or "empty original answer"
            else:
                hydrate_error = f"unknown source: {source}"

            ok = bool(source_text and original_answer and not hydrate_error)
            if ok:
                hydrated += 1
                source_chars.append(len(source_text))
            else:
                missing += 1

            record = {
                **row,
                "question": question,
                "original_answer": original_answer,
                "source_text": source_text,
                "source_title": source_title,
                "source_url": source_url,
                "category": category,
                "language": language,
                "hydrate_ok": ok,
                "hydrate_error": hydrate_error,
            }
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    stats = {
        "pool": str(pool_path.relative_to(ROOT)).replace("\\", "/"),
        "out": str(out_path.relative_to(ROOT)).replace("\\", "/"),
        "total": len(rows),
        "hydrated": hydrated,
        "missing": missing,
        "by_source_type": by_source_type,
        "source_chars_avg": round(sum(source_chars) / len(source_chars)) if source_chars else 0,
        "source_chars_max": max(source_chars) if source_chars else 0,
    }
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    return 0 if missing == 0 else 1


def load_corpus():
    from datasets import load_from_disk
    return load_from_disk(str(WIX / "wix_kb_corpus"))["train"]


def load_config(config):
    from datasets import load_from_disk
    return load_from_disk(str(WIX / config))["train"]


if __name__ == "__main__":
    raise SystemExit(main())
