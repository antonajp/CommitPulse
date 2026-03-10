import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync, statSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';

/**
 * Unit tests validating the Docker Compose configuration for PostgreSQL 16.
 * These tests verify the structure, settings, and security posture of
 * docker-compose.yml and .env.example without starting Docker.
 *
 * Ticket: IQS-846
 */

const projectRoot = resolve(__dirname, '..', '..', '..');

describe('Docker Compose Configuration', () => {
  let composeContent: string;
  let composeConfig: Record<string, unknown>;

  beforeAll(() => {
    const composePath = resolve(projectRoot, 'docker-compose.yml');
    expect(existsSync(composePath)).toBe(true);
    composeContent = readFileSync(composePath, 'utf-8');
    composeConfig = parseYaml(composeContent) as Record<string, unknown>;
  });

  it('should have a valid docker-compose.yml at project root', () => {
    const composePath = resolve(projectRoot, 'docker-compose.yml');
    expect(existsSync(composePath)).toBe(true);
  });

  it('should define a postgres service', () => {
    const services = composeConfig['services'] as Record<string, unknown>;
    expect(services).toBeDefined();
    expect(services['postgres']).toBeDefined();
  });

  it('should use postgres:16-alpine image', () => {
    const services = composeConfig['services'] as Record<string, unknown>;
    const postgres = services['postgres'] as Record<string, unknown>;
    expect(postgres['image']).toBe('postgres:16-alpine');
  });

  it('should have container name gitrx-postgres', () => {
    const services = composeConfig['services'] as Record<string, unknown>;
    const postgres = services['postgres'] as Record<string, unknown>;
    expect(postgres['container_name']).toBe('gitrx-postgres');
  });

  it('should configure restart policy', () => {
    const services = composeConfig['services'] as Record<string, unknown>;
    const postgres = services['postgres'] as Record<string, unknown>;
    expect(postgres['restart']).toBe('unless-stopped');
  });

  it('should configure health check with pg_isready', () => {
    const services = composeConfig['services'] as Record<string, unknown>;
    const postgres = services['postgres'] as Record<string, unknown>;
    const healthcheck = postgres['healthcheck'] as Record<string, unknown>;

    expect(healthcheck).toBeDefined();
    // pg_isready should be present in the test command
    const test = healthcheck['test'] as string[];
    const testStr = Array.isArray(test) ? test.join(' ') : String(test);
    expect(testStr).toContain('pg_isready');
  });

  it('should configure health check with interval, timeout, and retries', () => {
    const services = composeConfig['services'] as Record<string, unknown>;
    const postgres = services['postgres'] as Record<string, unknown>;
    const healthcheck = postgres['healthcheck'] as Record<string, unknown>;

    expect(healthcheck['interval']).toBeDefined();
    expect(healthcheck['timeout']).toBeDefined();
    expect(healthcheck['retries']).toBeDefined();
  });

  it('should map port 5433 using environment variable substitution', () => {
    const services = composeConfig['services'] as Record<string, unknown>;
    const postgres = services['postgres'] as Record<string, unknown>;
    const ports = postgres['ports'] as string[];

    expect(ports).toBeDefined();
    expect(Array.isArray(ports)).toBe(true);
    expect(ports.length).toBeGreaterThanOrEqual(1);

    // Port mapping should reference DB_PORT env var with 5433 default
    const portMapping = ports[0] as string;
    expect(portMapping).toContain('5433');
  });

  it('should define named volume gitrx-pgdata', () => {
    const volumes = composeConfig['volumes'] as Record<string, unknown>;
    expect(volumes).toBeDefined();
    expect(volumes['gitrx-pgdata']).toBeDefined();
  });

  it('should mount named volume to postgres data directory', () => {
    const services = composeConfig['services'] as Record<string, unknown>;
    const postgres = services['postgres'] as Record<string, unknown>;
    const volumes = postgres['volumes'] as string[];

    expect(volumes).toBeDefined();
    expect(Array.isArray(volumes)).toBe(true);

    // Should mount gitrx-pgdata to /var/lib/postgresql/data
    const dataVolume = volumes.find((v: string) => v.includes('gitrx-pgdata'));
    expect(dataVolume).toBeDefined();
    expect(dataVolume).toContain('/var/lib/postgresql/data');
  });

  it('should mount init script directory at /docker-entrypoint-initdb.d/', () => {
    const services = composeConfig['services'] as Record<string, unknown>;
    const postgres = services['postgres'] as Record<string, unknown>;
    const volumes = postgres['volumes'] as string[];

    const initVolume = volumes.find((v: string) => v.includes('docker-entrypoint-initdb.d'));
    expect(initVolume).toBeDefined();
    expect(initVolume).toContain('docker/init');
  });

  it('should use environment variables for database configuration', () => {
    const services = composeConfig['services'] as Record<string, unknown>;
    const postgres = services['postgres'] as Record<string, unknown>;
    const environment = postgres['environment'] as Record<string, string>;

    expect(environment).toBeDefined();

    // Should reference env vars (with defaults) for DB name, user, password
    const envStr = JSON.stringify(environment);
    expect(envStr).toContain('POSTGRES_DB');
    expect(envStr).toContain('POSTGRES_USER');
    expect(envStr).toContain('POSTGRES_PASSWORD');
  });

  it('should not hardcode secrets in docker-compose.yml', () => {
    // The password should use variable substitution, not a literal value
    // This means the YAML value should contain ${...} syntax
    expect(composeContent).not.toMatch(/POSTGRES_PASSWORD:\s+[a-zA-Z0-9_]+\s*$/m);
    // Should use env var substitution
    expect(composeContent).toContain('${DB_PASSWORD');
  });
});

describe('.env.example File', () => {
  let envContent: string;

  beforeAll(() => {
    const envPath = resolve(projectRoot, '.env.example');
    expect(existsSync(envPath)).toBe(true);
    envContent = readFileSync(envPath, 'utf-8');
  });

  it('should have .env.example at project root', () => {
    const envPath = resolve(projectRoot, '.env.example');
    expect(existsSync(envPath)).toBe(true);
  });

  it('should define DB_HOST', () => {
    expect(envContent).toContain('DB_HOST=');
  });

  it('should define DB_PORT with default 5433', () => {
    expect(envContent).toContain('DB_PORT=');
    expect(envContent).toMatch(/DB_PORT=5433/);
  });

  it('should define DB_NAME with default gitrx', () => {
    expect(envContent).toContain('DB_NAME=');
    expect(envContent).toMatch(/DB_NAME=gitrx/);
  });

  it('should define DB_USER with default gitrx_admin', () => {
    expect(envContent).toContain('DB_USER=');
    expect(envContent).toMatch(/DB_USER=gitrx_admin/);
  });

  it('should define DB_PASSWORD with a placeholder value', () => {
    expect(envContent).toContain('DB_PASSWORD=');
    // Should not contain an actual secret - just a placeholder
    expect(envContent).toMatch(/DB_PASSWORD=change_me_before_use/);
  });

  it('should not contain real secrets', () => {
    // Verify the file uses obvious placeholder values, not real credentials
    expect(envContent).not.toMatch(/DB_PASSWORD=\s*$/m);
    expect(envContent).toContain('change_me');
  });
});

describe('.gitignore Configuration', () => {
  it('should exclude .env files from version control', () => {
    const gitignorePath = resolve(projectRoot, '.gitignore');
    const gitignoreContent = readFileSync(gitignorePath, 'utf-8');

    expect(gitignoreContent).toContain('.env');
  });

  it('should explicitly include .env.example', () => {
    const gitignorePath = resolve(projectRoot, '.gitignore');
    const gitignoreContent = readFileSync(gitignorePath, 'utf-8');

    expect(gitignoreContent).toContain('!.env.example');
  });
});

describe('Docker Init Script Directory', () => {
  it('should have docker/init/ directory for init scripts', () => {
    const initDir = resolve(projectRoot, 'docker', 'init');
    expect(existsSync(initDir)).toBe(true);
    expect(statSync(initDir).isDirectory()).toBe(true);
  });
});

describe('Docker Compose File Structure', () => {
  it('docker-compose.yml should not exceed 600 lines', () => {
    const composePath = resolve(projectRoot, 'docker-compose.yml');
    const content = readFileSync(composePath, 'utf-8');
    const lineCount = content.split('\n').length;
    expect(lineCount).toBeLessThanOrEqual(600);
  });
});
