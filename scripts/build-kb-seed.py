#!/usr/bin/env python
"""Build the approved knowledge seed with a strict evidence gate.

Rules enforced before a card can enter db/seed/knowledge.jsonl:
1. source must exist / resolve;
2. every URL in the card must appear in the source;
3. every number in the card must appear in the source;
4. every extracted proper-name/entity candidate must appear in the source
   (case-insensitive, whitespace-normalized);
5. malformed cards are written to rejected.jsonl, never to the seed.

This is deterministic normalization for WixQA QA rows and existing candidate
cards; it does not call a model. Model-generated cards already in raw_data are
still evidence-checked here.
"""
from __future__ import annotations

import ast
import hashlib
import json
import re
import sqlite3
import sys
import unicodedata
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw_data"
OUT = ROOT / "db" / "seed"
ART = ROOT / "artifacts" / "kb-ingest-001" / "final"
OUT.mkdir(parents=True, exist_ok=True)
ART.mkdir(parents=True, exist_ok=True)

ALLOWED_SOURCE_TYPES = {"wixqa", "ecommerce_ai_skills"}
BANNED_SOURCE_RE = re.compile(r"bitext|webfaq|traveling", re.I)

URL_RE = re.compile(r"https?://[^\s\)\]\"'<>]+", re.I)
NUMBER_RE = re.compile(r"(?<![\w])\d[\d,]*(?:\.\d+)?%?")
QUOTED_RE = re.compile(r"`([^`]{3,80})`|\"([^\"]{3,80})\"|“([^”]{3,80})”")
ENTITY_RE = re.compile(r"\b(?:[A-Z][A-Za-z0-9&+.-]*(?:\s+(?:of|the|and|for|to|in|on|with|&)\s+|[-\s])+[A-Z][A-Za-z0-9&+.-]*)\b")
STOP = {
    "The", "This", "That", "These", "Those", "You", "Your", "Yes", "No", "If", "When",
    "Where", "What", "How", "Why", "Can", "Could", "Should", "Will", "Would", "It",
    "In", "On", "For", "To", "With", "From", "And", "Or", "A", "An", "All", "Any",
}


def norm(value: str) -> str:
    value = unicodedata.normalize("NFKC", str(value or ""))
    value = value.replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'")
    value = value.replace("\u00a0", " ")
    return re.sub(r"\s+", " ", value).strip().lower()


def source_text(value: str) -> str:
    return norm(value)


def extract_candidates(text: str) -> dict:
    urls = {u.rstrip(".,;:") for u in URL_RE.findall(text)}
    numbers = set()
    for n in NUMBER_RE.findall(text):
        n = n.rstrip(".,;:")
        if n:
            numbers.add(n)
    entities = set()
    for m in ENTITY_RE.findall(text):
        if m.upper() == m:
            continue
        words = m.split()
        if words and words[0] in STOP:
            continue
        if len(m) >= 4:
            entities.add(m)
    for groups in QUOTED_RE.findall(text):
        for g in groups:
            if g.strip():
                entities.add(g.strip())
    return {"urls": urls, "numbers": numbers, "entities": entities}


def evidence_gate(text: str, source: str) -> tuple[bool, list[str], dict]:
    cand = extract_candidates(text)
    src = source_text(source)
    missing = []
    for url in cand["urls"]:
        if norm(url) not in src:
            missing.append(f"url:{url}")
    for number in cand["numbers"]:
        raw = norm(number)
        if raw not in src and raw.replace(",", "") not in src.replace(",", ""):
            missing.append(f"number:{number}")
    for entity in cand["entities"]:
        if norm(entity) not in src:
            missing.append(f"entity:{entity}")
    return not missing, missing, {"checked": {k: sorted(v) for k, v in cand.items()}, "missing": missing}


def code_id(prefix: str, key: str) -> str:
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
    return f"kb_{prefix}_{digest}"


def article_text(article_ids, corpus: dict) -> tuple[str, list[dict]]:
    if isinstance(article_ids, str):
        try:
            article_ids = ast.literal_eval(article_ids)
        except Exception:
            article_ids = [article_ids]
    if not isinstance(article_ids, (list, tuple)):
        article_ids = [article_ids]
    texts = []
    refs = []
    for article_id in article_ids:
        article = corpus.get(article_id)
        if not article:
            continue
        texts.append("\n".join(str(article.get(k) or "") for k in ("title", "url", "contents")))
        refs.append({"article_id": article_id, "title": article.get("title") or "", "url": article.get("url") or ""})
    return "\n\n".join(texts), refs


def make_card(*, card_id, title, question, answer, tags, category, language, source, source_type, source_id, source_url, evidence, validation):
    return {
        "id": card_id,
        "tenant_id": "global",
        "scope": "global",
        "title": title[:240],
        "type": "qa",
        "language": language or "en",
        "tags": tags[:12],
        "content": f"Q: {question}\nA: {answer}\n\nSource: {source_url or source}",
        "audience": "seller",
        "category": category or "其他",
        "sensitivity": "low",
        "freshness": "static",
        "source_type": source_type,
        "source_id": source_id,
        "source_url": source_url,
        "review_status": "approved",
        "evidence_json": json.dumps(evidence[:3], ensure_ascii=False),
        "validation_json": json.dumps(validation, ensure_ascii=False),
    }


def build_wixqa() -> tuple[list[dict], list[dict], Counter]:
    from datasets import load_from_disk

    corpus_ds = load_from_disk(str(RAW / "WixQA-full" / "wix_kb_corpus"))["train"]
    corpus = {row["id"]: row for row in corpus_ds}
    cards, rejected = [], []
    stats = Counter()
    for config in ("wixqa_expertwritten", "wixqa_simulated", "wixqa_synthetic"):
        ds = load_from_disk(str(RAW / "WixQA-full" / config))["train"]
        for idx, row in enumerate(ds):
            stats["input"] += 1
            source, refs = article_text(row.get("article_ids"), corpus)
            if not source:
                stats["rejected_no_source"] += 1
                rejected.append({"source": config, "idx": idx, "reason": "no matching article", "question": row.get("question")})
                continue
            text = str(row.get("answer") or "")
            ok, missing, check = evidence_gate(text, source)
            if not ok:
                stats["rejected_evidence"] += 1
                rejected.append({"source": config, "idx": idx, "reason": "; ".join(missing[:8]), "question": row.get("question")})
                continue
            ref = refs[0] if refs else {}
            card = make_card(
                card_id=code_id("wixqa", f"{config}:{idx}:{row.get('question','')}"),
                title=row.get("question") or f"{config} #{idx}",
                question=row.get("question") or "",
                answer=row.get("answer") or "",
                tags=[config, "wixqa"],
                category="平台规则",
                language="en",
                source=str(RAW.relative_to(ROOT) / "WixQA-full" / config),
                source_type="wixqa",
                source_id=ref.get("article_id") or config,
                source_url=ref.get("url") or "",
                evidence=[(source or "")[:1200]],
                validation={**check, "config": config, "row": idx},
            )
            cards.append(card)
            stats["accepted"] += 1
    return cards, rejected, stats


def build_existing_candidates(path: Path, source_type: str) -> tuple[list[dict], list[dict], Counter]:
    cards, rejected = [], []
    stats = Counter()
    if not path.exists():
        return cards, rejected, stats
    for idx, line in enumerate(path.read_text(encoding="utf-8").splitlines()):
        if not line.strip():
            continue
        stats["input"] += 1
        row = json.loads(line)
        src_rel = str(row.get("source") or "")
        src_path = ROOT / src_rel
        if not src_path.exists():
            stats["rejected_no_source"] += 1
            rejected.append({"source": src_rel, "idx": idx, "reason": "source file missing"})
            continue
        source = src_path.read_text(encoding="utf-8", errors="replace")
        text = str(row.get("answer") or "")
        ok, missing, check = evidence_gate(text, source)
        if not ok:
            stats["rejected_evidence"] += 1
            rejected.append({"source": src_rel, "idx": idx, "reason": "; ".join(missing[:8])})
            continue
        source_url = ""
        if source_type == "public_web":
            m = re.search(r"^source_url:\s*(.+)$", source[:2000], re.M)
            source_url = m.group(1).strip() if m else ""
        cards.append(make_card(
            card_id=code_id(source_type, f"{src_rel}:{idx}:{row.get('question','')}"),
            title=row.get("question") or f"{source_type} #{idx}",
            question=row.get("question") or "",
            answer=row.get("answer") or "",
            tags=row.get("tags") or [],
            category=row.get("category") or "其他",
            language=row.get("language") or "zh",
            source=src_rel,
            source_type=source_type,
            source_id=src_rel,
            source_url=source_url,
            evidence=[(source or "")[:1200]],
            validation={**check, "source_file": src_rel},
        ))
        stats["accepted"] += 1
    return cards, rejected, stats


def export_gpc() -> int:
    db_path = ROOT / ".data" / "relaydesk.sqlite"
    if not db_path.exists():
        return 0
    db = sqlite3.connect(db_path)
    rows = db.execute("SELECT * FROM gpc_taxonomy ORDER BY level_num, code").fetchall()
    cols = [r[1] for r in db.execute("PRAGMA table_info(gpc_taxonomy)")]
    db.close()
    if not rows:
        return 0
    with (OUT / "gpc_taxonomy.jsonl").open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(dict(zip(cols, row)), ensure_ascii=False) + "\n")
    return len(rows)


def main() -> int:
    wixqa, wixqa_rejected, wixqa_stats = build_wixqa()
    skills, skills_rejected, skills_stats = build_existing_candidates(RAW / "candidates.skills.jsonl", "ecommerce_ai_skills")

    all_cards = wixqa + skills
    # De-duplicate by id first, then by normalized question. WixQA's three
    # configs can repeat the same question; the first (expertwritten) wins.
    seen_ids = set()
    unique_by_id = []
    for card in all_cards:
        if card["id"] in seen_ids:
            continue
        seen_ids.add(card["id"])
        unique_by_id.append(card)

    seen_titles = set()
    unique = []
    for card in unique_by_id:
        key = norm(card["title"])
        if key in seen_titles:
            continue
        seen_titles.add(key)
        unique.append(card)

    for card in unique:
        if card["source_type"] not in ALLOWED_SOURCE_TYPES:
            raise SystemExit(f"unapproved source_type in seed: {card['source_type']} ({card['id']})")
        provenance = f"{card['source_type']} {card.get('source_id') or ''} {card.get('source_url') or ''}"
        if BANNED_SOURCE_RE.search(provenance):
            raise SystemExit(f"quarantined source leaked into seed: {provenance}")
    if len(unique) < 1000:
        raise SystemExit(f"refusing to write a suspiciously small knowledge seed: {len(unique)} cards")

    seed_path = OUT / "knowledge.jsonl"
    seed_path.write_text("".join(json.dumps(c, ensure_ascii=False) + "\n" for c in unique), encoding="utf-8")
    (OUT / "knowledge.rejected.jsonl").write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in (wixqa_rejected + skills_rejected)),
        encoding="utf-8",
    )
    gpc_count = export_gpc()
    stats = {
        "wixqa": {**wixqa_stats, "rejected": len(wixqa_rejected)},
        "skills": {**skills_stats, "rejected": len(skills_rejected)},
        "quarantined_sources": {
            "bitext": "excluded (CDLA-Sharing-1.0, legal review)",
            "webfaq_traveling": "excluded (unknown license)",
            "seller_extra": "excluded (public web, outside approved scope)",
        },
        "seed_cards": len(unique),
        "gpc_rows": gpc_count,
        "by_source_type": dict(Counter(c["source_type"] for c in unique)),
        "output": str(seed_path.relative_to(ROOT)).replace("\\", "/"),
    }
    (ART / "build-stats.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
