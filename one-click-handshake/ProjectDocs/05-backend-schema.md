# Backend Schema — OneClickHandshake V1

## Existing Tables (carry forward, no changes)
- `profiles` — user onboarding data (extend with `has_existing_handshake_account`, `handshake_email`, `handshake_password_enc`)
- `resumes` — resume Storage references
- `reusable_answers` — stored Q&A from apply flow
- `documents` — non-resume docs
- `gmail_oauth_tokens` — keep in schema, unused in V1

## Schema Changes to Existing Tables

### `profiles` — add columns
| Field | Type | Constraints |
|---|---|---|
| has_existing_handshake_account | boolean | not null |
| handshake_email | text | nullable |
| handshake_password_enc | text | nullable, AES-256-GCM encrypted |

## New Tables

### `handshake_jobs`
| Field | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| profile_id | uuid | FK → profiles.id |
| url | text | not null, unique per profile |
| title | text | not null |
| company | text | nullable |
| location | text | nullable |
| has_quick_apply | boolean | not null |
| discovered_at | timestamptz | default now() |
| raw_metadata | jsonb | nullable |

### `applications`
| Field | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| profile_id | uuid | FK → profiles.id |
| job_id | uuid | FK → handshake_jobs.id |
| status | text | QUEUED, PROCESSING, NEEDS_INPUT, SUBMITTING, SUBMITTED, FAILED, REJECTED |
| current_step | text | nullable — open_job, check_login, quick_apply, resume, questions, submit, verify |
| priority | int | default 100 |
| attempt_count | int | default 0 |
| worker_id | text | nullable |
| lock_acquired_at | timestamptz | nullable |
| error_code | text | nullable |
| error_message | text | nullable |
| verification_evidence | jsonb | nullable |
| queued_at | timestamptz | default now() |
| started_at | timestamptz | nullable |
| submitted_at | timestamptz | nullable |
| finished_at | timestamptz | nullable |
| updated_at | timestamptz | not null |

**Uniqueness:** `UNIQUE(profile_id, job_id)` — duplicate protection

### `application_events`
| Field | Type | Constraints |
|---|---|---|
| id | bigserial | PK |
| application_id | uuid | FK → applications.id |
| event_type | text | e.g. worker_claimed, job_opened, quick_apply_clicked, needs_input, submit_clicked, submission_verified, failed |
| step | text | nullable |
| message | text | nullable |
| metadata | jsonb | nullable |
| created_at | timestamptz | default now() |

### `interventions`
| Field | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| application_id | uuid | FK → applications.id, nullable (session interventions not tied to a job) |
| profile_id | uuid | FK → profiles.id |
| type | text | OTP, EMAIL_CONFIRM, UNKNOWN_QUESTION, AUTH |
| question_text | text | nullable |
| options | jsonb | nullable |
| status | text | OPEN, RESOLVED, CANCELLED |
| answer | text | nullable |
| created_at | timestamptz | default now() |
| resolved_at | timestamptz | nullable |

### `browser_profiles`
| Field | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| profile_id | uuid | FK → profiles.id, unique |
| platform | text | default 'handshake' |
| status | text | ACTIVE, NEEDS_LOGIN, NEEDS_ACTION, DISABLED |
| last_authenticated_at | timestamptz | nullable |
| last_health_check_at | timestamptz | nullable |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | not null |

## Relationships
- `profiles` 1—N `handshake_jobs`, `applications`, `interventions`
- `applications` 1—N `application_events`, `interventions`
- `profiles` 1—1 `browser_profiles`
- `handshake_jobs` 1—N `applications`

## Indexes
| Index | Reason |
|---|---|
| `UNIQUE handshake_jobs(profile_id, url)` | Dedup scraped jobs per user |
| `UNIQUE applications(profile_id, job_id)` | Prevent duplicate applications |
| `INDEX applications(profile_id, status, priority, queued_at)` | Fast queue claim |
| `INDEX application_events(application_id, created_at)` | Fast timeline |
| `INDEX interventions(profile_id, status)` | Fast open intervention lookup |
| `UNIQUE browser_profiles(profile_id)` | One browser profile per user |

## Atomic Queue Claim RPC
Supabase Postgres RPC `claim_next_job(p_profile_id, p_worker_id)`:
- Selects one row from `applications` WHERE `profile_id = p_profile_id` AND `status = 'QUEUED'` ORDER BY priority, queued_at
- Atomically updates it to `status = 'PROCESSING'`, `worker_id = p_worker_id`, `lock_acquired_at = now()`
- Returns the claimed row or null
- Must be a single atomic operation (FOR UPDATE SKIP LOCKED)

## Status Transition Rules
| From | Allowed to |
|---|---|
| QUEUED | PROCESSING |
| PROCESSING | NEEDS_INPUT, SUBMITTING, FAILED |
| NEEDS_INPUT | PROCESSING, FAILED |
| SUBMITTING | SUBMITTED, FAILED |
| SUBMITTED | — (terminal) |
| FAILED | — (terminal, manual retry only) |
| REJECTED | — (terminal, permanent) |

## API Endpoints

| Method | Route | Purpose | Auth |
|---|---|---|---|
| POST | `/api/onboarding` | Upsert profile + resume upload | Supabase session |
| POST | `/api/telegram/webhook` | Capture chat_id on link; receive yes/no job replies | Telegram webhook secret |
| POST | `/api/interventions/:id/resolve` | Write answer to intervention, set RESOLVED | Supabase session |
| GET | `/api/applications` | List applications + latest status for monitoring UI | Supabase session |
| GET | `/api/interventions/open` | Get current OPEN intervention for the user | Supabase session |

## RLS
- All tables scoped to `profile_id = auth.uid()` for client role
- `interventions.answer` readable by client (user typed it)
- `handshake_password_enc` — service-role only, never returned to client
- Telegram webhook + intervention resolve use service-role scoped narrowly to the profile_id being acted on
