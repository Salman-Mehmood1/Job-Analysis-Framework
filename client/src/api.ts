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
  history?: { id: number; action: string; details: Record<string, unknown>; at: string; user_name: string; user_role: string }[];
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

export const api = {
  get: <T>(url: string) => call<T>('GET', url),
  post: <T>(url: string, body: unknown = {}) => call<T>('POST', url, body),
  put: <T>(url: string, body: unknown) => call<T>('PUT', url, body),
  patch: <T>(url: string, body: unknown) => call<T>('PATCH', url, body),
  del: <T>(url: string) => call<T>('DELETE', url),
};

export type { EvaluationInputs, EvaluationResult, GradeBand };
