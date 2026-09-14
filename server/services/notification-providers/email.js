/**
 * Modul: Email Notification Provider
 * Zweck: Aashiyana Reminder-Payloads als Mail zustellen (#944).
 * Abhaengigkeiten: server/services/email.js, public/utils/html.js
 */
import { emailService as defaultEmailService } from '../email.js';
import { esc } from '../../../public/utils/html-escape.js';



// weiteren Header oeffnen - nodemailer kodiert zwar, aber die Zusicherung

function headerSafe(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function subjectFor(payload) {
  const title = headerSafe(payload?.title);
  const body = headerSafe(payload?.body);
  if (title && body && title !== body) return `${title}: ${body}`;
  return title || body || 'Aashiyana';
}

function absoluteUrl(payload, baseUrl) {
  const origin = String(baseUrl ?? '').trim().replace(/\/+$/, '');
  const path = String(payload?.url ?? '').trim();
  if (!origin || !path) return null;
  try {
    return new URL(path, `${origin}/`).toString();
  } catch {
    return null;
  }
}

function renderText(payload, link) {
  const lines = [String(payload?.body ?? '').trim() || 'Reminder'];
  if (link) lines.push('', link);
  return lines.join('\n');
}



// hier zusaetzlich, weil manche Clients HTML grosszuegig interpretieren.
function renderHtml(payload, link) {
  const body = esc(String(payload?.body ?? '').trim() || 'Reminder');
  const parts = [`<p>${body}</p>`];
  if (link) parts.push(`<p><a href="${esc(link)}">${esc(link)}</a></p>`);
  return parts.join('');
}

export const emailProvider = {
  id: 'email',

  isAvailable({ emailService = defaultEmailService } = {}) {
    return emailService.isConfigured();
  },

  async send({
    channel,
    payload,
    emailService = defaultEmailService,
    signal,
    env = process.env,
  } = {}) {
    const to = String(channel?.config?.toAddress ?? '').trim();
    if (!to) throw new Error('Email notification channel has no recipient address.');


    if (!emailService.isConfigured()) {
      throw new Error('Email is not configured. Set up SMTP in Settings before using an email channel.');
    }

    const link = absoluteUrl(payload, env.BASE_URL);
    const send = emailService.sendMail({
      to,
      subject: subjectFor(payload),
      text: renderText(payload, link),
      html: renderHtml(payload, link),


      logLabel: 'reminder notification',
    });






    //





    if (!signal) return send.then(() => ({ ok: true }));
    if (signal.aborted) throw new Error('Email delivery timed out.');
    return Promise.race([
      send.then(() => ({ ok: true })),
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Email delivery timed out.')), { once: true });
      }),
    ]);
  },
};

export default emailProvider;
