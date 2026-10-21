/**
 * 来源权限闸门（Phase 1）
 *
 * 任何采集、存全文、模型调用、向量化、训练、商业使用、再分发之前都必须调用本函数。
 * 默认拒绝：来源未登记、状态未知、权限位未显式打开，一律 denied。
 *
 * 设计依据：docs/specs/global-seller-ops-knowledge-pipeline-spec.md
 *   - rights_status: ALLOW / ALLOW_WITH_LIMITS / METADATA_ONLY / BLOCK / REVIEW_REQUIRED
 *   - 不得用单一 is_legal 布尔值代替细分权限
 */

export const SOURCE_POLICY_VERSION = '2026-10-21.1';

export const SOURCE_ACTIONS = Object.freeze({
  FETCH: 'fetch',
  STORE_FULLTEXT: 'store_fulltext',
  STORE_RAW_FILE: 'store_raw_file',
  TRANSFORM: 'transform',
  MODEL_INFERENCE: 'model_inference',
  EMBED: 'embed',
  TRAIN: 'train',
  DISPLAY_QUOTE: 'display_quote',
  COMMERCIAL_USE: 'commercial_use',
  REDISTRIBUTE: 'redistribute',
});

const ACTION_COLUMNS = Object.freeze({
  fetch: 'fetch_allowed',
  store_fulltext: 'store_fulltext_allowed',
  store_raw_file: 'store_raw_file_allowed',
  transform: 'transform_allowed',
  model_inference: 'model_inference_allowed',
  embed: 'embed_allowed',
  train: 'model_training_allowed',
  display_quote: 'display_quote_allowed',
  commercial_use: 'commercial_use_allowed',
  redistribute: 'redistribution_allowed',
});

export class SourcePermissionError extends Error {
  constructor(decision) {
    super(`source permission denied: ${decision.source_id} -> ${decision.action} (${decision.reason})`);
    this.name = 'SourcePermissionError';
    this.status = 403;
    this.decision = decision;
  }
}

function deny(sourceId, action, reason, row, evaluatedAt, extra = {}) {
  return {
    allowed: false,
    source_id: sourceId ?? null,
    action: action ?? null,
    reason,
    rights_status: row?.rights_status ?? null,
    policy_version: SOURCE_POLICY_VERSION,
    evaluated_at: evaluatedAt,
    ...extra,
  };
}

/**
 * 评估某个来源是否允许执行某个动作。
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} sourceId
 * @param {string} action 见 SOURCE_ACTIONS
 * @param {{ now?: string }} [options]
 * @returns {{allowed:boolean, source_id:string|null, action:string|null, reason:string,
 *            rights_status:string|null, policy_version:string, evaluated_at:string,
 *            attribution_required?:boolean, share_alike_required?:boolean}}
 */
export function evaluateSourcePermissions(db, sourceId, action, options = {}) {
  const evaluatedAt = options.now || new Date().toISOString();

  if (!sourceId || typeof sourceId !== 'string') return deny(sourceId, action, 'missing_source_id', null, evaluatedAt);
  if (!action || !Object.prototype.hasOwnProperty.call(ACTION_COLUMNS, action)) {
    return deny(sourceId, action, 'unknown_action', null, evaluatedAt);
  }

  const row = db.prepare('SELECT * FROM source_registry WHERE id = ?').get(sourceId);
  if (!row) return deny(sourceId, action, 'source_not_registered', null, evaluatedAt);

  // 状态机：这些状态一律拒绝自动处理
  if (row.rights_status === 'BLOCK') return deny(sourceId, action, 'rights_status_block', row, evaluatedAt);
  if (row.rights_status === 'REVIEW_REQUIRED') return deny(sourceId, action, 'rights_status_review_required', row, evaluatedAt);
  if (row.rights_status === 'METADATA_ONLY') return deny(sourceId, action, 'rights_status_metadata_only', row, evaluatedAt);

  // 复核过期即视为未复核
  if (row.review_due_at && row.review_due_at < evaluatedAt) {
    return deny(sourceId, action, 'review_expired', row, evaluatedAt);
  }

  // 细分权限位：未显式打开就是拒绝
  const column = ACTION_COLUMNS[action];
  if (Number(row[column] || 0) !== 1) return deny(sourceId, action, `permission_bit_off:${column}`, row, evaluatedAt);

  // 非商业限制来源不得用于商业用途 / 再分发
  if (Number(row.noncommercial_restriction || 0) === 1 && (action === 'commercial_use' || action === 'redistribute')) {
    return deny(sourceId, action, 'noncommercial_restriction', row, evaluatedAt);
  }

  // 无衍生品限制：禁止 transform / train
  if (Number(row.no_derivatives_restriction || 0) === 1 && (action === 'transform' || action === 'train')) {
    return deny(sourceId, action, 'no_derivatives_restriction', row, evaluatedAt);
  }

  return {
    allowed: true,
    source_id: sourceId,
    action,
    reason: 'allowed',
    rights_status: row.rights_status,
    policy_version: SOURCE_POLICY_VERSION,
    evaluated_at: evaluatedAt,
    attribution_required: Number(row.attribution_required || 0) === 1,
    share_alike_required: Number(row.share_alike_required || 0) === 1,
  };
}

/** 断言版本：不允许时抛出 403 错误，供采集器/入库脚本统一调用。 */
export function assertSourcePermission(db, sourceId, action, options = {}) {
  const decision = evaluateSourcePermissions(db, sourceId, action, options);
  if (!decision.allowed) throw new SourcePermissionError(decision);
  return decision;
}
