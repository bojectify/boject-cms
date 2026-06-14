import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

export function useContentTable() {
  function formatDate(date: string | number) {
    const d = dayjs(date);
    if (dayjs().diff(d, 'day') < 7) {
      return `${d.fromNow()} at ${d.format('HH:mm')}`;
    }
    return d.format('DD MMM YYYY, HH:mm');
  }

  const statusColor: Record<
    string,
    'success' | 'warning' | 'info' | 'neutral'
  > = {
    PUBLISHED: 'success',
    CHANGED: 'warning',
    DRAFT: 'info',
    ARCHIVED: 'neutral',
  };

  return { formatDate, statusColor };
}
