import { test } from 'node:test';
import assert from 'node:assert/strict';

import { startTestServer } from './server-ready.js';

const { baseUrl } = await startTestServer({
  name: 'exit-code-fixture',
  env: { SESSION_SECRET: 'exit-code-fixture-secret-minimum-32c' },
});



const expected = Number(process.env.FIXTURE_EXPECT_STATUS || 401);

test('die Fixture erreicht den laufenden Server', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/me`);
  assert.equal(res.status, expected);
});
