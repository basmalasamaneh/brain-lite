import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import { initializeNotifications, tickNotifications, safePushEndpoint, defaults, clearNotifications, snoozeTime, sendTestNotification,
  notificationTransaction, pruneExpiredSubscriptions, terminalReminder, resumeNotifications, recomputeMemoryReminders } from "./notifications";

test("disposable real DB fixtures: concurrency, restart durability, quiet hours, urgent exception, deletion, EN/AR, isolation",{
  skip:process.env.NOTIFICATIONS_DB_TEST!=="1"?"Set NOTIFICATIONS_DB_TEST=1; deletes disposable fixtures only":undefined,
},async()=>{
  await initializeNotifications();
  const a=randomUUID(),b=randomUUID(),c=randomUUID(),users=[a,b,c];
  try{
    for(const [id,language] of [[a,"en"],[b,"ar"],[c,"en"]])await pool.query(`INSERT INTO users(id,email,password_hash,name,language)
      VALUES($1,$2,'not-a-real-login-hash','Disposable reminders fixture',$3)`,[id,`reminders-${id}@example.invalid`,language]);
    for(const id of users)await pool.query(`INSERT INTO notification_settings(user_id,timezone,quiet_hours_start,quiet_hours_end,remind_suggestions)
      VALUES($1,'UTC','22:00','07:00',false)`,[id]);
    const sample=(await pool.query(`INSERT INTO memories(user_id,title,type,event_date,is_sample)
      VALUES($1,'Never schedule sample','appointment','2030-04-02T09:00Z',true) RETURNING id`,[c])).rows[0].id;
    assert.equal((await pool.query("SELECT memory_id FROM reminder_recompute_jobs WHERE user_id=$1 AND memory_id=$2",[c,sample])).rowCount,0);
    const immediate=(await pool.query("INSERT INTO memories(user_id,title) VALUES($1,'Immediate override') RETURNING id",[c])).rows[0].id;
    await notificationTransaction(c,async client=>{
      await client.query(`INSERT INTO memory_reminder_settings(user_id,memory_id,mode,specific_at)
        VALUES($1,$2,'specific',$3)`,[c,immediate,new Date(Date.now()+180000)]);
      await recomputeMemoryReminders(client,c,immediate);
      assert.equal((await client.query("SELECT memory_id FROM reminder_recompute_jobs WHERE user_id=$1 AND memory_id=$2",[c,immediate])).rowCount,0);
      assert.equal((await client.query("SELECT id FROM reminders WHERE user_id=$1 AND memory_id=$2 AND status='pending'",[c,immediate])).rowCount,1,"override is visible before its transaction commits, without a worker tick");
    });
    await pool.query("DELETE FROM memories WHERE user_id=$1 AND id=$2",[c,immediate]);
    const m=(await pool.query("INSERT INTO memories(user_id,title,type,event_date) VALUES($1,'Owned event','appointment','2030-04-02T09:00:00Z') RETURNING id",[a])).rows[0].id;
    await tickNotifications(new Date("2029-01-01T12:00:00Z"),users);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM reminders WHERE user_id=$1",[a])).rows[0].n,3);
    await pool.query("UPDATE memories SET event_date='2030-04-03T09:00:00Z',extra='{\"expiry_date\":\"2030-04-10\"}'::jsonb WHERE user_id=$1 AND id=$2",[a,m]);
    assert.equal((await pool.query("SELECT memory_id FROM reminder_recompute_jobs WHERE user_id=$1 AND memory_id=$2",[a,m])).rowCount,1);
    await tickNotifications(new Date("2029-01-01T12:00:00Z"),users);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM reminders WHERE user_id=$1",[a])).rows[0].n,5);
    // Remove only fixture plans before controlled due insertions.
    await pool.query("DELETE FROM reminders WHERE user_id=$1",[a]);
    const now=new Date("2030-03-01T12:00:00Z");
    for(let i=0;i<9;i++)await pool.query(`INSERT INTO reminders(user_id,memory_id,kind,fire_at,original_fire_at)
      VALUES($1,$2,'custom',$3,$3)`,[a,m,new Date(+now-i*1000)]);
    await Promise.all(Array.from({length:8},()=>tickNotifications(now,users)));
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM notifications WHERE user_id=$1",[a])).rows[0].n,6);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM reminder_delivery_claims WHERE user_id=$1",[a])).rows[0].n,9);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND kind='summary'",[a])).rows[0].n,1);
    assert.equal((await pool.query("SELECT * FROM notifications WHERE user_id=$1",[b])).rowCount,0);
    assert.equal((await pool.query("SELECT delivered_devices FROM notifications WHERE user_id=$1 AND delivered_devices<>0",[a])).rowCount,0);
    // Reapply SQL simulates process restart: sent dedup and queued snooze survive.
    const snoozed=(await pool.query(`INSERT INTO reminders(user_id,memory_id,kind,fire_at,original_fire_at,status)
      VALUES($1,$2,'custom','2030-03-01T14:00Z','2030-03-01T14:00Z','snoozed') RETURNING id`,[a,m])).rows[0].id;
    await pool.query(await readFile(new URL("../../../../lib/db/migrations/0006_notifications.sql",import.meta.url),"utf8"));
    await tickNotifications(now,users);
    assert.equal((await pool.query("SELECT status FROM reminders WHERE user_id=$1 AND id=$2",[a,snoozed])).rows[0].status,"snoozed");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM notifications WHERE user_id=$1",[a])).rows[0].n,6);
    const mb=(await pool.query("INSERT INTO memories(user_id,title) VALUES($1,'Arabic fixture') RETURNING id",[b])).rows[0].id;
    await tickNotifications(now,users);
    await pool.query(`INSERT INTO reminders(user_id,memory_id,kind,fire_at,original_fire_at,event_at)
      VALUES($1,$2,'appointment','2030-03-02T01:00Z','2030-03-02T01:00Z','2030-03-02T02:00Z'),
      ($1,$2,'custom','2030-03-02T00:00Z','2030-03-02T00:00Z',NULL)`,[b,mb]);
    await tickNotifications(new Date("2030-03-02T01:00:00Z"),users);
    assert.equal((await pool.query("SELECT title FROM notifications WHERE user_id=$1",[b])).rows[0].title,"تذكير");
    assert.equal((await pool.query("SELECT status FROM reminders WHERE user_id=$1 AND kind='custom'",[b])).rows[0].status,"pending");
    await tickNotifications(new Date("2030-03-02T07:00:00Z"),users);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM notifications WHERE user_id=$1",[b])).rows[0].n,2);
    assert.equal(snoozeTime("tomorrow",{...defaults,timezone:"America/New_York"},new Date("2026-03-07T17:00Z")).toISOString(),"2026-03-08T12:00:00.000Z");
    await pool.query("DELETE FROM memories WHERE user_id=$1 AND id=$2",[b,mb]);
    assert.equal((await pool.query("SELECT id FROM reminders WHERE user_id=$1",[b])).rowCount,0);
    assert.equal((await pool.query("SELECT id FROM notifications WHERE user_id=$1",[b])).rowCount,0);
    // Empty briefs are skipped; no AI is called. A populated future local day
    // produces only one deterministic brief, even across concurrent workers.
    await pool.query("UPDATE notification_settings SET daily_brief_enabled=true,daily_brief_time='08:00' WHERE user_id=$1",[b]);
    await tickNotifications(new Date("2030-03-03T09:00Z"),users);
    assert.equal((await pool.query("SELECT id FROM notifications WHERE user_id=$1",[b])).rowCount,0);
    const first=(await pool.query("INSERT INTO memories(user_id,title,type,event_date) VALUES($1,'Brief event','appointment','2030-03-04T15:00Z') RETURNING id",[b])).rows[0].id;
    const second=(await pool.query("INSERT INTO memories(user_id,title) VALUES($1,'Suggestion source') RETURNING id",[b])).rows[0].id;
    await tickNotifications(new Date("2030-03-03T10:00Z"),users);
    // Isolate the brief rather than the ordinary auto reminders.
    await pool.query("DELETE FROM reminders WHERE user_id=$1",[b]);
    await Promise.all(Array.from({length:4},()=>tickNotifications(new Date("2030-03-04T09:00Z"),users)));
    assert.equal((await pool.query("SELECT id FROM notifications WHERE user_id=$1 AND kind='daily_brief'",[b])).rowCount,1);
    assert.equal((await pool.query("SELECT body FROM notifications WHERE user_id=$1 AND kind='daily_brief'",[b])).rows[0].body,"مواعيد اليوم: 1.");
    await pool.query("UPDATE notification_settings SET daily_brief_enabled=false,push_enabled=true,remind_suggestions=true WHERE user_id=$1",[b]);
    await pool.query(`INSERT INTO memory_links(user_id,memory_a_id,memory_b_id,source,status,relation_type,confidence)
      VALUES($1,$2,$3,'ai','suggested','same_topic',90)`,[b,Math.min(first,second),Math.max(first,second)]);
    await pool.query(`INSERT INTO space_creation_suggestions(user_id,kind,name,normalized_name,reason)
      VALUES($1,'topic','Fixture topic','fixture topic','Owned fixture source')`,[b]);
    await Promise.all(Array.from({length:4},()=>tickNotifications(new Date("2030-03-05T09:00Z"),users)));
    assert.equal((await pool.query("SELECT id FROM notifications WHERE user_id=$1 AND kind='suggestion'",[b])).rowCount,1,"Dots and Spaces share the same per-day slot");
    await tickNotifications(new Date("2030-03-06T09:00Z"),users);
    await tickNotifications(new Date("2030-03-07T09:00Z"),users);
    assert.equal((await pool.query("SELECT id FROM notifications WHERE user_id=$1 AND kind='suggestion'",[b])).rowCount,2,"persistent fingerprints prevent notifying either old source again");
    await pool.query("UPDATE notification_settings SET push_enabled=false WHERE user_id=$1",[b]);
    // Regression: unchanged plans retain a due reminder waiting for quiet hours,
    // even if an extraction edit queues recomputation after its original fire.
    const quietMemory=(await pool.query("INSERT INTO memories(user_id,title,type,event_date) VALUES($1,'Quiet reconciliation','task','2030-03-10T23:00Z') RETURNING id",[c])).rows[0].id;
    await tickNotifications(new Date("2030-03-09T12:00Z"),users);
    const quietReminder=(await pool.query("SELECT * FROM reminders WHERE user_id=$1 AND memory_id=$2 ORDER BY fire_at",[c,quietMemory])).rows[0];
    await pool.query("UPDATE memories SET extra='{\"unrelated\":\"extraction edit\"}'::jsonb WHERE user_id=$1 AND id=$2",[c,quietMemory]);
    await pool.query("UPDATE reminder_recompute_jobs SET queued_at='2030-03-10T00:01Z' WHERE user_id=$1",[c]);
    await tickNotifications(new Date("2030-03-10T00:05Z"),users);
    assert.equal((await pool.query("SELECT status FROM reminders WHERE user_id=$1 AND id=$2",[c,quietReminder.id])).rows[0].status,"pending");
    await tickNotifications(new Date("2030-03-10T07:00Z"),users);
    assert.equal((await pool.query("SELECT status FROM reminders WHERE user_id=$1 AND id=$2",[c,quietReminder.id])).rows[0].status,"sent");
    // Regression: user-picked snooze is durable even across real date changes.
    const manual=(await pool.query("SELECT * FROM reminders WHERE user_id=$1 AND memory_id=$2 AND status='pending'",[c,quietMemory])).rows[0];
    await pool.query("UPDATE reminders SET status='snoozed',fire_at='2030-03-12T12:00Z' WHERE user_id=$1 AND id=$2",[c,manual.id]);
    await pool.query("UPDATE memories SET event_date='2030-03-11T23:00Z' WHERE user_id=$1 AND id=$2",[c,quietMemory]);
    await tickNotifications(new Date("2030-03-10T12:00Z"),users);
    const retained=(await pool.query("SELECT status,fire_at FROM reminders WHERE user_id=$1 AND id=$2",[c,manual.id])).rows[0];
    assert.equal(retained.status,"snoozed");assert.equal(retained.fire_at.toISOString(),"2030-03-12T12:00:00.000Z");
    await pool.query("INSERT INTO memory_reminder_settings(user_id,memory_id,mode) VALUES($1,$2,'none')",[c,quietMemory]);
    await pool.query("UPDATE memories SET extra='{}'::jsonb WHERE user_id=$1 AND id=$2",[c,quietMemory]);
    await tickNotifications(new Date("2030-03-10T12:00Z"),users);
    assert.equal((await pool.query("SELECT id FROM reminders WHERE user_id=$1 AND id=$2",[c,manual.id])).rowCount,0,"none cancels explicit snoozes");
    // Regression: pre-fire Done/Dismiss survive deletion of logout records.
    const terminalIds=[];
    for(const action of ["done","dismissed"]) {
      const memory=(await pool.query("INSERT INTO memories(user_id,title) VALUES($1,$2) RETURNING id",[c,`Terminal ${action}`])).rows[0].id;
      terminalIds.push(memory);
      await pool.query(`INSERT INTO memory_reminder_settings(user_id,memory_id,mode,specific_at)
        VALUES($1,$2,'specific','2031-04-01T12:00Z')`,[c,memory]);
    }
    const restored=(await pool.query("INSERT INTO memories(user_id,title,type,event_date) VALUES($1,'Restore future plan','appointment','2031-04-02T09:00Z') RETURNING id",[c])).rows[0].id;
    await tickNotifications(new Date("2030-03-10T12:00Z"),users);
    for(const [index,memory] of terminalIds.entries())await notificationTransaction(c,async client=>{
      const r=(await client.query("SELECT * FROM reminders WHERE user_id=$1 AND memory_id=$2",[c,memory])).rows[0];
      await terminalReminder(client,c,r,index===0?"done":"dismissed");
    });
    const legacy=(await pool.query("INSERT INTO memories(user_id,title) VALUES($1,'Legacy pre-fire terminal') RETURNING id",[c])).rows[0].id;
    terminalIds.push(legacy);
    await pool.query("INSERT INTO memory_reminder_settings(user_id,memory_id,mode,specific_at) VALUES($1,$2,'specific','2031-04-03T12:00Z')",[c,legacy]);
    await pool.query(`INSERT INTO reminders(user_id,memory_id,kind,fire_at,original_fire_at,status)
      VALUES($1,$2,'custom','2031-04-03T12:00Z','2031-04-03T12:00Z','dismissed')`,[c,legacy]);
    await clearNotifications(c);
    assert.equal((await pool.query("SELECT id FROM reminders WHERE user_id=$1",[c])).rowCount,0);
    await resumeNotifications(c);
    await tickNotifications(new Date("2030-03-10T12:00Z"),users);
    assert.equal((await pool.query("SELECT id FROM reminders WHERE user_id=$1 AND memory_id=ANY($2::int[])",[c,terminalIds])).rowCount,0);
    assert.equal((await pool.query("SELECT id FROM reminders WHERE user_id=$1 AND memory_id=$2",[c,restored])).rowCount,3,"login restores future plans");
    assert.equal((await pool.query("SELECT reason FROM reminder_delivery_claims WHERE user_id=$1 AND reason IN ('done','dismissed')",[c])).rowCount,3,"legacy terminal rows are tombstoned before logout deletion");
    // Regression: prune expired, regenerated and account-swapped session binds.
    const validSid=`valid-${randomUUID()}`,expiredSid=`expired-${randomUUID()}`,swappedSid=`swapped-${randomUUID()}`,missingSid=`missing-${randomUUID()}`;
    for(const [sid,owner,expiry] of [[validSid,c,"1 hour"],[expiredSid,c,"-1 hour"],[swappedSid,b,"1 hour"]])
      await pool.query("INSERT INTO sessions(sid,sess,expire) VALUES($1,$2::jsonb,now()+$3::interval)",[sid,JSON.stringify({userId:owner}),expiry]);
    for(const sid of [validSid,expiredSid,swappedSid,missingSid])await pool.query(`INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth,session_id)
      VALUES($1,$2,'fixture','fixture',$3)`,[c,`https://fcm.googleapis.com/${randomUUID()}`,sid]);
    await notificationTransaction(c,client=>pruneExpiredSubscriptions(client,c));
    assert.deepEqual((await pool.query("SELECT session_id FROM push_subscriptions WHERE user_id=$1",[c])).rows.map(r=>r.session_id),[validSid]);
    await pool.query("DELETE FROM sessions WHERE sid=$1 AND sess->>'userId'=$2",[validSid,c]);
    await notificationTransaction(c,client=>pruneExpiredSubscriptions(client,c));
    assert.equal((await pool.query("SELECT id FROM push_subscriptions WHERE user_id=$1",[c])).rowCount,0);
    // Logout preserves claims but clears reminders, all notifications, only the bound device.
    await pool.query(`INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth,session_id)
      VALUES($1,$2,'fixture','fixture','current'),($1,$3,'fixture','fixture','other')`,[a,`https://fcm.googleapis.com/${randomUUID()}`,`https://fcm.googleapis.com/${randomUUID()}`]);
    await clearNotifications(a,"current");
    assert.equal((await pool.query("SELECT session_id FROM push_subscriptions WHERE user_id=$1",[a])).rows[0].session_id,"other");
    assert.equal((await pool.query("SELECT id FROM reminders WHERE user_id=$1",[a])).rowCount,0);
    assert.equal((await pool.query("SELECT memory_id FROM reminder_delivery_claims WHERE user_id=$1",[a])).rowCount,10);
    if(!process.env.VAPID_PRIVATE_KEY)assert.equal((await sendTestNotification(b)).status,"not_configured");
    for(const bad of ["https://127.0.0.1/a","https://169.254.169.254/a","https://localhost/a","http://fcm.googleapis.com/a","https://fcm.googleapis.com.evil.com/a","https://fcm.googleapis.com:8443/a","https://user@fcm.googleapis.com/a"])assert.equal(safePushEndpoint(bad),false);
    assert.equal(safePushEndpoint("https://web.push.apple.com/Q/fixture"),true);
  }finally{
    await pool.query("DELETE FROM sessions WHERE sess->>'userId'=ANY($1::varchar[])",[users]);
    await pool.query("DELETE FROM users WHERE id=ANY($1::varchar[])",[users]);
    await pool.end();
  }
});