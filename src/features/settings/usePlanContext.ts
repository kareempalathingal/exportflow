import { useMemo } from 'react';
import { useApp } from '../../AppContext';
import type { PlanContext } from '../../lib/route';
import { useWorkCalendar } from '../calendar/useWorkCalendar';
import { useMasterData } from '../masters/useMasterData';
import { useProfile } from './useProfile';

/** Everything plans need: masters, the working-day calendar and the planning benchmark. */
export function usePlanContext(): { ctx: PlanContext; master: ReturnType<typeof useMasterData>; company: string; preparedBy: { name: string; designation: string } } {
  const { workspaceId } = useApp();
  const master = useMasterData(workspaceId);
  const { cal } = useWorkCalendar();
  const { profile } = useProfile(workspaceId);
  const planningDays = profile?.planningDays;
  const ctx = useMemo(() => ({ md: master.md, cal, planningDays }), [master.md, cal, planningDays]);
  return {
    ctx,
    master,
    company: profile?.companyName?.value ?? '',
    preparedBy: { name: profile?.preparedByName ?? '', designation: profile?.preparedByDesignation ?? '' },
  };
}
