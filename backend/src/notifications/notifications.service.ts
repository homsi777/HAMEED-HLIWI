import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import webpush from 'web-push';
import type { AuthIdentity } from '../auth/auth.service.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { appSettings, permissions, pushSubscriptions, rolePermissions, userRoles } from '../database/schema.js';

type SubscriptionInput = { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
type PushMessage = { title: string; body: string; url?: string; tag: string };

@Injectable()
export class NotificationsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private vapid() {
    const publicKey = process.env.WEB_PUSH_PUBLIC_KEY?.trim();
    const privateKey = process.env.WEB_PUSH_PRIVATE_KEY?.trim();
    const subject = process.env.WEB_PUSH_SUBJECT?.trim() || 'mailto:admin@hameed-hliwi.org';
    if (!publicKey || !privateKey) return null;
    webpush.setVapidDetails(subject, publicKey, privateKey);
    return publicKey;
  }

  publicKey() { return this.vapid(); }

  async subscribe(user: AuthIdentity, input: SubscriptionInput, userAgent?: string) {
    if (!this.vapid()) throw new Error('Push notifications are not configured on the server.');
    const endpoint = typeof input.endpoint === 'string' ? input.endpoint.trim() : '';
    const p256dh = typeof input.keys?.p256dh === 'string' ? input.keys.p256dh : '';
    const auth = typeof input.keys?.auth === 'string' ? input.keys.auth : '';
    if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) throw new Error('Push subscription is invalid.');
    await this.db.insert(pushSubscriptions).values({ userId: user.id, endpoint, p256dh, auth, userAgent: userAgent?.slice(0, 500) })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: user.id, p256dh, auth, userAgent: userAgent?.slice(0, 500), lastSeenAt: new Date(), updatedAt: new Date() } });
    return { enabled: true };
  }

  async unsubscribe(user: AuthIdentity, endpoint: unknown) {
    if (typeof endpoint !== 'string' || !endpoint) return;
    await this.db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.endpoint, endpoint)));
  }

  async notifySaleBySeller(user: AuthIdentity, sale: { invoiceNumber: string; customerName: string; totalUSD: number }) {
    // A general manager saving their own invoice does not need to notify themselves as a seller.
    if (user.permissions.includes('backups.manage')) return;
    await this.sendToManagers({ title: 'فاتورة بيع جديدة', body: `${user.fullName} حفظ الفاتورة ${sale.invoiceNumber} للعميل ${sale.customerName} بقيمة $ ${sale.totalUSD.toFixed(2)}`, url: '/?tab=history', tag: `sale-${sale.invoiceNumber}` });
  }

  async sendBackupReminders() {
    if (!this.vapid()) return { sent: 0, reason: 'not_configured' };
    const [settings] = await this.db.select().from(appSettings).limit(1);
    if (!settings?.backupReminderEnabled) return { sent: 0, reason: 'disabled' };
    const intervalMs = settings.backupReminderIntervalHours * 60 * 60 * 1000;
    if (settings.backupReminderLastSentAt && Date.now() - settings.backupReminderLastSentAt.getTime() < intervalMs) return { sent: 0, reason: 'not_due' };
    const sent = await this.sendToManagers({ title: 'تذكير بالنسخة الاحتياطية', body: 'احفظ نسخة احتياطية على هاتفك الآن من قسم الإعدادات.', url: '/?tab=settings', tag: 'backup-reminder' });
    if (sent) await this.db.update(appSettings).set({ backupReminderLastSentAt: new Date(), updatedAt: new Date() }).where(eq(appSettings.id, settings.id));
    return { sent, reason: sent ? 'sent' : 'no_manager_device' };
  }

  private async sendToManagers(message: PushMessage) {
    if (!this.vapid()) return 0;
    const managerRows = await this.db.select({ userId: userRoles.userId }).from(userRoles)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(permissions.code, 'backups.manage'));
    const managerIds = [...new Set(managerRows.map(row => row.userId))];
    if (!managerIds.length) return 0;
    const subscriptions = await this.db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, managerIds));
    const payload = JSON.stringify(message);
    const outcomes = await Promise.all(subscriptions.map(async subscription => {
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, { TTL: 60 * 60 * 12, urgency: 'high' });
        return true;
      } catch (error: any) {
        if (error?.statusCode === 404 || error?.statusCode === 410) await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id));
        return false;
      }
    }));
    return outcomes.filter(Boolean).length;
  }
}
