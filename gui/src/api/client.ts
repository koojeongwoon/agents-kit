let apiTokenPromise: Promise<string> | null = null;

export function resolveApiInput(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input === 'string' && input.startsWith('/api/') && '__TAURI_INTERNALS__' in window) {
    return `http://127.0.0.1:3710${input}`;
  }
  return input;
}

export async function getApiToken(): Promise<string> {
  if (!apiTokenPromise) {
    apiTokenPromise = fetchWithStartupRetry(resolveApiInput('/api/session'))
      .then(async response => {
        if (!response.ok) throw new Error('Failed to initialize GUI API session');
        const data = await response.json();
        return data.token;
      })
      .catch(error => {
        apiTokenPromise = null;
        throw error;
      });
  }
  return apiTokenPromise;
}

export async function fetchWithStartupRetry(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const attempts = '__TAURI_INTERNALS__' in window ? 30 : 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await window.fetch(input, init);
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await new Promise(resolve => window.setTimeout(resolve, 100));
    }
  }
  throw lastError;
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const resolvedInput = resolveApiInput(input);
  const method = (init.method || 'GET').toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return await fetchWithStartupRetry(resolvedInput, init);

  const headers = new Headers(init.headers);
  headers.set('X-Agents-Kit-Token', await getApiToken());
  return await fetchWithStartupRetry(resolvedInput, { ...init, headers });
}
