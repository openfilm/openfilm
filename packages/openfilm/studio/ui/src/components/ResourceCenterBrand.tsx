import { PanelsTopLeft } from 'lucide-react';
import { useT } from '@/i18n';
import styles from './ProjectsView.module.css';

export function ResourceCenterBrand() {
  const t = useT();
  return (
    <div className={styles.brand}>
      <span className={styles.brandMark}><PanelsTopLeft size={18} strokeWidth={1.6} /></span>
      <div><strong>{t('resourceCenter.title')}</strong><span>OPENFILM</span></div>
    </div>
  );
}
