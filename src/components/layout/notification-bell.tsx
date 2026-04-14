'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Fetch on mount and every 60 s
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  async function fetchNotifications() {
    try {
      const res = await fetch('/api/notifications');
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications ?? []);
      setUnread((data.notifications ?? []).filter((n: Notification) => !n.read).length);
    } catch {
      // silent fail
    }
  }

  async function markAllRead() {
    setLoading(true);
    await fetch('/api/notifications/read', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    });
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
    setLoading(false);
  }

  async function markRead(id: string) {
    await fetch('/api/notifications/read', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    setUnread((prev) => Math.max(0, prev - 1));
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        className="btn-secondary relative inline-flex items-center justify-center"
        aria-label="Notifications"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-line bg-background shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button
                className="text-xs text-accent hover:underline disabled:opacity-50"
                onClick={markAllRead}
                disabled={loading}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted">
                No notifications yet
              </div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  className={`w-full cursor-pointer px-4 py-3 text-left transition hover:bg-white/5 ${!n.read ? 'bg-accent/5' : ''}`}
                  onClick={() => !n.read && markRead(n.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className={`text-sm font-medium ${!n.read ? 'text-foreground' : 'text-muted'}`}>
                      {n.title}
                    </span>
                    {!n.read && (
                      <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-accent" />
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted line-clamp-2">{n.message}</p>
                  <p className="mt-1 text-[11px] text-muted/60">{timeAgo(n.createdAt)}</p>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
