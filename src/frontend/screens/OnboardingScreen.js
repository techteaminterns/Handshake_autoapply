/**
 * OnboardingScreen.js
 *
 * Collects the fixed field set from 04-ui-ux.md into Supabase via POST /api/onboarding.
 * All 20 elements across 8 sections as defined in the onboarding-screen-field-list artifact.
 *
 * Modes:
 *   editing    -- form is editable; Submit button POSTs to /api/onboarding
 *   submitting -- API call in-flight; form locked, spinner shown
 *   submitted  -- read-only recap + "Edit Profile" button
 *
 * Resume upload: client uploads directly to Supabase Storage ("resumes" bucket)
 *   using expo-file-system + atob, then includes storage_path in the API payload.
 *   Upload fires on file pick (not deferred to submit), per app.md rule.
 *
 * Telegram: deep-link to @simpleclickonetimeusetestbot?start=<userId>
 *   App polls profiles.telegram_chat_id every 3s while state = pending.
 *
 * Gmail OAuth: opens /api/oauth/gmail/start in system browser with access_token
 *   as query param. Offered unconditionally to all users (Phase A4).
 *
 * Phase: Phase 1 -- RN onboarding screen (06-implementation.md step 4)
 */

import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Switch, ScrollView,
  StyleSheet, Modal, FlatList, ActivityIndicator, Alert, Platform, Linking, Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import { supabase } from '../utils/supabase.js';
import { API_URL, TELEGRAM_BOT_USERNAME } from '../config.js';
import { extractTextFromPdf, parseResumeText } from '../utils/resumeParser.js';

// Constants
const DEGREE_OPTIONS    = ["Associate's", "Bachelor's", "Master's", "MBA", "PhD", "J.D.", "M.D.", "Other"];
const MONTHS            = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const CURRENT_YEAR      = new Date().getFullYear();
const YEARS             = Array.from({ length: 7 }, (_, i) => String(CURRENT_YEAR + i));
const JOB_TYPE_OPTIONS  = [
  { label: 'Full-time',   value: 'full_time' },
  { label: 'Part-time',   value: 'part_time' },
  { label: 'Internship',  value: 'internship' },
  { label: 'Not sure yet',value: 'not_sure' },
];
const VISIBILITY_OPTIONS = [
  { label: 'Community (visible to employers on Handshake)', value: 'community' },
  { label: 'Employers only',                                value: 'employers' },
  { label: 'Hidden',                                        value: 'hidden' },
];
const TELEGRAM_BOT = TELEGRAM_BOT_USERNAME;
const MAX_RESUME_BYTES = 1_048_576;

function SectionHeader({ title }) {
  return <Text style={s.sectionHeader}>{title}</Text>;
}

function FieldLabel({ label, required }) {
  return (
    <Text style={s.fieldLabel}>
      {label}{required ? <Text style={s.required}> *</Text> : null}
    </Text>
  );
}

function ErrorText({ message }) {
  if (!message) return null;
  return <Text style={s.errorText}>{message}</Text>;
}

function PickerField({ label, required, value, options, onSelect, error }) {
  const [open, setOpen] = useState(false);
  const displayLabel = typeof options[0] === 'object'
    ? (options.find(o => o.value === value)?.label ?? null)
    : value;
  return (
    <>
      <FieldLabel label={label} required={required} />
      <TouchableOpacity
        style={[s.pickerBtn, error && s.fieldError]}
        onPress={() => setOpen(true)}
        accessibilityLabel={`Select ${label}`}
      >
        <Text style={displayLabel ? s.pickerVal : s.pickerPlaceholder}>
          {displayLabel ?? `Select ${label}`}
        </Text>
        <Text style={s.chevron}>▼</Text>
      </TouchableOpacity>
      <ErrorText message={error} />
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={item => (typeof item === 'object' ? item.value : item)}
              renderItem={({ item }) => {
                const itemValue = typeof item === 'object' ? item.value : item;
                const itemLabel = typeof item === 'object' ? item.label : item;
                const selected  = itemValue === value;
                return (
                  <TouchableOpacity
                    style={[s.sheetOpt, selected && s.sheetOptSel]}
                    onPress={() => { onSelect(itemValue); setOpen(false); }}
                  >
                    <Text style={[s.sheetOptTxt, selected && s.sheetOptTxtSel]}>{itemLabel}</Text>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

export const EMPTY_DRAFT = {
  first_name: '', last_name: '', student_email: '', phone: '',
  school_name: '', major: '', degree_pursuing: null,
  grad_month: null, grad_year: null, school_additional_info: '',
  job_types: [],
  locations_open_to: '',
  job_interests:    '',
  profile_visibility: 'community', job_alerts_opt_in: true,
  has_existing_handshake_account: null,
  handshake_email: '',
  handshake_password: '',
  whatsapp_phone: '',
  resume_storage_path: null, resume_file_name: null, resume_file_size_bytes: null,
};

export function profileToDraft(p) {
  if (!p) return { ...EMPTY_DRAFT };
  return {
    ...EMPTY_DRAFT,
    first_name:    p.first_name ?? '',
    last_name:     p.last_name  ?? '',
    student_email: p.student_email ?? '',
    phone:         p.phone ?? '',
    school_name:   p.school_name ?? '',
    major:         p.major ?? '',
    degree_pursuing: p.degree_pursuing ?? null,
    grad_month:    p.grad_month ?? null,
    grad_year:     p.grad_year ? String(p.grad_year) : null,
    school_additional_info: p.school_additional_info ?? '',
    job_types:     p.job_types ?? [],
    locations_open_to: (p.locations_open_to ?? []).join(', '),
    job_interests:    (p.job_interests    ?? []).join(', '),
    profile_visibility: p.profile_visibility ?? 'community',
    job_alerts_opt_in:  p.job_alerts_opt_in  ?? true,
    has_existing_handshake_account: p.has_existing_handshake_account ?? null,
    handshake_email: p.handshake_email ?? '',
    handshake_password: '',
    whatsapp_phone: p.whatsapp_phone ?? '',
    resume_storage_path:  null,
    resume_file_name:     null,
    resume_file_size_bytes: null,
  };
}

export const getDraftKey = (uid) => uid ? `@onboarding_draft_${uid}` : '@onboarding_draft_anon';

export async function saveDraftToStorage(uid, currentDraft) {
  try {
    if (!currentDraft) return;
    const key = getDraftKey(uid);
    await AsyncStorage.setItem(key, JSON.stringify(currentDraft));
  } catch (err) {
    console.warn('[Onboarding] Failed to save draft to AsyncStorage:', err);
  }
}

export async function loadDraftFromStorage(uid) {
  try {
    const key = getDraftKey(uid);
    let saved = await AsyncStorage.getItem(key);
    if (!saved && uid) {
      // Fallback check for anonymous draft if user just signed in
      const anonSaved = await AsyncStorage.getItem('@onboarding_draft_anon');
      if (anonSaved) {
        saved = anonSaved;
        await AsyncStorage.setItem(key, anonSaved);
        await AsyncStorage.removeItem('@onboarding_draft_anon');
      }
    }
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (err) {
    console.warn('[Onboarding] Failed to load draft from AsyncStorage:', err);
  }
  return null;
}

export async function clearDraftFromStorage(uid) {
  try {
    const key = getDraftKey(uid);
    await AsyncStorage.removeItem(key);
    if (uid) {
      await AsyncStorage.removeItem('@onboarding_draft_anon');
    }
  } catch (err) {
    console.warn('[Onboarding] Failed to clear draft from AsyncStorage:', err);
  }
}

export const isProfileComplete = (p) => Boolean(p && p.first_name && p.student_email);

export default function OnboardingScreen({ userId, accessToken, existingProfile, onProfileSaved, onSignOut }) {
  const [draft,            setDraft]           = useState(() => profileToDraft(existingProfile));
  const [isDraftRestored,  setIsDraftRestored] = useState(false);
  const [errors,           setErrors]          = useState({});
  const [submitError,      setSubmitError]     = useState(null);
  const [tgState,          setTgState]         = useState(existingProfile?.telegram_chat_id ? 'linked' : 'unlinked');
  const [waState,          setWaState]         = useState(existingProfile?.whatsapp_phone ? 'linked' : 'unlinked');
  const [waPhone,          setWaPhone]         = useState(existingProfile?.whatsapp_phone || '');
  const [waQrDataUrl,      setWaQrDataUrl]     = useState(null);
  const [waModalOpen,      setWaModalOpen]     = useState(false);
  const [waLoading,        setWaLoading]       = useState(false);
  const [gmailState,       setGmailState]      = useState('disconnected');
  const [mode,             setMode]            = useState(() => (isProfileComplete(existingProfile) ? 'submitted' : 'editing'));
  const [resumeBusy,       setResumeBusy]      = useState(false);
  const [parseNotice,      setParseNotice]     = useState(null);

  // Restore saved draft on mount if in editing mode
  useEffect(() => {
    let isMounted = true;
    async function checkSavedDraft() {
      try {
        console.log('[OnboardingScreen] Checking saved draft in AsyncStorage for userId:', userId);
        const saved = await loadDraftFromStorage(userId);
        if (saved && isMounted) {
          console.log('[OnboardingScreen] Successfully restored draft from AsyncStorage for userId:', userId);
          setDraft(prev => ({
            ...EMPTY_DRAFT,
            ...(existingProfile ? profileToDraft(existingProfile) : {}),
            ...prev,
            ...saved,
          }));
          if (Object.keys(saved).some(k => saved[k] && (!Array.isArray(saved[k]) || saved[k].length > 0))) {
            setMode('editing');
          }
        } else if (existingProfile && isMounted) {
          console.log('[OnboardingScreen] No storage draft found, initializing from existingProfile');
          setDraft(profileToDraft(existingProfile));
        }
      } catch (err) {
        console.warn('[OnboardingScreen] Error checking saved draft:', err);
      } finally {
        if (isMounted) {
          setIsDraftRestored(true);
        }
      }
    }
    checkSavedDraft();
    return () => { isMounted = false; };
  }, [userId, existingProfile]);

  // Keep saved draft in sync with state changes during editing AFTER draft has been restored
  useEffect(() => {
    if (!isDraftRestored || !userId) return;
    if (mode === 'editing') {
      saveDraftToStorage(userId, draft);
    }
  }, [draft, mode, userId, isDraftRestored]);

  const handleCreateNewProfile = async () => {
    try {
      await clearDraftFromStorage(userId);
      setDraft({ ...EMPTY_DRAFT });
      setErrors({});
      setSubmitError(null);
      setTgState('unlinked');
      setWaState('unlinked');
      setWaPhone('');
      setWaQrDataUrl(null);
      setWaModalOpen(false);
      setGmailState('disconnected');
      setMode('editing');
      setResumeBusy(false);
      setParseNotice(null);

      if (onProfileSaved) {
        onProfileSaved(null);
      }
      if (onSignOut) {
        onSignOut();
      }

      await supabase.auth.signOut();
    } catch (err) {
      console.warn('[Onboarding] Sign out error:', err);
    }
  };

  // Check gmail token status on mount / mode change
  useEffect(() => {
    if (!userId) return;
    supabase.from('gmail_oauth_tokens').select('id').eq('profile_id', userId).maybeSingle()
      .then(({ data }) => { if (data) setGmailState('connected'); })
      .catch(() => {});
  }, [mode, userId]);

  // Realtime subscription + polling for gmail_oauth_tokens (starts when connecting, clears when confirmed)
  useEffect(() => {
    if (!userId || gmailState !== 'pending') return;

    // 1. Supabase Realtime subscription listening for updates/inserts on gmail_oauth_tokens
    const channel = supabase
      .channel(`realtime:gmail_oauth_tokens:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'gmail_oauth_tokens',
          filter: `profile_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.new) {
            setGmailState('connected');
          }
        }
      )
      .subscribe();

    // 2. Active polling fallback (checks every 2 seconds while pending)
    const interval = setInterval(async () => {
      try {
        const { data } = await supabase
          .from('gmail_oauth_tokens')
          .select('id')
          .eq('profile_id', userId)
          .maybeSingle();

        if (data) {
          setGmailState('connected');
        }
      } catch (err) {
        console.warn('[Onboarding] gmail token check error:', err);
      }
    }, 2000);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [gmailState, userId]);

  // Sync telegram link status whenever the parent passes a fresh profile.
  useEffect(() => {
    if (existingProfile?.telegram_chat_id) {
      setTgState('linked');
    }
  }, [existingProfile?.telegram_chat_id]);

  // Sync whatsapp link status whenever the parent passes a fresh profile.
  useEffect(() => {
    if (existingProfile?.whatsapp_phone) {
      setWaState('linked');
      setWaPhone(existingProfile.whatsapp_phone);
    }
  }, [existingProfile?.whatsapp_phone]);


  // Realtime subscription + polling for telegram_chat_id
  useEffect(() => {
    if (!userId || tgState === 'linked') return;

    // 1. Supabase Realtime subscription listening for updates on the profiles row
    const channel = supabase
      .channel(`realtime:profiles:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${userId}`,
        },
        (payload) => {
          const updatedChatId = payload.new?.telegram_chat_id;
          if (updatedChatId) {
            setTgState('linked');
            if (onProfileSaved && payload.new && mode === 'submitted') {
              onProfileSaved(payload.new);
            }
          }
        }
      )
      .subscribe();

    // 2. Active polling fallback (checks every 2 seconds when pending, 5 seconds otherwise)
    const interval = setInterval(async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle();

        if (data?.telegram_chat_id) {
          setTgState('linked');
          if (onProfileSaved && data && mode === 'submitted') {
            onProfileSaved(data);
          }
        }
      } catch (err) {
        console.warn('[Onboarding] telegram check error:', err);
      }
    }, tgState === 'pending' ? 2000 : 5000);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [tgState, userId, onProfileSaved, mode]);

  // Realtime subscription + polling for whatsapp_phone
  useEffect(() => {
    if (!userId || waState === 'linked') return;

    const channel = supabase
      .channel(`realtime:profiles_whatsapp:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${userId}`,
        },
        (payload) => {
          const updatedPhone = payload.new?.whatsapp_phone;
          if (updatedPhone) {
            setWaState('linked');
            setWaPhone(updatedPhone);
            setDraft(prev => ({ ...prev, whatsapp_phone: updatedPhone }));
            if (onProfileSaved && payload.new && mode === 'submitted') {
              onProfileSaved(payload.new);
            }
          }
        }
      )
      .subscribe();

    const interval = setInterval(async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle();

        if (data?.whatsapp_phone) {
          setWaState('linked');
          setWaPhone(data.whatsapp_phone);
          setDraft(prev => ({ ...prev, whatsapp_phone: data.whatsapp_phone }));
          if (onProfileSaved && data && mode === 'submitted') {
            onProfileSaved(data);
          }
        }
      } catch (err) {
        console.warn('[Onboarding] whatsapp check error:', err);
      }
    }, waModalOpen ? 2000 : 5000);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [waState, waModalOpen, userId, onProfileSaved, mode]);

  // Polling loop while WhatsApp QR modal is open
  useEffect(() => {
    if (!waModalOpen || waState === 'linked' || !userId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/api/whatsapp/status?user_id=${encodeURIComponent(userId)}`, {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        });
        const json = await res.json();
        if (json.phone || json.status === 'connected') {
          setWaState('linked');
          setWaPhone(json.phone || '');
          if (json.phone) {
            setDraft(prev => ({ ...prev, whatsapp_phone: json.phone }));
          }
          setWaLoading(false);
        } else if (json.qr_data_url) {
          setWaQrDataUrl(json.qr_data_url);
          setWaLoading(false);
        }
      } catch (err) {
        console.warn('[Onboarding] WhatsApp modal polling error:', err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [waModalOpen, waState, userId, accessToken]);

  function set(key, val) {
    setDraft(d => ({ ...d, [key]: val }));
    setErrors(e => { const n = { ...e }; delete n[key]; return n; });
    if (submitError) setSubmitError(null);
  }
  function toggleJobType(val) {
    setDraft(d => ({
      ...d,
      job_types: d.job_types.includes(val)
        ? d.job_types.filter(v => v !== val)
        : [...d.job_types, val],
    }));
  }

  async function pickResume() {
    let result;
    try {
      result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    } catch { Alert.alert('Error', 'Could not open file picker.'); return; }
    if (result.canceled || !result.assets?.[0]) return;
    const file = result.assets[0];
    if (file.size && file.size > MAX_RESUME_BYTES) {
      setErrors(e => ({ ...e, resume: 'Resume must be a PDF under 1 MB.' })); return;
    }
    setErrors(e => { const n = { ...e }; delete n.resume; return n; });
    setResumeBusy(true);
    setParseNotice(null);
    try {
      let uploadBody;
      let parseSource;
      if (file.file) {
        uploadBody = file.file;
        parseSource = file.file;
      } else {
        const response = await fetch(file.uri);
        uploadBody = await response.blob();
        parseSource = uploadBody;
      }
      const storagePath = `${userId}/${Date.now()}.pdf`;
      const { error: upErr } = await supabase.storage.from('resumes').upload(storagePath, uploadBody, { contentType: 'application/pdf', upsert: true });
      if (upErr) throw upErr;

      // Extract text and parse entities from resume PDF
      let parsed = {};
      let extractedCount = 0;
      try {
        const rawText = await extractTextFromPdf(parseSource || file.uri);
        if (rawText && rawText.trim()) {
          parsed = parseResumeText(rawText);
        }
      } catch (parseErr) {
        console.warn('[OnboardingScreen] PDF text parsing error (non-fatal):', parseErr);
      }

      setDraft(prev => {
        const updated = {
          ...prev,
          resume_storage_path:   storagePath,
          resume_file_name:      file.name,
          resume_file_size_bytes: file.size ?? uploadBody.size ?? 0,
        };

        if (parsed.first_name) { updated.first_name = parsed.first_name; extractedCount++; }
        if (parsed.last_name)  { updated.last_name = parsed.last_name; extractedCount++; }
        if (parsed.student_email) {
          updated.student_email = parsed.student_email;
          extractedCount++;
          if (updated.has_existing_handshake_account && !updated.handshake_email) {
            updated.handshake_email = parsed.student_email;
          }
        }
        if (parsed.phone) { updated.phone = parsed.phone; extractedCount++; }
        if (parsed.school_name) { updated.school_name = parsed.school_name; extractedCount++; }
        if (parsed.major) { updated.major = parsed.major; extractedCount++; }
        if (parsed.degree_pursuing) { updated.degree_pursuing = parsed.degree_pursuing; extractedCount++; }
        if (parsed.grad_month) { updated.grad_month = parsed.grad_month; }
        if (parsed.grad_year) { updated.grad_year = parsed.grad_year; }
        if (parsed.job_interests && !prev.job_interests) {
          updated.job_interests = parsed.job_interests;
        }
        if (parsed.job_types?.length && (!prev.job_types || prev.job_types.length === 0)) {
          updated.job_types = parsed.job_types;
        }
        return updated;
      });

      // Clear validation errors for any fields that were populated
      setErrors(prev => {
        const nextErrs = { ...prev };
        delete nextErrs.resume;
        if (parsed.first_name) delete nextErrs.first_name;
        if (parsed.last_name) delete nextErrs.last_name;
        if (parsed.student_email) delete nextErrs.student_email;
        if (parsed.phone) delete nextErrs.phone;
        if (parsed.school_name) delete nextErrs.school_name;
        if (parsed.major) delete nextErrs.major;
        if (parsed.degree_pursuing) delete nextErrs.degree_pursuing;
        if (parsed.grad_month) delete nextErrs.grad_month;
        if (parsed.grad_year) delete nextErrs.grad_year;
        return nextErrs;
      });

      if (extractedCount > 0) {
        setParseNotice({
          type: 'success',
          message: '✓ Resume parsed! Fields below have been auto-populated. You can review and edit them before submitting.',
        });
      } else {
        setParseNotice({
          type: 'info',
          message: 'Resume uploaded. Could not automatically extract text — please fill in your details below.',
        });
      }
    } catch (err) {
      setErrors(e => ({ ...e, resume: `Upload failed: ${err.message}` }));
    } finally { setResumeBusy(false); }
  }

  async function openTelegram() {
    if (!userId) {
      Alert.alert('Error', 'Please sign in first before linking Telegram.');
      return;
    }
    // Save form data before navigating to Telegram link
    await saveDraftToStorage(userId, draft);

    const botName = (TELEGRAM_BOT || 'simpleclickonetimeusetestbot').replace(/^@/, '');
    const url = `https://t.me/${botName}?start=${encodeURIComponent(userId)}`;
    Linking.openURL(url).catch(err => {
      console.warn('[Onboarding] openTelegram error:', err);
    });
    setTgState('pending');
  }

  async function openWhatsAppModal() {
    if (!userId) {
      Alert.alert('Error', 'Please sign in first before linking WhatsApp.');
      return;
    }
    await saveDraftToStorage(userId, draft);
    setWaModalOpen(true);
    setWaLoading(true);
    setWaQrDataUrl(null);

    try {
      const res = await fetch(`${API_URL}/api/whatsapp/link?user_id=${encodeURIComponent(userId)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ user_id: userId }),
      });
      const json = await res.json();
      if (json.phone || json.status === 'connected') {
        setWaState('linked');
        setWaPhone(json.phone || '');
        setWaLoading(false);
      } else if (json.qr_data_url) {
        setWaQrDataUrl(json.qr_data_url);
        setWaLoading(false);
      }
    } catch (err) {
      console.warn('[Onboarding] openWhatsAppModal link error:', err);
      setWaLoading(false);
    }
  }

  async function openGmailOAuth() {
    // Save form data before navigating to Gmail OAuth
    await saveDraftToStorage(userId, draft);
    setGmailState('pending');
    const url = `${API_URL}/api/oauth/gmail/start?access_token=${encodeURIComponent(accessToken)}`;
    Linking.openURL(url).catch(() => setGmailState('error'));
  }

  function validate() {
    const errs = {};
    const req = (k, label) => { if (!draft[k]?.toString().trim()) errs[k] = `${label} is required.`; };
    req('first_name','First name'); req('last_name','Last name');
    req('student_email','Student email'); req('phone','Phone');
    req('school_name','School name'); req('major','Major');
    if (!draft.degree_pursuing)  errs.degree_pursuing = 'Degree is required.';
    if (!draft.grad_month)       errs.grad_month      = 'Graduation month is required.';
    if (!draft.grad_year)        errs.grad_year       = 'Graduation year is required.';
    if (draft.has_existing_handshake_account === null) errs.has_existing_handshake_account = 'Please select Yes or No.';
    if (draft.has_existing_handshake_account === true) {
      if (!draft.handshake_email?.trim()) {
        errs.handshake_email = 'Handshake email is required.';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.handshake_email.trim())) {
        errs.handshake_email = 'Please enter a valid Handshake email address.';
      }
      if (!draft.handshake_password?.trim()) {
        errs.handshake_password = 'Handshake password is required.';
      }
    }
    if (!draft.resume_storage_path)  errs.resume = 'Please upload your resume (PDF, max 1 MB).';
    if (draft.student_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.student_email.trim()))
      errs.student_email = 'Please enter a valid email address.';
    return errs;
  }

  async function submit() {
    setSubmitError(null);
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    setMode('submitting');
    const csv = str => str.trim() ? str.split(',').map(s => s.trim()).filter(Boolean) : [];
    const payload = {
      first_name: draft.first_name.trim(), last_name: draft.last_name.trim(),
      student_email: draft.student_email.trim().toLowerCase(), phone: draft.phone.trim(),
      school_name: draft.school_name.trim(), major: draft.major.trim(),
      degree_pursuing: draft.degree_pursuing, grad_month: draft.grad_month,
      grad_year: Number(draft.grad_year),
      school_additional_info: draft.school_additional_info?.trim() || null,
      job_types: draft.job_types,
      locations_open_to: csv(draft.locations_open_to),
      job_interests:     csv(draft.job_interests),
      profile_visibility: draft.profile_visibility,
      job_alerts_opt_in: draft.job_alerts_opt_in,
      has_existing_handshake_account: draft.has_existing_handshake_account,
      handshake_email: draft.has_existing_handshake_account ? (draft.handshake_email?.trim().toLowerCase() || null) : null,
      handshake_password: draft.has_existing_handshake_account ? (draft.handshake_password || null) : null,
      ...(draft.whatsapp_phone ? { whatsapp_phone: draft.whatsapp_phone.trim() } : {}),
      resume_storage_path:   draft.resume_storage_path,
      resume_file_size_bytes: draft.resume_file_size_bytes,
    };
    try {
      console.log('[OnboardingScreen] Submitting onboarding profile payload to /api/onboarding...');
      const res  = await fetch(`${API_URL}/api/onboarding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        console.error(`[OnboardingScreen] /api/onboarding returned error status ${res.status}:`, json);
        throw new Error(json.error ?? `Submission failed (${res.status}).`);
      }
      console.log('[OnboardingScreen] /api/onboarding succeeded (200):', json);

      // Clear saved draft only on successful form submission
      await clearDraftFromStorage(userId);

      // Retrieve saved profile record from Supabase with safe fallback
      let { data: saved, error: fetchErr } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
      if (fetchErr || !saved) {
        console.warn('[OnboardingScreen] Profile fetch error or empty, using payload fallback:', fetchErr?.message);
        saved = { ...payload, id: userId, created_at: new Date().toISOString() };
      }

      console.log('[OnboardingScreen:533] onProfileSaved firing with profile:', saved);
      if (onProfileSaved && saved) {
        onProfileSaved(saved);
      }
      setMode('submitted');
    } catch (err) {
      console.error('[OnboardingScreen] Submission failure:', err.message || err);
      setSubmitError(err.message || 'Submission failed.');
      setMode('editing');
    }
  }

  if (mode === 'submitted') {
    const vis = VISIBILITY_OPTIONS.find(o => o.value === draft.profile_visibility)?.label ?? draft.profile_visibility;
    return (
      <ScrollView style={s.container} contentContainerStyle={s.content}>
        <Text style={s.title}>Profile ✓</Text>
        <Text style={s.recapSub}>Your profile is saved. You can now submit a job link.</Text>
        {[['Name',`${draft.first_name} ${draft.last_name}`],['Email',draft.student_email],['Phone',draft.phone],
          ['School',draft.school_name],['Major',draft.major],['Degree',draft.degree_pursuing],
          ['Graduation',`${draft.grad_month} ${draft.grad_year}`],
          ['Job types', draft.job_types.map(v => JOB_TYPE_OPTIONS.find(o=>o.value===v)?.label??v).join(', ')||'None'],
          ['Locations', draft.locations_open_to||'Any'],['Interests',draft.job_interests||'Any'],
          ['Visibility',vis],['Job alerts',draft.job_alerts_opt_in?'On':'Off'],
          ['Handshake acct',draft.has_existing_handshake_account?'Yes':'No'],
          ...(draft.has_existing_handshake_account ? [['Handshake email', draft.handshake_email || '--']] : []),
          ['Resume',draft.resume_file_name??'Uploaded'],
        ].map(([label, value]) => (
          <View key={label} style={s.recapRow}>
            <Text style={s.recapLabel}>{label}</Text>
            <Text style={s.recapVal}>{value||'--'}</Text>
          </View>
        ))}
        <View style={s.recapAction}>
          <Text style={s.recapLabel}>Telegram</Text>
          {tgState==='linked'  ? <Text style={s.badge}>Linked ✓</Text>
          :tgState==='pending' ? <ActivityIndicator size="small" color="#2563eb" />
          : <TouchableOpacity style={s.smallBtn} onPress={openTelegram}><Text style={s.smallBtnTxt}>Link Telegram</Text></TouchableOpacity>}
        </View>
        <View style={s.recapAction}>
          <Text style={s.recapLabel}>WhatsApp</Text>
          {waState==='linked'  ? <Text style={s.badge}>Linked ({waPhone || draft.whatsapp_phone || draft.phone}) ✓</Text>
          :waState==='pending' ? <ActivityIndicator size="small" color="#2563eb" />
          : <TouchableOpacity style={s.smallBtn} onPress={openWhatsAppModal}><Text style={s.smallBtnTxt}>Link WhatsApp</Text></TouchableOpacity>}
        </View>
        <View style={s.recapAction}>
          <Text style={s.recapLabel}>Gmail (readonly)</Text>
          {gmailState==='connected' ? <Text style={s.badge}>Connected (readonly) ✓</Text>
          :gmailState==='pending'   ? <ActivityIndicator size="small" color="#2563eb" />
          : <TouchableOpacity style={s.smallBtn} onPress={openGmailOAuth}><Text style={s.smallBtnTxt}>Connect Gmail</Text></TouchableOpacity>}
        </View>
        <View style={s.btnRow}>
          <TouchableOpacity style={[s.btn, s.editBtn, s.flexBtn]} onPress={() => setMode('editing')}>
            <Text style={s.btnTxt}>Edit Profile</Text>
          </TouchableOpacity>
          {onProfileSaved && (existingProfile || draft.first_name) ? (
            <TouchableOpacity
              style={[s.btn, s.createBtn, s.flexBtn]}
              onPress={() => {
                console.log('[OnboardingScreen] Navigating to Monitoring Dashboard');
                onProfileSaved(existingProfile || { ...draft, id: userId });
              }}
            >
              <Text style={s.btnTxt}>Dashboard →</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[s.btn, s.createBtn, s.flexBtn]} onPress={handleCreateNewProfile}>
              <Text style={s.btnTxt}>Create New Profile</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* WhatsApp QR Modal */}
        <Modal visible={waModalOpen} transparent animationType="fade" onRequestClose={() => setWaModalOpen(false)}>
          <TouchableOpacity style={s.overlayCenter} activeOpacity={1} onPress={() => setWaModalOpen(false)}>
            <TouchableOpacity style={s.qrModalCard} activeOpacity={1} onPress={() => {}}>
              <Text style={s.qrModalTitle}>Link WhatsApp</Text>
              <Text style={s.qrModalSubtitle}>Scan the QR code below to connect your WhatsApp account with OneClickHandshake.</Text>

              <View style={s.qrInstructionBox}>
                <Text style={s.qrInstructionStep}>1. Open <Text style={{fontWeight: '700'}}>WhatsApp</Text> on your phone</Text>
                <Text style={s.qrInstructionStep}>2. Tap <Text style={{fontWeight: '700'}}>Settings</Text> &gt; <Text style={{fontWeight: '700'}}>Linked Devices</Text></Text>
                <Text style={s.qrInstructionStep}>3. Tap <Text style={{fontWeight: '700'}}>Link a Device</Text> and scan this code</Text>
              </View>

              <View style={s.qrContainer}>
                {waLoading ? (
                  <View style={s.qrLoadingBox}>
                    <ActivityIndicator size="large" color="#2563eb" />
                    <Text style={s.qrLoadingText}>Generating WhatsApp QR code...</Text>
                  </View>
                ) : waState === 'linked' ? (
                  <View style={s.qrSuccessBox}>
                    <Text style={s.qrSuccessTitle}>✓ WhatsApp Linked!</Text>
                    <Text style={s.qrSuccessSubtitle}>{waPhone ? `Connected as ${waPhone}` : 'Device linked successfully.'}</Text>
                  </View>
                ) : waQrDataUrl ? (
                  <Image
                    source={{ uri: waQrDataUrl }}
                    style={s.qrImage}
                    resizeMode="contain"
                  />
                ) : (
                  <View style={s.qrLoadingBox}>
                    <ActivityIndicator size="large" color="#2563eb" />
                    <Text style={s.qrLoadingText}>Awaiting QR code...</Text>
                  </View>
                )}
              </View>

              <TouchableOpacity style={[s.btn, s.qrCloseBtn]} onPress={() => setWaModalOpen(false)}>
                <Text style={s.btnTxt}>{waState === 'linked' ? 'Done' : 'Close'}</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>{existingProfile ? 'Edit Profile' : 'Your Profile'}</Text>
      <Text style={s.subtitle}>Upload your resume to automatically pre-fill your details below, or enter them manually.</Text>

      <SectionHeader title="Resume (Auto-fill)" />
      <FieldLabel label="Upload resume (PDF, max 1 MB)" required />
      <Text style={s.helper}>Upload your PDF resume to auto-fill your contact info, academic details, and skills below.</Text>
      {draft.resume_file_name
        ? <View style={s.resumeRow}>
            <Text style={s.resumeName} numberOfLines={1}>{draft.resume_file_name}</Text>
            <TouchableOpacity onPress={pickResume}><Text style={s.changeLink}>Change</Text></TouchableOpacity>
          </View>
        : <TouchableOpacity style={[s.uploadBtn, errors.resume&&s.fieldError]} onPress={pickResume} disabled={resumeBusy}>
            {resumeBusy ? <ActivityIndicator size="small" color="#2563eb" /> : <Text style={s.uploadBtnTxt}>Choose PDF file to Auto-Fill</Text>}
          </TouchableOpacity>
      }
      <ErrorText message={errors.resume} />
      {parseNotice && (
        <View style={parseNotice.type === 'success' ? s.parseBannerSuccess : s.parseBannerInfo}>
          <Text style={parseNotice.type === 'success' ? s.parseBannerTextSuccess : s.parseBannerTextInfo}>
            {parseNotice.message}
          </Text>
        </View>
      )}

      <SectionHeader title="Identity" />
      <FieldLabel label="First name" required />
      <TextInput style={[s.input, errors.first_name&&s.fieldError]} value={draft.first_name} onChangeText={v=>set('first_name',v)} autoCapitalize="words" placeholder="Jane" />
      <ErrorText message={errors.first_name} />
      <FieldLabel label="Last name" required />
      <TextInput style={[s.input, errors.last_name&&s.fieldError]} value={draft.last_name} onChangeText={v=>set('last_name',v)} autoCapitalize="words" placeholder="Smith" />
      <ErrorText message={errors.last_name} />
      <FieldLabel label="Student email" required />
      <TextInput style={[s.input, errors.student_email&&s.fieldError]} value={draft.student_email} onChangeText={v=>set('student_email',v)} keyboardType="email-address" autoCapitalize="none" placeholder="jane@example.com" />
      <ErrorText message={errors.student_email} />
      <FieldLabel label="Phone" required />
      <TextInput style={[s.input, errors.phone&&s.fieldError]} value={draft.phone} onChangeText={v=>set('phone',v)} keyboardType="phone-pad" placeholder="+1 555 000 0000" />
      <ErrorText message={errors.phone} />

      <SectionHeader title="Academic" />
      <FieldLabel label="School name" required />
      <TextInput style={[s.input, errors.school_name&&s.fieldError]} value={draft.school_name} onChangeText={v=>set('school_name',v)} placeholder="State University" />
      <ErrorText message={errors.school_name} />
      <FieldLabel label="Major" required />
      <TextInput style={[s.input, errors.major&&s.fieldError]} value={draft.major} onChangeText={v=>set('major',v)} placeholder="Computer Science" />
      <ErrorText message={errors.major} />
      <PickerField label="Degree pursuing" required value={draft.degree_pursuing} options={DEGREE_OPTIONS} onSelect={v=>set('degree_pursuing',v)} error={errors.degree_pursuing} />
      <PickerField label="Graduation month" required value={draft.grad_month} options={MONTHS} onSelect={v=>set('grad_month',v)} error={errors.grad_month} />
      <PickerField label="Graduation year" required value={draft.grad_year} options={YEARS} onSelect={v=>set('grad_year',v)} error={errors.grad_year} />
      <FieldLabel label="School-specific info" />
      <TextInput style={[s.input, s.multiline]} value={draft.school_additional_info} onChangeText={v=>set('school_additional_info',v)} multiline numberOfLines={3} placeholder="Any additional info specific to your school (optional)" />

      <SectionHeader title="Job Preferences" />
      <FieldLabel label="Job types" />
      {JOB_TYPE_OPTIONS.map(({ label, value }) => (
        <TouchableOpacity key={value} style={s.cbRow} onPress={() => toggleJobType(value)}>
          <View style={[s.cb, draft.job_types.includes(value) && s.cbChecked]}>
            {draft.job_types.includes(value) && <Text style={s.cbMark}>✓</Text>}
          </View>
          <Text style={s.cbLabel}>{label}</Text>
        </TouchableOpacity>
      ))}
      <FieldLabel label="Locations open to" />
      <TextInput style={s.input} value={draft.locations_open_to} onChangeText={v=>set('locations_open_to',v)} placeholder="New York, Remote, Boston (comma-separated)" />
      <FieldLabel label="Job interests" />
      <TextInput style={s.input} value={draft.job_interests} onChangeText={v=>set('job_interests',v)} placeholder="Software Engineering, Product (comma-separated)" />

      <SectionHeader title="Profile Settings" />
      <PickerField label="Profile visibility" value={draft.profile_visibility} options={VISIBILITY_OPTIONS} onSelect={v=>set('profile_visibility',v)} />
      <Text style={s.helper}>Community = your profile is visible to employers on Handshake.</Text>
      <View style={s.switchRow}>
        <Text style={s.switchLabel}>Job alerts</Text>
        <Switch value={draft.job_alerts_opt_in} onValueChange={v=>set('job_alerts_opt_in',v)} trackColor={{ true: '#2563eb' }} />
      </View>

      <SectionHeader title="Telegram" />
      <Text style={s.helper}>Link Telegram to receive bot notifications and answer questions during a run.</Text>
      {tgState==='linked'  ? <Text style={s.badge}>Telegram linked ✓</Text>
      :tgState==='pending' ? <View style={s.pendingRow}><ActivityIndicator size="small" color="#2563eb" /><Text style={s.pendingTxt}>Waiting for link...</Text></View>
      : <TouchableOpacity style={s.btn} onPress={openTelegram}><Text style={s.btnTxt}>Link Telegram</Text></TouchableOpacity>}

      <SectionHeader title="WhatsApp" />
      <Text style={s.helper}>Link WhatsApp to receive job confirmation alerts and reply YES/NO directly from your WhatsApp chat.</Text>
      {waState==='linked'  ? <Text style={s.badge}>WhatsApp linked ({waPhone || draft.whatsapp_phone || draft.phone}) ✓</Text>
      :waState==='pending' ? <View style={s.pendingRow}><ActivityIndicator size="small" color="#2563eb" /><Text style={s.pendingTxt}>Connecting...</Text></View>
      : <TouchableOpacity style={s.btn} onPress={openWhatsAppModal}><Text style={s.btnTxt}>Link WhatsApp</Text></TouchableOpacity>}

      <SectionHeader title="Handshake Account" />
      <FieldLabel label="Do you have an existing Handshake account?" required />
      <View style={s.ynRow}>
        {[{label:'Yes',value:true},{label:'No',value:false}].map(({label,value})=>(
          <TouchableOpacity key={label}
            style={[s.ynBtn, draft.has_existing_handshake_account===value&&s.ynBtnSel]}
            onPress={()=>{
              set('has_existing_handshake_account', value);
              if (value) {
                if (!draft.handshake_email) set('handshake_email', draft.student_email);
              } else {
                set('handshake_email', '');
                set('handshake_password', '');
                setGmailState('disconnected');
              }
            }}
          >
            <Text style={[s.ynTxt, draft.has_existing_handshake_account===value&&s.ynTxtSel]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <ErrorText message={errors.has_existing_handshake_account} />

      {draft.has_existing_handshake_account === true && (
        <>
          <FieldLabel label="Handshake email" required />
          <TextInput
            style={[s.input, errors.handshake_email && s.fieldError]}
            value={draft.handshake_email}
            onChangeText={v => set('handshake_email', v)}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="jane@example.edu"
          />
          <ErrorText message={errors.handshake_email} />

          <FieldLabel label="Handshake password" required />
          <TextInput
            style={[s.input, errors.handshake_password && s.fieldError]}
            value={draft.handshake_password}
            onChangeText={v => set('handshake_password', v)}
            secureTextEntry
            placeholder="••••••••••••"
          />
          <ErrorText message={errors.handshake_password} />
        </>
      )}

      <SectionHeader title="Gmail Access" />
      <Text style={s.helper}>Read-only access — used only to read the Handshake one-time password sent to your inbox. We never store your email password or read any other emails.</Text>
      {gmailState==='connected' ? <Text style={s.badge}>Gmail connected (readonly) ✓</Text>
      :gmailState==='pending'   ? <View style={s.pendingRow}><ActivityIndicator size="small" color="#2563eb"/><Text style={s.pendingTxt}>Connecting...</Text></View>
      : <>
          {gmailState==='error' && <ErrorText message="Connection failed — tap to retry." />}
          <TouchableOpacity style={s.btn} onPress={openGmailOAuth}><Text style={s.btnTxt}>Connect Gmail (readonly)</Text></TouchableOpacity>
        </>}

      <ErrorText message={submitError} />
      <TouchableOpacity
        style={[s.btn, s.submitBtn, mode==='submitting'&&s.btnDisabled]}
        onPress={submit} disabled={mode==='submitting'}
      >
        {mode==='submitting'
          ? <ActivityIndicator color="#fff" />
          : <Text style={s.btnTxt}>{existingProfile ? 'Save changes' : 'Submit profile'}</Text>}
      </TouchableOpacity>
      {existingProfile && (
        <TouchableOpacity style={s.cancelBtn}
          onPress={() => {
            console.log('[OnboardingScreen] Cancel clicked -> returning to MonitoringScreen');
            setErrors({});
            setSubmitError(null);
            if (onProfileSaved && existingProfile) {
              onProfileSaved(existingProfile);
            } else {
              setDraft(profileToDraft(existingProfile));
              setMode('submitted');
            }
          }}
        >
          <Text style={s.cancelTxt}>Cancel</Text>
        </TouchableOpacity>
      )}

      {/* WhatsApp QR Modal */}
      <Modal visible={waModalOpen} transparent animationType="fade" onRequestClose={() => setWaModalOpen(false)}>
        <TouchableOpacity style={s.overlayCenter} activeOpacity={1} onPress={() => setWaModalOpen(false)}>
          <TouchableOpacity style={s.qrModalCard} activeOpacity={1} onPress={() => {}}>
            <Text style={s.qrModalTitle}>Link WhatsApp</Text>
            <Text style={s.qrModalSubtitle}>Scan the QR code below to connect your WhatsApp account with OneClickHandshake.</Text>

            <View style={s.qrInstructionBox}>
              <Text style={s.qrInstructionStep}>1. Open <Text style={{fontWeight: '700'}}>WhatsApp</Text> on your phone</Text>
              <Text style={s.qrInstructionStep}>2. Tap <Text style={{fontWeight: '700'}}>Settings</Text> &gt; <Text style={{fontWeight: '700'}}>Linked Devices</Text></Text>
              <Text style={s.qrInstructionStep}>3. Tap <Text style={{fontWeight: '700'}}>Link a Device</Text> and scan this code</Text>
            </View>

            <View style={s.qrContainer}>
              {waLoading ? (
                <View style={s.qrLoadingBox}>
                  <ActivityIndicator size="large" color="#2563eb" />
                  <Text style={s.qrLoadingText}>Generating WhatsApp QR code...</Text>
                </View>
              ) : waState === 'linked' ? (
                <View style={s.qrSuccessBox}>
                  <Text style={s.qrSuccessTitle}>✓ WhatsApp Linked!</Text>
                  <Text style={s.qrSuccessSubtitle}>{waPhone ? `Connected as ${waPhone}` : 'Device linked successfully.'}</Text>
                </View>
              ) : waQrDataUrl ? (
                <Image
                  source={{ uri: waQrDataUrl }}
                  style={s.qrImage}
                  resizeMode="contain"
                />
              ) : (
                <View style={s.qrLoadingBox}>
                  <ActivityIndicator size="large" color="#2563eb" />
                  <Text style={s.qrLoadingText}>Awaiting QR code...</Text>
                </View>
              )}
            </View>

            <TouchableOpacity style={[s.btn, s.qrCloseBtn]} onPress={() => setWaModalOpen(false)}>
              <Text style={s.btnTxt}>{waState === 'linked' ? 'Done' : 'Close'}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  );
}

const ACCENT = '#2563eb';
const BORDER = '#e2e8f0';
const GRAY   = '#64748b';

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#fff' },
  content:     { padding: 20, paddingBottom: 48 },
  title:       { fontSize: 26, fontWeight: '700', color: '#111', marginBottom: 4 },
  subtitle:    { fontSize: 14, color: GRAY, marginBottom: 16 },
  sectionHeader: { fontSize: 11, fontWeight: '700', color: GRAY, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 28, marginBottom: 10, borderBottomWidth: 1, borderBottomColor: BORDER, paddingBottom: 6 },
  fieldLabel:  { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 5, marginTop: 10 },
  required:    { color: '#dc2626' },
  input:       { borderWidth: 1, borderColor: BORDER, borderRadius: 8, paddingHorizontal: 12, paddingVertical: Platform.OS==='ios'?12:8, fontSize: 15, color: '#111', backgroundColor: '#fafafa' },
  multiline:   { minHeight: 72, textAlignVertical: 'top', paddingTop: 10 },
  fieldError:  { borderColor: '#dc2626' },
  errorText:   { color: '#dc2626', fontSize: 12, marginTop: 3 },
  helper:      { fontSize: 13, color: GRAY, lineHeight: 18, marginBottom: 8 },
  pickerBtn:   { borderWidth: 1, borderColor: BORDER, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fafafa' },
  pickerVal:   { fontSize: 15, color: '#111' },
  pickerPlaceholder: { fontSize: 15, color: '#9ca3af' },
  chevron:     { fontSize: 12, color: GRAY },
  overlay:     { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  overlayCenter: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', padding: 16 },
  sheet:       { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '60%', paddingBottom: 32 },
  sheetTitle:  { fontSize: 16, fontWeight: '700', color: '#111', padding: 16, borderBottomWidth: 1, borderBottomColor: BORDER },
  sheetOpt:    { paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  sheetOptSel: { backgroundColor: '#eff6ff' },
  sheetOptTxt: { fontSize: 15, color: '#111' },
  sheetOptTxtSel: { color: ACCENT, fontWeight: '600' },
  cbRow:   { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  cb:      { width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: '#cbd5e1', marginRight: 10, justifyContent: 'center', alignItems: 'center' },
  cbChecked: { backgroundColor: ACCENT, borderColor: ACCENT },
  cbMark:  { color: '#fff', fontSize: 13, fontWeight: '700' },
  cbLabel: { fontSize: 15, color: '#111' },
  switchRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  switchLabel: { fontSize: 15, color: '#111', fontWeight: '600' },
  uploadBtn:   { borderWidth: 1.5, borderColor: ACCENT, borderStyle: 'dashed', borderRadius: 8, padding: 16, alignItems: 'center', marginTop: 4 },
  uploadBtnTxt: { color: ACCENT, fontWeight: '600', fontSize: 15 },
  resumeRow:   { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  resumeName:  { flex: 1, fontSize: 14, color: '#111' },
  changeLink:  { color: ACCENT, fontWeight: '600', fontSize: 14, marginLeft: 8 },
  ynRow:   { flexDirection: 'row', gap: 12, marginTop: 4 },
  ynBtn:   { flex: 1, borderWidth: 1.5, borderColor: BORDER, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  ynBtnSel: { borderColor: ACCENT, backgroundColor: '#eff6ff' },
  ynTxt:   { fontSize: 15, color: GRAY, fontWeight: '600' },
  ynTxtSel: { color: ACCENT },
  badge:       { color: '#16a34a', fontWeight: '700', fontSize: 15, marginTop: 4 },
  pendingRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  pendingTxt:  { color: GRAY, fontSize: 14 },
  btn:         { backgroundColor: ACCENT, borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  btnDisabled: { backgroundColor: '#93c5fd' },
  btnTxt:      { color: '#fff', fontSize: 16, fontWeight: '600' },
  submitBtn:   { marginTop: 28 },
  btnRow:      { flexDirection: 'row', gap: 12, marginTop: 20 },
  flexBtn:     { flex: 1, marginTop: 0 },
  editBtn:     { backgroundColor: '#475569', marginTop: 0 },
  createBtn:   { backgroundColor: ACCENT, marginTop: 0 },
  cancelBtn:   { padding: 14, alignItems: 'center', marginTop: 4 },
  cancelTxt:   { color: GRAY, fontSize: 15 },
  smallBtn:    { borderWidth: 1, borderColor: ACCENT, borderRadius: 6, paddingVertical: 6, paddingHorizontal: 12 },
  smallBtnTxt: { color: ACCENT, fontSize: 14, fontWeight: '600' },
  recapSub:    { fontSize: 14, color: GRAY, marginBottom: 16 },
  recapRow:    { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BORDER },
  recapLabel:  { flex: 1, fontSize: 14, color: GRAY, fontWeight: '500' },
  recapVal:    { flex: 2, fontSize: 14, color: '#111', textAlign: 'right' },
  recapAction: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BORDER },
  parseBannerSuccess: { backgroundColor: '#f0fdf4', borderColor: '#86efac', borderWidth: 1, borderRadius: 8, padding: 12, marginTop: 10, marginBottom: 6 },
  parseBannerInfo:    { backgroundColor: '#eff6ff', borderColor: '#bfdbfe', borderWidth: 1, borderRadius: 8, padding: 12, marginTop: 10, marginBottom: 6 },
  parseBannerTextSuccess: { color: '#15803d', fontSize: 13, fontWeight: '500', lineHeight: 18 },
  parseBannerTextInfo:    { color: '#1d4ed8', fontSize: 13, fontWeight: '500', lineHeight: 18 },

  // WhatsApp QR Modal styles
  qrModalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 360, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 8 },
  qrModalTitle: { fontSize: 20, fontWeight: '700', color: '#111', marginBottom: 6 },
  qrModalSubtitle: { fontSize: 13, color: GRAY, textAlign: 'center', marginBottom: 14, lineHeight: 18 },
  qrInstructionBox: { backgroundColor: '#f8fafc', borderColor: BORDER, borderWidth: 1, borderRadius: 8, padding: 12, width: '100%', marginBottom: 14 },
  qrInstructionStep: { fontSize: 12, color: '#334155', lineHeight: 18 },
  qrContainer: { width: 220, height: 220, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: BORDER, borderRadius: 12, backgroundColor: '#fff', marginBottom: 16, overflow: 'hidden' },
  qrImage: { width: 210, height: 210 },
  qrLoadingBox: { alignItems: 'center', justifyContent: 'center', padding: 16 },
  qrLoadingText: { fontSize: 13, color: GRAY, marginTop: 10, textAlign: 'center' },
  qrSuccessBox: { alignItems: 'center', justifyContent: 'center', padding: 16 },
  qrSuccessTitle: { fontSize: 18, fontWeight: '700', color: '#16a34a', marginBottom: 6 },
  qrSuccessSubtitle: { fontSize: 14, color: GRAY, textAlign: 'center' },
  qrCloseBtn: { width: '100%', marginTop: 0 },
});
