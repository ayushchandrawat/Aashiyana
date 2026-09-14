
import { guardedFetch } from './guarded-fetch.js';

export const WEBHOOK_TEMPLATE_PLACEHOLDERS = Object.freeze(['title', 'body', 'url', 'tag']);






const PLACEHOLDER_PATTERN = /\{\{(\w+)\}\}/g;
const PLACEHOLDER_SHAPED_PATTERN = /\{\{([^{}]*)\}\}/g;

export function renderPayloadTemplate(template, payload = {}) {
  return String(template).replace(PLACEHOLDER_PATTERN, (match, key) => {
    if (!WEBHOOK_TEMPLATE_PLACEHOLDERS.includes(key)) return match;
    const value = payload?.[key];
    if (value === null || value === undefined) return '';
    return JSON.stringify(String(value)).slice(1, -1);
  });
}

export function unknownTemplatePlaceholders(template) {
  const unknown = new Set();
  for (const [, key] of String(template).matchAll(PLACEHOLDER_SHAPED_PATTERN)) {
    if (!WEBHOOK_TEMPLATE_PLACEHOLDERS.includes(key)) unknown.add(key);
  }
  return [...unknown];
}

function httpError(status) {
  if (status === 401 || status === 403) return new Error('Webhook authentication failed.');
  if (status === 404) return new Error('Webhook endpoint was not found.');
  return new Error(`Webhook returned HTTP ${status}`);
}

export const webhookProvider = {
  id: 'webhook',

  async send({ channel, payload, fetchImpl = guardedFetch, signal } = {}) {
    const headers = { 'content-type': 'application/json' };
    const token = String(channel?.secrets?.token ?? '');
    if (token) headers.authorization = `Bearer ${token}`;

    const template = String(channel?.config?.payloadTemplate ?? '').trim();
    const body = template
      ? renderPayloadTemplate(template, payload)
      : JSON.stringify({
        event: 'notification',
        notification: payload,
        sentAt: new Date().toISOString(),
      });

    const response = await fetchImpl(channel.config.baseUrl, {
      method: 'POST',
      headers,
      body,
      signal,
    });
    if (!response.ok) throw httpError(response.status);
    return { ok: true, status: response.status };
  },
};

export default webhookProvider;
