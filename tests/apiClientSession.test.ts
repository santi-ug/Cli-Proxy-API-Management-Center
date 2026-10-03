import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { AxiosError, AxiosHeaders, type AxiosAdapter } from 'axios';
import { apiClient } from '@/services/api/client';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const events: Array<Event | CustomEvent<unknown>> = [];
const gatewayA = { apiBase: 'https://gateway-a.invalid', managementKey: 'fixture-a' };
const gatewayB = { apiBase: 'https://gateway-b.invalid', managementKey: 'fixture-b' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dispatchEvent: (event: Event | CustomEvent<unknown>) => {
        events.push(event);
        return true;
      },
    },
  });
});

afterAll(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

afterEach(() => {
  events.length = 0;
  apiClient.setConfig({ apiBase: '', managementKey: '' });
});

function deniedAdapter(gate: Promise<void>): AxiosAdapter {
  return async (config) => {
    await gate;
    throw new AxiosError('Key rejected', 'ERR_BAD_REQUEST', config, undefined, {
      data: { error: 'unauthorized' },
      status: 401,
      statusText: 'Unauthorized',
      headers: new AxiosHeaders(),
      config,
    });
  };
}

function versionAdapter(gate: Promise<void>): AxiosAdapter {
  return async (config) => {
    await gate;
    return {
      data: { debug: false },
      status: 200,
      statusText: 'OK',
      headers: new AxiosHeaders({
        'x-cpa-version': 'fixture-version',
        'x-cpa-build-date': 'fixture-build',
        'x-cpa-support-plugin': 'true',
      }),
      config,
    };
  };
}

describe('API client response ownership', () => {
  test('a current 401 still emits the unauthorized event', async () => {
    apiClient.setConfig(gatewayA);
    await expect(
      apiClient.get('/config', { adapter: deniedAdapter(Promise.resolve()) })
    ).rejects.toMatchObject({ status: 401 });
    expect(events.map((event) => event.type)).toEqual(['unauthorized']);
  });

  test.each(['switch', 'logout', 'switch-back'])(
    'an old 401 after %s cannot log out the current session',
    async (change) => {
      const gate = deferred<void>();
      apiClient.setConfig(gatewayA);
      const pending = apiClient.get('/config', { adapter: deniedAdapter(gate.promise) });
      if (change === 'logout') apiClient.setConfig({ apiBase: '', managementKey: '' });
      else {
        apiClient.setConfig(gatewayB);
        if (change === 'switch-back') apiClient.setConfig(gatewayA);
      }
      gate.resolve();
      await expect(pending).rejects.toMatchObject({ status: 401 });
      expect(events).toEqual([]);
    }
  );

  test('current metadata still updates the server version and plugin support', async () => {
    apiClient.setConfig(gatewayA);
    await apiClient.get('/config', { adapter: versionAdapter(Promise.resolve()) });
    expect(events.map((event) => event.type)).toEqual([
      'server-version-update',
      'server-plugin-support-update',
    ]);
  });

  test('metadata from a replaced session cannot update the current gateway', async () => {
    const gate = deferred<void>();
    apiClient.setConfig(gatewayA);
    const pending = apiClient.get('/config', { adapter: versionAdapter(gate.promise) });
    apiClient.setConfig(gatewayB);
    gate.resolve();
    expect(await pending).toEqual({ debug: false });
    expect(events).toEqual([]);
  });

  test('a request keeps its gateway and key when the session changes immediately afterward', async () => {
    const gate = deferred<void>();
    const requests: Array<{ baseURL?: string; authorization: unknown }> = [];
    const adapter: AxiosAdapter = async (config) => {
      requests.push({ baseURL: config.baseURL, authorization: config.headers.Authorization });
      await gate.promise;
      return { data: {}, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config };
    };
    apiClient.setConfig(gatewayA);
    const pending = apiClient.get('/config', { adapter });
    apiClient.setConfig(gatewayB);
    gate.resolve();
    await pending;
    expect(requests).toEqual([
      {
        baseURL: 'https://gateway-a.invalid/v8/management',
        authorization: 'Bearer fixture-a',
      },
    ]);
  });
});
