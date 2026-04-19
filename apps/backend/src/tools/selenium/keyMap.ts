import { Key } from 'selenium-webdriver';

/**
 * Maps user-friendly key names (case-insensitive) to selenium-webdriver Key enum values.
 * Accepts aliases like "Enter"/"Return", "Esc"/"Escape", "Up"/"ArrowUp", etc.
 * Single characters (e.g. "a") are returned as-is so sendKeys can type them.
 */
const KEY_MAP: Record<string, string> = {
  enter: Key.ENTER,
  return: Key.RETURN,
  tab: Key.TAB,
  escape: Key.ESCAPE,
  esc: Key.ESCAPE,
  space: Key.SPACE,
  backspace: Key.BACK_SPACE,
  delete: Key.DELETE,
  insert: Key.INSERT,
  home: Key.HOME,
  end: Key.END,
  pageup: Key.PAGE_UP,
  pagedown: Key.PAGE_DOWN,
  arrowup: Key.ARROW_UP,
  up: Key.ARROW_UP,
  arrowdown: Key.ARROW_DOWN,
  down: Key.ARROW_DOWN,
  arrowleft: Key.ARROW_LEFT,
  left: Key.ARROW_LEFT,
  arrowright: Key.ARROW_RIGHT,
  right: Key.ARROW_RIGHT,
  shift: Key.SHIFT,
  control: Key.CONTROL,
  ctrl: Key.CONTROL,
  alt: Key.ALT,
  meta: Key.META,
  cmd: Key.META,
  command: Key.META,
  f1: Key.F1,
  f2: Key.F2,
  f3: Key.F3,
  f4: Key.F4,
  f5: Key.F5,
  f6: Key.F6,
  f7: Key.F7,
  f8: Key.F8,
  f9: Key.F9,
  f10: Key.F10,
  f11: Key.F11,
  f12: Key.F12,
};

export function resolveKey(name: string): string {
  const norm = name.trim().toLowerCase().replace(/[\s_-]/g, '');
  return KEY_MAP[norm] ?? name;
}
