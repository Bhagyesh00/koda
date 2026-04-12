import { describe, it, expect } from 'vitest';
import { resolveInsideWorkDir } from '../src/sandbox/fs.js';
import { SandboxError } from '../src/errors.js';

describe('resolveInsideWorkDir', () => {
  it('accepts simple relative paths', () => {
    expect(() => resolveInsideWorkDir('foo.txt')).not.toThrow();
    expect(() => resolveInsideWorkDir('sub/dir/file.md')).not.toThrow();
  });

  it('rejects parent traversal', () => {
    expect(() => resolveInsideWorkDir('../escape.txt')).toThrow(SandboxError);
    expect(() => resolveInsideWorkDir('../../etc/passwd')).toThrow(SandboxError);
  });

  it('rejects absolute paths outside workdir', () => {
    expect(() => resolveInsideWorkDir('/etc/passwd')).toThrow(SandboxError);
  });
});
