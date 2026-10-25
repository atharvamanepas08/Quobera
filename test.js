/**
 * MoneyGuru Automated Test Suite
 * Built with Node.js built-in test runner (node:test and node:assert)
 * Zero external testing libraries required.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const TEST_PORT = 4199;
const TEST_JWT_SECRET = 'test_jwt_secret_moneyguru_suite_key_32c';
const TEST_ADMIN_KEY = 'test_admin_key_moneyguru_suite';
const TEST_TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'moneyguru-test-'));

let serverProcess;

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.headers || {}),
      },
    };

    const req = http.request(reqOptions, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { json = null; }
        resolve({ status: res.statusCode, headers: res.headers, body: json, raw: data });
      });
    });

    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

test.before(async () => {
  // Start server with isolated test environment
  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      JWT_SECRET: TEST_JWT_SECRET,
      ADMIN_KEY: TEST_ADMIN_KEY,
      DB_DIR: TEST_TMP_DIR,
    },
    stdio: 'pipe',
  });

  // Wait for server to respond on /health
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await request('/health');
      if (res.status === 200) { ready = true; break; }
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  if (!ready) throw new Error('Test server failed to start within 3 seconds');
});

test.after(() => {
  if (serverProcess) {
    serverProcess.kill();
  }
  try {
    fs.rmSync(TEST_TMP_DIR, { recursive: true, force: true });
  } catch {}
});

/* ── 1. AUTHENTICATION & TOKEN VALIDATION ──────────────────────── */

test('Auth: Health check endpoint responds ok', async () => {
  const res = await request('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.status, 'ok');
});

test('Auth: Rejects signup with missing fields', async () => {
  const res = await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'incomplete@example.com' },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
});

test('Auth: Successful signup returns 201, user profile, and valid token', async () => {
  const res = await request('/api/auth/signup', {
    method: 'POST',
    body: {
      firstName: 'TestUser1',
      lastName: 'Finance',
      email: 'user1@example.com',
      password: 'password123',
      monthlyIncome: 60000,
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  assert.ok(res.body.token);
  assert.equal(res.body.user.email, 'user1@example.com');
  assert.equal(res.body.user.passwordHash, undefined); // Never leaked
});

test('Auth: Rejects duplicate email registration', async () => {
  const res = await request('/api/auth/signup', {
    method: 'POST',
    body: {
      firstName: 'Duplicate',
      lastName: 'User',
      email: 'user1@example.com',
      password: 'password123',
      monthlyIncome: 45000,
    },
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.success, false);
});

test('Auth: Signin with incorrect password returns 401', async () => {
  const res = await request('/api/auth/signin', {
    method: 'POST',
    body: { email: 'user1@example.com', password: 'wrongPassword' },
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.success, false);
});

test('Auth: Signin with correct credentials returns token', async () => {
  const res = await request('/api/auth/signin', {
    method: 'POST',
    body: { email: 'user1@example.com', password: 'password123' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(res.body.token);
});

test('Auth: Protected route /api/auth/me rejects missing or invalid token', async () => {
  const noToken = await request('/api/auth/me');
  assert.equal(noToken.status, 401);

  const badToken = await request('/api/auth/me', { token: 'invalid.jwt.token' });
  assert.equal(badToken.status, 401);
});

/* ── 2. USER DATA ISOLATION ────────────────────────────────────── */

test('Isolation: User data is completely segregated between accounts', async () => {
  // Sign in User 1
  const u1Auth = await request('/api/auth/signin', {
    method: 'POST',
    body: { email: 'user1@example.com', password: 'password123' },
  });
  const u1Token = u1Auth.body.token;

  // User 1 adds a transaction
  const u1Txn = await request('/api/transactions', {
    method: 'POST',
    token: u1Token,
    body: {
      type: 'expense',
      description: 'Private Book Purchase',
      category: 'shopping',
      amount: 450,
      date: '2026-10-15',
    },
  });
  assert.equal(u1Txn.status, 201);
  const txnId = u1Txn.body.transaction.id;

  // User 1 creates a goal
  const u1Goal = await request('/api/goals', {
    method: 'POST',
    token: u1Token,
    body: { name: 'Trip to Tokyo', targetAmount: 150000, timelineMonths: 12 },
  });
  assert.equal(u1Goal.status, 201);
  const goalId = u1Goal.body.goal.id;

  // Register User 2
  const u2Signup = await request('/api/auth/signup', {
    method: 'POST',
    body: {
      firstName: 'TestUser2',
      lastName: 'Savings',
      email: 'user2@example.com',
      password: 'password456',
      monthlyIncome: 70000,
    },
  });
  const u2Token = u2Signup.body.token;

  // User 2 lists transactions -> Should see 0 transactions
  const u2Txns = await request('/api/transactions', { token: u2Token });
  assert.equal(u2Txns.status, 200);
  assert.equal(u2Txns.body.total, 0);
  assert.deepEqual(u2Txns.body.transactions, []);

  // User 2 attempts to delete User 1's transaction -> Should fail with 404
  const u2DelTxn = await request(`/api/transactions/${txnId}`, {
    method: 'DELETE',
    token: u2Token,
  });
  assert.equal(u2DelTxn.status, 404);

  // User 2 attempts to delete User 1's goal -> Should fail with 404
  const u2DelGoal = await request(`/api/goals/${goalId}`, {
    method: 'DELETE',
    token: u2Token,
  });
  assert.equal(u2DelGoal.status, 404);
});

/* ── 3. INPUT VALIDATION (TRANSACTIONS & SAVINGS) ──────────────── */

test('Validation: Rejects invalid transaction amounts and categories', async () => {
  const u1Auth = await request('/api/auth/signin', {
    method: 'POST',
    body: { email: 'user1@example.com', password: 'password123' },
  });
  const token = u1Auth.body.token;

  // Negative amount
  const neg = await request('/api/transactions', {
    method: 'POST',
    token,
    body: { type: 'expense', description: 'Test', category: 'food', amount: -50, date: '2026-10-10' },
  });
  assert.equal(neg.status, 400);

  // Zero amount
  const zero = await request('/api/transactions', {
    method: 'POST',
    token,
    body: { type: 'expense', description: 'Test', category: 'food', amount: 0, date: '2026-10-10' },
  });
  assert.equal(zero.status, 400);

  // Invalid category
  const badCat = await request('/api/transactions', {
    method: 'POST',
    token,
    body: { type: 'expense', description: 'Test', category: 'cryptocurrency', amount: 500, date: '2026-10-10' },
  });
  assert.equal(badCat.status, 400);
});

test('Validation: Rejects invalid goal deposit amounts', async () => {
  const u1Auth = await request('/api/auth/signin', {
    method: 'POST',
    body: { email: 'user1@example.com', password: 'password123' },
  });
  const token = u1Auth.body.token;

  const goal = await request('/api/goals', {
    method: 'POST',
    token,
    body: { name: 'Laptop Fund', targetAmount: 60000, timelineMonths: 6 },
  });
  const goalId = goal.body.goal.id;

  // Non-numeric deposit
  const badDeposit = await request(`/api/goals/${goalId}/deposit`, {
    method: 'PATCH',
    token,
    body: { amount: 'invalid-string' },
  });
  assert.equal(badDeposit.status, 400);

  // Negative deposit
  const negDeposit = await request(`/api/goals/${goalId}/deposit`, {
    method: 'PATCH',
    token,
    body: { amount: -100 },
  });
  assert.equal(negDeposit.status, 400);
});

/* ── 4. CASHFLOW CALCULATION EDGE CASES ────────────────────────── */

test('Cashflow: Computes cashflow projection safely', async () => {
  const u1Auth = await request('/api/auth/signin', {
    method: 'POST',
    body: { email: 'user1@example.com', password: 'password123' },
  });
  const token = u1Auth.body.token;

  const res = await request('/api/cashflow', { token });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(res.body.cashflow);
  assert.equal(typeof res.body.cashflow.daysRunway, 'number');
  assert.ok(!isNaN(res.body.cashflow.daysRunway));
  assert.ok(res.body.cashflow.daysRunway >= 0);
});

/* ── 5. PIGGY-BANK CONSTRAINTS ─────────────────────────────────── */

test('Piggy: Confirms first deposit and rejects duplicate monthly deposit', async () => {
  const u1Auth = await request('/api/auth/signin', {
    method: 'POST',
    body: { email: 'user1@example.com', password: 'password123' },
  });
  const token = u1Auth.body.token;

  // First deposit this month should succeed
  const firstDep = await request('/api/piggy/deposit', { method: 'POST', token });
  assert.equal(firstDep.status, 200);
  assert.equal(firstDep.body.success, true);
  assert.equal(firstDep.body.newStreakMonths, 1);

  // Immediate second deposit in the same month must fail with 409
  const dupDep = await request('/api/piggy/deposit', { method: 'POST', token });
  assert.equal(dupDep.status, 409);
  assert.equal(dupDep.body.success, false);
});

test('Piggy: Validates commitment percentage bounds', async () => {
  const u1Auth = await request('/api/auth/signin', {
    method: 'POST',
    body: { email: 'user1@example.com', password: 'password123' },
  });
  const token = u1Auth.body.token;

  // Below minimum (< 1%)
  const low = await request('/api/piggy/commitment', {
    method: 'PATCH',
    token,
    body: { commitPct: 0 },
  });
  assert.equal(low.status, 400);

  // Above maximum (> 80%)
  const high = await request('/api/piggy/commitment', {
    method: 'PATCH',
    token,
    body: { commitPct: 85 },
  });
  assert.equal(high.status, 400);

  // Valid commitPct (30%)
  const valid = await request('/api/piggy/commitment', {
    method: 'PATCH',
    token,
    body: { commitPct: 30 },
  });
  assert.equal(valid.status, 200);
  assert.equal(valid.body.piggyBank.commitPct, 30);
});

/* ── 6. 15-DAY CHALLENGE DEPOSIT LIMITS ────────────────────────── */

test('Challenge: Enforces target and deposit minimums', async () => {
  const u1Auth = await request('/api/auth/signin', {
    method: 'POST',
    body: { email: 'user1@example.com', password: 'password123' },
  });
  const token = u1Auth.body.token;

  // Below minimum target amount (₹500)
  const lowTarget = await request('/api/challenge/join', {
    method: 'POST',
    token,
    body: { targetAmount: 200 },
  });
  assert.equal(lowTarget.status, 400);

  // Valid target join
  const join = await request('/api/challenge/join', {
    method: 'POST',
    token,
    body: { targetAmount: 2000 },
  });
  assert.equal(join.status, 201);

  // Deposit below ₹500
  const lowDep = await request('/api/challenge/deposit', {
    method: 'POST',
    token,
    body: { amount: 100 },
  });
  assert.equal(lowDep.status, 400);

  // Valid deposit of ₹500
  const okDep = await request('/api/challenge/deposit', {
    method: 'POST',
    token,
    body: { amount: 500 },
  });
  assert.equal(okDep.status, 200);
  assert.equal(okDep.body.newTotal, 500);
});

/* ── 7. ADMIN SECURITY ─────────────────────────────────────────── */

test('Admin: Requires correct secret key', async () => {
  const noKey = await request('/api/admin/users');
  assert.equal(noKey.status, 403);

  const badKey = await request('/api/admin/users?key=wrong_key');
  assert.equal(badKey.status, 403);

  const okKey = await request(`/api/admin/users?key=${TEST_ADMIN_KEY}`);
  assert.equal(okKey.status, 200);
  assert.equal(okKey.body.success, true);
  assert.ok(Array.isArray(okKey.body.users));
  // Verify passwordHash is never returned in admin listing
  okKey.body.users.forEach(u => {
    assert.equal(u.passwordHash, undefined);
  });
});

/* ── 8. PASSWORD HASHING (scrypt + legacy HMAC) ─────────────────── */

function readTestUsers() {
  return JSON.parse(fs.readFileSync(path.join(TEST_TMP_DIR, 'users.json'), 'utf8'));
}

test('Auth: New signups store parameterized scrypt password hashes', async () => {
  const users = readTestUsers();
  const user1 = users.find(u => u.email === 'user1@example.com');
  assert.ok(user1);
  assert.match(user1.passwordHash, /^scrypt:16384:8:1:[0-9a-f]+:[0-9a-f]+$/i);
});

test('Auth: Legacy salt:HMAC-SHA256 accounts can still sign in', async () => {
  const salt = crypto.randomBytes(16).toString('hex');
  const password = 'legacyPass123';
  const hmac = crypto.createHmac('sha256', salt).update(password).digest('hex');
  const users = readTestUsers();
  users.push({
    id: 'usr_legacy_hmac_01',
    firstName: 'Legacy',
    lastName: 'Account',
    email: 'legacy-hmac@example.com',
    passwordHash: `${salt}:${hmac}`,
    monthlyIncome: 40000,
    role: 'user',
    createdAt: new Date().toISOString(),
  });
  fs.writeFileSync(path.join(TEST_TMP_DIR, 'users.json'), JSON.stringify(users, null, 2));

  const wrong = await request('/api/auth/signin', {
    method: 'POST',
    body: { email: 'legacy-hmac@example.com', password: 'not-the-password' },
  });
  assert.equal(wrong.status, 401);

  const okSignin = await request('/api/auth/signin', {
    method: 'POST',
    body: { email: 'legacy-hmac@example.com', password },
  });
  assert.equal(okSignin.status, 200);
  assert.ok(okSignin.body.token);

  const upgraded = readTestUsers().find(u => u.email === 'legacy-hmac@example.com');
  assert.ok(upgraded);
  assert.match(upgraded.passwordHash, /^scrypt:16384:8:1:[0-9a-f]+:[0-9a-f]+$/i);
});
