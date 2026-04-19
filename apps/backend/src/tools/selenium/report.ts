import { promises as fs } from 'node:fs';
import path from 'node:path';

export type Step = Record<string, unknown> & { action: string; description?: string; selector?: string; value?: string };

export type StepResult = {
  step: Step;
  status: 'passed' | 'failed' | 'skipped';
  error?: string;
  screenshot?: string;
  durationMs: number;
  healed?: boolean;
};

export type VideoRef = {
  videoPath?: string;
  framesDir: string;
  frameCount: number;
  format: 'mp4' | 'frames-html';
  playerHtmlPath?: string;
  message: string;
};

export type ScenarioResult = {
  name: string;
  url: string;
  prompt: string;
  browser: string;
  startedAt: string;
  durationMs: number;
  status: 'passed' | 'failed';
  steps: StepResult[];
  reportPath: string;
  screenshotsDir: string;
  video?: VideoRef;
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&apos;',
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Single-scenario HTML report (used by selenium_test + embedded in suite)
// ──────────────────────────────────────────────────────────────────────────────

export function renderScenarioReport(args: {
  name?: string;
  prompt: string;
  url: string;
  browser: string;
  results: StepResult[];
  startedAt: string;
  totalMs: number;
  video?: VideoRef;
}): string {
  const { name, prompt, url, browser, results, startedAt, totalMs, video } = args;
  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const overall = failed === 0 ? 'PASSED' : 'FAILED';
  const color = failed === 0 ? '#16a34a' : '#dc2626';

  let videoBlock = '';
  if (video) {
    if (video.format === 'mp4' && video.videoPath) {
      const rel = path.basename(video.videoPath);
      videoBlock = `<div style="margin:1rem 0"><video src="${escapeHtml(rel)}" controls style="max-width:100%;border:1px solid #ccc;border-radius:4px"></video><div style="font-size:12px;color:#6b7280">${escapeHtml(video.message)}</div></div>`;
    } else if (video.playerHtmlPath) {
      const rel = path.basename(path.dirname(video.playerHtmlPath)) + '/' + path.basename(video.playerHtmlPath);
      videoBlock = `<div style="margin:1rem 0"><a href="${escapeHtml(rel)}" target="_blank" style="display:inline-block;padding:8px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:4px">▶ Watch recording (${video.frameCount} frames)</a><div style="font-size:12px;color:#6b7280;margin-top:4px">${escapeHtml(video.message)}</div></div>`;
    }
  }

  const rows = results
    .map((r, i) => {
      const img = r.screenshot
        ? `<img src="${escapeHtml(r.screenshot)}" style="max-width:600px;border:1px solid #ccc;margin-top:6px"/>`
        : '';
      const err = r.error
        ? `<pre style="color:#dc2626;white-space:pre-wrap;background:#fef2f2;padding:8px;border-radius:4px">${escapeHtml(r.error)}</pre>`
        : '';
      const heal = r.healed
        ? ` <span style="background:#fef3c7;padding:2px 6px;border-radius:3px;font-size:11px">self-healed</span>`
        : '';
      const statusColor = r.status === 'passed' ? '#16a34a' : r.status === 'failed' ? '#dc2626' : '#6b7280';
      const desc = r.step.description ?? r.step.selector ?? r.step.value ?? '';
      return `
<tr>
  <td>${i + 1}</td>
  <td><code>${escapeHtml(String(r.step.action))}</code></td>
  <td>${escapeHtml(String(desc))}${heal}</td>
  <td style="color:${statusColor};font-weight:600">${r.status}</td>
  <td>${r.durationMs}ms</td>
</tr>
<tr><td colspan="5">${err}${img}</td></tr>`;
    })
    .join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>${escapeHtml(name ?? 'Selenium Test Report')}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#111}
h1{margin:0 0 .5rem}
.status{display:inline-block;padding:4px 12px;border-radius:4px;color:#fff;background:${color};font-weight:700}
table{border-collapse:collapse;width:100%;margin-top:1rem}
th,td{border:1px solid #e5e7eb;padding:8px;text-align:left;vertical-align:top;font-size:14px}
th{background:#f3f4f6}
code{background:#f3f4f6;padding:2px 6px;border-radius:3px}
.meta{color:#555;font-size:14px;margin-bottom:1rem}
.meta div{margin:2px 0}
</style></head>
<body>
<h1>${escapeHtml(name ?? 'Selenium Test Report')} <span class="status">${overall}</span></h1>
<div class="meta">
  <div><strong>URL:</strong> ${escapeHtml(url)}</div>
  <div><strong>Browser:</strong> ${escapeHtml(browser)}</div>
  <div><strong>Prompt:</strong> ${escapeHtml(prompt)}</div>
  <div><strong>Started:</strong> ${escapeHtml(startedAt)} · <strong>Duration:</strong> ${totalMs}ms</div>
  <div><strong>Passed:</strong> ${passed} / ${results.length} · <strong>Failed:</strong> ${failed}</div>
</div>
${videoBlock}
<table>
<thead><tr><th>#</th><th>Action</th><th>Description</th><th>Status</th><th>Time</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</body></html>`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Multi-scenario suite HTML report
// ──────────────────────────────────────────────────────────────────────────────

export function renderSuiteReport(args: {
  scenarios: ScenarioResult[];
  startedAt: string;
  totalMs: number;
  browser: string;
  concurrency: number;
}): string {
  const { scenarios, startedAt, totalMs, browser, concurrency } = args;
  const passed = scenarios.filter((s) => s.status === 'passed').length;
  const failed = scenarios.length - passed;
  const overall = failed === 0 ? 'PASSED' : 'FAILED';
  const color = failed === 0 ? '#16a34a' : '#dc2626';

  const rows = scenarios
    .map((s) => {
      const statusColor = s.status === 'passed' ? '#16a34a' : '#dc2626';
      const rel = path.basename(path.dirname(s.reportPath)) + '/' + path.basename(s.reportPath);
      return `
<tr>
  <td>${escapeHtml(s.name)}</td>
  <td style="color:${statusColor};font-weight:600">${s.status}</td>
  <td>${s.steps.filter((x) => x.status === 'passed').length} / ${s.steps.length}</td>
  <td>${s.durationMs}ms</td>
  <td><a href="${escapeHtml(rel)}" target="_blank">open</a></td>
</tr>`;
    })
    .join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>Selenium Suite Report</title>
<style>
body{font-family:system-ui,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#111}
h1{margin:0 0 .5rem}
.status{display:inline-block;padding:4px 12px;border-radius:4px;color:#fff;background:${color};font-weight:700}
table{border-collapse:collapse;width:100%;margin-top:1rem}
th,td{border:1px solid #e5e7eb;padding:8px;text-align:left;font-size:14px}
th{background:#f3f4f6}
a{color:#2563eb}
.meta div{margin:2px 0;color:#555;font-size:14px}
</style></head>
<body>
<h1>Selenium Suite Report <span class="status">${overall}</span></h1>
<div class="meta">
  <div><strong>Browser:</strong> ${escapeHtml(browser)} · <strong>Concurrency:</strong> ${concurrency}</div>
  <div><strong>Started:</strong> ${escapeHtml(startedAt)} · <strong>Duration:</strong> ${totalMs}ms</div>
  <div><strong>Scenarios:</strong> ${passed} passed / ${failed} failed / ${scenarios.length} total</div>
</div>
<table>
<thead><tr><th>Scenario</th><th>Status</th><th>Steps</th><th>Time</th><th>Report</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</body></html>`;
}

// ──────────────────────────────────────────────────────────────────────────────
// JUnit XML (Jenkins-compatible)
// ──────────────────────────────────────────────────────────────────────────────

export function renderJUnitXml(args: {
  suiteName: string;
  scenarios: ScenarioResult[];
  totalMs: number;
}): string {
  const { suiteName, scenarios, totalMs } = args;
  const failures = scenarios.filter((s) => s.status === 'failed').length;
  const totalSec = (totalMs / 1000).toFixed(3);

  const testcases = scenarios
    .map((s) => {
      const durSec = (s.durationMs / 1000).toFixed(3);
      const failedStep = s.steps.find((st) => st.status === 'failed');
      const inner =
        s.status === 'failed' && failedStep
          ? `
    <failure message="${escapeXml(failedStep.error ?? 'step failed')}" type="AssertionError">
step ${s.steps.indexOf(failedStep) + 1} (${escapeXml(String(failedStep.step.action))}): ${escapeXml(failedStep.error ?? '')}
    </failure>`
          : '';
      return `  <testcase classname="${escapeXml(suiteName)}" name="${escapeXml(s.name)}" time="${durSec}">${inner}
  </testcase>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="${escapeXml(suiteName)}" tests="${scenarios.length}" failures="${failures}" time="${totalSec}">
<testsuite name="${escapeXml(suiteName)}" tests="${scenarios.length}" failures="${failures}" time="${totalSec}">
${testcases}
</testsuite>
</testsuites>`;
}

// ──────────────────────────────────────────────────────────────────────────────
// JSON report
// ──────────────────────────────────────────────────────────────────────────────

export function renderJson(args: {
  suiteName: string;
  browser: string;
  concurrency: number;
  scenarios: ScenarioResult[];
  startedAt: string;
  totalMs: number;
}): string {
  const summary = {
    suite: args.suiteName,
    browser: args.browser,
    concurrency: args.concurrency,
    startedAt: args.startedAt,
    durationMs: args.totalMs,
    passed: args.scenarios.filter((s) => s.status === 'passed').length,
    failed: args.scenarios.filter((s) => s.status === 'failed').length,
    total: args.scenarios.length,
    scenarios: args.scenarios.map((s) => ({
      name: s.name,
      url: s.url,
      browser: s.browser,
      status: s.status,
      durationMs: s.durationMs,
      reportPath: s.reportPath,
      steps: s.steps.map((st) => ({
        action: st.step.action,
        description: st.step.description,
        selector: st.step.selector,
        value: st.step.value,
        status: st.status,
        error: st.error,
        healed: !!st.healed,
        durationMs: st.durationMs,
        screenshot: st.screenshot,
      })),
    })),
  };
  return JSON.stringify(summary, null, 2);
}

// ──────────────────────────────────────────────────────────────────────────────
// Write helpers
// ──────────────────────────────────────────────────────────────────────────────

export async function writeScenarioReport(
  outDir: string,
  args: Parameters<typeof renderScenarioReport>[0],
): Promise<string> {
  const html = renderScenarioReport(args);
  const p = path.join(outDir, 'report.html');
  await fs.writeFile(p, html, 'utf8');
  return p;
}
