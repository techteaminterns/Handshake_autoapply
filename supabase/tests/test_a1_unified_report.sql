-- ===========================================================================
-- Test A1 Unified Report
-- ===========================================================================

drop table if exists pg_temp.test_results;
create temp table test_results (
  step_num int,
  test_phase text,
  item_id text,
  owner_id text,
  status_or_detail text,
  test_verdict text
);
grant all on table test_results to authenticated, anon, public;

-- 1. Clean up old test data if any
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

-- 2. Insert Users & Profiles
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

-- 3. Insert handshake_jobs for Profile A (2 jobs) and Profile B (2 jobs)
insert into public.handshake_jobs (id, profile_id, url, title, company, location, has_quick_apply)
values
  ('aaaaaaaa-1111-aaaa-1111-aaaaaaaaaaaa', '11111111-aaaa-1111-aaaa-111111111111', 'https://app.joinhandshake.com/jobs/101', 'Frontend Dev (Job A1)', 'Alpha Tech', 'Remote', true),
  ('aaaaaaaa-2222-aaaa-2222-aaaaaaaaaaaa', '11111111-aaaa-1111-aaaa-111111111111', 'https://app.joinhandshake.com/jobs/102', 'Backend Dev (Job A2)', 'Alpha Tech', 'New York, NY', true),
  ('bbbbbbbb-1111-bbbb-1111-bbbbbbbbbbbb', '22222222-bbbb-2222-bbbb-222222222222', 'https://app.joinhandshake.com/jobs/201', 'Data Scientist (Job B1)', 'Beta AI', 'Austin, TX', false),
  ('bbbbbbbb-2222-bbbb-2222-bbbbbbbbbbbb', '22222222-bbbb-2222-bbbb-222222222222', 'https://app.joinhandshake.com/jobs/202', 'ML Engineer (Job B2)', 'Beta AI', 'San Francisco, CA', true);

-- 4. Test 1: RLS Read Verification as Profile A
set local role authenticated;
set local request.jwt.claim.sub = '11111111-aaaa-1111-aaaa-111111111111';

insert into pg_temp.test_results (step_num, test_phase, item_id, owner_id, status_or_detail, test_verdict)
select
  1,
  'RLS_JOB_SELECT_USER_A',
  id::text,
  profile_id::text,
  title || ' (' || company || ')',
  case
    when profile_id = '11111111-aaaa-1111-aaaa-111111111111' then 'PASS (User A job visible)'
    else 'FAIL (User B job leaked!)'
  end
from public.handshake_jobs;

-- Confirm User B jobs count visible to User A
insert into pg_temp.test_results (step_num, test_phase, item_id, owner_id, status_or_detail, test_verdict)
select
  2,
  'RLS_USER_B_BLOCKED_COUNT',
  'count: ' || count(*)::text,
  '22222222-bbbb-2222-bbbb-222222222222',
  'User B jobs visible to User A',
  case when count(*) = 0 then 'PASS (0 rows returned, blocked by RLS)' else 'FAIL (RLS breach)' end
from public.handshake_jobs
where profile_id = '22222222-bbbb-2222-bbbb-222222222222';

reset role;

-- 5. Insert 2 Applications in QUEUED status for Profile A
insert into public.applications (id, profile_id, job_id, status, priority, queued_at)
values
  ('aaaaaaaa-0001-aaaa-0001-aaaaaaaaaaaa', '11111111-aaaa-1111-aaaa-111111111111', 'aaaaaaaa-1111-aaaa-1111-aaaaaaaaaaaa', 'QUEUED', 10, now() - interval '2 minutes'),
  ('aaaaaaaa-0002-aaaa-0002-aaaaaaaaaaaa', '11111111-aaaa-1111-aaaa-111111111111', 'aaaaaaaa-2222-aaaa-2222-aaaaaaaaaaaa', 'QUEUED', 20, now() - interval '1 minute');

-- 6. Test 2: Call claim_next_job (Connection 1 & Connection 2)
insert into pg_temp.test_results (step_num, test_phase, item_id, owner_id, status_or_detail, test_verdict)
select
  3,
  'CLAIM_CALL_1',
  id::text,
  profile_id::text,
  'status=' || status || ', worker=' || worker_id,
  case when id = 'aaaaaaaa-0001-aaaa-0001-aaaaaaaaaaaa' and status = 'PROCESSING' then 'PASS (Claimed App 1)' else 'FAIL' end
from public.claim_next_job('11111111-aaaa-1111-aaaa-111111111111', 'worker-connection-1');

insert into pg_temp.test_results (step_num, test_phase, item_id, owner_id, status_or_detail, test_verdict)
select
  4,
  'CLAIM_CALL_2',
  id::text,
  profile_id::text,
  'status=' || status || ', worker=' || worker_id,
  case when id = 'aaaaaaaa-0002-aaaa-0002-aaaaaaaaaaaa' and status = 'PROCESSING' then 'PASS (Claimed App 2)' else 'FAIL' end
from public.claim_next_job('11111111-aaaa-1111-aaaa-111111111111', 'worker-connection-2');

insert into pg_temp.test_results (step_num, test_phase, item_id, owner_id, status_or_detail, test_verdict)
select
  5,
  'CLAIM_CALL_3 (EMPTY QUEUE)',
  coalesce(id::text, 'NULL'),
  coalesce(profile_id::text, 'N/A'),
  'status=' || coalesce(status, 'N/A') || ', worker=' || coalesce(worker_id, 'N/A'),
  case when id is null then 'PASS (NULL returned on empty queue)' else 'FAIL' end
from (
  select (public.claim_next_job('11111111-aaaa-1111-aaaa-111111111111', 'worker-connection-3')).*
) q;

-- 7. Clean up test records
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

-- Output all test results table
select
  step_num,
  test_phase,
  item_id,
  owner_id,
  status_or_detail,
  test_verdict
from pg_temp.test_results
order by step_num, item_id;
