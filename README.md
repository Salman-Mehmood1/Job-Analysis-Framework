# Job Evaluation App

A multi-user web app built from the **Job Evaluation Calculator** workbook (Hay point-factor method). It has three panels (Administrator, Evaluator and Management) on top of a scoring engine that reproduces the workbook formulas.

## Panels

| Panel | Who | What they can do |
|---|---|---|
| **Administrator** | `admin` | Set up companies, departments and positions (single or CSV import). Manage users and roles. Assign evaluations to evaluators (one or many at a time, with due date and instructions), reassign them, and see every evaluation in the organisation. Edit the grade structure. Dashboard with slicers. JD analyser. |
| **Evaluator** | `evaluator` | See only their own assignments. Score each one with the eight Hay elements, with live points, profile, grade and checks. Save drafts and submit. Can ask the JD analyser to suggest levels. **My results** shows their scores and, where management adjusted a score, the final score. |
| **Management** | `management` | Review queue of submitted single-evaluator evaluations, plus a **Calibration** queue for jobs with several evaluators. Adjust levels (the evaluator's original is kept and shown as dashed outlines), approve one or many at once, or return with a comment. Edit the grade structure. Dashboard with slicers. JD analyser. |

Each organisation is a separate tenant. Signing up at `/register` creates a new organisation, and the person who signs up becomes its administrator.

## Features

- **Scoring engine** (`shared/engine.ts`): a formula-for-formula port of the Evaluator, Scale and Grades & Bands sheets. It covers the 15% point scale, KH/PS/AC lookups, shading, the PS % rounded down to the scale, profile (A/P/L) and the three checks (profile beyond A4/P4, letter stair, borderline grade). The workbook's worked examples are unit tests: Accounts Assistant 206 / G6, Finance Manager 1,194 / G15, Plant Manager 1,564 / G17.
- **Grades computed on read**: grades are not stored. Each evaluation's grade is derived from the organisation's current grade structure, so editing the structure re-grades everything at once.
- **Grade structure editor** (admin and management):
  - Change the number of grades and each grade's minimum points, career level and typical roles.
  - Generate an evenly progressing structure from a grade count and boundaries.
  - Reset to the workbook's 23 grades.
  - See a **live impact preview** (how many jobs move up or down, and the distribution before and after) before saving.
- **Positions grouped by grade**: every grade with its point range and the positions in it, optionally sub-grouped by company or department.
- **Slicers** on company, department, role, grade, job family, career level, status and evaluator. They cascade (for example, choosing a company narrows the department list) and drive the KPIs, charts, grade groupings, data table and CSV export.
- **JD analyser** (every role): paste or upload a job description and get all eight element levels, each with its reasoning, plus points and grade from the same engine.
  - With `ANTHROPIC_API_KEY` set, Claude does the analysis using structured output. Without it, a transparent rule-based analyser is used, and the UI says which method ran.
  - Admin and management can save an analysis as an **independent evaluation**, linked to an existing position or a new one. It then goes into review and grading like any other evaluation.
  - Evaluators can apply the suggested levels to one of their assignments.
- **Multi-evaluator calibration**:
  - The admin can assign a job to several evaluators at once (or add evaluators to a job later). Each scores it independently and **blind**: evaluators never see other evaluations of the job, or even how many evaluators there are.
  - Management gets a side-by-side comparison of every submitted evaluation, element by element, with disagreements highlighted.
  - The **consensus** takes the most common level for each element. Where evaluators are evenly split, the tied levels are chosen so the total stays closest to the evaluators' median score, which keeps a two-evaluator consensus between their scores.
  - Management can adjust any element of the consensus, add a calibration note, and approve once at least two evaluations are submitted. Approval freezes the agreed levels as the job's official result and marks the evaluations approved. A calibration can be reopened, and individual evaluations can be returned to their evaluator.
  - Jobs are flagged when evaluators are more than one grade apart, or when the agreed score falls outside the evaluators' range.
  - Dashboards, grade groupings and exports count **one row per job**: the calibrated result, or the provisional consensus until calibration is approved.
- **Audit trail**: every assignment, submission, adjustment (old → new points and grade), approval and return is recorded and shown on the evaluation.

## Running it

Requires Node 22+.

```bash
npm install
npm run dev          # API on :3001, UI on http://localhost:5173
```

On first start a demo organisation is seeded. Sign in from the login page buttons, or use any of these with password `demo1234`:

- `admin@demo.com`
- `management@demo.com`
- `evaluator@demo.com`
- `evaluator2@demo.com`

Production:

```bash
npm run build
JWT_SECRET=<long random string> SEED_DEMO=false npm start   # serves UI + API on :3001
```

See `.env.example` for all settings. Data is stored in SQLite (`data/job-evaluation.db` by default).

## Development

```bash
npm test             # engine + API workflow tests (vitest + supertest)
npm run typecheck
```

```
shared/   scoring engine, level definitions, validation schemas (used by server and client)
server/   Express API, SQLite schema, auth (JWT cookie), JD analyser, demo seed
client/   React UI (Vite): three role panels, dashboards, forms
tests/    engine and API tests
```

Level definitions are an independent rendering of the publicly described Hay method, not Korn Ferry's licensed Guide Charts. This matches the note in the workbook.
