import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { useApp } from '../AppContext';

let updateSW: ((reload?: boolean) => Promise<void>) | null = null;

export function UpdatePrompt() {
  const { t } = useApp();
  const [needRefresh, setNeedRefresh] = useState(false);

  useEffect(() => {
    if (updateSW || !('serviceWorker' in navigator)) return;
    updateSW = registerSW({
      onNeedRefresh: () => setNeedRefresh(true),
    });
  }, []);

  if (!needRefresh) return null;
  return (
    <div className="update-bar" role="status">
      <span>{t('updateReady')}</span>
      <button className="small" onClick={() => void updateSW?.(true)}>
        {t('reload')}
      </button>
    </div>
  );
}
