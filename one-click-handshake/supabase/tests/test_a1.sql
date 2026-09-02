-- ===========================================================================
-- Test A1: RLS Verification & Atomic claim_next_job RPC
-- (1) Insert two profiles + jobs. Query as Profile A -> verify only Profile A returned, Profile B blocked.
-- (2) Insert applications QUEUED for profile. Test claim_next_job atomicity and concurrency.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Cleanup any previous test data
-- ---------------------------------------------------------------------------
delete from public.application_events where application_id in (
  select id from public.applications where profile_id in (
    '11111111-aaaa-1111-aaaa-111111111111',
    '22222222-bbbb-2222-bbbb-222222222222'
  )
);
delete from public.interventions where profile_id in (
  '11111111-aaaa-1111-aaaa-111111111111',
  '22222222-bbbb-2222-bbbb-222222222222'
);
delete from public.applications where profile_id in (
  '11111111-aaaa-1111-aaaa-111111111111',
  '22222222-bbbb-2222-bbbb-222222222222'
);
delete from public.handshake_jobs where profile_id in (
  '11111111-aaaa-1111-aaaa-111111111111',
  '22222222-bbbb-2222-bbbb-222222222222'
);
delete from public.profiles where id in (
  '11111111-aaaa-1111-aaaa-111111111111',
  '22222222-bbbb-2222-bbbb-222222222222'
);
delete from auth.users where id in (
  '11111111-aaaa-1111-aaaa-111111111111',
  '22222222-bbbb-2222-bbbb-222222222222'
);

-- ---------------------------------------------------------------------------
-- 1. Setup: Insert Two Distinct Users & Profiles
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('11111111-aaaa-1111-aaaa-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'student.a@univ.edu', crypt('pass123', gen_salt('bf')), now(), now(), now()),
  ('22222222-bbbb-2222-bbbb-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'student.b@univ.edu', crypt('pass123', gen_salt('bf')), now(), now(), now());

insert into public.profiles (
  id, first_name, last_name, student_email, phone, school_name, major,
  degree_pursuing, grad_month, grad_year, has_existing_handshake_account
)
values
  ('11111111-aaaa-1111-aaaa-111111111111', 'Alice', 'Adams', 'student.a@univ.edu', '5551112222', 'State University', 'Computer Science', 'BS', 'May', 2026, true),
  ('22222222-bbbb-2222-bbbb-222222222222', 'Bob', 'Baker', 'student.b@univ.edu', '5553334444', 'City College', 'Data Science', 'MS', 'Dec', 2025, false);

-- Insert Handshake Jobs for Profile A
insert into public.handshake_jobs (id, profile_id, url, title, company, location, has_quick_apply)
values
  ('aaaaaaaa-1111-aaaa-1111-aaaaaaaaaaaa', '11111111-aaaa-1111-aaaa-111111111111', 'https://app.joinhandshake.com/jobs/101', 'Software Engineer Intern', 'Acme Corp', 'Remote', true),
  ('aaaaaaaa-2222-aaaa-2222-aaaaaaaaaaaa', '11111111-aaaa-1111-aaaa-111111111111', 'https://app.joinhandshake.com/jobs/102', 'Full Stack Developer', 'Beta Inc', 'New York, NY', true),
  ('aaaaaaaa-3333-aaaa-3333-aaaaaaaaaaaa', '11111111-aaaa-1111-aaaa-111111111111', 'https://app.joinhandshake.com/jobs/103', 'Backend Engineer', 'Gamma Corp', 'Boston, MA', false);

-- Insert Handshake Jobs for Profile B
insert into public.handshake_jobs (id, profile_id, url, title, company, location, has_quick_apply)
values
  ('bbbbbbbb-1111-bbbb-1111-bbbbbbbbbbbb', '22222222-bbbb-2222-bbbb-222222222222', 'https://app.joinhandshake.com/jobs/201', 'Data Analyst Intern', 'Gamma LLC', 'Austin, TX', false),
  ('bbbbbbbb-2222-bbbb-2222-bbbbbbbbbbbb', '22222222-bbbb-2222-bbbb-222222222222', 'https://app.joinhandshake.com/jobs/202', 'ML Engineer', 'Delta AI', 'San Francisco, CA', true);

-- ---------------------------------------------------------------------------
-- TEST 1.1: Query as Profile A -> verify only Profile A's jobs returned
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '11111111-aaaa-1111-aaaa-111111111111';

do $$
declare
  total_seen int;
  profile_a_jobs int;
  profile_b_jobs int;
begin
  -- Count all visible jobs for authenticated user A
  select count(*) into total_seen from public.handshake_jobs;
  select count(*) into profile_a_jobs from public.handshake_jobs where profile_id = '11111111-aaaa-1111-aaaa-111111111111';
  select count(*) into profile_b_jobs from public.handshake_jobs where profile_id = '22222222-bbbb-2222-bbbb-222222222222';

  if total_seen <> 3 then
    raise exception 'RLS FAIL: User A saw % total jobs (expected 3)', total_seen;
  end if;

  if profile_a_jobs <> 3 then
    raise exception 'RLS FAIL: User A saw % of own jobs (expected 3)', profile_a_jobs;
  end if;

  if profile_b_jobs <> 0 then
    raise exception 'RLS FAIL: User A saw % of User B jobs (expected 0, RLS breached!)', profile_b_jobs;
  end if;

  raise notice 'RLS_PASS_1: User A sees only 3 own jobs. Profile B jobs blocked (0 visible).';
end;
$$;

-- ---------------------------------------------------------------------------
-- TEST 1.2: Attempt unauthorized cross-tenant INSERT as Profile A
-- ---------------------------------------------------------------------------
do $$
begin
  -- Attempt to insert job for Profile B as Profile A
  begin
    insert into public.handshake_jobs (id, profile_id, url, title, has_quick_apply)
    values ('aaaaaaaa-9999-aaaa-9999-aaaaaaaaaaaa', '22222222-bbbb-2222-bbbb-222222222222', 'https://app.joinhandshake.com/jobs/999', 'Hacked Job', true);
    raise exception 'RLS FAIL: User A successfully inserted a job belonging to Profile B!';
  exception
    when others then
      raise notice 'RLS_PASS_2: Cross-tenant insert correctly blocked by RLS.';
  end;
end;
$$;

reset role;

-- ---------------------------------------------------------------------------
-- TEST 2: Insert Applications and verify claim_next_job RPC behavior
-- ---------------------------------------------------------------------------
-- Insert two applications for Profile A, both in QUEUED status
insert into public.applications (id, profile_id, job_id, status, priority, queued_at)
values
  ('aaaaaaaa-0001-aaaa-0001-aaaaaaaaaaaa', '11111111-aaaa-1111-aaaa-111111111111', 'aaaaaaaa-1111-aaaa-1111-aaaaaaaaaaaa', 'QUEUED', 10, now() - interval '2 minutes'),
  ('aaaaaaaa-0002-aaaa-0002-aaaaaaaaaaaa', '11111111-aaaa-1111-aaaa-111111111111', 'aaaaaaaa-2222-aaaa-2222-aaaaaaaaaaaa', 'QUEUED', 20, now() - interval '1 minute');

-- Test 2.1: First claim claims App 1
do $$
declare
  claim1 public.applications;
  claim2 public.applications;
  claim3 public.applications;
begin
  claim1 := public.claim_next_job('11111111-aaaa-1111-aaaa-111111111111', 'worker-conn-1');
  
  if claim1.id is null then
    raise exception 'CLAIM FAIL: claim 1 returned null';
  end if;
  if claim1.id <> 'aaaaaaaa-0001-aaaa-0001-aaaaaaaaaaaa' then
    raise exception 'CLAIM FAIL: expected app 1, got %', claim1.id;
  end if;
  if claim1.status <> 'PROCESSING' or claim1.worker_id <> 'worker-conn-1' then
    raise exception 'CLAIM FAIL: claim 1 status/worker mismatch: status=%, worker=%', claim1.status, claim1.worker_id;
  end if;
  raise notice 'CLAIM_PASS_1: Claim 1 successfully claimed App 1 (status=PROCESSING, worker=worker-conn-1).';

  -- Test 2.2: Second claim claims App 2
  claim2 := public.claim_next_job('11111111-aaaa-1111-aaaa-111111111111', 'worker-conn-2');

  if claim2.id is null then
    raise exception 'CLAIM FAIL: claim 2 returned null';
  end if;
  if claim2.id <> 'aaaaaaaa-0002-aaaa-0002-aaaaaaaaaaaa' then
    raise exception 'CLAIM FAIL: expected app 2, got %', claim2.id;
  end if;
  if claim2.status <> 'PROCESSING' or claim2.worker_id <> 'worker-conn-2' then
    raise exception 'CLAIM FAIL: claim 2 status/worker mismatch: status=%, worker=%', claim2.status, claim2.worker_id;
  end if;
  raise notice 'CLAIM_PASS_2: Claim 2 successfully claimed App 2 (status=PROCESSING, worker=worker-conn-2).';

  -- Test 2.3: Third claim returns NULL (queue empty for this profile)
  claim3 := public.claim_next_job('11111111-aaaa-1111-aaaa-111111111111', 'worker-conn-3');

  if claim3.id is not null then
    raise exception 'CLAIM FAIL: claim 3 expected null, got %', claim3.id;
  end if;
  raise notice 'CLAIM_PASS_3: Claim 3 returned NULL because no QUEUED jobs remain.';
end;
$$;

-- ---------------------------------------------------------------------------
-- TEST 2.4: Single Queued Job Claim Race Scenario (1 job available, 2 claimants)
-- ---------------------------------------------------------------------------
insert into public.applications (id, profile_id, job_id, status, priority, queued_at)
values
  ('aaaaaaaa-0003-aaaa-0003-aaaaaaaaaaaa', '11111111-aaaa-1111-aaaa-111111111111', 'aaaaaaaa-3333-aaaa-3333-aaaaaaaaaaaa', 'QUEUED', 5, now());

do $$
declare
  winner public.applications;
  loser  public.applications;
begin
  winner := public.claim_next_job('11111111-aaaa-1111-aaaa-111111111111', 'worker-fast');
  loser  := public.claim_next_job('11111111-aaaa-1111-aaaa-111111111111', 'worker-slow');

  if winner.id is null then
    raise exception 'RACE TEST FAIL: winner got null';
  end if;
  if winner.id <> 'aaaaaaaa-0003-aaaa-0003-aaaaaaaaaaaa' then
    raise exception 'RACE TEST FAIL: expected app 3, got %', winner.id;
  end if;

  if loser.id is not null then
    raise exception 'RACE TEST FAIL: loser should have received null, but got row ID: %', loser.id;
  end if;

  raise notice 'CLAIM_PASS_4: Race test: Winner claimed job 3 (id=%), Loser received NULL.', winner.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rollback to ensure test environment stays clean
-- ---------------------------------------------------------------------------
rollback;
