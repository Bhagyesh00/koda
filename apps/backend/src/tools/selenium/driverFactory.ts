import { Builder, WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import firefox from 'selenium-webdriver/firefox.js';
import edge from 'selenium-webdriver/edge.js';
import path from 'node:path';
// @ts-expect-error — chromedriver has no types
import chromedriver from 'chromedriver';
import { logger } from '../../logger.js';

// geckodriver and edgedriver binaries are resolved at runtime by Selenium Manager
// (bundled with selenium-webdriver 4.x). We explicitly manage chromedriver because
// its npm package bundles the binary with a stable `.path` export.

export type BrowserName = 'chrome' | 'firefox' | 'edge';

export interface BuildDriverOptions {
  browser: BrowserName;
  headless: boolean;
  viewport?: { width: number; height: number };
}

export interface BasicAuth {
  username: string;
  password: string;
}

export interface CookieSpec {
  name: string;
  value: string;
  domain?: string;
  path?: string;
}

let pathBootstrapped = false;
function bootstrapDriverPaths(): void {
  if (pathBootstrapped) return;
  if (chromedriver.path) {
    process.env.PATH = `${path.dirname(chromedriver.path)}${path.delimiter}${process.env.PATH ?? ''}`;
  }
  pathBootstrapped = true;
}

export async function buildDriver(opts: BuildDriverOptions): Promise<WebDriver> {
  bootstrapDriverPaths();
  const vp = opts.viewport ?? { width: 1280, height: 800 };
  const builder = new Builder().forBrowser(opts.browser);

  switch (opts.browser) {
    case 'chrome': {
      const options = new chrome.Options();
      if (opts.headless) options.addArguments('--headless=new');
      options.addArguments(
        '--no-sandbox',
        '--disable-dev-shm-usage',
        `--window-size=${vp.width},${vp.height}`,
      );
      builder.setChromeOptions(options);
      break;
    }
    case 'firefox': {
      const options = new firefox.Options();
      if (opts.headless) options.addArguments('-headless');
      options.addArguments(`--width=${vp.width}`, `--height=${vp.height}`);
      options.setPreference('network.http.phishy-userpass-length', 255);
      builder.setFirefoxOptions(options);
      break;
    }
    case 'edge': {
      const options = new edge.Options();
      if (opts.headless) options.addArguments('--headless=new');
      options.addArguments(
        '--no-sandbox',
        '--disable-dev-shm-usage',
        `--window-size=${vp.width},${vp.height}`,
      );
      builder.setEdgeOptions(options);
      break;
    }
  }

  const driver = await builder.build();
  await driver.manage().window().setRect({ width: vp.width, height: vp.height, x: 0, y: 0 }).catch(() => {
    // Some environments (headless) don't support setRect — not fatal
  });
  return driver;
}

/**
 * Applies HTTP Basic Auth via CDP (Chrome/Edge) or URL userinfo (Firefox).
 * For Firefox we return a rewriter function for the caller to apply to URLs;
 * for Chromium browsers we inject the Authorization header globally.
 */
export async function applyBasicAuth(
  driver: WebDriver,
  browser: BrowserName,
  auth: BasicAuth,
): Promise<(url: string) => string> {
  const token = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');

  if (browser === 'chrome' || browser === 'edge') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = driver as any;
      if (typeof d.sendAndGetDevToolsCommand === 'function') {
        await d.sendAndGetDevToolsCommand('Network.enable', {});
        await d.sendAndGetDevToolsCommand('Network.setExtraHTTPHeaders', {
          headers: { Authorization: `Basic ${token}` },
        });
      } else if (typeof d.createCDPConnection === 'function') {
        const cdp = await d.createCDPConnection('page');
        await cdp.execute('Network.enable', {});
        await cdp.execute('Network.setExtraHTTPHeaders', {
          headers: { Authorization: `Basic ${token}` },
        });
      } else {
        logger.warn('CDP not available on this driver; basic auth may not work');
      }
    } catch (err) {
      logger.warn({ err }, 'failed to apply basic auth via CDP — falling back to URL userinfo');
    }
    return (url) => url; // header-based, no URL rewriting
  }

  // Firefox: rewrite URLs to embed user:pass
  return (url) => {
    try {
      const u = new URL(url);
      u.username = auth.username;
      u.password = auth.password;
      return u.toString();
    } catch {
      return url;
    }
  };
}

export async function applyCookies(driver: WebDriver, cookies: CookieSpec[]): Promise<void> {
  for (const c of cookies) {
    try {
      await driver.manage().addCookie({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path ?? '/',
      });
    } catch (err) {
      logger.warn({ cookie: c.name, err }, 'failed to set cookie');
    }
  }
}
