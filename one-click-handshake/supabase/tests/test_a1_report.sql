-- ===========================================================================
-- Test A1 Comprehensive Verification & Results Report
-- (1) RLS Check: 2 profiles, jobs for each, verify User A only sees User A jobs
-- (2) Atomic Queue Claiming: claim_next_job concurrency & atomicity
-- ===========================================================================

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
  ('aaaaaaaa-1111-aaaa-1111-aaaaaaaaaaaa', '11111111-aaaa-1111-aaaa-111111111111', 'https://app.joinhandshake.com/jobs/101', 'Frontend Engineer (User A Job 1)', 'Alpha Tech', 'Remote', true),
  ('aaaaaaaa-2222-aaaa-2222-aaaaaaaaaaaa', '11111111-aaaa-1111-aaaa-111111111111', 'https://app.joinhandshake.com/jobs/102', 'Full Stack Dev (User A Job 2)', 'Alpha Tech', 'New York, NY', true),
  ('bbbbbbbb-1111-bbbb-1111-bbbbbbbbbbbb', '22222222-bbbb-2222-bbbb-222222222222', 'https://app.joinhandshake.com/jobs/201', 'Data Scientist (User B Job 1)', 'Beta AI', 'Austin, TX', false),
  ('bbbbbbbb-2222-bbbb-2222-bbbbbbbbbbbb', '22222222-bbbb-2222-bbbb-222222222222', 'https://app.joinhandshake.com/jobs/202', 'ML Engineer (User B Job 2)', 'Beta AI', 'San Francisco, CA', true);

-- 4. Execute Step (1) Verification: Set local role to Authenticated Profile A
set local role authenticated;
set local request.jwt.claim.sub = '11111111-aaaa-1111-aaaa-111111111111';

-- Select visible handshake_jobs as Profile A
select
  'TEST_1_RLS_READ' as test_name,
  id as visible_job_id,
  profile_id as job_owner,
  title as job_title,
  company,
  case
    when profile_id = '11111111-aaaa-1111-aaaa-111111111111' then 'ALLOWED (User A own job)'
    else 'FAIL (User B job leaked!)'
  end as rls_status
from public.handshake_jobs;

-- Reset role for Step 2
reset role;

-- 5. Insert Applications in QUEUED status for Profile A
insert into public.applications (id, profile_id, job_id, status, priority, queued_at)
values
  ('aaaaaaaa-0001-aaaa-0001-aaaaaaaaaaaa', '11111111-aaaa-1111-aaaa-111111111111', 'aaaaaaaa-1111-aaaa-1111-aaaaaaaaaaaa', 'QUEUED', 10, now() - interval '2 minutes'),
  ('aaaaaaaa-0002-aaaa-0002-aaaaaaaaaaaa', '11111111-aaaa-1111-aaaa-111111111111', 'aaaaaaaa-2222-aaaa-2222-aaaaaaaaaaaa', 'QUEUED', 20, now() - interval '1 minute');

-- 6. Execute Step (2) Verification: Call claim_next_job
select
  'TEST_2_CLAIM_CALL_1' as test_step,
  id as claimed_application_id,
  profile_id,
  status,
  worker_id,
  lock_acquired_at
from public.claim_next_job('11111111-aaaa-1111-aaaa-111111111111', 'worker-connection-1');

select
  'TEST_2_CLAIM_CALL_2' as test_step,
  id as claimed_application_id,
  profile_id,
  status,
  worker_id,
  lock_acquired_at
from public.claim_next_job('11111111-aaaa-1111-aaaa-111111111111', 'worker-connection-2');

select
  'TEST_2_CLAIM_CALL_3' as test_step,
  coalesce(id::text, 'NULL (No jobs remaining in QUEUED)') as claimed_application_id,
  profile_id,
  status,
  worker_id
from public.claim_next_job('11111111-aaaa-1111-aaaa-111111111111', 'worker-connection-3');

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
