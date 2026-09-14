import { after } from 'node:test';
import { once } from 'node:events';

import { freshTestDbPath } from './tmp-db.js';

export async function startTestServer({ name, env = {} } = {}) {


  const dbPath = freshTestDbPath(name);

  process.env.SESSION_SECURE = 'false';



  process.env.PORT = '0';


  process.env.BACKUP_ENABLED = 'false';
  for (const [key, value] of Object.entries(env)) process.env[key] = String(value);

  const { default: app, server } = await import('../server/index.js');



  if (!server.listening) {
    await Promise.race([
      once(server, 'listening'),
      once(server, 'error').then(([err]) => { throw err; }),
    ]);
  }

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  after(async () => {


    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  });

  return { baseUrl, app, server, dbPath };
}

export function cookieHeader(setCookie) {
  return String(setCookie || '')
    .split(/,(?=\s*[^;,]+=)/)
    .map((cookie) => cookie.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}
