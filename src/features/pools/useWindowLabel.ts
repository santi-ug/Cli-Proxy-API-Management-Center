import { useTranslation } from 'react-i18next';
import type { UsageColumn } from './model';

/** Translated name of a usage window, shared by account cells and provider totals. */
export function useWindowLabel() {
  const { t } = useTranslation();
  return (column: Pick<UsageColumn, 'kind' | 'model'>) =>
    column.kind === 'model-weekly' && column.model
      ? t('pools.window_model_weekly', { model: column.model })
      : t(`pools.window_${column.kind.replace('-', '_')}`);
}
