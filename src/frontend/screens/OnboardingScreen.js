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
 *   as query param. Only shown when has_existing_handshake_account = true.
 *
 * Phase: Phase 1 -- RN onboarding screen (06-implementation.md step 4)
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Switch, ScrollView,
  StyleSheet, Modal, FlatList, ActivityIndicator, Alert, Platform, Linking,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { supabase } from '../utils/supabase.js';
import { API_URL, SUPABASE_URL, TELEGRAM_BOT_USERNAME } from '../config.js';

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

const EMPTY_DRAFT = {
  first_name: '', last_name: '', student_email: '', phone: '',
  school_name: '', major: '', degree_pursuing: null,
  grad_month: null, grad_year: null, school_additional_info: '',
  job_types: [],
  locations_open_to: '',
  job_interests:    '',
  profile_visibility: 'community', job_alerts_opt_in: true,
  has_existing_handshake_account: null,
  resume_storage_path: null, resume_file_name: null, resume_file_size_bytes: null,
};

function profileToDraft(p) {
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
    resume_storage_path:  null,
    resume_file_name:     null,
    resume_file_size_bytes: null,
  };
}

export default function OnboardingScreen({ userId, accessToken, existingProfile, onProfileSaved }) {
  const [draft,        setDraft]        = useState(() => profileToDraft(existingProfile));
  const [errors,       setErrors]       = useState({});
  const [submitError,  setSubmitError]  = useState(null);
  const [tgState,      setTgState]      = useState(existingProfile?.telegram_chat_id ? 'linked' : 'unlinked');
  const [gmailState,   setGmailState]   = useState('disconnected');
  const [mode,         setMode]         = useState(existingProfile ? 'submitted' : 'editing');
  const [resumeBusy,   setResumeBusy]   = useState(false);

  useEffect(() => {
    supabase.from('gmail_oauth_tokens').select('id').eq('profile_id', userId).maybeSingle()
      .then(({ data }) => { if (data) setGmailState('connected'); })
      .catch(() => {});
  }, [userId]);

  useEffect(() => {
    if (existingProfile?.telegram_chat_id) {
      setTgState('linked');
    }
  }, [existingProfile?.telegram_chat_id]);

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
            if (onProfileSaved && payload.new) {
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
          if (onProfileSaved && data) {
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
  }, [tgState, userId, onProfileSaved]);

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
    try {
      let uploadBody;
      if (file.file) {
        uploadBody = file.file;
      } else {
        const response = await fetch(file.uri);
        uploadBody = await response.blob();
      }
      const storagePath = `${userId}/${Date.now()}.pdf`;
      const { error: upErr } = await supabase.storage.from('resumes').upload(storagePath, uploadBody, { contentType: 'application/pdf', upsert: true });
      if (upErr) throw upErr;
      set('resume_storage_path',  storagePath);
      set('resume_file_name',     file.name);
      set('resume_file_size_bytes', file.size ?? uploadBody.size ?? 0);
    } catch (err) {
      setErrors(e => ({ ...e, resume: `Upload failed: ${err.message}` }));
    } finally { setResumeBusy(false); }
  }

  function openTelegram() {
    Linking.openURL(`https://t.me/${TELEGRAM_BOT}?start=${userId}`);
    setTgState('pending');
  }

  function openGmailOAuth() {
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
      resume_storage_path:   draft.resume_storage_path,
      resume_file_size_bytes: draft.resume_file_size_bytes,
    };
    try {
      const res  = await fetch(`${API_URL}/api/onboarding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Submission failed.');
      const { data: saved } = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (onProfileSaved && saved) onProfileSaved(saved);
      setMode('submitted');
    } catch (err) {
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
        {draft.has_existing_handshake_account === true && (
          <View style={s.recapAction}>
            <Text style={s.recapLabel}>Gmail (readonly)</Text>
            {gmailState==='connected' ? <Text style={s.badge}>Connected ✓</Text>
            :gmailState==='pending'   ? <ActivityIndicator size="small" color="#2563eb" />
            : <TouchableOpacity style={s.smallBtn} onPress={openGmailOAuth}><Text style={s.smallBtnTxt}>Connect Gmail</Text></TouchableOpacity>}
          </View>
        )}
        <TouchableOpacity style={[s.btn, s.editBtn]} onPress={() => setMode('editing')}>
          <Text style={s.btnTxt}>Edit Profile</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>{existingProfile ? 'Edit Profile' : 'Your Profile'}</Text>
      <Text style={s.subtitle}>Fill in your details so the bot can apply on your behalf.</Text>

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

      <SectionHeader title="Resume" />
      <FieldLabel label="Upload resume (PDF, max 1 MB)" required />
      {draft.resume_file_name
        ? <View style={s.resumeRow}>
            <Text style={s.resumeName} numberOfLines={1}>{draft.resume_file_name}</Text>
            <TouchableOpacity onPress={pickResume}><Text style={s.changeLink}>Change</Text></TouchableOpacity>
          </View>
        : <TouchableOpacity style={[s.uploadBtn, errors.resume&&s.fieldError]} onPress={pickResume} disabled={resumeBusy}>
            {resumeBusy ? <ActivityIndicator size="small" color="#2563eb" /> : <Text style={s.uploadBtnTxt}>Choose PDF file</Text>}
          </TouchableOpacity>
      }
      <ErrorText message={errors.resume} />

      <SectionHeader title="Telegram" />
      <Text style={s.helper}>Link Telegram to receive bot notifications and answer questions during a run.</Text>
      {tgState==='linked'  ? <Text style={s.badge}>Telegram linked ✓</Text>
      :tgState==='pending' ? <View style={s.pendingRow}><ActivityIndicator size="small" color="#2563eb" /><Text style={s.pendingTxt}>Waiting for link...</Text></View>
      : <TouchableOpacity style={s.btn} onPress={openTelegram}><Text style={s.btnTxt}>Link Telegram</Text></TouchableOpacity>}

      <SectionHeader title="Handshake Account" />
      <FieldLabel label="Do you have an existing Handshake account?" required />
      <View style={s.ynRow}>
        {[{label:'Yes',value:true},{label:'No',value:false}].map(({label,value})=>(
          <TouchableOpacity key={label}
            style={[s.ynBtn, draft.has_existing_handshake_account===value&&s.ynBtnSel]}
            onPress={()=>{ set('has_existing_handshake_account',value); if(!value) setGmailState('disconnected'); }}
          >
            <Text style={[s.ynTxt, draft.has_existing_handshake_account===value&&s.ynTxtSel]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <ErrorText message={errors.has_existing_handshake_account} />

      {draft.has_existing_handshake_account === true && (
        <>
          <SectionHeader title="Gmail Access" />
          <Text style={s.helper}>Read-only access -- used only to read the Handshake one-time password sent to your inbox. We never store your email password.</Text>
          {gmailState==='connected' ? <Text style={s.badge}>Gmail connected ✓</Text>
          :gmailState==='pending'   ? <View style={s.pendingRow}><ActivityIndicator size="small" color="#2563eb"/><Text style={s.pendingTxt}>Connecting...</Text></View>
          : <>
              {gmailState==='error' && <ErrorText message="Connection failed -- tap to retry." />}
              <TouchableOpacity style={s.btn} onPress={openGmailOAuth}><Text style={s.btnTxt}>Connect Gmail (readonly)</Text></TouchableOpacity>
            </>}
        </>
      )}

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
          onPress={() => { setDraft(profileToDraft(existingProfile)); setMode('submitted'); setErrors({}); setSubmitError(null); }}
        >
          <Text style={s.cancelTxt}>Cancel</Text>
        </TouchableOpacity>
      )}
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
  editBtn:     { backgroundColor: '#475569', marginTop: 20 },
  cancelBtn:   { padding: 14, alignItems: 'center', marginTop: 4 },
  cancelTxt:   { color: GRAY, fontSize: 15 },
  smallBtn:    { borderWidth: 1, borderColor: ACCENT, borderRadius: 6, paddingVertical: 6, paddingHorizontal: 12 },
  smallBtnTxt: { color: ACCENT, fontSize: 14, fontWeight: '600' },
  recapSub:    { fontSize: 14, color: GRAY, marginBottom: 16 },
  recapRow:    { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BORDER },
  recapLabel:  { flex: 1, fontSize: 14, color: GRAY, fontWeight: '500' },
  recapVal:    { flex: 2, fontSize: 14, color: '#111', textAlign: 'right' },
  recapAction: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BORDER },
});
