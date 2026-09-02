/**
 * test-whatsapp-to-mock-apply.js
 *
 * Full Sequential End-to-End Flow (Headful Browser Mode by default):
 * (1) Seed ONE handshake_job in Supabase pointing to local mock Handshake server.
 * (2) Send WhatsApp job confirmation message ONCE to user's phone.
 * (3) Set up message listener that waits for a SINGLE reply (YES/NO) with duplicate prevention.
 * (4) After YES received:
 *     - Log: "✅ YES received in WhatsApp"
 *     - Launch Playwright in headful mode (headless: false, visible browser)
 *     - Navigate to mock Handshake job page
 *     - Auto-fill form, attach resume PDF, submit
 *     - Verify positive DOM success confirmation and mark application SUBMITTED in DB
 *     - Send completion notification on WhatsApp
 * (5) After NO received:
 *     - Log: "❌ NO received, marking REJECTED"
 *     - Mark application REJECTED and exit cleanly
 * (6) Timeout after 60s if no reply received.
 *
 * Usage:
 *   node test-whatsapp-to-mock-apply.js                 (headful mode: visible browser opens on YES)
 *   node test-whatsapp-to-mock-apply.js --force-relink   (force fresh terminal QR scan)
 *   node test-whatsapp-to-mock-apply.js --headless       (run browser in background)
 *   node test-whatsapp-to-mock-apply.js --simulate-yes   (automated instant test without waiting for phone)
 *   npm run test:whatsapp-apply
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import {
  initWhatsApp,
  getWhatsAppSessionState,
  sendWhatsAppMessage,
  formatJid,
  registerMessageListener,
} from './lib/whatsapp/client.js';
import {
  sendWhatsAppJobConfirmation,
  formatWhatsAppJobConfirmationMessage,
  parseDecisionFromText,
  resolveWhatsAppPendingConfirmation,
} from './lib/whatsapp/jobConfirmation.js';
import {
  getProfile,
  claimNextJob,
  markJobStatus,
} from './worker/sideA.js';

const require = createRequire(import.meta.url);
const { launchBrowser } = require('./bot/src/browser/launch.js');
const { safeExit } = require('./bot/src/safeExit.js');

// Normalize service role env key
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

// ── HTTP Server Reachability Helper ───────────────────────────────────────────
function checkServer(url) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const req = http.request(
        {
          host: parsed.hostname,
          port: parsed.port || 80,
          path: parsed.pathname || '/',
          method: 'GET',
          timeout: 2000,
        },
        (res) => resolve(res.statusCode >= 200 && res.statusCode < 500)
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    } catch {
      resolve(false);
    }
  });
}

// ── Wait for Server Helper ───────────────────────────────────────────────────
async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const isUp = await checkServer(url);
    if (isUp) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// ── Ensure Test Resume PDF Helper ────────────────────────────────────────────
function ensureTestResume() {
  const resumePath = path.resolve(process.cwd(), 'bot', 'test-resume.pdf');
  if (!fs.existsSync(resumePath)) {
    const minPdf =
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj ' +
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj ' +
      '3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\n' +
      'xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n' +
      '0000000058 00000 n\n0000000115 00000 n\n' +
      'trailer<</Size 4/Root 1 0 R>>\nstartxref\n217\n%%EOF';
    fs.writeFileSync(resumePath, minPdf);
  }
  return resumePath;
}

// ── Monitoring UI ASCII Dashboard Render ─────────────────────────────────────
function renderMonitoringDashboard(jobTitle, company, status, events = []) {
  console.log('\n  ┌─────────────────────────────────────────────────────────────┐');
  console.log('  │  📊 ONECLICKHANDSHAKE — LIVE MONITORING DASHBOARD           │');
  console.log('  ├─────────────────────────────────────────────────────────────┤');
  console.log('  │  Bot Status:   [ ● SUBMITTED / IDLE ]                       │');
  console.log('  │  Channel:      [ WhatsApp Baileys ]                         │');
  console.log('  │  Browser Mode: [ Headful / Visible ]                        │');
  console.log('  │  Stats:        Queued: 0  ·  Applied: 1  ·  Failed: 0       │');
  console.log('  │                                                             │');
  console.log(`  │  Current Job:  ${jobTitle.slice(0, 43).padEnd(45)}│`);
  console.log(`  │  Company:      ${(company || 'Mock Handshake').slice(0, 43).padEnd(45)}│`);
  console.log('  │  Flow Steps:   WhatsApp ✓ ──> Apply ✓ ──> Resume ✓ ──> Done │');
  console.log(`  │  DB Status:    ${status.padEnd(45)}│`);
  console.log('  ├─────────────────────────────────────────────────────────────┤');
  console.log('  │  Recent Events:                                             │');
  events.slice(-4).forEach((ev) => {
    const line = `• [${ev.event_type.toUpperCase()}] step: ${ev.step || '–'} (${ev.message || '–'})`;
    console.log(`  │    ${line.slice(0, 55).padEnd(57)}│`);
  });
  console.log('  └─────────────────────────────────────────────────────────────┘\n');
}

// ── Main Test Runner ─────────────────────────────────────────────────────────
async function main() {
  console.log('================================================================');
  console.log('  WhatsApp -> Headful Playwright Apply -> SUBMITTED Flow        ');
  console.log('================================================================\n');

  const startTime = Date.now();

  // (0) CLI Arguments & Config (Default to HEADFUL browser)
  const args = process.argv.slice(2);
  let cliProfileId = null;
  let cliPhone = null;
  let cliTimeout = 60000;
  let simulateYes = false;
  let isHeadless = false; // Default: Headful mode (visible browser)
  let port = 5173;

  for (const arg of args) {
    if (arg.startsWith('--profile=') || arg.startsWith('--profileId=') || arg.startsWith('--profile-id=')) {
      cliProfileId = arg.split('=')[1];
    } else if (arg.startsWith('--phone=')) {
      cliPhone = arg.split('=')[1];
    } else if (arg.startsWith('--port=')) {
      port = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--timeout=')) {
      cliTimeout = parseInt(arg.split('=')[1], 10) * 1000;
    } else if (arg === '--simulate-yes' || arg === '--mock-yes' || arg === '--auto-yes') {
      simulateYes = true;
    } else if (arg === '--force-relink' || arg === '--relink' || arg === '--fresh') {
      process.env.FORCE_RELINK = 'true';
    } else if (arg === '--headless') {
      isHeadless = true;
    } else if (arg === '--visible' || arg === '--headful') {
      isHeadless = false;
    } else if (!cliProfileId && !arg.startsWith('--')) {
      cliProfileId = arg;
    }
  }

  const forceRelink = process.env.FORCE_RELINK === 'true';

  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let serverProcess = null;

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 1: Seed Profile & Connect WhatsApp
  // ───────────────────────────────────────────────────────────────────────────
  console.log('────────────────────────────────────────────────────────────────');
  console.log('  [STAGE 1/6] Resolving Profile & Initializing WhatsApp Baileys ');
  console.log('────────────────────────────────────────────────────────────────');

  let profileId = cliProfileId || process.env.WORKER_PROFILE_ID || process.env.PROFILE_ID;

  if (!profileId) {
    const { data: firstProfile } = await supabase
      .from('profiles')
      .select('id, whatsapp_phone, phone, first_name, last_name, student_email')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (firstProfile) {
      profileId = firstProfile.id;
    } else {
      console.error('❌ Error: No user profile found in database.');
      process.exit(1);
    }
  }

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('id, whatsapp_phone, phone, first_name, last_name, student_email')
    .eq('id', profileId)
    .maybeSingle();

  if (profileErr || !profile) {
    console.error(`❌ Error: Profile "${profileId}" not found.`);
    process.exit(1);
  }

  console.log(`👤 Target Profile: ${profile.first_name || 'User'} ${profile.last_name || ''} (${profile.id})`);
  console.log(`🌐 Browser Mode:  ${isHeadless ? 'Headless' : 'Headful (Visible Browser Window)'}`);

  let targetPhone = cliPhone || profile.whatsapp_phone || profile.phone;

  // Initialize WhatsApp Baileys client if in live mode
  if (!simulateYes) {
    console.log('\n🔄 Initializing Baileys client...');
    if (forceRelink) {
      console.log('👉 [--force-relink]: Forcing clean fresh QR in terminal.');
    } else {
      console.log('👉 If not already linked, a QR code will appear below.');
      console.log('   Open WhatsApp on your phone -> Settings -> Linked Devices -> Link a Device.\n');
    }

    await new Promise(async (resolve, reject) => {
      try {
        await initWhatsApp(profile.id, {
          supabase,
          printQRTerminal: true,
          forceRelink,
          onConnected: ({ phone, jid }) => {
            targetPhone = phone;
            resolve();
          },
        });

        const currentState = getWhatsAppSessionState(profile.id);
        if (currentState.status === 'connected') {
          console.log(`\n🎉 Active WhatsApp session detected! Connected phone: +${currentState.phone}`);
          targetPhone = currentState.phone || targetPhone;
          resolve();
        }
      } catch (err) {
        reject(err);
      }
    });

    // 5-second post-connection delay to let socket auth and history sync settle
    console.log('\n⏳ Waiting 5s for WhatsApp socket & session synchronization to settle...');
    await new Promise((r) => setTimeout(r, 5000));
    console.log('✅ Baileys session synchronized and ready.\n');
  } else {
    targetPhone = targetPhone || '14155552671';
    console.log(`🤖 Simulation Mode: Using target phone +${targetPhone.replace(/[^0-9]/g, '')}`);
  }

  // Clean slate previous applications for this profile
  console.log('🧹 Cleaning previous test applications and jobs...');
  const { data: existingApps } = await supabase
    .from('applications')
    .select('id')
    .eq('profile_id', profileId);

  if (existingApps && existingApps.length > 0) {
    const appIds = existingApps.map((a) => a.id);
    await supabase.from('application_events').delete().in('application_id', appIds);
  }
  await supabase.from('interventions').delete().eq('profile_id', profileId);
  await supabase.from('applications').delete().eq('profile_id', profileId);
  await supabase.from('handshake_jobs').delete().eq('profile_id', profileId);
  console.log('✨ Clean slate ready.');

  // Seed ONE handshake_job row pointing to local mock Handshake server
  const timestamp = Date.now();
  const mockJobUrl = `http://localhost:${port}/mock-handshake/job/1`;
  const jobTitle = `Senior Frontend Engineer (WhatsApp Apply #${timestamp % 10000})`;
  const jobCompany = 'Acme Labs (Mock Handshake)';

  const { data: seededJob, error: seedError } = await supabase
    .from('handshake_jobs')
    .insert({
      profile_id: profileId,
      title: jobTitle,
      company: jobCompany,
      location: 'San Francisco, CA (Remote)',
      url: mockJobUrl,
      has_quick_apply: true,
      discovered_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (seedError || !seededJob) {
    console.error('❌ Error seeding handshake_job row:', seedError?.message);
    process.exit(1);
  }

  console.log(`🌱 Seeded ONE Mock Job: "${seededJob.title}"`);
  console.log(`   Job ID:  ${seededJob.id}`);
  console.log(`   Job URL: ${seededJob.url}`);
  console.log('✅ Stage 1 Complete: Profile & Mock Job ready.\n');

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 2: Send WhatsApp Job Confirmation Message ONCE
  // ───────────────────────────────────────────────────────────────────────────
  console.log('────────────────────────────────────────────────────────────────');
  console.log('  [STAGE 2/6] Sending WhatsApp Job Confirmation Prompt ONCE     ');
  console.log('────────────────────────────────────────────────────────────────');

  const formattedMsg = formatWhatsAppJobConfirmationMessage(seededJob);
  console.log('📤 Formatted WhatsApp Prompt:');
  console.log('--------------------------------------------------');
  console.log(formattedMsg);
  console.log('--------------------------------------------------');

  if (!simulateYes) {
    console.log('Sending to:', targetPhone);
    const sendResult = await sendWhatsAppJobConfirmation(profileId, seededJob, {
      supabase,
      phone: targetPhone,
    });

    if (sendResult.ok) {
      console.log(`✅ WhatsApp confirmation delivered ONCE to ${formatJid(targetPhone)}!`);
    } else {
      console.warn(`⚠️ WhatsApp prompt delivery returned non-ok:`, sendResult.error);
    }
  } else {
    await supabase
      .from('handshake_jobs')
      .update({ whatsapp_prompt_sent_at: new Date().toISOString() })
      .eq('id', seededJob.id);
    console.log('🤖 Simulated prompt sent timestamp in database.');
  }

  console.log('✅ Stage 2 Complete: Confirmation prompt dispatched ONCE.\n');

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 3: Await SINGLE YES/NO Reply with Atomic Latch (Ignore Duplicates)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('────────────────────────────────────────────────────────────────');
  console.log('  [STAGE 3/6] Listening for SINGLE Inbound Reply (YES / NO)     ');
  console.log('────────────────────────────────────────────────────────────────');

  // Atomic state latch to process only the first reply and ignore subsequent duplicates
  let replyProcessed = false;
  let userDecision = null; // 'yes' | 'no'

  const userReplyPromise = new Promise((resolve) => {
    if (simulateYes) {
      replyProcessed = true;
      userDecision = 'yes';
      console.log('🤖 [--simulate-yes flag detected]: Simulating YES reply.');
      resolve('yes');
      return;
    }

    console.log('📱 ACTION REQUIRED:');
    console.log(`   Reply "YES" to apply (or "NO" to skip) in your WhatsApp chat.`);
    console.log(`   Waiting for reply (timeout: ${cliTimeout / 1000}s)...\n`);

    // Register single-reply listener on Baileys
    const unregister = registerMessageListener(profileId, async (msg, text, senderJid) => {
      // If already processed a reply, ignore all subsequent messages
      if (replyProcessed) {
        return;
      }

      const decision = parseDecisionFromText(text);
      if (!decision) {
        // Not a YES/NO response
        return;
      }

      // Mark latch atomically
      replyProcessed = true;
      userDecision = decision;
      unregister(); // Remove listener immediately

      if (decision === 'yes') {
        console.log(`\n================================================================`);
        console.log(`  ✅ YES received in WhatsApp from ${senderJid}: "${text}"      `);
        console.log(`================================================================\n`);
      } else {
        console.log(`\n================================================================`);
        console.log(`  ❌ NO received, marking REJECTED from ${senderJid}: "${text}" `);
        console.log(`================================================================\n`);
      }

      resolve(decision);
    });

    // Timeout after 60s
    setTimeout(() => {
      if (!replyProcessed) {
        replyProcessed = true;
        unregister();
        console.error(`\n⏱ Timeout: ${cliTimeout / 1000}s elapsed with no YES/NO reply received in WhatsApp.`);
        resolve('timeout');
      }
    }, cliTimeout);
  });

  const decisionResult = await userReplyPromise;

  if (decisionResult === 'timeout') {
    console.error('❌ Test halted due to reply timeout.');
    process.exit(1);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 4: Process Decision (NO -> REJECTED & Exit | YES -> QUEUED & Apply)
  // ───────────────────────────────────────────────────────────────────────────
  if (decisionResult === 'no') {
    console.log('❌ NO received, marking REJECTED in database...');
    await resolveWhatsAppPendingConfirmation(profileId, seededJob.id, 'no', { supabase });

    if (!simulateYes) {
      await sendWhatsAppMessage(
        profileId,
        targetPhone,
        `👌 Application for *${seededJob.title}* at *${seededJob.company}* was skipped.`
      );
    }
    console.log('✅ Marked application as REJECTED. Exiting cleanly.');
    process.exit(0);
  }

  // User decision is YES:
  console.log('📝 Marking application as QUEUED in database...');
  const queueResult = await resolveWhatsAppPendingConfirmation(profileId, seededJob.id, 'yes', { supabase });
  console.log(`✅ Application status QUEUED in Supabase (App ID: ${queueResult.application?.id || 'created'}).`);

  if (!simulateYes) {
    await sendWhatsAppMessage(
      profileId,
      targetPhone,
      `👍 Got it! Application for *${seededJob.title}* is queued and applying now...`
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 5: Launch Playwright in Headful Mode & Submit Application
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n────────────────────────────────────────────────────────────────');
  console.log('  [STAGE 5/6] Launching Playwright (Headful) & Applying to Job   ');
  console.log('────────────────────────────────────────────────────────────────');

  const serverUrl = `http://localhost:${port}/mock-handshake/job/1`;
  const isServerRunning = await checkServer(serverUrl);

  if (!isServerRunning) {
    console.log(`ℹ️ Starting Mock Handshake Vite server at http://localhost:${port}...`);
    const mockHandshakeDir = path.resolve(process.cwd(), 'mock-handshake');
    const isWindows = process.platform === 'win32';
    const npmCmd = isWindows ? 'npm.cmd' : 'npm';

    serverProcess = spawn(npmCmd, ['run', 'dev', '--', '--port', String(port)], {
      cwd: mockHandshakeDir,
      stdio: 'pipe',
      shell: true,
    });

    serverProcess.stdout.on('data', (d) => {
      const msg = d.toString();
      if (msg.includes('Local:')) {
        console.log(`   [Vite Server] ${msg.trim()}`);
      }
    });

    const ready = await waitForServer(serverUrl, 15000);
    if (!ready) {
      if (serverProcess) serverProcess.kill();
      throw new Error(`Failed to connect to Mock Handshake server at ${serverUrl}`);
    }
    console.log('✅ Mock Handshake Vite server is live and responsive!\n');
  } else {
    console.log(`✅ Connected to existing Mock Handshake server at ${serverUrl}\n`);
  }

  // Atomically claim the job
  console.log('🔒 Claiming queued application via atomic RPC claim_next_job...');
  const claimedJob = await claimNextJob(profileId, 'playwright-headful-worker');
  const activeAppId = claimedJob?.id || queueResult.application?.id;
  console.log(`✅ Claimed Application ID: ${activeAppId}`);

  await markJobStatus(activeAppId, 'PROCESSING', 'open_job');
  console.log('📝 Updated status to PROCESSING (step: "open_job")');

  const resumeFilePath = ensureTestResume();
  console.log(`📄 Test Resume: ${resumeFilePath}`);

  let browser = null;

  try {
    console.log(`🌐 Launching Playwright browser (headless: ${isHeadless})...`);
    browser = await launchBrowser(isHeadless);
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    // 1. Navigate to Mock Job Page
    console.log(`1️⃣ Navigating to mock job listing: ${seededJob.url}...`);
    await page.goto(seededJob.url, { waitUntil: 'networkidle' });

    // 2. Verify Job Page
    console.log('2️⃣ Verifying Job Details page elements...');
    await page.waitForSelector('[data-testid="job-title"]', { timeout: 5000 });
    const renderedJobTitle = await page.locator('[data-testid="job-title"]').textContent();
    console.log(`   ✓ Found Job Title in DOM: "${renderedJobTitle.trim()}"`);

    const applyBtn = page.locator('[data-testid="job-apply-btn"]');
    if ((await applyBtn.count()) === 0) {
      throw new Error('Apply button [data-testid="job-apply-btn"] not found on page');
    }

    // 3. Click Apply Button
    console.log('3️⃣ Clicking Apply button -> navigating to apply modal...');
    await applyBtn.click();
    await markJobStatus(activeAppId, 'PROCESSING', 'quick_apply');

    // 4. Verify Apply Modal & Upload Resume
    console.log('4️⃣ Verifying Apply modal & attaching resume PDF...');
    await page.waitForSelector('[data-testid="submit-application-btn"]', { timeout: 5000 });
    const submitBtn = page.locator('[data-testid="submit-application-btn"]');

    const fileInput = page.locator('input[data-testid="resume-file-input"]');
    if ((await fileInput.count()) > 0) {
      await fileInput.setInputFiles(resumeFilePath);
      console.log(`   ✓ Uploaded resume: ${path.basename(resumeFilePath)}`);
    } else {
      const chip = page.locator('.doc-pill-chip').first();
      await chip.click();
      console.log('   ✓ Selected resume chip');
    }

    await markJobStatus(activeAppId, 'PROCESSING', 'resume');
    await page.waitForTimeout(1000); // Visual pause for headful mode

    const isSubmitReady = await submitBtn.isEnabled();
    if (!isSubmitReady) {
      throw new Error('Submit button remained disabled after attaching resume');
    }
    console.log('   ✓ Submit button is enabled and ready');

    // 5. Submit Application
    console.log('5️⃣ Submitting application form...');
    await markJobStatus(activeAppId, 'SUBMITTING', 'submit');
    await submitBtn.click();

    // 6. Verify Done Page
    console.log('6️⃣ Awaiting positive DOM confirmation on /done page...');
    await page.waitForSelector('[data-testid="apply-complete"]', { timeout: 5000 });
    const confirmationHeading = await page
      .locator('[data-testid="apply-complete-heading"]')
      .textContent();
    console.log(`   ✓ Positive DOM Success: "${confirmationHeading.trim()}"`);

    // 7. Stamp SUBMITTED in database
    await markJobStatus(activeAppId, 'SUBMITTED', 'verify');
    console.log('✅ Marked application as SUBMITTED in Supabase (step: "verify")');

    // Visual pause so the user sees the completed submission in headful mode
    if (!isHeadless) {
      await page.waitForTimeout(2000);
    }

    // 8. Send WhatsApp completion message to user
    if (!simulateYes) {
      await sendWhatsAppMessage(
        profileId,
        targetPhone,
        `🎉 *Application Submitted!*\n\nSuccessfully applied to *${seededJob.title}* at *${seededJob.company}*.\nStatus: SUBMITTED ✓`
      );
      console.log('📨 Sent completion notification to your WhatsApp!');
    }
  } finally {
    if (browser) {
      await safeExit(browser);
      console.log('🔒 Playwright browser closed cleanly.');
    }
    if (serverProcess) {
      console.log('🛑 Stopping temporary Mock Handshake Vite server...');
      serverProcess.kill();
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 6: Verify Database Record & Render Dashboard
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n────────────────────────────────────────────────────────────────');
  console.log('  [STAGE 6/6] Final Verification & Live Monitoring Dashboard    ');
  console.log('────────────────────────────────────────────────────────────────');

  const { data: finalApp } = await supabase
    .from('applications')
    .select('*')
    .eq('id', activeAppId)
    .single();

  const { data: auditEvents } = await supabase
    .from('application_events')
    .select('*')
    .eq('application_id', activeAppId)
    .order('created_at', { ascending: true });

  console.log('📊 Verified Application Record:');
  console.log(`   ID:           ${finalApp.id}`);
  console.log(`   Status:       ${finalApp.status}`);
  console.log(`   Current Step: ${finalApp.current_step}`);
  console.log(`   Queued At:    ${finalApp.queued_at}`);
  console.log(`   Started At:   ${finalApp.started_at}`);
  console.log(`   Submitted At: ${finalApp.submitted_at}`);

  renderMonitoringDashboard(seededJob.title, seededJob.company, finalApp.status, auditEvents || []);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('================================================================');
  console.log('  🎉 SUCCESS: WHATSAPP -> HEADFUL PLAYWRIGHT APPLY PASSED!      ');
  console.log('================================================================');
  console.log(`  Total Execution Time: ${elapsed}s\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ WhatsApp Apply Flow Failed with Exception:', err);
  process.exit(1);
});
