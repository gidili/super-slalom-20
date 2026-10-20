-- super-slalom-20 score pipeline.
--
-- Same architecture as snake-bit: the server stamps both edges of a run on
-- its own clock, and a session spends on use. Three things differ:
--
--   1. Names are prefixed `slalom_`, because all three games share one
--      Supabase project and snake-bit owns the unprefixed names.
--
--   2. The course is SEEDED BY THE SERVER. slalom_start_game() hands back a
--      seed alongside the session, and the client builds the course from
--      it: shape, and which poles are red. Every course has exactly 25
--      poles and exactly 4 red ones, so the server checks the player's
--      counts against constants rather than rebuilding the course. The
--      seed is stored with the session, which keeps any submitted run
--      reproducible if a score ever needs auditing.
--
--   3. LOWER time is better, so the server's check is a FLOOR as well as a
--      ceiling (snake-bit only needs the ceiling). The session opens with
--      the title screen, which shows the course, so the clock starts only
--      at slalom_go(); pauses are stamped by the server and taken off its
--      clock. Waiting on the title or sitting paused never counts.
--
-- The score is POINTS and higher is better. Poles earn points; a finished
-- run also earns 50 for the line and a bonus for its time under par, each
-- missed pole adding 0.60s to that time, and no bonus past 3 misses:
--   score = passed * 10 + reds * 25 + clips * 10
--         + (finished: 50
--            + (missed <= 3: greatest(0, (3040 - (time_cs + missed * 60)) * 5)))
-- A clip is a pole cleared close enough to knock it flat.
-- The payload says whether the run finished. A finish must account for
-- every pole; a crash scores its poles alone, so claiming one only costs
-- points.
-- time_cs is in turn checked against the server's own elapsed.

-- ---------------------------------------------------------------- constants
-- Kept in sync by hand with game.js: POLE_COUNT, RED_COUNT, POLE_POINTS,
-- RED_POINTS, FINISH_POINTS, PAR_CS, BONUS_PER_CS, MISS_CS, MISS_LIMIT.
-- 25 poles, 4 of
-- them red; 10 points a pole cleared, 25 more if it's red, 10 more if it
-- was clipped (CLIP_POINTS); 50 for
-- finishing; 5 points for every hundredth of a second under 30.40s, with
-- 0.60s added per missed pole; more than 3 missed and there's no bonus.

-- ---------------------------------------------------------------- sessions

create table if not exists slalom_sessions (
  id         uuid primary key default gen_random_uuid(),
  seed       bigint not null,
  started_at timestamptz not null default now(),  -- issued (title screen)
  go_at      timestamptz,                          -- the run's clock starts
  paused_at  timestamptz,                          -- set while paused
  paused_cs  numeric not null default 0,           -- total time paused
  pauses     int not null default 0,
  ended_at   timestamptz,
  used_at    timestamptz
);

-- RLS on with NO policies: the anon key cannot read this table, so it
-- cannot learn a seed it was not issued, forge a row, or backdate a start.
alter table slalom_sessions enable row level security;

create index if not exists slalom_sessions_started_at_idx on slalom_sessions (started_at);

-- ------------------------------------------------------------------ scores

create table if not exists slalom_scores (
  id         uuid primary key default gen_random_uuid(),
  initials   text not null,
  score      int  not null,          -- points; HIGHER wins
  payload    jsonb not null,
  created_at timestamptz not null default now()
);

alter table slalom_scores enable row level security;

drop policy if exists slalom_scores_public_read on slalom_scores;
create policy slalom_scores_public_read
  on slalom_scores for select
  to anon, authenticated
  using (true);

-- Highest first, ties to whoever got there first.
create index if not exists slalom_scores_leaderboard_idx
  on slalom_scores (score desc, created_at asc);

-- --------------------------------------------------------------- functions

-- Returns {"session": uuid, "seed": bigint}. A 40-bit seed: everything the
-- client derives from it must fit exactly in a JS number (< 2^53).
create or replace function slalom_start_game() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid;
  v_seed bigint := floor(random() * 1099511627776)::bigint;  -- 2^40
begin
  insert into slalom_sessions (seed) values (v_seed) returning id into v_id;
  return jsonb_build_object('session', v_id, 'seed', v_seed);
end $$;

-- Space on the title. First call wins, so a retry can't move the start.
create or replace function slalom_go(p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update slalom_sessions set go_at = now()
   where id = p_session and go_at is null and ended_at is null;
end $$;

-- Space mid-run, either way. Ignored out of order (not running, already
-- paused / not paused, already ended).
create or replace function slalom_pause(p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update slalom_sessions set paused_at = now()
   where id = p_session and go_at is not null and ended_at is null and paused_at is null;
end $$;

create or replace function slalom_resume(p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update slalom_sessions
     set paused_cs = paused_cs + extract(epoch from (now() - paused_at)) * 100,
         paused_at = null,
         pauses    = pauses + 1
   where id = p_session and ended_at is null and paused_at is not null;
end $$;

-- Crash or finish. First call wins. A run ended while paused ends where
-- the pause began.
create or replace function slalom_end_game(p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update slalom_sessions set ended_at = coalesce(paused_at, now()), paused_at = null
   where id = p_session and go_at is not null and ended_at is null;
end $$;

create or replace function slalom_submit_score(p_session uuid, p_payload jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id       uuid;
  v_initials text;
  v_score    int;
  v_passed   int;
  v_missed   int;
  v_reds     int;
  v_clips    int;
  v_time_cs  int;
  v_finished boolean;
  v_expected int;
  v_started  timestamptz;
  v_paused_cs numeric;
  v_pauses   int;
  v_ended    timestamptz;
  v_used     timestamptz;
  v_elapsed_cs numeric;
  v_msg constant text := 'score not accepted: if you wanna be a smarty pants your job is to do the work!';
begin
  v_initials := p_payload->>'initials';
  v_score    := (p_payload->>'score')::int;
  v_passed   := (p_payload->>'passed')::int;
  v_missed   := (p_payload->>'missed')::int;
  v_reds     := (p_payload->>'reds')::int;
  v_clips    := coalesce((p_payload->>'clips')::int, 0);
  v_time_cs  := (p_payload->>'time_cs')::int;
  v_finished := coalesce((p_payload->>'finished')::boolean, false);

  select go_at, paused_cs, pauses, ended_at, used_at
    into v_started, v_paused_cs, v_pauses, v_ended, v_used
    from slalom_sessions
   where id = p_session
     for update;

  if not found           then raise exception '%', v_msg; end if;
  if v_started is null   then raise exception '%', v_msg; end if;
  if v_ended is null     then raise exception '%', v_msg; end if;
  if v_used  is not null then raise exception '%', v_msg; end if;

  -- Go to end, paused time and all, is capped at an hour; the run itself
  -- is that less the pauses.
  v_elapsed_cs := extract(epoch from (v_ended - v_started)) * 100;
  if v_elapsed_cs > 360000 then raise exception '%', v_msg; end if;  -- 1 hour
  v_elapsed_cs := v_elapsed_cs - v_paused_cs;

  -- The run time must agree with the server's clock, in both directions:
  -- claiming less is the cheat here. Go and end each cost a network round
  -- trip, and so does each pause and resume, so the slack grows with them.
  if abs(v_time_cs - v_elapsed_cs) > 400 + 100 * v_pauses then raise exception '%', v_msg; end if;

  -- Every pole is cleared or missed at most once; all 25 on a finish.
  if v_passed < 0 or v_missed < 0       then raise exception '%', v_msg; end if;
  if v_passed + v_missed > 25           then raise exception '%', v_msg; end if;
  if v_finished and v_passed + v_missed <> 25 then raise exception '%', v_msg; end if;

  -- Every course has exactly 4 red poles, and a red pole only counts if
  -- it was actually cleared.
  if v_reds < 0 or v_reds > 4 or v_reds > v_passed then raise exception '%', v_msg; end if;

  -- Only a pole that was cleared can have been clipped.
  if v_clips < 0 or v_clips > v_passed then raise exception '%', v_msg; end if;

  if length(coalesce(v_initials, '')) <> 3 then raise exception '%', v_msg; end if;

  if v_time_cs <= 0 then raise exception '%', v_msg; end if;
  v_expected := v_passed * 10 + v_reds * 25 + v_clips * 10;
  if v_finished then
    v_expected := v_expected + 50;
    if v_missed <= 3 then
      v_expected := v_expected + greatest(0, (3040 - (v_time_cs + v_missed * 60)) * 5);
    end if;
  end if;
  if v_score <> v_expected then raise exception '%', v_msg; end if;

  insert into slalom_scores (initials, score, payload)
  values (v_initials, v_score, p_payload)
  returning id into v_id;

  update slalom_sessions set used_at = now() where id = p_session;

  return v_id;
end $$;

grant execute on function slalom_start_game()               to anon, authenticated;
grant execute on function slalom_go(uuid)                   to anon, authenticated;
grant execute on function slalom_pause(uuid)                to anon, authenticated;
grant execute on function slalom_resume(uuid)               to anon, authenticated;
grant execute on function slalom_end_game(uuid)             to anon, authenticated;
grant execute on function slalom_submit_score(uuid, jsonb)  to anon, authenticated;
