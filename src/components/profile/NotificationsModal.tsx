import { Bell, Flame, MessageCircle, Megaphone, AlertCircle, CheckCheck, UserPlus, Smile, BadgeCheck, ShieldAlert, CalendarDays, type LucideIcon } from 'lucide-react';
import Modal from '@/components/Modal';
import { timeAgo } from '@/lib/time';
import type { NotificationType } from '@/lib/types';
import type { useNotifications } from '@/hooks/useNotifications';
import { ListSkeleton } from '@/components/Skeleton';

const typeStyle: Record<NotificationType, { icon: LucideIcon; color: string }> = {
  venue_live: { icon: Flame, color: 'text-wa-live bg-wa-live/10' }, // never shown (useNotifications), kept for the type
  community: { icon: MessageCircle, color: 'text-wa-green bg-wa-green/10' },
  comment: { icon: MessageCircle, color: 'text-wa-green bg-wa-green/10' },
  reaction: { icon: Smile, color: 'text-wa-busy bg-wa-busy/10' },
  follow: { icon: UserPlus, color: 'text-wa-green bg-wa-green/10' },
  official_post: { icon: BadgeCheck, color: 'text-wa-green bg-wa-green/10' },
  event: { icon: CalendarDays, color: 'text-wa-busy bg-wa-busy/10' },
  moderation: { icon: ShieldAlert, color: 'text-wa-live bg-wa-live/10' },
  system: { icon: Megaphone, color: 'text-wa-busy bg-wa-busy/10' },
};

type Props = {
  onClose: () => void;
  feed: ReturnType<typeof useNotifications>;
};

export default function NotificationsModal({ onClose, feed }: Props) {
  const { notifications, readIds, unreadCount, loading, error, hiddenByPreferences, markRead, markAllRead } = feed;

  return (
    <Modal title="Notifications" icon={Bell} onClose={onClose}>
      {loading ? (
        <ListSkeleton label="Loading notifications" />
      ) : error ? (
        <div className="flex flex-col items-center py-12">
          <AlertCircle className="w-9 h-9 text-wa-live" />
          <p className="text-sm text-wa-lightTextSecondary dark:text-wa-darkTextSecondary mt-3 text-center">
            Could not load notifications. Please try again.
          </p>
        </div>
      ) : (
        <>
          {notifications.length > 0 && (
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-wa-lightTextSecondary dark:text-wa-darkTextSecondary">
                {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
              </span>
              <button
                onClick={markAllRead}
                disabled={unreadCount === 0}
                className="flex items-center gap-1 text-xs font-semibold text-wa-green disabled:opacity-40"
              >
                <CheckCheck className="w-4 h-4" />
                Mark all read
              </button>
            </div>
          )}

          {notifications.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <Bell className="w-10 h-10 text-wa-quiet mb-3" />
              <p className="text-sm font-medium text-wa-lightTextSecondary dark:text-wa-darkTextSecondary">
                No notifications
              </p>
              <p className="text-xs text-wa-lightTextSecondary dark:text-wa-darkTextSecondary mt-1 max-w-xs">
                {hiddenByPreferences > 0
                  ? 'You have turned off these alert types in Settings.'
                  : 'Alerts and updates will show up here.'}
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {notifications.map((n) => {
                const { icon: Icon, color } = typeStyle[n.type] ?? typeStyle.system;
                const unread = !readIds.has(n.id);
                return (
                  <li key={n.id}>
                    <button
                      onClick={() => markRead(n.id)}
                      className={`w-full flex items-start gap-3 text-left rounded-xl p-3 border transition-colors ${
                        unread
                          ? 'bg-wa-green/5 border-wa-green/30'
                          : 'bg-wa-light dark:bg-wa-dark border-wa-lightBorder dark:border-wa-darkBorder'
                      }`}
                    >
                      <span className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${color}`}>
                        <Icon className="w-4 h-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-wa-lightText dark:text-wa-darkText truncate">
                            {n.title}
                          </span>
                          {unread && <span className="h-2 w-2 rounded-full bg-wa-green flex-shrink-0" />}
                        </span>
                        {n.body && (
                          <span className="block text-xs text-wa-lightTextSecondary dark:text-wa-darkTextSecondary mt-0.5 leading-relaxed">
                            {n.body}
                          </span>
                        )}
                      </span>
                      <span className="text-[11px] text-wa-lightTextSecondary dark:text-wa-darkTextSecondary flex-shrink-0">
                        {timeAgo(n.created_at)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Modal>
  );
}
