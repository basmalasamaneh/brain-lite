import { readFile } from "node:fs/promises";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import webpush from "web-push";
import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import { deletingUsers } from "./brain-state";
import { logger } from "./logger";
import { addLocalDays, localParts, quietEnd, reminderPlan, wallTime } from "./reminder-time";
import { notificationPayload } from "./notification-payload";

export const defaults = {
  timezone:"UTC", timezone_initialized:false, push_enabled:false, email_enabled:false, daily_brief_enabled:false, daily_brief_time:"08:00",
  quiet_hours_start:"22:00", quiet_hours_end:"07:00", remind_appointments:true, remind_tasks:true,
  remind_expiries:true, remind_suggestions:true, default_lead_days:[7,1], hide_details:true,
};
export type Settings = typeof defaults;
let initialization: Promise<void> | undefined;
export function initializeNotifications() {
  if(!initialization) initialization=(async()=>{
    let migration:string|undefined;
    for(const path of [new URL("./notifications-migration.sql",import.meta.url),new URL("../../../../lib/db/migrations/0006_notifications.sql",import.meta.url)]) {
      try {migration=await readFile(path,"utf8");break;} catch { /* bundled/source */ }
    }
    if(!migration) throw new Error("NOTIFICATIONS_MIGRATION_MISSING");
    const c=await pool.connect();
    try {await c.query("BEGIN");await c.query("SELECT pg_advisory_xact_lock(768001)");await c.query(migration);await c.query("COMMIT");}
    catch(error){await c.query("ROLLBACK");throw error;} finally{c.release();}
  })().catch(error=>{initialization=undefined;throw error;});
  return initialization;
}
export function publicSettings(row: Record<string,unknown>): Settings {
  return Object.fromEntries(Object.keys(defaults).map(key=>[key,row[key] ?? defaults[key as keyof Settings]])) as Settings;
}
export async function notificationTransaction<T>(userId:string,fn:(c:PoolClient)=>Promise<T>):Promise<T> {
  const c=await pool.connect();
  try {
    await c.query("BEGIN"); await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,768006))",[userId]);
    const alive=await c.query("SELECT id FROM users WHERE id=$1",[userId]);
    if(!alive.rowCount) throw new Error("USER_NOT_FOUND");
    const result=await fn(c); await c.query("COMMIT");return result;
  } catch(error){await c.query("ROLLBACK");throw error;} finally{c.release();}
}
export async function clearNotifications(userId:string,sessionId?:string,endpoint?:string) {
  await notificationTransaction(userId,async c=>{
    // Current session binding is authoritative; endpoint cannot remove another device.
    if(sessionId) await c.query("DELETE FROM push_subscriptions WHERE user_id=$1 AND (session_id=$2 OR (endpoint=$3 AND session_id=$2))",[userId,sessionId,endpoint??null]);
    else await c.query("DELETE FROM push_subscriptions WHERE user_id=$1",[userId]);
    // Also preserve terminal rows produced by an earlier deployed API version.
    await c.query(`INSERT INTO reminder_delivery_claims(user_id,memory_id,kind,fire_at,reason)
      SELECT user_id,memory_id,kind,fire_at,status FROM reminders WHERE user_id=$1 AND status IN ('done','dismissed')
      UNION ALL SELECT user_id,memory_id,kind,original_fire_at,status FROM reminders WHERE user_id=$1 AND status IN ('done','dismissed')
      ON CONFLICT DO NOTHING`,[userId]);
    await c.query("DELETE FROM reminders WHERE user_id=$1",[userId]);
    await c.query("DELETE FROM reminder_recompute_jobs WHERE user_id=$1",[userId]);
    await c.query("DELETE FROM notifications WHERE user_id=$1",[userId]);
    await c.query("INSERT INTO notification_settings(user_id,suspended) VALUES($1,true) ON CONFLICT(user_id) DO UPDATE SET suspended=true",[userId]);
  });
}
export function pushConfig() {
  const configured=!!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
  return {configured,public_key:configured?process.env.VAPID_PUBLIC_KEY!:null};
}
// Only exact provider hosts or tightly constrained provider subdomains. No user
// supplied ports, credentials, IP literals, redirects or arbitrary HTTPS hosts.
export function safePushEndpoint(endpoint:string) {
  try {
    const u=new URL(endpoint);
    if(u.protocol!=="https:"||u.username||u.password||u.port||u.hash) return false;
    return u.hostname==="fcm.googleapis.com" || u.hostname==="updates.push.services.mozilla.com" ||
      u.hostname==="web.push.apple.com" || /^[a-z0-9-]+\.notify\.windows\.com$/.test(u.hostname);
  } catch{return false;}
}
export function cronAuthorized(header:string|undefined) {
  const secret=process.env.CRON_SECRET;
  if(!secret || !header?.startsWith("Bearer ")) return false;
  const a=createHash("sha256").update(header.slice(7)).digest(),b=createHash("sha256").update(secret).digest();
  return timingSafeEqual(a,b);
}
export function unsubscribeToken(userId:string) {
  return createHmac("sha256",process.env.SESSION_SECRET!).update(`notifications-unsubscribe:${userId}`).digest("base64url");
}
export function unsubscribeAuthorized(userId:string,token:string) {
  const a=Buffer.from(unsubscribeToken(userId)),b=Buffer.from(token);
  return a.length===b.length&&timingSafeEqual(a,b);
}
type Envelope={id:string;user_id:string;title:string;body:string;url:string;kind:string;reminder_id:string|null};
export async function pruneExpiredSubscriptions(c:PoolClient,userId:string) {
  await c.query(`DELETE FROM push_subscriptions p WHERE p.user_id=$1 AND NOT EXISTS(
    SELECT 1 FROM sessions s WHERE s.sid=p.session_id AND s.sess->>'userId'=p.user_id AND s.expire>now())`,[userId]);
}
export async function terminalReminder(c:PoolClient,userId:string,reminder:Record<string,unknown>,reason:"done"|"dismissed") {
  await c.query(`INSERT INTO reminder_delivery_claims(user_id,memory_id,kind,fire_at,reason)
    VALUES($1,$2,$3,$4,$6),($1,$2,$3,$5,$6) ON CONFLICT DO NOTHING`,
    [userId,reminder.memory_id,reminder.kind,reminder.fire_at,reminder.original_fire_at,reason]);
  await c.query("UPDATE reminders SET status=$3 WHERE user_id=$1 AND id=$2",[userId,reminder.id,reason]);
}
export async function resumeNotifications(userId:string) {
  await notificationTransaction(userId,async c=>{
    await c.query("UPDATE notification_settings SET suspended=false WHERE user_id=$1",[userId]);
    await queueAll(c,userId);
  });
}
export async function deliver(c:PoolClient,n:Envelope,s:Settings,language:string) {
  await pruneExpiredSubscriptions(c,n.user_id);
  let delivered=0;
  let status=!s.push_enabled?"disabled":!pushConfig().configured?"not_configured":"no_devices";
  if(s.push_enabled && pushConfig().configured) {
    const subscriptions=await c.query(`SELECT p.* FROM push_subscriptions p JOIN sessions s ON s.sid=p.session_id
      AND s.sess->>'userId'=p.user_id AND s.expire>now() WHERE p.user_id=$1 ORDER BY p.id`,[n.user_id]);
    for(const sub of subscriptions.rows) {
      if(deletingUsers.has(n.user_id))break;
      // Revalidate at the external attempt boundary, not only when enumerating.
      if(!(await c.query(`SELECT sid FROM sessions WHERE sid=$1 AND sess->>'userId'=$2 AND expire>now()`,
        [sub.session_id,n.user_id])).rowCount) {
        await c.query("DELETE FROM push_subscriptions WHERE user_id=$1 AND id=$2",[n.user_id,sub.id]);
        continue;
      }
      if(!safePushEndpoint(sub.endpoint)) continue; // defense-in-depth for preexisting rows
      const payload=notificationPayload(n,s.hide_details,language);
      try {
        await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},JSON.stringify(payload),{
          vapidDetails:{subject:process.env.VAPID_SUBJECT!,publicKey:process.env.VAPID_PUBLIC_KEY!,privateKey:process.env.VAPID_PRIVATE_KEY!},
          TTL:300,timeout:10000,
        });
        delivered++; status="sent";
        await c.query("UPDATE push_subscriptions SET last_used_at=now() WHERE user_id=$1 AND id=$2",[n.user_id,sub.id]);
      } catch(error) {
        const code=(error as {statusCode?:number}).statusCode;
        if(code===404||code===410) await c.query("DELETE FROM push_subscriptions WHERE user_id=$1 AND id=$2",[n.user_id,sub.id]);
        if(!delivered) status="failed";
        logger.warn({statusCode:code},"Push provider rejected notification; no retry (at-most-once)");
      }
    }
  }
  // Email is opt-in only, fallback only, and absent Resend configuration is a
  // silent skip. RESEND_FROM must be a domain verified by the deployment owner.
  if(!delivered && !deletingUsers.has(n.user_id) && s.email_enabled && process.env.RESEND_API_KEY && process.env.RESEND_FROM && process.env.APP_URL) {
    const base=new URL(process.env.APP_URL);
    if(base.protocol==="https:"&&!base.username&&!base.password) {
      const user=(await c.query("SELECT email FROM users WHERE id=$1",[n.user_id])).rows[0];
      const link=new URL("/api/notifications/unsubscribe",base);
      link.searchParams.set("user_id",n.user_id);link.searchParams.set("token",unsubscribeToken(n.user_id));
      try {
        const response=await fetch("https://api.resend.com/emails",{method:"POST",redirect:"error",signal:AbortSignal.timeout(10000),
          headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,"Content-Type":"application/json","Idempotency-Key":n.id},
          body:JSON.stringify({from:process.env.RESEND_FROM,to:user.email,subject:n.title,
            text:`${n.body}\n${new URL(n.url,base).href}\n\n${language==="ar"?"إلغاء الاشتراك":"Unsubscribe"}: ${link.href}`})});
        if(!response.ok) logger.warn({status:response.status},"Notification email rejected; no retry");
      } catch {logger.warn("Notification email unavailable; no retry");}
    }
  }
  await c.query("UPDATE notifications SET delivery_status=$3,delivered_devices=$4 WHERE user_id=$1 AND id=$2",[n.user_id,n.id,status,delivered]);
  return {status,delivered};
}
async function recompute(c:PoolClient,userId:string,s:Settings,now:Date,onlyMemory?:number) {
  const jobs=await c.query(`SELECT j.memory_id,j.generation,j.queued_at AS job_queued_at,m.*,o.mode,o.lead_minutes,o.specific_at FROM reminder_recompute_jobs j
    JOIN memories m ON m.id=j.memory_id AND m.user_id=j.user_id LEFT JOIN memory_reminder_settings o ON o.memory_id=m.id AND o.user_id=m.user_id
    WHERE j.user_id=$1 AND ($2::integer IS NULL OR j.memory_id=$2)
    ORDER BY j.memory_id FOR UPDATE OF j SKIP LOCKED LIMIT 200`,[userId,onlyMemory??null]);
  for(const m of jobs.rows) {
    const existing=(await c.query("SELECT * FROM reminders WHERE user_id=$1 AND memory_id=$2 FOR UPDATE",[userId,m.memory_id])).rows;
    const override=m.mode?{mode:m.mode,lead_minutes:m.lead_minutes,specific_at:m.specific_at?.toISOString()??null}:undefined;
    const plans=m.is_sample?[]:reminderPlan(m,s,override);
    const identity=(kind:string,fire:Date)=>`${kind}:${fire.toISOString()}`;
    const planned=new Map(plans.map(plan=>[identity(plan.kind,plan.fire),plan]));
    const retained=new Set<string>();
    for(const r of existing) {
      if(r.status==="snoozed" && !m.is_sample && override?.mode!=="none") {
        // A user-picked snooze is independent of extraction/date recomputation.
        retained.add(identity(r.kind,r.original_fire_at));
        await c.query("UPDATE reminders SET event_at=$3 WHERE user_id=$1 AND id=$2",
          [userId,r.id,plans.find(plan=>plan.kind===r.kind)?.event??null]);
        continue;
      }
      if(r.status!=="pending"&&r.status!=="snoozed")continue;
      const key=identity(r.kind,r.fire_at),plan=planned.get(key);
      if(r.status==="pending"&&plan) {
        // Reconcile unchanged identities rather than dropping due reminders
        // waiting for quiet hours merely because the durable job is newer.
        retained.add(key);
        await c.query("UPDATE reminders SET event_at=$3 WHERE user_id=$1 AND id=$2",[userId,r.id,plan.event]);
      } else await c.query("DELETE FROM reminders WHERE user_id=$1 AND id=$2",[userId,r.id]);
    }
    if(!m.is_sample) {
      for(const plan of plans) {
        if(retained.has(identity(plan.kind,plan.fire)))continue;
        // Keep reminders that became due while the durable job waited for a
        // worker/restart, but don't backfill historical automatic reminders.
        if(+plan.fire<+m.job_queued_at) continue;
        await c.query(`INSERT INTO reminders(user_id,memory_id,kind,fire_at,original_fire_at,event_at)
          SELECT $1::varchar,$2::integer,$3::text,$4::timestamptz,$4::timestamptz,$5::timestamptz
          WHERE NOT EXISTS(SELECT 1 FROM reminder_delivery_claims WHERE user_id=$1::varchar AND memory_id=$2::integer AND kind=$3::text AND fire_at=$4::timestamptz)
          ON CONFLICT(memory_id,kind,fire_at) DO NOTHING`,[userId,m.memory_id,plan.kind,plan.fire,plan.event]);
      }
    }
    await c.query("DELETE FROM reminder_recompute_jobs WHERE user_id=$1 AND memory_id=$2 AND generation=$3",[userId,m.memory_id,m.generation]);
  }
}
// Materialize an explicit user override before returning success. This performs
// no external delivery: the minute worker still owns claiming/quiet-hour sends.
export async function recomputeMemoryReminders(c:PoolClient,userId:string,memoryId:number) {
  const s=publicSettings((await c.query("SELECT * FROM notification_settings WHERE user_id=$1",[userId])).rows[0]??defaults);
  await recompute(c,userId,s,new Date(),memoryId);
}
export async function queueAll(c:PoolClient,userId:string) {
  await c.query(`INSERT INTO reminder_recompute_jobs(memory_id,user_id) SELECT id,user_id FROM memories WHERE user_id=$1 AND NOT is_sample
    ON CONFLICT(memory_id) DO UPDATE SET generation=reminder_recompute_jobs.generation+1,queued_at=now()`,[userId]);
}
async function reserve(c:PoolClient,userId:string,day:string) {
  await c.query("INSERT INTO notification_daily_ledger(user_id,local_day) VALUES($1,$2) ON CONFLICT DO NOTHING",[userId,day]);
  return (await c.query("SELECT * FROM notification_daily_ledger WHERE user_id=$1 AND local_day=$2 FOR UPDATE",[userId,day])).rows[0];
}
async function insertNotice(c:PoolClient,userId:string,title:string,body:string,url:string,kind:string,memoryId:number|null=null,reminderId:string|null=null) {
  return (await c.query(`INSERT INTO notifications(user_id,title,body,url,kind,memory_id,reminder_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [userId,title,body,url,kind,memoryId,reminderId])).rows[0] as Envelope;
}
async function claimNotice(c:PoolClient,userId:string,day:string,title:string,body:string,url:string,kind:string,memoryId:number|null=null,reminderId:string|null=null):Promise<Envelope|null> {
  const ledger=await reserve(c,userId,day);
  if(ledger.used<5) {
    await c.query("UPDATE notification_daily_ledger SET used=used+1 WHERE user_id=$1 AND local_day=$2",[userId,day]);
    return insertNotice(c,userId,title,body,url,kind,memoryId,reminderId);
  }
  await c.query("UPDATE notification_daily_ledger SET overflow_count=overflow_count+1 WHERE user_id=$1 AND local_day=$2",[userId,day]);
  return null;
}
async function dailyBrief(c:PoolClient,userId:string,s:Settings,day:string,language:string,now:Date):Promise<Envelope|null> {
  if(!s.daily_brief_enabled||+now<+wallTime(day,s.daily_brief_time,s.timezone)) return null;
  const ledger=await reserve(c,userId,day);
  if(ledger.brief_claimed) return null;
  await c.query("UPDATE notification_daily_ledger SET brief_claimed=true WHERE user_id=$1 AND local_day=$2",[userId,day]);
  const memories=(await c.query("SELECT type,event_date,extra FROM memories WHERE user_id=$1 AND NOT is_sample",[userId])).rows;
  let events=0,tasks=0,expiries=0;
  for(const memory of memories) {
    const plans=reminderPlan(memory,{...s,remind_appointments:true,remind_tasks:true,remind_expiries:true,default_lead_days:[0]});
    const seen=new Set<string>();
    for(const plan of plans) {
      if(!plan.event||localParts(plan.event,s.timezone).day!==day) continue;
      const key=`${plan.kind}:${plan.event.toISOString()}`;if(seen.has(key))continue;seen.add(key);
      if(plan.kind==="appointment")events++;if(plan.kind==="task")tasks++;if(plan.kind==="expiry")expiries++;
    }
  }
  if(!events&&!tasks&&!expiries)return null;
  const body=language==="ar"
    ? [events?`مواعيد اليوم: ${events}`:null,tasks?`المهام المستحقة: ${tasks}`:null,
      expiries?`حالات انتهاء الصلاحية: ${expiries}`:null].filter(Boolean).join("؛ ")+"."
    : [events?`${events} ${events===1?"event":"events"} today`:null,tasks?`${tasks} ${tasks===1?"task":"tasks"} due`:null,
      expiries?`${expiries} ${expiries===1?"item":"items"} expiring`:null].filter(Boolean).join(", ")+".";
  return claimNotice(c,userId,day,language==="ar"?"موجزك اليومي":"Your daily brief",body,"/","daily_brief");
}
async function suggestion(c:PoolClient,userId:string,s:Settings,day:string,language:string):Promise<Envelope|null> {
  if(!s.remind_suggestions || !s.push_enabled)return null;
  const ledger=await reserve(c,userId,day);if(ledger.suggestion_claimed)return null;
  const sources=await c.query(`SELECT 'dots:'||l.memory_a_id::text||':'||l.memory_b_id::text AS fingerprint,'/' AS url FROM memory_links l
    JOIN memories a ON a.id=l.memory_a_id AND a.user_id=l.user_id JOIN memories b ON b.id=l.memory_b_id AND b.user_id=l.user_id
    WHERE l.user_id=$1 AND l.source='ai' AND l.status='suggested' AND NOT a.is_sample AND NOT b.is_sample
    UNION ALL SELECT 'space:'||sm.space_id::text||':'||sm.memory_id::text,'/spaces/'||sm.space_id::text
    FROM space_memories sm JOIN memories m ON m.id=sm.memory_id AND m.user_id=sm.user_id
    JOIN spaces sp ON sp.id=sm.space_id AND sp.user_id=sm.user_id
    WHERE sm.user_id=$1 AND sm.source='ai' AND sm.status='suggested' AND NOT m.is_sample AND NOT sp.archived
    UNION ALL SELECT 'space-create:'||normalized_name,'/spaces' FROM space_creation_suggestions WHERE user_id=$1 AND status='suggested'
    ORDER BY fingerprint`,[userId]);
  for(const source of sources.rows) {
    const claim=await c.query("INSERT INTO notification_suggestion_claims(user_id,fingerprint) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING fingerprint",[userId,source.fingerprint]);
    if(!claim.rowCount)continue;
    await c.query("UPDATE notification_daily_ledger SET suggestion_claimed=true WHERE user_id=$1 AND local_day=$2",[userId,day]);
    return claimNotice(c,userId,day,language==="ar"?"اقتراح جديد":"A new suggestion",
      language==="ar"?"اكتشف روابط ومساحات مقترحة في ذكرياتك.":"Explore suggested connections and Spaces in your memories.",source.url,"suggestion");
  }
  return null;
}
export async function tickNotifications(now=new Date(),onlyUsers?:string[]) {
  const users=await pool.query(`SELECT DISTINCT u.id FROM users u LEFT JOIN notification_settings s ON s.user_id=u.id
    WHERE ($2::varchar[] IS NULL OR u.id=ANY($2::varchar[])) AND (EXISTS(SELECT 1 FROM reminder_recompute_jobs j WHERE j.user_id=u.id)
    OR EXISTS(SELECT 1 FROM reminders r WHERE r.user_id=u.id AND r.status IN ('pending','snoozed') AND r.fire_at<=$1)
    OR s.daily_brief_enabled OR (s.push_enabled AND s.remind_suggestions))`,[now,onlyUsers??null]);
  let claimed=0,failed=0;
  for(const {id:userId} of users.rows) {
    const c=await pool.connect();let locked=false;
    try {
      locked=(await c.query("SELECT pg_try_advisory_lock(hashtextextended($1,768006)) AS locked",[userId])).rows[0].locked;
      if(!locked||deletingUsers.has(userId))continue;
      await c.query("BEGIN");
      const user=(await c.query("SELECT language FROM users WHERE id=$1",[userId])).rows[0];
      if(!user){await c.query("ROLLBACK");continue;}
      const raw=(await c.query("SELECT * FROM notification_settings WHERE user_id=$1",[userId])).rows[0]??defaults;
      if(raw.suspended){await c.query("ROLLBACK");continue;}
      const s=publicSettings(raw),language=user.language,day=localParts(now,s.timezone).day;
      await recompute(c,userId,s,now);
      const notices:Envelope[]=[];
      const due=await c.query(`SELECT r.*,m.title FROM reminders r JOIN memories m ON m.id=r.memory_id AND m.user_id=r.user_id
        WHERE r.user_id=$1 AND r.status IN ('pending','snoozed') AND r.fire_at<=$2 AND NOT m.is_sample
        AND NOT EXISTS(SELECT 1 FROM reminder_recompute_jobs j WHERE j.memory_id=r.memory_id)
        ORDER BY r.fire_at,r.id FOR UPDATE OF r SKIP LOCKED LIMIT 500`,[userId,now]);
      const end=quietEnd(now,s);
      for(const reminder of due.rows) {
        const urgent=reminder.kind==="appointment" && reminder.event_at && +reminder.event_at>=+now && +reminder.event_at-+now<=7200000;
        if(end&&!urgent)continue; // don't mutate fire_at: retain dedup identity
        const claim=await c.query(`INSERT INTO reminder_delivery_claims(user_id,memory_id,kind,fire_at) VALUES($1,$2,$3,$4)
          ON CONFLICT DO NOTHING RETURNING memory_id`,[userId,reminder.memory_id,reminder.kind,reminder.fire_at]);
        await c.query("UPDATE reminders SET status='sent',sent_at=$3 WHERE user_id=$1 AND id=$2",[userId,reminder.id,now]);
        if(!claim.rowCount)continue;
        const notice=await claimNotice(c,userId,day,language==="ar"?"تذكير":"Reminder",reminder.title,`/memories/${reminder.memory_id}`,
          reminder.kind,reminder.memory_id,reminder.id);
        if(notice)notices.push(notice);
      }
      if(!end) {
        const brief=await dailyBrief(c,userId,s,day,language,now);if(brief)notices.push(brief);
        const suggested=await suggestion(c,userId,s,day,language);if(suggested)notices.push(suggested);
      }
      const ledger=await reserve(c,userId,day);
      if(ledger.overflow_count>0&&!ledger.summary_sent&&ledger.used<6&&!end) {
        await c.query("UPDATE notification_daily_ledger SET summary_sent=true,used=used+1 WHERE user_id=$1 AND local_day=$2",[userId,day]);
        notices.push(await insertNotice(c,userId,language==="ar"?"تذكيرات إضافية":"More reminders",
          language==="ar"?"لديك تذكيرات إضافية. افتح التطبيق للاطلاع عليها.":"You have more reminders. Open Brain Lite to review them.","/","summary"));
      }
      // Durable delivery claim BEFORE network I/O. Never retry on unknown
      // outcome/crash; loss is possible, hidden double sends are not.
      await c.query("COMMIT");
      claimed+=notices.length;
      for(const notice of notices) {
        // Session advisory fence remains held through send. Deletion/logout
        // waits for this linearization point; no delivery starts after removal.
        const valid=(await c.query("SELECT id FROM notifications WHERE user_id=$1 AND id=$2",[userId,notice.id])).rowCount;
        if(valid&&!deletingUsers.has(userId)) await deliver(c,notice,s,language);
      }
    } catch(error) {
      await c.query("ROLLBACK").catch(()=>{});
      failed++;
      logger.error({errorName:error instanceof Error?error.name:"Error",code:(error as {code?:string})?.code},"Notification tick failed");
      if(onlyUsers)throw error; // scoped fixture runs must surface SQL failures
    } finally {
      if(locked)await c.query("SELECT pg_advisory_unlock(hashtextextended($1,768006))",[userId]);
      c.release();
    }
  }
  return {claimed,failed};
}
export async function sendTestNotification(userId:string) {
  const c=await pool.connect();
  try {
    await c.query("SELECT pg_advisory_lock(hashtextextended($1,768006))",[userId]);
    await c.query("BEGIN");
    const user=(await c.query("SELECT language FROM users WHERE id=$1",[userId])).rows[0];
    const s=publicSettings((await c.query("SELECT * FROM notification_settings WHERE user_id=$1",[userId])).rows[0]??defaults);
    await pruneExpiredSubscriptions(c,userId);
    if(!pushConfig().configured){await c.query("COMMIT");return {status:"not_configured",delivered:0};}
    if(!s.push_enabled){await c.query("COMMIT");return {status:"disabled",delivered:0};}
    if(!(await c.query("SELECT id FROM push_subscriptions WHERE user_id=$1",[userId])).rowCount){await c.query("COMMIT");return {status:"no_devices",delivered:0};}
    const day=localParts(new Date(),s.timezone).day;
    const n=await claimNotice(c,userId,day,"Brain Lite",user.language==="ar"?"الإشعارات جاهزة.":"Notifications are ready.","/","test");
    await c.query("COMMIT");
    return n?await deliver(c,n,s,user.language):{status:"limited",delivered:0};
  } catch(error){await c.query("ROLLBACK");throw error;}
  finally{await c.query("SELECT pg_advisory_unlock(hashtextextended($1,768006))",[userId]);c.release();}
}
let timer:ReturnType<typeof setInterval>|undefined;
export function startNotificationWorker() {
  if(timer)return;
  timer=setInterval(()=>{void tickNotifications().catch(()=>logger.error("Notification scheduler failed"));},60000);
  timer.unref();
  void tickNotifications().catch(()=>logger.error("Initial notification scheduler tick failed"));
}
export function snoozeTime(option:string,s:Settings,now=new Date()) {
  if(option==="hour")return new Date(+now+3600000);
  const p=localParts(now,s.timezone);
  return wallTime(addLocalDays(p.day,option==="tomorrow"?1:7),"08:00",s.timezone);
}