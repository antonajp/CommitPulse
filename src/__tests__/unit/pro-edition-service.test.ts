import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _clearMocks, window as vscodeWindow, Uri as vscodeUri } from '../__mocks__/vscode.js';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { SecretStorageService, SecretKeys } from '../../config/secret-storage.js';
import {
  ProEditionService,
  RefreshCounter,
  FREE_REFRESH_LIMIT,
  STRIPE_CHECKOUT_URL,
  FEATURES_URL,
} from '../../services/pro-edition-service.js';
import { LoggerService } from '../../logging/logger.js';

/**
 * Unit tests for ProEditionService.
 *
 * GITX-140: Tests freemium model implementation:
 * - Usage counter increment logic
 * - Checksum validation (tamper detection)
 * - Pro user bypass logic
 * - Upgrade prompt flow
 *
 * Ticket: GITX-140
 */

/**
 * Create a mock SecretStorage that stores values in a Map.
 */
function createMockSecretStorage(): {
  get: ReturnType<typeof vi.fn>;
  store: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  onDidChange: ReturnType<typeof vi.fn>;
  _storage: Map<string, string>;
} {
  const storage = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => storage.get(key)),
    store: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
    delete: vi.fn(async (key: string) => { storage.delete(key); }),
    onDidChange: vi.fn(() => ({ dispose: () => { /* noop */ } })),
    _storage: storage,
  };
}

describe('ProEditionService', () => {
  let service: ProEditionService;
  let secretService: SecretStorageService;
  let mockStorage: ReturnType<typeof createMockSecretStorage>;

  beforeEach(() => {
    _clearMocks();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();

    mockStorage = createMockSecretStorage();
    secretService = new SecretStorageService(mockStorage as never);
    service = new ProEditionService(secretService);
  });

  afterEach(() => {
    service.dispose();
    secretService.dispose();
    try { LoggerService.getInstance().dispose(); } catch { /* ignore */ }
    LoggerService.resetInstance();
    _clearMocks();
  });

  describe('Constants', () => {
    it('should define FREE_REFRESH_LIMIT as 3', () => {
      expect(FREE_REFRESH_LIMIT).toBe(3);
    });

    it('should define STRIPE_CHECKOUT_URL', () => {
      expect(STRIPE_CHECKOUT_URL).toBeTruthy();
      expect(STRIPE_CHECKOUT_URL).toMatch(/^https:\/\//);
    });

    it('should define FEATURES_URL', () => {
      expect(FEATURES_URL).toBeTruthy();
      expect(FEATURES_URL).toMatch(/^https:\/\//);
    });
  });

  describe('isProUser', () => {
    it('should return false when no license key is set', async () => {
      const result = await service.isProUser();
      expect(result).toBe(false);
    });

    it('should return true when license key is set', async () => {
      mockStorage._storage.set(SecretKeys.PRO_LICENSE_KEY, 'valid-license-key-123');
      const result = await service.isProUser();
      expect(result).toBe(true);
    });

    it('should return false when license key is empty string', async () => {
      mockStorage._storage.set(SecretKeys.PRO_LICENSE_KEY, '');
      const result = await service.isProUser();
      expect(result).toBe(false);
    });

    it('should return false when license key is whitespace only', async () => {
      mockStorage._storage.set(SecretKeys.PRO_LICENSE_KEY, '   ');
      const result = await service.isProUser();
      expect(result).toBe(false);
    });
  });

  describe('getRefreshCount', () => {
    it('should return null for new user (no counter)', async () => {
      const result = await service.getRefreshCount();
      expect(result).toBeNull();
    });

    it('should return counter when valid data exists', async () => {
      const counter: RefreshCounter = {
        count: 2,
        firstUsedAt: '2024-01-01T00:00:00.000Z',
        lastUsedAt: '2024-01-15T00:00:00.000Z',
        checksum: service.computeChecksum(2, '2024-01-01T00:00:00.000Z', '2024-01-15T00:00:00.000Z'),
      };
      mockStorage._storage.set(SecretKeys.TECH_STACK_REFRESH_COUNT, JSON.stringify(counter));

      const result = await service.getRefreshCount();
      expect(result).not.toBeNull();
      expect(result!.count).toBe(2);
      expect(result!.firstUsedAt).toBe('2024-01-01T00:00:00.000Z');
    });

    it('should return null when checksum is invalid (tampered)', async () => {
      const counter: RefreshCounter = {
        count: 2,
        firstUsedAt: '2024-01-01T00:00:00.000Z',
        lastUsedAt: '2024-01-15T00:00:00.000Z',
        checksum: 'invalid-checksum-12345',
      };
      mockStorage._storage.set(SecretKeys.TECH_STACK_REFRESH_COUNT, JSON.stringify(counter));

      const result = await service.getRefreshCount();
      expect(result).toBeNull();
    });

    it('should return null when JSON is malformed', async () => {
      mockStorage._storage.set(SecretKeys.TECH_STACK_REFRESH_COUNT, 'not-valid-json');

      const result = await service.getRefreshCount();
      expect(result).toBeNull();
    });
  });

  describe('initializeCounter', () => {
    it('should create counter with count=0', async () => {
      const result = await service.initializeCounter();

      expect(result.count).toBe(0);
      expect(result.firstUsedAt).toBeTruthy();
      expect(result.lastUsedAt).toBeTruthy();
      expect(result.checksum).toBeTruthy();
    });

    it('should store counter in SecretStorage', async () => {
      await service.initializeCounter();

      expect(mockStorage.store).toHaveBeenCalledWith(
        SecretKeys.TECH_STACK_REFRESH_COUNT,
        expect.any(String)
      );
    });

    it('should create valid checksum', async () => {
      const result = await service.initializeCounter();

      const expectedChecksum = service.computeChecksum(
        result.count,
        result.firstUsedAt,
        result.lastUsedAt
      );
      expect(result.checksum).toBe(expectedChecksum);
    });
  });

  describe('incrementRefreshCount', () => {
    it('should initialize counter if none exists and increment to 1', async () => {
      const result = await service.incrementRefreshCount();

      expect(result.count).toBe(1);
    });

    it('should increment existing counter', async () => {
      const counter: RefreshCounter = {
        count: 1,
        firstUsedAt: '2024-01-01T00:00:00.000Z',
        lastUsedAt: '2024-01-01T00:00:00.000Z',
        checksum: service.computeChecksum(1, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z'),
      };
      mockStorage._storage.set(SecretKeys.TECH_STACK_REFRESH_COUNT, JSON.stringify(counter));

      const result = await service.incrementRefreshCount();

      expect(result.count).toBe(2);
      expect(result.firstUsedAt).toBe('2024-01-01T00:00:00.000Z'); // Should not change
    });

    it('should update lastUsedAt timestamp', async () => {
      const oldTimestamp = '2024-01-01T00:00:00.000Z';
      const counter: RefreshCounter = {
        count: 1,
        firstUsedAt: oldTimestamp,
        lastUsedAt: oldTimestamp,
        checksum: service.computeChecksum(1, oldTimestamp, oldTimestamp),
      };
      mockStorage._storage.set(SecretKeys.TECH_STACK_REFRESH_COUNT, JSON.stringify(counter));

      const result = await service.incrementRefreshCount();

      expect(result.lastUsedAt).not.toBe(oldTimestamp);
    });

    it('should update checksum after increment', async () => {
      const counter: RefreshCounter = {
        count: 1,
        firstUsedAt: '2024-01-01T00:00:00.000Z',
        lastUsedAt: '2024-01-01T00:00:00.000Z',
        checksum: service.computeChecksum(1, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z'),
      };
      mockStorage._storage.set(SecretKeys.TECH_STACK_REFRESH_COUNT, JSON.stringify(counter));

      const result = await service.incrementRefreshCount();

      // Checksum should be valid for the new values
      expect(service.validateChecksum(result)).toBe(true);
    });

    it('should initialize fresh counter if existing is tampered', async () => {
      // Store tampered counter
      const tampered: RefreshCounter = {
        count: 0, // Tampered from 2
        firstUsedAt: '2024-01-01T00:00:00.000Z',
        lastUsedAt: '2024-01-15T00:00:00.000Z',
        checksum: service.computeChecksum(2, '2024-01-01T00:00:00.000Z', '2024-01-15T00:00:00.000Z'),
      };
      mockStorage._storage.set(SecretKeys.TECH_STACK_REFRESH_COUNT, JSON.stringify(tampered));

      const result = await service.incrementRefreshCount();

      // Should start fresh because counter was null (tampered)
      expect(result.count).toBe(1);
    });
  });

  describe('canUseRefresh', () => {
    describe('Pro users', () => {
      it('should always allow Pro users', async () => {
        mockStorage._storage.set(SecretKeys.PRO_LICENSE_KEY, 'valid-license-key');

        const result = await service.canUseRefresh();

        expect(result.canProceed).toBe(true);
        expect(result.isPro).toBe(true);
        expect(result.currentCount).toBe(0);
      });

      it('should allow Pro users even with max counter', async () => {
        mockStorage._storage.set(SecretKeys.PRO_LICENSE_KEY, 'valid-license-key');
        const counter: RefreshCounter = {
          count: 5,
          firstUsedAt: '2024-01-01T00:00:00.000Z',
          lastUsedAt: '2024-01-15T00:00:00.000Z',
          checksum: service.computeChecksum(5, '2024-01-01T00:00:00.000Z', '2024-01-15T00:00:00.000Z'),
        };
        mockStorage._storage.set(SecretKeys.TECH_STACK_REFRESH_COUNT, JSON.stringify(counter));

        const result = await service.canUseRefresh();

        expect(result.canProceed).toBe(true);
        expect(result.isPro).toBe(true);
      });
    });

    describe('Free users - new', () => {
      it('should allow new free users', async () => {
        const result = await service.canUseRefresh();

        expect(result.canProceed).toBe(true);
        expect(result.isPro).toBe(false);
        expect(result.currentCount).toBe(0);
        expect(result.remainingFree).toBe(FREE_REFRESH_LIMIT);
      });
    });

    describe('Free users - under limit', () => {
      it('should allow free users with 1 use', async () => {
        const counter: RefreshCounter = {
          count: 1,
          firstUsedAt: '2024-01-01T00:00:00.000Z',
          lastUsedAt: '2024-01-01T00:00:00.000Z',
          checksum: service.computeChecksum(1, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z'),
        };
        mockStorage._storage.set(SecretKeys.TECH_STACK_REFRESH_COUNT, JSON.stringify(counter));

        const result = await service.canUseRefresh();

        expect(result.canProceed).toBe(true);
        expect(result.isPro).toBe(false);
        expect(result.currentCount).toBe(1);
        expect(result.remainingFree).toBe(2);
      });

      it('should allow free users with 2 uses', async () => {
        const counter: RefreshCounter = {
          count: 2,
          firstUsedAt: '2024-01-01T00:00:00.000Z',
          lastUsedAt: '2024-01-01T00:00:00.000Z',
          checksum: service.computeChecksum(2, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z'),
        };
        mockStorage._storage.set(SecretKeys.TECH_STACK_REFRESH_COUNT, JSON.stringify(counter));

        const result = await service.canUseRefresh();

        expect(result.canProceed).toBe(true);
        expect(result.currentCount).toBe(2);
        expect(result.remainingFree).toBe(1);
      });
    });

    describe('Free users - at limit', () => {
      it('should block free users at limit (count=3)', async () => {
        const counter: RefreshCounter = {
          count: 3,
          firstUsedAt: '2024-01-01T00:00:00.000Z',
          lastUsedAt: '2024-01-01T00:00:00.000Z',
          checksum: service.computeChecksum(3, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z'),
        };
        mockStorage._storage.set(SecretKeys.TECH_STACK_REFRESH_COUNT, JSON.stringify(counter));

        const result = await service.canUseRefresh();

        expect(result.canProceed).toBe(false);
        expect(result.isPro).toBe(false);
        expect(result.currentCount).toBe(3);
        expect(result.remainingFree).toBe(0);
        expect(result.reason).toBe('limit_reached');
      });

      it('should block free users over limit (count=5)', async () => {
        const counter: RefreshCounter = {
          count: 5,
          firstUsedAt: '2024-01-01T00:00:00.000Z',
          lastUsedAt: '2024-01-01T00:00:00.000Z',
          checksum: service.computeChecksum(5, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z'),
        };
        mockStorage._storage.set(SecretKeys.TECH_STACK_REFRESH_COUNT, JSON.stringify(counter));

        const result = await service.canUseRefresh();

        expect(result.canProceed).toBe(false);
        expect(result.reason).toBe('limit_reached');
      });
    });

    describe('Tampered counter', () => {
      it('should block users with tampered counter', async () => {
        // Store counter with invalid checksum
        const tampered: RefreshCounter = {
          count: 0, // Tampered from original
          firstUsedAt: '2024-01-01T00:00:00.000Z',
          lastUsedAt: '2024-01-01T00:00:00.000Z',
          checksum: 'invalid-checksum-here',
        };
        mockStorage._storage.set(SecretKeys.TECH_STACK_REFRESH_COUNT, JSON.stringify(tampered));

        const result = await service.canUseRefresh();

        expect(result.canProceed).toBe(false);
        expect(result.reason).toBe('tampered');
      });
    });
  });

  describe('getRemainingRefreshes', () => {
    it('should return FREE_REFRESH_LIMIT for new users', async () => {
      const result = await service.getRemainingRefreshes();
      expect(result).toBe(FREE_REFRESH_LIMIT);
    });

    it('should return correct remaining count', async () => {
      const counter: RefreshCounter = {
        count: 2,
        firstUsedAt: '2024-01-01T00:00:00.000Z',
        lastUsedAt: '2024-01-01T00:00:00.000Z',
        checksum: service.computeChecksum(2, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z'),
      };
      mockStorage._storage.set(SecretKeys.TECH_STACK_REFRESH_COUNT, JSON.stringify(counter));

      const result = await service.getRemainingRefreshes();
      expect(result).toBe(1);
    });

    it('should return 0 for Pro users', async () => {
      mockStorage._storage.set(SecretKeys.PRO_LICENSE_KEY, 'valid-license-key');
      const result = await service.getRemainingRefreshes();
      expect(result).toBe(0);
    });
  });

  describe('showUpgradePrompt', () => {
    it('should show info message with upgrade options', async () => {
      const showInfoSpy = vi.spyOn(vscodeWindow, 'showInformationMessage')
        .mockResolvedValueOnce('Upgrade to Pro' as never);

      await service.showUpgradePrompt();

      expect(showInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('3 free tech stack refreshes'),
        'Upgrade to Pro',
        'Learn More',
        'Not Now'
      );
    });

    it('should return false when user selects Upgrade to Pro', async () => {
      vi.spyOn(vscodeWindow, 'showInformationMessage')
        .mockResolvedValueOnce('Upgrade to Pro' as never);

      const result = await service.showUpgradePrompt();

      // Returns false because user needs to complete purchase before proceeding
      expect(result).toBe(false);
    });

    it('should return false when user selects Learn More', async () => {
      vi.spyOn(vscodeWindow, 'showInformationMessage')
        .mockResolvedValueOnce('Learn More' as never);

      const result = await service.showUpgradePrompt();

      expect(result).toBe(false);
    });

    it('should return false when user selects Not Now', async () => {
      vi.spyOn(vscodeWindow, 'showInformationMessage')
        .mockResolvedValueOnce('Not Now' as never);

      const result = await service.showUpgradePrompt();

      expect(result).toBe(false);
    });

    it('should return false when user dismisses dialog', async () => {
      vi.spyOn(vscodeWindow, 'showInformationMessage')
        .mockResolvedValueOnce(undefined as never);

      const result = await service.showUpgradePrompt();

      expect(result).toBe(false);
    });
  });

  describe('formatRemainingMessage', () => {
    it('should format message for last free refresh', () => {
      const result = service.formatRemainingMessage(1);
      expect(result).toBe('This is your last free refresh.');
    });

    it('should format message for multiple remaining', () => {
      const result = service.formatRemainingMessage(2);
      expect(result).toBe('You have 2 free refreshes remaining.');
    });

    it('should format message for 3 remaining', () => {
      const result = service.formatRemainingMessage(3);
      expect(result).toBe('You have 3 free refreshes remaining.');
    });
  });

  describe('computeChecksum', () => {
    it('should return 16-character hex string', () => {
      const checksum = service.computeChecksum(1, '2024-01-01T00:00:00.000Z', '2024-01-15T00:00:00.000Z');

      expect(checksum).toHaveLength(16);
      expect(checksum).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should return different checksums for different counts', () => {
      const timestamp = '2024-01-01T00:00:00.000Z';
      const checksum1 = service.computeChecksum(1, timestamp, timestamp);
      const checksum2 = service.computeChecksum(2, timestamp, timestamp);

      expect(checksum1).not.toBe(checksum2);
    });

    it('should return same checksum for same inputs', () => {
      const checksum1 = service.computeChecksum(1, '2024-01-01T00:00:00.000Z', '2024-01-15T00:00:00.000Z');
      const checksum2 = service.computeChecksum(1, '2024-01-01T00:00:00.000Z', '2024-01-15T00:00:00.000Z');

      expect(checksum1).toBe(checksum2);
    });
  });

  describe('validateChecksum', () => {
    it('should return true for valid checksum', () => {
      const counter: RefreshCounter = {
        count: 2,
        firstUsedAt: '2024-01-01T00:00:00.000Z',
        lastUsedAt: '2024-01-15T00:00:00.000Z',
        checksum: service.computeChecksum(2, '2024-01-01T00:00:00.000Z', '2024-01-15T00:00:00.000Z'),
      };

      expect(service.validateChecksum(counter)).toBe(true);
    });

    it('should return false for invalid checksum', () => {
      const counter: RefreshCounter = {
        count: 2,
        firstUsedAt: '2024-01-01T00:00:00.000Z',
        lastUsedAt: '2024-01-15T00:00:00.000Z',
        checksum: 'invalid-checksum!',
      };

      expect(service.validateChecksum(counter)).toBe(false);
    });

    it('should detect modified count', () => {
      const originalChecksum = service.computeChecksum(2, '2024-01-01T00:00:00.000Z', '2024-01-15T00:00:00.000Z');
      const counter: RefreshCounter = {
        count: 0, // Tampered from 2
        firstUsedAt: '2024-01-01T00:00:00.000Z',
        lastUsedAt: '2024-01-15T00:00:00.000Z',
        checksum: originalChecksum,
      };

      expect(service.validateChecksum(counter)).toBe(false);
    });
  });

  describe('resetCounter', () => {
    it('should delete counter from SecretStorage', async () => {
      const counter: RefreshCounter = {
        count: 2,
        firstUsedAt: '2024-01-01T00:00:00.000Z',
        lastUsedAt: '2024-01-15T00:00:00.000Z',
        checksum: service.computeChecksum(2, '2024-01-01T00:00:00.000Z', '2024-01-15T00:00:00.000Z'),
      };
      mockStorage._storage.set(SecretKeys.TECH_STACK_REFRESH_COUNT, JSON.stringify(counter));

      await service.resetCounter();

      expect(mockStorage.delete).toHaveBeenCalledWith(SecretKeys.TECH_STACK_REFRESH_COUNT);
    });
  });

  describe('SecretKeys', () => {
    it('should define TECH_STACK_REFRESH_COUNT key', () => {
      expect(SecretKeys.TECH_STACK_REFRESH_COUNT).toBe('gitrx.pro.techStackRefreshCount');
    });

    it('should define PRO_LICENSE_KEY key', () => {
      expect(SecretKeys.PRO_LICENSE_KEY).toBe('gitrx.pro.licenseKey');
    });
  });
});
