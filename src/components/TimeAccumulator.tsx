import { useState, useEffect, useRef } from "react";
import confetti from "canvas-confetti";

const DAILY_STORAGE_KEY = "workTimeDaily";
const LAST_DATE_KEY = "workTimeLastDate";
const WEEKLY_TOTALS_KEY = "workTimeWeekly";
const LAST_WEEK_KEY = "workTimeLastWeek";
const DAILY_GOAL_KEY = "workTimeDailyGoal";
const USER_NAME_KEY = "workTimeUserName";
const POMODORO_VISIBLE_KEY = "workTimePomodoroVisible";
const RETENTION_WEEKS = 4;

const POMODORO_FOCUS_SECONDS = 25 * 60;
const POMODORO_SHORT_SECONDS = 5 * 60;
const POMODORO_LONG_SECONDS = 15 * 60;
const POMODORO_SOUND_KEY = "workTimePomodoroSound";
const TOP3_DAILY_KEY = "workTimeTop3Daily";
const TOP3_ARCHIVE_KEY = "workTimeTop3Archive";
const TOP3_ARCHIVE_CLEARED_KEY = "workTimeTop3ArchiveCleared";
const TIMEZONE_KEY = "workTimeTimezone";

// Top 3 tasks: one list per day (max 3 items); completed stay in list (crossed out), unchecked carry over to next day
type Top3Task = { id: string; text: string; done?: boolean };
type DailyTop3 = Record<string, Top3Task[]>;
type Top3ArchiveItem = { text: string; completedDate: string };

// Daily data with optional session timestamps for stats
export type DayEntry = { total: number; sessions: { at: string; minutes: number }[] };
type DailyData = Record<string, DayEntry>;

function getDayTotal(entry: DayEntry | number | undefined): number {
  if (entry === undefined) return 0;
  if (typeof entry === "number") return entry;
  return entry.total;
}

function toDayEntry(value: number | DayEntry): DayEntry {
  if (typeof value === "number") return { total: value, sessions: [] };
  return value;
}

function migrateDailyData(parsed: Record<string, number | DayEntry>): DailyData {
  const result: DailyData = {};
  for (const day of Object.keys(parsed)) {
    result[day] = toDayEntry(parsed[day]);
  }
  return result;
}

// Stats: minutes since midnight (local) for a given Date
function minutesSinceMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

// Get device timezone (e.g. "America/Chicago")
function getDeviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

// Minutes since midnight in a specific timezone (for work stats display)
function minutesSinceMidnightInZone(d: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(d);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const second = parseInt(parts.find((p) => p.type === "second")?.value ?? "0", 10);
  return hour * 60 + minute + second / 60;
}

// Hour of day (0–23) in a specific timezone
function getHourInZone(d: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(d);
  return parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
}

// Format minutes-since-midnight as "9:42 AM"
function formatTimeOfDay(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = Math.floor(mins % 60);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

export type WorkStats = {
  avgStartTime: string | null;
  peakWindow: string | null;
  avgEndTime: string | null;
  avgWorkDuration: string | null;
  avgDailyHours: string | null;
  hasData: boolean;
};

function computeWorkStats(dailyData: DailyData, retainedDates: string[], displayTimeZone?: string): WorkStats {
  const daysWithSessions = retainedDates.filter(date => {
    const entry = dailyData[date];
    return entry && typeof entry === "object" && "sessions" in entry && entry.sessions.length >= 1;
  });

  if (daysWithSessions.length === 0) {
    return {
      avgStartTime: null,
      peakWindow: null,
      avgEndTime: null,
      avgWorkDuration: null,
      avgDailyHours: null,
      hasData: false,
    };
  }

  const tz = displayTimeZone ?? getDeviceTimezone();
  const minsSinceMidnight = (d: Date) => (displayTimeZone ? minutesSinceMidnightInZone(d, tz) : minutesSinceMidnight(d));
  const hourFor = (d: Date) => (displayTimeZone ? getHourInZone(d, tz) : d.getHours());

  let sumStartMins = 0;
  let sumEndMins = 0;
  let sumDurationMs = 0;
  let sumDailyMinutes = 0;
  const hourBuckets: Record<number, number> = {};

  for (const date of daysWithSessions) {
    const entry = dailyData[date] as DayEntry;
    const sessions = [...entry.sessions].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    const first = sessions[0];
    const last = sessions[sessions.length - 1];
    const startMs = new Date(first.at).getTime() - first.minutes * 60 * 1000;
    const endMs = new Date(last.at).getTime();
    const startDate = new Date(startMs);
    const endDate = new Date(endMs);
    sumStartMins += minsSinceMidnight(startDate);
    sumEndMins += minsSinceMidnight(endDate);
    sumDurationMs += endMs - startMs;
    sumDailyMinutes += entry.total;

    for (const s of sessions) {
      const d = new Date(s.at);
      const hour = hourFor(d);
      hourBuckets[hour] = (hourBuckets[hour] ?? 0) + s.minutes;
    }
  }

  const n = daysWithSessions.length;
  const avgStartMins = sumStartMins / n;
  const avgEndMins = sumEndMins / n;
  const avgDurationMs = sumDurationMs / n;
  const avgDailyMins = sumDailyMinutes / n;

  let peakHour = 0;
  let maxMins = 0;
  for (let h = 0; h < 24; h++) {
    const m = hourBuckets[h] ?? 0;
    if (m > maxMins) {
      maxMins = m;
      peakHour = h;
    }
  }
  const peakEndHour = (peakHour + 2) % 24;
  const peakWindow =
    maxMins > 0
      ? `${formatTimeOfDay(peakHour * 60)} – ${formatTimeOfDay(peakEndHour * 60)}`
      : null;

  const formatDuration = (ms: number): string => {
    const totalMins = Math.round(ms / 60000);
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const formatHours = (mins: number): string => {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return {
    avgStartTime: formatTimeOfDay(avgStartMins),
    peakWindow,
    avgEndTime: formatTimeOfDay(avgEndMins),
    avgWorkDuration: formatDuration(avgDurationMs),
    avgDailyHours: formatHours(avgDailyMins),
    hasData: true,
  };
}

// Get today's date as YYYY-MM-DD string (local time)
const getTodayString = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Parse YYYY-MM-DD string to Date object in local time
const parseLocalDate = (dateString: string) => {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day);
};

// Format Date to YYYY-MM-DD string (local time)
const formatLocalDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Get the Sunday date of the week containing a specific date (week key)
const getWeekKey = (dateString: string) => {
  const date = parseLocalDate(dateString);
  const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
  const sunday = new Date(date);
  sunday.setDate(date.getDate() - dayOfWeek);
  return formatLocalDate(sunday);
};

// Get the week containing a specific date (Sunday to Saturday)
const getWeekForDate = (dateString: string) => {
  const date = parseLocalDate(dateString);
  const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
  const days = [];
  
  // Start from Sunday of the week
  for (let i = 0; i < 7; i++) {
    const weekDate = new Date(date);
    weekDate.setDate(date.getDate() - dayOfWeek + i);
    days.push(formatLocalDate(weekDate));
  }
  
  return days;
};

// Get date string offset by days from today
const getDateOffset = (offset: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return formatLocalDate(date);
};

// Get the week key (Sunday) for the week before the given week key
const getPreviousWeekKey = (weekKey: string) => {
  const sunday = parseLocalDate(weekKey);
  const prev = new Date(sunday);
  prev.setDate(sunday.getDate() - 7);
  return formatLocalDate(prev);
};

// Get day name abbreviation
const getDayName = (dateString: string) => {
  const date = parseLocalDate(dateString);
  return date.toLocaleDateString('en-US', { weekday: 'short' });
};

// All dates from the Sunday of numWeeks weeks ago through today (for daily retention)
const getRetainedDailyDates = (today: string, numWeeks: number): string[] => {
  const todayDate = parseLocalDate(today);
  const referenceDate = new Date(todayDate);
  referenceDate.setDate(todayDate.getDate() - numWeeks * 7);
  const startSunday = getWeekKey(formatLocalDate(referenceDate));
  const start = parseLocalDate(startSunday);
  const days: string[] = [];
  const endTime = todayDate.getTime();
  let current = new Date(start.getTime());
  while (current.getTime() <= endTime) {
    days.push(formatLocalDate(current));
    current.setDate(current.getDate() + 1);
  }
  return days;
};

export default function TimeAccumulator() {
  // Track which day is being viewed (0 = today, -1 = yesterday, 1 = tomorrow, etc.)
  const [dayOffset, setDayOffset] = useState(0);
  // When viewing a past day, allow editing that day's time
  const [isEditingPastDay, setIsEditingPastDay] = useState(false);
  // Settings panel
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Stats dashboard (expandable)
  const [statsOpen, setStatsOpen] = useState(false);
  // Left panel (Pomodoro) expandable
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  // Top 3 tasks per day (unchecked carry over; checked go to weekly archive)
  const [dailyTop3, setDailyTop3] = useState<DailyTop3>(() => {
    const saved = localStorage.getItem(TOP3_DAILY_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return {};
      }
    }
    return {};
  });
  const [top3Archive, setTop3Archive] = useState<Top3ArchiveItem[]>(() => {
    if (!localStorage.getItem(TOP3_ARCHIVE_CLEARED_KEY)) return [];
    const saved = localStorage.getItem(TOP3_ARCHIVE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return [];
      }
    }
    return [];
  });
  // User's name (for display/personalization)
  const [userName, setUserName] = useState<string>(() => localStorage.getItem(USER_NAME_KEY) ?? "");
  // Display timezone for work stats (empty = use device timezone)
  const [displayTimezone, setDisplayTimezone] = useState<string>(() => localStorage.getItem(TIMEZONE_KEY) ?? "");
  // Daily time goal in minutes (null = no goal set)
  const [dailyGoalMinutes, setDailyGoalMinutes] = useState<number | null>(() => {
    const saved = localStorage.getItem(DAILY_GOAL_KEY);
    if (saved === null || saved === "") return null;
    const n = parseInt(saved, 10);
    return Number.isNaN(n) || n < 0 ? null : n;
  });
  // Pomodoro: show in UI (persisted)
  const [showPomodoro, setShowPomodoro] = useState<boolean>(() => localStorage.getItem(POMODORO_VISIBLE_KEY) === "true");
  // Pomodoro timer state
  type PomodoroMode = "focus" | "short" | "long";
  const pomodoroDurations: Record<PomodoroMode, number> = {
    focus: POMODORO_FOCUS_SECONDS,
    short: POMODORO_SHORT_SECONDS,
    long: POMODORO_LONG_SECONDS,
  };
  const [pomodoroMode, setPomodoroMode] = useState<PomodoroMode>("focus");
  const [pomodoroSeconds, setPomodoroSeconds] = useState(POMODORO_FOCUS_SECONDS);
  const [pomodoroRunning, setPomodoroRunning] = useState(false);
  const [pomodoroSessions, setPomodoroSessions] = useState(0);
  const [pomodoroSoundOn, setPomodoroSoundOn] = useState<boolean>(() => localStorage.getItem(POMODORO_SOUND_KEY) !== "false");
  const pomodoroIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load weekly totals from localStorage
  const [weeklyTotals, setWeeklyTotals] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem(WEEKLY_TOTALS_KEY);
    const today = getTodayString();
    const currentWeekKey = getWeekKey(today);
    
    if (saved) {
      const parsed = JSON.parse(saved);
      // Initialize current week if it doesn't exist
      if (parsed[currentWeekKey] === undefined) {
        parsed[currentWeekKey] = 0;
      }
      return parsed;
    }
    
    // Initialize with current week
    return { [currentWeekKey]: 0 };
  });

  // Load and manage daily data (totals + sessions for stats)
  const [dailyData, setDailyData] = useState<DailyData>(() => {
    const saved = localStorage.getItem(DAILY_STORAGE_KEY);
    const lastDate = localStorage.getItem(LAST_DATE_KEY);
    const today = getTodayString();
    const emptyDay = (): DayEntry => ({ total: 0, sessions: [] });

    if (saved && lastDate) {
      const parsed: Record<string, number | DayEntry> = JSON.parse(saved);
      const migrated = migrateDailyData(parsed);
      if (lastDate !== today) {
        const retainedDays = getRetainedDailyDates(today, RETENTION_WEEKS);
        const filtered: DailyData = {};
        retainedDays.forEach(day => {
          if (migrated[day] !== undefined) {
            filtered[day] = migrated[day];
          }
        });
        filtered[today] = emptyDay();
        localStorage.setItem(LAST_DATE_KEY, today);
        localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(filtered));
        return filtered;
      }
      localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
    localStorage.setItem(LAST_DATE_KEY, today);
    return { [today]: emptyDay() };
  });

  // Initialize LAST_WEEK_KEY if it doesn't exist
  useEffect(() => {
    const today = getTodayString();
    const currentWeekKey = getWeekKey(today);
    if (!localStorage.getItem(LAST_WEEK_KEY)) {
      localStorage.setItem(LAST_WEEK_KEY, currentWeekKey);
    }
  }, []);

  // Save weekly totals to localStorage
  useEffect(() => {
    localStorage.setItem(WEEKLY_TOTALS_KEY, JSON.stringify(weeklyTotals));
  }, [weeklyTotals]);

  // Check if it's a new week and reset weekly tracking
  useEffect(() => {
    const today = getTodayString();
    const currentWeekKey = getWeekKey(today);
    const lastWeekKey = localStorage.getItem(LAST_WEEK_KEY);
    
    if (lastWeekKey && lastWeekKey !== currentWeekKey) {
      // New week - add current week; only trim to RETENTION_WEEKS when we have more than that
      const allWeekKeys = Object.keys(weeklyTotals).sort();
      const weeksToKeep = allWeekKeys.slice(-RETENTION_WEEKS);
      const trimmed = allWeekKeys.length > RETENTION_WEEKS;
      const filtered: Record<string, number> = {};
      weeksToKeep.forEach(key => {
        filtered[key] = weeklyTotals[key];
      });
      filtered[currentWeekKey] = weeklyTotals[currentWeekKey] ?? 0;
      // Only replace state when we actually trimmed; otherwise just add current week so we don't lose any weeks
      setWeeklyTotals(trimmed ? filtered : (prev) => ({ ...prev, [currentWeekKey]: prev[currentWeekKey] ?? 0 }));
      localStorage.setItem(LAST_WEEK_KEY, currentWeekKey);
    }
  }, [weeklyTotals]);

  // Save daily data to localStorage
  useEffect(() => {
    localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(dailyData));
  }, [dailyData]);

  // Top 3: carry over yesterday's incomplete tasks to today when starting a new day (completed stay on yesterday's list)
  const todayStr = getTodayString();
  useEffect(() => {
    const yesterday = getDateOffset(-1);
    if (dailyTop3[todayStr] === undefined && (dailyTop3[yesterday]?.length ?? 0) > 0) {
      const incomplete = (dailyTop3[yesterday] ?? []).filter((t) => !t.done);
      setDailyTop3((prev) => ({ ...prev, [todayStr]: incomplete }));
    }
  }, [todayStr, dailyTop3]);

  // One-time clear of existing archive (then persist the cleared state)
  useEffect(() => {
    if (!localStorage.getItem(TOP3_ARCHIVE_CLEARED_KEY)) {
      localStorage.removeItem(TOP3_ARCHIVE_KEY);
      localStorage.setItem(TOP3_ARCHIVE_CLEARED_KEY, "true");
      setTop3Archive([]);
    }
  }, []);

  // Save Top 3 daily and archive to localStorage
  useEffect(() => {
    localStorage.setItem(TOP3_DAILY_KEY, JSON.stringify(dailyTop3));
  }, [dailyTop3]);
  useEffect(() => {
    localStorage.setItem(TOP3_ARCHIVE_KEY, JSON.stringify(top3Archive));
  }, [top3Archive]);

  // Save user name to localStorage
  useEffect(() => {
    if (userName.trim() === "") {
      localStorage.removeItem(USER_NAME_KEY);
    } else {
      localStorage.setItem(USER_NAME_KEY, userName.trim());
    }
  }, [userName]);

  // Save display timezone to localStorage
  useEffect(() => {
    if (displayTimezone === "") {
      localStorage.removeItem(TIMEZONE_KEY);
    } else {
      localStorage.setItem(TIMEZONE_KEY, displayTimezone);
    }
  }, [displayTimezone]);

  // Save daily goal to localStorage
  useEffect(() => {
    if (dailyGoalMinutes === null) {
      localStorage.removeItem(DAILY_GOAL_KEY);
    } else {
      localStorage.setItem(DAILY_GOAL_KEY, String(dailyGoalMinutes));
    }
  }, [dailyGoalMinutes]);

  // Save Pomodoro visibility to localStorage
  useEffect(() => {
    localStorage.setItem(POMODORO_VISIBLE_KEY, showPomodoro ? "true" : "false");
  }, [showPomodoro]);

  // Save Pomodoro sound preference
  useEffect(() => {
    localStorage.setItem(POMODORO_SOUND_KEY, pomodoroSoundOn ? "true" : "false");
  }, [pomodoroSoundOn]);

  // Pomodoro: gentle alarm when session completes (Web Audio API)
  const playPomodoroAlarm = () => {
    if (!pomodoroSoundOn) return;
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    } catch {
      // ignore if AudioContext not allowed
    }
  };

  // Pomodoro: tick effect (single interval, clears on completion)
  useEffect(() => {
    if (!pomodoroRunning) {
      if (pomodoroIntervalRef.current) {
        clearInterval(pomodoroIntervalRef.current);
        pomodoroIntervalRef.current = null;
      }
      return;
    }
    pomodoroIntervalRef.current = setInterval(() => {
      setPomodoroSeconds((prev) => {
        if (prev <= 1) {
          if (pomodoroIntervalRef.current) {
            clearInterval(pomodoroIntervalRef.current);
            pomodoroIntervalRef.current = null;
          }
          playPomodoroAlarm();
          setPomodoroRunning(false);
          setPomodoroSessions((s) => s + (pomodoroMode === "focus" ? 1 : 0));
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (pomodoroIntervalRef.current) {
        clearInterval(pomodoroIntervalRef.current);
        pomodoroIntervalRef.current = null;
      }
    };
  }, [pomodoroRunning, pomodoroMode, pomodoroSoundOn]);

  const pomodoroStartPause = () => setPomodoroRunning((r) => !r);
  const pomodoroReset = () => {
    setPomodoroRunning(false);
    setPomodoroSeconds(pomodoroDurations[pomodoroMode]);
  };
  const pomodoroSelectMode = (mode: PomodoroMode) => {
    setPomodoroMode(mode);
    setPomodoroRunning(false);
    setPomodoroSeconds(pomodoroDurations[mode]);
  };

  // Show Pomodoro time remaining in the browser tab title
  useEffect(() => {
    if (!showPomodoro) {
      document.title = "Work Time Tracker";
      return;
    }
    const m = Math.floor(pomodoroSeconds / 60);
    const s = pomodoroSeconds % 60;
    const timeStr = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    document.title = `${timeStr} - Work Time Tracker`;
    return () => {
      document.title = "Work Time Tracker";
    };
  }, [showPomodoro, pomodoroSeconds]);

  // Check if it's a new day and reset daily tracking
  useEffect(() => {
    const today = getTodayString();
    const lastDate = localStorage.getItem(LAST_DATE_KEY);
    if (lastDate !== today) {
      const retainedDays = getRetainedDailyDates(today, RETENTION_WEEKS);
      const filtered: DailyData = {};
      retainedDays.forEach(day => {
        if (dailyData[day] !== undefined) {
          filtered[day] = dailyData[day];
        }
      });
      filtered[today] = { total: 0, sessions: [] };
      localStorage.setItem(LAST_DATE_KEY, today);
      setDailyData(filtered);

      // Reset weekly total if it's a new week
      const currentWeekKey = getWeekKey(today);
      const lastWeekKey = localStorage.getItem(LAST_WEEK_KEY);
      if (lastWeekKey !== currentWeekKey) {
        setWeeklyTotals(prev => ({
          ...prev,
          [currentWeekKey]: 0,
        }));
        localStorage.setItem(LAST_WEEK_KEY, currentWeekKey);
      }
    }
  }, [dailyData]);

  // Reset day offset when a new day starts
  useEffect(() => {
    const checkNewDay = () => {
      const today = getTodayString();
      const lastDate = localStorage.getItem(LAST_DATE_KEY);
      if (lastDate !== today) {
        setDayOffset(0);
      }
    };
    checkNewDay();
    // Check every minute
    const interval = setInterval(checkNewDay, 60000);
    return () => clearInterval(interval);
  }, []);

  const fireGoalConfetti = () => {
    confetti({
      particleCount: 80,
      spread: 60,
      origin: { y: 0.6 },
      colors: ["#10b981", "#34d399", "#6ee7b7", "#a7f3d0"],
    });
  };

  const addMinutes = (amount: number) => {
    const today = getTodayString();
    const currentWeekKey = getWeekKey(today);
    const entry = dailyData[today];
    const currentTotal = getDayTotal(entry);
    const nextTotal = currentTotal + amount;

    if (dailyGoalMinutes != null && dailyGoalMinutes > 0 && currentTotal < dailyGoalMinutes && nextTotal >= dailyGoalMinutes) {
      fireGoalConfetti();
    }

    setDailyData(prev => {
      const prevEntry = prev[today] ?? { total: 0, sessions: [] };
      const nextEntry: DayEntry =
        amount > 0
          ? {
              total: nextTotal,
              sessions: [...prevEntry.sessions, { at: new Date().toISOString(), minutes: amount }],
            }
          : { ...prevEntry, total: nextTotal };
      return { ...prev, [today]: nextEntry };
    });

    setWeeklyTotals(prev => ({
      ...prev,
      [currentWeekKey]: (prev[currentWeekKey] || 0) + amount,
    }));
  };

  const adjustMinutes = (amount: number) => {
    const today = getTodayString();
    const currentWeekDays = getWeekForDate(today);
    const currentWeekTotal = currentWeekDays.reduce((sum, date) => sum + getDayTotal(dailyData[date]), 0);
    if (currentWeekTotal + amount < 0) return;
    addMinutes(amount);
  };

  // Get the currently viewed date
  const viewedDate = getDateOffset(dayOffset);
  const today = getTodayString();
  const viewedWeekKey = getWeekKey(viewedDate);
  const currentWeekKey = getWeekKey(today);
  
  // Calculate total for the viewed week from daily data
  const viewedWeekDays = getWeekForDate(viewedDate);
  const viewedWeekTotal = viewedWeekDays.reduce((sum, date) => sum + getDayTotal(dailyData[date]), 0);
  
  // For the current week, always calculate from daily totals for accuracy
  // For past weeks, use stored total if available, otherwise calculate from daily totals
  const displayedMinutes = (viewedWeekKey === currentWeekKey) 
    ? viewedWeekTotal 
    : (weeklyTotals[viewedWeekKey] !== undefined ? weeklyTotals[viewedWeekKey] : viewedWeekTotal);

  const hours = Math.floor(displayedMinutes / 60);
  const mins = displayedMinutes % 60;

  // Trend vs previous week (only for completed weeks)
  const isWeekComplete = viewedWeekKey < currentWeekKey;
  const previousWeekKey = getPreviousWeekKey(viewedWeekKey);
  const previousWeekTotal = weeklyTotals[previousWeekKey] ?? getWeekForDate(previousWeekKey).reduce((sum, d) => sum + getDayTotal(dailyData[d]), 0);
  const trendDiffMinutes = isWeekComplete ? displayedMinutes - previousWeekTotal : 0;
  const trendUp = trendDiffMinutes > 0;
  const trendSame = trendDiffMinutes === 0;
  const trendDiffAbs = Math.abs(trendDiffMinutes);
  const trendDiffHours = Math.floor(trendDiffAbs / 60);
  const trendDiffMins = trendDiffAbs % 60;
  const trendLabel = trendSame ? "same" : trendDiffHours > 0 ? `${trendDiffHours}h ${trendDiffMins}m` : `${trendDiffMins}m`;

  // Get weekly data for display (week containing the viewed date)
  const weeklyData = getWeekForDate(viewedDate).map(date => ({
    date,
    dayName: getDayName(date),
    minutes: getDayTotal(dailyData[date]),
    isToday: date === today,
    isViewed: date === viewedDate,
  }));

  // Find max minutes for scaling the bars
  const maxMinutes = Math.max(...weeklyData.map(d => d.minutes), 1);

  const workStats = computeWorkStats(
    dailyData,
    getRetainedDailyDates(today, RETENTION_WEEKS),
    displayTimezone === "" ? undefined : displayTimezone
  );

  const todayTop3List = dailyTop3[today] ?? [];
  const top3Slots: (Top3Task | null)[] = [
    todayTop3List[0] ?? null,
    todayTop3List[1] ?? null,
    todayTop3List[2] ?? null,
  ];
  const updateTop3Task = (index: number, text: string) => {
    const next = [...todayTop3List];
    if (text.trim() === "") {
      next.splice(index, 1);
    } else if (next[index]) {
      next[index] = { ...next[index], text };
    } else {
      next.splice(index, 0, { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, text, done: false });
    }
    setDailyTop3((prev) => ({ ...prev, [today]: next.slice(0, 3) }));
  };
  const checkOffTop3Task = (index: number) => {
    const task = todayTop3List[index];
    if (!task || task.done) return;
    setTop3Archive((prev) => [...prev, { text: task.text, completedDate: today }]);
    setDailyTop3((prev) => {
      const list = [...(prev[today] ?? [])];
      if (list[index]) list[index] = { ...list[index], done: true };
      return { ...prev, [today]: list };
    });
  };
  const uncheckTop3Task = (index: number) => {
    const task = todayTop3List[index];
    if (!task || !task.done) return;
    setTop3Archive((prev) => {
      let idx = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].text === task.text && prev[i].completedDate === today) {
          idx = i;
          break;
        }
      }
      if (idx === -1) return prev;
      return prev.filter((_, i) => i !== idx);
    });
    setDailyTop3((prev) => {
      const list = [...(prev[today] ?? [])];
      if (list[index]) list[index] = { ...list[index], done: false };
      return { ...prev, [today]: list };
    });
  };
  const thisWeekArchive = top3Archive.filter(
    (item) => getWeekKey(item.completedDate) === currentWeekKey
  );

  const navigateDay = (direction: number) => {
    setDayOffset(prev => prev + direction);
    setIsEditingPastDay(false);
  };

  // Adjust time for a specific date (used when editing past days)
  const addMinutesForDate = (dateString: string, amount: number) => {
    const weekKey = getWeekKey(dateString);
    const currentTotal = getDayTotal(dailyData[dateString]);
    const nextTotal = currentTotal + amount;
    const today = getTodayString();

    if (dateString === today && dailyGoalMinutes != null && dailyGoalMinutes > 0 && currentTotal < dailyGoalMinutes && nextTotal >= dailyGoalMinutes) {
      fireGoalConfetti();
    }

    setDailyData(prev => {
      const prevEntry = prev[dateString] ?? { total: 0, sessions: [] };
      const nextEntry: DayEntry =
        amount > 0
          ? {
              total: nextTotal,
              sessions: [...prevEntry.sessions, { at: new Date().toISOString(), minutes: amount }],
            }
          : { ...prevEntry, total: nextTotal };
      return { ...prev, [dateString]: nextEntry };
    });

    setWeeklyTotals(prev => ({
      ...prev,
      [weekKey]: (prev[weekKey] || 0) + amount,
    }));
  };

  const adjustMinutesForDate = (dateString: string, amount: number) => {
    const current = getDayTotal(dailyData[dateString]);
    if (current + amount < 0) return;
    addMinutesForDate(dateString, amount);
  };

  const resetToday = () => {
    const today = getTodayString();
    const currentWeekKey = getWeekKey(today);
    const todayMinutes = getDayTotal(dailyData[today]);
    setDailyData(prev => ({ ...prev, [today]: { total: 0, sessions: [] } }));
    setWeeklyTotals(prev => ({ ...prev, [currentWeekKey]: (prev[currentWeekKey] || 0) - todayMinutes }));
  };

  const resetViewedDay = () => {
    const dateStr = getDateOffset(dayOffset);
    const weekKey = getWeekKey(dateStr);
    const minutes = getDayTotal(dailyData[dateStr]);
    setDailyData(prev => ({ ...prev, [dateStr]: { total: 0, sessions: [] } }));
    setWeeklyTotals(prev => ({ ...prev, [weekKey]: (prev[weekKey] || 0) - minutes }));
  };

  const canReset = dayOffset === 0 || (dayOffset < 0 && isEditingPastDay);

  const canAdjustTime = dayOffset === 0 || (dayOffset < 0 && isEditingPastDay);
  const isViewingPastDay = dayOffset < 0;

  const dailyGoalHours = dailyGoalMinutes === null ? 0 : Math.floor(dailyGoalMinutes / 60);
  const dailyGoalMins = dailyGoalMinutes === null ? 0 : dailyGoalMinutes % 60;

  const handleDailyGoalChange = (hours: number, mins: number) => {
    const total = hours * 60 + mins;
    setDailyGoalMinutes(total <= 0 ? null : total);
  };

  const hour = new Date().getHours();
  const greeting =
    hour >= 5 && hour < 12
      ? { text: "Good morning", emoji: "☀️" }
      : hour >= 12 && hour < 17
        ? { text: "Good afternoon", emoji: "🌤️" }
        : { text: "Good evening", emoji: "🌙" };
  const displayName = userName.trim() || null;
  const greetingMessage = displayName ? `${greeting.text}, ${displayName}` : `${greeting.text}!`;

  const pomodoroDisplayM = Math.floor(pomodoroSeconds / 60);
  const pomodoroDisplayS = pomodoroSeconds % 60;
  const pomodoroTotalSeconds = pomodoroDurations[pomodoroMode];
  const pomodoroProgress = 1 - pomodoroSeconds / pomodoroTotalSeconds; // 0 = full ring, 1 = empty
  const POMODORO_RING_SIZE = 120;
  const POMODORO_RING_STROKE = 6;
  const POMODORO_RING_DISPLAY_PX = 64; // fits left panel (w-48)
  const pomodoroRingRadius = (POMODORO_RING_SIZE - POMODORO_RING_STROKE) / 2;
  const pomodoroRingCircumference = 2 * Math.PI * pomodoroRingRadius;
  const pomodoroRingOffset = pomodoroRingCircumference * pomodoroProgress;

  return (
    <div className="flex items-center justify-center min-h-screen bg-neutral-100 p-24">
      <div className="fixed top-6 left-6 z-30">
        <p className="text-neutral-800 font-semibold text-base sm:text-lg" style={{ fontFamily: "'Macondo', cursive" }} aria-live="polite">
          <span aria-hidden>{greeting.emoji}</span> {greetingMessage}
        </p>
      </div>
      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        className="fixed top-6 right-6 p-3 text-neutral-400 hover:text-neutral-600 active:text-neutral-900 rounded-lg hover:bg-neutral-200/80 active:scale-95 transition-colors"
        aria-label="Settings"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-9 h-9">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      {settingsOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/20 z-40"
            aria-hidden
            onClick={() => setSettingsOpen(false)}
          />
          <div className="fixed top-0 right-0 h-full w-80 max-w-[100vw] bg-white shadow-xl z-50 flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-neutral-100">
              <h2 className="text-lg font-semibold text-neutral-900" style={{ fontFamily: "'Macondo', cursive" }}>Settings</h2>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="p-2 text-neutral-400 hover:text-neutral-600 rounded-lg hover:bg-neutral-100 transition-colors"
                aria-label="Close settings"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 flex flex-col gap-6">
              <div>
                <label htmlFor="settings-name" className="block text-sm font-medium text-neutral-700 mb-2">
                  Name
                </label>
                <input
                  id="settings-name"
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="Your name"
                  className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
                />
              </div>
              <div>
                <label htmlFor="settings-timezone" className="block text-sm font-medium text-neutral-700 mb-2">
                  Work stats timezone
                </label>
                <p className="text-xs text-neutral-500 mb-2">
                  Times in work stats (e.g. average start) are shown in this timezone
                </p>
                <select
                  id="settings-timezone"
                  value={displayTimezone}
                  onChange={(e) => setDisplayTimezone(e.target.value)}
                  className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-900 focus:border-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
                >
                  <option value="">Use device timezone</option>
                  <option value="America/New_York">Eastern (New York)</option>
                  <option value="America/Chicago">Central (Chicago / New Orleans)</option>
                  <option value="America/Denver">Mountain (Denver)</option>
                  <option value="America/Phoenix">Arizona (no DST)</option>
                  <option value="America/Los_Angeles">Pacific (Los Angeles)</option>
                  <option value="America/Anchorage">Alaska</option>
                  <option value="Pacific/Honolulu">Hawaii</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>
              <div>
                <label htmlFor="daily-goal-hours" className="block text-sm font-medium text-neutral-700 mb-2">
                  Daily time goal
                </label>
                <p className="text-xs text-neutral-500 mb-2">
                  Target amount of time you want to work per day
                </p>
                <div className="flex items-center gap-2">
                  <input
                    id="daily-goal-hours"
                    type="number"
                    min={0}
                    max={23}
                    value={dailyGoalHours}
                    onChange={(e) => {
                      const h = Math.max(0, Math.min(23, parseInt(e.target.value, 10) || 0));
                      handleDailyGoalChange(h, dailyGoalMins);
                    }}
                    className="w-16 rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-900 focus:border-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
                  />
                  <span className="text-sm text-neutral-500">h</span>
                  <input
                    id="daily-goal-mins"
                    type="number"
                    min={0}
                    max={59}
                    value={dailyGoalMins}
                    onChange={(e) => {
                      const m = Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0));
                      handleDailyGoalChange(dailyGoalHours, m);
                    }}
                    className="w-16 rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-900 focus:border-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
                  />
                  <span className="text-sm text-neutral-500">min</span>
                </div>
                <button
                  type="button"
                  onClick={() => setDailyGoalMinutes(null)}
                  className="mt-2 text-xs text-neutral-500 hover:text-neutral-700"
                >
                  Clear goal
                </button>
              </div>
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="settings-pomodoro" className="text-sm font-medium text-neutral-700">
                  Show Pomodoro
                </label>
                <button
                  id="settings-pomodoro"
                  type="button"
                  role="switch"
                  aria-checked={showPomodoro}
                  onClick={() => setShowPomodoro((v) => !v)}
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border border-neutral-200 transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-400 focus:ring-offset-2 ${
                    showPomodoro ? "bg-neutral-900" : "bg-neutral-200"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform ${
                      showPomodoro ? "translate-x-6" : "translate-x-0.5"
                    }`}
                    style={{ marginTop: 2 }}
                  />
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Time left — fixed top center so always visible (like settings gear) */}
      <div className="fixed top-6 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-0.5 text-sm tabular-nums bg-white/95 px-4 py-2.5 rounded-xl border border-neutral-200 shadow-md min-w-[200px]">
        {dailyGoalMinutes != null && dailyGoalMinutes > 0 && (viewedWeekKey === currentWeekKey || dayOffset === 0) ? (
          <>
            {dayOffset === 0 && (() => {
              const todayTotal = getDayTotal(dailyData[today]);
              const remaining = dailyGoalMinutes - todayTotal;
              const absRemaining = Math.abs(remaining);
              const rHours = Math.floor(absRemaining / 60);
              const rMins = absRemaining % 60;
              const formatted = rHours > 0 ? `${rHours}h ${rMins}m` : `${rMins}m`;
              return (
                <span className={remaining >= 0 ? 'text-neutral-700' : 'text-amber-600'}>
                  Today: {remaining >= 0 ? `${formatted} remaining` : `${formatted} over goal`}
                </span>
              );
            })()}
            {viewedWeekKey === currentWeekKey && (() => {
              const weekTargetMinutes = dailyGoalMinutes * 5;
              const currentWeekTotal = getWeekForDate(today).reduce((sum, date) => sum + getDayTotal(dailyData[date]), 0);
              const weekRemaining = weekTargetMinutes - currentWeekTotal;
              const absRemaining = Math.abs(weekRemaining);
              const rHours = Math.floor(absRemaining / 60);
              const rMins = absRemaining % 60;
              const formatted = rHours > 0 ? `${rHours}h ${rMins}m` : `${rMins}m`;
              return (
                <span className={weekRemaining >= 0 ? 'text-neutral-600' : 'text-amber-600'}>
                  Week: {weekRemaining >= 0 ? `${formatted} left` : `${formatted} over`}
                </span>
              );
            })()}
          </>
        ) : (
          <span className="text-neutral-400 text-xs">Set a daily goal in Settings to see time remaining</span>
        )}
      </div>

      <div className="flex flex-col items-center gap-6">
      <div className="relative w-96 origin-center scale-[1.75]">
        <button
          type="button"
          onClick={() => setLeftPanelOpen(prev => !prev)}
          className="absolute -left-2.5 top-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full bg-white border border-neutral-300 shadow-sm flex items-center justify-center text-neutral-500 hover:bg-neutral-50 hover:border-neutral-400 hover:text-neutral-700 active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-neutral-300 focus:ring-offset-1"
          aria-label={leftPanelOpen ? "Hide Pomodoro" : "Show Pomodoro"}
        >
          {leftPanelOpen ? (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={() => setStatsOpen(prev => !prev)}
          className="absolute -right-2.5 top-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full bg-white border border-neutral-300 shadow-sm flex items-center justify-center text-neutral-500 hover:bg-neutral-50 hover:border-neutral-400 hover:text-neutral-700 active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-neutral-300 focus:ring-offset-1"
          aria-label={statsOpen ? "Hide stats" : "Show stats"}
        >
          {statsOpen ? (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          )}
        </button>
      <div
        className="absolute top-0 h-full overflow-hidden transition-[width] duration-300 ease-out z-0 flex justify-end"
        style={{ right: "100%", width: leftPanelOpen ? 192 : 0, marginRight: leftPanelOpen ? 8 : 0 }}
        aria-hidden={!leftPanelOpen}
      >
        <div className="h-full w-48 rounded-l-2xl rounded-r-lg bg-white shadow-sm border border-r-0 border-neutral-200 overflow-hidden flex flex-col min-h-0">
          {/* Top half: Pomodoro — content + sessions bar extends to divider */}
          <div className="flex-none h-1/2 w-full flex flex-col min-h-0">
            {showPomodoro ? (
              <>
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  {/* Tabs */}
                  <div className="flex border-b border-neutral-100 shrink-0">
                    {(["focus", "short", "long"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => pomodoroSelectMode(mode)}
                        className={`flex-1 py-2 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                          pomodoroMode === mode ? "bg-red-50 text-red-600" : "text-neutral-500 hover:text-neutral-700 hover:bg-neutral-50"
                        }`}
                      >
                        {mode === "focus" ? "Focus" : mode === "short" ? "Short" : "Long"}
                      </button>
                    ))}
                  </div>
                  {/* Timer + label + controls: vertical stack, no overlap */}
                  <div className="shrink-0 flex flex-col items-center pt-4 pb-2 px-3 gap-3">
                    <div
                      className="relative flex items-center justify-center shrink-0 rounded-full"
                      style={{ width: POMODORO_RING_DISPLAY_PX, height: POMODORO_RING_DISPLAY_PX }}
                    >
                      <svg
                        width="100%"
                        height="100%"
                        viewBox={`0 0 ${POMODORO_RING_SIZE} ${POMODORO_RING_SIZE}`}
                        className="-rotate-90 block"
                        preserveAspectRatio="xMidYMid meet"
                        aria-hidden
                      >
                        <circle cx={POMODORO_RING_SIZE / 2} cy={POMODORO_RING_SIZE / 2} r={pomodoroRingRadius} fill="none" stroke="currentColor" strokeWidth={POMODORO_RING_STROKE} className="text-neutral-200" />
                        <circle cx={POMODORO_RING_SIZE / 2} cy={POMODORO_RING_SIZE / 2} r={pomodoroRingRadius} fill="none" stroke="currentColor" strokeWidth={POMODORO_RING_STROKE} strokeDasharray={pomodoroRingCircumference} strokeDashoffset={pomodoroRingOffset} strokeLinecap="round" className="text-red-500 transition-all duration-1000" />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span className="tabular-nums text-sm font-bold text-neutral-800">
                          {String(pomodoroDisplayM).padStart(2, "0")}:{String(pomodoroDisplayS).padStart(2, "0")}
                        </span>
                      </div>
                    </div>
                    <p className="text-[9px] font-medium uppercase tracking-wider text-neutral-400 text-center leading-tight" style={{ fontFamily: "'Macondo', cursive" }}>
                      {pomodoroMode === "focus" ? "Stay focused" : "Take a break"}
                    </p>
                    <div className="flex items-center justify-center gap-2">
                      <button type="button" onClick={pomodoroReset} className="p-1.5 text-neutral-500 hover:text-neutral-700 rounded-full hover:bg-neutral-100 transition-colors" aria-label="Reset">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                        </svg>
                      </button>
                      <button type="button" onClick={pomodoroStartPause} className="w-8 h-8 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white shadow transition-all active:scale-95" aria-label={pomodoroRunning ? "Pause" : `Start (${pomodoroSessions} sessions)`}>
                        {pomodoroRunning ? (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
                            <path fillRule="evenodd" d="M6.75 5.25a.75.75 0 01.75-.75H9a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H7.5a.75.75 0 01-.75-.75V5.25zm7.5 0A.75.75 0 0115 4.5h1.5a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H15a.75.75 0 01-.75-.75V5.25z" clipRule="evenodd" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 ml-0.5">
                            <path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                      <button type="button" onClick={() => setPomodoroSoundOn((v) => !v)} className="p-1.5 text-neutral-500 hover:text-neutral-700 rounded-full hover:bg-neutral-100 transition-colors" aria-label={pomodoroSoundOn ? "Sound on" : "Sound off"}>
                        {pomodoroSoundOn ? (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                            <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06z" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                            <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06zM17.78 9.22a.75.75 0 10-1.06 1.06L18.44 12l-1.72 1.72a.75.75 0 001.06 1.06l1.72-1.72 1.72 1.72a.75.75 0 101.06-1.06L19.5 12l1.72-1.72a.75.75 0 00-1.06-1.06L18.44 12l-1.72-1.72z" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center flex-1 min-h-0 p-3 text-center text-xs text-neutral-500">
                <p>Enable Pomodoro in Settings to use the timer.</p>
              </div>
            )}
          </div>
          <div className="shrink-0 w-full border-t border-neutral-200 my-2" aria-hidden />
          {/* Bottom half: Top 3 tasks */}
          <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-auto px-3 pb-3">
            <h3 className="text-xs font-semibold text-neutral-700 shrink-0" style={{ fontFamily: "'Macondo', cursive" }}>Top 3</h3>
            {[0, 1, 2].map((index) => {
              const task = top3Slots[index];
              const hasText = task && task.text.trim() !== "";
              const isDone = task?.done === true;
              const canCheckOff = hasText && !isDone;
              return (
                <div key={index} className="flex items-start gap-1.5 pl-px">
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => (canCheckOff ? checkOffTop3Task(index) : isDone ? uncheckTop3Task(index) : undefined)}
                    disabled={!canCheckOff && !isDone}
                    className={`shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors focus:outline-none focus:ring-1 focus:ring-inset focus:ring-neutral-400 ${
                      isDone
                        ? "border-emerald-400 bg-emerald-50 hover:bg-emerald-100"
                        : canCheckOff
                          ? "border-neutral-300 hover:border-neutral-400 hover:bg-neutral-50"
                          : "border-neutral-300 opacity-40 cursor-default"
                    }`}
                    aria-label={isDone ? "Mark incomplete" : canCheckOff ? `Mark "${task!.text}" done` : "Add task to enable"}
                  >
                    {isDone && (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-2.5 h-2.5 text-emerald-600">
                        <path fillRule="evenodd" d="M19.916 4.626a.75.75 0 01.208 1.04l-9 13.5a.75.75 0 01-1.154.114l-6-6a.75.75 0 011.06-1.06l5.353 5.353 8.493-12.739a.75.75 0 011.04-.208z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                  {isDone ? (
                    <span className="flex-1 min-w-0 text-xs py-0.5 text-neutral-500 line-through break-words">
                      {task.text}
                    </span>
                  ) : (
                    <input
                      type="text"
                      value={task?.text ?? ""}
                      onChange={(e) => updateTop3Task(index, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          const input = e.currentTarget;
                          const start = input.selectionStart ?? 0;
                          const end = input.selectionEnd ?? start;
                          const v = task?.text ?? "";
                          const newVal = v.slice(0, start) + " " + v.slice(end);
                          updateTop3Task(index, newVal);
                          requestAnimationFrame(() => input.setSelectionRange(start + 1, start + 1));
                        }
                      }}
                      placeholder="Add task..."
                      className="flex-1 min-w-0 text-xs py-0.5 px-1 border-0 border-b border-transparent hover:border-neutral-200 focus:border-neutral-400 focus:outline-none bg-transparent rounded placeholder:text-neutral-400"
                    />
                  )}
                </div>
              );
            })}
            {thisWeekArchive.length > 0 && (
              <>
                <div className="shrink-0 w-full border-t border-neutral-100 mt-1 pt-1.5" />
                <p className="text-[10px] font-medium text-neutral-500 shrink-0" style={{ fontFamily: "'Macondo', cursive" }}>This week</p>
                <ul className="text-[10px] text-neutral-600 space-y-0.5 overflow-auto min-h-0">
                  {thisWeekArchive.slice(-8).reverse().map((item, i) => (
                    <li key={`${item.completedDate}-${item.text}-${i}`} className="line-through break-words">
                      {item.text}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="w-96 rounded-2xl bg-white shadow-sm p-6 flex flex-col gap-6">
        <div className="text-center">
          <div className="flex items-center justify-center gap-2">
            <div className="text-4xl font-semibold tabular-nums">
              {hours}h {mins}m
            </div>
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => dayOffset === 0 ? adjustMinutes(1) : adjustMinutesForDate(viewedDate, 1)}
                disabled={!canAdjustTime}
                className="text-neutral-400 hover:text-neutral-600 active:text-neutral-900 transition-colors p-0.5 rounded hover:bg-neutral-100 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Increase by 1 minute"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  className="w-4 h-4"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4.5 15.75l7.5-7.5 7.5 7.5"
                  />
                </svg>
              </button>
              <button
                onClick={() => dayOffset === 0 ? adjustMinutes(-1) : adjustMinutesForDate(viewedDate, -1)}
                disabled={!canAdjustTime}
                className="text-neutral-400 hover:text-neutral-600 active:text-neutral-900 transition-colors p-0.5 rounded hover:bg-neutral-100 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Decrease by 1 minute"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  className="w-4 h-4"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                  />
                </svg>
              </button>
            </div>
            {isWeekComplete && (
              <div className={`flex items-center gap-1 px-2 py-0.5 text-xs font-medium tabular-nums min-w-0 overflow-visible ${
                trendSame ? "text-neutral-500" : trendUp ? "text-emerald-600" : "text-red-600"
              }`} title={`vs previous week${trendSame ? "" : trendUp ? ": +" : ": -"}${trendLabel}`}>
                {trendSame ? (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
                  </svg>
                ) : trendUp ? (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.306a11.95 11.95 0 011.414-1.414L21 3" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width={14} height={14} className="shrink-0 block" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12l7 7 7-7" />
                  </svg>
                )}
                <span>{trendSame ? "same" : (trendUp ? "+" : "-") + trendLabel}</span>
              </div>
            )}
          </div>
          <div className="text-sm text-neutral-500 mt-1" style={{ fontFamily: "'Macondo', cursive" }}>Total Time</div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => dayOffset === 0 ? addMinutes(10) : addMinutesForDate(viewedDate, 10)}
            disabled={!canAdjustTime}
            className="rounded-xl bg-neutral-900 text-white py-3 text-sm font-medium active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            +10 min
          </button>
          <button
            onClick={() => dayOffset === 0 ? addMinutes(25) : addMinutesForDate(viewedDate, 25)}
            disabled={!canAdjustTime}
            className="rounded-xl bg-neutral-900 text-white py-3 text-sm font-medium active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            +25 min
          </button>
        </div>
        <div className={`flex flex-col ${isViewingPastDay ? 'gap-1' : ''}`}>
          <button
            onClick={() => dayOffset === 0 ? resetToday() : resetViewedDay()}
            disabled={!canReset}
            className="rounded-lg border border-neutral-200 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 hover:text-neutral-700 active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Reset
          </button>
          {isViewingPastDay && (
            <button
              onClick={() => setIsEditingPastDay(prev => !prev)}
              className="rounded-lg border border-neutral-200 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 active:scale-95 transition"
            >
              {isEditingPastDay ? 'Done' : 'Edit'}
            </button>
          )}
        </div>

        {/* Weekly Daily Time Indicator */}
        <div className="pt-4 border-t border-neutral-100">
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => navigateDay(-1)}
              className="text-neutral-400 hover:text-neutral-600 active:text-neutral-900 transition-colors p-1 rounded hover:bg-neutral-100 active:scale-95"
              aria-label="Previous day"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="w-4 h-4"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 19.5L8.25 12l7.5-7.5"
                />
              </svg>
            </button>
            <div className="text-xs font-medium text-neutral-500 text-center" style={{ fontFamily: "'Macondo', cursive" }}>
              {dayOffset === 0 ? 'This Week' : dayOffset === -1 ? 'Yesterday' : dayOffset === 1 ? 'Tomorrow' : `${Math.abs(dayOffset)} ${Math.abs(dayOffset) === 1 ? 'day' : 'days'} ${dayOffset > 0 ? 'ahead' : 'ago'}`}
            </div>
            <button
              onClick={() => navigateDay(1)}
              className="text-neutral-400 hover:text-neutral-600 active:text-neutral-900 transition-colors p-1 rounded hover:bg-neutral-100 active:scale-95"
              aria-label="Next day"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="w-4 h-4"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.25 4.5l7.5 7.5-7.5 7.5"
                />
              </svg>
            </button>
          </div>
          {/* Bar chart: fixed-height row so each bar's height reflects minutes worked */}
          <div className="flex items-end justify-between gap-1.5" style={{ height: '80px' }}>
            {weeklyData.map(({ date, dayName, minutes, isToday, isViewed }, dayIndex) => {
              const heightPercent = maxMinutes > 0 ? (minutes / maxMinutes) * 100 : 0;
              const hours = Math.floor(minutes / 60);
              const mins = minutes % 60;
              const goalReached = (dailyGoalMinutes != null && dailyGoalMinutes > 0 && minutes >= dailyGoalMinutes);

              // Work week only (Mon–Fri): weekly goal = daily goal × 5, spread over remaining work days
              const weeklyGoalMinutes = (dailyGoalMinutes ?? 0) * 5;
              const isWorkDay = dayIndex >= 1 && dayIndex <= 5; // 1=Mon .. 5=Fri (0=Sun, 6=Sat)
              const minutesBeforeThisDay = isWorkDay ? weeklyData.slice(1, dayIndex).reduce((s, d) => s + d.minutes, 0) : 0;
              const daysLeftFromHere = isWorkDay ? 6 - dayIndex : 0; // Mon: 5, Tue: 4, ..., Fri: 1
              const remainingToGoal = Math.max(0, weeklyGoalMinutes - minutesBeforeThisDay);
              const minNeededThisDay = (isWorkDay && daysLeftFromHere > 0) ? Math.ceil(remainingToGoal / daysLeftFromHere) : 0;
              const minH = Math.floor(minNeededThisDay / 60);
              const minM = minNeededThisDay % 60;
              const minLabel = minNeededThisDay > 0 ? (minH > 0 ? `≥${minH}h ${minM}m` : `≥${minM}m`) : null;
              const showMinIndicator = (viewedWeekKey === currentWeekKey) && (dailyGoalMinutes != null && dailyGoalMinutes > 0) && isWorkDay && minLabel !== null;

              return (
                <div key={date} className="flex-1 min-w-0 flex flex-col items-center h-full justify-end gap-1">
                  <div className="w-full min-w-0 flex flex-col items-center flex-1 justify-end min-h-0">
                    <div
                      className={`w-full rounded-t transition-all relative flex items-center justify-center ${
                        goalReached
                          ? 'bg-emerald-500'
                          : isToday
                            ? 'bg-neutral-900'
                            : isViewed
                              ? 'bg-neutral-700'
                              : 'bg-neutral-200'
                      }`}
                      style={{
                        height: `${Math.max(heightPercent, 2)}%`,
                        minHeight: goalReached ? '20px' : minutes > 0 ? '4px' : '0',
                      }}
                      title={`${dayName}: ${hours}h ${mins}m${goalReached ? ' — goal reached' : ''}`}
                    >
                      {goalReached && (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      )}
                    </div>
                  </div>
                  <div className={`text-[10px] font-medium shrink-0 whitespace-nowrap overflow-hidden text-ellipsis max-w-full ${
                    isToday ? 'text-neutral-900' : isViewed ? 'text-neutral-700' : 'text-neutral-400'
                  }`} title={hours > 0 ? `${hours}h ${mins}m` : mins > 0 ? `${mins}m` : ''}>
                    {hours > 0 ? `${hours}h ${mins}m` : mins > 0 ? `${mins}m` : ''}
                  </div>
                  <div className={`text-[10px] shrink-0 ${
                    isToday ? 'text-neutral-900 font-semibold' : isViewed ? 'text-neutral-700 font-semibold' : 'text-neutral-400'
                  }`}>
                    {dayName}
                  </div>
                  {showMinIndicator && (
                    <div className="text-[8px] text-slate-400 font-normal italic shrink-0 whitespace-nowrap overflow-hidden text-ellipsis max-w-full" title={`Min to stay on weekly goal: ${minH > 0 ? `${minH}h ${minM}m` : `${minM}m`}`}>
                      {minLabel}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div
        className={`absolute left-full top-0 h-full overflow-hidden transition-[width] duration-300 ease-out z-0 ${statsOpen ? "w-48 ml-2" : "w-0 ml-0"}`}
        aria-hidden={!statsOpen}
      >
        <div className="w-48 h-full min-h-full rounded-r-2xl rounded-l-lg bg-white shadow-sm border border-l-0 border-neutral-200 py-3 px-3 flex flex-col min-h-0">
          <div className="shrink-0 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-1">
              <h2 className="text-xs font-semibold text-neutral-800" style={{ fontFamily: "'Macondo', cursive" }}>Work stats</h2>
              <button
                type="button"
                onClick={() => setStatsOpen(false)}
                className="text-neutral-400 hover:text-neutral-600 p-0.5 rounded hover:bg-neutral-100 transition-colors shrink-0"
                aria-label="Close stats"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {workStats.hasData ? (
              <dl className="flex flex-col gap-1.5 text-xs">
                <div className="flex justify-between gap-1">
                  <dt className="text-neutral-500 shrink-0">Start</dt>
                  <dd className="font-medium text-neutral-800 tabular-nums text-right truncate">{workStats.avgStartTime}</dd>
                </div>
                <div className="flex justify-between gap-1">
                  <dt className="text-neutral-500 shrink-0">Peak</dt>
                  <dd className="font-medium text-neutral-800 tabular-nums text-right truncate">{workStats.peakWindow}</dd>
                </div>
                <div className="flex justify-between gap-1">
                  <dt className="text-neutral-500 shrink-0">End</dt>
                  <dd className="font-medium text-neutral-800 tabular-nums text-right truncate">{workStats.avgEndTime}</dd>
                </div>
                <div className="flex justify-between gap-1">
                  <dt className="text-neutral-500 shrink-0">Span</dt>
                  <dd className="font-medium text-neutral-800 tabular-nums text-right truncate">{workStats.avgWorkDuration}</dd>
                </div>
                <div className="flex justify-between gap-1">
                  <dt className="text-neutral-500 shrink-0">Daily</dt>
                  <dd className="font-medium text-neutral-800 tabular-nums text-right truncate">{workStats.avgDailyHours}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-xs text-neutral-500">Record time for a few days to see stats.</p>
            )}
          </div>
        </div>
      </div>
      </div>
      </div>
    </div>
  );
}

