import { useT } from '@/i18n';
import styles from './ProjectsView.module.css';

export function ResourceCenterBrand() {
  const t = useT();
  return <div className={styles.brand}><strong>{t('resourceCenter.title')}</strong></div>;
}
