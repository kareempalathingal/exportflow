import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../AppContext';

/** Common frame for master forms: title, back link, active toggle, reason, save. */
export function FormShell(props: {
  title: string;
  backTo: string;
  isNew: boolean;
  active: boolean;
  onActiveChange: (v: boolean) => void;
  rev?: number;
  pending?: boolean;
  error: string | null;
  warning?: string | null;
  onSave: (reason: string) => boolean; // returns true when saved
  children: ReactNode;
}) {
  const { t } = useApp();
  const [reason, setReason] = useState('');
  const [saved, setSaved] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (props.onSave(reason)) {
      setReason('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  }

  return (
    <section>
      <p>
        <Link to={props.backTo} className="small">
          ← Back
        </Link>
      </p>
      <h2>{props.title}</h2>
      <form className="card" onSubmit={submit} noValidate>
        {props.children}
        {!props.isNew && (
          <label className="check">
            <input type="checkbox" checked={props.active} onChange={(e) => props.onActiveChange(e.target.checked)} /> Active
            <span className="muted small"> — inactive items are hidden from new Job Orders; history is kept</span>
          </label>
        )}
        {!props.isNew && (
          <label>
            {t('reasonOptional')}
            <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </label>
        )}
        {props.warning && <p className="warn small">{props.warning}</p>}
        {props.error && (
          <p className="error" role="alert">
            {props.error}
          </p>
        )}
        <div className="row between">
          <span className="muted small">
            {!props.isNew && `${t('rev')} ${props.rev ?? 0}`}
            {props.pending && <span className="badge pending inline">{t('PENDING')}</span>}
          </span>
          <button className="primary" type="submit">
            {t('save')}
          </button>
        </div>
        {saved && <p className="ok small">{t('saved')}</p>}
      </form>
    </section>
  );
}
