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
- **Multiple grade structures** (admin and management): keep separate structures for groups graded differently, such as blue and white collar, individual contributors and managers, or each company.
  - Each job is graded by the structure assigned to its position. If it has none, it uses its company's default structure, and otherwise the organisation default. Every evaluation, calibration, analysis and dashboard uses the job's own structure.
  - Create a structure from evenly spaced grades, as a copy of another, or from the 23 standard grades. Rename it, make it the organisation default, or delete it (its jobs fall back to their defaults).
  - Edit any structure's number of grades, minimum points, career levels and typical roles, with a **live impact preview** of how many of *its* jobs move up or down before saving.
  - **Applies to** tab: make a structure the default for one or more companies, and assign positions to it directly (search and filter, then bulk assign or reset to automatic). Positions can also be set on the Positions form or with a `gradeStructure` column in the CSV import.
  - Databases created before this feature are upgraded on start: the existing grades become the "Standard" default structure, with no change to any grade.
- **Positions grouped by grade**: every grade with its point range and the positions in it, optionally sub-grouped by company or department. When several structures are in use, the grade views show one structure at a time, with a picker.
- **Slicers** on company, department, role, grade structure, grade (labelled with its structure, e.g. "Blue collar · G5"), job family, career level, status and evaluator. They cascade (for example, choosing a company narrows the department list) and drive the KPIs, charts, grade groupings, data table and CSV export.
- **JD analyser** (every role): paste a job description or upload a **Word (.docx or .doc), PDF** or text file (up to 10 MB). The extracted text is shown for review before analysis, and a "Job title:" line in the document fills in the title. Scanned PDFs without a text layer are rejected with a clear message, since there is no OCR. The Positions form can load job descriptions from the same file types. The analyser then returns all eight element levels, each with its reasoning, plus points and grade from the same engine.
  - With `ANTHROPIC_API_KEY` set, Claude does the analysis using structured output. Without it, a transparent rule-based analyser is used, and the UI says which method ran.
  - Admin and management can save an analysis as an **independent evaluation**, linked to an existing position or a new one. It then goes into review and grading like any other evaluation.
  - Evaluators can apply the suggested levels to one of their assignments.
- **Multi-evaluator calibration**:
  - The admin can assign a job to several evaluators at once (or add evaluators to a job later). Each scores it independently and **blind**: evaluators never see other evaluations of the job, or how many evaluators there are.
  - Once management approves the calibration, each evaluator sees the job's **final calibrated result**: the agreed levels, points, grade and calibration note, with their own level shown beside any element that differs. They still never see the other evaluations. If the calibration is reopened, the result is hidden again until it is re-approved.
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
