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
--   score = passed * 10 + reds * 25 + clip points
--         + (finished: 50
--            + (missed <= 3: greatest(0, (3040 - (time_cs + missed * 60)) * 5)))
-- A clip is a pole cleared close enough to knock it flat. Clips in a row
-- are a combo: the k-th clip of a streak is worth 10 * least(k, 12). The
-- payload lists each streak's length; one without that list (sent before
-- combos) is scored at 10 a clip.
-- A streak that reaches 4 sets the skier on fire until it breaks, and on
-- fire pineapples, trees and fences blow up instead of ending the run:
--   + burned pineapples * 50 + burned trees * 25 + burned fences * 25
-- Nothing burns unless some streak reached 4, and at most 100 in a run.
-- A pineapple smashed on fire takes back a miss: missed is what counts,
-- forgiven how many were taken back, and missed + forgiven the poles that
-- really went by.
-- A chase survived is worth more the rarer the animal, at most 20 a run:
--   + survived foxes * 50 + survived wolves * 100 + survived bears * 300
-- The payload says whether the run finished. A finish must account for
-- every pole; a crash scores its poles alone, so claiming one only costs
-- points.
-- time_cs is in turn checked against the server's own elapsed.

-- ---------------------------------------------------------------- constants
-- Kept in sync by hand with game.js: POLE_COUNT, RED_COUNT, POLE_POINTS,
-- RED_POINTS, FINISH_POINTS, PAR_CS, BONUS_PER_CS, MISS_CS, MISS_LIMIT.
-- 25 poles, 4 of
-- them red; 10 points a pole cleared, 25 more if it's red, 10 more if it
-- was clipped (CLIP_POINTS), times its place in a streak up to 12
-- (COMBO_CAP); 50 for
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
-- God mode (the Konami code) gets its own sessions, scored only on the
-- secret board. Fixed when the session is issued, so a run can't change
-- boards halfway.
alter table slalom_sessions add column if not exists god boolean not null default false;
-- Which game the session is for: 'single', or 'endless'.
alter table slalom_sessions add column if not exists mode text not null default 'single';

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

-- The secret GOD MODE board: same shape, its own table.
create table if not exists slalom_god_scores (
  id         uuid primary key default gen_random_uuid(),
  initials   text not null,
  score      int  not null,          -- points; HIGHER wins
  payload    jsonb not null,
  created_at timestamptz not null default now()
);

alter table slalom_god_scores enable row level security;

drop policy if exists slalom_god_scores_public_read on slalom_god_scores;
create policy slalom_god_scores_public_read
  on slalom_god_scores for select
  to anon, authenticated
  using (true);

create index if not exists slalom_god_scores_leaderboard_idx
  on slalom_god_scores (score desc, created_at asc);

-- Every board but Single's: by mode, normal or god, and course where a
-- mode has them.
create table if not exists slalom_mode_scores (
  id         uuid primary key default gen_random_uuid(),
  mode       text not null,
  god        boolean not null default false,
  course     text,
  initials   text not null,
  score      int  not null,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);

alter table slalom_mode_scores enable row level security;

drop policy if exists slalom_mode_scores_public_read on slalom_mode_scores;
create policy slalom_mode_scores_public_read
  on slalom_mode_scores for select
  to anon, authenticated
  using (true);

create index if not exists slalom_mode_scores_board_idx
  on slalom_mode_scores (mode, god, score desc, created_at asc);

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

-- The same, for a GOD MODE run.
create or replace function slalom_start_god_game() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid;
  v_seed bigint := floor(random() * 1099511627776)::bigint;  -- 2^40
begin
  insert into slalom_sessions (seed, god) values (v_seed, true) returning id into v_id;
  return jsonb_build_object('session', v_id, 'seed', v_seed);
end $$;

-- The same, for an Endless run, normal or god mode.
create or replace function slalom_start_endless(p_god boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid;
  v_seed bigint := floor(random() * 1099511627776)::bigint;  -- 2^40
begin
  insert into slalom_sessions (seed, god, mode) values (v_seed, coalesce(p_god, false), 'endless') returning id into v_id;
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

-- Both boards' check, in one place. p_god says which board the caller
-- means, and the session must be of that kind. God mode is on fire from
-- the start, so there it needs no streak to burn, and it can burn far
-- more (the best runs mow ~210 trees).
create or replace function slalom_submit(p_session uuid, p_payload jsonb, p_god boolean)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id       uuid;
  v_god      boolean;
  v_mode     text;
  v_initials text;
  v_score    int;
  v_passed   int;
  v_missed   int;
  v_reds     int;
  v_clips    int;
  v_streaks  jsonb;
  v_n        int;
  v_sum      int := 0;
  v_clip_pts int := 0;
  v_max_streak int := 0;
  v_pine     int;
  v_tree     int;
  v_fence    int;
  v_fox      int;
  v_wolf     int;
  v_bear     int;
  v_forgiven int;
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
  v_streaks  := p_payload->'streaks';
  v_pine     := coalesce((p_payload#>>'{burned,pine}')::int, 0);
  v_tree     := coalesce((p_payload#>>'{burned,tree}')::int, 0);
  v_fence    := coalesce((p_payload#>>'{burned,fence}')::int, 0);
  v_fox      := coalesce((p_payload#>>'{survived,fox}')::int, 0);
  v_wolf     := coalesce((p_payload#>>'{survived,wolf}')::int, 0);
  v_bear     := coalesce((p_payload#>>'{survived,bear}')::int, 0);
  v_forgiven := coalesce((p_payload->>'forgiven')::int, 0);
  v_time_cs  := (p_payload->>'time_cs')::int;
  v_finished := coalesce((p_payload->>'finished')::boolean, false);

  select go_at, paused_cs, pauses, ended_at, used_at, god, mode
    into v_started, v_paused_cs, v_pauses, v_ended, v_used, v_god, v_mode
    from slalom_sessions
   where id = p_session
     for update;

  if not found           then raise exception '%', v_msg; end if;
  if v_god <> p_god      then raise exception '%', v_msg; end if;
  if v_mode <> 'single'  then raise exception '%', v_msg; end if;
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
  -- Only a pineapple can forgive a miss.
  if v_passed < 0 or v_missed < 0 or v_forgiven < 0 then raise exception '%', v_msg; end if;
  if v_forgiven > coalesce((p_payload#>>'{burned,pine}')::int, 0) then raise exception '%', v_msg; end if;
  if v_passed + v_missed + v_forgiven > 25 then raise exception '%', v_msg; end if;
  if v_finished and v_passed + v_missed + v_forgiven <> 25 then raise exception '%', v_msg; end if;

  -- Every course has exactly 4 red poles, and a red pole only counts if
  -- it was actually cleared.
  if v_reds < 0 or v_reds > 4 or v_reds > v_passed then raise exception '%', v_msg; end if;

  -- Only a pole that was cleared can have been clipped.
  if v_clips < 0 or v_clips > v_passed then raise exception '%', v_msg; end if;

  -- The streaks add up to the clips, and each one after the first needs a
  -- pole cleared without a clip, or missed, to have broken the one before.
  if v_streaks is null then
    v_clip_pts := v_clips * 10;
  else
    if jsonb_typeof(v_streaks) <> 'array' then raise exception '%', v_msg; end if;
    if jsonb_array_length(v_streaks) > (v_passed - v_clips) + v_missed + v_forgiven + 1 then raise exception '%', v_msg; end if;
    for v_n in select (e #>> '{}')::int from jsonb_array_elements(v_streaks) e loop
      if v_n is null or v_n < 1 then raise exception '%', v_msg; end if;
      v_sum := v_sum + v_n;
      v_max_streak := greatest(v_max_streak, v_n);
      v_clip_pts := v_clip_pts + 10 * (least(v_n, 12) * (least(v_n, 12) + 1) / 2 + greatest(v_n - 12, 0) * 12);
    end loop;
    if v_sum <> v_clips then raise exception '%', v_msg; end if;
  end if;

  -- Only a skier on fire burns anything, and only so much in one run.
  if v_pine < 0 or v_tree < 0 or v_fence < 0 then raise exception '%', v_msg; end if;
  if v_pine + v_tree + v_fence > (case when p_god then 400 else 100 end) then raise exception '%', v_msg; end if;
  if not p_god and v_pine + v_tree + v_fence > 0 and v_max_streak < 4 then raise exception '%', v_msg; end if;

  -- Animals are rare on a course; twenty escapes in one run are not real.
  if v_fox < 0 or v_wolf < 0 or v_bear < 0 or v_fox + v_wolf + v_bear > 20 then raise exception '%', v_msg; end if;

  if length(coalesce(v_initials, '')) <> 3 then raise exception '%', v_msg; end if;

  if v_time_cs <= 0 then raise exception '%', v_msg; end if;
  v_expected := v_passed * 10 + v_reds * 25 + v_clip_pts
              + v_pine * 50 + v_tree * 25 + v_fence * 25
              + v_fox * 50 + v_wolf * 100 + v_bear * 300;
  if v_finished then
    v_expected := v_expected + 50;
    if v_missed <= 3 then
      v_expected := v_expected + greatest(0, (3040 - (v_time_cs + v_missed * 60)) * 5);
    end if;
  end if;
  if v_score <> v_expected then raise exception '%', v_msg; end if;

  if p_god then
    insert into slalom_god_scores (initials, score, payload)
    values (v_initials, v_score, p_payload)
    returning id into v_id;
  else
    insert into slalom_scores (initials, score, payload)
    values (v_initials, v_score, p_payload)
    returning id into v_id;
  end if;

  update slalom_sessions set used_at = now() where id = p_session;

  return v_id;
end $$;

-- An Endless score. The same kind of check as a course's, but there's no
-- finish or time bonus to add, a run can last 3 hours, at most 4 poles are
-- missed (the 4th ends it), and with no fixed number of poles the counts
-- are held against the time it took.
--   score = passed * 10 + reds * 25 + clip points + burned + survived
-- See slalom_submit for the clip, burn and survived points.
create or replace function slalom_submit_endless(p_session uuid, p_payload jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id       uuid;
  v_god      boolean;
  v_mode     text;
  v_initials text;
  v_score    int;
  v_passed   int;
  v_missed   int;
  v_reds     int;
  v_clips    int;
  v_streaks  jsonb;
  v_n        int;
  v_sum      int := 0;
  v_clip_pts int := 0;
  v_max_streak int := 0;
  v_pine     int;
  v_tree     int;
  v_fence    int;
  v_fox      int;
  v_wolf     int;
  v_bear     int;
  v_forgiven int;
  v_burned   int;
  v_time_cs  int;
  v_expected int;
  v_started  timestamptz;
  v_paused_cs numeric;
  v_pauses   int;
  v_ended    timestamptz;
  v_used     timestamptz;
  v_elapsed_cs numeric;
  v_secs     numeric;
  v_msg constant text := 'score not accepted: if you wanna be a smarty pants your job is to do the work!';
begin
  v_initials := p_payload->>'initials';
  v_score    := (p_payload->>'score')::int;
  v_passed   := (p_payload->>'passed')::int;
  v_missed   := (p_payload->>'missed')::int;
  v_reds     := (p_payload->>'reds')::int;
  v_clips    := coalesce((p_payload->>'clips')::int, 0);
  v_streaks  := p_payload->'streaks';
  v_pine     := coalesce((p_payload#>>'{burned,pine}')::int, 0);
  v_tree     := coalesce((p_payload#>>'{burned,tree}')::int, 0);
  v_fence    := coalesce((p_payload#>>'{burned,fence}')::int, 0);
  v_fox      := coalesce((p_payload#>>'{survived,fox}')::int, 0);
  v_wolf     := coalesce((p_payload#>>'{survived,wolf}')::int, 0);
  v_bear     := coalesce((p_payload#>>'{survived,bear}')::int, 0);
  v_forgiven := coalesce((p_payload->>'forgiven')::int, 0);
  v_time_cs  := (p_payload->>'time_cs')::int;

  select go_at, paused_cs, pauses, ended_at, used_at, god, mode
    into v_started, v_paused_cs, v_pauses, v_ended, v_used, v_god, v_mode
    from slalom_sessions
   where id = p_session
     for update;

  if not found              then raise exception '%', v_msg; end if;
  if v_mode <> 'endless'    then raise exception '%', v_msg; end if;
  if v_started is null      then raise exception '%', v_msg; end if;
  if v_ended is null        then raise exception '%', v_msg; end if;
  if v_used  is not null    then raise exception '%', v_msg; end if;

  v_elapsed_cs := extract(epoch from (v_ended - v_started)) * 100;
  if v_elapsed_cs > 1080000 then raise exception '%', v_msg; end if;  -- 3 hours
  v_elapsed_cs := v_elapsed_cs - v_paused_cs;
  v_secs := v_elapsed_cs / 100;

  if v_time_cs <= 0 then raise exception '%', v_msg; end if;
  if abs(v_time_cs - v_elapsed_cs) > 400 + 100 * v_pauses then raise exception '%', v_msg; end if;
  if length(coalesce(v_initials, '')) <> 3 then raise exception '%', v_msg; end if;

  -- Poles can't go by faster than the skier can reach them.
  if v_passed < 0 or v_missed < 0 or v_missed > 4 then raise exception '%', v_msg; end if;
  if v_forgiven < 0 or v_forgiven > v_pine then raise exception '%', v_msg; end if;
  if v_passed + v_missed + v_forgiven > v_secs * 4 + 8 then raise exception '%', v_msg; end if;
  if v_reds < 0 or v_reds > v_passed then raise exception '%', v_msg; end if;
  if v_clips < 0 or v_clips > v_passed then raise exception '%', v_msg; end if;

  if jsonb_typeof(v_streaks) <> 'array' then raise exception '%', v_msg; end if;
  if jsonb_array_length(v_streaks) > (v_passed - v_clips) + v_missed + v_forgiven + 1 then raise exception '%', v_msg; end if;
  for v_n in select (e #>> '{}')::int from jsonb_array_elements(v_streaks) e loop
    if v_n is null or v_n < 1 then raise exception '%', v_msg; end if;
    v_sum := v_sum + v_n;
    v_max_streak := greatest(v_max_streak, v_n);
    v_clip_pts := v_clip_pts + 10 * (least(v_n, 12) * (least(v_n, 12) + 1) / 2 + greatest(v_n - 12, 0) * 12);
  end loop;
  if v_sum <> v_clips then raise exception '%', v_msg; end if;

  -- God mode mows forests, about three trees a second at best.
  v_burned := v_pine + v_tree + v_fence;
  if v_pine < 0 or v_tree < 0 or v_fence < 0 then raise exception '%', v_msg; end if;
  if v_burned > v_secs * (case when v_god then 6 else 2 end) + 50 then raise exception '%', v_msg; end if;
  if not v_god and v_burned > 0 and v_max_streak < 4 then raise exception '%', v_msg; end if;

  if v_fox < 0 or v_wolf < 0 or v_bear < 0 then raise exception '%', v_msg; end if;
  if v_fox + v_wolf + v_bear > v_secs / 5 + 5 then raise exception '%', v_msg; end if;

  v_expected := v_passed * 10 + v_reds * 25 + v_clip_pts
              + v_pine * 50 + v_tree * 25 + v_fence * 25
              + v_fox * 50 + v_wolf * 100 + v_bear * 300;
  if v_score <> v_expected then raise exception '%', v_msg; end if;

  insert into slalom_mode_scores (mode, god, initials, score, payload)
  values ('endless', v_god, v_initials, v_score, p_payload)
  returning id into v_id;

  update slalom_sessions set used_at = now() where id = p_session;

  return v_id;
end $$;

-- The two doors in: the real board and the secret one.
create or replace function slalom_submit_score(p_session uuid, p_payload jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
begin
  return slalom_submit(p_session, p_payload, false);
end $$;

create or replace function slalom_submit_god_score(p_session uuid, p_payload jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
begin
  return slalom_submit(p_session, p_payload, true);
end $$;

grant execute on function slalom_start_game()               to anon, authenticated;
grant execute on function slalom_start_god_game()           to anon, authenticated;
grant execute on function slalom_go(uuid)                   to anon, authenticated;
grant execute on function slalom_pause(uuid)                to anon, authenticated;
grant execute on function slalom_resume(uuid)               to anon, authenticated;
grant execute on function slalom_end_game(uuid)             to anon, authenticated;
grant execute on function slalom_submit_score(uuid, jsonb)  to anon, authenticated;
grant execute on function slalom_submit_god_score(uuid, jsonb) to anon, authenticated;
grant execute on function slalom_start_endless(boolean)     to anon, authenticated;
grant execute on function slalom_submit_endless(uuid, jsonb) to anon, authenticated;
-- Reached only through the two above.
revoke execute on function slalom_submit(uuid, jsonb, boolean) from public, anon, authenticated;
