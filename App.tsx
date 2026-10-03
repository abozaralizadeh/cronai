import React, { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CronTrigger, themes, ThemeName, TriggerEvent, formatClock, Mode, SavedSchedule } from './src';

/**
 * Demo app for the <CronTrigger /> component.
 * Developer view: type a schedule, get cron. User view: what your app's users see
 * when they pick a frequency; you get a SavedSchedule to store and run.
 */
export default function App() {
  const scheme = useColorScheme();
  const [themeName, setThemeName] = useState<ThemeName>(scheme === 'light' ? 'glacier' : 'aurora');
  const [log, setLog] = useState<(TriggerEvent & { at: Date })[]>([]);
  const [mode, setMode] = useState<Mode>('developer');
  const [saved, setSaved] = useState<SavedSchedule | null>(null);
  const t = themes[themeName];

  return (
    <View style={[styles.root, { backgroundColor: t.colors.background }]}>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Text style={[styles.brand, { color: t.colors.text, fontFamily: t.fonts.body }]}>
            Cron<Text style={{ color: t.colors.accent }}>AI</Text>
          </Text>
          <Text style={[styles.tagline, { color: t.colors.textMuted, fontFamily: t.fonts.body }]}>
            Plain English in, cron out. A tiny neural model runs right here on the device: no server, no API key, no native modules.
          </Text>
        </View>

        <View style={[styles.seg, { backgroundColor: t.colors.surfaceAlt, borderColor: t.colors.border, borderRadius: t.radius.lg }]} accessibilityRole="tablist">
          {(['developer', 'user'] as Mode[]).map((m) => (
            <Pressable
              key={m}
              onPress={() => setMode(m)}
              accessibilityRole="tab"
              accessibilityState={{ selected: mode === m }}
              style={[styles.segBtn, { borderRadius: t.radius.md, backgroundColor: mode === m ? t.colors.surface : 'transparent' }]}
            >
              <Text style={{ color: mode === m ? t.colors.text : t.colors.textMuted, fontWeight: '700', fontFamily: t.fonts.body }}>
                {m === 'developer' ? 'Developer view' : 'Your users see'}
              </Text>
            </Pressable>
          ))}
        </View>

        <CronTrigger
          key={mode}
          mode={mode}
          theme={themeName}
          onThemeChange={setThemeName}
          show={mode === 'user' ? ['themes'] : undefined}
          onScheduleChange={setSaved}
          onTrigger={(e) => setLog((l) => [{ ...e, at: new Date() }, ...l].slice(0, 8))}
        />

        {mode === 'user' && saved && (
          <View style={[styles.log, { backgroundColor: t.colors.surface, borderColor: t.colors.border, borderRadius: t.radius.lg }]}>
            <Text style={[styles.logTitle, { color: t.colors.textFaint, fontFamily: t.fonts.body }]}>WHAT YOUR APP RECEIVES (onScheduleChange)</Text>
            <Text selectable style={{ color: t.colors.text, fontFamily: t.fonts.mono, fontSize: 12, lineHeight: 18 }}>
              {JSON.stringify(saved, null, 2)}
            </Text>
            <Text style={{ color: t.colors.textMuted, fontFamily: t.fonts.body, fontSize: 12.5 }}>
              Store it per user, then run it with createTrigger(saved, fn) in the app or on your server.
            </Text>
          </View>
        )}

        {log.length > 0 && (
          <View style={[styles.log, { backgroundColor: t.colors.surface, borderColor: t.colors.border, borderRadius: t.radius.lg }]}>
            <Text style={[styles.logTitle, { color: t.colors.textFaint, fontFamily: t.fonts.body }]}>TRIGGER LOG</Text>
            {log.map((e, i) => (
              <Text key={i} style={{ color: t.colors.text, fontFamily: t.fonts.mono, fontSize: 13 }}>
                {formatClock(e.at.getHours(), e.at.getMinutes())}:{String(e.at.getSeconds()).padStart(2, '0')}  ⚡ {e.cron}
              </Text>
            ))}
          </View>
        )}

        <Text style={[styles.foot, { color: t.colors.textFaint, fontFamily: t.fonts.body }]}>
          {themes[themeName].label} theme · {Platform.OS}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 16, paddingTop: Platform.OS === 'web' ? 28 : 64, paddingBottom: 48, gap: 16, maxWidth: 640, width: '100%', alignSelf: 'center' },
  hero: { gap: 6, paddingHorizontal: 4 },
  brand: { fontSize: 34, fontWeight: '900', letterSpacing: -1 },
  tagline: { fontSize: 14.5, lineHeight: 21 },
  log: { borderWidth: 1, padding: 14, gap: 6 },
  seg: { flexDirection: 'row', borderWidth: 1, padding: 3, gap: 3 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 9 },
  logTitle: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.4, marginBottom: 4 },
  foot: { textAlign: 'center', fontSize: 12 },
});
