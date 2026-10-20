#!/usr/bin/env python
"""Read-only inventory + SHA-256 manifest for KB-INGEST-001."""
from __future__ import annotations

import csv
import hashlib
import json
import pathlib
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / "raw_data"
OUT = ROOT / "artifacts" / "kb-ingest-001" / "manifests"
OUT.mkdir(parents=True, exist_ok=True)


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def tree_stats(path: pathlib.Path, skip_dirs: set[str] | None = None) -> dict:
    skip_dirs = skip_dirs or set()
    files = []
    for file in sorted(path.rglob("*")):
        if not file.is_file():
            continue
        if any(part in skip_dirs for part in file.relative_to(path).parts):
            continue
        files.append(file)
    total = sum(f.stat().st_size for f in files)
    digest = hashlib.sha256()
    for file in files:
        rel = file.relative_to(path).as_posix()
        digest.update(f"{rel}\0{sha256_file(file)}\n".encode("utf-8"))
    return {"files": len(files), "bytes": total, "sha256": digest.hexdigest()}


def line_count(path: pathlib.Path) -> int:
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        return sum(1 for line in handle if line.strip())


def add(rows: list[dict], source_id: str, name: str, path: str, origin: str, license_id: str, license_status: str, row_count: int | None, docs: int | None, notes: str, source_type: str = "dataset", hash_tree: bool = True, skip_dirs: set[str] | None = None):
    full = ROOT / path
    if not full.exists():
        rows.append({
            "source_id": source_id, "name": name, "path": path, "origin_url": origin,
            "license_id": license_id, "license_status": license_status, "source_type": source_type,
            "rows": row_count, "documents": docs, "files": 0, "bytes": 0, "sha256": "", "status": "missing", "notes": notes,
        })
        return
    if full.is_file():
        stats = {"files": 1, "bytes": full.stat().st_size, "sha256": sha256_file(full)}
    elif hash_tree:
        stats = tree_stats(full, skip_dirs)
    else:
        files = [f for f in full.rglob("*") if f.is_file() and not any(p in {"node_modules", ".git", ".hf-cache"} for p in f.relative_to(full).parts)]
        stats = {"files": len(files), "bytes": sum(f.stat().st_size for f in files), "sha256": ""}
    rows.append({
        "source_id": source_id, "name": name, "path": path, "origin_url": origin,
        "license_id": license_id, "license_status": license_status, "source_type": source_type,
        "rows": row_count, "documents": docs, "files": stats["files"], "bytes": stats["bytes"],
        "sha256": stats["sha256"], "status": "inventory_ok", "notes": notes,
    })


def main() -> None:
    rows: list[dict] = []
    add(rows, "wixqa_partial", "WixQA legacy partial download", "raw_data/WixQA", "https://huggingface.co/datasets/Wix/WixQA", "MIT", "license_candidate_verify", 200, 200, "Only wixqa_expertwritten train/200 is present; the old loader confused config with split. Kept read-only.", source_type="benchmark", hash_tree=True)
    add(rows, "wixqa_full", "WixQA all four configs", "raw_data/WixQA-full", "https://huggingface.co/datasets/Wix/WixQA", "MIT", "license_candidate_verify", 12842, 12842, "wixqa_expertwritten 200; wixqa_simulated 200; wixqa_synthetic 6221; wix_kb_corpus 6221. See raw_data/WixQA-full/manifest.json.", source_type="benchmark")
    add(rows, "ecommerce_ai_skills", "kangise/ecommerce-ai-skills ontology + chapters", "raw_data/ecommerce-ai-skills", "https://github.com/kangise/ecommerce-ai-skills", "CC0-1.0", "verified_repo_license", None, 960, "960 files; 100 entities / 78 relations / 322 constraints / 8 processes / 15 platforms; O1-O5 verification passes 0 errors. Source: ontology/*.yaml.", source_type="ontology", hash_tree=True, skip_dirs={".git", "node_modules", ".hf-cache", "dist", "artifacts"})
    add(rows, "massive", "Amazon MASSIVE (MTEB mirror)", "raw_data/massive", "https://huggingface.co/datasets/mteb/amazon_massive_intent", "CC-BY-4.0", "attribution_required", 842571, 842571, "51 language configs x 16,521 = 842,571 unique rows; the default config duplicates all languages, so raw summary 1,685,142 is a double count. 183,353,316 bytes. This is the MTEB mirror, not the official AmazonScience/massive 1.1 archive.", source_type="dataset", hash_tree=True)
    add(rows, "mtop", "MTOP (community mirror)", "raw_data/mtop", "https://huggingface.co/datasets/WillHeld/mtop", "UNVERIFIED", "review_required", 104445, 104445, "6 languages; 104,445 rows. License/revision must be verified before commercial use.", source_type="dataset", hash_tree=True)
    add(rows, "multiwoz", "MultiWOZ 2.2 (community mirror)", "raw_data/multiwoz", "https://huggingface.co/datasets/pietrolesci/multiwoz_all_versions", "UNVERIFIED", "review_required", 81959, 81959, "English task dialogue; 81,959 rows. Verify mirror license and source attribution.", source_type="dataset", hash_tree=True)
    add(rows, "clinc150", "CLINC150 (plus config)", "raw_data/clinc150", "https://huggingface.co/datasets/clinc/clinc_oos", "UNVERIFIED", "review_required", 23850, 23850, "23,850 rows; English intent benchmark. Verify license before redistribution.", source_type="dataset", hash_tree=True)
    add(rows, "bitext", "Bitext customer-support LLM training set", "raw_data/bitext.jsonl", "https://huggingface.co/datasets/bitext/Bitext-customer-support-llm-chatbot-training-dataset", "CDLA-Sharing-1.0", "review_required", 26872, 26872, "26,872 Q/A pairs. Dataset card license is CDLA-Sharing-1.0; do NOT treat as MIT/Apache. Legal review required.", source_type="dataset", hash_tree=True)
    add(rows, "seller_extra", "Shopify/Google public-web seller snapshot", "raw_data/seller_extra", "https://shopify.com/blog + https://grow.google/", "UNVERIFIED", "review_required", None, 6, "Five Shopify articles + one Google Digital Garage/Grow page. Publicly accessible is not the same as licensed for commercial derivative KB.", source_type="public_web", hash_tree=True)
    add(rows, "webfaq_traveling", "WebFAQ traveling dump", "raw_data/webfaq_traveling.jsonl", "UNKNOWN", "UNKNOWN", "quarantine", line_count(RAW / "webfaq_traveling.jsonl"), line_count(RAW / "webfaq_traveling.jsonl"), "License/source unknown; keep out of production until provenance is established.", source_type="dataset", hash_tree=True)
    add(rows, "glossary", "Derived glossary", "raw_data/glossary/terms.json", "derived from ecommerce-ai-skills", "CC0-1.0", "derived", None, 100, "Derived data; keep source pointer. Not an independent raw source.", source_type="derived", hash_tree=True)
    for name in ["candidates.jsonl", "candidates.skills.jsonl", "candidates.bitext.jsonl", "candidates.seller_extra.jsonl", "candidates.lang.jsonl"]:
        path = RAW / name
        if path.exists():
            add(rows, f"derived_{name.replace('.', '_')}", f"Derived cards: {name}", f"raw_data/{name}", "derived from raw sources", "VARIES", "derived_review_required", line_count(path), None, "Derived candidate cards; not approved knowledge. Do not treat as production.", source_type="derived")
    add(rows, "hf_cache", "Hugging Face download cache", "raw_data/.hf-cache", "local cache", "N/A", "cache", None, None, "593 MB operational cache; not a knowledge source and not accepted as raw data.", source_type="cache", hash_tree=False)

    fieldnames = ["source_id", "name", "path", "origin_url", "license_id", "license_status", "source_type", "rows", "documents", "files", "bytes", "sha256", "status", "notes"]
    out_csv = OUT / "source_manifest.csv"
    with out_csv.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    (OUT / "source_manifest.json").write_text(json.dumps({"generated_at": datetime.now(timezone.utc).isoformat(), "sources": rows}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # Per-file hashes for the WixQA vault and key license/ontology artifacts.
    file_rows = []
    for base in [RAW / "WixQA-full", RAW / "WixQA"]:
        for file in sorted(base.rglob("*")):
            if file.is_file():
                file_rows.append({"source_id": base.name, "file": str(file.relative_to(ROOT)).replace("\\", "/"), "bytes": file.stat().st_size, "sha256": sha256_file(file)})
    for file in sorted((RAW / "ecommerce-ai-skills" / "ontology").glob("*.yaml")):
        file_rows.append({"source_id": "ecommerce_ai_skills", "file": str(file.relative_to(ROOT)).replace("\\", "/"), "bytes": file.stat().st_size, "sha256": sha256_file(file)})
    with (OUT / "file_hashes.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["source_id", "file", "bytes", "sha256"])
        writer.writeheader()
        writer.writerows(file_rows)

    print(f"[manifest] {out_csv} ({len(rows)} sources)")
    print(f"[hashes]   {OUT / 'file_hashes.csv'} ({len(file_rows)} files)")
    for row in rows:
        print(f"  {row['source_id']:24} rows={row['rows']} docs={row['documents']} bytes={row['bytes']} license={row['license_id']} status={row['status']}")


if __name__ == "__main__":
    main()


