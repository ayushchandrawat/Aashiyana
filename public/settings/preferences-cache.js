import { api } from '/api.js';

let pending = null;

export function resetPreferencesCache() {
  pending = null;
}

export function getPreferences() {
  if (!pending) {
    pending = api.get('/preferences')
      .then((response) => response?.data ?? {})
      .catch((error) => {
        pending = null;
        throw error;
      });
  }
  return pending;
}

export async function savePreferences(patch) {
  try {
    return await api.put('/preferences', patch);
  } finally {
    pending = null;
  }
}
