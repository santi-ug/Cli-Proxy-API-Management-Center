import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import axios from 'axios';
import { apiClient } from '@/services/api/client';
import { probeKeylessAccess } from '@/services/api/keylessProbe';
import { useAuthStore } from '@/stores/useAuthStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { useModelsStore } from '@/stores/useModelsStore';
import { useQuotaStore } from '@/stores/useQuotaStore';
import type { Config } from '@/types';

const spies: Array<{ mockRestore(): void }> = [];
const originalFetchConfig = useConfigStore.getState().fetchConfig;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const memory = new Map<string, string>();

beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { protocol: 'https:', hostname: 'pool.tailnet.invalid', port: '' },
      addEventListener: () => {},
      dispatchEvent: () => true,
    },
  });
});

afterAll(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

afterEach(() => {
  spies.splice(0).forEach((spy) => spy.mockRestore());
  useConfigStore.setState({ fetchConfig: originalFetchConfig });
  useAuthStore.getState().logout();
  memory.clear();
});

const respond = (status: number, data: unknown) => ({ status, data });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const otherGateway = {
  apiBase: 'https://other-gateway.invalid',
  managementKey: 'other-fixture',
  rememberPassword: true,
};

describe('probeKeylessAccess', () => {
  test('asks for the v8 config without an Authorization header', async () => {
    const get = spyOn(axios, 'get').mockResolvedValue(respond(200, { debug: false }));
    spies.push(get);
    expect(await probeKeylessAccess('https://pool.invalid')).toBe('granted');
    const [url, config] = get.mock.calls[0] ?? [];
    expect(url).toBe('https://pool.invalid/v8/management/config');
    expect(config?.headers).toBeUndefined();
  });

  test('401 and 403 mean the login flow applies; anything else is inconclusive', async () => {
    const get = spyOn(axios, 'get');
    spies.push(get);
    get.mockResolvedValueOnce(respond(401, { error: 'missing key' }));
    expect(await probeKeylessAccess('https://pool.invalid')).toBe('denied');
    get.mockResolvedValueOnce(respond(403, {}));
    expect(await probeKeylessAccess('https://pool.invalid')).toBe('denied');
    get.mockResolvedValueOnce(respond(200, '<html>login</html>'));
    expect(await probeKeylessAccess('https://pool.invalid')).toBe('unavailable');
    get.mockRejectedValueOnce(new Error('network down'));
    expect(await probeKeylessAccess('https://pool.invalid')).toBe('unavailable');
  });
});

describe('connectKeyless', () => {
  test('a trusting gateway signs in keyless without touching a stored key', async () => {
    useAuthStore.setState({ apiBase: 'https://pool.invalid', managementKey: 'stored-fixture' });
    spies.push(spyOn(axios, 'get').mockResolvedValue(respond(200, {})));
    const fetchConfig = spyOn(useConfigStore.getState(), 'fetchConfig').mockResolvedValue({});
    spies.push(fetchConfig);

    expect(await useAuthStore.getState().connectKeyless()).toBe(true);
    expect(fetchConfig).toHaveBeenCalledWith(true);
    expect(useAuthStore.getState()).toMatchObject({
      isAuthenticated: true,
      keyless: true,
      connectionStatus: 'connected',
      managementKey: 'stored-fixture',
    });
  });

  test('a gateway that wants a key is asked once per page load, then left to the login form', async () => {
    useAuthStore.setState({ apiBase: 'https://locked.invalid' });
    const get = spyOn(axios, 'get').mockResolvedValue(respond(401, {}));
    spies.push(get);
    const fetchConfig = spyOn(useConfigStore.getState(), 'fetchConfig');
    spies.push(fetchConfig);

    expect(await useAuthStore.getState().connectKeyless()).toBe(false);
    expect(await useAuthStore.getState().connectKeyless()).toBe(false);
    expect(get).toHaveBeenCalledTimes(1);
    expect(fetchConfig).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  test('without a stored base it probes the page origin', async () => {
    const get = spyOn(axios, 'get').mockResolvedValue(respond(403, {}));
    spies.push(get);
    await useAuthStore.getState().connectKeyless();
    expect(get.mock.calls[0]?.[0]).toBe('https://pool.tailnet.invalid/v8/management/config');
  });

  test('a key login clears the keyless flag', async () => {
    useAuthStore.setState({ keyless: true });
    spies.push(spyOn(useConfigStore.getState(), 'fetchConfig').mockResolvedValue({}));
    await useAuthStore.getState().login({
      apiBase: 'https://pool.invalid',
      managementKey: 'fixture-only',
      rememberPassword: false,
    });
    expect(useAuthStore.getState().keyless).toBe(false);
  });

  test('a probe completed after logout cannot restore the session or touch caches', async () => {
    const probe = deferred<ReturnType<typeof respond>>();
    spies.push(spyOn(axios, 'get').mockReturnValue(probe.promise));
    useAuthStore.setState({ apiBase: 'https://logout-probe.invalid' });
    const pending = useAuthStore.getState().connectKeyless();
    useAuthStore.getState().logout();
    const revision = apiClient.getConnectionRevision();
    const fetchConfig = spyOn(useConfigStore.getState(), 'fetchConfig').mockResolvedValue({});
    const clearConfig = spyOn(useConfigStore.getState(), 'clearCache');
    const clearModels = spyOn(useModelsStore.getState(), 'clearCache');
    const clearQuota = spyOn(useQuotaStore.getState(), 'clearQuotaCache');
    spies.push(fetchConfig, clearConfig, clearModels, clearQuota);

    probe.resolve(respond(200, {}));
    expect(await pending).toBe(false);
    expect(useAuthStore.getState()).toMatchObject({
      isAuthenticated: false,
      keyless: false,
      apiBase: '',
      connectionStatus: 'disconnected',
    });
    expect(apiClient.getConnectionRevision()).toBe(revision);
    expect(fetchConfig).not.toHaveBeenCalled();
    expect(clearConfig).not.toHaveBeenCalled();
    expect(clearModels).not.toHaveBeenCalled();
    expect(clearQuota).not.toHaveBeenCalled();
  });

  test('a probe completed after a keyed login cannot replace the newer gateway', async () => {
    const probe = deferred<ReturnType<typeof respond>>();
    spies.push(spyOn(axios, 'get').mockReturnValue(probe.promise));
    const fetchConfig = spyOn(useConfigStore.getState(), 'fetchConfig').mockResolvedValue({});
    spies.push(fetchConfig);
    useAuthStore.setState({ apiBase: 'https://old-probe.invalid' });
    const pending = useAuthStore.getState().connectKeyless();
    await useAuthStore.getState().login(otherGateway);
    const revision = apiClient.getConnectionRevision();

    probe.resolve(respond(200, {}));
    expect(await pending).toBe(false);
    expect(useAuthStore.getState()).toMatchObject({
      ...otherGateway,
      isAuthenticated: true,
      keyless: false,
      connectionStatus: 'connected',
    });
    expect(apiClient.getConnectionRevision()).toBe(revision);
    expect(fetchConfig).toHaveBeenCalledTimes(1);
    expect(memory.get('isLoggedIn')).toBe('true');
  });

  test.each(['resolve', 'reject'] as const)(
    'a stale keyless config %s cannot change the newer keyed session',
    async (outcome) => {
      const config = deferred<Config>();
      const started = deferred<void>();
      spies.push(spyOn(axios, 'get').mockResolvedValue(respond(200, {})));
      const fetchConfig = spyOn(useConfigStore.getState(), 'fetchConfig')
        .mockImplementationOnce(() => {
          started.resolve();
          return config.promise;
        })
        .mockResolvedValue({});
      spies.push(fetchConfig);
      useAuthStore.setState({ apiBase: `https://old-config-${outcome}.invalid` });
      const pending = useAuthStore.getState().connectKeyless();
      await started.promise;
      await useAuthStore.getState().login(otherGateway);
      const revision = apiClient.getConnectionRevision();

      if (outcome === 'resolve') config.resolve({});
      else config.reject(new Error('old gateway offline'));
      expect(await pending).toBe(false);
      expect(useAuthStore.getState()).toMatchObject({
        ...otherGateway,
        isAuthenticated: true,
        keyless: false,
        connectionStatus: 'connected',
      });
      expect(apiClient.getConnectionRevision()).toBe(revision);
    }
  );

  test('an obsolete probe cannot clear a newer in-flight keyless attempt', async () => {
    const oldProbe = deferred<ReturnType<typeof respond>>();
    const newProbe = deferred<ReturnType<typeof respond>>();
    const get = spyOn(axios, 'get')
      .mockReturnValueOnce(oldProbe.promise)
      .mockReturnValueOnce(newProbe.promise);
    spies.push(get, spyOn(useConfigStore.getState(), 'fetchConfig').mockResolvedValue({}));
    useAuthStore.setState({ apiBase: 'https://old-attempt.invalid' });
    const oldAttempt = useAuthStore.getState().connectKeyless();
    useAuthStore.getState().logout();
    useAuthStore.setState({ apiBase: 'https://new-attempt.invalid' });
    const newAttempt = useAuthStore.getState().connectKeyless();
    oldProbe.resolve(respond(200, {}));
    expect(await oldAttempt).toBe(false);
    expect(useAuthStore.getState().connectKeyless()).toBe(newAttempt);
    expect(get).toHaveBeenCalledTimes(2);
    newProbe.resolve(respond(200, {}));
    expect(await newAttempt).toBe(true);
    expect(useAuthStore.getState().apiBase).toBe('https://new-attempt.invalid');
  });
});

describe('asynchronous keyed authentication', () => {
  test('logout invalidates a pending keyed login', async () => {
    const config = deferred<Config>();
    spies.push(spyOn(useConfigStore.getState(), 'fetchConfig').mockReturnValue(config.promise));
    const login = useAuthStore.getState().login(otherGateway);
    useAuthStore.getState().logout();
    config.resolve({});
    await expect(login).rejects.toThrow('superseded');
    expect(useAuthStore.getState()).toMatchObject({
      isAuthenticated: false,
      connectionStatus: 'disconnected',
      apiBase: '',
    });
    expect(memory.has('isLoggedIn')).toBe(false);
  });

  test.each(['resolve', 'reject'] as const)(
    'a stale keyed login %s cannot change a newer login',
    async (outcome) => {
      const config = deferred<Config>();
      spies.push(
        spyOn(useConfigStore.getState(), 'fetchConfig')
          .mockReturnValueOnce(config.promise)
          .mockResolvedValue({})
      );
      const oldLogin = useAuthStore.getState().login({
        apiBase: 'https://old-keyed.invalid',
        managementKey: 'old-fixture',
        rememberPassword: false,
      });
      await useAuthStore.getState().login(otherGateway);
      if (outcome === 'resolve') config.resolve({});
      else config.reject(new Error('old gateway rejected login'));
      await expect(oldLogin).rejects.toThrow();
      expect(useAuthStore.getState()).toMatchObject({
        ...otherGateway,
        isAuthenticated: true,
        connectionStatus: 'connected',
      });
      expect(memory.get('isLoggedIn')).toBe('true');
    }
  );

  test.each(['resolve', 'reject'] as const)(
    'a pending stored-key check %s cannot change a newer login',
    async (outcome) => {
      const config = deferred<Config>();
      spies.push(
        spyOn(useConfigStore.getState(), 'fetchConfig')
          .mockReturnValueOnce(config.promise)
          .mockResolvedValue({})
      );
      useAuthStore.setState({
        apiBase: 'https://old-check.invalid',
        managementKey: 'old-fixture',
      });
      const check = useAuthStore.getState().checkAuth();
      await useAuthStore.getState().login(otherGateway);
      if (outcome === 'resolve') config.resolve({});
      else config.reject(new Error('old gateway rejected check'));
      expect(await check).toBe(false);
      expect(useAuthStore.getState()).toMatchObject({
        ...otherGateway,
        isAuthenticated: true,
        connectionStatus: 'connected',
      });
    }
  );

  test('logout invalidates a pending automatic session restoration', async () => {
    const config = deferred<Config>();
    spies.push(
      spyOn(useConfigStore.getState(), 'fetchConfig').mockReturnValue(config.promise),
      spyOn(console, 'warn').mockImplementation(() => {})
    );
    useAuthStore.setState(otherGateway);
    memory.set('isLoggedIn', 'true');
    const restore = useAuthStore.getState().restoreSession();
    useAuthStore.getState().logout();
    config.resolve({});
    expect(await restore).toBe(false);
    expect(useAuthStore.getState()).toMatchObject({
      isAuthenticated: false,
      connectionStatus: 'disconnected',
      apiBase: '',
    });
    expect(memory.has('isLoggedIn')).toBe(false);
  });

  test('an old restoration cannot clear the promise for a newer restoration', async () => {
    const oldConfig = deferred<Config>();
    const newConfig = deferred<Config>();
    const fetchConfig = spyOn(useConfigStore.getState(), 'fetchConfig')
      .mockReturnValueOnce(oldConfig.promise)
      .mockReturnValueOnce(newConfig.promise);
    spies.push(fetchConfig);
    useAuthStore.setState(otherGateway);
    memory.set('isLoggedIn', 'true');
    const oldRestore = useAuthStore.getState().restoreSession();
    useAuthStore.getState().logout();
    useAuthStore.setState(otherGateway);
    memory.set('isLoggedIn', 'true');
    const newRestore = useAuthStore.getState().restoreSession();

    oldConfig.resolve({});
    expect(await oldRestore).toBe(false);
    expect(useAuthStore.getState().restoreSession()).toBe(newRestore);
    expect(fetchConfig).toHaveBeenCalledTimes(2);
    newConfig.resolve({});
    expect(await newRestore).toBe(true);
    expect(useAuthStore.getState()).toMatchObject({
      ...otherGateway,
      isAuthenticated: true,
      connectionStatus: 'connected',
    });
  });
});
