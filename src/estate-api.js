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
