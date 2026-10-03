import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  Share,
  StyleProp,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import { FIELD_META, FIELD_ORDER, MODEL_INFO, ParseResult, SavedSchedule, readSchedule, ordinal } from '../engine';
import { CronTheme, ThemeName, resolveTheme } from '../themes';
import { fill, Mode, notesFor, resolveSections, resolveStrings, Section, Strings } from '../ui/config';
import { countdown, TriggerEvent, useCronSchedule, useCronTrigger, useDebounced, useNow } from './hooks';
import {
  ConfidenceMeter,
  Examples,
  FieldTile,
  NATIVE,
  NextRuns,
  Notes,
  Pill,
  PulseDot,
  ThemePicker,
  ThinkingDots,
  Understanding,
  formatRun,
} from './parts';

export const DEFAULT_EXAMPLES = [
  'every 15 minutes during business hours',
  'at 9:15 and 17:45 on weekdays',
  'last friday of every month at 6pm',
  'evrey wensday at half past 4 in the afternoon',
  'every two weeks on saturday at 10am',
  'first monday of each quarter at 9am',
  'every 10 minutes from 9 to 5 except in august',
  'twice a day on weekends',
];
export const USER_EXAMPLES = ['every morning', 'every weekday at 9am', 'every monday at 8:30', 'every other friday at 5pm', 'first day of every month', 'twice a week'];

export interface CronTriggerProps {
  /**
   * 'developer' (default): shows cron, tiles, copy, crontab guard.
   * 'user': for your app's end users picking a frequency; no cron jargon.
   */
  mode?: Mode;
  /** Sections to add (e.g. ['tiles']) or remove (e.g. ['badge','confidence']). See SECTIONS. */
  show?: Section[] | string;
  hide?: Section[] | string;
  /** Re-word or translate any text (subset of DEFAULT_STRINGS). */
  strings?: Partial<Strings>;
  /** Initial text: natural language or a cron expression. */
  defaultValue?: string;
  /** Controlled text value. */
  value?: string;
  onChangeText?: (text: string) => void;
  /** Restore a choice you saved earlier (SavedSchedule or its JSON): text, time zone and weeks. */
  defaultSchedule?: SavedSchedule | string;
  /** Called with the full parse result whenever the interpretation changes. */
  onChange?: (result: ParseResult) => void;
  /** Called with the storable schedule (null when not understood). Save this per user. */
  onScheduleChange?: (schedule: SavedSchedule | null, result: ParseResult) => void;
  /** Called when the schedule fires while armed (app in foreground). */
  onTrigger?: (event: TriggerEvent & { result: ParseResult }) => void;
  /** IANA time zone the times are meant in. Default: the device's zone. */
  timezone?: string;
  /** Theme name or a custom theme from createTheme(). */
  theme?: ThemeName | CronTheme;
  onThemeChange?: (name: ThemeName) => void;
  /** @deprecated use hide={['themes']} */
  showThemePicker?: boolean;
  /** Controlled armed state. Works even when the trigger section is hidden. */
  armed?: boolean;
  defaultArmed?: boolean;
  onArmedChange?: (armed: boolean) => void;
  /** @deprecated use hide={['trigger']} */
  showTrigger?: boolean;
  examples?: string[] | false;
  /** @deprecated use strings={{ heading }} */
  title?: string;
  /** @deprecated use strings={{ placeholder }} */
  placeholder?: string;
  hour12?: boolean;
  /** Week-guard anchor (unix s) from a saved schedule, so "every 2 weeks" keeps the same weeks. */
  anchor?: number;
  allowExtensions?: boolean;
  nextCount?: number;
  debounceMs?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function CronTrigger({
  mode = 'developer',
  show,
  hide,
  strings,
  defaultSchedule,
  defaultValue,
  value,
  onChangeText,
  onChange,
  onScheduleChange,
  onTrigger,
  timezone,
  theme: themeProp = 'aurora',
  onThemeChange,
  showThemePicker = true,
  armed: armedProp,
  defaultArmed = false,
  onArmedChange,
  showTrigger = true,
  examples,
  title,
  placeholder,
  hour12 = false,
  anchor: anchorProp,
  allowExtensions = true,
  nextCount,
  debounceMs = 220,
  style,
  testID,
}: CronTriggerProps) {
  const theme = resolveTheme(themeProp);
  const c = theme.colors;
  const user = mode === 'user';

  // ---------------------------------------------------------------- configuration
  const S = useMemo(
    () => resolveStrings(mode, { ...(title ? { heading: title } : {}), ...(placeholder ? { placeholder } : {}), ...(strings ?? {}) }),
    [mode, title, placeholder, strings],
  );
  const vis = useMemo(() => {
    const h = typeof hide === 'string' ? hide.split(/[\s,]+/) : [...(hide ?? [])];
    if (!showThemePicker) h.push('themes');
    if (!showTrigger) h.push('trigger');
    return resolveSections(mode, 'full', show, h);
  }, [mode, show, hide, showThemePicker, showTrigger]);
  const on = (s: Section) => vis.has(s);
  const exampleList = examples === false ? [] : examples ?? (user ? USER_EXAMPLES : DEFAULT_EXAMPLES);
  const count = nextCount ?? (user ? 3 : 5);

  // ---------------------------------------------------------------- text + parse
  const restored = useMemo(() => readSchedule(defaultSchedule ?? null), [defaultSchedule]);
  const [inner, setInner] = useState(restored?.text ?? defaultValue ?? (user ? '' : 'every 15 minutes during business hours'));
  const text = value ?? inner;
  const setText = useCallback(
    (t: string) => {
      if (value === undefined) setInner(t);
      onChangeText?.(t);
    },
    [value, onChangeText],
  );
  const debounced = useDebounced(text, debounceMs);
  const thinking = debounced !== text;
  // pin the "every N weeks" anchor per sentence so the on-weeks don't drift as time passes
  const [anchors, setAnchors] = useState<Record<string, number>>(() => (restored?.anchor ? { [restored.text]: restored.anchor } : {}));
  const anchor = anchorProp ?? anchors[debounced];
  const tz = timezone ?? (restored && debounced === restored.text ? restored.timezone : undefined);
  const result = useCronSchedule(debounced, { allowExtensions, hour12, nextCount: count, anchor, timezone: tz });
  useEffect(() => {
    if (result.guard && anchors[debounced] === undefined && anchorProp === undefined) {
      setAnchors((a) => ({ ...a, [debounced]: result.guard!.anchor }));
    }
  }, [result, debounced, anchors, anchorProp]);

  // keep the last good result on screen while the user is mid-sentence
  const lastGood = useRef<ParseResult | null>(result.ok ? result : null);
  if (result.ok) lastGood.current = result;
  const shown = result.ok ? result : lastGood.current;
  const [active, setActive] = useState(0);
  const crons = shown?.crons ?? [];
  const activeIdx = Math.min(active, Math.max(0, crons.length - 1));
  const fields = shown?.fields[activeIdx];

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSchedRef = useRef(onScheduleChange);
  onSchedRef.current = onScheduleChange;
  useEffect(() => {
    onChangeRef.current?.(result);
    onSchedRef.current?.(result.ok ? result.schedule : null, result);
    setActive(0);
  }, [result]);

  // ---------------------------------------------------------------- trigger
  const [armedInner, setArmedInner] = useState(defaultArmed);
  const armed = armedProp ?? armedInner;
  const setArmed = (a: boolean) => {
    if (armedProp === undefined) setArmedInner(a);
    onArmedChange?.(a);
  };
  const flash = useRef(new Animated.Value(0)).current;
  const resultRef = useRef(result);
  resultRef.current = result;
  const onTriggerRef = useRef(onTrigger);
  onTriggerRef.current = onTrigger;
  const handleFire = useCallback(
    (e: TriggerEvent) => {
      flash.setValue(1);
      Animated.timing(flash, { toValue: 0, duration: 1200, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }).start();
      onTriggerRef.current?.({ ...e, result: resultRef.current });
    },
    [flash],
  );
  const trigger = useCronTrigger(result.ok ? result.schedule : null, { enabled: armed && result.ok, onTrigger: handleFire });
  const now = useNow(true, armed && on('trigger') ? 1000 : 15_000);
  const progress = useMemo(() => {
    if (!trigger.next || !trigger.armedAt) return 0;
    const total = trigger.next.date.getTime() - trigger.armedAt;
    return total <= 0 ? 1 : Math.min(1, Math.max(0, (now - trigger.armedAt) / total));
  }, [trigger.next, trigger.armedAt, now]);

  // ---------------------------------------------------------------- actions
  const [copied, setCopied] = useState<string | null>(null);
  const share = async (what: 'cron' | 'guard' = 'cron') => {
    if (!crons.length) return;
    const message = what === 'guard' && shown?.guard ? shown.guard.crontab.join('\n') : crons.join('\n');
    try {
      if (Platform.OS === 'web') {
        // web: copy to clipboard (Web Share is often unavailable)
        await (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard?.writeText(message);
        setCopied(what);
        setTimeout(() => setCopied(null), 1400);
      } else {
        await Share.share({ message });
      }
    } catch {
      /* user cancelled / unsupported: the expression is still selectable */
    }
  };

  const status = !text.trim()
    ? S.waiting
    : thinking
      ? '…'
      : result.ok
        ? fill(S.understoodIn, { ms: Math.max(1, Math.round(result.elapsedMs)) })
        : S.notUnderstood;
  const notes = shown ? notesFor(mode, shown, S) : [];
  const roleLabels = { interval: S.roleInterval, time: S.roleTime, day: S.roleDay, month: S.roleMonth, except: S.roleExcept };
  const g = shown?.guard;
  const label = (t: string) => t.toUpperCase();

  return (
    <View
      testID={testID}
      style={[
        styles.card,
        {
          backgroundColor: c.surface,
          borderColor: c.border,
          borderRadius: theme.radius.xl,
          boxShadow: theme.dark ? `0 20px 50px -20px ${c.shadow}cc` : `0 18px 40px -22px ${c.shadow}66`,
        },
        style,
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderRadius: theme.radius.xl, borderWidth: 2, borderColor: c.success, opacity: flash }]}
      />

      {/* Header */}
      {(on('badge') || on('title') || (on('themes') && onThemeChange)) && (
        <View style={{ gap: 8 }}>
          {on('badge') && (
            <View style={[styles.badge, { backgroundColor: c.accentSoft, borderRadius: theme.radius.xl }]}>
              <PulseDot color={c.accent} size={6} />
              <Text style={[styles.badgeText, { color: c.accent, fontFamily: theme.fonts.body }]}>
                {fill(S.badge, { model: MODEL_INFO.name })} · {Math.round(MODEL_INFO.params / 1000)}k params
              </Text>
            </View>
          )}
          <View style={styles.headerRow}>
            {on('title') && (
              <Text accessibilityRole="header" style={[styles.title, { color: c.text, fontFamily: theme.fonts.body }]}>
                {S.heading}
              </Text>
            )}
            {on('themes') && onThemeChange && <ThemePicker current={theme.name} onChange={onThemeChange} theme={theme} />}
          </View>
        </View>
      )}

      {/* Input */}
      {on('input') && (
        <View style={[styles.inputBox, { backgroundColor: c.surfaceAlt, borderColor: thinking ? c.accent : c.border, borderRadius: theme.radius.lg }]}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={S.placeholder}
            placeholderTextColor={c.textFaint}
            multiline
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel={S.inputLabel}
            selectionColor={c.accent}
            style={[styles.input, { color: c.text, fontFamily: theme.fonts.body }]}
          />
          {on('status') && (
            <View style={styles.inputFooter}>
              <ThinkingDots color={c.accent} active={thinking} />
              <Text style={[styles.status, { color: result.ok || thinking ? c.textMuted : c.warning, fontFamily: theme.fonts.body }]}>{status}</Text>
              {!!text && (
                <Pressable onPress={() => setText('')} hitSlop={8} accessibilityRole="button" accessibilityLabel={S.clear}>
                  <Text style={{ color: c.textFaint, fontSize: 13, fontFamily: theme.fonts.body }}>{S.clear}</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      )}

      {/* What the model understood */}
      {on('chips') && result.pieces.length > 0 && result.source === 'natural' && (
        <View style={{ gap: 8 }}>
          <Text style={[styles.section, { color: c.textFaint, fontFamily: theme.fonts.body }]}>{label(S.understood)}</Text>
          <Understanding pieces={result.pieces} theme={theme} labels={roleLabels} />
        </View>
      )}
      {!result.ok && !thinking && !!text.trim() && <Notes items={[user ? S.notUnderstood : result.error ?? S.notUnderstood]} kind="error" theme={theme} />}

      {/* Result */}
      {shown && fields && (
        <View style={{ gap: 12, opacity: result.ok ? 1 : 0.45 }}>
          {crons.length > 1 && (on('tiles') || on('cron')) && (
            <View style={styles.tabs}>
              <Text style={[styles.section, { color: c.textFaint, fontFamily: theme.fonts.body, marginRight: 4 }]}>
                {label(fill(S.cronLines, { n: crons.length }))}
              </Text>
              {on('tiles') && crons.map((_, i) => <Pill key={i} label={`#${i + 1}`} active={i === activeIdx} onPress={() => setActive(i)} theme={theme} />)}
            </View>
          )}
          {on('tiles') && (
            <View style={styles.tiles}>
              {FIELD_ORDER.map((f, i) => (
                <FieldTile key={f} label={FIELD_META[f].short} value={fields[f]} color={c.fields[i]} theme={theme} index={i} />
              ))}
            </View>
          )}
          {(on('cron') || on('copy')) && (
            <View style={[styles.exprRow, { backgroundColor: c.background, borderRadius: theme.radius.md, borderColor: c.border }]}>
              {on('cron') ? (
                <Text selectable numberOfLines={crons.length > 1 ? crons.length : 1} style={[styles.expr, { color: c.text, fontFamily: theme.fonts.mono }]}>
                  {crons.join('\n')}
                </Text>
              ) : (
                <View style={{ flex: 1 }} />
              )}
              {on('copy') && (
                <Pill label={Platform.OS === 'web' ? (copied === 'cron' ? S.copied : S.copy) : S.share} onPress={() => share('cron')} theme={theme} active={copied === 'cron'} />
              )}
            </View>
          )}
          {on('guard') && g && (
            <View style={[styles.guardBox, { borderColor: c.fields[4], backgroundColor: c.surfaceAlt, borderRadius: theme.radius.md }]}>
              <View style={styles.guardHead}>
                <Text style={[styles.section, { color: c.fields[4], fontFamily: theme.fonts.body, flex: 1 }]}>
                  {label(g.everyWeeks === 2 ? S.everyOtherWeek : fill(S.everyNWeeks, { n: g.everyWeeks }))}
                  {g.startsOn ? ` · ${label(fill(S.from, { date: formatRun(g.startsOn, hour12, tz) }))}` : ''}
                </Text>
                {on('copy') && (
                  <Pill label={Platform.OS === 'web' ? (copied === 'guard' ? S.copied : S.copyLine) : S.share} onPress={() => share('guard')} theme={theme} active={copied === 'guard'} />
                )}
              </View>
              <Text style={[styles.guardText, { color: c.textMuted, fontFamily: theme.fonts.body }]}>{S.guardText}</Text>
              <Text selectable style={[styles.guardCode, { color: c.text, fontFamily: theme.fonts.mono }]}>
                {on('cron') ? g.crontab.join('\n') : fill(S.guardLine, { nth: ordinal(g.everyWeeks), n: g.everyWeeks })}
              </Text>
            </View>
          )}
          {on('notes') && !user && on('guard') && shown.alternatives.length > 0 && (
            <Notes items={shown.alternatives.map((a) => `${a.cron}  ·  ${a.description}`)} kind="assumption" theme={theme} />
          )}
          {on('description') && (
            <Text style={[styles.description, user && styles.descriptionUser, { color: c.text, fontFamily: theme.fonts.body }]}>{shown.description}</Text>
          )}
          {on('confidence') && <ConfidenceMeter value={result.ok ? result.confidence : 0} theme={theme} />}
          {on('notes') && <Notes items={notes.filter((n) => n.warn).map((n) => n.text)} kind="warning" theme={theme} />}
          {on('notes') && <Notes items={notes.filter((n) => !n.warn).map((n) => n.text)} kind="assumption" theme={theme} />}
          {on('timezone') && (
            <Text style={[styles.status, { color: c.textFaint, fontFamily: theme.fonts.body }]}>{fill(S.timezone, { tz: shown.timezone.replace(/_/g, ' ') })}</Text>
          )}
        </View>
      )}

      {/* Next runs */}
      {on('runs') && shown && shown.nextRuns.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text style={[styles.section, { color: c.textFaint, fontFamily: theme.fonts.body }]}>{label(count > 1 ? S.nextRuns : S.nextRun)}</Text>
          <NextRuns runs={shown.nextRuns} theme={theme} hour12={hour12} now={now} multi={crons} tz={tz} showLine={!user} />
        </View>
      )}

      {/* Trigger */}
      {on('trigger') && (
        <View style={[styles.triggerBox, { borderColor: armed ? c.accent : c.border, backgroundColor: armed ? c.accentSoft : c.surfaceAlt, borderRadius: theme.radius.lg }]}>
          <View style={styles.triggerHead}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.triggerTitle, { color: c.text, fontFamily: theme.fonts.body }]}>{armed ? S.triggerArmed : S.trigger}</Text>
              <Text style={[styles.status, { color: c.textMuted, fontFamily: theme.fonts.body }]}>
                {armed && trigger.next ? fill(S.nextFire, { date: formatRun(trigger.next.date, hour12, tz) }) : S.triggerHint}
              </Text>
            </View>
            <Switch
              value={armed}
              onValueChange={setArmed}
              disabled={!result.ok}
              trackColor={{ false: c.border, true: c.accent }}
              thumbColor={armed ? c.onAccent : c.surface}
              {...({ activeThumbColor: c.onAccent } as object)}
              accessibilityLabel={S.trigger}
            />
          </View>
          {armed && trigger.next && (
            <View style={{ gap: 8 }}>
              <Text style={[styles.countdown, { color: c.accent, fontFamily: theme.fonts.mono }]}>{countdown(trigger.next.date, now)}</Text>
              <View style={[styles.progressTrack, { backgroundColor: c.border }]}>
                <View style={{ width: `${progress * 100}%`, height: '100%', backgroundColor: c.accent, borderRadius: 99 }} />
              </View>
            </View>
          )}
          {trigger.fired.length > 0 && (
            <Text style={[styles.status, { color: c.success, fontFamily: theme.fonts.body }]}>
              {fill(S.fired, { n: trigger.fired.length, date: formatRun(trigger.fired[0].date, hour12, tz) })}
            </Text>
          )}
        </View>
      )}

      {/* Examples */}
      {on('examples') && exampleList.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={[styles.section, { color: c.textFaint, fontFamily: theme.fonts.body }]}>{label(S.try)}</Text>
          <Examples items={exampleList} onPick={setText} theme={theme} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 18, gap: 18, borderWidth: 1, overflow: 'hidden' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 },
  badge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, paddingRight: 10, paddingLeft: 4, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  inputBox: { borderWidth: 1.5, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10, gap: 6 },
  input: { fontSize: 18, lineHeight: 25, minHeight: 52, padding: 0, textAlignVertical: 'top', outlineStyle: 'none' } as object,
  inputFooter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  status: { fontSize: 12, flex: 1 },
  section: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.4 },
  tabs: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  tiles: { flexDirection: 'row', gap: 6 },
  exprRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1 },
  expr: { flex: 1, fontSize: 15, fontWeight: '600', lineHeight: 22 },
  description: { fontSize: 15.5, lineHeight: 22, fontWeight: '500' },
  descriptionUser: { fontSize: 18, lineHeight: 25, fontWeight: '700' },
  guardBox: { borderWidth: 1, borderLeftWidth: 3, padding: 12, gap: 6 },
  guardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  guardText: { fontSize: 12.5, lineHeight: 18 },
  guardCode: { fontSize: 12, lineHeight: 18 },
  triggerBox: { borderWidth: 1, padding: 14, gap: 10 },
  triggerHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  triggerTitle: { fontSize: 15, fontWeight: '700' },
  countdown: { fontSize: 28, fontWeight: '700', letterSpacing: 1 },
  progressTrack: { height: 4, borderRadius: 99, overflow: 'hidden' },
});

export default CronTrigger;
