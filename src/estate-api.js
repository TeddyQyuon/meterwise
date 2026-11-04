export class RequestError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function estateApi(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'same-origin',
    signal: options.signal ?? AbortSignal.timeout(45000),
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new RequestError('MeterWise is temporarily unavailable. Try again shortly.', response.status);
  }
  if (!response.ok) throw new RequestError(data.error ?? 'This action could not be completed.', response.status);
  return data;
}

export const postEstate = (body) => ({ method: 'POST', body: JSON.stringify(body) });

// Share only the in-flight bootstrap, never authenticated data across visits.
// React StrictMode remounts effects in development; it must not create two workspaces.
let bootstrapRequest;
export function bootstrapEstate() {
  if (!bootstrapRequest) {
    bootstrapRequest = estateApi('/session?view=estate&bootstrap=1')
      .catch(error => {
        if (!(error instanceof RequestError) || error.status !== 401) throw error;
        return estateApi('/session?view=estate&bootstrap=1', postEstate({role:'manager'}));
      }).finally(() => { bootstrapRequest = undefined; });
  }
  return bootstrapRequest;
}
