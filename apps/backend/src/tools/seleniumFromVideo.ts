import type { Tool } from './registry.js';
import { SeleniumFromVideoArgs } from '@koda/shared';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { extractFrames, listFrames } from './selenium/frameExtractor.js';
import { extractUrlFromFrame } from './selenium/videoOcr.js';
import { generateScenarioFromFrames } from './selenium/videoToScenario.js';
import { runScenario } from './selenium/runner.js';
import { resolveVideoOptions } from './selenium/recorder.js';

export const seleniumFromVideoTool: Tool<SeleniumFromVideoArgs> = {
  name: 'selenium_from_video',
  description: 'Generate and execute a Selenium test from a video of a user interaction.',
  requiresApproval: true,
  schema: SeleniumFromVideoArgs,

  async run(args) {
    const outDir = args.reportDir
      ? path.resolve(config.WORK_DIR_ABS, args.reportDir)
      : path.resolve(config.WORK_DIR_ABS, '.koda', 'selenium-reports', `video-${Date.now()}`);
    await fs.mkdir(outDir, { recursive: true });

    // 1. Resolve source → frames
    let frames: string[];
    const framesOutDir = path.join(outDir, '_keyframes');
    try {
      if (args.videoPath) {
        const videoAbs = path.resolve(config.WORK_DIR_ABS, args.videoPath);
        await fs.access(videoAbs);
        logger.info({ video: videoAbs, samples: args.frameSamples }, 'extracting keyframes');
        frames = await extractFrames(videoAbs, framesOutDir, args.frameSamples);
      } else if (args.framesDir) {
        const dirAbs = path.resolve(config.WORK_DIR_ABS, args.framesDir);
        frames = await listFrames(dirAbs);
        if (frames.length === 0) {
          return `Error: no PNG/JPG frames found in ${dirAbs}`;
        }
      } else {
        return 'Error: either videoPath or framesDir is required';
      }
    } catch (err) {
      return `Error extracting frames: ${err instanceof Error ? err.message : String(err)}`;
    }

    // 2. Resolve URL
    let url: string | null = args.url ?? null;
    let urlSource = url ? 'user-provided' : '';
    if (!url) {
      logger.info('attempting to extract URL via OCR on first frame');
      url = await extractUrlFromFrame(frames[0]!);
      urlSource = url ? 'ocr' : '';
    }
    if (!url) {
      return (
        `Error: could not determine starting URL.\n` +
        `OCR did not find a URL in the first frame and none was provided.\n` +
        `Pass 'url' explicitly to skip OCR.`
      );
    }

    // 3. Generate scenario via vision LLM
    const visionModel = args.visionModel ?? config.OLLAMA_MODEL;
    let scenario: string;
    try {
      const result = await generateScenarioFromFrames(frames, visionModel, url);
      scenario = result.scenario;
    } catch (err) {
      return `Error generating scenario: ${err instanceof Error ? err.message : String(err)}`;
    }

    // Save the generated scenario + metadata so report can reference it
    const meta = {
      videoPath: args.videoPath,
      framesDir: args.framesDir,
      frames: frames.map((f) => path.basename(f)),
      keyframesDir: framesOutDir,
      url,
      urlSource,
      visionModel,
      generatedAt: new Date().toISOString(),
      scenario,
    };
    await fs.writeFile(path.join(outDir, 'generated-scenario.json'), JSON.stringify(meta, null, 2));
    await fs.writeFile(path.join(outDir, 'generated-scenario.txt'), scenario);

    // 4. Dry run → return scenario without executing
    if (args.dryRun) {
      return [
        `**Scenario generated (dry run — not executed)**`,
        ``,
        `URL: ${url} (${urlSource})`,
        `Vision model: ${visionModel}`,
        `Frames analyzed: ${frames.length}`,
        `Saved to: ${path.join(outDir, 'generated-scenario.txt')}`,
        ``,
        `--- Generated scenario ---`,
        scenario,
      ].join('\n');
    }

    // 5. Execute via runScenario
    logger.info({ url, visionModel, frameCount: frames.length }, 'running generated scenario');
    const result = await runScenario({
      url,
      prompt: scenario,
      browser: args.browser,
      headless: args.headless,
      slowMoMs: args.slowMoMs,
      timeoutMs: args.timeoutMs,
      outDir,
      video: resolveVideoOptions(args.recordVideo),
    });

    const passed = result.steps.filter((r) => r.status === 'passed').length;
    const healed = result.steps.filter((r) => r.healed).length;
    const videoLine = result.video
      ? result.video.format === 'mp4' && result.video.videoPath
        ? `Replay video: ${result.video.videoPath}`
        : result.video.playerHtmlPath
          ? `Replay player: ${result.video.playerHtmlPath}`
          : ''
      : '';

    return [
      `**Selenium-from-video ${result.status === 'passed' ? 'PASSED' : 'FAILED'}** — ${passed}/${result.steps.length} steps passed in ${result.durationMs}ms${healed ? ` (${healed} self-healed)` : ''}`,
      ``,
      `Source: ${args.videoPath ?? args.framesDir}`,
      `URL: ${url} (${urlSource})`,
      `Vision model: ${visionModel} · Analyzed ${frames.length} frames`,
      `Report: ${result.reportPath}`,
      videoLine,
      ``,
      `--- Generated scenario ---`,
      scenario,
      ``,
      `--- Execution steps ---`,
      ...result.steps.map(
        (r, i) =>
          `  ${i + 1}. [${r.status}${r.healed ? ' healed' : ''}] ${r.step.action} — ${r.step.description ?? r.step.selector ?? r.step.value ?? ''}${r.error ? ` (${r.error})` : ''}`,
      ),
    ]
      .filter(Boolean)
      .join('\n');
  },
};
