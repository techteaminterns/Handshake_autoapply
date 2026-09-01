/**
 * MonitoringScreen.js
 *
 * Single-screen monitoring UI showing:
 * - Header strip: bot status badge (Idle / Running / Needs Input / Waiting Telegram / Error) + last health check
 * - Stats row: Queued · Approved · Applied · Failed · Rejected
 * - Telegram status line: "Waiting for your reply on [job title]" when reply is pending
 * - Current job card: job title, company, URL, current step, elapsed time (visible when running)
 * - Step progress: Open -> Login Check -> Quick Apply -> Resume -> Questions -> Submit -> Verify (visible when running)
 * - Job queue table: #, Title, Company, Status badge, Action (view job link)
 * - Intervention popup overlay: non-dismissable modal handling OTP, EMAIL_CONFIRM, UNKNOWN_QUESTION, AUTH
 *
 * Realtime: Subscribes to Supabase postgres_changes on applications, interventions, handshake_jobs, browser_profiles.
 *
 * Phase: Phase V1-A3 (04-ui-ux.md, 05-backend-schema.md, 06-implementation.md)
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  ActivityIndicator,
  StyleSheet,
  Linking,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { supabase } from '../utils/supabase.js';
import { API_URL, TELEGRAM_BOT_USERNAME } from '../config.js';

const STEPS = [
  { key: 'open_job',    label: 'Open' },
  { key: 'check_login', label: 'Login Check' },
  { key: 'quick_apply', label: 'Quick Apply' },
  { key: 'resume',      label: 'Resume' },
  { key: 'questions',   label: 'Questions' },
  { key: 'submit',      label: 'Submit' },
  { key: 'verify',      label: 'Verify' },
];

const STEP_LABELS = {
  open_job:    'Opening Job',
  check_login: 'Checking Login',
  quick_apply: 'Clicking Quick Apply',
  resume:      'Uploading Resume',
  questions:   'Answering Questions',
  submit:      'Submitting Application',
  verify:      'Verifying Submission',
};

function formatRelativeTime(dateString) {
  if (!dateString) return '–';
  const diffMs = Date.now() - new Date(dateString).getTime();
  if (diffMs < 0 || isNaN(diffMs)) return 'Just now';
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function formatElapsed(startedAt) {
  if (!startedAt) return '00:00';
  const startMs = new Date(startedAt).getTime();
  if (isNaN(startMs)) return '00:00';
  const elapsedSec = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
  const mins = Math.floor(elapsedSec / 60);
  const secs = elapsedSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// ── Status Helpers ───────────────────────────────────────────────────────────
function getStatusBadgeStyle(status) {
  switch (status?.toUpperCase()) {
    case 'PROCESSING':
    case 'SUBMITTING':
      return { bg: '#eff6ff', text: '#2563eb', border: '#bfdbfe', label: 'Running' };
    case 'NEEDS_INPUT':
      return { bg: '#fef3c7', text: '#b45309', border: '#fde68a', label: 'Needs Input' };
    case 'SUBMITTED':
      return { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0', label: 'Applied' };
    case 'FAILED':
      return { bg: '#fef2f2', text: '#b91c1c', border: '#fecaca', label: 'Failed' };
    case 'REJECTED':
      return { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1', label: 'Rejected' };
    case 'QUEUED':
    default:
      return { bg: '#f8fafc', text: '#64748b', border: '#e2e8f0', label: 'Queued' };
  }
}

// ── Intervention Popup Component ─────────────────────────────────────────────
export function InterventionPopup({ intervention, accessToken, onResolved }) {
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setAnswer('');
    setError(null);
    setSubmitting(false);
  }, [intervention?.id]);

  if (!intervention || intervention.status !== 'OPEN') {
    return null;
  }

  const type = intervention.type;
  const options = Array.isArray(intervention.options) ? intervention.options : null;

  const handleResolve = async (customAnswer) => {
    const finalAnswer = customAnswer !== undefined ? customAnswer : answer;
    if (type === 'OTP' && (!finalAnswer || finalAnswer.trim().length === 0)) {
      setError('Please enter the verification code.');
      return;
    }
    if (type === 'UNKNOWN_QUESTION' && !finalAnswer?.trim()) {
      setError('Please provide an answer.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${API_URL}/api/interventions/${intervention.id}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ answer: finalAnswer }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to resolve intervention');
      }

      if (onResolved) {
        onResolved(intervention.id, finalAnswer);
      }
    } catch (err) {
      setError(err.message || 'An error occurred while submitting.');
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={true}
      transparent={true}
      animationType="fade"
      onRequestClose={() => {}} // Non-dismissable
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalOverlay}
      >
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalIcon}>
              {type === 'OTP' ? '🔑' : type === 'EMAIL_CONFIRM' ? '📧' : type === 'AUTH' ? '🔐' : '❓'}
            </Text>
            <Text style={styles.modalTitle}>
              {type === 'OTP' && 'Verification Code Required'}
              {type === 'EMAIL_CONFIRM' && 'Confirm Your Handshake Email'}
              {type === 'UNKNOWN_QUESTION' && 'Bot Needs Your Answer'}
              {type === 'AUTH' && 'Sign-in Action Required'}
            </Text>
          </View>

          {/* Body Content */}
          <View style={styles.modalBody}>
            {type === 'OTP' && (
              <>
                <Text style={styles.modalText}>
                  Handshake sent a code to {intervention.question_text || 'your email or phone'}. Enter it here:
                </Text>
                <TextInput
                  style={[styles.modalInput, styles.otpInput, error && styles.fieldError]}
                  value={answer}
                  onChangeText={(val) => {
                    setAnswer(val);
                    setError(null);
                  }}
                  keyboardType="numeric"
                  maxLength={6}
                  placeholder="000000"
                  autoFocus
                  editable={!submitting}
                />
              </>
            )}

            {type === 'EMAIL_CONFIRM' && (
              <Text style={styles.modalText}>
                Please confirm your Handshake email in your inbox, then tap Done to continue.
              </Text>
            )}

            {type === 'AUTH' && (
              <Text style={styles.modalText}>
                The bot needs to sign in again. Please verify your credentials or complete login in Handshake, then tap Ready.
              </Text>
            )}

            {type === 'UNKNOWN_QUESTION' && (
              <>
                <Text style={styles.questionHeading}>{intervention.question_text || 'Please answer the following:'}</Text>
                {options && options.length > 0 ? (
                  <View style={styles.optionsContainer}>
                    {options.map((opt, idx) => {
                      const optVal = typeof opt === 'object' ? (opt.value || opt.label) : opt;
                      const optLabel = typeof opt === 'object' ? (opt.label || opt.value) : opt;
                      const isSelected = answer === optVal;
                      return (
                        <TouchableOpacity
                          key={idx}
                          style={[styles.optionPill, isSelected && styles.optionPillSelected]}
                          onPress={() => {
                            setAnswer(optVal);
                            setError(null);
                          }}
                          disabled={submitting}
                        >
                          <View style={[styles.radioCircle, isSelected && styles.radioCircleSelected]}>
                            {isSelected && <View style={styles.radioInner} />}
                          </View>
                          <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>{optLabel}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : (
                  <TextInput
                    style={[styles.modalInput, styles.multilineInput, error && styles.fieldError]}
                    value={answer}
                    onChangeText={(val) => {
                      setAnswer(val);
                      setError(null);
                    }}
                    multiline
                    numberOfLines={3}
                    placeholder="Type your answer here..."
                    editable={!submitting}
                  />
                )}
              </>
            )}

            {error ? <Text style={styles.modalError}>{error}</Text> : null}
          </View>

          {/* Action Buttons */}
          <View style={styles.modalFooter}>
            {type === 'OTP' && (
              <TouchableOpacity
                style={[styles.modalBtn, submitting && styles.btnDisabled]}
                onPress={() => handleResolve()}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalBtnText}>Submit Code</Text>
                )}
              </TouchableOpacity>
            )}

            {type === 'EMAIL_CONFIRM' && (
              <TouchableOpacity
                style={[styles.modalBtn, submitting && styles.btnDisabled]}
                onPress={() => handleResolve('confirmed')}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalBtnText}>Done</Text>
                )}
              </TouchableOpacity>
            )}

            {type === 'AUTH' && (
              <TouchableOpacity
                style={[styles.modalBtn, submitting && styles.btnDisabled]}
                onPress={() => handleResolve('ready')}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalBtnText}>Ready</Text>
                )}
              </TouchableOpacity>
            )}

            {type === 'UNKNOWN_QUESTION' && (
              <TouchableOpacity
                style={[styles.modalBtn, submitting && styles.btnDisabled]}
                onPress={() => handleResolve()}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalBtnText}>Submit Answer</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Main MonitoringScreen Component ──────────────────────────────────────────
export default function MonitoringScreen({
  userId,
  accessToken,
  profile: _profile,
  onEditProfile,
  onSignOut,
}) {
  const [applications, setApplications] = useState([]);
  const [intervention, setIntervention] = useState(null);
  const [telegramPending, setTelegramPending] = useState(null);
  const [browserProfile, setBrowserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ticker, setTicker] = useState(0);

  // 1. Elapsed timer ticker (1s interval)
  useEffect(() => {
    console.log('[MonitoringScreen] Mounted with userId:', userId, 'profile:', _profile?.id);
    const timer = setInterval(() => {
      setTicker((t) => (t + 1) % 1000000);
    }, 1000);
    return () => clearInterval(timer);
  }, [userId, _profile?.id]);

  // 2. Initial Data Fetch
  const fetchData = useCallback(async () => {
    if (!userId || !accessToken) return;
    try {
      // (a) Applications
      const appRes = await fetch(`${API_URL}/api/applications`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (appRes.ok) {
        const appData = await appRes.json();
        setApplications(appData.applications || []);
      }

      // (b) Open Intervention
      const intRes = await fetch(`${API_URL}/api/interventions/open`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (intRes.ok) {
        const intData = await intRes.json();
        setIntervention(intData.intervention || null);
      }

      // (c) Browser Profile
      const { data: bp } = await supabase
        .from('browser_profiles')
        .select('*')
        .eq('profile_id', userId)
        .maybeSingle();
      setBrowserProfile(bp || null);

      // (d) Pending Telegram prompt
      const { data: tpJob } = await supabase
        .from('handshake_jobs')
        .select('*')
        .eq('profile_id', userId)
        .not('telegram_prompt_sent_at', 'is', null)
        .is('telegram_prompt_resolved_at', null)
        .order('telegram_prompt_sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setTelegramPending(tpJob || null);
    } catch (err) {
      console.warn('[MonitoringScreen] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [userId, accessToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 3. Supabase Realtime Subscriptions
  useEffect(() => {
    if (!userId) return;

    // Applications Realtime
    const appChannel = supabase
      .channel(`realtime:applications:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'applications', filter: `profile_id=eq.${userId}` },
        () => {
          fetchData();
        }
      )
      .subscribe();

    // Interventions Realtime
    const intChannel = supabase
      .channel(`realtime:interventions:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'interventions', filter: `profile_id=eq.${userId}` },
        (payload) => {
          if (payload.eventType === 'INSERT' && payload.new.status === 'OPEN') {
            setIntervention(payload.new);
          } else if (payload.eventType === 'UPDATE') {
            if (payload.new.status === 'RESOLVED') {
              setIntervention((curr) => (curr?.id === payload.new.id ? null : curr));
            } else if (payload.new.status === 'OPEN') {
              setIntervention(payload.new);
            }
          }
        }
      )
      .subscribe();

    // Handshake Jobs Realtime (for telegram prompt status line)
    const jobsChannel = supabase
      .channel(`realtime:handshake_jobs:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'handshake_jobs', filter: `profile_id=eq.${userId}` },
        () => {
          // Re-check pending telegram job
          supabase
            .from('handshake_jobs')
            .select('*')
            .eq('profile_id', userId)
            .not('telegram_prompt_sent_at', 'is', null)
            .is('telegram_prompt_resolved_at', null)
            .order('telegram_prompt_sent_at', { ascending: false })
            .limit(1)
            .maybeSingle()
            .then(({ data }) => setTelegramPending(data || null));
        }
      )
      .subscribe();

    // Browser Profile Realtime
    const bpChannel = supabase
      .channel(`realtime:browser_profiles:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'browser_profiles', filter: `profile_id=eq.${userId}` },
        (payload) => {
          if (payload.new) setBrowserProfile(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(appChannel);
      supabase.removeChannel(intChannel);
      supabase.removeChannel(jobsChannel);
      supabase.removeChannel(bpChannel);
    };
  }, [userId, fetchData]);

  // 4. Derived State Computation
  const activeApp = useMemo(() => {
    return applications.find(
      (a) => a.status === 'PROCESSING' || a.status === 'SUBMITTING' || a.status === 'NEEDS_INPUT'
    ) || null;
  }, [applications]);

  const botStatus = useMemo(() => {
    if (intervention) return { state: 'needs_input', label: 'Needs Input', bg: '#fef3c7', text: '#b45309' };
    if (activeApp) return { state: 'running', label: 'Running', bg: '#eff6ff', text: '#2563eb' };
    if (telegramPending) return { state: 'waiting_telegram', label: 'Waiting Telegram', bg: '#fffbeb', text: '#d97706' };
    if (browserProfile?.status === 'NEEDS_LOGIN' || browserProfile?.status === 'NEEDS_ACTION' || browserProfile?.status === 'DISABLED') {
      return { state: 'error', label: 'Action Required', bg: '#fef2f2', text: '#dc2626' };
    }
    return { state: 'idle', label: 'Idle', bg: '#f1f5f9', text: '#64748b' };
  }, [intervention, activeApp, telegramPending, browserProfile]);

  const stats = useMemo(() => {
    return {
      queued:   applications.filter((a) => a.status === 'QUEUED').length,
      approved: applications.filter((a) => a.status === 'QUEUED').length, // Maps to QUEUED (user-confirmed)
      applied:  applications.filter((a) => a.status === 'SUBMITTED').length,
      failed:   applications.filter((a) => a.status === 'FAILED').length,
      rejected: applications.filter((a) => a.status === 'REJECTED').length,
    };
  }, [applications]);

  const currentStepIdx = useMemo(() => {
    if (!activeApp || !activeApp.current_step) return 0;
    const idx = STEPS.findIndex((s) => s.key === activeApp.current_step);
    return idx >= 0 ? idx : 0;
  }, [activeApp]);

  const handleOpenTelegram = () => {
    const botName = (TELEGRAM_BOT_USERNAME || 'simpleclickonetimeusetestbot').replace(/^@/, '');
    const url = `https://t.me/${botName}`;
    Linking.openURL(url).catch((err) => console.warn('[MonitoringScreen] openTelegram error:', err));
  };

  return (
    <View style={styles.container}>
      {/* ── Intervention Modal Overlay ─────────────────────────────────────── */}
      <InterventionPopup
        intervention={intervention}
        accessToken={accessToken}
        onResolved={(_id) => {
          setIntervention(null);
          fetchData();
        }}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color="#2563eb" />
            <Text style={styles.loadingLabel}>Loading monitoring data…</Text>
          </View>
        ) : null}
        {/* ── Header Strip ───────────────────────────────────────────────────── */}
        <View style={styles.headerStrip}>
          <View>
            <Text style={styles.appTitle}>OneClickHandshake</Text>
            <Text style={styles.healthCheckText}>
              Last health check: {formatRelativeTime(browserProfile?.last_health_check_at)}
            </Text>
          </View>

          <View style={styles.headerRight}>
            <View style={[styles.statusBadge, { backgroundColor: botStatus.bg }]}>
              <View style={[styles.statusDot, { backgroundColor: botStatus.text }]} />
              <Text style={[styles.statusBadgeText, { color: botStatus.text }]}>{botStatus.label}</Text>
            </View>
            {onEditProfile && (
              <TouchableOpacity style={styles.headerLinkBtn} onPress={onEditProfile}>
                <Text style={styles.headerLinkText}>Profile</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ── Telegram Status Line ───────────────────────────────────────────── */}
        {telegramPending && (
          <View style={styles.telegramBanner}>
            <Text style={styles.telegramIcon}>📩</Text>
            <View style={styles.telegramTextCol}>
              <Text style={styles.telegramTitle}>Waiting for your reply on Handshake job</Text>
              <Text style={styles.telegramJobName} numberOfLines={1}>
                "{telegramPending.title}" {telegramPending.company ? `at ${telegramPending.company}` : ''}
              </Text>
            </View>
            <TouchableOpacity style={styles.telegramActionBtn} onPress={handleOpenTelegram}>
              <Text style={styles.telegramActionTxt}>Reply in TG →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Stats Row ──────────────────────────────────────────────────────── */}
        <View style={styles.statsCard}>
          <View style={styles.statCol}>
            <Text style={styles.statNumber}>{stats.queued}</Text>
            <Text style={styles.statLabel}>Queued</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCol}>
            <Text style={styles.statNumber}>{stats.approved}</Text>
            <Text style={styles.statLabel}>Approved</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCol}>
            <Text style={[styles.statNumber, { color: '#16a34a' }]}>{stats.applied}</Text>
            <Text style={styles.statLabel}>Applied</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCol}>
            <Text style={[styles.statNumber, { color: '#dc2626' }]}>{stats.failed}</Text>
            <Text style={styles.statLabel}>Failed</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCol}>
            <Text style={[styles.statNumber, { color: '#64748b' }]}>{stats.rejected}</Text>
            <Text style={styles.statLabel}>Rejected</Text>
          </View>
        </View>

        {/* ── Active Job Card & Step Progress (Only when running/active) ──────── */}
        {activeApp && (
          <View style={styles.activeJobSection}>
            <View style={styles.activeJobHeader}>
              <Text style={styles.activeJobBadge}>NOW APPLYING</Text>
              <Text key={ticker} style={styles.elapsedText}>⏱ {formatElapsed(activeApp.started_at || activeApp.queued_at)}</Text>
            </View>

            <Text style={styles.activeJobTitle}>{activeApp.title || 'Handshake Job'}</Text>
            <Text style={styles.activeJobCompany}>{activeApp.company || 'Company'}</Text>
            {activeApp.url && (
              <TouchableOpacity onPress={() => Linking.openURL(activeApp.url)}>
                <Text style={styles.activeJobLink} numberOfLines={1}>{activeApp.url}</Text>
              </TouchableOpacity>
            )}

            <View style={styles.currentStepBanner}>
              <Text style={styles.currentStepPrefix}>Current Step: </Text>
              <Text style={styles.currentStepName}>
                {STEP_LABELS[activeApp.current_step] || activeApp.current_step || 'Initializing'}
              </Text>
            </View>

            {/* Step Progress Nodes */}
            <View style={styles.stepProgressContainer}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stepScroll}>
                {STEPS.map((step, idx) => {
                  const isDone = idx < currentStepIdx;
                  const isCurrent = idx === currentStepIdx;
                  const isPending = idx > currentStepIdx;

                  return (
                    <React.Fragment key={step.key}>
                      <View style={styles.stepNode}>
                        <View
                          style={[
                            styles.stepCircle,
                            isDone && styles.stepCircleDone,
                            isCurrent && styles.stepCircleCurrent,
                            isPending && styles.stepCirclePending,
                          ]}
                        >
                          {isDone && <Text style={styles.stepCheckmark}>✓</Text>}
                          {isCurrent && <ActivityIndicator size="small" color="#2563eb" />}
                          {isPending && <Text style={styles.stepDot}>•</Text>}
                        </View>
                        <Text
                          style={[
                            styles.stepNodeLabel,
                            (isDone || isCurrent) && styles.stepNodeLabelActive,
                          ]}
                        >
                          {step.label}
                        </Text>
                      </View>
                      {idx < STEPS.length - 1 && (
                        <View style={[styles.stepLine, idx < currentStepIdx && styles.stepLineDone]} />
                      )}
                    </React.Fragment>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        )}

        {/* ── Job Queue Table ────────────────────────────────────────────────── */}
        <View style={styles.queueCard}>
          <View style={styles.queueCardHeader}>
            <Text style={styles.queueSectionTitle}>Application Queue</Text>
            <Text style={styles.queueCountText}>{applications.length} jobs</Text>
          </View>

          {applications.length === 0 ? (
            <View style={styles.emptyQueueBox}>
              <Text style={styles.emptyQueueIcon}>📋</Text>
              <Text style={styles.emptyQueueText}>No applications in queue yet.</Text>
              <Text style={styles.emptyQueueSub}>
                New jobs discovered on Handshake and confirmed via Telegram will appear here automatically.
              </Text>
            </View>
          ) : (
            <View style={styles.table}>
              <View style={styles.tableHeaderRow}>
                <Text style={[styles.th, styles.colIdx]}>#</Text>
                <Text style={[styles.th, styles.colTitle]}>Job / Company</Text>
                <Text style={[styles.th, styles.colStatus]}>Status</Text>
                <Text style={[styles.th, styles.colAction]}>Action</Text>
              </View>

              {applications.map((app, index) => {
                const badge = getStatusBadgeStyle(app.status);
                return (
                  <View key={app.id || index} style={styles.tableRow}>
                    <Text style={[styles.td, styles.colIdx]}>{index + 1}</Text>
                    <View style={[styles.colTitle]}>
                      <Text style={styles.tableJobTitle} numberOfLines={1}>{app.title || 'Handshake Job'}</Text>
                      <Text style={styles.tableJobCompany} numberOfLines={1}>{app.company || '—'}</Text>
                    </View>
                    <View style={styles.colStatus}>
                      <View style={[styles.tableBadge, { backgroundColor: badge.bg, borderColor: badge.border }]}>
                        <Text style={[styles.tableBadgeText, { color: badge.text }]}>{badge.label}</Text>
                      </View>
                    </View>
                    <View style={styles.colAction}>
                      {app.url ? (
                        <TouchableOpacity onPress={() => Linking.openURL(app.url)}>
                          <Text style={styles.actionLinkText}>View</Text>
                        </TouchableOpacity>
                      ) : (
                        <Text style={styles.tdMuted}>–</Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* ── Footer / Logout ────────────────────────────────────────────────── */}
        <View style={styles.footerRow}>
          {onSignOut && (
            <TouchableOpacity style={styles.signOutBtn} onPress={onSignOut}>
              <Text style={styles.signOutText}>Sign Out</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const ACCENT = '#2563eb';
const BORDER = '#e2e8f0';
const GRAY   = '#64748b';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  loadingLabel: {
    fontSize: 14,
    color: '#64748b',
  },

  // Header Strip
  headerStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingVertical: 4,
  },
  appTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
  },
  healthCheckText: {
    fontSize: 12,
    color: GRAY,
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 20,
    gap: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusBadgeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  headerLinkBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
  },
  headerLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },

  // Telegram Banner
  telegramBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    gap: 10,
  },
  telegramIcon: {
    fontSize: 20,
  },
  telegramTextCol: {
    flex: 1,
  },
  telegramTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#92400e',
  },
  telegramJobName: {
    fontSize: 12,
    color: '#b45309',
    marginTop: 1,
  },
  telegramActionBtn: {
    backgroundColor: '#d97706',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  telegramActionTxt: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },

  // Stats Card
  statsCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 14,
    paddingHorizontal: 8,
    marginBottom: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: GRAY,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#f1f5f9',
  },

  // Active Job Card
  activeJobSection: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    padding: 16,
    marginBottom: 16,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  activeJobHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  activeJobBadge: {
    fontSize: 11,
    fontWeight: '800',
    color: ACCENT,
    letterSpacing: 0.6,
  },
  elapsedText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  activeJobTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  activeJobCompany: {
    fontSize: 14,
    color: GRAY,
    marginTop: 2,
    fontWeight: '500',
  },
  activeJobLink: {
    fontSize: 12,
    color: ACCENT,
    marginTop: 4,
    textDecorationLine: 'underline',
  },
  currentStepBanner: {
    flexDirection: 'row',
    backgroundColor: '#eff6ff',
    padding: 8,
    borderRadius: 6,
    marginTop: 12,
    alignItems: 'center',
  },
  currentStepPrefix: {
    fontSize: 13,
    color: GRAY,
  },
  currentStepName: {
    fontSize: 13,
    fontWeight: '700',
    color: ACCENT,
  },

  // Step Progress
  stepProgressContainer: {
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  stepScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  stepNode: {
    alignItems: 'center',
    minWidth: 70,
  },
  stepCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  stepCircleDone: {
    backgroundColor: '#16a34a',
  },
  stepCircleCurrent: {
    backgroundColor: '#eff6ff',
    borderWidth: 2,
    borderColor: ACCENT,
  },
  stepCirclePending: {
    backgroundColor: '#f1f5f9',
  },
  stepCheckmark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  stepDot: {
    color: '#94a3b8',
    fontSize: 14,
  },
  stepNodeLabel: {
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'center',
  },
  stepNodeLabelActive: {
    color: '#0f172a',
    fontWeight: '600',
  },
  stepLine: {
    width: 20,
    height: 2,
    backgroundColor: '#e2e8f0',
    marginBottom: 16,
  },
  stepLineDone: {
    backgroundColor: '#16a34a',
  },

  // Queue Card & Table
  queueCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    marginBottom: 16,
  },
  queueCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  queueSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  queueCountText: {
    fontSize: 13,
    color: GRAY,
    fontWeight: '500',
  },
  emptyQueueBox: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyQueueIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  emptyQueueText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#334155',
  },
  emptyQueueSub: {
    fontSize: 13,
    color: GRAY,
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 20,
  },
  table: {
    borderWidth: 1,
    borderColor: '#f1f5f9',
    borderRadius: 8,
    overflow: 'hidden',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  th: {
    fontSize: 12,
    fontWeight: '700',
    color: GRAY,
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    alignItems: 'center',
  },
  td: {
    fontSize: 13,
    color: '#334155',
  },
  tdMuted: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
  },
  colIdx: {
    width: 24,
    color: GRAY,
    fontSize: 12,
  },
  colTitle: {
    flex: 1,
    paddingHorizontal: 6,
  },
  tableJobTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
  },
  tableJobCompany: {
    fontSize: 11,
    color: GRAY,
    marginTop: 1,
  },
  colStatus: {
    width: 90,
    alignItems: 'center',
  },
  tableBadge: {
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  tableBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  colAction: {
    width: 48,
    alignItems: 'center',
  },
  actionLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: ACCENT,
  },

  // Footer
  footerRow: {
    alignItems: 'center',
    marginTop: 8,
  },
  signOutBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  signOutText: {
    fontSize: 14,
    color: '#ef4444',
    fontWeight: '600',
  },

  // Modal / Intervention Popup
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    gap: 10,
  },
  modalIcon: {
    fontSize: 22,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    flex: 1,
  },
  modalBody: {
    padding: 20,
  },
  modalText: {
    fontSize: 14,
    color: '#334155',
    lineHeight: 20,
    marginBottom: 14,
  },
  questionHeading: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 12,
  },
  modalInput: {
    borderWidth: 1.5,
    borderColor: BORDER,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
  },
  otpInput: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 8,
    paddingVertical: 12,
  },
  multilineInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  fieldError: {
    borderColor: '#dc2626',
  },
  modalError: {
    fontSize: 13,
    color: '#dc2626',
    marginTop: 8,
  },
  optionsContainer: {
    gap: 8,
    marginBottom: 10,
  },
  optionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: BORDER,
    backgroundColor: '#fff',
    gap: 10,
  },
  optionPillSelected: {
    borderColor: ACCENT,
    backgroundColor: '#eff6ff',
  },
  radioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#94a3b8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioCircleSelected: {
    borderColor: ACCENT,
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: ACCENT,
  },
  optionText: {
    fontSize: 14,
    color: '#334155',
    fontWeight: '500',
  },
  optionTextSelected: {
    color: ACCENT,
    fontWeight: '600',
  },
  modalFooter: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    backgroundColor: '#f8fafc',
  },
  modalBtn: {
    backgroundColor: ACCENT,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnDisabled: {
    backgroundColor: '#93c5fd',
  },
  modalBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
