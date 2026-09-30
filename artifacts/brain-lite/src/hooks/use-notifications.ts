import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@workspace/replit-auth-web';
import {
  useGetNotificationSettings, useListNotifications, useListReminders, useGetMemoryReminderSettings,
  useGetPushConfig, useListNotificationDevices, useUpdateNotificationSettings,
  useDeleteNotificationDevice, useActOnReminder, useUpdateMemoryReminderSettings,
  type NotificationSettingsPatch, type ReminderAction, type MemoryReminderSettings,
} from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { useI18n } from '@/lib/i18n';

function useOwnerOptions(path: string) {
  const { user } = useAuth();
  return {
    query: { queryKey: [`/api${path}`, user?.id], enabled: !!user, staleTime: 15000, refetchInterval: 30000 },
    request: { credentials: 'include' as const },
  };
}
export function useNotificationSettings() {
  return useGetNotificationSettings(useOwnerOptions('/notifications/settings'));
}
export function useNotices() {
  return useListNotifications(useOwnerOptions('/notifications'));
}
export function useReminders(id?: number) {
  return useListReminders(id ? { memory_id: id } : undefined, useOwnerOptions(`/reminders${id ? `?memory_id=${id}` : ''}`));
}
export function useMemoryReminderSettings(id: number) {
  return useGetMemoryReminderSettings(id, useOwnerOptions(`/memories/${id}/reminder-settings`));
}
export function usePushConfig() {
  return useGetPushConfig(useOwnerOptions('/notifications/push-config'));
}
export function useNotificationDevices() {
  return useListNotificationDevices(useOwnerOptions('/notifications/devices'));
}

export function useNotificationAction() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const { lang } = useI18n();
  const options = { request: { credentials: 'include' as const } };
  const settings = useUpdateNotificationSettings(options);
  const device = useDeleteNotificationDevice(options);
  const reminder = useActOnReminder(options);
  const memory = useUpdateMemoryReminderSettings(options);
  return useMutation({
    mutationFn: async ({ path, method, data }: { path: string; method: string; data?: unknown }): Promise<unknown> => {
      if (!user) throw new Error('Authentication required');
      if (path === '/notifications/settings' && method === 'PATCH') return settings.mutateAsync({ data: data as NotificationSettingsPatch });
      const deviceId = /^\/notifications\/devices\/(.+)$/.exec(path)?.[1];
      if (deviceId && method === 'DELETE') return device.mutateAsync({ id: deviceId });
      const reminderId = /^\/reminders\/(.+)$/.exec(path)?.[1];
      if (reminderId && method === 'PATCH') return reminder.mutateAsync({ id: reminderId, data: data as ReminderAction });
      const memoryId = /^\/memories\/(\d+)\/reminder-settings$/.exec(path)?.[1];
      if (memoryId && method === 'PUT') return memory.mutateAsync({ id: Number(memoryId), data: data as MemoryReminderSettings });
      throw new Error('Unsupported notification action');
    },
    onSuccess: async (_, input) => {
      await qc.invalidateQueries({ predicate: q => {
        const key = String(q.queryKey[0]);
        return q.queryKey[1] === user?.id && (key.startsWith('/api/notifications') || key.startsWith('/api/reminders') || key.endsWith('/reminder-settings'));
      }, refetchType: 'all' });
      if (input.path.startsWith('/reminders/')) toast({ title: lang === 'ar' ? 'تم تحديث التذكير' : 'Reminder updated' });
    },
    onError: error => toast({ variant: 'destructive', title: lang === 'ar' ? 'تعذّر حفظ التغيير' : 'Could not save this change', description: error.message }),
  });
}