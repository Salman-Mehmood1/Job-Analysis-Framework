import type { EvaluationInputs, EvaluationResult, GradeBand } from '../../shared/engine';

export type Role = 'admin' | 'evaluator' | 'management';
export type Status = 'assigned' | 'in_progress' | 'submitted' | 'returned' | 'approved';

export interface User {
  id: number;
  orgId: number;
  role: Role;
  name: string;
  email: string;
}
export interface Organization {
  id: number;
  name: string;
  currencyNote?: string;
}

export interface Evaluation {
  id: number;
  position: { id: number; code: string; title: string; jobFamily: string; jobDescription: string };
  company: { id: number; name: string };
  department: { id: number; name: string };
  gradeStructure: StructureRef;
  evaluator: { id: number; name: string } | null;
  assignedBy: string | null;
  status: Status;
  dueDate: string | null;
  instructions: string;
  inputs: EvaluationInputs | null;
  rationale: string;
  source: 'manual' | 'jd_analysis';
  adjustedInputs: EvaluationInputs | null;
  adjustedBy: string | null;
  adjustedAt: string | null;
  reviewComment: string;
  submittedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  originalResult: EvaluationResult | null;
  result: EvaluationResult | null;
  /** Number of evaluations on this job (admin/management only). */
  raterCount?: number;
  /** Evaluator view only: the job's approved calibrated result, once management approves it. */
  calibrated?: { inputs: EvaluationInputs; result: EvaluationResult; comment: string; approvedAt: string } | null;
  history?: { id: number; action: string; details: Record<string, unknown>; at: string; user_name: string; user_role: string }[];
}

export type ElementKey = keyof EvaluationInputs;
export interface ElementConsensus {
  level: string;
  votes: number;
  total: number;
  distribution: Record<string, number>;
  disagreement: boolean;
}

/** One record per job (position), combining its evaluations. */
export interface JobRecord {
  id: number;
  position: Evaluation['position'];
  company: { id: number; name: string };
  department: { id: number; name: string };
  gradeStructure: StructureRef;
  mode: 'single' | 'multi';
  evaluationId: number | null;
  evaluators: { id: number | null; name: string }[];
  evaluationCount: number;
  completeCount: number;
  status: Status;
  basis: 'evaluation' | 'consensus' | 'adjusted_consensus' | 'calibrated';
  result: EvaluationResult | null;
  effectiveInputs: EvaluationInputs | null;
  adjusted: boolean;
  spread: { minPoints: number; maxPoints: number; minGrade: number; maxGrade: number } | null;
  calibration: {
    status: 'open' | 'approved';
    adjustedInputs: EvaluationInputs | null;
    finalInputs: EvaluationInputs | null;
    includedIds: number[];
    comment: string;
    updatedAt: string | null;
    updatedBy: string | null;
    approvedAt: string | null;
    approvedBy: string | null;
  } | null;
}

export interface JobDetail extends JobRecord {
  consensus: { inputs: EvaluationInputs; elements: Record<ElementKey, ElementConsensus>; raters: number } | null;
  evaluations: Evaluation[];
}

export interface OrgUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: number;
  assigned: number;
  completed: number;
}
export interface Company {
  id: number;
  name: string;
  defaultStructureId: number | null;
}

/** Which grade structure grades a job, and why. */
export interface StructureRef {
  id: number;
  name: string;
  source: 'position' | 'company' | 'organisation';
}

export interface GradeStructure {
  id: number;
  name: string;
  description: string;
  isDefault: boolean;
  bands: GradeBand[];
  /** Companies that use this structure as their default. */
  companyIds: number[];
  /** Positions graded by this structure (assigned directly or by default). */
  positionCount: number;
  /** Positions assigned to it directly. */
  explicitCount: number;
}
export interface Department {
  id: number;
  name: string;
  companyId: number;
  companyName: string;
}
export interface Position {
  id: number;
  code: string;
  title: string;
  jobFamily: string;
  jobDescription: string;
  companyId: number;
  companyName: string;
  departmentId: number;
  departmentName: string;
  evaluations: number;
  gradeStructureId: number | null;
  gradeStructure: StructureRef;
}

export interface JdAnalysis {
  method: 'ai' | 'rules';
  model?: string;
  inputs: EvaluationInputs;
  rationale: Record<string, { level: string; reason: string }>;
  summary: string;
  confidence: 'low' | 'medium' | 'high';
  suggested: { title: string; department: string; jobFamily: string };
  warnings: string[];
}
export interface SavedAnalysis {
  id: number;
  title: string;
  jdText: string;
  method: string;
  createdAt: string;
  positionId: number | null;
  positionCode: string | null;
  userName: string;
  userRole: Role;
  analysis: JdAnalysis;
  score: EvaluationResult;
  gradeStructure: { id: number; name: string };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText);
  return data as T;
}

/** Upload a Word, PDF or text file and get its text back. */
export async function extractJdFile(file: File): Promise<{ text: string; kind: string; pages?: number; filename: string; title: string | null }> {
  const res = await fetch(`/api/jd/extract?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText);
  return data;
}

/** File types the JD upload accepts. */
export const JD_FILE_ACCEPT =
  '.docx,.doc,.pdf,.txt,.md,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain';

export const api = {
  get: <T>(url: string) => call<T>('GET', url),
  post: <T>(url: string, body: unknown = {}) => call<T>('POST', url, body),
  put: <T>(url: string, body: unknown) => call<T>('PUT', url, body),
  patch: <T>(url: string, body: unknown) => call<T>('PATCH', url, body),
  del: <T>(url: string) => call<T>('DELETE', url),
};

export type { EvaluationInputs, EvaluationResult, GradeBand };
