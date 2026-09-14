
import { api } from '/api.js';

let cached = null;

export async function loadFamilyUsers() {
  if (cached) return cached;
  try {
    cached = (await api.get('/auth/users')).data ?? [];
    return cached;
  } catch {
    return [];
  }
}
