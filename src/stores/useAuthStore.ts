/**
 * 认证状态管理
 * 从原项目 src/modules/login.js 和 src/core/connection.js 迁移
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AuthState, LoginCredentials, ConnectionStatus } from '@/types';
import { STORAGE_KEY_AUTH } from '@/utils/constants';
import { obfuscatedStorage } from '@/services/storage/secureStorage';
import { apiClient } from '@/services/api/client';
import { LegacyBackendError, probeLegacyBackend } from '@/services/api/legacyBackendProbe';
import { probeKeylessAccess } from '@/services/api/keylessProbe';
import { useConfigStore } from './useConfigStore';
import { useModelsStore } from './useModelsStore';
import { useQuotaStore } from './useQuotaStore';
import { detectApiBaseFromLocation, normalizeApiBase } from '@/utils/connection';

interface AuthStoreState extends AuthState {
  connectionStatus: ConnectionStatus;
  /** Connected without a management key because the gateway trusts this network. */
  keyless: boolean;

  // 操作
  login: (credentials: LoginCredentials) => Promise<void>;
  /** Tries the gateway without a key; true when it let us in. Never touches a stored key. */
  connectKeyless: () => Promise<boolean>;
  logout: () => void;
  checkAuth: () => Promise<boolean>;
  restoreSession: () => Promise<boolean>;
  updateServerVersion: (version: string | null, buildDate?: string | null) => void;
  updateServerPluginSupport: (supportsPlugin: boolean) => void;
}

let restoreSessionPromise: Promise<boolean> | null = null;
let keylessPromise: Promise<boolean> | null = null;
/** Gateways that answered 401/403 to a keyless call: not asked again this page load. */
const keylessDeniedBases = new Set<string>();
let authGeneration = 0;

/** Every new session attempt owns its asynchronous work, even for the same gateway. */
function beginAuthAttempt(): number {
  authGeneration += 1;
  keylessPromise = null;
  restoreSessionPromise = null;
  return authGeneration;
}

function isCurrentAttempt(generation: number, connectionRevision: number): boolean {
  return generation === authGeneration && connectionRevision === apiClient.getConnectionRevision();
}

export const useAuthStore = create<AuthStoreState>()(
  persist(
    (set, get) => {
      const login = async (
        credentials: LoginCredentials,
        generation = beginAuthAttempt()
      ): Promise<void> => {
        const apiBase = normalizeApiBase(credentials.apiBase);
        const managementKey = credentials.managementKey.trim();
        const rememberPassword = credentials.rememberPassword ?? get().rememberPassword ?? false;

        let revision = apiClient.getConnectionRevision();

        try {
          set({
            connectionStatus: 'connecting',
            serverVersion: null,
            serverBuildDate: null,
            supportsPlugin: false,
          });
          useConfigStore.getState().clearCache();
          useModelsStore.getState().clearCache();
          useQuotaStore.getState().clearQuotaCache();

          // 配置 API 客户端
          apiClient.setConfig({
            apiBase,
            managementKey,
          });

          // 测试连接 - 获取配置。只在 v8 路由不存在时诊断旧版后端。
          revision = apiClient.getConnectionRevision();
          try {
            await useConfigStore.getState().fetchConfig(true);
          } catch (error) {
            if (
              isCurrentAttempt(generation, revision) &&
              typeof error === 'object' &&
              error !== null &&
              'status' in error &&
              error.status === 404 &&
              (await probeLegacyBackend(apiBase, managementKey)) &&
              isCurrentAttempt(generation, revision)
            ) {
              throw new LegacyBackendError();
            }
            throw error;
          }

          if (!isCurrentAttempt(generation, revision)) {
            throw new Error('Connection attempt was superseded.');
          }

          // 登录成功
          set({
            isAuthenticated: true,
            keyless: false,
            apiBase,
            managementKey,
            rememberPassword,
            connectionStatus: 'connected',
          });
          if (rememberPassword) {
            localStorage.setItem('isLoggedIn', 'true');
          } else {
            localStorage.removeItem('isLoggedIn');
          }
        } catch (error: unknown) {
          if (isCurrentAttempt(generation, revision)) {
            set({ connectionStatus: 'error' });
          }
          throw error;
        }
      };

      return {
        // 初始状态
        isAuthenticated: false,
        apiBase: '',
        managementKey: '',
        rememberPassword: false,
        serverVersion: null,
        serverBuildDate: null,
        supportsPlugin: false,
        connectionStatus: 'disconnected',
        keyless: false,

        connectKeyless: () => {
          if (get().isAuthenticated) return Promise.resolve(true);
          if (keylessPromise) return keylessPromise;

          const generation = beginAuthAttempt();
          const probeRevision = apiClient.getConnectionRevision();
          const pending: Promise<boolean> = (async () => {
            const apiBase = normalizeApiBase(get().apiBase || detectApiBaseFromLocation());
            if (!apiBase || keylessDeniedBases.has(apiBase)) return false;

            const probe = await probeKeylessAccess(apiBase);
            if (!isCurrentAttempt(generation, probeRevision)) return false;
            if (probe !== 'granted') {
              if (probe === 'denied') keylessDeniedBases.add(apiBase);
              return false;
            }

            set({
              connectionStatus: 'connecting',
              serverVersion: null,
              serverBuildDate: null,
              supportsPlugin: false,
            });
            useConfigStore.getState().clearCache();
            useModelsStore.getState().clearCache();
            useQuotaStore.getState().clearQuotaCache();
            apiClient.setConfig({ apiBase, managementKey: '' });
            const revision = apiClient.getConnectionRevision();

            try {
              await useConfigStore.getState().fetchConfig(true);
            } catch {
              if (!isCurrentAttempt(generation, revision)) return false;
              const { apiBase: storedBase, managementKey: storedKey } = get();
              apiClient.setConfig({ apiBase: storedBase, managementKey: storedKey });
              set({ connectionStatus: 'disconnected' });
              return false;
            }

            if (!isCurrentAttempt(generation, revision)) return false;
            set({ isAuthenticated: true, keyless: true, apiBase, connectionStatus: 'connected' });
            return true;
          })().finally(() => {
            if (keylessPromise === pending) keylessPromise = null;
          });
          keylessPromise = pending;

          return pending;
        },

        // 恢复会话并自动登录
        restoreSession: () => {
          if (restoreSessionPromise) return restoreSessionPromise;

          const generation = beginAuthAttempt();
          restoreSessionPromise = (async () => {
            obfuscatedStorage.migratePlaintextKeys(['apiBase', 'apiUrl', 'managementKey']);

            const wasLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
            const legacyBase =
              obfuscatedStorage.getItem<string>('apiBase') ||
              obfuscatedStorage.getItem<string>('apiUrl', { encrypt: true });
            const legacyKey = obfuscatedStorage.getItem<string>('managementKey');

            const { apiBase, managementKey, rememberPassword } = get();
            const resolvedBase = normalizeApiBase(
              apiBase || legacyBase || detectApiBaseFromLocation()
            );
            const resolvedKey = managementKey || legacyKey || '';
            const resolvedRememberPassword =
              rememberPassword || Boolean(managementKey) || Boolean(legacyKey);

            set({
              apiBase: resolvedBase,
              managementKey: resolvedKey,
              rememberPassword: resolvedRememberPassword,
            });
            apiClient.setConfig({ apiBase: resolvedBase, managementKey: resolvedKey });

            if (wasLoggedIn && resolvedBase && resolvedKey) {
              try {
                await login(
                  {
                    apiBase: resolvedBase,
                    managementKey: resolvedKey,
                    rememberPassword: resolvedRememberPassword,
                  },
                  generation
                );
                return generation === authGeneration;
              } catch (error) {
                if (generation === authGeneration) console.warn('Auto login failed:', error);
                return false;
              }
            }

            return false;
          })();

          return restoreSessionPromise;
        },

        login: (credentials) => login(credentials),

        // 登出
        logout: () => {
          beginAuthAttempt();
          apiClient.setConfig({ apiBase: '', managementKey: '' });
          useConfigStore.getState().clearCache();
          useModelsStore.getState().clearCache();
          useQuotaStore.getState().clearQuotaCache();
          set({
            isAuthenticated: false,
            keyless: false,
            apiBase: '',
            managementKey: '',
            serverVersion: null,
            serverBuildDate: null,
            supportsPlugin: false,
            connectionStatus: 'disconnected',
          });
          localStorage.removeItem('isLoggedIn');
        },

        // 检查认证状态
        checkAuth: async () => {
          const { managementKey, apiBase } = get();

          if (!managementKey || !apiBase) {
            return false;
          }

          const generation = beginAuthAttempt();
          let revision = apiClient.getConnectionRevision();

          try {
            // 重新配置客户端
            apiClient.setConfig({ apiBase, managementKey });
            revision = apiClient.getConnectionRevision();
            set({ supportsPlugin: false });

            // 验证连接
            await useConfigStore.getState().fetchConfig();
            if (!isCurrentAttempt(generation, revision)) return false;

            set({
              isAuthenticated: true,
              keyless: false,
              connectionStatus: 'connected',
            });

            return true;
          } catch {
            if (!isCurrentAttempt(generation, revision)) return false;
            set({
              isAuthenticated: false,
              connectionStatus: 'error',
              supportsPlugin: false,
            });
            return false;
          }
        },

        // 更新服务器版本
        updateServerVersion: (version, buildDate) => {
          set({
            serverVersion: version || null,
            serverBuildDate: buildDate || null,
          });
        },

        updateServerPluginSupport: (supportsPlugin) => {
          set({ supportsPlugin });
        },
      };
    },
    {
      name: STORAGE_KEY_AUTH,
      storage: createJSONStorage(() => ({
        getItem: (name) => {
          const data = obfuscatedStorage.getItem<AuthStoreState>(name);
          return data ? JSON.stringify(data) : null;
        },
        setItem: (name, value) => {
          obfuscatedStorage.setItem(name, JSON.parse(value));
        },
        removeItem: (name) => {
          obfuscatedStorage.removeItem(name);
        },
      })),
      partialize: (state) => ({
        apiBase: state.apiBase,
        ...(state.rememberPassword ? { managementKey: state.managementKey } : {}),
        rememberPassword: state.rememberPassword,
        serverVersion: state.serverVersion,
        serverBuildDate: state.serverBuildDate,
      }),
    }
  )
);

// 监听全局未授权事件
if (typeof window !== 'undefined') {
  window.addEventListener('unauthorized', () => {
    useAuthStore.getState().logout();
  });

  window.addEventListener('server-version-update', ((e: CustomEvent) => {
    const detail = e.detail || {};
    useAuthStore.getState().updateServerVersion(detail.version || null, detail.buildDate || null);
  }) as EventListener);

  window.addEventListener('server-plugin-support-update', ((e: CustomEvent) => {
    useAuthStore.getState().updateServerPluginSupport(e.detail?.supportsPlugin === true);
  }) as EventListener);
}
