-- Once a minute, ask the portal to deliver due scheduled chat messages
-- (app/api/chat/scheduled/deliver). The route needs no secret — it only acts on
-- messages whose send time has passed — so the job carries none.
create extension if not exists pg_cron;
select cron.unschedule('chat-scheduled-delivery') where exists (select 1 from cron.job where jobname = 'chat-scheduled-delivery');
select cron.schedule(
  'chat-scheduled-delivery',
  '* * * * *',
  $$ select (extensions.http_get('https://portal.cubetuition.com.au/api/chat/scheduled/deliver')).status $$
);
