import { validEventDate } from "./calendar";

export function validTimezone(zone: string): boolean {
  try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(); return true; } catch { return false; }
}
export function localParts(date: Date, zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (key: string) => parts.find(p => p.type === key)!.value;
  return { day: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}`, second: get("second") };
}
export function addLocalDays(day: string, days: number) {
  const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
// Resolve local wall time against IANA transitions. Overlaps choose the earliest
// occurrence. A nonexistent spring-forward time advances by the exact DST gap.
export function wallTime(day: string, time: string, zone: string): Date {
  const wall = Date.parse(`${day}T${time.length === 5 ? `${time}:00` : time}Z`);
  const offsets = new Set<number>();
  for (const delta of [-36, -12, 0, 12, 36]) {
    const sample = new Date(wall + delta * 3600000);
    const p = localParts(sample, zone);
    offsets.add(Date.parse(`${p.day}T${p.time}:${p.second}Z`) - sample.getTime());
  }
  const candidates = [...offsets].map(offset => new Date(wall - offset)).sort((a,b) => +a - +b);
  const target = `${day}T${time.length === 5 ? `${time}:00` : time}`;
  const render = (d: Date) => { const p = localParts(d,zone); return `${p.day}T${p.time}:${p.second}`; };
  const exact = candidates.find(d => render(d) === target);
  if (exact) return exact;
  const next = candidates.filter(d => render(d) > target).sort((a,b) => render(a).localeCompare(render(b)))[0];
  if (!next) throw new Error("Cannot resolve local time");
  return next;
}
export function parseMemoryDate(value: unknown, zone: string): Date | null {
  if (typeof value !== "string" || !validEventDate(value)) return null;
  if (/(Z|[+-]\d{2}:\d{2})$/.test(value)) return new Date(value);
  const [day, time = "09:00"] = value.split("T");
  return wallTime(day, time.split(".")[0], zone);
}
export type TimeSettings = { timezone: string; quiet_hours_start: string; quiet_hours_end: string };
export function quietEnd(now: Date, s: TimeSettings): Date | null {
  const {day,time} = localParts(now,s.timezone);
  const start=s.quiet_hours_start,end=s.quiet_hours_end;
  if (start === end) return null; // equal means disabled
  const quiet = start < end ? time >= start && time < end : time >= start || time < end;
  if (!quiet) return null;
  const endDay = start > end && time >= start ? addLocalDays(day,1) : day;
  return wallTime(endDay,end,s.timezone);
}
export type PlanMemory = {type:string;event_date:string|null;extra:Record<string,unknown>};
export type Override = {mode:string;lead_minutes:number[];specific_at:string|null};
export function reminderPlan(memory: PlanMemory, s: TimeSettings & {default_lead_days:number[];remind_appointments:boolean;remind_tasks:boolean;remind_expiries:boolean}, override?: Override) {
  const plans: {kind:string;fire:Date;event:Date|null}[]=[];
  if (override?.mode === "none") return plans;
  if (override?.mode === "specific") {
    if (override.specific_at) plans.push({kind:"custom",fire:new Date(override.specific_at),event:null});
    return plans;
  }
  const custom = override?.mode === "lead_times";
  const add = (kind:string,event:Date,minutes:number[]) => {
    for(const lead of custom ? override!.lead_minutes : minutes) plans.push({kind,fire:new Date(+event-lead*60000),event});
  };
  const date = parseMemoryDate(memory.event_date,s.timezone);
  if (date && memory.type === "appointment" && (s.remind_appointments || custom)) {
    // "One day before" means the same local time, not 24h across DST.
    const p=localParts(date,s.timezone);
    if(custom) add("appointment",date,[]);
    else {
      plans.push({kind:"appointment",fire:wallTime(addLocalDays(p.day,-1),p.time,s.timezone),event:date});
      add("appointment",date,[120]);
      const morning=wallTime(p.day,"08:00",s.timezone);
      if(+morning<=+date) plans.push({kind:"appointment",fire:morning,event:date});
    }
  }
  const findDeadline=(extra:Record<string,unknown>,depth=0):Date|null=>{
    if(depth>4)return null;
    for(const [key,value] of Object.entries(extra)) {
      if(/^(?:deadline(?:_date|_at)?|due_date|due_at|task_deadline)$/.test(key)) {
        const parsed=parseMemoryDate(value,s.timezone);if(parsed)return parsed;
      }
      if(value&&typeof value==="object"&&!Array.isArray(value)){
        const parsed=findDeadline(value as Record<string,unknown>,depth+1);if(parsed)return parsed;
      }
    }
    return null;
  };
  const deadline = date ?? findDeadline(memory.extra);
  if(deadline && memory.type==="task" && (s.remind_tasks || custom)) {
    const p=localParts(deadline,s.timezone);
    if(custom) add("task",deadline,[]);
    else plans.push({kind:"task",fire:wallTime(addLocalDays(p.day,-1),p.time,s.timezone),event:deadline},
      {kind:"task",fire:deadline,event:deadline});
  }
  if(s.remind_expiries || custom) {
    const values:unknown[]=[];
    const walk=(object:Record<string,unknown>,depth:number) => {
      if(depth>4) return;
      for(const [key,value] of Object.entries(object)) {
        if(/(?:expir(?:y|ation|es)|renewal|warranty_end|contract_end|subscription_end|valid_until|end_date)/i.test(key)) values.push(value);
        if(value && typeof value==="object" && !Array.isArray(value)) walk(value as Record<string,unknown>,depth+1);
      }
    };
    walk(memory.extra,0);
    for(const value of values) {
      const expiry=parseMemoryDate(value,s.timezone); if(!expiry) continue;
      if(custom) add("expiry",expiry,[]);
      else {
        const p=localParts(expiry,s.timezone);
        for(const lead of s.default_lead_days) plans.push({kind:"expiry",fire:wallTime(addLocalDays(p.day,-lead),p.time,s.timezone),event:expiry});
      }
    }
  }
  return [...new Map(plans.map(p=>[`${p.kind}:${p.fire.toISOString()}`,p])).values()];
}