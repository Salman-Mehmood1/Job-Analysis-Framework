import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { JOB_INFO_FIELDS, type JobInfo, QUESTIONNAIRE, RESPONDENT_QUESTIONS } from '../../../shared/questionnaire';
import { type MyQuestionnaire, RESPONDENT_ROLE_LABEL, api } from '../api';
import { QuestionBlock } from '../components/QuestionBlock';
import { ErrorAlert, fmtDate } from '../components/ui';
import { useData } from '../hooks';

const STATUS_TEXT = { invited: 'Not started', in_progress: 'In progress', submitted: 'Submitted' } as const;
const STATUS_CLASS = { invited: 'b-assigned', in_progress: 'b-in_progress', submitted: 'b-approved' } as const;
const TOTAL = RESPONDENT_QUESTIONS.length;

export function MyQuestionnairesPage() {
  const nav = useNavigate();
  const { data, error, loading } = useData<MyQuestionnaire[]>('/questionnaire-responses/mine');
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>My questionnaires</h1>
          <p className="muted">
            Jobs you have been asked to describe, as the job holder or as the line manager. Rate the job as it is designed, not the person doing it.
            Your answers are confidential to the evaluation team.
          </p>
        </div>
      </div>
      <ErrorAlert error={error} />
      <div className="grid grid-2">
        {(data ?? []).map((q) => (
          <div className="card clickable" key={q.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/respondent/questionnaires/${q.id}`)}>
            <div className="row spread">
              <h2 style={{ margin: 0 }}>{q.position.code} · {q.position.title}</h2>
              <span className={`badge ${STATUS_CLASS[q.status]}`}>{STATUS_TEXT[q.status]}</span>
            </div>
            <p className="muted small" style={{ margin: '4px 0 8px' }}>
              {q.position.companyName} / {q.position.departmentName} · as <strong>{RESPONDENT_ROLE_LABEL[q.role]}</strong>
              {q.dueDate && <> · due {fmtDate(q.dueDate)}</>}
            </p>
            <div className="progress" aria-label="Questions answered"><div style={{ width: `${((q.answered ?? 0) / TOTAL) * 100}%` }} /></div>
            <div className="small muted" style={{ marginTop: 4 }}>{q.answered ?? 0} of {TOTAL} questions answered</div>
          </div>
        ))}
        {!loading && !data?.length && <div className="card muted">No questionnaires for you right now.</div>}
      </div>
    </div>
  );
}

type Section = 'info' | (typeof QUESTIONNAIRE)[number]['id'] | 'complex' | 'review';

export function RespondQuestionnairePage() {
  const { id } = useParams();
  const q = useData<MyQuestionnaire>(`/questionnaire-responses/mine/${id}`);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [jobInfo, setJobInfo] = useState<JobInfo>({});
  const [complexProblem, setComplexProblem] = useState('');
  const [section, setSection] = useState<Section>('info');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const d = q.data;
  useEffect(() => {
    if (d) {
      setAnswers(d.answers);
      setJobInfo(d.jobInfo);
      setComplexProblem(d.complexProblem);
      setDirty(false);
    }
  }, [d]);

  const readOnly = d?.status === 'submitted';
  const answeredIn = (elId: string) => RESPONDENT_QUESTIONS.filter((x) => x.element.id === elId && answers[x.id]).length;
  const answered = useMemo(() => RESPONDENT_QUESTIONS.filter((x) => answers[x.id]).length, [answers]);

  const save = async (quiet = false) => {
    if (!d || readOnly) return;
    setBusy(true);
    setError(null);
    try {
      await api.put(`/questionnaire-responses/mine/${d.id}`, { answers, jobInfo, complexProblem });
      setDirty(false);
      if (!quiet) setNotice('Saved. You can come back and finish later.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const go = async (s: Section) => {
    if (dirty) await save(true);
    setNotice(null);
    setSection(s);
    window.scrollTo({ top: 0 });
  };
  const submit = async () => {
    if (!d) return;
    const missing = TOTAL - answered;
    if (missing && !confirm(`${missing} question(s) are unanswered. The evaluator will rely on the other ratings for those. Submit anyway?`)) return;
    if (!missing && !confirm('Submit your questionnaire? You cannot change it afterwards.')) return;
    setBusy(true);
    setError(null);
    try {
      await api.put(`/questionnaire-responses/mine/${d.id}`, { answers, jobInfo, complexProblem });
      await api.post(`/questionnaire-responses/mine/${d.id}/submit`);
      q.reload();
      setNotice('Thank you, your questionnaire has been submitted.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (q.error) return <ErrorAlert error={q.error} />;
  if (!d) return <div className="muted">Loading…</div>;

  const sections: { key: Section; label: string; done?: boolean }[] = [
    { key: 'info', label: '1 · Job information', done: Object.values(jobInfo).some((v) => v?.trim()) },
    ...QUESTIONNAIRE.map((el) => ({ key: el.id as Section, label: el.code, done: answeredIn(el.id) === el.questions.filter((x) => !x.evaluatorOnly).length })),
    { key: 'complex', label: 'Most complex problem', done: !!complexProblem.trim() },
    { key: 'review', label: 'Review & submit' },
  ];
  const el = QUESTIONNAIRE.find((x) => x.id === section);
  const idx = sections.findIndex((s) => s.key === section);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="small"><Link to="/respondent">← My questionnaires</Link></div>
          <h1>{d.position.code} · {d.position.title}</h1>
          <div className="row">
            <span className={`badge ${STATUS_CLASS[d.status]}`}>{STATUS_TEXT[d.status]}</span>
            <span className="muted">{d.position.companyName} / {d.position.departmentName} · you are the <strong>{RESPONDENT_ROLE_LABEL[d.role].toLowerCase()}</strong></span>
            {d.dueDate && <span className="muted">· due {fmtDate(d.dueDate)}</span>}
          </div>
        </div>
        {!readOnly && (
          <div className="row">
            <button disabled={busy || !dirty} onClick={() => save()}>Save draft</button>
            <button className="primary" disabled={busy} onClick={submit}>Submit</button>
          </div>
        )}
      </div>
      <ErrorAlert error={error} />
      {notice && <div className="alert ok">{notice}</div>}
      {readOnly ? (
        <div className="alert info">Submitted {fmtDate(d.submittedAt)}. Your answers are now with the evaluator.</div>
      ) : d.role === 'JH' ? (
        <div className="alert info">
          Taking part is optional but helps the evaluation. Answer each question for the job as it is designed, not for yourself.
          Skip anything you are unsure of; the evaluator and your line manager also rate the job.
        </div>
      ) : (
        <div className="alert info">
          Rate the job independently. You will not see the job holder’s ratings, but you can check the job information they gave.
        </div>
      )}

      <div className="row" style={{ marginBottom: 8 }}>
        <div className="progress" style={{ flex: 1 }}><div style={{ width: `${(answered / TOTAL) * 100}%` }} /></div>
        <span className="small muted">{answered} of {TOTAL} questions answered</span>
      </div>
      <div className="section-nav" role="tablist">
        {sections.map((s) => (
          <button key={s.key} role="tab" aria-selected={section === s.key} className={`choice${section === s.key ? ' on' : ''}`} onClick={() => go(s.key)}>
            {s.done && section !== s.key ? '✓ ' : ''}{s.label}
          </button>
        ))}
      </div>

      <div className="card">
        {section === 'info' && (
          <div className="stack">
            <h2>Part 2 · Job information</h2>
            <p className="muted small">The evidence the evaluator uses to rate each question. {d.role === 'LM' ? 'Add or correct anything the job holder gave.' : ''}</p>
            {d.role === 'LM' && !!d.jobHolderInfo?.length && (
              <div className="score-box">
                <strong>From the job holder{d.jobHolderInfo.length > 1 ? 's' : ''}</strong>
                {d.jobHolderInfo.map((j) => (
                  <div key={j.name} style={{ marginTop: 6 }}>
                    <div className="small muted">{j.name}</div>
                    {JOB_INFO_FIELDS.filter((f) => j.jobInfo[f.key]).map((f) => (
                      <p key={f.key} className="small" style={{ margin: '2px 0' }}><strong>{f.label}:</strong> <span style={{ whiteSpace: 'pre-wrap' }}>{j.jobInfo[f.key]}</span></p>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {JOB_INFO_FIELDS.map((f) => (
              <label key={f.key} className="field">
                {f.label}{'hint' in f && f.hint ? ` · ${f.hint}` : ''}
                {'rows' in f && f.rows ? (
                  <textarea rows={f.rows} disabled={readOnly} value={jobInfo[f.key] ?? ''} onChange={(e) => { setJobInfo({ ...jobInfo, [f.key]: e.target.value }); setDirty(true); }} />
                ) : (
                  <input disabled={readOnly} value={jobInfo[f.key] ?? ''} onChange={(e) => { setJobInfo({ ...jobInfo, [f.key]: e.target.value }); setDirty(true); }} />
                )}
              </label>
            ))}
            {d.position.jobDescription && (
              <details><summary className="small">Job description on file</summary><pre className="wrap small">{d.position.jobDescription}</pre></details>
            )}
          </div>
        )}

        {el && (
          <div>
            <h2>{el.code} · {el.name}</h2>
            <p className="muted small">{el.intro} Choose one option per question.</p>
            {el.questions.map((qu, i) =>
              qu.evaluatorOnly ? (
                <div key={qu.id} className="q-block small muted">
                  Q{i + 1}. The evaluator rates the most complex problem example you describe in the “Most complex problem” section.
                </div>
              ) : (
                <QuestionBlock
                  key={qu.id}
                  number={i + 1}
                  question={qu}
                  codes={el.codes}
                  value={answers[qu.id]}
                  readOnly={readOnly}
                  onChange={(v) => { setAnswers({ ...answers, [qu.id]: v }); setDirty(true); }}
                />
              ),
            )}
          </div>
        )}

        {section === 'complex' && (
          <div className="stack">
            <h2>Most complex problem</h2>
            <p className="muted small">
              Describe the most complex problem the job dealt with in the last 12 months: the situation, why it was difficult, what thinking was needed and how it was resolved.
            </p>
            {d.role === 'LM' && d.jobHolderInfo?.some((j) => j.complexProblem) && (
              <div className="score-box small">
                {d.jobHolderInfo.filter((j) => j.complexProblem).map((j) => (
                  <p key={j.name} style={{ margin: '2px 0' }}><strong>{j.name} (job holder):</strong> {j.complexProblem}</p>
                ))}
              </div>
            )}
            <textarea rows={8} disabled={readOnly} value={complexProblem} onChange={(e) => { setComplexProblem(e.target.value); setDirty(true); }} />
          </div>
        )}

        {section === 'review' && (
          <div>
            <h2>Review</h2>
            <table>
              <thead><tr><th>Section</th><th className="num">Answered</th></tr></thead>
              <tbody>
                <tr><td>Job information</td><td className="num">{JOB_INFO_FIELDS.filter((f) => jobInfo[f.key]?.trim()).length} of {JOB_INFO_FIELDS.length} fields</td></tr>
                {QUESTIONNAIRE.map((x) => (
                  <tr key={x.id}><td>{x.code} · {x.name}</td><td className="num">{answeredIn(x.id)} of {x.questions.filter((y) => !y.evaluatorOnly).length}</td></tr>
                ))}
                <tr><td>Most complex problem</td><td className="num">{complexProblem.trim() ? 'Done' : '—'}</td></tr>
              </tbody>
            </table>
            {!readOnly && (
              <div className="row" style={{ marginTop: 12 }}>
                <button className="primary" disabled={busy} onClick={submit}>Submit questionnaire</button>
                <span className="small muted">After submitting you can no longer change your answers.</span>
              </div>
            )}
          </div>
        )}

        <div className="row spread" style={{ marginTop: 16 }}>
          <button disabled={idx <= 0} onClick={() => go(sections[idx - 1].key)}>← Previous</button>
          {idx < sections.length - 1 && <button className="primary" onClick={() => go(sections[idx + 1].key)}>{readOnly ? 'Next' : 'Save & next'} →</button>}
        </div>
      </div>
    </div>
  );
}
