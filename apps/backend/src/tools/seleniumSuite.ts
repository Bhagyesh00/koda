import type { Tool } from './registry.js';
import { SeleniumSuiteArgs } from '@koda/shared';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { runScenario } from './selenium/runner.js';
import { resolveVideoOptions } from './selenium/recorder.js';
import {
  renderSuiteReport,
  renderJUnitXml,
  renderJson,
  ScenarioResult,
} from './selenium/report.js';

type ExpandedScenario = {
  name: string;
  url: string;
  prompt: string;
  tags?: string[];
};

function substituteTemplate(s: string, row: Record<string, string>): string {
  return s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => row[k] ?? `{{${k}}}`);
}

function expandScenarios(args: SeleniumSuiteArgs): ExpandedScenario[] {
  if (!args.dataSet || args.dataSet.length === 0) {
    return args.scenarios.map((s) => ({ ...s }));
  }
  const out: ExpandedScenario[] = [];
  for (const scenario of args.scenarios) {
    for (const row of args.dataSet) {
      out.push({
        name: `${scenario.name} [${Object.values(row).join(',')}]`,
        url: substituteTemplate(scenario.url, row),
        prompt: substituteTemplate(scenario.prompt, row),
        tags: scenario.tags,
      });
    }
  }
  return out;
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners: Promise<void>[] = [];
  const launch = async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]!, i);
    }
  };
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    runners.push(launch());
  }
  await Promise.all(runners);
  return results;
}

export const seleniumSuiteTool: Tool<SeleniumSuiteArgs> = {
  name: 'selenium_suite',
  description: 'Run multiple Selenium scenarios with optional setup/teardown, data-driven substitutions, parallel execution, and HTML/JSON/JUnit reports.',
  requiresApproval: true,
  schema: SeleniumSuiteArgs,

  async run(args) {
    const startedAt = new Date().toISOString();
    const started = Date.now();

    const suiteDir = args.reportDir
      ? path.resolve(config.WORK_DIR_ABS, args.reportDir)
      : path.resolve(config.WORK_DIR_ABS, '.koda', 'selenium-reports', `suite-${Date.now()}`);
    await fs.mkdir(suiteDir, { recursive: true });

    const expanded = expandScenarios(args);
    logger.info(
      { scenarios: expanded.length, concurrency: args.concurrency, browser: args.browser },
      'selenium_suite: starting',
    );

    const scenarios = await runWithConcurrency(expanded, args.concurrency, async (s, i) => {
      const scenarioDir = path.join(suiteDir, `s${i + 1}-${s.name.replace(/[^\w-]+/g, '_').slice(0, 40)}`);
      try {
        const result: ScenarioResult = await runScenario({
          name: s.name,
          url: s.url,
          prompt: s.prompt,
          browser: args.browser,
          headless: args.headless,
          slowMoMs: args.slowMoMs,
          timeoutMs: args.timeoutMs,
          outDir: scenarioDir,
          basicAuth: args.basicAuth,
          cookies: args.cookies,
          viewport: args.viewport,
          setupPrompt: args.setup,
          teardownPrompt: args.teardown,
          video: resolveVideoOptions(args.recordVideo),
        });
        return result;
      } catch (err) {
        logger.error({ err, scenario: s.name }, 'selenium_suite: scenario crashed');
        return {
          name: s.name,
          url: s.url,
          prompt: s.prompt,
          browser: args.browser,
          startedAt: new Date().toISOString(),
          durationMs: 0,
          status: 'failed' as const,
          steps: [],
          reportPath: '',
          screenshotsDir: scenarioDir,
        };
      }
    });

    const totalMs = Date.now() - started;

    const formats = new Set(args.reportFormats);
    const writes: Promise<void>[] = [];
    const suiteName = `selenium-suite-${path.basename(suiteDir)}`;
    let htmlPath = '';
    let jsonPath = '';
    let junitPath = '';

    if (formats.has('html')) {
      htmlPath = path.join(suiteDir, 'index.html');
      writes.push(
        fs.writeFile(
          htmlPath,
          renderSuiteReport({
            scenarios,
            startedAt,
            totalMs,
            browser: args.browser,
            concurrency: args.concurrency,
          }),
          'utf8',
        ),
      );
    }
    if (formats.has('json')) {
      jsonPath = path.join(suiteDir, 'results.json');
      writes.push(
        fs.writeFile(
          jsonPath,
          renderJson({
            suiteName,
            browser: args.browser,
            concurrency: args.concurrency,
            scenarios,
            startedAt,
            totalMs,
          }),
          'utf8',
        ),
      );
    }
    if (formats.has('junit')) {
      junitPath = path.join(suiteDir, 'junit.xml');
      writes.push(
        fs.writeFile(junitPath, renderJUnitXml({ suiteName, scenarios, totalMs }), 'utf8'),
      );
    }
    await Promise.all(writes);

    const passed = scenarios.filter((s) => s.status === 'passed').length;
    const failed = scenarios.length - passed;

    return [
      `**Selenium suite ${failed === 0 ? 'PASSED' : 'FAILED'}** — ${passed}/${scenarios.length} scenarios passed in ${totalMs}ms`,
      ``,
      `Browser: ${args.browser} · Concurrency: ${args.concurrency}`,
      htmlPath ? `HTML: ${htmlPath}` : '',
      jsonPath ? `JSON: ${jsonPath}` : '',
      junitPath ? `JUnit: ${junitPath}` : '',
      ``,
      `Scenarios:`,
      ...scenarios.map(
        (s) =>
          `  · [${s.status}] ${s.name} — ${s.steps.filter((x) => x.status === 'passed').length}/${s.steps.length} steps in ${s.durationMs}ms`,
      ),
    ]
      .filter(Boolean)
      .join('\n');
  },
};
