import { By, until, WebDriver, WebElement } from 'selenium-webdriver';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';
import { logger } from '../../logger.js';
import { ollamaHeaders } from '../../agent/ollama.js';
import { resolveKey } from './keyMap.js';
import { applyBasicAuth, applyCookies, buildDriver, BrowserName, BasicAuth, CookieSpec } from './driverFactory.js';
import { writeScenarioReport, ScenarioResult, StepResult } from './report.js';
import { VideoOptions, VideoRecorder, VideoResult } from './recorder.js';

// ─────────────────────────────────────────────────────────────────────────────
// Action types
// ─────────────────────────────────────────────────────────────────────────────

export type StepAction =
  // interaction
  | 'click'
  | 'type'
  | 'press_key'
  | 'select_option'
  | 'check'
  | 'uncheck'
  | 'upload_file'
  | 'hover'
  | 'scroll'
  // navigation
  | 'navigate'
  | 'go_back'
  | 'go_forward'
  | 'refresh'
  // context
  | 'switch_frame'
  | 'exit_frame'
  | 'switch_tab'
  | 'new_tab'
  | 'close_tab'
  | 'accept_alert'
  | 'dismiss_alert'
  | 'type_in_alert'
  // utility
  | 'wait_for'
  | 'screenshot'
  | 'execute_js'
  | 'set_cookie'
  | 'delete_cookie'
  // assertions
  | 'assert_text'
  | 'assert_title'
  | 'assert_url'
  | 'assert_count'
  | 'assert_attribute'
  | 'assert_visible'
  | 'assert_hidden'
  | 'assert_regex'
  | 'assert_css'
  | 'assert_alert';

export type Step = {
  action: StepAction;
  selector?: string;
  by?: 'css' | 'xpath' | 'text' | 'shadow';
  value?: string;
  description?: string;
  caseInsensitive?: boolean;
  attribute?: string;
  property?: string; // CSS property
  script?: string; // for execute_js
  tabIndex?: number; // for switch_tab
  cookie?: CookieSpec; // for set_cookie
};

export type DomElement = {
  tag: string;
  selector: string;
  text?: string;
  name?: string;
  type?: string;
  placeholder?: string;
};

export type DomScan = {
  title: string;
  url: string;
  inputs: DomElement[];
  buttons: DomElement[];
  links: DomElement[];
  selects: { selector: string; name?: string; options: { value: string; text: string }[] }[];
  fileInputs: { selector: string; name?: string; accept?: string }[];
  frames: { selector: string; src?: string }[];
  shadowHosts: string[];
  forms: number;
  windowCount: number;
};

export interface RunScenarioOptions {
  name?: string;
  url: string;
  prompt: string;
  browser: BrowserName;
  headless: boolean;
  slowMoMs: number;
  timeoutMs: number;
  outDir: string;
  basicAuth?: BasicAuth;
  cookies?: CookieSpec[];
  viewport?: { width: number; height: number };
  /** If provided, reuses this driver instead of building a new one. Caller owns lifecycle. */
  driver?: WebDriver;
  /** Prompt run before the main prompt (e.g. "log in as admin"). */
  setupPrompt?: string;
  /** Prompt run after the main prompt. Runs even if main fails. */
  teardownPrompt?: string;
  /** Video recording options — true for defaults, false/undef to skip, or explicit config */
  video?: VideoOptions;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM scan — gives the planner real selectors instead of guessing
// ─────────────────────────────────────────────────────────────────────────────

export async function scanDom(driver: WebDriver): Promise<DomScan> {
  const windowCount = (await driver.getAllWindowHandles()).length;
  const dom = (await driver.executeScript(`
    function cssFor(el) {
      if (el.id) return '#' + CSS.escape(el.id);
      if (el.name) return el.tagName.toLowerCase() + '[name="' + CSS.escape(el.name).replace(/\\\\/g,'') + '"]';
      return el.tagName.toLowerCase();
    }
    const inputs = [...document.querySelectorAll('input:not([type="file"]),textarea')].slice(0,30).map(el => ({
      tag: el.tagName.toLowerCase(),
      selector: cssFor(el),
      name: el.name || undefined,
      type: el.type || undefined,
      placeholder: el.placeholder || undefined,
    }));
    const buttons = [...document.querySelectorAll('button,input[type="submit"],input[type="button"]')].slice(0,15).map(el => ({
      tag: el.tagName.toLowerCase(),
      selector: cssFor(el),
      text: (el.innerText || el.value || '').trim().slice(0, 60),
      type: el.type || undefined,
    }));
    const links = [...document.querySelectorAll('a[href]')].slice(0, 20).map(el => ({
      tag: 'a',
      selector: 'a[href="' + el.getAttribute('href') + '"]',
      text: (el.innerText || '').trim().slice(0, 60),
    }));
    const selects = [...document.querySelectorAll('select')].slice(0,10).map(el => ({
      selector: cssFor(el),
      name: el.name || undefined,
      options: [...el.options].slice(0, 20).map(o => ({ value: o.value, text: (o.text || '').trim().slice(0,40) })),
    }));
    const fileInputs = [...document.querySelectorAll('input[type="file"]')].slice(0,5).map(el => ({
      selector: cssFor(el),
      name: el.name || undefined,
      accept: el.accept || undefined,
    }));
    const frames = [...document.querySelectorAll('iframe,frame')].slice(0,5).map(el => ({
      selector: cssFor(el),
      src: el.getAttribute('src') || undefined,
    }));
    const shadowHosts = [...document.querySelectorAll('*')].filter(el => el.shadowRoot).slice(0,5).map(el => cssFor(el));
    return {
      title: document.title,
      url: location.href,
      inputs, buttons, links, selects, fileInputs, frames, shadowHosts,
      forms: document.querySelectorAll('form').length,
    };
  `)) as Omit<DomScan, 'windowCount'>;
  return { ...dom, windowCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// Planner + self-heal — LLM converts NL prompt to structured steps
// ─────────────────────────────────────────────────────────────────────────────

const ACTION_REFERENCE = `
Interaction:
  click        {selector, by?, description}
  type         {selector, value, description}
  press_key    {selector?, value: "Enter"|"Tab"|"Esc"|"ArrowDown"|...}
  select_option {selector, value: option text or value}
  check / uncheck {selector}
  upload_file  {selector, value: absolute file path}
  hover        {selector}
  scroll       {selector?, value?: "top"|"bottom"|pixel count}

Navigation:
  navigate     {value: url}
  go_back / go_forward / refresh {}

Context switching:
  switch_frame {selector}           — enter iframe
  exit_frame   {}                   — back to top-level document
  switch_tab   {tabIndex: 0-based} — switch to open tab by index
  new_tab      {value?: url}       — open a new tab (optionally navigate)
  close_tab    {}                  — close current tab
  accept_alert / dismiss_alert {} — handle JS dialog
  type_in_alert {value}            — prompt() dialog input
  assert_alert {value}             — alert text contains value

Utility:
  wait_for     {selector, by?}    — wait for element to exist
  screenshot   {description?}
  execute_js   {script, value?: expected return substring}
  set_cookie   {cookie: {name, value, domain?, path?}}
  delete_cookie {value: cookie name}

Assertions:
  assert_text      {selector?, value, caseInsensitive?}  — body if no selector
  assert_title     {value}
  assert_url       {value}
  assert_count     {selector, value: "3"|">3"|"<=5"}
  assert_attribute {selector, attribute, value}
  assert_visible / assert_hidden {selector}
  assert_regex     {selector?, value: regex body}
  assert_css       {selector, property, value}

Locators:
  by: "css" (default) | "xpath" | "text" (match visible button/link text) | "shadow" (host >> inner)
`.trim();

export async function planSteps(prompt: string, scan: DomScan): Promise<Step[]> {
  const scanSummary = JSON.stringify(
    {
      title: scan.title,
      url: scan.url,
      forms: scan.forms,
      inputs: scan.inputs,
      buttons: scan.buttons,
      links: scan.links.slice(0, 10),
      selects: scan.selects,
      fileInputs: scan.fileInputs,
      frames: scan.frames,
      shadowHosts: scan.shadowHosts,
      windowCount: scan.windowCount,
    },
    null,
    2,
  );

  const sys =
    `You are a Selenium test planner. The browser is already on the target page. ` +
    `Output ONLY a JSON array of steps — no prose, no code fences.\n\n` +
    `Available actions:\n${ACTION_REFERENCE}\n\n` +
    `Rules:\n` +
    `- Use EXACT selectors from the DOM summary. Never invent attribute names.\n` +
    `- For buttons/links without a stable selector, use {"by":"text", "selector":"Submit"} to match visible text.\n` +
    `- Assertions with "value" check substring match unless specified otherwise.\n` +
    `- Every step should include a short "description" field for readability.`;

  const user = `Scenario: ${prompt}\n\nLive DOM summary:\n${scanSummary}`;

  const res = await fetch(`${config.OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: ollamaHeaders(),
    body: JSON.stringify({
      model: config.OLLAMA_MODEL,
      stream: false,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      options: { temperature: 0 },
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) throw new Error(`Planner LLM returned HTTP ${res.status}`);
  const data = (await res.json()) as { message?: { content?: string } };
  const raw = (data.message?.content ?? '').trim();
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Planner did not return a JSON array');
  const steps = JSON.parse(match[0]) as Step[];
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('Empty step plan');
  return steps;
}

export async function healStep(failedStep: Step, error: string, scan: DomScan): Promise<Step | null> {
  const scanSummary = JSON.stringify(
    {
      inputs: scan.inputs.slice(0, 20),
      buttons: scan.buttons.slice(0, 10),
      selects: scan.selects.slice(0, 5),
      frames: scan.frames,
    },
    null,
    2,
  );
  const sys =
    `A Selenium step failed. Return a SINGLE corrected step as JSON object — no array, no prose, no code fences.\n\n` +
    `Available actions:\n${ACTION_REFERENCE}\n\n` +
    `Rules: use EXACT selectors from the DOM summary. If no fix is possible, return null.`;
  const user = `Failed step: ${JSON.stringify(failedStep)}\nError: ${error}\n\nCurrent DOM:\n${scanSummary}`;

  try {
    const res = await fetch(`${config.OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: ollamaHeaders(),
      body: JSON.stringify({
        model: config.OLLAMA_MODEL,
        stream: false,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ],
        options: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { message?: { content?: string } };
    const raw = (data.message?.content ?? '').trim();
    if (raw.toLowerCase().includes('null') && !raw.includes('{')) return null;
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    return JSON.parse(m[0]) as Step;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Locator resolution — CSS, XPath, text-match, shadow DOM
// ─────────────────────────────────────────────────────────────────────────────

async function resolveShadowLocator(driver: WebDriver, selector: string, timeoutMs: number): Promise<WebElement> {
  const parts = selector.split('>>').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) throw new Error('shadow selector must have at least host >> inner');

  const script = `
    const parts = ${JSON.stringify(parts)};
    let ctx = document;
    for (let i = 0; i < parts.length; i++) {
      const host = ctx.querySelector(parts[i]);
      if (!host) return null;
      if (i === parts.length - 1) return host;
      ctx = host.shadowRoot;
      if (!ctx) return null;
    }
    return null;
  `;

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const el = (await driver.executeScript(script)) as WebElement | null;
    if (el) return el;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`shadow element not found: ${selector}`);
}

export async function resolveLocator(driver: WebDriver, step: Step, timeoutMs: number): Promise<WebElement> {
  if (!step.selector) throw new Error(`step "${step.action}" requires a selector`);

  if (step.by === 'shadow') return resolveShadowLocator(driver, step.selector, timeoutMs);

  if (step.by === 'xpath') {
    return driver.wait(until.elementLocated(By.xpath(step.selector)), timeoutMs);
  }

  if (step.by === 'text') {
    const needle = step.selector.trim().toLowerCase().replace(/"/g, '');
    const xpath =
      `//*[self::button or self::a or self::input[@type="submit"] or self::input[@type="button"] or self::label or self::span]` +
      `[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${needle}")]`;
    return driver.wait(until.elementLocated(By.xpath(xpath)), timeoutMs);
  }

  // Default: CSS, fall back to text match if selector looks like plain words
  try {
    return await driver.wait(until.elementLocated(By.css(step.selector)), Math.min(timeoutMs, 8000));
  } catch (cssErr) {
    if (/^[\w\s-]+$/.test(step.selector)) {
      const needle = step.selector.trim().toLowerCase().replace(/"/g, '');
      const xpath =
        `//*[self::button or self::a or self::input[@type="submit"] or self::input[@type="button"] or self::label or self::span]` +
        `[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${needle}")]`;
      return driver.wait(until.elementLocated(By.xpath(xpath)), 3000);
    }
    throw cssErr;
  }
}

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function compareCount(actual: number, expected: string): boolean {
  const s = expected.trim();
  const m = s.match(/^(>=|<=|>|<|=|!=)?\s*(\d+)$/);
  if (!m) return false;
  const op = m[1] ?? '=';
  const n = parseInt(m[2]!, 10);
  switch (op) {
    case '>': return actual > n;
    case '<': return actual < n;
    case '>=': return actual >= n;
    case '<=': return actual <= n;
    case '=': return actual === n;
    case '!=': return actual !== n;
    default: return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step executor — one big switch per action
// ─────────────────────────────────────────────────────────────────────────────

export async function runStep(driver: WebDriver, step: Step, timeoutMs: number): Promise<Buffer | null> {
  switch (step.action) {
    // ─── interaction ────────────────────────────────────────────────────
    case 'click': {
      const el = await resolveLocator(driver, step, timeoutMs);
      await driver.executeScript('arguments[0].scrollIntoView({block:"center"})', el);
      await driver.wait(until.elementIsVisible(el), timeoutMs);
      await el.click();
      return null;
    }
    case 'type': {
      const el = await resolveLocator(driver, step, timeoutMs);
      await driver.executeScript('arguments[0].scrollIntoView({block:"center"})', el);
      await el.clear();
      await el.sendKeys(step.value ?? '');
      return null;
    }
    case 'press_key': {
      const key = resolveKey(step.value ?? '');
      if (step.selector) {
        const el = await resolveLocator(driver, step, timeoutMs);
        await el.sendKeys(key);
      } else {
        await driver.actions().sendKeys(key).perform();
      }
      return null;
    }
    case 'select_option': {
      const el = await resolveLocator(driver, step, timeoutMs);
      const value = step.value ?? '';
      // Try matching by value first, then by visible text
      const script = `
        const sel = arguments[0], want = arguments[1];
        for (const o of sel.options) {
          if (o.value === want || (o.text || '').trim() === want) {
            sel.value = o.value;
            sel.dispatchEvent(new Event('change', {bubbles:true}));
            return true;
          }
        }
        return false;
      `;
      const ok = (await driver.executeScript(script, el, value)) as boolean;
      if (!ok) throw new Error(`select option "${value}" not found`);
      return null;
    }
    case 'check':
    case 'uncheck': {
      const el = await resolveLocator(driver, step, timeoutMs);
      const isChecked = await el.isSelected();
      const want = step.action === 'check';
      if (isChecked !== want) {
        await driver.executeScript('arguments[0].scrollIntoView({block:"center"})', el);
        await el.click();
      }
      return null;
    }
    case 'upload_file': {
      const el = await resolveLocator(driver, step, timeoutMs);
      const filePath = path.resolve(config.WORK_DIR_ABS, step.value ?? '');
      await el.sendKeys(filePath);
      return null;
    }
    case 'hover': {
      const el = await resolveLocator(driver, step, timeoutMs);
      await driver.actions({ async: true }).move({ origin: el }).perform();
      return null;
    }
    case 'scroll': {
      if (step.selector) {
        const el = await resolveLocator(driver, step, timeoutMs);
        await driver.executeScript('arguments[0].scrollIntoView({block:"center"})', el);
      } else {
        const v = step.value ?? 'bottom';
        if (v === 'top') await driver.executeScript('window.scrollTo(0,0)');
        else if (v === 'bottom') await driver.executeScript('window.scrollTo(0, document.body.scrollHeight)');
        else await driver.executeScript(`window.scrollBy(0, ${parseInt(v, 10) || 0})`);
      }
      return null;
    }

    // ─── navigation ─────────────────────────────────────────────────────
    case 'navigate': {
      if (!step.value) throw new Error('navigate requires value (url)');
      await driver.get(step.value);
      return null;
    }
    case 'go_back': await driver.navigate().back(); return null;
    case 'go_forward': await driver.navigate().forward(); return null;
    case 'refresh': await driver.navigate().refresh(); return null;

    // ─── context ────────────────────────────────────────────────────────
    case 'switch_frame': {
      const el = await resolveLocator(driver, step, timeoutMs);
      await driver.switchTo().frame(el);
      return null;
    }
    case 'exit_frame': await driver.switchTo().defaultContent(); return null;
    case 'switch_tab': {
      const handles = await driver.getAllWindowHandles();
      const idx = step.tabIndex ?? 0;
      if (idx < 0 || idx >= handles.length) throw new Error(`tab index ${idx} out of range (${handles.length} tabs)`);
      await driver.switchTo().window(handles[idx]!);
      return null;
    }
    case 'new_tab': {
      await driver.switchTo().newWindow('tab');
      if (step.value) await driver.get(step.value);
      return null;
    }
    case 'close_tab': {
      await driver.close();
      const remaining = await driver.getAllWindowHandles();
      if (remaining.length > 0) await driver.switchTo().window(remaining[0]!);
      return null;
    }
    case 'accept_alert': await driver.switchTo().alert().accept(); return null;
    case 'dismiss_alert': await driver.switchTo().alert().dismiss(); return null;
    case 'type_in_alert': {
      const alert = await driver.switchTo().alert();
      await alert.sendKeys(step.value ?? '');
      await alert.accept();
      return null;
    }

    // ─── utility ────────────────────────────────────────────────────────
    case 'wait_for':
      await resolveLocator(driver, step, timeoutMs);
      return null;
    case 'screenshot':
      return Buffer.from(await driver.takeScreenshot(), 'base64');
    case 'execute_js': {
      const result = await driver.executeScript(step.script ?? 'return null');
      if (step.value != null) {
        const s = String(result ?? '');
        if (!s.includes(step.value)) throw new Error(`execute_js return "${s}" did not contain "${step.value}"`);
      }
      return null;
    }
    case 'set_cookie': {
      if (!step.cookie) throw new Error('set_cookie requires cookie field');
      await driver.manage().addCookie({
        name: step.cookie.name,
        value: step.cookie.value,
        domain: step.cookie.domain,
        path: step.cookie.path ?? '/',
      });
      return null;
    }
    case 'delete_cookie': {
      if (!step.value) throw new Error('delete_cookie requires value (cookie name)');
      await driver.manage().deleteCookie(step.value);
      return null;
    }

    // ─── assertions ─────────────────────────────────────────────────────
    case 'assert_text': {
      const needle = step.value ?? '';
      const hay = step.selector
        ? norm(await (await resolveLocator(driver, step, timeoutMs)).getText())
        : norm(await driver.findElement(By.css('body')).getText());
      const a = step.caseInsensitive ? hay.toLowerCase() : hay;
      const b = step.caseInsensitive ? needle.toLowerCase() : needle;
      if (!a.includes(b)) throw new Error(`expected text to contain "${needle}", got "${hay.slice(0, 200)}"`);
      return null;
    }
    case 'assert_title': {
      const t = await driver.getTitle();
      if (!t.includes(step.value ?? '')) throw new Error(`expected title to contain "${step.value}", got "${t}"`);
      return null;
    }
    case 'assert_url': {
      const u = await driver.getCurrentUrl();
      if (!u.includes(step.value ?? '')) throw new Error(`expected url to contain "${step.value}", got "${u}"`);
      return null;
    }
    case 'assert_count': {
      if (!step.selector) throw new Error('assert_count requires selector');
      const els = await driver.findElements(By.css(step.selector));
      if (!compareCount(els.length, step.value ?? '')) {
        throw new Error(`expected count ${step.value}, got ${els.length}`);
      }
      return null;
    }
    case 'assert_attribute': {
      const el = await resolveLocator(driver, step, timeoutMs);
      const attr = step.attribute ?? '';
      const v = (await el.getAttribute(attr)) ?? '';
      if (!v.includes(step.value ?? '')) {
        throw new Error(`expected attribute ${attr} to contain "${step.value}", got "${v}"`);
      }
      return null;
    }
    case 'assert_visible': {
      const el = await resolveLocator(driver, step, timeoutMs);
      if (!(await el.isDisplayed())) throw new Error(`element is not visible: ${step.selector}`);
      return null;
    }
    case 'assert_hidden': {
      try {
        const el = await driver.findElement(By.css(step.selector ?? ''));
        if (await el.isDisplayed()) throw new Error(`element is visible but expected hidden: ${step.selector}`);
      } catch (err) {
        if (err instanceof Error && err.message.includes('no such element')) return null;
        if (err instanceof Error && err.message.includes('expected hidden')) throw err;
      }
      return null;
    }
    case 'assert_regex': {
      const re = new RegExp(step.value ?? '');
      const hay = step.selector
        ? await (await resolveLocator(driver, step, timeoutMs)).getText()
        : await driver.findElement(By.css('body')).getText();
      if (!re.test(hay)) throw new Error(`regex /${step.value}/ did not match text "${hay.slice(0, 200)}"`);
      return null;
    }
    case 'assert_css': {
      const el = await resolveLocator(driver, step, timeoutMs);
      const v = await el.getCssValue(step.property ?? '');
      if (!v.includes(step.value ?? '')) {
        throw new Error(`expected css ${step.property} to contain "${step.value}", got "${v}"`);
      }
      return null;
    }
    case 'assert_alert': {
      const alert = await driver.switchTo().alert();
      const text = await alert.getText();
      if (!text.includes(step.value ?? '')) throw new Error(`alert text "${text}" did not contain "${step.value}"`);
      return null;
    }

    default:
      throw new Error(`unknown action: ${String((step as Step).action)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario runner — the main entry point used by both selenium_test and suite
// ─────────────────────────────────────────────────────────────────────────────

export async function runScenario(opts: RunScenarioOptions): Promise<ScenarioResult> {
  const started = Date.now();
  const startedAt = new Date().toISOString();
  await fs.mkdir(opts.outDir, { recursive: true });

  const ownsDriver = !opts.driver;
  let driver: WebDriver | null = opts.driver ?? null;
  const results: StepResult[] = [];
  let status: 'passed' | 'failed' = 'passed';
  let recorder: VideoRecorder | null = null;
  let videoResult: VideoResult | null = null;

  try {
    if (!driver) {
      driver = await buildDriver({
        browser: opts.browser,
        headless: opts.headless,
        viewport: opts.viewport,
      });
    }

    if (opts.video?.enabled) {
      recorder = new VideoRecorder(driver, opts.outDir, opts.video);
      await recorder.start();
      logger.info({ fps: opts.video.fps, format: opts.video.format }, 'video recording started');
    }

    // Basic auth → either URL rewrite (firefox) or CDP headers (chrome/edge)
    let rewriteUrl = (u: string) => u;
    if (opts.basicAuth) {
      rewriteUrl = await applyBasicAuth(driver, opts.browser, opts.basicAuth);
    }

    logger.info({ url: opts.url, browser: opts.browser, name: opts.name }, 'runScenario: navigating');
    await driver.get(rewriteUrl(opts.url));

    // Cookies after first nav so domain is known
    if (opts.cookies && opts.cookies.length > 0) {
      await applyCookies(driver, opts.cookies);
      await driver.get(rewriteUrl(opts.url)); // re-nav to apply
    }

    // Optional setup prompt runs before the main prompt
    const phases: { label: 'setup' | 'main' | 'teardown'; prompt: string }[] = [];
    if (opts.setupPrompt) phases.push({ label: 'setup', prompt: opts.setupPrompt });
    phases.push({ label: 'main', prompt: opts.prompt });
    if (opts.teardownPrompt) phases.push({ label: 'teardown', prompt: opts.teardownPrompt });

    let phaseFailed = false;

    for (const phase of phases) {
      if (phaseFailed && phase.label !== 'teardown') continue;

      let scan = await scanDom(driver);
      logger.info(
        { phase: phase.label, inputs: scan.inputs.length, buttons: scan.buttons.length },
        'runScenario: planning',
      );
      let steps: Step[];
      try {
        steps = await planSteps(phase.prompt, scan);
      } catch (err) {
        results.push({
          step: { action: 'execute_js', description: `[${phase.label}] plan` },
          status: 'failed',
          error: `planning failed: ${err instanceof Error ? err.message : String(err)}`,
          durationMs: 0,
        });
        phaseFailed = true;
        status = 'failed';
        continue;
      }

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]!;
        if (!step.description) step.description = `[${phase.label}] ${step.action}`;
        const t0 = Date.now();
        let healed = false;
        let lastError = '';

        if (opts.slowMoMs > 0 && results.length > 0) {
          await new Promise((r) => setTimeout(r, opts.slowMoMs));
        }

        try {
          const png = await runStep(driver, step, opts.timeoutMs);
          const file = `step-${results.length + 1}.png`;
          const buf = png ?? Buffer.from(await driver.takeScreenshot(), 'base64');
          await fs.writeFile(path.join(opts.outDir, file), buf);
          results.push({ step, status: 'passed', screenshot: file, durationMs: Date.now() - t0 });
          continue;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
        }

        // Self-heal once
        try {
          scan = await scanDom(driver);
          const fixed = await healStep(step, lastError, scan);
          if (fixed) {
            logger.info({ failed: step, fixed }, 'runScenario: self-heal');
            const png = await runStep(driver, fixed, opts.timeoutMs);
            const file = `step-${results.length + 1}.png`;
            const buf = png ?? Buffer.from(await driver.takeScreenshot(), 'base64');
            await fs.writeFile(path.join(opts.outDir, file), buf);
            healed = true;
            results.push({
              step: fixed,
              status: 'passed',
              screenshot: file,
              durationMs: Date.now() - t0,
              healed: true,
            });
            continue;
          }
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
        }

        // Failure screenshot
        let screenshot: string | undefined;
        try {
          const file = `step-${results.length + 1}-fail.png`;
          await fs.writeFile(
            path.join(opts.outDir, file),
            Buffer.from(await driver.takeScreenshot(), 'base64'),
          );
          screenshot = file;
        } catch {
          // ignore
        }

        results.push({
          step,
          status: 'failed',
          error: lastError,
          screenshot,
          durationMs: Date.now() - t0,
          healed,
        });

        phaseFailed = true;
        status = 'failed';
        break;
      }
    }
  } catch (err) {
    status = 'failed';
    results.push({
      step: { action: 'execute_js', description: 'scenario fatal' },
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
      durationMs: 0,
    });
  } finally {
    if (recorder) {
      try {
        videoResult = await recorder.stop();
      } catch (err) {
        logger.warn({ err }, 'video recorder stop failed');
      }
    }
    if (ownsDriver && driver) await driver.quit().catch(() => {});
  }

  const totalMs = Date.now() - started;
  const reportPath = await writeScenarioReport(opts.outDir, {
    name: opts.name,
    prompt: opts.prompt,
    url: opts.url,
    browser: opts.browser,
    results,
    startedAt,
    totalMs,
    video: videoResult ?? undefined,
  });

  return {
    name: opts.name ?? 'scenario',
    url: opts.url,
    prompt: opts.prompt,
    browser: opts.browser,
    startedAt,
    durationMs: totalMs,
    status,
    steps: results,
    reportPath,
    screenshotsDir: opts.outDir,
    video: videoResult ?? undefined,
  };
}
