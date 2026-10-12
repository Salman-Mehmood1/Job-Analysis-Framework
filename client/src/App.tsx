import type { ReactNode } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import type { MyQuestionnaire, Role } from './api';
import { useAuth, useData } from './hooks';
import AnalyticsPage from './pages/AnalyticsPage';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import EvaluationDetailPage from './pages/EvaluationDetailPage';
import EvaluationsAdminPage from './pages/EvaluationsAdminPage';
import EvaluatePage from './pages/EvaluatePage';
import GradesPage from './pages/GradesPage';
import JdAnalyzerPage from './pages/JdAnalyzerPage';
import JobCalibrationPage from './pages/JobCalibrationPage';
import { MyEvaluationsPage, MyResultsPage } from './pages/EvaluatorPages';
import OrganizationPage from './pages/OrganizationPage';
import PositionsPage from './pages/PositionsPage';
import ReviewQueuePage from './pages/ReviewQueuePage';
import { MyQuestionnairesPage, RespondQuestionnairePage } from './pages/RespondentPages';
import UsersPage from './pages/UsersPage';

export const HOME: Record<Role, string> = { admin: '/admin', evaluator: '/evaluator', management: '/management', respondent: '/respondent' };

const NAV: Record<Role, { to: string; label: string; end?: boolean }[]> = {
  admin: [
    { to: '/admin', label: 'Dashboard', end: true },
    { to: '/admin/evaluations', label: 'Evaluations & assignments' },
    { to: '/admin/positions', label: 'Positions' },
    { to: '/admin/organization', label: 'Companies & departments' },
    { to: '/admin/users', label: 'Users' },
    { to: '/admin/grades', label: 'Grade structures' },
    { to: '/admin/jd', label: 'JD analyser' },
  ],
  evaluator: [
    { to: '/evaluator', label: 'My assignments', end: true },
    { to: '/evaluator/results', label: 'My results' },
    { to: '/evaluator/jd', label: 'JD analyser' },
  ],
  respondent: [{ to: '/respondent', label: 'My questionnaires', end: true }],
  management: [
    { to: '/management', label: 'Dashboard', end: true },
    { to: '/management/review', label: 'Review & calibration' },
    { to: '/management/grades', label: 'Grade structures' },
    { to: '/management/jd', label: 'JD analyser' },
  ],
};

const PANEL_NAME: Record<Role, string> = {
  admin: 'Administrator panel',
  evaluator: 'Evaluator panel',
  management: 'Management panel',
  respondent: 'Job holder & line manager panel',
};

/** Staff can also be asked to answer a job's questionnaire as its line manager or job holder. */
function StaffQuestionnairesLink({ role }: { role: Role }) {
  const mine = useData<MyQuestionnaire[]>('/questionnaire-responses/mine');
  const list = mine.data ?? [];
  if (!list.length) return null;
  const open = list.filter((q) => q.status !== 'submitted').length;
  return <NavLink to={`${HOME[role]}/questionnaires`}>My questionnaires{open ? ` (${open})` : ''}</NavLink>;
}

function Panel({ role }: { role: Role }) {
  const { user, organization, logout } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={HOME[user.role]} replace />;
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Job Evaluation</div>
        <div className="brand-sub">{organization?.name}</div>
        <span className="panel-tag">{PANEL_NAME[role]}</span>
        <nav className="nav">
          {NAV[role].map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              {n.label}
            </NavLink>
          ))}
          {role !== 'respondent' && <StaffQuestionnairesLink role={role} />}
        </nav>
        <div className="sidebar-foot">
          <div>{user.name}</div>
          <button onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}

function Public({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user ? <Navigate to={HOME[user.role]} replace /> : <>{children}</>;
}

export default function App() {
  const { ready, user } = useAuth();
  if (!ready) return <div className="auth-wrap muted">Loading…</div>;
  return (
    <Routes>
      <Route path="/login" element={<Public><LoginPage /></Public>} />
      <Route path="/register" element={<Public><RegisterPage /></Public>} />

      <Route path="/admin" element={<Panel role="admin" />}>
        <Route index element={<AnalyticsPage />} />
        <Route path="evaluations" element={<EvaluationsAdminPage />} />
        <Route path="evaluations/:id" element={<EvaluationDetailPage />} />
        <Route path="jobs/:positionId" element={<JobCalibrationPage />} />
        <Route path="positions" element={<PositionsPage />} />
        <Route path="organization" element={<OrganizationPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="grades" element={<GradesPage />} />
        <Route path="jd" element={<JdAnalyzerPage />} />
        <Route path="respondents" element={<Navigate to="/admin/evaluations?tab=requests" replace />} />
        <Route path="questionnaires" element={<MyQuestionnairesPage />} />
        <Route path="questionnaires/:id" element={<RespondQuestionnairePage />} />
      </Route>

      <Route path="/evaluator" element={<Panel role="evaluator" />}>
        <Route index element={<MyEvaluationsPage />} />
        <Route path="evaluations/:id" element={<EvaluatePage />} />
        <Route path="results" element={<MyResultsPage />} />
        <Route path="jd" element={<JdAnalyzerPage />} />
        <Route path="questionnaires" element={<MyQuestionnairesPage />} />
        <Route path="questionnaires/:id" element={<RespondQuestionnairePage />} />
      </Route>

      <Route path="/respondent" element={<Panel role="respondent" />}>
        <Route index element={<MyQuestionnairesPage />} />
        <Route path="questionnaires/:id" element={<RespondQuestionnairePage />} />
      </Route>

      <Route path="/management" element={<Panel role="management" />}>
        <Route index element={<AnalyticsPage />} />
        <Route path="review" element={<ReviewQueuePage />} />
        <Route path="evaluations/:id" element={<EvaluationDetailPage />} />
        <Route path="jobs/:positionId" element={<JobCalibrationPage />} />
        <Route path="grades" element={<GradesPage />} />
        <Route path="jd" element={<JdAnalyzerPage />} />
        <Route path="respondents" element={<Navigate to="/management/review?tab=requests" replace />} />
        <Route path="questionnaires" element={<MyQuestionnairesPage />} />
        <Route path="questionnaires/:id" element={<RespondQuestionnairePage />} />
      </Route>

      <Route path="*" element={<Navigate to={user ? HOME[user.role] : '/login'} replace />} />
    </Routes>
  );
}
