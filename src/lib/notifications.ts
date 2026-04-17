/**
 * Unified notification service — saves in-app notifications and optionally
 * sends transactional email via Resend.
 */

import { prisma } from '@/lib/prisma';
import { logImportantInfo, logImportantError } from '@/lib/observability';
import { sendNotificationEmail } from '@/lib/email';

export type NotificationType =
  | 'queue'
  | 'follow_up'
  | 'streak'
  | 'system'
  | 'queue_reminder'
  | 'follow_up_due'
  | 'interview_upcoming';

export interface CreateNotificationInput {
  type: NotificationType;
  title: string;
  message: string;
  /** If true, also send an email to the user */
  sendEmail?: boolean;
}

/** Create an in-app notification and optionally send an email. */
export async function createNotification(
  userId: string,
  input: CreateNotificationInput,
): Promise<void> {
  const { type, title, message, sendEmail = false } = input;

  let emailSent = false;

  // Persist in-app notification
  const note = await prisma.notification.create({
    data: { userId, type, title, message, emailSent: false },
  });

  // Send email if requested
  if (sendEmail) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (user?.email) {
        await sendNotificationEmail(user.email, title, message);
        emailSent = true;
        await prisma.notification.update({
          where: { id: note.id },
          data: { emailSent: true },
        });
        await logImportantInfo({
          event: 'notification_email_sent',
          userId,
          context: { type, title },
        });
      }
    } catch (err) {
      await logImportantError({
        event: 'notification_email_failed',
        userId,
        error: err,
        context: { type, title },
      });
    }
  }

  await logImportantInfo({
    event: 'notification_created',
    userId,
    context: { type, title, emailSent },
  });
}

/** Mark a single notification as read. */
export async function markNotificationRead(id: string): Promise<void> {
  await prisma.notification.update({ where: { id }, data: { read: true } });
}

/** Mark all unread notifications for a user as read. */
export async function markAllNotificationsRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
}

/** Get the latest 30 notifications for a user. */
export async function getUserNotifications(userId: string) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: {
      id: true,
      type: true,
      title: true,
      message: true,
      read: true,
      createdAt: true,
    },
  });
}

/** Count unread notifications for a user. */
export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, read: false } });
}
