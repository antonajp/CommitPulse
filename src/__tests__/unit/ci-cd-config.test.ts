import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';

/**
 * Unit tests for CI/CD configuration files (IQS-872).
 *
 * Validates:
 * - GitHub Actions CI workflow structure and triggers
 * - GitHub Actions Release workflow structure and triggers
 * - ESLint configuration exists and covers TypeScript
 * - Vitest configuration exists and covers test directories
 * - Pre-commit hook setup (husky + lint-staged)
 * - Package.json scripts for CI pipeline steps
 */

const ROOT = resolve(__dirname, '..', '..', '..');

function readYaml(relativePath: string): Record<string, unknown> {
  const fullPath = resolve(ROOT, relativePath);
  const content = readFileSync(fullPath, 'utf-8');
  return parseYaml(content) as Record<string, unknown>;
}

function fileExists(relativePath: string): boolean {
  return existsSync(resolve(ROOT, relativePath));
}

describe('CI/CD Configuration (IQS-872)', () => {
  describe('GitHub Actions CI Workflow', () => {
    let ci: Record<string, unknown>;

    beforeAll(() => {
      ci = readYaml('.github/workflows/ci.yml');
    });

    it('should exist at .github/workflows/ci.yml', () => {
      expect(fileExists('.github/workflows/ci.yml')).toBe(true);
    });

    it('should have name "CI"', () => {
      expect(ci['name']).toBe('CI');
    });

    it('should trigger on push to main', () => {
      const on = ci['on'] as Record<string, unknown>;
      expect(on).toBeDefined();
      const push = on['push'] as Record<string, unknown>;
      expect(push).toBeDefined();
      expect(push['branches']).toContain('main');
    });

    it('should trigger on pull_request to main', () => {
      const on = ci['on'] as Record<string, unknown>;
      const pr = on['pull_request'] as Record<string, unknown>;
      expect(pr).toBeDefined();
      expect(pr['branches']).toContain('main');
    });

    it('should have lint-and-typecheck job', () => {
      const jobs = ci['jobs'] as Record<string, unknown>;
      expect(jobs['lint-and-typecheck']).toBeDefined();
    });

    it('should have unit-tests job', () => {
      const jobs = ci['jobs'] as Record<string, unknown>;
      expect(jobs['unit-tests']).toBeDefined();
    });

    it('should have integration-tests job with PostgreSQL service', () => {
      const jobs = ci['jobs'] as Record<string, unknown>;
      const integrationJob = jobs['integration-tests'] as Record<string, unknown>;
      expect(integrationJob).toBeDefined();

      const services = integrationJob['services'] as Record<string, unknown>;
      expect(services).toBeDefined();
      expect(services['postgres']).toBeDefined();

      const postgres = services['postgres'] as Record<string, unknown>;
      expect(postgres['image']).toContain('postgres:16');
    });

    it('should have build job that depends on lint and tests', () => {
      const jobs = ci['jobs'] as Record<string, unknown>;
      const buildJob = jobs['build'] as Record<string, unknown>;
      expect(buildJob).toBeDefined();

      const needs = buildJob['needs'] as string[];
      expect(needs).toContain('lint-and-typecheck');
      expect(needs).toContain('unit-tests');
    });

    it('should have build job that packages VSIX', () => {
      const jobs = ci['jobs'] as Record<string, unknown>;
      const buildJob = jobs['build'] as Record<string, unknown>;
      const steps = buildJob['steps'] as Array<Record<string, unknown>>;

      const vsixStep = steps.find(
        (s) => typeof s['run'] === 'string' && (s['run'] as string).includes('vsce package')
      );
      expect(vsixStep).toBeDefined();
    });

    it('should upload VSIX artifact in build job', () => {
      const jobs = ci['jobs'] as Record<string, unknown>;
      const buildJob = jobs['build'] as Record<string, unknown>;
      const steps = buildJob['steps'] as Array<Record<string, unknown>>;

      const uploadStep = steps.find(
        (s) => typeof s['uses'] === 'string' && (s['uses'] as string).includes('upload-artifact')
      );
      expect(uploadStep).toBeDefined();
    });

    it('should use Node.js 20', () => {
      const jobs = ci['jobs'] as Record<string, unknown>;

      for (const jobName of ['lint-and-typecheck', 'unit-tests', 'build']) {
        const job = jobs[jobName] as Record<string, unknown>;
        const steps = job['steps'] as Array<Record<string, unknown>>;

        const nodeStep = steps.find(
          (s) => typeof s['uses'] === 'string' && (s['uses'] as string).includes('setup-node')
        );
        expect(nodeStep).toBeDefined();

        const withConfig = nodeStep!['with'] as Record<string, unknown>;
        expect(withConfig['node-version']).toBe(20);
      }
    });

    it('should have concurrency configuration to cancel stale runs', () => {
      const concurrency = ci['concurrency'] as Record<string, unknown>;
      expect(concurrency).toBeDefined();
      expect(concurrency['cancel-in-progress']).toBe(true);
    });
  });

  describe('GitHub Actions Release Workflow', () => {
    let release: Record<string, unknown>;

    beforeAll(() => {
      release = readYaml('.github/workflows/release.yml');
    });

    it('should exist at .github/workflows/release.yml', () => {
      expect(fileExists('.github/workflows/release.yml')).toBe(true);
    });

    it('should have name "Release"', () => {
      expect(release['name']).toBe('Release');
    });

    it('should trigger on push of v* tags', () => {
      const on = release['on'] as Record<string, unknown>;
      const push = on['push'] as Record<string, unknown>;
      const tags = push['tags'] as string[];
      expect(tags).toBeDefined();
      expect(tags.some((t) => t.startsWith('v'))).toBe(true);
    });

    it('should have a release job', () => {
      const jobs = release['jobs'] as Record<string, unknown>;
      expect(jobs['release']).toBeDefined();
    });

    it('should run lint, typecheck, and tests before packaging', () => {
      const jobs = release['jobs'] as Record<string, unknown>;
      const releaseJob = jobs['release'] as Record<string, unknown>;
      const steps = releaseJob['steps'] as Array<Record<string, unknown>>;

      const stepRuns = steps
        .filter((s) => typeof s['run'] === 'string')
        .map((s) => s['run'] as string);

      expect(stepRuns.some((r) => r.includes('lint'))).toBe(true);
      expect(stepRuns.some((r) => r.includes('typecheck'))).toBe(true);
      expect(stepRuns.some((r) => r.includes('test:unit'))).toBe(true);
    });

    it('should package VSIX in release job', () => {
      const jobs = release['jobs'] as Record<string, unknown>;
      const releaseJob = jobs['release'] as Record<string, unknown>;
      const steps = releaseJob['steps'] as Array<Record<string, unknown>>;

      const vsixStep = steps.find(
        (s) => typeof s['run'] === 'string' && (s['run'] as string).includes('vsce package')
      );
      expect(vsixStep).toBeDefined();
    });

    it('should create GitHub Release using softprops/action-gh-release', () => {
      const jobs = release['jobs'] as Record<string, unknown>;
      const releaseJob = jobs['release'] as Record<string, unknown>;
      const steps = releaseJob['steps'] as Array<Record<string, unknown>>;

      const releaseStep = steps.find(
        (s) =>
          typeof s['uses'] === 'string' &&
          (s['uses'] as string).includes('action-gh-release')
      );
      expect(releaseStep).toBeDefined();
    });

    it('should have contents: write permission', () => {
      const perms = release['permissions'] as Record<string, unknown>;
      expect(perms['contents']).toBe('write');
    });
  });

  describe('ESLint Configuration', () => {
    it('should exist at eslint.config.mjs', () => {
      expect(fileExists('eslint.config.mjs')).toBe(true);
    });

    it('should have lint script in package.json', () => {
      const pkg = JSON.parse(
        readFileSync(resolve(ROOT, 'package.json'), 'utf-8')
      ) as Record<string, unknown>;
      const scripts = pkg['scripts'] as Record<string, string>;
      expect(scripts['lint']).toBeDefined();
      expect(scripts['lint']).toContain('eslint');
    });

    it('should have lint:fix script in package.json', () => {
      const pkg = JSON.parse(
        readFileSync(resolve(ROOT, 'package.json'), 'utf-8')
      ) as Record<string, unknown>;
      const scripts = pkg['scripts'] as Record<string, string>;
      expect(scripts['lint:fix']).toBeDefined();
      expect(scripts['lint:fix']).toContain('--fix');
    });
  });

  describe('Vitest Configuration', () => {
    it('should exist at vitest.config.ts', () => {
      expect(fileExists('vitest.config.ts')).toBe(true);
    });

    it('should have test scripts in package.json', () => {
      const pkg = JSON.parse(
        readFileSync(resolve(ROOT, 'package.json'), 'utf-8')
      ) as Record<string, unknown>;
      const scripts = pkg['scripts'] as Record<string, string>;
      expect(scripts['test']).toBeDefined();
      expect(scripts['test:unit']).toBeDefined();
      expect(scripts['test:integration']).toBeDefined();
      expect(scripts['test:extension']).toBeDefined();
    });

    it('should have typecheck script in package.json', () => {
      const pkg = JSON.parse(
        readFileSync(resolve(ROOT, 'package.json'), 'utf-8')
      ) as Record<string, unknown>;
      const scripts = pkg['scripts'] as Record<string, string>;
      expect(scripts['typecheck']).toBeDefined();
      expect(scripts['typecheck']).toContain('tsc --noEmit');
    });
  });

  describe('Pre-commit Hook Setup', () => {
    it('should have husky installed (prepare script)', () => {
      const pkg = JSON.parse(
        readFileSync(resolve(ROOT, 'package.json'), 'utf-8')
      ) as Record<string, unknown>;
      const scripts = pkg['scripts'] as Record<string, string>;
      expect(scripts['prepare']).toBe('husky');
    });

    it('should have .husky/pre-commit hook file', () => {
      expect(fileExists('.husky/pre-commit')).toBe(true);
    });

    it('should have pre-commit hook that runs lint-staged', () => {
      const hook = readFileSync(
        resolve(ROOT, '.husky/pre-commit'),
        'utf-8'
      );
      expect(hook).toContain('lint-staged');
    });

    it('should have lint-staged configuration in package.json', () => {
      const pkg = JSON.parse(
        readFileSync(resolve(ROOT, 'package.json'), 'utf-8')
      ) as Record<string, unknown>;
      const lintStaged = pkg['lint-staged'] as Record<string, unknown>;
      expect(lintStaged).toBeDefined();

      // Should have a rule for TypeScript files
      const tsRule = Object.keys(lintStaged).find((k) => k.includes('.ts'));
      expect(tsRule).toBeDefined();
    });

    it('should have husky as a devDependency', () => {
      const pkg = JSON.parse(
        readFileSync(resolve(ROOT, 'package.json'), 'utf-8')
      ) as Record<string, unknown>;
      const devDeps = pkg['devDependencies'] as Record<string, string>;
      expect(devDeps['husky']).toBeDefined();
    });

    it('should have lint-staged as a devDependency', () => {
      const pkg = JSON.parse(
        readFileSync(resolve(ROOT, 'package.json'), 'utf-8')
      ) as Record<string, unknown>;
      const devDeps = pkg['devDependencies'] as Record<string, string>;
      expect(devDeps['lint-staged']).toBeDefined();
    });
  });

  describe('CI Docker Compose Integration', () => {
    it('should have docker-compose.yml for local development', () => {
      expect(fileExists('docker-compose.yml')).toBe(true);
    });

    it('should use PostgreSQL 16 in CI integration test service', () => {
      const ci = readYaml('.github/workflows/ci.yml');
      const jobs = ci['jobs'] as Record<string, unknown>;
      const integrationJob = jobs['integration-tests'] as Record<string, unknown>;
      const services = integrationJob['services'] as Record<string, unknown>;
      const postgres = services['postgres'] as Record<string, unknown>;
      expect(postgres['image']).toContain('16');
    });

    it('should have health check on CI PostgreSQL service', () => {
      const ci = readYaml('.github/workflows/ci.yml');
      const jobs = ci['jobs'] as Record<string, unknown>;
      const integrationJob = jobs['integration-tests'] as Record<string, unknown>;
      const services = integrationJob['services'] as Record<string, unknown>;
      const postgres = services['postgres'] as Record<string, unknown>;
      const options = postgres['options'] as string;
      expect(options).toContain('health-cmd');
      expect(options).toContain('pg_isready');
    });
  });

  describe('Package.json CI-related Scripts', () => {
    let scripts: Record<string, string>;

    beforeAll(() => {
      const pkg = JSON.parse(
        readFileSync(resolve(ROOT, 'package.json'), 'utf-8')
      ) as Record<string, unknown>;
      scripts = pkg['scripts'] as Record<string, string>;
    });

    it('should have compile script (esbuild)', () => {
      expect(scripts['compile']).toBeDefined();
      expect(scripts['compile']).toContain('esbuild');
    });

    it('should have package script (esbuild --production)', () => {
      expect(scripts['package']).toBeDefined();
      expect(scripts['package']).toContain('--production');
    });

    it('should have vscode:prepublish script', () => {
      expect(scripts['vscode:prepublish']).toBeDefined();
    });

    it('should have dev script for VSIX packaging', () => {
      expect(scripts['dev']).toBeDefined();
      expect(scripts['dev']).toContain('vsce package');
    });
  });
});
