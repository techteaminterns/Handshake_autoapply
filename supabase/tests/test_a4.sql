-- ===========================================================================
-- Test A4: Telegram Job Confirmation State Machine & RPC Verification
-- Source: ProjectDocs/03-workflow.md, ProjectDocs/06-implementation.md, ProjectDocs/07-workflow-side-a.md
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Cleanup any previous test data
-- ---------------------------------------------------------------------------
delete from public.application_events where application_id in (
  select id from public.applications where profile_id in (
    '11111111-a4a4-1111-a4a4-111111111111',
    '22222222-a4a4-2222-a4a4-222222222222'
  )
);
delete from public.applications where profile_id in (
  '11111111-a4a4-1111-a4a4-111111111111',
  '22222222-a4a4-2222-a4a4-222222222222'
);
delete from public.handshake_jobs where profile_id in (
  '11111111-a4a4-1111-a4a4-111111111111',
  '22222222-a4a4-2222-a4a4-222222222222'
);
delete from public.profiles where id in (
  '11111111-a4a4-1111-a4a4-111111111111',
  '22222222-a4a4-2222-a4a4-222222222222'
);
delete from auth.users where id in (
  '11111111-a4a4-1111-a4a4-111111111111',
  '22222222-a4a4-2222-a4a4-222222222222'
);

-- ---------------------------------------------------------------------------
-- 1. Setup: Test User & Profile
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('11111111-a4a4-1111-a4a4-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a4test@example.com', crypt('test', gen_salt('bf')), now(), now(), now()),
  ('22222222-a4a4-2222-a4a4-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a4other@example.com', crypt('test', gen_salt('bf')), now(), now(), now());

insert into public.profiles (
  id, first_name, last_name, student_email, phone, school_name, major,
  degree_pursuing, grad_month, grad_year, has_existing_handshake_account, telegram_chat_id
)
values
  ('11111111-a4a4-1111-a4a4-111111111111', 'Alex', 'Confirmation', 'a4test@example.com', '5551234567', 'Test University', 'Computer Science', 'BS', 'May', 2026, false, '9990001'),
  ('22222222-a4a4-2222-a4a4-222222222222', 'Other', 'User', 'a4other@example.com', '5559876543', 'Other University', 'Data Science', 'MS', 'Dec', 2025, false, '9990002');

-- Seed jobs
insert into public.handshake_jobs (id, profile_id, url, title, company, has_quick_apply, telegram_prompt_sent_at)
values
  ('aaaaaaaa-1111-aaaa-1111-aaaaaaaaaaaa', '11111111-a4a4-1111-a4a4-111111111111', 'https://example.com/job/a4-1', 'Frontend Engineer', 'Tech Corp', true, now()),
  ('aaaaaaaa-2222-aaaa-2222-aaaaaaaaaaaa', '11111111-a4a4-1111-a4a4-111111111111', 'https://example.com/job/a4-2', 'Backend Engineer', 'Data Corp', true, now()),
  ('aaaaaaaa-3333-aaaa-3333-aaaaaaaaaaaa', '11111111-a4a4-1111-a4a4-111111111111', 'https://example.com/job/a4-3', 'DevOps Engineer', 'Cloud Inc', false, null);

-- ---------------------------------------------------------------------------
-- TEST 1: YES reply on unconfirmed job creates QUEUED application & sets resolved_at
-- ---------------------------------------------------------------------------
do $$
declare
  res text;
  app_row public.applications;
  job_row public.handshake_jobs;
begin
  res := public.resolve_job_confirmation(
    '11111111-a4a4-1111-a4a4-111111111111',
    'aaaaaaaa-1111-aaaa-1111-aaaaaaaaaaaa',
    'yes'
  );

  if res <> 'resolved' then
    raise exception 'TEST 1 FAIL: expected "resolved", got %', res;
  end if;

  select * into app_row from public.applications
  where profile_id = '11111111-a4a4-1111-a4a4-111111111111'
    and job_id = 'aaaaaaaa-1111-aaaa-1111-aaaaaaaaaaaa';

  if app_row.id is null or app_row.status <> 'QUEUED' or app_row.queued_at is null then
    raise exception 'TEST 1 FAIL: application row not correctly QUEUED: status=%, queued_at=%', app_row.status, app_row.queued_at;
  end if;

  select * into job_row from public.handshake_jobs where id = 'aaaaaaaa-1111-aaaa-1111-aaaaaaaaaaaa';
  if job_row.telegram_prompt_resolved_at is null then
    raise exception 'TEST 1 FAIL: telegram_prompt_resolved_at was not stamped on job';
  end if;

  raise notice 'PASS: Test 1 (YES reply -> QUEUED application row created and prompt resolved)';
end;
$$;

-- ---------------------------------------------------------------------------
-- TEST 2: Duplicate reply on already resolved job is ignored
-- ---------------------------------------------------------------------------
do $$
declare
  res text;
begin
  res := public.resolve_job_confirmation(
    '11111111-a4a4-1111-a4a4-111111111111',
    'aaaaaaaa-1111-aaaa-1111-aaaaaaaaaaaa',
    'yes'
  );

  if res <> 'ignored_duplicate' then
    raise exception 'TEST 2 FAIL: expected "ignored_duplicate", got %', res;
  end if;

  raise notice 'PASS: Test 2 (Duplicate reply ignored)';
end;
$$;

-- ---------------------------------------------------------------------------
-- TEST 3: NO reply on unconfirmed job creates REJECTED application & sets resolved_at
-- ---------------------------------------------------------------------------
do $$
declare
  res text;
  app_row public.applications;
  job_row public.handshake_jobs;
begin
  res := public.resolve_job_confirmation(
    '11111111-a4a4-1111-a4a4-111111111111',
    'aaaaaaaa-2222-aaaa-2222-aaaaaaaaaaaa',
    'no'
  );

  if res <> 'resolved' then
    raise exception 'TEST 3 FAIL: expected "resolved", got %', res;
  end if;

  select * into app_row from public.applications
  where profile_id = '11111111-a4a4-1111-a4a4-111111111111'
    and job_id = 'aaaaaaaa-2222-aaaa-2222-aaaaaaaaaaaa';

  if app_row.id is null or app_row.status <> 'REJECTED' or app_row.finished_at is null then
    raise exception 'TEST 3 FAIL: application row not correctly REJECTED: status=%, finished_at=%', app_row.status, app_row.finished_at;
  end if;

  select * into job_row from public.handshake_jobs where id = 'aaaaaaaa-2222-aaaa-2222-aaaaaaaaaaaa';
  if job_row.telegram_prompt_resolved_at is null then
    raise exception 'TEST 3 FAIL: telegram_prompt_resolved_at was not stamped on job 2';
  end if;

  raise notice 'PASS: Test 3 (NO reply -> REJECTED application row created and prompt resolved)';
end;
$$;

-- ---------------------------------------------------------------------------
-- TEST 4: YES reply on previously REJECTED application is blocked (permanent skip)
-- ---------------------------------------------------------------------------
do $$
declare
  res text;
begin
  -- Re-open prompt timestamp to simulate late retry
  update public.handshake_jobs
  set telegram_prompt_resolved_at = null
  where id = 'aaaaaaaa-2222-aaaa-2222-aaaaaaaaaaaa';

  res := public.resolve_job_confirmation(
    '11111111-a4a4-1111-a4a4-111111111111',
    'aaaaaaaa-2222-aaaa-2222-aaaaaaaaaaaa',
    'yes'
  );

  if res <> 'ignored_permanent_reject' then
    raise exception 'TEST 4 FAIL: expected "ignored_permanent_reject", got %', res;
  end if;

  raise notice 'PASS: Test 4 (Permanent rejection honored on subsequent YES)';
end;
$$;

-- ---------------------------------------------------------------------------
-- TEST 5: Unprompted job (sent_at IS NULL) cannot be resolved
-- ---------------------------------------------------------------------------
do $$
declare
  res text;
begin
  res := public.resolve_job_confirmation(
    '11111111-a4a4-1111-a4a4-111111111111',
    'aaaaaaaa-3333-aaaa-3333-aaaaaaaaaaaa',
    'yes'
  );

  if res <> 'ignored_duplicate' then
    raise exception 'TEST 5 FAIL: unprompted job should return ignored_duplicate, got %', res;
  end if;

  raise notice 'PASS: Test 5 (Unprompted job ignored)';
end;
$$;

-- ---------------------------------------------------------------------------
-- TEST 6: Authenticated role cannot call resolve_job_confirmation
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '11111111-a4a4-1111-a4a4-111111111111';

do $$
declare
  res text;
begin
  begin
    res := public.resolve_job_confirmation(
      '11111111-a4a4-1111-a4a4-111111111111',
      'aaaaaaaa-3333-aaaa-3333-aaaaaaaaaaaa',
      'yes'
    );
    raise exception 'RPC REVOKE FAIL: authenticated role could execute resolve_job_confirmation';
  exception
    when insufficient_privilege then
      raise notice 'PASS: Test 6 (resolve_job_confirmation blocked for authenticated role: %)', sqlerrm;
    when others then
      if sqlstate = '42501' then
        raise notice 'PASS: Test 6 (resolve_job_confirmation blocked for authenticated role: %)', sqlerrm;
      else
        raise;
      end if;
  end;
end;
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Cleanup and finish
-- ---------------------------------------------------------------------------
delete from public.applications where profile_id in ('11111111-a4a4-1111-a4a4-111111111111', '22222222-a4a4-2222-a4a4-222222222222');
delete from public.handshake_jobs where profile_id in ('11111111-a4a4-1111-a4a4-111111111111', '22222222-a4a4-2222-a4a4-222222222222');
delete from public.profiles where id in ('11111111-a4a4-1111-a4a4-111111111111', '22222222-a4a4-2222-a4a4-222222222222');
delete from auth.users where id in ('11111111-a4a4-1111-a4a4-111111111111', '22222222-a4a4-2222-a4a4-222222222222');

rollback;
