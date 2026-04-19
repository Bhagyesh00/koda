import type { Tool } from './registry.js';
import { BrowserArgs } from '@koda/shared';
import { chromium } from 'playwright';
import { logger } from '../logger.js';

export const browserTool: Tool<BrowserArgs> = {
  name: 'browser',
  description:
    'Control a real Chromium browser — navigate JS-rendered pages, extract text/HTML, take screenshots, click elements, fill forms, or run JavaScript.',
  requiresApproval: true,
  schema: BrowserArgs,

  async run(args, ctx) {
    const { url, action, selector, value, script, waitFor, maxLength = 8_000 } = args;

    logger.debug({ url, action }, 'browser');

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
        ...(ctx.signal ? {} : {}),
      });

      if (waitFor) {
        await page.waitForSelector(waitFor, { timeout: 10_000 });
      }

      if (action === 'get_text') {
        let text = await page.innerText('body');
        if (text.length > maxLength) {
          text = text.slice(0, maxLength) + `\n... [truncated at ${maxLength} chars]`;
        }
        return text;
      }

      if (action === 'get_html') {
        let html = await page.content();
        if (html.length > maxLength) {
          html = html.slice(0, maxLength) + `\n... [truncated at ${maxLength} chars]`;
        }
        return html;
      }

      if (action === 'screenshot') {
        const buf = await page.screenshot({ type: 'png', fullPage: false });
        return `data:image/png;base64,${buf.toString('base64')}`;
      }

      if (action === 'click') {
        if (!selector) return 'Error: selector is required for click action';
        await page.click(selector);
        return `Clicked "${selector}" on ${url}`;
      }

      if (action === 'fill') {
        if (!selector) return 'Error: selector is required for fill action';
        if (value === undefined) return 'Error: value is required for fill action';
        await page.fill(selector, value);
        return `Filled "${selector}" on ${url}`;
      }

      if (action === 'evaluate') {
        if (!script) return 'Error: script is required for evaluate action';
        const result = await page.evaluate(script);
        return JSON.stringify(result, null, 2);
      }

      return `Unknown action: ${action}`;
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      await browser.close();
    }
  },
};
