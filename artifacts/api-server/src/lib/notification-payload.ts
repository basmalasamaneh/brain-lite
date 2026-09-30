export type PushNotice = {
  id:string; title:string; body:string; url:string; kind:string; reminder_id:string|null;
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function safePushDestination(value:string) {
  if(value==="/" || /^\/memories\/[1-9]\d*$/.test(value) || value==="/spaces")return value;
  const space=/^\/spaces\/([^/]+)$/.exec(value);
  return space&&uuid.test(space[1])?value:"/";
}
// Hiding lock-screen text must not disable authenticated Done/Snooze/deep links.
// Select fields explicitly: opaque row IDs are operational metadata, never
// credentials. No owner ID, session, subscription key or arbitrary source field.
export function notificationPayload(notice:PushNotice,hideDetails:boolean,language:string) {
  const ar=language==="ar";
  const reminderId=notice.reminder_id&&uuid.test(notice.reminder_id)?notice.reminder_id:null;
  const notificationId=uuid.test(notice.id)?notice.id:null;
  return {
    title:hideDetails?"Brain Lite":notice.title,
    body:hideDetails?(ar?"لديك تذكير":"You have a reminder"):notice.body,
    url:safePushDestination(notice.url),
    kind:hideDetails?"reminder":notice.kind,
    notification_id:notificationId,
    reminder_id:reminderId,
    actions:reminderId?[
      {action:"done",title:ar?"تم":"Done"},
      {action:"snooze",title:ar?"تأجيل ساعة":"Snooze 1h"},
    ]:[],
  };
}