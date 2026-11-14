package com.pischedule.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

public final class ReminderReceiver extends BroadcastReceiver {
    static final String CHANNEL = "schedule_reminders";
    private static final String FIRE = "com.pischedule.offline.REMINDER";
    private static final long LEAD = 30 * 60 * 1000L;
    private static final int ALARM_REQUEST = 30;

    private record Event(long start, String name, String time, String room) {
        String description() {
            return time + " · " + name + (room.isEmpty() ? "" : " · " + room);
        }
    }

    private static SharedPreferences storage(Context context) {
        return context.getSharedPreferences("reminders", Context.MODE_PRIVATE);
    }

    static boolean exactAllowed(Context context) {
        return Build.VERSION.SDK_INT < 31
                || context.getSystemService(AlarmManager.class).canScheduleExactAlarms();
    }

    static boolean notificationsAllowed(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel channel = manager.getNotificationChannel(CHANNEL);
        return manager.areNotificationsEnabled()
                && (channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE);
    }

    static synchronized void replace(Context context, String snapshot) throws JSONException {
        JSONObject data = new JSONObject(snapshot);
        data.getJSONArray("items");
        data.getJSONArray("courses");
        if (!storage(context).edit().putString("data", snapshot).commit()) {
            throw new IllegalStateException("无法保存提醒数据");
        }
        schedule(context, System.currentTimeMillis());
    }

    private static void consider(List<Event> next, JSONObject row, LocalDate date, long after, ZoneId zone) {
        LocalTime time = LocalTime.parse(row.optString("time"));
        long start = date.atTime(time).atZone(zone).toInstant().toEpochMilli();
        if (start - LEAD <= after) return;
        if (!next.isEmpty() && start > next.get(0).start()) return;
        if (!next.isEmpty() && start < next.get(0).start()) next.clear();
        next.add(new Event(start, row.optString("name"), time.toString(), row.optString("room")));
    }

    private static List<Event> nextEvents(Context context, long after) {
        List<Event> next = new ArrayList<>();
        ZoneId zone = ZoneId.systemDefault();
        LocalDate base = Instant.ofEpochMilli(after + LEAD).atZone(zone).toLocalDate();
        try {
            JSONObject data = new JSONObject(storage(context).getString("data", "{}"));
            JSONArray items = data.optJSONArray("items");
            JSONArray courses = data.optJSONArray("courses");
            for (int i = 0; items != null && i < items.length(); i++) {
                JSONObject row = items.getJSONObject(i);
                consider(next, row, LocalDate.parse(row.optString("date")), after, zone);
            }
            for (int i = 0; courses != null && i < courses.length(); i++) {
                JSONObject row = courses.getJSONObject(i);
                JSONArray weeks = row.optJSONArray("weeks");
                if (weeks != null) {
                    LocalDate first = LocalDate.parse(row.getString("termStart"));
                    for (int j = 0; j < weeks.length(); j++) {
                        LocalDate date = first.plusWeeks(weeks.getInt(j) - 1L).plusDays(row.getInt("day"));
                        consider(next, row, date, after, zone);
                    }
                    continue;
                }
                int days = Math.floorMod(row.getInt("day") + 1 - base.getDayOfWeek().getValue(), 7);
                LocalDate date = base.plusDays(days);
                long start = date.atTime(LocalTime.parse(row.optString("time")))
                        .atZone(zone).toInstant().toEpochMilli();
                if (start - LEAD <= after) date = date.plusWeeks(1);
                consider(next, row, date, after, zone);
            }
        } catch (JSONException | java.time.DateTimeException error) {
            android.util.Log.w("PiReminder", "Invalid reminder data", error);
        }
        return next;
    }

    static synchronized void schedule(Context context, long after) {
        long cutoff = Math.max(after - LEAD, storage(context).getLong("last_delivered", 0));
        List<Event> next = nextEvents(context, cutoff);
        long trigger = next.isEmpty() ? 0 : next.get(0).start() - LEAD;
        Intent intent = new Intent(context, ReminderReceiver.class).setAction(FIRE)
                .putExtra("trigger", trigger);
        PendingIntent alarm = PendingIntent.getBroadcast(context, ALARM_REQUEST, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        AlarmManager manager = context.getSystemService(AlarmManager.class);
        manager.cancel(alarm);
        storage(context).edit().putLong("trigger", trigger).apply();
        if (trigger == 0) return;
        long alarmTime = Math.max(trigger, after + 500);
        if (exactAllowed(context)) {
            try {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, alarmTime, alarm);
                return;
            } catch (SecurityException revoked) {
                // The user may have changed the special access while scheduling.
            }
        }
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, alarmTime, alarm);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        synchronized (ReminderReceiver.class) {
            if (FIRE.equals(intent.getAction())) {
                long trigger = intent.getLongExtra("trigger", 0);
                if (trigger == 0 || trigger > System.currentTimeMillis()
                        || trigger != storage(context).getLong("trigger", 0)) return;
                List<Event> due = nextEvents(context, trigger - 1);
                if (notificationsAllowed(context) && !due.isEmpty()
                        && due.get(0).start() > System.currentTimeMillis()
                        && due.get(0).start() - LEAD == trigger) {
                    storage(context).edit().putLong("last_delivered", trigger).apply();
                    notifyEvents(context, due, trigger);
                } else if (!notificationsAllowed(context)) {
                    return;
                }
            }
            schedule(context, System.currentTimeMillis());
        }
    }

    static void testNotification(Context context) {
        if (!notificationsAllowed(context)) return;
        Notification notification = new Notification.Builder(context, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle("PiSchedule 测试通知")
                .setContentText("通知权限正常。")
                .setAutoCancel(true).build();
        context.getSystemService(NotificationManager.class).notify("test", 0, notification);
    }

    private static void notifyEvents(Context context, List<Event> events, long trigger) {
        if (!notificationsAllowed(context)) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL, "日程和课程提醒",
                NotificationManager.IMPORTANCE_DEFAULT));
        PendingIntent open = PendingIntent.getActivity(context, 0,
                new Intent(context, MainActivity.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Event first = events.get(0);
        Notification.Builder notification = new Notification.Builder(context, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle(events.size() == 1 ? first.name() : events.size() + " 项日程即将开始")
                .setContentText(first.description())
                .setContentIntent(open)
                .setAutoCancel(true);
        if (events.size() > 1) {
            Notification.InboxStyle summary = new Notification.InboxStyle();
            for (Event event : events) summary.addLine(event.description());
            notification.setStyle(summary);
        }
        manager.notify(Long.toString(trigger), 0, notification.build());
    }
}
