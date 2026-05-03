import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  runShellPreFlight,
  _setDockerAvailableForTests,
  _resetDockerProbeForTests,
} from '../src/sandbox/exec.js';

// Phase 3 — Pre-Flight Simulation regression tests. These cover the Docker
// wrapper's fallback semantics deterministically by forcing the cached probe
// result; the actual Docker-execution path is covered by manual smoke tests
// because we can't assume a Docker daemon in CI.

describe('runShellPreFlight — fallback semantics', () => {
  beforeEach(() => {
    _resetDockerProbeForTests();
  });
  afterAll(() => {
    _resetDockerProbeForTests();
  });

  it('falls back to host shell when Docker is unavailable', async () => {
    _setDockerAvailableForTests(false);
    // `echo` is portable across cmd.exe and POSIX sh.
    const r = await runShellPreFlight('echo preflight-fallback');
    expect(r.ranInContainer).toBe(false);
    expect(r.fallbackReason).toBe('docker_unavailable');
    expect(r.ok).toBe(true);
    expect(r.stdout).toContain('preflight-fallback');
  });

  it('strict mode returns an error instead of falling back', async () => {
    _setDockerAvailableForTests(false);
    const r = await runShellPreFlight('echo should-not-run', { strict: true });
    expect(r.ranInContainer).toBe(false);
    expect(r.fallbackReason).toBe('docker_unavailable');
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(-1);
    expect(r.stderr).toMatch(/docker is required/i);
  });
});
