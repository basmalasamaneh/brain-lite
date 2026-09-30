// Run only against the already-running server after the parent restarts it:
// NOTIFICATIONS_API_TEST=1 node --test artifacts/api-server/src/lib/notifications-api.test.mjs
import assert from "node:assert/strict";
import { randomUUID, createECDH, randomBytes, createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";

const base=process.env.NOTIFICATIONS_API_BASE_URL??`http://localhost:${process.env.PORT??"8080"}/api`;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function account(language) {
  const password=`Reminders-${randomUUID()}`,email=`reminders-live-${randomUUID()}@example.invalid`;
  const response=await fetch(`${base}/auth/signup`,{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({email,password,name:"Disposable reminders API test",language,theme:"system"})});
  assert.equal(response.status,201);
  const cookie=response.headers.getSetCookie().map(v=>v.split(";")[0]).join("; ");
  const user=(await response.json()).user;
  const api=async(path,method="GET",data,status=200)=>{
    const r=await fetch(`${base}${path}`,{method,headers:{Cookie:cookie,...(data!==undefined?{"Content-Type":"application/json"}:{})},
      body:data!==undefined?JSON.stringify(data):undefined});
    assert.equal(r.status,status,`${method} ${path}: expected ${status}, received ${r.status}`);
    if(r.status===204)return null;
    return r.headers.get("content-type")?.includes("application/json")?r.json():r.text();
  };
  return {api,user,password};
}
test("real minute scheduler with 2-minute reminders, EN/AR, done/snooze/deletion, session and cross-user API isolation",{
  skip:process.env.NOTIFICATIONS_API_TEST!=="1"?"Opt in with NOTIFICATIONS_API_TEST=1; disposable accounts only":undefined,
  timeout:240000,
},async()=>{
  const accounts=[];
  try{
    const a=await account("en");accounts.push(a);
    const b=await account("ar");accounts.push(b);
    assert.equal((await fetch(`${base}/cron/tick`,{method:"POST"})).status,401);
    assert.equal((await fetch(`${base}/cron/tick`,{method:"POST",headers:{Authorization:"Bearer definitely-invalid"}})).status,401);
    assert.equal((await fetch(`${base}/notifications/settings`)).status,401);
    for(const x of accounts) {
      await x.api("/notifications/settings","POST",{timezone:"Asia/Riyadh"});
      await x.api("/notifications/settings","PATCH",{timezone:"UTC",quiet_hours_start:"00:00",quiet_hours_end:"00:00",remind_suggestions:false,push_enabled:false});
      const unchanged=await x.api("/notifications/settings","POST",{timezone:"Asia/Tokyo"});
      assert.equal(unchanged.timezone,"UTC","automatic initialization must never overwrite an edited timezone");
      assert.equal(unchanged.timezone_initialized,true);
    }
    // Disposable subscriptions are never delivered: push_enabled remains false.
    // Their real-shaped crypto keys test ownership/session binding only.
    const makeSubscription=()=>{
      const ec=createECDH("prime256v1");ec.generateKeys();
      return {endpoint:`https://fcm.googleapis.com/fcm/send/disposable-${randomUUID()}`,
        keys:{p256dh:ec.getPublicKey().toString("base64url"),auth:randomBytes(16).toString("base64url")}};
    };
    const currentSub=makeSubscription(),otherSub=makeSubscription();
    const device=await a.api("/notifications/subscriptions","POST",currentSub,201);
    await b.api("/notifications/subscriptions","POST",currentSub,409);
    await b.api(`/notifications/devices/${device.id}`,"DELETE",undefined,404);
    await b.api("/notifications/subscriptions","DELETE",{endpoint:currentSub.endpoint},204);
    assert.equal((await a.api("/notifications/devices")).devices.length,1,"foreign endpoint deletion cannot hijack an owned subscription");
    await a.api("/notifications/subscriptions","POST",{...currentSub,endpoint:"https://169.254.169.254/latest/meta-data"},400);
    const otherLogin=await fetch(`${base}/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({email:a.user.email,password:a.password})});
    assert.equal(otherLogin.status,200);
    const otherCookie=otherLogin.headers.getSetCookie().map(v=>v.split(";")[0]).join("; ");
    const otherDevice=await fetch(`${base}/notifications/subscriptions`,{method:"POST",headers:{Cookie:otherCookie,"Content-Type":"application/json"},body:JSON.stringify(otherSub)});
    assert.equal(otherDevice.status,201);
    let otherDeviceId=(await otherDevice.json()).id;
    const switchAccount=await fetch(`${base}/auth/login`,{method:"POST",headers:{Cookie:otherCookie,"Content-Type":"application/json"},
      body:JSON.stringify({email:b.user.email,password:b.password})});
    assert.equal(switchAccount.status,200);
    assert.ok(!(await a.api("/notifications/devices")).devices.some(d=>d.id===otherDeviceId),"public A→B login removes A's old-session subscription");
    const switchedCookie=switchAccount.headers.getSetCookie().map(v=>v.split(";")[0]).join("; ");
    const switchBack=await fetch(`${base}/auth/login`,{method:"POST",headers:{Cookie:switchedCookie,"Content-Type":"application/json"},
      body:JSON.stringify({email:a.user.email,password:a.password})});
    assert.equal(switchBack.status,200);
    const reboundCookie=switchBack.headers.getSetCookie().map(v=>v.split(";")[0]).join("; ");
    const rebound=await fetch(`${base}/notifications/subscriptions`,{method:"POST",headers:{Cookie:reboundCookie,"Content-Type":"application/json"},body:JSON.stringify(otherSub)});
    assert.equal(rebound.status,201);otherDeviceId=(await rebound.json()).id;
    const fire=new Date(Date.now()+120000).toISOString();
    const memories=[];
    for(const [x,title] of [[a,"Timer delivers English"],[b,"تذكير الاختبار"],[a,"Done must not deliver"],[a,"Deleted must not deliver"],[a,"Snoozed must not deliver"]]) {
      const memory=await x.api("/capture/voice/plain","POST",{transcript:title,language:x===b?"ar":"en"},201);
      await x.api(`/memories/${memory.id}/reminder-settings`,"PUT",{mode:"specific",lead_minutes:[],specific_at:fire});
      memories.push({x,id:memory.id,title});
    }
    await b.api(`/memories/${memories[0].id}/reminder-settings`,"GET",undefined,404);
    await b.api(`/memories/${memories[0].id}/reminder-settings`,"PUT",{mode:"none",lead_minutes:[],specific_at:null},404);
    await a.api(`/memories/${memories[0].id}/reminder-settings`,"PUT",{mode:"specific",lead_minutes:[],specific_at:new Date(Date.now()-1000).toISOString()},400);
    let owned=[];
    const queueDeadline=Date.now()+75000;
    while(Date.now()<queueDeadline) {
      owned=(await a.api("/reminders")).reminders;
      if(owned.length>=4)break;
      await wait(1500);
    }
    assert.ok(owned.length>=4,"minute worker must materialize durable jobs");
    const done=owned.find(r=>r.memory_id===memories[2].id);
    const deleted=owned.find(r=>r.memory_id===memories[3].id);
    const snoozed=owned.find(r=>r.memory_id===memories[4].id);
    await b.api(`/reminders/${done.id}`,"PATCH",{action:"done"},404);
    await a.api(`/reminders/${done.id}`,"PATCH",{action:"done"},204);
    await a.api(`/reminders/${snoozed.id}`,"PATCH",{action:"snooze",snooze:"hour"},204);
    await a.api(`/memories/${memories[3].id}`,"DELETE",undefined,204);
    await a.api(`/reminders/${deleted.id}`,"PATCH",{action:"done"},404);
    const after=(await a.api("/reminders")).reminders;
    assert.ok(!after.some(r=>r.id===done.id||r.id===deleted.id));
    assert.ok(Date.parse(after.find(r=>r.id===snoozed.id).fire_at)>Date.now()+3500000);
    const deliveryDeadline=Date.parse(fire)+75000;
    let noticesA,noticesB;
    while(Date.now()<deliveryDeadline) {
      noticesA=await a.api("/notifications");noticesB=await b.api("/notifications");
      if(noticesA.notifications.length&&noticesB.notifications.length)break;
      await wait(1500);
    }
    assert.equal(noticesA.notifications.length,1,"exactly one English timer notification; no done/deleted/snoozed delivery");
    assert.equal(noticesB.notifications.length,1,"Arabic timer notification");
    assert.equal(noticesA.notifications[0].title,"Reminder");
    assert.equal(noticesB.notifications[0].title,"تذكير");
    assert.equal(noticesA.notifications[0].body,memories[0].title);
    assert.ok((await a.api("/reminders")).reminders.some(r=>r.memory_id===memories[0].id&&r.status==="sent"),"recently sent reminders remain actionable");
    await b.api(`/notifications/${noticesA.notifications[0].id}`,"PATCH",{read:true},404);
    await b.api(`/notifications/${noticesA.notifications[0].id}`,"DELETE",undefined,404);
    await a.api("/notifications/read-all","POST",undefined,204);
    assert.equal((await a.api("/notifications")).unread_count,0);
    const test=await a.api("/notifications/test","POST");
    assert.equal(test.delivered,0);
    assert.ok(["disabled","not_configured"].includes(test.status),"never claim fake push success");
    await a.api("/auth/logout","POST",{endpoint:otherSub.endpoint},204);
    await a.api("/notifications","GET",undefined,401);
    assert.equal((await b.api("/notifications")).notifications.length,1,"one user's logout never removes another user's notifications");
    // Regain the disposable session only to verify durable cleanup and delete it.
    const response=await fetch(`${base}/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({email:a.user.email,password:a.password})});
    assert.equal(response.status,200);
    const cookie=response.headers.getSetCookie().map(v=>v.split(";")[0]).join("; ");
    const center=await fetch(`${base}/notifications`,{headers:{Cookie:cookie}});
    assert.deepEqual((await center.json()).notifications,[]);
    const remainingDevices=await fetch(`${base}/notifications/devices`,{headers:{Cookie:cookie}});
    assert.deepEqual((await remainingDevices.json()).devices.map(d=>d.id),[otherDeviceId],"logout removes the current-session device and preserves the other device");
    const remove=await fetch(`${base}/auth/account`,{method:"DELETE",headers:{Cookie:cookie,"Content-Type":"application/json"},
      body:JSON.stringify({confirmation:"DELETE",password:a.password})});
    assert.equal(remove.status,204);
    accounts.splice(accounts.indexOf(a),1);
  }finally{
    for(const x of accounts)await x.api("/auth/account","DELETE",{confirmation:"DELETE",password:x.password},204);
  }
});

test("real authenticated API prunes expired, missing, regenerated and account-swapped device sessions",{
  skip:process.env.NOTIFICATIONS_API_TEST!=="1"?"Opt in with NOTIFICATIONS_API_TEST=1; disposable DB sessions only":undefined,
  timeout:30000,
},async()=>{
  // Server-signed disposable session fixtures exercise the REAL session store
  // and auth middleware without consuming signup/login's IP rate limiter.
  // No existing account/session is read or modified, and push remains disabled.
  const require=createRequire(new URL("../../package.json",import.meta.url));
  const {Pool}=require("pg");
  const db=new Pool({connectionString:process.env.DATABASE_URL});
  const users=[randomUUID(),randomUUID()];
  const sids=Array.from({length:5},()=>`reminder-fixture-${randomUUID()}`);
  const cookie=sid=>`brain.sid=${encodeURIComponent(`s:${sid}.${createHmac("sha256",process.env.SESSION_SECRET).update(sid).digest("base64").replace(/=+$/,"")}`)}`;
  const subscription=()=>{
    const ec=createECDH("prime256v1");ec.generateKeys();
    return {endpoint:`https://fcm.googleapis.com/fcm/send/disposable-${randomUUID()}`,
      keys:{p256dh:ec.getPublicKey().toString("base64url"),auth:randomBytes(16).toString("base64url")}};
  };
  const api=async(sid,path,method="GET",data,status=200)=>{
    const r=await fetch(`${base}${path}`,{method,headers:{Cookie:cookie(sid),...(data?{"Content-Type":"application/json"}:{})},
      body:data?JSON.stringify(data):undefined});
    assert.equal(r.status,status,`${method} ${path}`);
    return r.status===204?null:r.headers.get("content-type")?.includes("application/json")?r.json():r.text();
  };
  try{
    for(const user of users)await db.query(`INSERT INTO users(id,email,password_hash,name)
      VALUES($1,$2,'unused-disposable-session-fixture','Disposable session pruning test')`,[user,`session-fixture-${user}@example.invalid`]);
    for(const [sid,user,expired] of [[sids[0],users[0],false],[sids[1],users[0],true],[sids[2],users[1],false],[sids[3],users[0],false]]) {
      const expires=new Date(Date.now()+(expired?-3600000:3600000));
      await db.query("INSERT INTO sessions(sid,sess,expire) VALUES($1,$2::jsonb,$3)",[sid,JSON.stringify({
        cookie:{originalMaxAge:3600000,expires:expires.toISOString(),httpOnly:true,path:"/",sameSite:"lax",secure:false},userId:user,
      }),expires]);
    }
    const activeA=await api(sids[0],"/notifications/subscriptions","POST",subscription(),201);
    const activeB=await api(sids[2],"/notifications/subscriptions","POST",subscription(),201);
    const regenerated=await api(sids[3],"/notifications/subscriptions","POST",subscription(),201);
    // Represent stale registrations from the past. All endpoints/keys belong
    // solely to disabled disposable fixture accounts; no provider is contacted.
    for(const sid of [sids[1],sids[2],sids[4]]) {
      const sub=subscription();
      await db.query("INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth,session_id) VALUES($1,$2,$3,$4,$5)",
        [users[0],sub.endpoint,sub.keys.p256dh,sub.keys.auth,sid]);
    }
    await db.query("DELETE FROM sessions WHERE sid=$1 AND sess->>'userId'=$2",[sids[3],users[0]]);
    await api(sids[1],"/notifications/settings","GET",undefined,401);
    await api(sids[3],"/notifications/settings","GET",undefined,401);
    const a=await api(sids[0],"/notifications/devices");
    assert.deepEqual(a.devices.map(d=>d.id),[activeA.id]);
    const b=await api(sids[2],"/notifications/devices");
    assert.deepEqual(b.devices.map(d=>d.id),[activeB.id]);
    assert.equal((await db.query("SELECT id FROM push_subscriptions WHERE user_id=$1 AND id=$2",[users[0],regenerated.id])).rowCount,0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id=$1",[users[0]])).rows[0].n,1);
    assert.equal((await api(sids[0],"/notifications/settings")).push_enabled,false);
    // HMAC unsubscribe is narrowly authenticated, has no redirect, and requires
    // no email delivery. Enable only this fixture's flag, then immediately opt out.
    await api(sids[0],"/notifications/settings","PATCH",{email_enabled:true});
    const token=createHmac("sha256",process.env.SESSION_SECRET).update(`notifications-unsubscribe:${users[0]}`).digest("base64url");
    const unsubscribe=await fetch(`${base}/notifications/unsubscribe?user_id=${users[0]}&token=${encodeURIComponent(token)}&redirect=https%3A%2F%2Fexample.invalid`);
    assert.equal(unsubscribe.status,200);assert.equal(unsubscribe.headers.get("location"),null);
    assert.equal((await api(sids[0],"/notifications/settings")).email_enabled,false);
    assert.equal((await fetch(`${base}/notifications/unsubscribe?user_id=${users[1]}&token=${encodeURIComponent(token)}`)).status,403);
    // All-data deletion uses the real authenticated API, keeps account/login,
    // removes both durable queue/plans and in-app data, and preserves user B.
    const memory=await api(sids[0],"/capture/voice/plain","POST",{transcript:"Disposable all-data deletion source",language:"en"},201);
    await api(sids[0],`/memories/${memory.id}/reminder-settings`,"PUT",{mode:"specific",lead_minutes:[],specific_at:new Date(Date.now()+86400000).toISOString()});
    assert.ok((await api(sids[0],`/reminders?memory_id=${memory.id}`)).reminders.some(r=>r.memory_id===memory.id&&r.status==="pending"),
      "PUT materializes a visible pending reminder immediately, without waiting up to 60 seconds");
    await db.query(`INSERT INTO notifications(user_id,memory_id,title,body,url,kind)
      VALUES($1,$2,'Disposable in-app deletion fixture','No external delivery attempted','/','custom')`,[users[0],memory.id]);
    assert.equal((await api(sids[0],"/brain/data","DELETE",{confirmation:"DELETE"})).deleted,true);
    assert.deepEqual((await api(sids[0],"/notifications/devices")).devices,[]);
    assert.deepEqual((await api(sids[0],"/notifications")).notifications,[]);
    assert.deepEqual((await api(sids[0],"/reminders")).reminders,[]);
    assert.equal((await db.query("SELECT memory_id FROM reminder_recompute_jobs WHERE user_id=$1",[users[0]])).rowCount,0);
    assert.equal((await api(sids[0],"/notifications/settings")).push_enabled,false);
    assert.deepEqual((await api(sids[2],"/notifications/devices")).devices.map(d=>d.id),[activeB.id]);
  }finally{
    try{
      await db.query("DELETE FROM sessions WHERE sid=ANY($1::varchar[])",[sids]);
      await db.query("DELETE FROM users WHERE id=ANY($1::varchar[])",[users]);
      assert.equal((await db.query("SELECT id FROM users WHERE id=ANY($1::varchar[])",[users])).rowCount,0);
      assert.equal((await db.query("SELECT id FROM push_subscriptions WHERE user_id=ANY($1::varchar[])",[users])).rowCount,0);
    }finally{await db.end();}
  }
});