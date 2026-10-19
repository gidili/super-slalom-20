-- super-slalom-20 score pipeline.
--
-- Same architecture as snake-bit: the server stamps both edges of a run on
-- its own clock, and a session spends on use. Two things differ:
--
--   1. Names are prefixed `slalom_`, because all three games share one
--      Supabase project and snake-bit owns the unprefixed names.
--
--   2. The course is SEEDED BY THE SERVER. slalom_start_game() hands back a
--      seed alongside the session, and the client builds the course from
--      it: shape, and which poles are red. Every course has exactly 20
--      poles and exactly 4 red ones, so the server checks the player's
--      counts against constants rather than rebuilding the course. The
--      seed is stored with the session, which keeps any submitted run
--      reproducible if a score ever needs auditing.
--
-- The score is POINTS and higher is better. It comes from the final time
-- in centiseconds:
--   final_cs = time_cs + missed * 300 - reds * 150
--   score    = greatest(0, 10000 - final_cs)
-- time_cs is in turn checked against the server's own elapsed.

-- ---------------------------------------------------------------- constants
-- Kept in sync by hand with game.js: POLE_COUNT, RED_COUNT, MALUS_CS,
-- BONUS_CS, POINTS_BASE. 20 poles, 4 of them red; a missed pole costs
-- 3.00s; a red pole cleared saves 1.50s; the score is 10000 less the final
-- time in centiseconds.

-- ---------------------------------------------------------------- sessions

create table if not exists slalom_sessions (
  id         uuid primary key default gen_random_uuid(),
  seed       bigint not null,
  started_at timestamptz not null default now(),
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

create or replace function slalom_end_game(p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update slalom_sessions set ended_at = now()
   where id = p_session and ended_at is null;
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
  v_time_cs  int;
  v_final    int;
  v_expected int;
  v_started  timestamptz;
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
  v_time_cs  := (p_payload->>'time_cs')::int;

  select started_at, ended_at, used_at
    into v_started, v_ended, v_used
    from slalom_sessions
   where id = p_session
     for update;

  if not found           then raise exception '%', v_msg; end if;
  if v_ended is null     then raise exception '%', v_msg; end if;
  if v_used  is not null then raise exception '%', v_msg; end if;

  v_elapsed_cs := extract(epoch from (v_ended - v_started)) * 100;

  if v_elapsed_cs > 360000 then raise exception '%', v_msg; end if;  -- 1 hour

  -- The run time must agree with the server's clock. Generous in both
  -- directions: start/end each cost one network round trip.
  if abs(v_time_cs - v_elapsed_cs) > 400 then raise exception '%', v_msg; end if;

  -- Every pole is either cleared or missed, exactly once.
  if v_passed < 0 or v_missed < 0       then raise exception '%', v_msg; end if;
  if v_passed + v_missed <> 20          then raise exception '%', v_msg; end if;

  -- Every course has exactly 4 red poles, and a red pole only counts if
  -- it was actually cleared.
  if v_reds < 0 or v_reds > 4 or v_reds > v_passed then raise exception '%', v_msg; end if;

  if length(coalesce(v_initials, '')) <> 3 then raise exception '%', v_msg; end if;

  v_final := v_time_cs + v_missed * 300 - v_reds * 150;
  if v_final <= 0 then raise exception '%', v_msg; end if;
  v_expected := greatest(0, 10000 - v_final);
  if v_score <> v_expected then raise exception '%', v_msg; end if;

  insert into slalom_scores (initials, score, payload)
  values (v_initials, v_score, p_payload)
  returning id into v_id;

  update slalom_sessions set used_at = now() where id = p_session;

  return v_id;
end $$;

grant execute on function slalom_start_game()               to anon, authenticated;
grant execute on function slalom_end_game(uuid)             to anon, authenticated;
grant execute on function slalom_submit_score(uuid, jsonb)  to anon, authenticated;
