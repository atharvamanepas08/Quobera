/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║              MONEYGURU  —  BACKEND SERVER                ║
 * ║                                                          ║
 * ║  Runtime  : Node.js 18+  (zero npm packages)            ║
 * ║  Database : JSON flat-files  (db/ directory)            ║
 * ║  Auth     : scrypt passwords + HMAC JWT (built-in crypto)║
 * ║  Port     : 4000  (or set PORT env var)                 ║
 * ║                                                          ║
 * ║  Start    : node server.js                              ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * ══ API ROUTES ══════════════════════════════════════════════
 *
 *  POST   /api/auth/signup            Register new user
 *  POST   /api/auth/signin            Sign in, get token
 *  GET    /api/auth/me                Current user profile
 *
 *  GET    /api/transactions           List user's transactions
 *  POST   /api/transactions           Add transaction
 *  DELETE /api/transactions/:id       Delete transaction
 *
 *  GET    /api/goals                  List user's goals
 *  POST   /api/goals                  Create new goal
 *  PATCH  /api/goals/:id/deposit      Add savings to a goal
 *  DELETE /api/goals/:id              Delete a goal
 *
 *  GET    /api/piggy                  Get piggy bank status
 *  POST   /api/piggy/deposit          Confirm monthly deposit
 *  PATCH  /api/piggy/commitment       Update commit %
 *
 *  GET    /api/emi/eligibility        Check EMI eligibility
 *  POST   /api/emi/apply              Submit EMI application
 *  GET    /api/emi/applications       List user's EMI apps
 *
 *  GET    /api/challenge              Active challenge info
 *  POST   /api/challenge/join         Join current challenge
 *  POST   /api/challenge/deposit      Add challenge deposit
 *  GET    /api/challenge/leaderboard  Live leaderboard
 *
 *  GET    /api/cashflow               Cashflow prediction
 *
 *  GET    /api/admin/users            ⚠ ALL users + stats  (requires ?key=)
 *  GET    /api/admin/users/:id        ⚠ Single user full data
 *
 *  GET    /health                     Health check
 */

'use strict';

const http   = require('http');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const url    = require('url');

/* ═══════════════════════════════════════════════════════════
   CONFIG & ENVIRONMENT
═══════════════════════════════════════════════════════════ */
// Load local .env file if present (pure Node.js, zero dependencies)
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  const envContent = fs.readFileSync(envFile, 'utf8');
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

const PORT        = process.env.PORT        || 4000;
const JWT_SECRET  = process.env.JWT_SECRET;
const ADMIN_KEY   = process.env.ADMIN_KEY;
const DB_DIR      = process.env.DB_DIR      || path.join(__dirname, 'db');
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

if (!JWT_SECRET || !ADMIN_KEY) {
  console.error('\n[FATAL ERROR] Missing required environment variables:');
  if (!JWT_SECRET) console.error('  - JWT_SECRET is required to sign and verify authentication tokens.');
  if (!ADMIN_KEY) console.error('  - ADMIN_KEY is required to secure administrative endpoints.');
  console.error('\nPlease copy .env.example to .env and configure these secrets before running MoneyGuru.\n');
  process.exit(1);
}

/* ═══════════════════════════════════════════════════════════
   JSON FLAT-FILE DATABASE
═══════════════════════════════════════════════════════════ */
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const COLLECTIONS = [
  'users', 'transactions', 'goals', 'piggy',
  'emi_applications', 'challenge_participants',
  'challenge_deposits', 'challenges',
];

// Ensure every collection file exists (init empty array)
COLLECTIONS.forEach(name => {
  const fp = path.join(DB_DIR, `${name}.json`);
  if (!fs.existsSync(fp)) fs.writeFileSync(fp, '[]');
});

function readCollection(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DB_DIR, `${name}.json`), 'utf8'));
  } catch { return []; }
}

function writeCollection(name, data) {
  fs.writeFileSync(
    path.join(DB_DIR, `${name}.json`),
    JSON.stringify(data, null, 2),
  );
}

function findOne(name, predFn) {
  return readCollection(name).find(predFn) || null;
}

function insertOne(name, doc) {
  const col = readCollection(name);
  col.push(doc);
  writeCollection(name, col);
  return doc;
}

function updateOne(name, predFn, updaterFn) {
  const col = readCollection(name);
  const idx = col.findIndex(predFn);
  if (idx === -1) return null;
  col[idx] = { ...col[idx], ...updaterFn(col[idx]) };
  writeCollection(name, col);
  return col[idx];
}

function deleteOne(name, predFn) {
  const col = readCollection(name);
  const idx = col.findIndex(predFn);
  if (idx === -1) return false;
  col.splice(idx, 1);
  writeCollection(name, col);
  return true;
}

/* ═══════════════════════════════════════════════════════════
   CRYPTO  (no external deps — Node.js built-in only)
═══════════════════════════════════════════════════════════ */
const uid = () => crypto.randomBytes(8).toString('hex');

/** New passwords: scrypt with a random salt. Legacy records: salt:HMAC-SHA256. */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SCRYPT_SALT_BYTES = 16;

function timingSafeHexEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length === 0 || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function hashPassword(plain) {
  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES);
  const key = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString('hex')}:${key.toString('hex')}`;
}

function verifyPassword(plain, stored) {
  if (!plain || typeof stored !== 'string') return false;
  const parts = stored.split(':');

  if (parts[0] === 'scrypt' && parts.length === 6) {
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4], 'hex');
    const expectedHex = parts[5];
    const keylen = expectedHex.length / 2;
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || salt.length === 0 || keylen < 16) {
      return false;
    }
    try {
      const key = crypto.scryptSync(plain, salt, keylen, { N, r, p });
      return timingSafeHexEqual(key.toString('hex'), expectedHex);
    } catch {
      return false;
    }
  }

  // Backward-compatible verification for existing local HMAC-SHA256 hashes.
  if (parts.length === 2 && parts[0] && parts[1]) {
    const attempt = crypto.createHmac('sha256', parts[0]).update(plain).digest('hex');
    return timingSafeHexEqual(attempt, parts[1]);
  }

  return false;
}

function maybeUpgradePasswordHash(user, plain) {
  if (!user?.id || typeof user.passwordHash !== 'string') return;
  if (user.passwordHash.startsWith('scrypt:')) return;
  updateOne('users', u => u.id === user.id, () => ({ passwordHash: hashPassword(plain) }));
}

/** Minimal HS256 JWT */
const b64url = s => Buffer.from(s).toString('base64url');

function signToken(payload, expiresInSeconds = 7 * 24 * 3600) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = b64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + expiresInSeconds }));
  const sig    = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  try {
    const [header, body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload.exp < Math.floor(Date.now() / 1000) ? null : payload;
  } catch { return null; }
}

/* ═══════════════════════════════════════════════════════════
   HTTP HELPERS
═══════════════════════════════════════════════════════════ */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  CORS_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(JSON.stringify(data));
}
const ok  = (res, data, s = 200)   => send(res, s, { success: true,  ...data });
const err = (res, s, msg, extra={}) => send(res, s, { success: false, message: msg, ...extra });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 2e6) req.destroy(); });
    req.on('end',  () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

/** Extract & verify Bearer token → returns payload or sends 401 */
function requireAuth(req, res) {
  const auth  = (req.headers['authorization'] || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) { err(res, 401, 'Missing Authorization header'); return null; }
  const payload = verifyToken(token);
  if (!payload) { err(res, 401, 'Token is invalid or expired'); return null; }
  return payload;
}

/** Verify admin key query-param */
function requireAdmin(req, res) {
  const q = new url.URL(req.url, 'http://x').searchParams;
  if (q.get('key') !== ADMIN_KEY) { err(res, 403, 'Invalid admin key — pass ?key=<ADMIN_KEY>'); return false; }
  return true;
}

/** Match a URL pattern like /api/goals/:id → { id: '...' } | null */
function matchPath(reqPath, pattern) {
  const rp = reqPath.split('/');
  const pp = pattern.split('/');
  if (rp.length !== pp.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(rp[i]);
    else if (pp[i] !== rp[i]) return null;
  }
  return params;
}

/* ═══════════════════════════════════════════════════════════
   VALIDATION
═══════════════════════════════════════════════════════════ */
const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e));

const VALID_CAT = ['food','shopping','transport','entertainment','utilities','health','income','other'];

function validateTxn(b) {
  const e = [];
  if (!['income','expense'].includes(b.type))           e.push('type must be "income" or "expense"');
  if (!b.description?.trim())                           e.push('description is required');
  if (!b.amount || isNaN(+b.amount) || +b.amount <= 0) e.push('amount must be a positive number');
  if (!VALID_CAT.includes(b.category))                  e.push(`category must be one of: ${VALID_CAT.join(', ')}`);
  if (!b.date || isNaN(Date.parse(b.date)))             e.push('date must be a valid ISO date (YYYY-MM-DD)');
  return e;
}

function validateGoal(b) {
  const e = [];
  if (!b.name?.trim())                                           e.push('name is required');
  if (!b.targetAmount || isNaN(+b.targetAmount) || +b.targetAmount <= 0) e.push('targetAmount must be positive');
  if (!b.timelineMonths || isNaN(+b.timelineMonths) || +b.timelineMonths < 1) e.push('timelineMonths must be >= 1');
  return e;
}

/* ═══════════════════════════════════════════════════════════
   BUSINESS LOGIC HELPERS
═══════════════════════════════════════════════════════════ */
function getOrCreatePiggy(userId, monthlyIncome) {
  let p = findOne('piggy', x => x.userId === userId);
  if (!p) {
    p = insertOne('piggy', {
      id: 'pig_' + uid(), userId,
      totalSaved: 0, streakMonths: 0, commitPct: 20,
      lastDepositMonth: null, lastDepositDate: null,
      monthlyIncome,
    });
  }
  return p;
}

function getActiveChallenge() {
  return readCollection('challenges').find(c => c.active) || null;
}

function computeCashflow(userId) {
  const user    = findOne('users', u => u.id === userId);
  const income  = user?.monthlyIncome || 0;
  const now     = new Date();
  const thisMonth = now.toISOString().slice(0, 7);

  const monthTxns = readCollection('transactions')
    .filter(t => t.userId === userId && t.date.startsWith(thisMonth));

  const expenses   = monthTxns.filter(t => t.type === 'expense');
  const totalSpent = expenses.reduce((s, t) => s + t.amount, 0);
  const daysElapsed = now.getDate() || 1;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const avgDaily    = daysElapsed > 0 ? totalSpent / daysElapsed : 0;
  const balance     = income - totalSpent;
  const daysRunway  = avgDaily > 0 ? Math.floor(balance / avgDaily) : daysInMonth;
  const projTotal   = Math.round(avgDaily * daysInMonth);
  const projSavings = Math.max(0, Math.round(income - projTotal));

  // Category breakdown
  const catTotals = {};
  expenses.forEach(t => { catTotals[t.category] = (catTotals[t.category] || 0) + t.amount; });
  const topEntry = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0];
  const topCat   = topEntry?.[0];
  const topAmt   = topEntry?.[1] || 0;

  // Smart tips
  const tips = [];
  if (topCat) tips.push(`Your biggest spend category is "${topCat}" at ₹${topAmt.toLocaleString('en-IN')} (${Math.round(topAmt / (totalSpent || 1) * 100)}% of expenses).`);
  tips.push(daysRunway < 15
    ? `⚠ At this rate you may run low before month end. Cut daily spend by ₹${Math.round(avgDaily * 0.15)} to gain extra days.`
    : `On track to save ₹${projSavings.toLocaleString('en-IN')} this month 🎉`);
  tips.push(`Your daily budget target: ₹${Math.round(income / daysInMonth)} per day.`);

  return {
    monthlyIncome: income,
    totalSpent,
    balance: Math.max(0, balance),
    avgDailySpend: Math.round(avgDaily),
    daysRunway: Math.max(0, daysRunway),
    daysElapsed,
    daysInMonth,
    projectedMonthTotal: projTotal,
    projectedSavings: projSavings,
    categoryBreakdown: catTotals,
    tips,
  };
}

function checkEMIEligibility(userId) {
  const completedGoals = readCollection('goals').filter(g => g.userId === userId && g.completed).length;
  const piggy          = findOne('piggy', p => p.userId === userId);
  const goalsOk        = completedGoals >= 3;
  const piggyOk        = (piggy?.streakMonths || 0) >= 3;
  return {
    eligible: goalsOk && piggyOk,
    completedGoals, requiredGoals: 3, goalsOk,
    streakMonths: piggy?.streakMonths || 0, requiredStreak: 3, piggyOk,
  };
}

/* ═══════════════════════════════════════════════════════════
   ROUTE HANDLERS
═══════════════════════════════════════════════════════════ */

/* ── AUTH ───────────────────────────────────────────────── */
async function handleSignup(req, res) {
  const { firstName, lastName, email, password, monthlyIncome } = await readBody(req);

  if (!firstName?.trim())               return err(res, 400, 'firstName is required');
  if (!lastName?.trim())                return err(res, 400, 'lastName is required');
  if (!isEmail(email))                  return err(res, 400, 'A valid email address is required');
  if (!password || password.length < 6) return err(res, 400, 'Password must be at least 6 characters');
  if (!monthlyIncome || +monthlyIncome <= 0) return err(res, 400, 'monthlyIncome must be a positive number');
  if (findOne('users', u => u.email === email.toLowerCase().trim()))
    return err(res, 409, 'An account with this email already exists');

  const user = insertOne('users', {
    id:           'usr_' + uid(),
    firstName:    firstName.trim(),
    lastName:     lastName.trim(),
    email:        email.toLowerCase().trim(),
    passwordHash: hashPassword(password),
    monthlyIncome: +monthlyIncome,
    role:         'user',
    createdAt:    new Date().toISOString(),
  });

  // Provision piggy bank record immediately
  getOrCreatePiggy(user.id, +monthlyIncome);

  const { passwordHash: _, ...safe } = user;
  ok(res, {
    token: signToken({ userId: user.id, email: user.email }),
    user:  safe,
    message: 'Account created! Welcome to MoneyGuru 🎉',
  }, 201);
}

async function handleSignin(req, res) {
  const { email, password } = await readBody(req);
  if (!isEmail(email)) return err(res, 400, 'A valid email is required');
  if (!password)       return err(res, 400, 'Password is required');

  const user = findOne('users', u => u.email === email.toLowerCase().trim());
  if (!user || !verifyPassword(password, user.passwordHash))
    return err(res, 401, 'Incorrect email or password');

  maybeUpgradePasswordHash(user, password);

  const { passwordHash: _, ...safe } = user;
  ok(res, {
    token: signToken({ userId: user.id, email: user.email }),
    user:  safe,
  });
}

function handleMe(req, res) {
  const payload = requireAuth(req, res); if (!payload) return;
  const user = findOne('users', u => u.id === payload.userId);
  if (!user) return err(res, 404, 'User not found');
  const { passwordHash: _, ...safe } = user;
  ok(res, { user: safe });
}

/* ── TRANSACTIONS ────────────────────────────────────────── */
function handleListTransactions(req, res) {
  const payload = requireAuth(req, res); if (!payload) return;
  const qp    = new url.URL(req.url, 'http://x').searchParams;
  const month = qp.get('month'); // optional YYYY-MM filter

  let txns = readCollection('transactions')
    .filter(t => t.userId === payload.userId)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (month) txns = txns.filter(t => t.date.startsWith(month));

  ok(res, { transactions: txns, total: txns.length });
}

async function handleAddTransaction(req, res) {
  const payload = requireAuth(req, res); if (!payload) return;
  const body = await readBody(req);
  const errs = validateTxn(body);
  if (errs.length) return err(res, 400, errs.join('; '));

  const txn = insertOne('transactions', {
    id:          'txn_' + uid(),
    userId:      payload.userId,
    type:        body.type,
    description: body.description.trim(),
    category:    body.category,
    amount:      +body.amount,
    date:        body.date,
    createdAt:   new Date().toISOString(),
  });

  ok(res, { transaction: txn }, 201);
}

function handleDeleteTransaction(req, res, params) {
  const payload = requireAuth(req, res); if (!payload) return;
  const txn = findOne('transactions', t => t.id === params.id && t.userId === payload.userId);
  if (!txn) return err(res, 404, 'Transaction not found or does not belong to you');
  deleteOne('transactions', t => t.id === params.id);
  ok(res, { message: 'Transaction deleted', id: params.id });
}

/* ── GOALS ───────────────────────────────────────────────── */
function handleListGoals(req, res) {
  const payload = requireAuth(req, res); if (!payload) return;
  const goals = readCollection('goals')
    .filter(g => g.userId === payload.userId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  ok(res, { goals, total: goals.length });
}

async function handleCreateGoal(req, res) {
  const payload = requireAuth(req, res); if (!payload) return;
  const body = await readBody(req);
  const errs = validateGoal(body);
  if (errs.length) return err(res, 400, errs.join('; '));

  const goal = insertOne('goals', {
    id:              'gol_' + uid(),
    userId:          payload.userId,
    name:            body.name.trim(),
    emoji:           body.emoji?.slice(0, 4) || '🎯',
    targetAmount:    +body.targetAmount,
    savedAmount:     0,
    timelineMonths:  +body.timelineMonths,
    monthsRemaining: +body.timelineMonths,
    completed:       false,
    completedAt:     null,
    createdAt:       new Date().toISOString(),
    updatedAt:       new Date().toISOString(),
  });

  ok(res, { goal, message: `Goal "${goal.name}" created!` }, 201);
}

async function handleGoalDeposit(req, res, params) {
  const payload = requireAuth(req, res); if (!payload) return;
  const { amount } = await readBody(req);
  if (!amount || isNaN(+amount) || +amount <= 0) return err(res, 400, 'amount must be a positive number');

  const goal = findOne('goals', g => g.id === params.id && g.userId === payload.userId);
  if (!goal)          return err(res, 404, 'Goal not found');
  if (goal.completed) return err(res, 400, 'This goal is already completed — start a new one!');

  const user        = findOne('users', u => u.id === payload.userId);
  const income      = user?.monthlyIncome || 1;
  const newSaved    = Math.min(goal.targetAmount, goal.savedAmount + +amount);
  const completed   = newSaved >= goal.targetAmount;
  const remaining   = goal.targetAmount - newSaved;
  const monthsLeft  = completed ? 0 : Math.max(1, Math.ceil(remaining / (income * 0.2)));

  const updated = updateOne('goals', g => g.id === params.id, () => ({
    savedAmount:     newSaved,
    monthsRemaining: monthsLeft,
    completed,
    completedAt:     completed ? new Date().toISOString() : null,
    updatedAt:       new Date().toISOString(),
  }));

  ok(res, {
    goal: updated,
    amountAdded: +amount,
    newTotal: newSaved,
    completed,
    message: completed
      ? `🎉 Goal "${goal.name}" completed! Start a new one.`
      : `₹${(+amount).toLocaleString('en-IN')} added. ₹${remaining.toLocaleString('en-IN')} to go!`,
  });
}

function handleDeleteGoal(req, res, params) {
  const payload = requireAuth(req, res); if (!payload) return;
  const goal = findOne('goals', g => g.id === params.id && g.userId === payload.userId);
  if (!goal) return err(res, 404, 'Goal not found or does not belong to you');
  deleteOne('goals', g => g.id === params.id);
  ok(res, { message: `Goal "${goal.name}" deleted`, id: params.id });
}

/* ── PIGGY BANK ──────────────────────────────────────────── */
function handleGetPiggy(req, res) {
  const payload = requireAuth(req, res); if (!payload) return;
  const user  = findOne('users', u => u.id === payload.userId);
  const piggy = getOrCreatePiggy(payload.userId, user?.monthlyIncome || 0);

  const commitAmount = Math.round((user?.monthlyIncome || 0) * piggy.commitPct / 100);
  const milestones   = [
    { months: 3,  points: 500,  unlocked: piggy.streakMonths >= 3  },
    { months: 6,  points: 800,  unlocked: piggy.streakMonths >= 6  },
    { months: 12, points: 1500, unlocked: piggy.streakMonths >= 12 },
  ];
  const nextMilestone = milestones.find(m => !m.unlocked) || null;
  const thisMonth = new Date().toISOString().slice(0, 7);
  const canDepositThisMonth = piggy.lastDepositMonth !== thisMonth;

  ok(res, { piggyBank: { ...piggy, commitAmount, milestones, nextMilestone, canDepositThisMonth } });
}

async function handlePiggyDeposit(req, res) {
  const payload = requireAuth(req, res); if (!payload) return;
  const user  = findOne('users', u => u.id === payload.userId);
  if (!user)  return err(res, 404, 'User not found');

  const piggy    = getOrCreatePiggy(payload.userId, user.monthlyIncome);
  const nowMonth = new Date().toISOString().slice(0, 7);

  if (piggy.lastDepositMonth === nowMonth)
    return err(res, 409, 'You have already made your deposit this month. Come back next month!');

  const depositAmt  = Math.round(user.monthlyIncome * piggy.commitPct / 100);
  const newStreak   = piggy.streakMonths + 1;
  const newTotal    = piggy.totalSaved + depositAmt;

  // Milestone reward check
  const milestoneRewards = { 3: 500, 6: 800, 12: 1500 };
  const pointsEarned = milestoneRewards[newStreak] || 0;

  const updated = updateOne('piggy', p => p.id === piggy.id, () => ({
    totalSaved:       newTotal,
    streakMonths:     newStreak,
    lastDepositDate:  new Date().toISOString(),
    lastDepositMonth: nowMonth,
  }));

  ok(res, {
    piggyBank:    updated,
    depositAmount: depositAmt,
    newStreakMonths: newStreak,
    newTotalSaved:  newTotal,
    pointsEarned,
    milestoneUnlocked: pointsEarned > 0,
    message: pointsEarned
      ? `🏆 ${newStreak}-month streak! You've earned ${pointsEarned} Diamond Points!`
      : `Deposit confirmed ✓  Streak: ${newStreak} month${newStreak !== 1 ? 's' : ''} 🔥`,
  });
}

async function handlePiggyCommitment(req, res) {
  const payload = requireAuth(req, res); if (!payload) return;
  const { commitPct } = await readBody(req);
  if (commitPct === undefined || isNaN(+commitPct) || +commitPct < 1 || +commitPct > 80)
    return err(res, 400, 'commitPct must be between 1 and 80');

  const user  = findOne('users', u => u.id === payload.userId);
  const piggy = getOrCreatePiggy(payload.userId, user?.monthlyIncome || 0);

  const updated = updateOne('piggy', p => p.id === piggy.id, () => ({ commitPct: +commitPct }));
  ok(res, { piggyBank: updated, message: `Commitment updated to ${+commitPct}%` });
}

/* ── EMI ─────────────────────────────────────────────────── */
function handleEMIEligibility(req, res) {
  const payload = requireAuth(req, res); if (!payload) return;
  ok(res, checkEMIEligibility(payload.userId));
}

async function handleEMIApply(req, res) {
  const payload = requireAuth(req, res); if (!payload) return;
  const elig = checkEMIEligibility(payload.userId);
  if (!elig.eligible) return err(res, 403, 'Not eligible for EMI yet', { eligibility: elig });

  const { amount, tenureMonths, purpose, upiOrAccount } = await readBody(req);

  if (!amount || +amount < 5000 || +amount > 8000)
    return err(res, 400, 'amount must be between ₹5,000 and ₹8,000');
  if (![12, 16].includes(+tenureMonths))
    return err(res, 400, 'tenureMonths must be 12 or 16');
  if (!upiOrAccount?.trim())
    return err(res, 400, 'upiOrAccount is required');

  // Interest rate lookup table
  const RATE_TABLE = {
    '5000-12': 1.2, '6000-12': 1.4, '6000-16': 1.3,
    '7000-12': 1.5, '7500-16': 1.35,'8000-16': 1.45,
  };
  const rateKey    = `${amount}-${tenureMonths}`;
  const ratePM     = RATE_TABLE[rateKey] ?? 1.4;
  const rm         = ratePM / 100;
  const n          = +tenureMonths;
  const emi        = Math.round(+amount * (rm * Math.pow(1 + rm, n)) / (Math.pow(1 + rm, n) - 1));
  const totalInt   = Math.round(emi * n - +amount);
  const totalRepay = emi * n;

  const app = insertOne('emi_applications', {
    id:             'emi_' + uid(),
    userId:         payload.userId,
    amount:         +amount,
    tenureMonths:   +tenureMonths,
    interestRatePM: ratePM,
    monthlyEMI:     emi,
    totalInterest:  totalInt,
    totalRepayment: totalRepay,
    upiOrAccount:   upiOrAccount.trim(),
    purpose:        purpose || 'Not specified',
    status:         'pending',
    appliedAt:      new Date().toISOString(),
  });

  ok(res, {
    application: app,
    message: `Simulated EMI application for ₹${(+amount).toLocaleString('en-IN')} recorded (Simulation mode — educational demonstration).`,
  }, 201);
}

function handleListEMIApplications(req, res) {
  const payload = requireAuth(req, res); if (!payload) return;
  const apps = readCollection('emi_applications')
    .filter(a => a.userId === payload.userId)
    .sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt));
  ok(res, { applications: apps, total: apps.length });
}

/* ── 15-DAY CHALLENGE ────────────────────────────────────── */
function handleGetChallenge(req, res) {
  const payload   = requireAuth(req, res); if (!payload) return;
  const challenge = getActiveChallenge();
  if (!challenge) return err(res, 404, 'No active challenge at the moment. Check back soon!');

  const now           = new Date();
  const daysLeft      = Math.max(0, Math.ceil((new Date(challenge.endDate) - now) / 864e5));
  const participants  = readCollection('challenge_participants').filter(p => p.challengeId === challenge.id);
  const myParticipation = participants.find(p => p.userId === payload.userId) || null;

  ok(res, {
    challenge: { ...challenge, daysLeft, participantCount: participants.length },
    myParticipation,
    hasJoined: !!myParticipation,
  });
}

async function handleJoinChallenge(req, res) {
  const payload   = requireAuth(req, res); if (!payload) return;
  const challenge = getActiveChallenge();
  if (!challenge) return err(res, 404, 'No active challenge');
  if (new Date() > new Date(challenge.endDate)) return err(res, 400, 'This challenge has already ended');

  if (findOne('challenge_participants', p => p.challengeId === challenge.id && p.userId === payload.userId))
    return err(res, 409, 'You have already joined this challenge');

  const { targetAmount } = await readBody(req);
  if (!targetAmount || isNaN(+targetAmount) || +targetAmount < 500)
    return err(res, 400, 'Minimum target amount is ₹500');

  const user        = findOne('users', u => u.id === payload.userId);
  const participant = insertOne('challenge_participants', {
    id:            'cp_' + uid(),
    challengeId:   challenge.id,
    userId:        payload.userId,
    userName:      `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Anonymous',
    targetAmount:  +targetAmount,
    savedAmount:   0,
    savingRatePct: 0,
    monthlyIncome: user?.monthlyIncome || 0,
    joinedAt:      new Date().toISOString(),
    updatedAt:     new Date().toISOString(),
  });

  ok(res, {
    participant,
    message: "You've joined the challenge! 🚀 Start depositing to climb the leaderboard.",
  }, 201);
}

async function handleChallengeDeposit(req, res) {
  const payload   = requireAuth(req, res); if (!payload) return;
  const challenge = getActiveChallenge();
  if (!challenge) return err(res, 404, 'No active challenge');
  if (new Date() > new Date(challenge.endDate)) return err(res, 400, 'Challenge has ended');

  const participant = findOne('challenge_participants',
    p => p.challengeId === challenge.id && p.userId === payload.userId);
  if (!participant) return err(res, 404, 'You have not joined this challenge yet — join first!');

  const { amount } = await readBody(req);
  if (!amount || isNaN(+amount) || +amount < 500) return err(res, 400, 'Minimum deposit is ₹500');

  const newSaved       = Math.min(participant.targetAmount, participant.savedAmount + +amount);
  const savingRatePct  = participant.monthlyIncome > 0
    ? parseFloat((newSaved / participant.monthlyIncome * 100).toFixed(2))
    : 0;
  const hitTarget = newSaved >= participant.targetAmount;

  const updated = updateOne(
    'challenge_participants',
    p => p.id === participant.id,
    () => ({ savedAmount: newSaved, savingRatePct, updatedAt: new Date().toISOString() }),
  );

  insertOne('challenge_deposits', {
    id: 'cde_' + uid(),
    participantId: participant.id,
    challengeId:   challenge.id,
    userId:        payload.userId,
    amount:        +amount,
    depositedAt:   new Date().toISOString(),
  });

  ok(res, {
    participant: updated,
    amountDeposited: +amount,
    newTotal:     newSaved,
    savingRatePct,
    hitTarget,
    message: hitTarget
      ? '🏆 You hit your target! Diamond Points will be credited when the challenge ends.'
      : `₹${(+amount).toLocaleString('en-IN')} deposited! Keep going 💪`,
  });
}

function handleLeaderboard(req, res) {
  const payload   = requireAuth(req, res); if (!payload) return;
  const challenge = getActiveChallenge();
  if (!challenge) return err(res, 404, 'No active challenge');

  const ranked = readCollection('challenge_participants')
    .filter(p => p.challengeId === challenge.id)
    .sort((a, b) => b.savingRatePct - a.savingRatePct)
    .map((p, i) => ({
      rank:           i + 1,
      userId:         p.userId,
      userName:       p.userName,
      savedAmount:    p.savedAmount,
      targetAmount:   p.targetAmount,
      savingRatePct:  p.savingRatePct,
      isMe:           p.userId === payload.userId,
      estimatedPoints: i === 0 ? 500 : i === 1 ? 350 : i === 2 ? 200
                      : p.savingRatePct >= 5 ? 100 : 50,
    }));

  const now      = new Date();
  const daysLeft = Math.max(0, Math.ceil((new Date(challenge.endDate) - now) / 864e5));
  ok(res, {
    leaderboard: ranked,
    total:       ranked.length,
    challenge:   { ...challenge, daysLeft },
  });
}

/* ── CASHFLOW ────────────────────────────────────────────── */
function handleCashflow(req, res) {
  const payload = requireAuth(req, res); if (!payload) return;
  ok(res, { cashflow: computeCashflow(payload.userId) });
}

/* ── ADMIN ───────────────────────────────────────────────── */
function handleAdminListUsers(req, res) {
  if (!requireAdmin(req, res)) return;

  const users = readCollection('users').map(u => {
    const { passwordHash: _, ...safe } = u;
    const txns    = readCollection('transactions').filter(t => t.userId === u.id);
    const goals   = readCollection('goals').filter(g => g.userId === u.id);
    const piggy   = findOne('piggy', p => p.userId === u.id);
    const emiApps = readCollection('emi_applications').filter(a => a.userId === u.id);
    const chal    = findOne('challenge_participants', p => p.userId === u.id);
    const elig    = checkEMIEligibility(u.id);
    return {
      ...safe,
      summary: {
        transactions:     { total: txns.length, totalSpent: txns.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0) },
        goals:            { total: goals.length, completed: goals.filter(g=>g.completed).length },
        piggyBank:        { streakMonths: piggy?.streakMonths||0, totalSaved: piggy?.totalSaved||0, commitPct: piggy?.commitPct||20 },
        emiApplications:  emiApps.length,
        emiEligible:      elig.eligible,
        inChallenge:      !!chal,
        challengeSaved:   chal?.savedAmount || 0,
      },
    };
  });

  ok(res, {
    users,
    totalUsers: users.length,
    timestamp:  new Date().toISOString(),
    note:       'Passwords are never returned — stored as salted scrypt hashes (legacy HMAC-SHA256 still verified)',
  });
}

function handleAdminGetUser(req, res, params) {
  if (!requireAdmin(req, res)) return;
  const user = findOne('users', u => u.id === params.id);
  if (!user) return err(res, 404, 'User not found');

  const { passwordHash: _, ...safe } = user;
  const txns    = readCollection('transactions').filter(t => t.userId === user.id)
                    .sort((a,b)=>new Date(b.date)-new Date(a.date));
  const goals   = readCollection('goals').filter(g => g.userId === user.id);
  const piggy   = findOne('piggy', p => p.userId === user.id);
  const emiApps = readCollection('emi_applications').filter(a => a.userId === user.id);
  const chalPart = readCollection('challenge_participants').filter(p => p.userId === user.id);
  const chalDeps = readCollection('challenge_deposits').filter(d => d.userId === user.id);

  ok(res, {
    user:                   safe,
    transactions:           txns,
    goals,
    piggyBank:              piggy,
    emiApplications:        emiApps,
    challengeParticipations:chalPart,
    challengeDeposits:      chalDeps,
    cashflow:               computeCashflow(user.id),
    emiEligibility:         checkEMIEligibility(user.id),
  });
}

/* ═══════════════════════════════════════════════════════════
   ROUTER
═══════════════════════════════════════════════════════════ */
async function router(req, res) {
  const { method } = req;
  const pathname = (req.url || '/').split('?')[0];

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  // ── Public routes ───────────────────────────────────────
  if (method === 'GET'  && pathname === '/health')            return ok(res, { status: 'ok', time: new Date().toISOString() });
  if (method === 'POST' && pathname === '/api/auth/signup')   return handleSignup(req, res);
  if (method === 'POST' && pathname === '/api/auth/signin')   return handleSignin(req, res);

  // ── Protected — require token ───────────────────────────
  if (method === 'GET' && pathname === '/api/auth/me')        return handleMe(req, res);

  // Transactions
  if (method === 'GET'    && pathname === '/api/transactions') return handleListTransactions(req, res);
  if (method === 'POST'   && pathname === '/api/transactions') return handleAddTransaction(req, res);
  const txnDel = matchPath(pathname, '/api/transactions/:id');
  if (method === 'DELETE' && txnDel)                          return handleDeleteTransaction(req, res, txnDel);

  // Goals
  if (method === 'GET'  && pathname === '/api/goals')          return handleListGoals(req, res);
  if (method === 'POST' && pathname === '/api/goals')          return handleCreateGoal(req, res);
  const goalDep = matchPath(pathname, '/api/goals/:id/deposit');
  if (method === 'PATCH' && goalDep)                           return handleGoalDeposit(req, res, goalDep);
  const goalDel = matchPath(pathname, '/api/goals/:id');
  if (method === 'DELETE' && goalDel)                          return handleDeleteGoal(req, res, goalDel);

  // Piggy bank
  if (method === 'GET'   && pathname === '/api/piggy')              return handleGetPiggy(req, res);
  if (method === 'POST'  && pathname === '/api/piggy/deposit')      return handlePiggyDeposit(req, res);
  if (method === 'PATCH' && pathname === '/api/piggy/commitment')   return handlePiggyCommitment(req, res);

  // EMI
  if (method === 'GET'  && pathname === '/api/emi/eligibility')  return handleEMIEligibility(req, res);
  if (method === 'POST' && pathname === '/api/emi/apply')         return handleEMIApply(req, res);
  if (method === 'GET'  && pathname === '/api/emi/applications')  return handleListEMIApplications(req, res);

  // Challenge
  if (method === 'GET'  && pathname === '/api/challenge')              return handleGetChallenge(req, res);
  if (method === 'POST' && pathname === '/api/challenge/join')         return handleJoinChallenge(req, res);
  if (method === 'POST' && pathname === '/api/challenge/deposit')      return handleChallengeDeposit(req, res);
  if (method === 'GET'  && pathname === '/api/challenge/leaderboard')  return handleLeaderboard(req, res);

  // Cashflow
  if (method === 'GET' && pathname === '/api/cashflow')          return handleCashflow(req, res);

  // ── Admin ────────────────────────────────────────────────
  if (method === 'GET' && pathname === '/api/admin/users')       return handleAdminListUsers(req, res);
  const adminUser = matchPath(pathname, '/api/admin/users/:id');
  if (method === 'GET' && adminUser)                             return handleAdminGetUser(req, res, adminUser);
  
  // Serve frontend
  if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(fs.readFileSync(htmlPath));
    }
  }

  // 404
  err(res, 404, `Route not found: ${method} ${pathname}`, {
    hint: 'See the route table at the top of server.js',
  });
}

/* ═══════════════════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════════════════ */

// Seed one active challenge if collection is empty
(function seedChallenge() {
  const col = readCollection('challenges');
  if (col.length === 0) {
    const start = new Date();
    const end   = new Date(start.getTime() + 15 * 24 * 60 * 60 * 1000);
    insertOne('challenges', {
      id:        'ch_' + uid(),
      round:     7,
      active:    true,
      startDate: start.toISOString(),
      endDate:   end.toISOString(),
    });
    console.log('  ✓ Seeded active 15-day challenge (Round 7)');
  }
})();

const server = http.createServer(async (req, res) => {
  try {
    await router(req, res);
  } catch (e) {
    console.error('[ERROR]', e.stack || e.message);
    err(res, 500, 'Internal server error — check server logs');
  }
});

server.listen(PORT, () => {
  const line = '═'.repeat(48);
  console.log('');
  console.log(`  ╔${line}╗`);
  console.log(`  ║       MoneyGuru API Server — Ready ✓         ║`);
  console.log(`  ╠${line}╣`);
  console.log(`  ║  URL    → http://localhost:${PORT}                  ║`);
  console.log(`  ║  DB     → ${path.relative(process.cwd(), DB_DIR)}/                        ║`);
  console.log(`  ║  Admin  → Protected via ADMIN_KEY in .env            ║`);
  console.log(`  ╚${line}╝`);
  console.log('');
  console.log('  Quick-start:');
  console.log(`  curl http://localhost:${PORT}/health`);
  console.log('');
  console.log('  Sign up:');
  console.log(`  curl -X POST http://localhost:${PORT}/api/auth/signup \\`);
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(`    -d '{"firstName":"Demo","lastName":"User","email":"demo@example.com","password":"Password123","monthlyIncome":50000}'`);
  console.log('');
  console.log('  Admin dashboard (all users):');
  console.log(`  curl http://localhost:${PORT}/api/admin/users?key=<YOUR_ADMIN_KEY>`);
  console.log('');
});