-- Keeps slalom_sessions from growing without bound.
--
-- A session opens whenever the title screen shows. Most never produce a
-- score: a title nobody starts leaves one never begun, every crash leaves
-- one ended but unused (a crash has no time to submit), and a tab closed
-- mid-run leaves one never ended at all. None can ever be redeemed.
-- Harmless individually, unbounded in aggregate.
--
-- Seven days, not one: the filter also catches finished-but-unsubmitted
-- runs, and a player who finishes and submits later still needs their
-- session to exist.
--
-- Sessions that DID produce a score are kept. They are the only record of
-- when the server saw a given game start and end, i.e. the audit trail for
-- the score it produced.
--
-- Re-running is safe: cron.schedule() replaces a job of the same name.

create extension if not exists pg_cron;

select cron.schedule(
  'prune-orphan-slalom-sessions',
  '47 3 * * *',   -- daily, UTC. Offset from snake-bit (03:17).
  $$delete from slalom_sessions
     where used_at is null
       and started_at < now() - interval '7 days'$$
);

-- Inspect:   select jobname, schedule, active from cron.job;
--            select jobid, status, return_message, start_time
--              from cron.job_run_details order by start_time desc limit 5;
-- Remove:    select cron.unschedule('prune-orphan-slalom-sessions');
