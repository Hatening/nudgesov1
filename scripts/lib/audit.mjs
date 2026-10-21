/** 每 100 张基础校验入库的卡，抽 5 张云端复查；2 张低于及格线即报警。 */
export class BasicAcceptanceAuditor {
  constructor({ batchSize = 100, sampleSize = 5, alertFailures = 2, passThreshold = 4.5 } = {}) {
    this.batchSize = batchSize;
    this.sampleSize = sampleSize;
    this.alertFailures = alertFailures;
    this.passThreshold = passThreshold;
    this.admitted = 0;
    this.audits = [];
    this.alerts = [];
  }

  recordAdmitted() {
    this.admitted += 1;
    if (this.admitted % this.batchSize === 0) {
      return { due: true, sampleSize: this.sampleSize, admitted: this.admitted };
    }
    return { due: false, admitted: this.admitted };
  }

  review(scores) {
    const failures = (scores || []).filter((score) => Number(score) < this.passThreshold).length;
    const result = {
      at: new Date().toISOString(),
      sampled: (scores || []).length,
      failures,
      threshold: this.passThreshold,
      alert: failures >= this.alertFailures,
      scores: (scores || []).map(Number),
    };
    this.audits.push(result);
    if (result.alert) this.alerts.push(result);
    return result;
  }

  snapshot() {
    return {
      admitted: this.admitted,
      batch_size: this.batchSize,
      sample_size: this.sampleSize,
      next_audit_at: Math.ceil((this.admitted + 1) / this.batchSize) * this.batchSize,
      audits: this.audits,
      alerts: this.alerts,
    };
  }
}
