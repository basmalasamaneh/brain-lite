import assert from "node:assert/strict";
import { test } from "node:test";
import { quietEnd, reminderPlan, wallTime, parseMemoryDate, validTimezone } from "./reminder-time";
const defaults={timezone:"UTC",quiet_hours_start:"22:00",quiet_hours_end:"07:00",
  default_lead_days:[7,1],remind_appointments:true,remind_tasks:true,remind_expiries:true};

test("IANA UTC conversion, DST gaps/overlaps, date-only memory times and quiet-hour boundaries",()=>{
  assert.equal(validTimezone("Asia/Riyadh"),true);assert.equal(validTimezone("Not/AZone"),false);
  assert.equal(wallTime("2026-03-08","02:30","America/New_York").toISOString(),"2026-03-08T07:30:00.000Z");
  assert.equal(wallTime("2026-11-01","01:30","America/New_York").toISOString(),"2026-11-01T05:30:00.000Z");
  assert.equal(parseMemoryDate("2026-03-08","America/New_York")?.toISOString(),"2026-03-08T13:00:00.000Z");
  assert.equal(parseMemoryDate("2026-02-30","UTC"),null);
  assert.equal(parseMemoryDate("2026-07-01T13:00:00+03:00","America/New_York")?.toISOString(),"2026-07-01T10:00:00.000Z");
  const s={timezone:"America/New_York",quiet_hours_start:"22:00",quiet_hours_end:"07:00"};
  assert.equal(quietEnd(new Date("2026-03-08T06:30:00Z"),s)?.toISOString(),"2026-03-08T11:00:00.000Z");
  assert.equal(quietEnd(new Date("2026-03-08T11:00:00Z"),s),null);
  assert.equal(quietEnd(new Date(),{...s,quiet_hours_start:"08:00",quiet_hours_end:"08:00"}),null);
});
test("calendar-day lead times across DST; per-memory automatic/none/custom/specific; nested expiry",()=>{
  const s={...defaults,timezone:"America/New_York"};
  const memory={type:"appointment",event_date:"2026-03-08T10:00",extra:{}};
  const plans=reminderPlan(memory,s);
  assert.deepEqual(plans.map(p=>p.fire.toISOString()).sort(),[
    "2026-03-07T15:00:00.000Z","2026-03-08T12:00:00.000Z",
  ]);
  assert.equal(reminderPlan(memory,s,{mode:"none",lead_minutes:[],specific_at:null}).length,0);
  assert.equal(reminderPlan(memory,s,{mode:"lead_times",lead_minutes:[60],specific_at:null})[0].fire.toISOString(),"2026-03-08T13:00:00.000Z");
  assert.equal(reminderPlan(memory,s,{mode:"specific",lead_minutes:[],specific_at:"2026-01-01T09:00:00Z"})[0].kind,"custom");
  const expiry=reminderPlan({type:"document",event_date:null,extra:{warranty:{expiry_date:"2026-03-08"}}},s);
  assert.equal(expiry.length,2);assert.equal(expiry[1].fire.toISOString(),"2026-03-07T14:00:00.000Z");
});