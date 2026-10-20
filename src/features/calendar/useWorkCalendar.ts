import { useMemo } from 'react';
import { useApp } from '../../AppContext';
import { CALENDAR_DOC, calendarFrom, type WorkCalendar } from '../../lib/calendar';
import { readinessWorkspace } from '../../lib/readiness';
import { useDocument } from '../masters/useCollection';

/**
 * The company working-day calendar. It always lives in the ACTUAL workspace
 * (holidays are real company facts); Demo mode reads the same calendar.
 */
export function useWorkCalendar() {
  const app = useApp();
  const workspaceId = readinessWorkspace(app.user?.uid, app.workspaceId);
  const { item, loading, error } = useDocument<WorkCalendar>(workspaceId, 'settings', CALENDAR_DOC);
  const cal = useMemo(() => calendarFrom(item), [item]);
  return { cal, item, workspaceId, loading, error };
}
