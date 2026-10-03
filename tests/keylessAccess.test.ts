import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import axios from 'axios';
import { apiClient } from '@/services/api/client';
import { probeKeylessAccess } from '@/services/api/keylessProbe';
import { useAuthStore } from '@/stores/useAuthStore';
import { useConfigStore } from '@/stores/useConfigStore';

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
  apiClient.setConfig({ apiBase: '', managementKey: '' });
  useAuthStore.setState({
    isAuthenticated: false,
    keyless: false,
    apiBase: '',
    managementKey: '',
    connectionStatus: 'disconnected',
  });
});

const respond = (status: number, data: unknown) => ({ status, data });

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
});
