import fs from 'node:fs';
import path from 'node:path';
import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';

interface Row {
  title: string;
  file: string;
  line: number;
  status: string;
  durationMs: number;
  screenshot: string | null;
  error: string;
}

export default class EvidenceReporter implements Reporter {
  private rows: Row[] = [];
  private startedAt = new Date().toISOString();

  onTestEnd(test: TestCase, result: TestResult) {
    const screenshot = result.attachments.find(
      (attachment) => attachment.name === 'final-screenshot' && attachment.path
    )?.path || null;
    this.rows.push({
      title: test.titlePath().join(' › '),
      file: path.relative(process.cwd(), test.location.file),
      line: test.location.line,
      status: result.status,
      durationMs: result.duration,
      screenshot,
      error: result.errors.map((error) => error.message).join('\n').slice(0, 4000)
    });
  }

  onEnd(result: FullResult) {
    const outDir = path.join(process.cwd(), 'artifacts', 'evidence');
    fs.mkdirSync(outDir, { recursive: true });
    const summary = {
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      status: result.status,
      tests: this.rows,
      totals: {
        total: this.rows.length,
        passed: this.rows.filter((row) => row.status === 'passed').length,
        failed: this.rows.filter((row) => row.status === 'failed').length,
        skipped: this.rows.filter((row) => row.status === 'skipped').length,
        withScreenshot: this.rows.filter((row) => row.screenshot).length
      }
    };
    fs.writeFileSync(path.join(outDir, 'playwright-results.json'), JSON.stringify(summary, null, 2));
  }
}
