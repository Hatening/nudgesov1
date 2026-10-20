#!/usr/bin/env python
"""WixQA four-config downloader.

Fixes the old download that only fetched one config/split.

- Downloads all four public configs:
  wixqa_expertwritten, wixqa_simulated, wixqa_synthetic, wix_kb_corpus
- Saves each config in its own directory under a NEW output root.
- Never overwrites existing files; if a target exists, it is left untouched.
- Records actual row counts, file sizes, per-file SHA-256, aggregate SHA-256.
- Records dataset revision and license notice when available.

Usage:
  python scripts/wixqa_download.py --out raw_data/WixQA-full
  python scripts/wixqa_download.py --out raw_data/WixQA-full --configs wixqa_expertwritten,wix_kb_corpus
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

# Keep this consistent with the existing local fetch scripts.
for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
    os.environ.pop(key, None)
os.environ["NO_PROXY"] = "*"
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

from datasets import get_dataset_config_names, load_dataset, load_dataset_builder  # noqa: E402
from huggingface_hub import hf_hub_download  # noqa: E402

DATASET = "Wix/WixQA"
CONFIGS = [
    "wixqa_expertwritten",
    "wixqa_simulated",
    "wixqa_synthetic",
    "wix_kb_corpus",
]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_tree(root: Path) -> tuple[str, int, int]:
    """Aggregate hash over relative path + file hash, excluding manifest files."""
    rows = []
    total_bytes = 0
    for file in sorted(root.rglob("*")):
        if not file.is_file():
            continue
        rel = file.relative_to(root).as_posix()
        if rel.startswith("_") or rel in {"manifest.json", "LICENSE-NOTICE.md"}:
            continue
        total_bytes += file.stat().st_size
        rows.append((rel, sha256_file(file)))
    digest = hashlib.sha256()
    for rel, file_hash in rows:
        digest.update(f"{rel}\0{file_hash}\n".encode("utf-8"))
    return digest.hexdigest(), total_bytes, len(rows)


def fetch_dataset_notice(out: Path) -> dict:
    notice = {}
    try:
        readme = hf_hub_download(DATASET, "README.md", repo_type="dataset")
        text = Path(readme).read_text(encoding="utf-8", errors="replace")
        target = out / "LICENSE-NOTICE.md"
        if not target.exists():
            target.write_text(
                f"# WixQA dataset card / license notice\n\n"
                f"Source: https://huggingface.co/datasets/{DATASET}\n"
                f"Downloaded: {datetime.now(timezone.utc).isoformat()}\n\n"
                f"## README.md\n\n{text}\n",
                encoding="utf-8",
            )
        notice["dataset_card"] = "LICENSE-NOTICE.md"
    except Exception as exc:  # keep downloading data even if card fetch fails
        notice["dataset_card_error"] = str(exc)
    try:
        info = load_dataset_builder(DATASET).info
        notice["builder_license"] = getattr(info, "license", None) or ""
        notice["builder_citation"] = getattr(info, "citation", None) or ""
        notice["builder_homepage"] = getattr(info, "homepage", None) or ""
    except Exception as exc:
        notice["builder_info_error"] = str(exc)
    return notice


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="raw_data/WixQA-full")
    parser.add_argument("--configs", default=",".join(CONFIGS))
    args = parser.parse_args()

    out = Path(args.out).resolve()
    selected = [c.strip() for c in args.configs.split(",") if c.strip()]
    available = get_dataset_config_names(DATASET)
    missing = [c for c in selected if c not in available]
    if missing:
        print(f"[fatal] unknown config(s): {missing}; available={available}", file=sys.stderr)
        return 2

    out.mkdir(parents=True, exist_ok=True)
    print(f"[dataset] {DATASET}")
    print(f"[out]     {out}")
    print(f"[configs] {selected}")
    print(f"[notice]  {fetch_dataset_notice(out)}")

    records = []
    for config in selected:
        target = out / config
        if target.exists():
            print(f"[skip] {config}: target exists, not overwriting {target}")
            sha, size, count = sha256_tree(target)
            records.append({"config": config, "path": str(target), "status": "existing", "rows": None, "bytes": size, "files": count, "sha256": sha})
            continue

        print(f"\n[download] {config}")
        ds = load_dataset(DATASET, config)
        splits = {}
        for split_name in ds.keys():
            splits[split_name] = len(ds[split_name])
            print(f"  split {split_name}: {len(ds[split_name])} rows")
        ds.save_to_disk(str(target))
        sha, size, count = sha256_tree(target)
        records.append({
            "config": config,
            "path": str(target),
            "status": "downloaded",
            "splits": splits,
            "rows": sum(splits.values()),
            "bytes": size,
            "files": count,
            "sha256": sha,
        })
        print(f"  saved={target} rows={sum(splits.values())} bytes={size} files={count} sha256={sha}")

    manifest = {
        "dataset": DATASET,
        "hf_endpoint": os.environ.get("HF_ENDPOINT"),
        "downloaded_at": datetime.now(timezone.utc).isoformat(),
        "out": str(out),
        "configs": records,
        "total_rows": sum(r.get("rows") or 0 for r in records if r.get("rows") is not None),
        "total_bytes": sum(r["bytes"] for r in records),
        "total_files": sum(r["files"] for r in records),
        "notes": [
            "Raw data is read-only in downstream steps; this script never overwrites an existing config directory.",
            "License status must be reviewed before commercial use; the dataset card copy is for review, not a legal conclusion.",
        ],
    }
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\n[manifest] {out / 'manifest.json'}")
    print(f"[total] rows={manifest['total_rows']} bytes={manifest['total_bytes']} files={manifest['total_files']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
