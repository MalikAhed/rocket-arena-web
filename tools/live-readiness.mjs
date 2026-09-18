import { waitForReady } from '../src/online/readiness.js';

// One bounded acceptance operation, not a keep-alive service. Use the same
// cold-start policy as the game, including retries after a request times out.
// Browser CORS and protocol/native-core checks remain mandatory at the caller.
export async function inspectLiveReadiness(serverUrl, origin, {
  fetchImpl = fetch, onAttempt = () => {}, ...options
} = {}) {
  let lastResponse = null;
  const health = await waitForReady(serverUrl, {
    ...options,
    fetchImpl: async (url, request) => {
      try {
        const response = await fetchImpl(url, {
          ...request, headers: { ...request.headers, Origin: origin },
        });
        lastResponse = { status: response.status, allowOrigin: response.headers.get('access-control-allow-origin') };
        onAttempt({ ...lastResponse });
        return response;
      } catch (error) {
        onAttempt({ error: error?.name || 'NetworkError' });
        throw error;
      }
    },
  });
  return { health, response: lastResponse };
}
