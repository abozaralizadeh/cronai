import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, View, ViewStyle } from 'react-native';
import type { CronTheme, ThemeName } from '../themes';
import { themes, THEME_NAMES } from '../themes';
import type { Piece, Role } from '../engine';
import { DAY_LABELS, MONTH_LABELS, formatClock, wallClock } from '../engine';
import { relativeTime } from './hooks';

export const NATIVE = Platform.OS !== 'web';

// ----------------------------------------------------------------- PulseDot
export function PulseDot({ color, size = 8 }: { color: string; size?: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }),
        Animated.timing(v, { toValue: 0, duration: 900, easing: Easing.in(Easing.quad), useNativeDriver: NATIVE }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <View style={{ width: size * 2.2, height: size * 2.2, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={{
          position: 'absolute',
          width: size * 2.2,
          height: size * 2.2,
          borderRadius: size * 1.1,
          backgroundColor: color,
          opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.05, 0.3] }),
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
        }}
      />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}

// ----------------------------------------------------------------- ThinkingDots
export function ThinkingDots({ color, active }: { color: string; active: boolean }) {
  const vals = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    if (!active) return;
    const anims = vals.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 120),
          Animated.timing(v, { toValue: 1, duration: 260, useNativeDriver: NATIVE }),
          Animated.timing(v, { toValue: 0, duration: 260, useNativeDriver: NATIVE }),
          Animated.delay((2 - i) * 120),
        ]),
      ),
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [active, vals]);
  return (
    <View style={{ flexDirection: 'row', gap: 3, display: active ? 'flex' : 'none' }}>
      {vals.map((v, i) => (
        <Animated.View
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: 3,
            backgroundColor: color,
            opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
            transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }],
          }}
        />
      ))}
    </View>
  );
}

// ----------------------------------------------------------------- FieldTile
const tileFont = (v: string) => (v.length <= 4 ? 19 : v.length <= 6 ? 15.5 : v.length <= 9 ? 12.5 : 11);

export function FieldTile({ label, value, color, theme, index }: { label: string; value: string; color: string; theme: CronTheme; index: number }) {
  const pop = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 5, tension: 140, delay: index * 35, useNativeDriver: NATIVE }).start();
  }, [value, pop, index]);
  const isAny = value === '*';
  return (
    <Animated.View
      style={[
        s.tile,
        {
          backgroundColor: theme.colors.surfaceAlt,
          borderColor: isAny ? theme.colors.border : color,
          borderRadius: theme.radius.md,
          opacity: pop.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
          transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
        },
      ]}
    >
      <View style={[s.tileBar, { backgroundColor: color, opacity: isAny ? 0.25 : 1 }]} />
      <Text
        selectable
        numberOfLines={2}
        style={[
          s.tileValue,
          { fontSize: tileFont(value), color: isAny ? theme.colors.textFaint : theme.colors.text, fontFamily: theme.fonts.mono },
        ]}
      >
        {value}
      </Text>
      <Text style={[s.tileLabel, { color: theme.colors.textMuted, fontFamily: theme.fonts.body }]}>{label}</Text>
    </Animated.View>
  );
}

// ----------------------------------------------------------------- Understanding chips
const ROLE_LABEL: Record<Role, string> = {
  interval: 'frequency',
  time: 'time',
  day: 'day',
  month: 'month',
  except: 'except',
  connector: '',
  filler: '',
};

export function Understanding({ pieces, theme, labels }: { pieces: Piece[]; theme: CronTheme; labels?: Partial<Record<Role, string>> }) {
  // group consecutive pieces with the same meaningful role
  // A connector ("and", ",", "to") joins a chip only when it sits between two pieces of the same role.
  const roleAt = (i: number, dir: 1 | -1): Role | null => {
    for (let k = i + dir; k >= 0 && k < pieces.length; k += dir) {
      const r = pieces[k].role;
      if (r !== 'connector') return r;
    }
    return null;
  };
  const groups: { role: Role; items: Piece[] }[] = [];
  pieces.forEach((p, i) => {
    let effective: Role = p.role;
    if (p.role === 'connector') {
      const prev = roleAt(i, -1);
      const next = roleAt(i, 1);
      effective = prev && prev === next && prev !== 'filler' ? prev : 'filler';
    }
    const last = groups[groups.length - 1];
    if (last && last.role === effective && effective !== 'filler') last.items.push(p);
    else groups.push({ role: effective, items: [p] });
  });
  return (
    <View style={s.chipsWrap}>
      {groups.map((g, i) => {
        if (g.role === 'filler') {
          return g.items.map((p, j) => (
            <Text key={`${i}-${j}`} style={[s.filler, { color: theme.colors.textFaint, fontFamily: theme.fonts.body }]}>
              {p.text}
            </Text>
          ));
        }
        const color = theme.colors.roles[g.role as keyof CronTheme['colors']['roles']] ?? theme.colors.accent;
        return (
          <View key={i} style={[s.chip, { borderColor: color + '66', backgroundColor: color + '1F', borderRadius: theme.radius.sm }]}>
            <Text style={[s.chipText, { color: theme.colors.text, fontFamily: theme.fonts.body }]}>
              {g.items.map((p, j) => (
                <Text key={j}>
                  {j > 0 ? ' ' : ''}
                  {p.corrected ? (
                    <>
                      <Text style={{ textDecorationLine: 'line-through', color: theme.colors.textFaint }}>{p.text}</Text>
                      <Text style={{ color }}> {p.corrected}</Text>
                    </>
                  ) : (
                    p.text
                  )}
                </Text>
              ))}
            </Text>
            <Text style={[s.chipRole, { color, fontFamily: theme.fonts.body }]}>{labels?.[g.role] ?? ROLE_LABEL[g.role]}</Text>
          </View>
        );
      })}
    </View>
  );
}

// ----------------------------------------------------------------- Confidence
export function ConfidenceMeter({ value, theme }: { value: number; theme: CronTheme }) {
  const w = useRef(new Animated.Value(value)).current;
  useEffect(() => {
    Animated.timing(w, { toValue: value, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [value, w]);
  const color = value >= 0.9 ? theme.colors.success : value >= 0.7 ? theme.colors.warning : theme.colors.danger;
  return (
    <View style={s.confRow}>
      <Text style={[s.small, { color: theme.colors.textMuted, fontFamily: theme.fonts.body }]}>Confidence</Text>
      <View style={[s.confTrack, { backgroundColor: theme.colors.surfaceAlt, borderRadius: 99 }]}>
        <Animated.View
          style={{
            height: '100%',
            borderRadius: 99,
            backgroundColor: color,
            width: w.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          }}
        />
      </View>
      <Text style={[s.small, { color, fontFamily: theme.fonts.mono, minWidth: 38, textAlign: 'right' }]}>{Math.round(value * 100)}%</Text>
    </View>
  );
}

// ----------------------------------------------------------------- Theme picker
export function ThemePicker({ current, onChange, theme }: { current: string; onChange: (n: ThemeName) => void; theme: CronTheme }) {
  return (
    <View style={s.themeRow} accessibilityRole="radiogroup" accessibilityLabel="Theme">
      {THEME_NAMES.map((n) => {
        const t = themes[n];
        const active = n === current;
        return (
          <Pressable
            key={n}
            onPress={() => onChange(n)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${t.label} theme`}
            hitSlop={6}
            style={[s.themeDot, { borderColor: active ? theme.colors.text : 'transparent' }]}
          >
            <View style={[s.themeInner, { backgroundColor: t.colors.background, borderColor: t.colors.border }]}>
              <View style={[s.themeHalf, { backgroundColor: t.colors.accent }]} />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

// ----------------------------------------------------------------- Notes (warnings / assumptions)
export function Notes({ items, kind, theme }: { items: string[]; kind: 'warning' | 'assumption' | 'error'; theme: CronTheme }) {
  if (!items.length) return null;
  const color = kind === 'warning' ? theme.colors.warning : kind === 'error' ? theme.colors.danger : theme.colors.textMuted;
  const icon = kind === 'warning' ? '!' : kind === 'error' ? '×' : 'i';
  return (
    <View style={{ gap: 6 }}>
      {items.map((t, i) => (
        <View key={i} style={s.noteRow}>
          <View style={[s.noteIcon, { borderColor: color }]}>
            <Text style={{ color, fontSize: 10, fontWeight: '800', lineHeight: 12 }}>{icon}</Text>
          </View>
          <Text style={[s.noteText, { color: kind === 'assumption' ? theme.colors.textMuted : theme.colors.text, fontFamily: theme.fonts.body }]}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

// ----------------------------------------------------------------- Next runs
const DOW3 = DAY_LABELS.map((d) => d.slice(0, 3));
const MON3 = MONTH_LABELS.map((m) => m.slice(0, 3));

export function formatRun(d: Date, hour12: boolean, tz?: string): string {
  const w = wallClock(d, tz);
  const y = w.y !== wallClock(new Date(), tz).y ? w.y + ' ' : '';
  return `${DOW3[w.dow]} ${w.d} ${MON3[w.m - 1]} ${y}· ${formatClock(w.h, w.mi, hour12)}`;
}

export function NextRuns({ runs, theme, hour12, now, multi, tz, showLine = true }: { runs: { date: Date; cron: string }[]; theme: CronTheme; hour12: boolean; now: number; multi: string[]; tz?: string; showLine?: boolean }) {
  if (!runs.length) return null;
  return (
    <View style={{ gap: 2 }}>
      {runs.map((r, i) => {
        const ci = multi.indexOf(r.cron);
        return (
          <View key={r.date.getTime()} style={[s.runRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }]}>
            <View style={[s.runIdx, { backgroundColor: i === 0 ? theme.colors.accent : theme.colors.surfaceAlt }]}>
              <Text style={{ color: i === 0 ? theme.colors.onAccent : theme.colors.textMuted, fontSize: 11, fontWeight: '700', fontFamily: theme.fonts.mono }}>{i + 1}</Text>
            </View>
            <Text style={[s.runDate, { color: theme.colors.text, fontFamily: theme.fonts.mono }]}>{formatRun(r.date, hour12, tz)}</Text>
            {multi.length > 1 && showLine && (
              <Text style={[s.small, { color: theme.colors.fields[ci % 5], fontFamily: theme.fonts.mono }]}>#{ci + 1}</Text>
            )}
            <Text style={[s.small, { color: theme.colors.textMuted, fontFamily: theme.fonts.body, marginLeft: 'auto' }]}>{relativeTime(r.date, now)}</Text>
          </View>
        );
      })}
    </View>
  );
}

// ----------------------------------------------------------------- Example chips
export function Examples({ items, onPick, theme }: { items: string[]; onPick: (t: string) => void; theme: CronTheme }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
      {items.map((e) => (
        <Pressable
          key={e}
          onPress={() => onPick(e)}
          accessibilityRole="button"
          accessibilityLabel={`Use example: ${e}`}
          style={({ pressed }) => [
            s.example,
            {
              borderColor: theme.colors.border,
              backgroundColor: pressed ? theme.colors.accentSoft : theme.colors.surfaceAlt,
              borderRadius: theme.radius.xl,
            },
          ]}
        >
          <Text style={{ color: theme.colors.textMuted, fontSize: 13, fontFamily: theme.fonts.body }}>{e}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

// ----------------------------------------------------------------- Small button
export function Pill({ label, onPress, theme, active, style }: { label: string; onPress: () => void; theme: CronTheme; active?: boolean; style?: ViewStyle }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      hitSlop={6}
      style={({ pressed }) => [
        s.pill,
        {
          borderRadius: theme.radius.xl,
          borderColor: active ? theme.colors.accent : theme.colors.border,
          backgroundColor: active ? theme.colors.accent : pressed ? theme.colors.accentSoft : 'transparent',
        },
        style,
      ]}
    >
      <Text style={{ color: active ? theme.colors.onAccent : theme.colors.text, fontSize: 12, fontWeight: '600', fontFamily: theme.fonts.body }}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  tile: {
    flex: 1,
    minWidth: 54,
    paddingTop: 12,
    paddingBottom: 10,
    paddingHorizontal: 6,
    borderWidth: 1,
    alignItems: 'center',
    overflow: 'hidden',
  },
  tileBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  tileValue: { fontWeight: '700', letterSpacing: -0.3, textAlign: 'center', minHeight: 24, textAlignVertical: 'center' },
  tileLabel: { fontSize: 9.5, fontWeight: '700', letterSpacing: 1.1, marginTop: 4, textTransform: 'uppercase' },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  filler: { fontSize: 14, paddingVertical: 4 },
  chip: { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  chipText: { fontSize: 14, fontWeight: '500' },
  chipRole: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  confRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  confTrack: { flex: 1, height: 6, overflow: 'hidden' },
  small: { fontSize: 12 },
  themeRow: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  themeDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  themeInner: { width: 18, height: 18, borderRadius: 9, overflow: 'hidden', borderWidth: 1, flexDirection: 'row' },
  themeHalf: { width: 9, height: '100%' },
  noteRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  noteIcon: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  noteText: { flex: 1, fontSize: 13, lineHeight: 18 },
  runRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  runIdx: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  runDate: { fontSize: 13.5 },
  example: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  pill: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
});
