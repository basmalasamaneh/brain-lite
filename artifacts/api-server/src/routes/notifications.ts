import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { pool } from "@workspace/db";
import { defaults, notificationTransaction, publicSettings, pushConfig, safePushEndpoint, sendTestNotification,
  queueAll, snoozeTime, cronAuthorized, tickNotifications, unsubscribeAuthorized, terminalReminder, pruneExpiredSubscriptions,
  recomputeMemoryReminders } from "../lib/notifications";
import { validTimezone } from "../lib/reminder-time";

const router:IRouter=Router();
const time=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const settings=z.object({
  timezone:z.string().max(100).refine(validTimezone,"Unknown IANA timezone"),
  push_enabled:z.boolean(),email_enabled:z.boolean(),daily_brief_enabled:z.boolean(),daily_brief_time:time,
  quiet_hours_start:time,quiet_hours_end:time,remind_appointments:z.boolean(),remind_tasks:z.boolean(),
  remind_expiries:z.boolean(),remind_suggestions:z.boolean(),
  default_lead_days:z.array(z.number().int().min(0).max(365)).min(1).max(10),hide_details:z.boolean(),
}).partial().strict();
const subscription=z.object({
  endpoint:z.string().max(4096).refine(safePushEndpoint,"Unsupported push provider (HTTPS provider allowlist required)"),
  expirationTime:z.number().nullable().optional(),
  keys:z.object({p256dh:z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).refine(s=>Buffer.from(s,"base64url").length===65),
    auth:z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).refine(s=>Buffer.from(s,"base64url").length===16)}).strict(),
}).strict();
const override=z.object({
  mode:z.enum(["automatic","none","lead_times","specific"]),
  lead_minutes:z.array(z.number().int().min(0).max(525600)).max(20),
  specific_at:z.string().datetime({offset:true}).nullable(),
}).strict().refine(v=>v.mode!=="specific"||(v.specific_at!==null&&Date.parse(v.specific_at)>Date.now()),"Specific reminder must be in the future")
  .refine(v=>v.mode!=="lead_times"||v.lead_minutes.length>0,"Choose at least one lead time");
const id=z.string().uuid();
const memoryId=z.coerce.number().int().positive();
const testLimit=rateLimit({windowMs:60000,limit:3,standardHeaders:"draft-7",legacyHeaders:false});

router.post("/cron/tick",async(req,res)=>{
  if(!cronAuthorized(req.get("authorization"))){res.status(401).json({error:"Invalid scheduler credentials"});return;}
  const result=await tickNotifications();
  res.status(result.failed?503:200).json(result);
});
// Capability authenticates precisely this opt-out operation, never login or a
// redirect. Origin has no influence over destination; no open redirect.
router.get("/notifications/unsubscribe",async(req,res)=>{
  const userId=typeof req.query.user_id==="string"?req.query.user_id:"",token=typeof req.query.token==="string"?req.query.token:"";
  if(!unsubscribeAuthorized(userId,token)){res.status(403).send("Invalid unsubscribe link");return;}
  await pool.query("UPDATE notification_settings SET email_enabled=false WHERE user_id=$1",[userId]);
  res.type("text/plain").send("Email notifications disabled. / تم إيقاف إشعارات البريد الإلكتروني.");
});
router.get("/notifications/settings",async(req,res)=>{
  res.json(publicSettings((await pool.query("SELECT * FROM notification_settings WHERE user_id=$1",[req.user!.id])).rows[0]??defaults));
});
router.post("/notifications/settings",async(req,res)=>{
  const parsed=z.object({timezone:z.string().max(100).refine(validTimezone)}).strict().safeParse(req.body);
  if(!parsed.success){res.status(400).json({error:"Valid IANA timezone is required"});return;}
  const result=await notificationTransaction(req.user!.id,async c=>{
    await c.query("INSERT INTO notification_settings(user_id) VALUES($1) ON CONFLICT DO NOTHING",[req.user!.id]);
    const changed=await c.query(`UPDATE notification_settings SET timezone=$2,timezone_initialized=true
      WHERE user_id=$1 AND NOT timezone_initialized RETURNING *`,[req.user!.id,parsed.data.timezone]);
    if(changed.rowCount)await queueAll(c,req.user!.id);
    return publicSettings(changed.rows[0]??(await c.query("SELECT * FROM notification_settings WHERE user_id=$1",[req.user!.id])).rows[0]);
  });
  res.json(result);
});
router.patch("/notifications/settings",async(req,res)=>{
  const parsed=settings.safeParse(req.body);
  if(!parsed.success||!Object.keys(parsed.data).length){res.status(400).json({error:"Invalid notification settings"});return;}
  const result=await notificationTransaction(req.user!.id,async c=>{
    await c.query("INSERT INTO notification_settings(user_id) VALUES($1) ON CONFLICT DO NOTHING",[req.user!.id]);
    const entries=Object.entries(parsed.data);
    const params:unknown[]=[req.user!.id,...entries.map(([,value])=>value)];
    const assignments=entries.map(([key],i)=>`${key}=$${i+2}`);
    if(parsed.data.timezone!==undefined)assignments.push("timezone_initialized=true");
    assignments.push("suspended=false");
    const row=(await c.query(`UPDATE notification_settings SET ${assignments.join(",")} WHERE user_id=$1 RETURNING *`,params)).rows[0];
    // All changes are durable; pending reminders are recomputed by the worker.
    if(entries.some(([key])=>["timezone","default_lead_days","remind_appointments","remind_tasks","remind_expiries"].includes(key)))await queueAll(c,req.user!.id);
    return publicSettings(row);
  });
  res.json(result);
});
router.get("/notifications/push-config",(_req,res)=>res.json(pushConfig()));
router.get("/notifications/devices",async(req,res)=>{
  const devices=await notificationTransaction(req.user!.id,async c=>{
    await pruneExpiredSubscriptions(c,req.user!.id);
    return (await c.query("SELECT id,user_agent,created_at,last_used_at FROM push_subscriptions WHERE user_id=$1 ORDER BY created_at DESC",[req.user!.id])).rows;
  });
  res.json({devices});
});
router.post("/notifications/subscriptions",async(req,res)=>{
  const parsed=subscription.safeParse(req.body);
  if(!parsed.success){res.status(400).json({error:"Invalid push subscription or unsupported endpoint"});return;}
  const result=await notificationTransaction(req.user!.id,async c=>{
    const count=(await c.query("SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id=$1",[req.user!.id])).rows[0].n;
    if(count>=20 && !(await c.query("SELECT id FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2",[req.user!.id,parsed.data.endpoint])).rowCount)
      return {error:"Device limit reached",status:409};
    // ON CONFLICT includes an ownership fence. Never overwrite another user's keys.
    const row=(await c.query(`INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth,session_id,user_agent)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(endpoint) DO UPDATE SET p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,
      session_id=EXCLUDED.session_id,user_agent=EXCLUDED.user_agent,last_used_at=now()
      WHERE push_subscriptions.user_id=EXCLUDED.user_id RETURNING id`,
      [req.user!.id,parsed.data.endpoint,parsed.data.keys.p256dh,parsed.data.keys.auth,req.sessionID,req.get("user-agent")?.slice(0,512)??null])).rows[0];
    return row?{id:row.id}:{error:"Subscription already belongs to another account",status:409};
  });
  if("error" in result){res.status(result.status!).json({error:result.error});return;}
  res.status(201).json(result);
});
router.delete("/notifications/subscriptions",async(req,res)=>{
  const parsed=z.object({endpoint:z.string().max(4096)}).strict().safeParse(req.body);
  if(!parsed.success){res.status(400).json({error:"Endpoint is required"});return;}
  await notificationTransaction(req.user!.id,async c=>{
    await c.query("DELETE FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2 AND session_id=$3",[req.user!.id,parsed.data.endpoint,req.sessionID]);
  });
  res.sendStatus(204);
});
router.delete("/notifications/devices/:id",async(req,res)=>{
  const parsed=id.safeParse(req.params.id);if(!parsed.success){res.status(400).json({error:"Invalid device ID"});return;}
  const deleted=await notificationTransaction(req.user!.id,async c=>(await c.query("DELETE FROM push_subscriptions WHERE user_id=$1 AND id=$2 RETURNING id",[req.user!.id,parsed.data])).rowCount);
  res.sendStatus(deleted?204:404);
});
router.post("/notifications/test",testLimit,async(req,res)=>{res.json(await sendTestNotification(req.user!.id));});
router.get("/notifications",async(req,res)=>{
  const userId=req.user!.id;
  const notifications=await pool.query("SELECT id,title,body,url,kind,read,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200",[userId]);
  const count=await pool.query("SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND NOT read",[userId]);
  res.json({notifications:notifications.rows,unread_count:count.rows[0].n});
});
router.post("/notifications/read-all",async(req,res)=>{
  await pool.query("UPDATE notifications SET read=true WHERE user_id=$1",[req.user!.id]);res.sendStatus(204);
});
router.patch("/notifications/:id",async(req,res)=>{
  const parsed=id.safeParse(req.params.id);
  if(!parsed.success||!z.object({read:z.literal(true)}).strict().safeParse(req.body).success){res.status(400).json({error:"Invalid notification update"});return;}
  const result=await pool.query("UPDATE notifications SET read=true WHERE user_id=$1 AND id=$2 RETURNING id",[req.user!.id,parsed.data]);
  res.sendStatus(result.rowCount?204:404);
});
router.delete("/notifications/:id",async(req,res)=>{
  const parsed=id.safeParse(req.params.id);if(!parsed.success){res.status(400).json({error:"Invalid notification ID"});return;}
  const result=await pool.query("DELETE FROM notifications WHERE user_id=$1 AND id=$2 RETURNING id",[req.user!.id,parsed.data]);
  res.sendStatus(result.rowCount?204:404);
});
router.get("/reminders",async(req,res)=>{
  const parsed=req.query.memory_id!==undefined?memoryId.safeParse(req.query.memory_id):null;
  if(parsed&&!parsed.success){res.status(400).json({error:"Invalid memory ID"});return;}
  const result=await pool.query(`SELECT r.id,r.memory_id,m.title,r.kind,r.fire_at,r.status FROM reminders r
    JOIN memories m ON m.id=r.memory_id AND m.user_id=r.user_id WHERE r.user_id=$1 AND NOT m.is_sample
    AND r.status IN ('pending','snoozed','sent') AND (r.status<>'sent' OR r.fire_at>=now()-interval '2 days')
    AND ($2::integer IS NULL OR r.memory_id=$2)
    AND NOT EXISTS(SELECT 1 FROM reminder_recompute_jobs j WHERE j.user_id=r.user_id AND j.memory_id=r.memory_id)
    ORDER BY r.fire_at LIMIT 500`,[req.user!.id,parsed?.success?parsed.data:null]);
  res.json({reminders:result.rows});
});
router.patch("/reminders/:id",async(req,res)=>{
  const parsed=z.object({action:z.enum(["done","dismiss","snooze"]),snooze:z.enum(["hour","tomorrow","week"]).optional()}).strict()
    .refine(v=>v.action!=="snooze"||v.snooze!==undefined).safeParse(req.body);
  const identifier=id.safeParse(req.params.id);
  if(!parsed.success||!identifier.success){res.status(400).json({error:"Invalid reminder action"});return;}
  const status=await notificationTransaction(req.user!.id,async c=>{
    const r=(await c.query("SELECT * FROM reminders WHERE user_id=$1 AND id=$2 FOR UPDATE",[req.user!.id,identifier.data])).rows[0];
    if(!r)return 404;
    if(parsed.data.action==="snooze") {
      if(r.status==="done"||r.status==="dismissed")return 409;
      const s=publicSettings((await c.query("SELECT * FROM notification_settings WHERE user_id=$1",[req.user!.id])).rows[0]??defaults);
      const fire=snoozeTime(parsed.data.snooze!,s);
      const duplicate=(await c.query("SELECT id FROM reminders WHERE user_id=$1 AND memory_id=$2 AND kind=$3 AND fire_at=$4",[req.user!.id,r.memory_id,r.kind,fire])).rowCount;
      if(duplicate)return 409;
      await c.query("UPDATE reminders SET status='snoozed',fire_at=$3,sent_at=NULL WHERE user_id=$1 AND id=$2",[req.user!.id,r.id,fire]);
    }else await terminalReminder(c,req.user!.id,r,parsed.data.action==="done"?"done":"dismissed");
    return 204;
  });
  res.sendStatus(status);
});
router.get("/memories/:id/reminder-settings",async(req,res)=>{
  const parsed=memoryId.safeParse(req.params.id);if(!parsed.success){res.status(400).json({error:"Invalid memory ID"});return;}
  const owned=await pool.query("SELECT id FROM memories WHERE user_id=$1 AND id=$2",[req.user!.id,parsed.data]);
  if(!owned.rowCount){res.sendStatus(404);return;}
  const result=await pool.query("SELECT mode,lead_minutes,specific_at FROM memory_reminder_settings WHERE user_id=$1 AND memory_id=$2",[req.user!.id,parsed.data]);
  res.json(result.rows[0]??{mode:"automatic",lead_minutes:[],specific_at:null});
});
router.put("/memories/:id/reminder-settings",async(req,res)=>{
  const parsed=override.safeParse(req.body),identifier=memoryId.safeParse(req.params.id);
  if(!parsed.success||!identifier.success){res.status(400).json({error:"Invalid reminder settings; specific times must be in the future"});return;}
  const result=await notificationTransaction(req.user!.id,async c=>{
    const owned=await c.query("SELECT id FROM memories WHERE user_id=$1 AND id=$2 AND NOT is_sample",[req.user!.id,identifier.data]);
    if(!owned.rowCount)return null;
    const row=(await c.query(`INSERT INTO memory_reminder_settings(user_id,memory_id,mode,lead_minutes,specific_at) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(memory_id) DO UPDATE SET mode=EXCLUDED.mode,lead_minutes=EXCLUDED.lead_minutes,specific_at=EXCLUDED.specific_at
      WHERE memory_reminder_settings.user_id=EXCLUDED.user_id RETURNING mode,lead_minutes,specific_at`,
      [req.user!.id,identifier.data,parsed.data.mode,[...new Set(parsed.data.lead_minutes)],parsed.data.specific_at])).rows[0];
    await c.query("INSERT INTO reminder_recompute_jobs(user_id,memory_id) VALUES($1,$2) ON CONFLICT(memory_id) DO UPDATE SET generation=reminder_recompute_jobs.generation+1,queued_at=now()",[req.user!.id,identifier.data]);
    await c.query("UPDATE notification_settings SET suspended=false WHERE user_id=$1",[req.user!.id]);
    await recomputeMemoryReminders(c,req.user!.id,identifier.data);
    return row;
  });
  if(!result){res.sendStatus(404);return;}res.json(result);
});
export default router;