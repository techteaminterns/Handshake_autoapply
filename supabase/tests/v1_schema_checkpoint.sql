-- V1-A1 checkpoint verification (run via: supabase db query --linked -f supabase/tests/v1_schema_checkpoint.sql)

begin;

-- ---------------------------------------------------------------------------
-- Setup: two test users + profiles
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'v1test-a@example.com', crypt('test', gen_salt('bf')), now(), now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'v1test-b@example.com', crypt('test', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into public.profiles (
  id, first_name, last_name, student_email, phone, school_name, major,
  degree_pursuing, grad_month, grad_year, has_existing_handshake_account
)
values
  ('11111111-1111-1111-1111-111111111111', 'Test', 'UserA', 'v1test-a@example.com', '5550000001', 'Test U', 'CS', 'BS', 'May', 2027, false),
  ('22222222-2222-2222-2222-222222222222', 'Test', 'UserB', 'v1test-b@example.com', '5550000002', 'Test U', 'CS', 'BS', 'May', 2027, false)
on conflict (id) do nothing;

-- Seed job + application for user A
insert into public.handshake_jobs (id, profile_id, url, title, has_quick_apply)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'https://example.com/job/v1test', 'V1 Test Job', true)
on conflict (profile_id, url) do nothing;

insert into public.applications (id, profile_id, job_id, status)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'QUEUED')
on conflict (profile_id, job_id) do update set status = 'QUEUED', worker_id = null, lock_acquired_at = null;

-- ---------------------------------------------------------------------------
-- Test 1: RLS blocks cross-user reads
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from public.applications where profile_id = '11111111-1111-1111-1111-111111111111';
  if cnt <> 0 then
    raise exception 'RLS FAIL: user B could read user A applications (count=%)', cnt;
  end if;
  raise notice 'PASS: RLS blocks cross-user application reads';
end;
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Test 2: Illegal status transition rejected
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    update public.applications set status = 'SUBMITTED' where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    raise exception 'TRANSITION FAIL: QUEUED -> SUBMITTED should be rejected';
  exception
    when others then
      if sqlerrm not like '%illegal status transition%' then
        raise;
      end if;
      raise notice 'PASS: illegal status transition rejected (%)', sqlerrm;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Test 3: claim_next_job atomicity (sequential double-claim on one row)
-- ---------------------------------------------------------------------------
do $$
declare
  first_claim  public.applications;
  second_claim public.applications;
begin
  -- Reset to QUEUED for claim test
  update public.applications
  set status = 'QUEUED', worker_id = null, lock_acquired_at = null, started_at = null
  where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  first_claim := public.claim_next_job('11111111-1111-1111-1111-111111111111', 'worker-1');
  second_claim := public.claim_next_job('11111111-1111-1111-1111-111111111111', 'worker-2');

  if first_claim.id is null then
    raise exception 'CLAIM FAIL: first claim returned null';
  end if;

  if second_claim.id is not null then
    raise exception 'CLAIM FAIL: second claim should return null, got id %', second_claim.id;
  end if;

  if first_claim.status <> 'PROCESSING' then
    raise exception 'CLAIM FAIL: expected PROCESSING, got %', first_claim.status;
  end if;

  raise notice 'PASS: claim_next_job returns one row then null';
end;
$$;

-- ---------------------------------------------------------------------------
-- Test 4: handshake_password_enc not readable by authenticated role
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare
  pwd text;
begin
  begin
    select handshake_password_enc into pwd
    from public.profiles
    where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'COLUMN REVOKE FAIL: authenticated could select handshake_password_enc';
  exception
    when insufficient_privilege then
      raise notice 'PASS: handshake_password_enc blocked for authenticated (%)', sqlerrm;
    when others then
      if sqlstate = '42501' then
        raise notice 'PASS: handshake_password_enc blocked for authenticated (%)', sqlerrm;
      else
        raise;
      end if;
  end;
end;
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Test 5: handshake_password_enc not writable by authenticated role
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
begin
  begin
    update public.profiles
    set handshake_password_enc = 'stolen'
    where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'COLUMN REVOKE FAIL: authenticated could update handshake_password_enc';
  exception
    when insufficient_privilege then
      raise notice 'PASS: handshake_password_enc update blocked for authenticated (%)', sqlerrm;
    when others then
      if sqlstate = '42501' then
        raise notice 'PASS: handshake_password_enc update blocked for authenticated (%)', sqlerrm;
      else
        raise;
      end if;
  end;
end;
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Test 6: claim_next_job not executable by authenticated role
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare
  result public.applications;
begin
  begin
    result := public.claim_next_job('11111111-1111-1111-1111-111111111111', 'client-worker');
    raise exception 'RPC REVOKE FAIL: authenticated could execute claim_next_job';
  exception
    when insufficient_privilege then
      raise notice 'PASS: claim_next_job blocked for authenticated (%)', sqlerrm;
    when others then
      if sqlstate = '42501' then
        raise notice 'PASS: claim_next_job blocked for authenticated (%)', sqlerrm;
      else
        raise;
      end if;
  end;
end;
$$;

reset role;

-- Cleanup test data
delete from public.applications where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
delete from public.handshake_jobs where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
delete from public.profiles where id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
delete from auth.users where id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

rollback;
