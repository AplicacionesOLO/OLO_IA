export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  email_sent_at: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationList {
  notifications: AppNotification[];
  unread_count: number;
}
