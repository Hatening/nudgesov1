#!/usr/bin/env node
/**
 * KB-QUALITY-001 / 阶段四：小批量试验质量评估
 *
 * 输入：reports/kb-quality-001/pilot-cards.jsonl + pilot-log.jsonl + pilot-failures.jsonl
 * 输出：evaluation.json / evaluation.md / manual-review.csv
 *
 * 用法：node scripts/kb-quality/evaluate.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = path.resolve(ROOT, 'reports/kb-quality-001');
const WIX_DIR = 'D:/Documents/AI_Projects/NudgeSo/language_prompt/GPT/02_WixQA/dataset_snapshot';

const readJsonl = (file) => {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
};
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const lower = (s) => norm(s).toLowerCase();

const corpus = new Map();
for (const line of fs.readFileSync(path.join(WIX_DIR, 'wix_kb_corpus/wix_kb_corpus.jsonl'), 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  corpus.set(row.id, row);
}

const cards = readJsonl(path.join(OUT_DIR, 'pilot-cards.jsonl'));
const logs = readJsonl(path.join(OUT_DIR, 'pilot-log.jsonl'));
const failures = readJsonl(path.join(OUT_DIR, 'pilot-failures.jsonl'));
const run = fs.existsSync(path.join(OUT_DIR, 'pilot-run.json'))
  ? JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'pilot-run.json'), 'utf8'))
  : null;

// ---------------------------------------------------------------- schema 校验（等价于 kb-card.schema.json 的结构约束）
const ENUMS = {
  knowledge_type: ['how_to', 'policy', 'troubleshooting', 'feature_explainer', 'intent_pattern', 'known_issue', 'faq'],
  audience: ['seller', 'buyer', 'platform_support', 'internal_eval'],
  license_status: ['approved_with_attribution', 'review_required', 'blocked'],
  review_status: ['approved', 'needs_review', 'rejected'],
};
const REQUIRED = [
  'card_id', 'version', 'knowledge_type', 'audience', 'industry', 'locale', 'intent_id',
  'aliases', 'required_slots', 'answer', 'steps', 'preconditions', 'exceptions',
  'evidence', 'source_id', 'source_url', 'source_span', 'source_hash', 'license_status', 'review_status',
];

function schemaErrors(card) {
  const errors = [];
  for (const key of REQUIRED) if (!(key in card)) errors.push(`missing:${key}`);
  if (card.version !== 1) errors.push('bad_version');
  if (!ENUMS.knowledge_type.includes(card.knowledge_type)) errors.push('bad_knowledge_type');
  if (!ENUMS.audience.includes(card.audience)) errors.push('bad_audience');
  if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(card.locale || '')) errors.push('bad_locale');
  if (!/^kb_[a-z0-9_]+$/.test(card.card_id || '')) errors.push('bad_card_id');
  if (!Array.isArray(card.aliases)) errors.push('bad_aliases');
  if (!Array.isArray(card.required_slots)) errors.push('bad_required_slots');
  if (!Array.isArray(card.steps)) errors.push('bad_steps');
  if (!Array.isArray(card.preconditions)) errors.push('bad_preconditions');
  if (!Array.isArray(card.exceptions)) errors.push('bad_exceptions');
  if (!Array.isArray(card.evidence) || card.evidence.length === 0) errors.push('bad_evidence');
  if (!card.source_span || typeof card.source_span.start !== 'number' || typeof card.source_span.end !== 'number') errors.push('bad_source_span');
  if (!/^[0-9a-f]{64}$/.test(card.source_hash || '')) errors.push('bad_source_hash');
  if (!ENUMS.license_status.includes(card.license_status)) errors.push('bad_license_status');
  if (!ENUMS.review_status.includes(card.review_status)) errors.push('bad_review_status');
  return errors;
}

// ---------------------------------------------------------------- 指标
const schemaPass = [];
const evidenceTraceable = [];
const numbersOk = [];
const unitChecks = [];
const needsReview = [];
const duplicateIds = new Map();
const answerHashes = new Map();
const intentCounts = {};
const typeCounts = {};
const audienceCounts = {};
const traceRows = [];

for (const card of cards) {
  const source = corpus.get(card.source_id);
  const errors = schemaErrors(card);
  schemaPass.push({ card_id: card.card_id, pass: errors.length === 0, errors });

  const haystack = lower(source?.contents || '');
  const evOk = Array.isArray(card.evidence) && card.evidence.length > 0 && card.evidence.every((e) => {
    const q = lower(e.quote);
    return q.length >= 8 && haystack.includes(q);
  });
  evidenceTraceable.push({ card_id: card.card_id, pass: evOk });

  const nums = String(card.answer).match(/\d+(?:[.,]\d+)?/g) || [];
  const numOk = nums.every((n) => String(source?.contents || '').includes(n));
  numbersOk.push({ card_id: card.card_id, pass: numOk, numbers: nums });

  const units = String(card.answer).match(/(?:%|\$|€|£|days?|hours?|minutes?|weeks?|months?)/gi) || [];
  const unitOk = units.every((u) => new RegExp(u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(String(source?.contents || '')));
  unitChecks.push({ card_id: card.card_id, pass: unitOk, units });

  if (card.review_status !== 'approved') needsReview.push(card);
  duplicateIds.set(card.card_id, (duplicateIds.get(card.card_id) || 0) + 1);
  const ah = crypto.createHash('sha1').update(lower(card.answer)).digest('hex');
  answerHashes.set(ah, (answerHashes.get(ah) || 0) + 1);
  intentCounts[card.intent_id] = (intentCounts[card.intent_id] || 0) + 1;
  typeCounts[card.knowledge_type] = (typeCounts[card.knowledge_type] || 0) + 1;
  audienceCounts[card.audience] = (audienceCounts[card.audience] || 0) + 1;

  traceRows.push({
    card_id: card.card_id,
    source_id: card.source_id,
    source_url: card.source_url,
    evidence_ok: evOk,
    numbers_ok: numOk,
    units_ok: unitOk,
    review_status: card.review_status,
    knowledge_type: card.knowledge_type,
    intent_id: card.intent_id,
  });
}

const pct = (ok, total) => (total === 0 ? 0 : Math.round((ok / total) * 10000) / 100);
const count = (arr) => arr.filter((x) => x.pass).length;

const articleTotal = logs.length || run?.articles_sampled || 0;
const articlesWithCards = logs.filter((l) => l.cards > 0).length;
const duplicateCardIds = [...duplicateIds.values()].filter((n) => n > 1).length;
const duplicateAnswers = [...answerHashes.values()].filter((n) => n > 1).length;

const evaluation = {
  generated_at: new Date().toISOString(),
  task: 'KB-QUALITY-001',
  inputs: {
    articles_sampled: articleTotal,
    articles_with_cards: articlesWithCards,
    failed_articles: failures.length,
    cards: cards.length,
  },
  metrics: {
    schema_pass_rate_pct: pct(count(schemaPass), cards.length),
    evidence_traceability_pct: pct(count(evidenceTraceable), cards.length),
    numbers_preserved_pct: pct(count(numbersOk), cards.length),
    units_preserved_pct: pct(count(unitChecks), cards.length),
    duplicate_card_id_rate_pct: pct(duplicateCardIds, cards.length),
    duplicate_answer_rate_pct: pct(duplicateAnswers, cards.length),
    needs_review_rate_pct: pct(needsReview.length, cards.length),
    unsupported_or_unverifiable_pct: pct(cards.length - count(evidenceTraceable) + (cards.length - count(numbersOk)), cards.length * 2),
  },
  distributions: {
    knowledge_type: typeCounts,
    audience: audienceCounts,
    intent_top: Object.entries(intentCounts).sort((a, b) => b[1] - a[1]).slice(0, 15),
  },
  providers: run?.providers || {},
  failures,
  schema_failures: schemaPass.filter((x) => !x.pass).slice(0, 20),
  evidence_failures: evidenceTraceable.filter((x) => !x.pass).slice(0, 20),
  number_failures: numbersOk.filter((x) => !x.pass).slice(0, 20),
  needs_review: needsReview.map((c) => ({ card_id: c.card_id, source_id: c.source_id, intent_id: c.intent_id, answer: c.answer.slice(0, 160) })),
  notes: [
    'WixQA expertwritten / simulated 未参与生成本批卡片，仅作为独立验证基准保留。',
    'audience 按 KB-QUALITY-001 分类规则固定为 platform_support（Wix 平台操作知识）。',
    '数字保留检查以“答案中的数字是否出现在原文”为准，单位做同样检查。',
    '证据可追溯率以逐字 quote 在原文中的包含关系为准（忽略大小写与空白差异）。',
  ],
};

fs.writeFileSync(path.join(OUT_DIR, 'evaluation.json'), JSON.stringify(evaluation, null, 2));

const md = [
  '# KB-QUALITY-001 · 小批量蒸馏质量评估',
  '',
  `生成时间：${evaluation.generated_at}`,
  '',
  '## 规模',
  '',
  `- 抽样文章：${articleTotal}`,
  `- 成功产出卡片的文章：${articlesWithCards}`,
  `- 失败文章：${failures.length}`,
  `- 卡片总数：${cards.length}`,
  `- 本地/云端分配：${JSON.stringify(evaluation.providers)}`,
  '',
  '## 指标',
  '',
  '| 指标 | 值 |',
  '|---|---|',
  `| Schema 校验通过率 | ${evaluation.metrics.schema_pass_rate_pct}% |`,
  `| 原文证据可追溯率 | ${evaluation.metrics.evidence_traceability_pct}% |`,
  `| 数字保留率 | ${evaluation.metrics.numbers_preserved_pct}% |`,
  `| 单位保留率 | ${evaluation.metrics.units_preserved_pct}% |`,
  `| 重复 card_id 率 | ${evaluation.metrics.duplicate_card_id_rate_pct}% |`,
  `| 重复答案率 | ${evaluation.metrics.duplicate_answer_rate_pct}% |`,
  `| needs_review 比例 | ${evaluation.metrics.needs_review_rate_pct}% |`,
  '',
  '## 分布',
  '',
  `- knowledge_type：${JSON.stringify(typeCounts)}`,
  `- audience：${JSON.stringify(audienceCounts)}`,
  '',
  '## 失败样例（前 10）',
  '',
  ...evaluation.schema_failures.slice(0, 10).map((f) => `- ${f.card_id}: ${f.errors.join(', ')}`),
  '',
].join('\n');
fs.writeFileSync(path.join(OUT_DIR, 'evaluation.md'), md);

const csv = ['card_id,source_id,evidence_ok,numbers_ok,units_ok,review_status,knowledge_type,intent_id',
  ...traceRows.map((r) => [r.card_id, r.source_id, r.evidence_ok, r.numbers_ok, r.units_ok, r.review_status, r.knowledge_type, r.intent_id].join(','))].join('\n');
fs.writeFileSync(path.join(OUT_DIR, 'manual-review.csv'), csv + '\n');

console.log(JSON.stringify(evaluation.metrics, null, 2));
console.log(`\n[report] ${path.join(OUT_DIR, 'evaluation.md')}`);
