import fs from 'node:fs/promises';
import { JsonPatchArgs } from '@koda/shared';
import type { Tool } from './registry.js';
import { resolveInside } from '../sandbox/fs.js';

// ── JSON Pointer helpers (RFC 6901) ──────────────────────────────────────────

/**
 * Decode a single JSON Pointer token: unescape `~1` → `/` then `~0` → `~`.
 */
function decodeToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * Split a JSON Pointer string (e.g. "/foo/bar/0") into an array of decoded
 * property/index tokens. The root pointer "" returns [].
 */
function pointerTokens(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) {
    throw new Error(`Invalid JSON Pointer: "${pointer}" — must start with '/'`);
  }
  return pointer.slice(1).split('/').map(decodeToken);
}

/**
 * Retrieve the value at the given JSON Pointer within `root`.
 * Throws if the path does not exist.
 */
function jsonPointerGet(root: unknown, pointer: string): unknown {
  const tokens = pointerTokens(pointer);
  let current: unknown = root;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      const idx = Number(token);
      if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) {
        throw new Error(`JSON Pointer: array index out of bounds at "${token}"`);
      }
      current = current[idx];
    } else if (current !== null && typeof current === 'object') {
      if (!Object.prototype.hasOwnProperty.call(current, token)) {
        throw new Error(`JSON Pointer: key "${token}" not found`);
      }
      current = (current as Record<string, unknown>)[token];
    } else {
      throw new Error(`JSON Pointer: cannot traverse into scalar at "${token}"`);
    }
  }
  return current;
}

/**
 * Set (or add) `value` at the given JSON Pointer within `root`.
 * Mutates root in-place. If the final token is "-" and the parent is an array,
 * the value is appended.
 * Returns the (possibly mutated) root.
 */
function jsonPointerSet(root: unknown, pointer: string, value: unknown): unknown {
  const tokens = pointerTokens(pointer);

  if (tokens.length === 0) {
    // Replacing the root itself — caller must handle the returned value
    return value;
  }

  let current: unknown = root;
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i]!;
    if (Array.isArray(current)) {
      const idx = Number(token);
      if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) {
        throw new Error(`JSON Pointer: array index out of bounds at "${token}"`);
      }
      current = current[idx];
    } else if (current !== null && typeof current === 'object') {
      current = (current as Record<string, unknown>)[token];
    } else {
      throw new Error(`JSON Pointer: cannot traverse into scalar at "${token}"`);
    }
  }

  const lastToken = tokens[tokens.length - 1]!;

  if (Array.isArray(current)) {
    if (lastToken === '-') {
      current.push(value);
    } else {
      const idx = Number(lastToken);
      if (!Number.isInteger(idx) || idx < 0) {
        throw new Error(`JSON Pointer: invalid array index "${lastToken}"`);
      }
      // Allow idx === current.length (append via explicit index)
      if (idx > current.length) {
        throw new Error(`JSON Pointer: array index ${idx} out of bounds (length ${current.length})`);
      }
      current.splice(idx, 0, value); // 'add' semantics: insert, don't overwrite
    }
  } else if (current !== null && typeof current === 'object') {
    (current as Record<string, unknown>)[lastToken] = value;
  } else {
    throw new Error(`JSON Pointer: cannot set property on scalar at "${lastToken}"`);
  }

  return root;
}

/**
 * Remove the value at the given JSON Pointer.
 * Mutates root in-place. Returns the (possibly mutated) root.
 */
function jsonPointerRemove(root: unknown, pointer: string): unknown {
  const tokens = pointerTokens(pointer);
  if (tokens.length === 0) {
    throw new Error('JSON Pointer: cannot remove the root document');
  }

  let current: unknown = root;
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i]!;
    if (Array.isArray(current)) {
      const idx = Number(token);
      current = current[idx];
    } else if (current !== null && typeof current === 'object') {
      current = (current as Record<string, unknown>)[token];
    } else {
      throw new Error(`JSON Pointer: cannot traverse into scalar at "${token}"`);
    }
  }

  const lastToken = tokens[tokens.length - 1]!;
  if (Array.isArray(current)) {
    const idx = Number(lastToken);
    if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) {
      throw new Error(`JSON Pointer: array index out of bounds at "${lastToken}"`);
    }
    current.splice(idx, 1);
  } else if (current !== null && typeof current === 'object') {
    delete (current as Record<string, unknown>)[lastToken];
  } else {
    throw new Error(`JSON Pointer: cannot remove from scalar at "${lastToken}"`);
  }

  return root;
}

// ── Patch operation types ─────────────────────────────────────────────────────

interface PatchOp {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: unknown;
  from?: string;
}

/**
 * Apply a single RFC 6902 patch operation to `doc` and return the (possibly
 * new) root document. All mutations are in-place where possible; replace/add
 * at the root level returns a new root value.
 */
function applyPatch(doc: unknown, op: PatchOp): unknown {
  switch (op.op) {
    case 'replace': {
      if (op.value === undefined) throw new Error(`'replace' op missing 'value'`);
      const tokens = pointerTokens(op.path);
      if (tokens.length === 0) return op.value; // replace root
      // For replace we must overwrite (not insert), so remove then set via object key assign
      // Re-use jsonPointerSet which does insert for arrays — for 'replace' we instead
      // directly assign to the parent object/array element.
      let current: unknown = doc;
      for (let i = 0; i < tokens.length - 1; i++) {
        const token = tokens[i]!;
        if (Array.isArray(current)) current = current[Number(token)];
        else current = (current as Record<string, unknown>)[token];
      }
      const lastToken = tokens[tokens.length - 1]!;
      if (Array.isArray(current)) {
        const idx = Number(lastToken);
        if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) {
          throw new Error(`'replace': index ${idx} out of bounds`);
        }
        current[idx] = op.value;
      } else if (current !== null && typeof current === 'object') {
        if (!Object.prototype.hasOwnProperty.call(current, lastToken)) {
          throw new Error(`'replace': key "${lastToken}" does not exist`);
        }
        (current as Record<string, unknown>)[lastToken] = op.value;
      }
      return doc;
    }

    case 'add': {
      if (op.value === undefined) throw new Error(`'add' op missing 'value'`);
      return jsonPointerSet(doc, op.path, op.value);
    }

    case 'remove': {
      return jsonPointerRemove(doc, op.path);
    }

    case 'test': {
      if (op.value === undefined) throw new Error(`'test' op missing 'value'`);
      const actual = jsonPointerGet(doc, op.path);
      if (JSON.stringify(actual) !== JSON.stringify(op.value)) {
        throw new Error(
          `'test' failed at "${op.path}": expected ${JSON.stringify(op.value)}, got ${JSON.stringify(actual)}`,
        );
      }
      return doc;
    }

    case 'copy': {
      if (!op.from) throw new Error(`'copy' op missing 'from'`);
      const copyValue = structuredClone(jsonPointerGet(doc, op.from));
      return jsonPointerSet(doc, op.path, copyValue);
    }

    case 'move': {
      if (!op.from) throw new Error(`'move' op missing 'from'`);
      // 'from' must not be a proper prefix of 'path'
      if (op.path.startsWith(op.from + '/')) {
        throw new Error(`'move': 'from' (${op.from}) is a prefix of 'path' (${op.path})`);
      }
      const moveValue = structuredClone(jsonPointerGet(doc, op.from));
      doc = jsonPointerRemove(doc, op.from);
      return jsonPointerSet(doc, op.path, moveValue);
    }

    default: {
      const _exhaustive: never = op.op;
      throw new Error(`Unknown patch op: ${String(_exhaustive)}`);
    }
  }
}

// ── Tool definition ───────────────────────────────────────────────────────────

export const jsonPatchTool: Tool<typeof JsonPatchArgs._type> = {
  name: 'json_patch',
  description: 'Apply RFC 6902 JSON Patch operations to a JSON file. Requires user approval.',
  requiresApproval: true,
  schema: JsonPatchArgs,
  async run(args, ctx) {
    const abs = resolveInside(ctx.workDir, args.path);

    const raw = await fs.readFile(abs, 'utf8');
    let doc: unknown;
    try {
      doc = JSON.parse(raw);
    } catch (err) {
      return `Error: failed to parse JSON at "${args.path}": ${err instanceof Error ? err.message : String(err)}`;
    }

    for (let i = 0; i < args.patches.length; i++) {
      const patch = args.patches[i]!;
      try {
        doc = applyPatch(doc, patch);
      } catch (err) {
        return `Error: patch ${i} (op="${patch.op}", path="${patch.path}") failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    await fs.writeFile(abs, JSON.stringify(doc, null, 2), 'utf8');

    return `Applied ${args.patches.length} patch${args.patches.length === 1 ? '' : 'es'} to ${args.path}`;
  },
};
