/**
 * AuthScreen -- Sign Up / Sign In
 *
 * SPEC GAP (flag before Phase 2): This screen is not listed in 04-ui-ux.md's
 * six screens. It is added as a required precondition because /api/onboarding
 * requires a valid Supabase JWT, meaning the user must be authenticated before
 * the onboarding form can submit. Update 04-ui-ux.md to add this screen before
 * Phase 2 begins.
 *
 * Auth method: email + password (Supabase auth.signUp / signInWithPassword).
 * Testing tip: disable "Confirm email" in Supabase Auth settings so sign-up
 * works instantly without email verification.
 */

import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { supabase } from '../utils/supabase.js';

export default function AuthScreen({ initialMode = 'signup' }) {
  const [mode, setMode]       = useState(initialMode); // 'signin' | 'signup'
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const handleSubmit = async () => {
    setError('');
    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'signup') {
        const { error: e } = await supabase.auth.signUp({ email: email.trim(), password });
        if (e) throw e;
      } else {
        const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (e) throw e;
      }
    } catch (err) {
      setError(err.message ?? 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>OneClickHandshake</Text>
        <Text style={styles.subtitle}>
          {mode === 'signup' ? 'Create your account to get started.' : 'Sign in to continue.'}
        </Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="you@example.com"
          autoComplete="email"
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="Password"
          autoComplete={mode === 'signup' ? 'new-password' : 'password'}
        />

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>{mode === 'signup' ? 'Create account' : 'Sign in'}</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.toggleButton}
          onPress={() => { setMode(m => m === 'signup' ? 'signin' : 'signup'); setError(''); }}
        >
          <Text style={styles.toggleText}>
            {mode === 'signup' ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#fff' },
  content:       { flexGrow: 1, justifyContent: 'center', padding: 24 },
  title:         { fontSize: 28, fontWeight: '700', color: '#111', marginBottom: 4 },
  subtitle:      { fontSize: 15, color: '#64748b', marginBottom: 32 },
  label:         { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6 },
  input:         { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 12 : 8, fontSize: 15, marginBottom: 16, backgroundColor: '#fafafa' },
  button:        { backgroundColor: '#2563eb', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  buttonDisabled:{ backgroundColor: '#93c5fd' },
  buttonText:    { color: '#fff', fontSize: 16, fontWeight: '600' },
  errorText:     { color: '#dc2626', fontSize: 13, marginBottom: 8 },
  toggleButton:  { marginTop: 16, alignItems: 'center' },
  toggleText:    { color: '#2563eb', fontSize: 14 },
});
