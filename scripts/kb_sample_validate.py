#!/usr/bin/env python
"""Validate raw local-model outputs against JSON Schema and source evidence."""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from kb_sample_extract import OUT, SAMPLES, SCHEMA, extract_json_object, validate_card

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-file", required=True)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    samples = [json.loads(line) for line in SAMPLES.read_text(encoding="utf-8").splitlines() if line.strip()]
    sample_by_id = {s["sample_id"]: s for s in samples}
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    raw_rows = [json.loads(line) for line in Path(args.raw_file).read_text(encoding="utf-8-sig").splitlines() if line.strip()]
    if args.limit:
        raw_rows = raw_rows[:args.limit]

    results = []
    for raw_row in raw_rows:
        sample = sample_by_id.get(raw_row.get("sample_id"))
        if not sample:
            results.append({"sample_id": raw_row.get("sample_id"), "final_status": "failed", "error": "sample not found"})
            continue
        card = extract_json_object(raw_row.get("content", ""))
        if not card:
            results.append({
                "sample_id": sample["sample_id"], "article_id": sample["article_id"],
                "final_status": "failed", "error": "unparseable model JSON",
                "validation": {"schema_valid": False, "schema_errors": ["unparseable"], "evidence_valid": False, "invalid_quotes": [], "source_id_match": False, "document_id_match": False},
            })
            continue
        validation = validate_card(card, schema, sample)
        results.append({
            "sample_id": sample["sample_id"],
            "article_id": sample["article_id"],
            "source_url": sample["article_url"],
            "source_title": sample["article_title"],
            "model": raw_row.get("model"),
            "elapsed_s": raw_row.get("elapsed_s"),
            "card": card,
            "validation": validation,
            "final_status": "schema_and_evidence_pass" if validation["schema_valid"] and validation["evidence_valid"] else "needs_human_review",
        })

    schema_pass = sum(1 for r in results if r.get("validation", {}).get("schema_valid"))
    evidence_pass = sum(1 for r in results if r.get("validation", {}).get("evidence_valid"))
    both = sum(1 for r in results if r.get("validation", {}).get("schema_valid") and r.get("validation", {}).get("evidence_valid"))
    failed = sum(1 for r in results if r.get("final_status") == "failed")
    review = sum(1 for r in results if r.get("card", {}).get("review_status") == "needs_human_review")
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "pilot": True,
        "sample_count": len(results),
        "model": results[0].get("model") if results else None,
        "counts": {
            "schema_pass": schema_pass,
            "evidence_pass": evidence_pass,
            "schema_and_evidence_pass": both,
            "needs_human_review": review,
            "failed": failed,
        },
        "policy": "WixQA is a public Wix-specific benchmark. These are pilot candidates, not tenant policy; all require human review before production.",
        "raw_file": str(Path(args.raw_file).resolve()),
        "sample_file": str(SAMPLES.resolve()),
        "schema_file": str(SCHEMA.resolve()),
        "results": results,
    }
    out = OUT / "reports" / "sample-extraction-validated.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    out_jsonl = OUT / "samples" / f"validated_cards_{len(results)}.jsonl"
    out_jsonl.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in results), encoding="utf-8")
    print(json.dumps(report["counts"], indent=2))
    print(f"[report] {out}")
    print(f"[cards]  {out_jsonl}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
