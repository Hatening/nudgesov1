"""fetch_hf_datasets.py — 拉取多语言跨境电商客服语料（MASSIVE / MTOP / MultiWOZ / CLINC150）。

用法：
  python scripts/fetch_hf_datasets.py --out raw_data --sets massive,mtop,multiwoz,clinc

环境：
  HF_ENDPOINT  默认 https://hf-mirror.com（国内可直连）
  HF_HOME      缓存目录，默认 <out>/.hf-cache

输出：
  raw_data/massive/<lang>/        save_to_disk
  raw_data/mtop/<locale>/
  raw_data/multiwoz/
  raw_data/clinc150/
  raw_data/dataset_summary.json   {dataset: {path, languages, rows, splits, errors}}
"""

import os
import sys
import json
import argparse
import traceback

for k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
    os.environ.pop(k, None)
os.environ["NO_PROXY"] = "*"
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

parser = argparse.ArgumentParser()
parser.add_argument("--out", default="raw_data")
parser.add_argument("--sets", default="massive,mtop,multiwoz,clinc")
args = parser.parse_args()

OUT = os.path.abspath(args.out)
os.makedirs(OUT, exist_ok=True)
os.environ.setdefault("HF_HOME", os.path.join(OUT, ".hf-cache"))

from datasets import load_dataset, get_dataset_config_names  # noqa: E402

summary = {}


def record(name, path, ds, languages=None, errors=None):
    rows = {}
    splits = []
    try:
        splits = list(ds.keys())
        for split in splits:
            rows[split] = len(ds[split])
    except Exception:
        pass
    summary[name] = {
        "path": os.path.relpath(path, OUT).replace("\\", "/"),
        "languages": languages or [],
        "language_count": len(languages or []),
        "splits": splits,
        "rows": rows,
        "rows_total": sum(rows.values()),
        "errors": errors or [],
    }
    print(f"[{name}] {len(languages or [])} langs, {sum(rows.values())} rows, errors={len(errors or [])}", flush=True)


def fetch_massive():
    # AmazonScience/massive 是脚本型数据集，datasets 5.x 不再支持；
    # 使用 MTEB 的 parquet 镜像（52 个 config：default + 51 语言）
    name = "mteb/amazon_massive_intent"
    out = os.path.join(OUT, "massive")
    os.makedirs(out, exist_ok=True)
    errors = []
    try:
        configs = get_dataset_config_names(name)
    except Exception as e:
        summary["massive"] = {"path": "massive", "languages": [], "rows_total": 0, "errors": [f"config list failed: {e}"]}
        print(f"[massive] config list failed: {e}", flush=True)
        return

    done = []
    for cfg in configs:
        target = os.path.join(out, cfg)
        if os.path.isdir(target):
            done.append(cfg)          # 断点：已存在则跳过
            continue
        try:
            ds = load_dataset(name, cfg)
            ds.save_to_disk(target)
            done.append(cfg)
            print(f"  massive/{cfg} ok", flush=True)
        except Exception as e:
            errors.append(f"{cfg}: {e}")
            print(f"  massive/{cfg} FAIL: {e}", flush=True)

    # 重新统计已保存的
    rows = 0
    for cfg in done:
        try:
            from datasets import load_from_disk
            ds = load_from_disk(os.path.join(out, cfg))
            rows += sum(len(ds[s]) for s in ds.keys())
        except Exception:
            pass
    summary["massive"] = {
        "path": "massive", "languages": sorted(done), "language_count": len(done),
        "rows_total": rows, "errors": errors,
    }
    print(f"[massive] {len(done)}/{len(configs)} langs, {rows} rows, errors={len(errors)}", flush=True)


def fetch_configs(name, key, subdir):
    out = os.path.join(OUT, subdir)
    os.makedirs(out, exist_ok=True)
    errors = []
    done = []
    try:
        configs = get_dataset_config_names(name)
    except Exception:
        configs = [None]
    for cfg in configs:
        label = cfg or "default"
        target = os.path.join(out, label)
        if os.path.isdir(target):
            done.append(label)
            continue
        try:
            ds = load_dataset(name, cfg) if cfg else load_dataset(name)
            ds.save_to_disk(target)
            done.append(label)
            print(f"  {subdir}/{label} ok", flush=True)
        except Exception as e:
            errors.append(f"{label}: {e}")
            print(f"  {subdir}/{label} FAIL: {e}", flush=True)

    rows = 0
    for label in done:
        try:
            from datasets import load_from_disk
            ds = load_from_disk(os.path.join(out, label))
            rows += sum(len(ds[s]) for s in ds.keys())
        except Exception:
            pass
    summary[key] = {
        "path": subdir, "languages": done, "language_count": len(done),
        "rows_total": rows, "errors": errors,
    }
    print(f"[{key}] {len(done)} configs, {rows} rows, errors={len(errors)}", flush=True)


def fetch_single(repo, key, subdir, config=None):
    out = os.path.join(OUT, subdir)
    if os.path.isdir(out) and os.listdir(out):
        try:
            from datasets import load_from_disk
            ds = load_from_disk(out)
            record(key, out, ds, languages=["en"])
            return
        except Exception:
            pass
    try:
        ds = load_dataset(repo, config) if config else load_dataset(repo)
        ds.save_to_disk(out)
        record(key, out, ds, languages=["en"])
    except Exception as e:
        summary[key] = {"path": subdir, "languages": [], "rows_total": 0, "errors": [str(e)]}
        print(f"[{key}] FAIL: {e}", flush=True)


wanted = {s.strip() for s in args.sets.split(",") if s.strip()}

if "massive" in wanted:
    print("== MASSIVE (51 languages) ==", flush=True)
    fetch_massive()

if "mtop" in wanted:
    # 官方 fb/mtop 已 401（gated）；使用社区镜像，按优先级回退
    print("== MTOP ==", flush=True)
    for repo in ("WillHeld/mtop", "iohadrubin/mtop", "mteb/mtop_intent"):
        try:
            fetch_configs(repo, "mtop", "mtop")
            summary["mtop"]["repo"] = repo
            break
        except Exception as e:
            print(f"[mtop] {repo} failed: {e}", flush=True)

if "multiwoz" in wanted:
    print("== MultiWOZ 2.2 ==", flush=True)
    fetch_single("pietrolesci/multiwoz_all_versions", "multiwoz", "multiwoz")

if "clinc" in wanted:
    print("== CLINC150 ==", flush=True)
    fetch_single("clinc/clinc_oos", "clinc150", "clinc150", config="plus")

path = os.path.join(OUT, "dataset_summary.json")
with open(path, "w", encoding="utf-8") as f:
    json.dump(summary, f, ensure_ascii=False, indent=2)

print("\n== summary ==", flush=True)
for k, v in summary.items():
    print(f"  {k}: {v.get('language_count', len(v.get('languages', [])))} langs, {v.get('rows_total', 0)} rows, {len(v.get('errors', []))} errors", flush=True)
print(f"written: {path}", flush=True)
