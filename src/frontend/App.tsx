import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, ActivityIndicator, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { supabase } from './utils/supabase.js';
import AuthScreen from './screens/AuthScreen.js';
import OnboardingScreen from './screens/OnboardingScreen.js';

import type { Session } from '@supabase/supabase-js';

export default function App() {
    const [session, setSession] = useState<Session | null>(null);
    const [profile, setProfile] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;

        // Safety fallback timer so loading never hangs indefinitely
        const timer = setTimeout(() => {
            if (isMounted) setLoading(false);
        }, 3000);

        const fetchProfile = async (userId: string) => {
            try {
                const { data: profileData } = await supabase
                    .from('profiles')
                    .select('*')
                    .eq('id', userId)
                    .maybeSingle();
                if (isMounted) {
                    setProfile(profileData ?? null);
                }
            } catch (err) {
                console.warn('[App] profile fetch error:', err);
            }
        };

        const initAuth = async () => {
            try {
                const { data } = await supabase.auth.getSession();
                if (!isMounted) return;
                const currentSession = data?.session ?? null;
                setSession(currentSession);
                if (currentSession?.user?.id) {
                    await fetchProfile(currentSession.user.id);
                }
            } catch (err) {
                console.warn('[App] getSession error:', err);
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        initAuth();

        const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
            if (!isMounted) return;
            setSession(newSession ?? null);
            if (newSession?.user?.id) {
                await fetchProfile(newSession.user.id);
            } else {
                setProfile(null);
            }
        });

        return () => {
            isMounted = false;
            clearTimeout(timer);
            authListener?.subscription?.unsubscribe();
        };
    }, []);

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#2563eb" />
                <Text style={styles.loadingText}>Loading OneClickHandshake...</Text>
                <StatusBar style="auto" />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <StatusBar style="auto" />
            {session ? (
                <OnboardingScreen
                    userId={session.user.id}
                    accessToken={session.access_token}
                    existingProfile={profile}
                    onProfileSaved={(saved: any) => setProfile(saved)}
                />
            ) : (
                <AuthScreen />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        width: '100%',
        height: '100%',
        minHeight: Platform.OS === 'web' ? ('100vh' as any) : undefined,
        backgroundColor: '#ffffff',
    },
    loadingContainer: {
        flex: 1,
        width: '100%',
        height: '100%',
        minHeight: Platform.OS === 'web' ? ('100vh' as any) : undefined,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#ffffff',
        padding: 20,
    },
    loadingText: {
        marginTop: 16,
        fontSize: 15,
        color: '#64748b',
        fontWeight: '500',
    },
});
