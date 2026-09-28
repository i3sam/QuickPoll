export async function api(path, { method = 'GET', body, key } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers.Authorization = `Bearer ${key}`;

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw requestError("Can't reach QuickPoll. Check your connection and try again.", 0);
  }

  if (response.status === 204) return null;

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw requestError(data.error ?? 'Something went wrong. Try again.', response.status);
  return data;
}

function requestError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}
