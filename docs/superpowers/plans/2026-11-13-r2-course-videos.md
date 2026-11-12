# Cloudflare R2 Course Videos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store new paid-course videos in a private Cloudflare R2 bucket while preserving the existing Supabase purchase checks, player, and legacy Supabase videos.

**Architecture:** `svc_course_play` remains the source of truth for paid access. The Supabase Edge Function signs ten-minute R2 `GET` links only after that RPC succeeds, signs one-hour `PUT` links only for administrators, and keeps reading unprefixed legacy paths from Supabase Storage. New R2 database paths use the explicit `r2:` prefix so old videos remain available and untouched during migration.

**Tech Stack:** Static JavaScript frontend, Supabase Edge Functions (Deno/TypeScript), Supabase Auth/Postgres, Cloudflare R2 S3 API, `aws4fetch`.

## Global Constraints

- The R2 bucket stays private and uses the Standard storage class.
- R2 credentials exist only in Supabase Edge Function secrets.
- Playback links expire after 600 seconds and upload links expire after 3600 seconds.
- Existing Supabase videos are retained until an R2 video has been tested through a paid account.
- No R2 subscription, credential, or paid service is activated without the user's confirmation.

---

### Task 1: R2 storage adapter

**Files:**
- Create: `supabase/functions/courses/r2-storage.ts`
- Create: `tests/r2-storage.test.mjs`

**Interfaces:**
- Produces: `parseVideoPath(value)`, `storedR2Path(key)`, `createR2Storage(config, signer)`.

- [ ] **Step 1: Write failing tests** for legacy Supabase paths, prefixed R2 paths, traversal rejection, signed `GET`/`PUT` requests, `HEAD`, and `DELETE`.
- [ ] **Step 2: Run** `node --test tests/r2-storage.test.mjs` and confirm the missing module failure.
- [ ] **Step 3: Implement the minimal adapter** with encoded object URLs and dependency-injected signing.
- [ ] **Step 4: Run** `node --test tests/r2-storage.test.mjs` and confirm all tests pass.

### Task 2: Dual-provider Edge Function

**Files:**
- Modify: `supabase/functions/courses/index.ts`

**Interfaces:**
- Consumes: the Task 1 adapter and `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` secrets.
- Produces: R2-backed `play`, `admin_upload_url`, `admin_attach_video`, and provider-aware video deletion.

- [ ] **Step 1: Import `AwsClient` and the adapter**, building the R2 client lazily from environment secrets.
- [ ] **Step 2: Keep unprefixed video paths on Supabase Storage** and sign only `r2:` paths through R2.
- [ ] **Step 3: Return one-hour R2 upload URLs** restricted to `video/mp4`, with the 4.995 GiB single-part limit.
- [ ] **Step 4: Verify uploaded R2 objects with `HEAD`** before storing the prefixed path.
- [ ] **Step 5: Preserve replaced legacy Supabase files** and delete only replaced R2 files.
- [ ] **Step 6: Run the focused tests and TypeScript syntax checks available in the local runtime.**

### Task 3: Browser upload and operator guidance

**Files:**
- Modify: `assets/js/admin-courses.js`
- Modify: `assets/js/sb.js`
- Modify: `admin/index.html`
- Modify: `README.md`

**Interfaces:**
- Consumes: `raw`, `headers`, and `path` fields returned by `admin_upload_url`.
- Produces: a direct binary `PUT` to R2 while leaving image uploads on Supabase unchanged.

- [ ] **Step 1: Send R2 videos as the raw file body** with the signed `Content-Type` header.
- [ ] **Step 2: Replace the 50 MB browser limit** with the R2 single-part limit and update the Russian error text.
- [ ] **Step 3: Update the admin explanation and README** with the private R2 workflow, required secret names, CORS policy, and rollback behavior.
- [ ] **Step 4: Run Node syntax checks** on changed browser scripts, the focused tests, and a secret scan.

### Task 4: External configuration and end-to-end verification

**Files:**
- No repository files.

**Interfaces:**
- Consumes: an activated R2 subscription, a private Standard bucket, bucket-scoped credentials, and access to the Supabase project.
- Produces: deployed Edge Function secrets and a paid-account playback check.

- [ ] **Step 1: After confirmation, activate R2 and create `drgorshechnikov-course-videos`.**
- [ ] **Step 2: Configure bucket CORS** for `https://www.drgorshechnikov.ru` and `https://drgorshechnikov.ru`, allowing `GET`, `HEAD`, and `PUT` with `Content-Type`.
- [ ] **Step 3: Create bucket-scoped credentials** and save the four R2 values as Supabase Edge Function secrets.
- [ ] **Step 4: Deploy the `courses` function**, upload one test lesson, verify denial without a purchase, verify playback with a paid account, and retain the old Supabase object.
- [ ] **Step 5: Configure billing notifications** and verify R2 metrics against the free monthly limits.
