import type { Tool } from './registry.js';
import { SeleniumTestArgs } from '@koda/shared';
import path from 'node:path';
import { config } from '../config.js';
import { runScenario } from './selenium/runner.js';
import { resolveVideoOptions } from './selenium/recorder.js';

export const seleniumTestTool: Tool<SeleniumTestArgs> = {
  name: 'selenium_test',
  description: 'Run a prompt-based browser test via Selenium and produce an HTML report.',
  requiresApproval: true,
  schema: SeleniumTestArgs,

  async run(args) {
    const outDir = args.reportDir
      ? path.resolve(config.WORK_DIR_ABS, args.reportDir)
      : path.resolve(config.WORK_DIR_ABS, '.koda', 'selenium-reports', `run-${Date.now()}`);

    const result = await runScenario({
      url: args.url,
      prompt: args.prompt,
      browser: args.browser,
      headless: args.headless,
      slowMoMs: args.slowMoMs,
      timeoutMs: args.timeoutMs,
      outDir,
      basicAuth: args.basicAuth,
      cookies: args.cookies,
      viewport: args.viewport,
      video: resolveVideoOptions(args.recordVideo),
    });

    const passed = result.steps.filter((r) => r.status === 'passed').length;
    const healed = result.steps.filter((r) => r.healed).length;

    const videoLine = result.video
      ? result.video.format === 'mp4' && result.video.videoPath
        ? `Video: ${result.video.videoPath}`
        : result.video.playerHtmlPath
          ? `Video player: ${result.video.playerHtmlPath}`
          : ''
      : '';

    return [
      `**Selenium test ${result.status === 'passed' ? 'PASSED' : 'FAILED'}** — ${passed}/${result.steps.length} steps passed in ${result.durationMs}ms${healed ? ` (${healed} self-healed)` : ''}`,
      ``,
      `Browser: ${args.browser}`,
      `Report: ${result.reportPath}`,
      `Screenshots: ${result.screenshotsDir}`,
      videoLine,
      ``,
      `Steps:`,
      ...result.steps.map(
        (r, i) =>
          `  ${i + 1}. [${r.status}${r.healed ? ' healed' : ''}] ${r.step.action} — ${r.step.description ?? r.step.selector ?? r.step.value ?? ''}${r.error ? ` (${r.error})` : ''}`,
      ),
    ].join('\n');
  },
};
