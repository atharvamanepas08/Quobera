# MoneyGuru 💰

> **A Lightweight Personal Finance Management & Gamified Savings Web Application**  
> *Developed as an educational portfolio project (February 2026).*

---

## 1. Project Overview

**MoneyGuru** is a self-contained personal finance web application built using standard Node.js and client-side web technologies. It is designed to help students and young professionals track daily spending, plan savings goals, commit to monthly savings habits, and explore structured credit repayment schedules in a transparent, zero-risk simulation environment.

> [!IMPORTANT]
> **Educational & Portfolio Disclaimer**  
> MoneyGuru is an educational software portfolio project. It is **not** a banking, lending, investment, deposit-taking, or payment processing platform. All banking operations, EMI loans, piggy bank commitments, challenge pools, and rewards (Diamond Points) are strictly simulated models designed for financial education and planning demonstration.

---

## 2. Problem Statement & Target Users

### The Problem
College students and young earners often struggle with personal finance due to:
- Lack of visibility into daily spending velocity and cash burn rate.
- Difficulty sustaining recurring savings habits without gamified feedback.
- Inadequate understanding of compound interest and EMI calculations before taking on consumer credit.

### Target Audience
- **College students & young professionals** seeking a clear, visual breakdown of income vs. daily expenses.
- **Beginner savers** who benefit from structured commitment milestones and streak mechanics.
- **Reviewers & recruiters** evaluating full-stack system architecture, API design, financial calculation logic, and secure coding practices.

---

## 3. Feature Breakdown

To ensure complete transparency, the application's capabilities are categorized by implementation status:

### Implemented Features (Backend + Frontend Synchronized)
- **User Authentication & Session Management**:
  - Registration, per-user salted `crypto.scrypt` password hashing, and signed JWT (HS256) session tokens (no server-side session store).
  - Existing local accounts stored as `salt:HMAC-SHA256` still verify; successful sign-in upgrades those hashes to scrypt.
  - Profile retrieval (`/api/auth/me`), client-side token persistence via `localStorage`, and consistent login/logout UI state.
- **Monthly income at signup**:
  - `monthlyIncome` is stored on the user record during registration and used by cashflow, piggy-bank, and goal timeline calculations.
  - The in-app **Update Earnings** control (`saveEarnings()`) updates client-side state only; there is no backend route to persist income changes after signup.
- **Isolated Transaction Ledger**:
  - Full CRUD operations for income and expense transactions (`/api/transactions`).
  - Categorized breakdown (`food`, `shopping`, `transport`, `entertainment`, `utilities`, `health`, `income`).
  - Strict account-level data isolation ensuring users only access their own financial records.
- **Target-Based Savings Goals**:
  - Creation of itemized goals with emoji tagging, target amount, and timeline (`/api/goals`).
  - Incremental savings deposits (`PATCH /api/goals/:id/deposit`) that dynamically recalculate months remaining based on target and income capacity.
  - Goal deletion and completion status tracking.
- **Cashflow Countdown & Runway Projection**:
  - Dynamic runway engine (`/api/cashflow`) calculating daily burn rate, month-end projected spend, and days remaining before funds are exhausted.
  - Safe zero-expense and zero-income edge-case handling.
- **Automated Verification Suite**:
  - Practical unit and integration tests powered by Node.js built-in `node:test` and `node:assert` modules.

### Partially Implemented Features
- **Streak Piggy Bank**:
  - Recurring monthly savings commitment tracker (`/api/piggy`).
  - Dynamic commitment percentage adjustment (1% to 80%).
  - Enforced single-deposit per month constraint preventing duplicate deposits within the same calendar month.
  - *Limitation*: Relies on server-side calendar month validation (`YYYY-MM`); does not connect to automated bank recurring mandates.
- **15-Day Savings Challenge & Leaderboard**:
  - Competitive round-based savings sprint (`/api/challenge`).
  - Minimum entry target (₹500) and deposit limits.
  - Live percentage-of-income ranking system with estimated point rewards.
  - *Limitation*: Round scheduling is flat-file seeded; does not automatically rotate rounds across multiple calendar years without administrative trigger.
- **Administrative Inspection**:
  - Secret-key protected endpoints (`/api/admin/users`, `/api/admin/users/:id`) returning aggregated system analytics.
  - *Limitation*: Read-only inspection dashboard designed for administrative demonstration, passing `?key=` query parameter.

### Simulated Features (No Real-World Financial Action)
- **Loyalty EMI Micro-Loan Calculator**:
  - Unlocked when user completes ≥ 3 savings goals and maintains a ≥ 3-month Piggy Bank streak.
  - Monthly reducing EMI formulas modeling loans between ₹5,000 and ₹8,000 across 12- and 16-month tenures.
  - Form submission records an application in flat files (`emi_applications.json`) for review; **no actual loan disbursal, credit check, or bank auto-debit occurs**.
- **Diamond Points & Gamification Store**:
  - Virtual points awarded for savings milestones (3, 6, 12 months) and challenge leaderboards.
  - Point redemption demonstrates catalog UX; no monetary conversion or gift cards are fulfilled.

---

## 4. Technology Stack

MoneyGuru intentionally avoids heavy external frameworks to demonstrate core fundamentals of web development and Node.js system architecture.

| Layer | Technologies Used | Rationale |
|---|---|---|
| **Backend Runtime** | Node.js (v18+ / v20+ / v24+) | Built entirely with native Node.js standard modules (`http`, `crypto`, `fs`, `path`, `url`). **Zero external production npm dependencies**. |
| **Authentication** | Built-in `crypto` (`scrypt` passwords, HS256 JWT) | Avoids third-party JWT/bcrypt packages. Password hashing uses Node.js `crypto.scrypt` with random salts; JWT signatures remain HMAC-SHA256. |
| **Data Persistence** | Flat-file JSON collections (`db/` directory) | Inspectable, file-based relational store suitable for local development and portfolio demonstration without requiring external database installation. |
| **Frontend** | Semantic HTML5, CSS3 Custom Properties, Vanilla JavaScript (ES2022) | Single-page architecture with reactive DOM rendering, SVG icon systems, and modal flows without virtual DOM overhead. |
| **Testing** | Node.js Native Test Runner (`node:test`, `node:assert/strict`) | Fast, lightweight automated test suite with zero test framework bloat. |

---

## 5. Architecture & Data Flow

```
+-------------------------------------------------------------------------+
|                                Client                                   |
|   Vanilla JS Single-Page App (public/index.html)                        |
|   - apiFetch() with Bearer JWT Header                                   |
|   - Contextual HTML Escaping (XSS Prevention)                           |
|   - Real-time Cashflow & Savings Visualizations                         |
+------------------------------------+------------------------------------+
                                     |  HTTP REST (JSON)
                                     v
+-------------------------------------------------------------------------+
|                                Server                                   |
|   Node.js HTTP Server (server.js)                                       |
|   - Environment Loader (.env parsing)                                   |
|   - Router & Parameter Matcher (matchPath)                              |
|   - Cryptographic Auth (requireAuth, verifyToken)                       |
|   - Financial Engines (Cashflow, EMI, Piggy Bank)                       |
+------------------------------------+------------------------------------+
                                     |  Synchronous File I/O
                                     v
+-------------------------------------------------------------------------+
|                          Storage (db/*.json)                            |
|   users.json            | transactions.json   | goals.json              |
|   piggy.json            | challenges.json     | challenge_deposits.json |
|   emi_applications.json | challenge_participants.json                   |
+-------------------------------------------------------------------------+
```

### Request Flow
1. **Public Requests**: Requests to `/health`, `/index.html`, `/api/auth/signup`, and `/api/auth/signin` pass directly to router handlers.
2. **Authenticated Requests**: Protected endpoints execute `requireAuth(req, res)`:
   - Extracts `Bearer <token>` from the `Authorization` header.
   - Verifies the HMAC-SHA256 signature using `JWT_SECRET`.
   - Validates token expiration (`exp`).
   - Injects `payload.userId` into route handlers to enforce strict account isolation.
3. **Data Mutation**: Read/write operations load an entire JSON collection with `readFileSync`, mutate it in memory, and overwrite the file with `writeFileSync`. These writes are neither atomic nor transactional.

---

## 6. Directory Structure

```
moneyguru/
├── db/                             # Flat-file JSON database collections
│   ├── challenges.json             # Active challenge round metadata
│   ├── challenge_deposits.json     # User challenge deposit records
│   ├── challenge_participants.json # Enrolled challenge users
│   ├── emi_applications.json       # Simulated EMI application records
│   ├── goals.json                  # User-specific savings goals
│   ├── piggy.json                  # User piggy-bank streak & savings state
│   ├── transactions.json           # Income and expense transaction ledger
│   └── users.json                  # Registered user accounts & password hashes (scrypt; legacy HMAC verified)
├── public/                         # Client-side assets
│   └── index.html                  # Responsive single-page application (HTML/CSS/JS)
├── .env.example                    # Template environment variables
├── .gitignore                      # Git exclusion rules (secrets, node_modules, logs)
├── package.json                    # Project configuration, scripts, and metadata
├── package-lock.json               # Locked dependency tree
├── server.js                       # Pure Node.js HTTP server, router, and business logic
├── test.js                         # Automated verification test suite
└── README.md                       # Comprehensive project documentation
```

---

## 7. Prerequisites & Local Setup

### Prerequisites
- **Node.js**: Version 18.0.0 or higher (Tested on Node.js v24.14.0).
- **npm**: Version 8.0.0 or higher.
- A modern web browser (Chrome, Edge, Firefox, Safari).

### Step-by-Step Installation

1. **Clone or navigate to the repository directory**:
   ```bash
   cd moneyguru
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```
   *(Note: The application has zero external runtime dependencies. `npm install` verifies your package lockfile.)*

3. **Configure Environment Variables**:
   Copy `.env.example` to create your local `.env` configuration:
   - On Linux / macOS:
     ```bash
     cp .env.example .env
     ```
   - On Windows (PowerShell):
     ```powershell
     Copy-Item .env.example .env
     ```

4. **Edit `.env` with your secure local secrets**:
   ```env
   PORT=4000
   JWT_SECRET=your_custom_secure_random_jwt_secret_at_least_32_characters
   ADMIN_KEY=your_private_admin_key_for_inspection
   CORS_ORIGIN=*
   ```

---

## 8. Running the Application

### Start the Server
Run the npm start script:
```bash
npm start
```
Or run directly with Node:
```bash
node server.js
```

Upon boot, the server outputs confirmation:
```
  ╔════════════════════════════════════════════════════════════╗
  ║       MoneyGuru API Server — Ready ✓                       ║
  ╠════════════════════════════════════════════════════════════╣
  ║  URL    → http://localhost:4000                            ║
  ║  DB     → db/                                              ║
  ║  Admin  → Protected via ADMIN_KEY in .env                  ║
  ╚════════════════════════════════════════════════════════════╝
```

### Accessing the Web Application
Open your web browser and navigate to:
```
http://localhost:4000
```

### Quick Local Walkthrough
1. Click **Get Started** in the top navbar and sign up with a demo account (e.g. `alex@example.com`).
2. Navigate to **Track** to view the Cashflow Countdown and add sample income or expenses.
3. Switch to **Savings** to create a custom savings goal, test deposit increments, or adjust your Piggy Bank commitment percentage.
4. Try the **Simulated Loyalty EMI** eligibility check and review the loan installment calculator.

---

## 9. Running Automated Tests

MoneyGuru includes an automated test suite verifying core functional paths, security requirements, and calculation edge cases.

To execute the test suite:
```bash
npm test
```
Or directly:
```bash
node test.js
```

### Test Coverage Summary
The test suite executes automated checks verifying:
- **Authentication**: Health check, missing field validation, successful signup, duplicate email rejection (409), wrong password rejection (401), correct signin token return, Bearer token enforcement on protected routes, scrypt storage for new accounts, and sign-in for legacy HMAC-SHA256 hashes.
- **User Data Isolation**: Independent account isolation ensuring User A's transactions and goals are neither readable nor deletable by User B.
- **Input Validation**: Rejection of negative amounts, zero values, non-numeric strings, and unauthorized categories.
- **Cashflow Logic**: Safe computation of burn rate and remaining runway without division-by-zero errors.
- **Piggy Bank Rules**: Enforcement of one deposit per calendar month and commitment percentage bounds (1%–80%).
- **Challenge Limits**: Minimum target and deposit checks (≥ ₹500).
- **Admin Endpoints**: Requirement of the correct `ADMIN_KEY` and absence of password hash leakage.

---

## 10. Financial Calculations & Formulas

MoneyGuru implements financial calculations directly in JavaScript without relying on black-box libraries. Below are the exact formulas used:

### A. Cashflow Countdown & Runway Projection
The engine forecasts how long the user's remaining income will last based on current spending velocity:
$$\text{Average Daily Spend} = \frac{\sum \text{Expenses in Current Month}}{\max(1, \text{Days Elapsed in Current Month})}$$
$$\text{Current Net Balance} = \text{Monthly Income} - \sum \text{Expenses in Current Month}$$
$$\text{Days Runway} = \begin{cases} \lfloor \frac{\text{Current Net Balance}}{\text{Average Daily Spend}} \rfloor & \text{if } \text{Average Daily Spend} > 0 \\ \text{Days in Month} & \text{otherwise} \end{cases}$$
$$\text{Projected Month Total Spend} = \text{Average Daily Spend} \times \text{Days in Month}$$
$$\text{Projected Savings} = \max(0, \text{Monthly Income} - \text{Projected Month Total Spend})$$

### B. Savings Goal Timeline
When a deposit is credited to a goal, remaining months to completion are dynamically calculated assuming a standard 20% monthly income allocation:
$$\text{New Saved} = \min(\text{Target Amount}, \text{Current Saved} + \text{Deposit Amount})$$
$$\text{Remaining Amount} = \text{Target Amount} - \text{New Saved}$$
$$\text{Months Remaining} = \begin{cases} 0 & \text{if Goal Completed} \\ \max\left(1, \left\lceil \frac{\text{Remaining Amount}}{\text{Monthly Income} \times 0.20} \right\rceil\right) & \text{otherwise} \end{cases}$$

### C. Piggy Bank Commitment
The monthly savings commitment is calculated as a user-selected proportion (1% to 80%) of declared income:
$$\text{Monthly Deposit Amount} = \text{round}\left( \text{Monthly Income} \times \frac{\text{Commitment Percentage}}{100} \right)$$
Milestone gamification rewards are unlocked at streak thresholds:
- **3 months**: 500 Diamond Points
- **6 months**: 800 Diamond Points
- **12 months**: 1,500 Diamond Points

### D. Equated Monthly Installment (EMI) Formula
The simulated micro-loan calculator uses the standard reducing balance EMI formula:
$$\text{EMI} = P \times \frac{r_m \times (1 + r_m)^n}{(1 + r_m)^n - 1}$$
Where:
- $P$ = Principal loan amount (₹5,000 to ₹8,000).
- $r_m$ = Monthly interest rate in decimal ($\frac{\text{Rate per Month \%}}{100}$).
- $n$ = Tenure in months ($12$ or $16$).
- $\text{Total Repayment} = \text{EMI} \times n$
- $\text{Total Interest} = \text{Total Repayment} - P$

---

## 11. Database & Persistence Design

### Design
Data is organized into flat JSON collections within the `db/` directory:
- `users.json`: Identity and credentials. New passwords are stored as `scrypt:N:r:p:salt:key`. Legacy local accounts may still use `salt:HMAC_SHA256_hash` until the next successful sign-in, which upgrades the stored hash.
- `transactions.json`: Individual income/expense ledger items tied to `userId`.
- `goals.json`: User savings targets and completion milestones.
- `piggy.json`: Habit streak counts, last deposit month (`YYYY-MM`), and commitment rates.
- `challenges.json`, `challenge_participants.json`, `challenge_deposits.json`: Round-based challenge data.
- `emi_applications.json`: Submitted micro-loan simulation requests.

### Limitations of Flat-File Persistence
- **Concurrency & File Locks**: JSON flat-file storage is not transactional. `writeFileSync` overwrites the whole collection in place (no temp-file + rename), so a crash mid-write can leave a truncated file, and concurrent writers can race.
- **In-Memory Reading**: The entire collection is read into memory on each query. While efficient for portfolio scale (<10,000 records), large datasets require an indexed RDBMS (e.g., PostgreSQL / SQLite).
- **Environment Isolation**: The `db/*.json` files are excluded from Git via `.gitignore` to prevent committing personal testing records. The server automatically initializes empty collections on startup if the files do not exist.

---

## 12. Security & Safe Coding Practices

- **Zero Hardcoded Secrets**: Secret fallbacks have been removed. `server.js` requires `JWT_SECRET` and `ADMIN_KEY` to be configured via `.env` or environment variables and exits immediately with an informative message if they are omitted.
- **Credential Storage**: Plaintext passwords are never stored. New passwords use per-user random 16-byte salts and Node.js `crypto.scrypt` (`N=16384`, `r=8`, `p=1`, 32-byte key) with parameterized verification. This is appropriate for a local portfolio demo, not production-grade identity (no Argon2id/bcrypt ecosystem, no pepper, no lockout/rate limits). HMAC-SHA256 hashes are retained only for backward-compatible verification of existing local accounts.
- **XSS Mitigation**: Dynamic user inputs (transaction descriptions, goal names, emoji tags, participant names) are sanitized with context-aware HTML escaping before injection into client templates.
- **Access Control**: User resources (`transactions`, `goals`, `piggy`, `emi`) strictly enforce owner matching:
  ```javascript
  const txn = findOne('transactions', t => t.id === params.id && t.userId === payload.userId);
  if (!txn) return err(res, 404, 'Transaction not found or does not belong to you');
  ```
- **Error Shielding**: Database errors and uncaught exceptions log stack traces internally to stderr while returning standardized, non-leaking JSON error messages (`500 Internal server error`).

---

## 13. Known Limitations & Future Improvements

1. **Database Upgrade**: Migrate flat JSON files to SQLite or PostgreSQL with connection pooling and database migrations.
2. **Refresh Token Rotation**: Implement short-lived access tokens (15 minutes) with HTTP-only refresh tokens.
3. **Automated Recurring Tasks**: Introduce a cron-based scheduler to advance challenge rounds and evaluate monthly streak rollovers automatically.
4. **Data Export**: Provide CSV/JSON transaction ledger export for external spreadsheet analysis.
5. **Multi-Currency Support**: Expand currency localization beyond Indian Rupee (INR ₹) formatting.

---

## 14. License

This project is released under the **ISC License**. Created for academic and professional portfolio presentation.
