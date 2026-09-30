import assert from "node:assert/strict";
import { test } from "node:test";
import { notificationPayload, safePushDestination } from "./notification-payload";

const notice={
  id:"11111111-1111-4111-8111-111111111111",reminder_id:"22222222-2222-4222-8222-222222222222",
  title:"Sensitive passport renewal",body:"Private passport number and appointment details",
  url:"/memories/528",kind:"expiry",user_id:"must-not-leak-owner",session_id:"must-not-leak-session",
  access_token:"must-not-leak-token",p256dh:"must-not-leak-key",
};
test("hidden EN/AR text retains only safe operational IDs, deep link and authenticated actions",()=>{
  for(const language of ["en","ar"]) {
    const payload=notificationPayload(notice,true,language);
    assert.equal(payload.title,"Brain Lite");
    assert.equal(payload.body,language==="ar"?"لديك تذكير":"You have a reminder");
    assert.equal(payload.kind,"reminder");
    assert.equal(payload.url,"/memories/528");
    assert.equal(payload.reminder_id,notice.reminder_id);
    assert.equal(payload.notification_id,notice.id);
    assert.deepEqual(payload.actions.map(action=>action.action),["done","snooze"]);
    assert.equal(payload.actions[0].title,language==="ar"?"تم":"Done");
    const encoded=JSON.stringify(payload);
    assert.ok(!encoded.includes(notice.title)&&!encoded.includes(notice.body));
    assert.ok(!encoded.includes("must-not-leak"));
    assert.deepEqual(Object.keys(payload).sort(),["actions","body","kind","notification_id","reminder_id","title","url"]);
  }
});
test("detailed text remains unchanged; non-reminders have no mutation actions",()=>{
  const detailed=notificationPayload(notice,false,"en");
  assert.equal(detailed.title,notice.title);assert.equal(detailed.body,notice.body);
  assert.equal(detailed.kind,"expiry");assert.equal(detailed.reminder_id,notice.reminder_id);
  const brief=notificationPayload({...notice,url:"/",reminder_id:null,kind:"daily_brief"},true,"en");
  assert.deepEqual(brief.actions,[]);assert.equal(brief.reminder_id,null);assert.equal(brief.url,"/");
});
test("payload destinations exclude external redirects, queries, fragments and credentials",()=>{
  for(const value of ["https://example.invalid/","//example.invalid/","/memories/528?token=secret",
    "/memories/528#private","/spaces/not-a-uuid","javascript:alert(1)"])assert.equal(safePushDestination(value),"/");
  assert.equal(safePushDestination("/spaces/11111111-1111-4111-8111-111111111111"),"/spaces/11111111-1111-4111-8111-111111111111");
  const invalid=notificationPayload({...notice,id:"credential-looking-string",reminder_id:"not-a-uuid",url:"https://example.invalid/"},true,"en");
  assert.equal(invalid.notification_id,null);assert.equal(invalid.reminder_id,null);
  assert.deepEqual(invalid.actions,[]);assert.equal(invalid.url,"/");
});