import { useState, useEffect } from "react";

const STORAGE_KEY = "workTimeMinutes";
const DAILY_STORAGE_KEY = "workTimeDaily";
const LAST_DATE_KEY = "workTimeLastDate";
const WEEKLY_TOTALS_KEY = "workTimeWeekly";
const LAST_WEEK_KEY = "workTimeLastWeek";

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

// Get day name abbreviation
const getDayName = (dateString: string) => {
  const date = parseLocalDate(dateString);
  return date.toLocaleDateString('en-US', { weekday: 'short' });
};

export default function TimeAccumulator() {
  // Track which day is being viewed (0 = today, -1 = yesterday, 1 = tomorrow, etc.)
  const [dayOffset, setDayOffset] = useState(0);

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

  // Load and manage daily totals
  const [dailyTotals, setDailyTotals] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem(DAILY_STORAGE_KEY);
    const lastDate = localStorage.getItem(LAST_DATE_KEY);
    const today = getTodayString();
    
    if (saved && lastDate) {
      const parsed = JSON.parse(saved);
      // Check if we need to reset today's total (new day)
      if (lastDate !== today) {
        // Keep only the last 7 days
        const weekDays = getWeekForDate(today);
        const filtered: Record<string, number> = {};
        weekDays.forEach(day => {
          if (parsed[day] !== undefined) {
            filtered[day] = parsed[day];
          }
        });
        filtered[today] = 0;
        localStorage.setItem(LAST_DATE_KEY, today);
        return filtered;
      }
      return parsed;
    }
    localStorage.setItem(LAST_DATE_KEY, today);
    return { [today]: 0 };
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
      // New week - clean up old weeks (keep last 4 weeks)
      const allWeekKeys = Object.keys(weeklyTotals).sort();
      const weeksToKeep = allWeekKeys.slice(-4);
      const filtered: Record<string, number> = {};
      weeksToKeep.forEach(key => {
        filtered[key] = weeklyTotals[key];
      });
      filtered[currentWeekKey] = 0;
      setWeeklyTotals(filtered);
      localStorage.setItem(LAST_WEEK_KEY, currentWeekKey);
    }
  }, [weeklyTotals]);

  // Save daily totals to localStorage
  useEffect(() => {
    localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(dailyTotals));
  }, [dailyTotals]);

  // Check if it's a new day and reset daily tracking
  useEffect(() => {
    const today = getTodayString();
    const lastDate = localStorage.getItem(LAST_DATE_KEY);
    if (lastDate !== today) {
      const weekDays = getWeekForDate(today);
      const filtered: Record<string, number> = {};
      weekDays.forEach(day => {
        if (dailyTotals[day] !== undefined) {
          filtered[day] = dailyTotals[day];
        }
      });
      filtered[today] = 0;
      localStorage.setItem(LAST_DATE_KEY, today);
      setDailyTotals(filtered);
      
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
  }, [dailyTotals]);

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

  const addMinutes = (amount: number) => {
    const today = getTodayString();
    const currentWeekKey = getWeekKey(today);
    
    // Update daily total
    setDailyTotals(prev => ({
      ...prev,
      [today]: (prev[today] || 0) + amount,
    }));
    
    // Update weekly total
    setWeeklyTotals(prev => ({
      ...prev,
      [currentWeekKey]: (prev[currentWeekKey] || 0) + amount,
    }));
  };

  const adjustMinutes = (amount: number) => {
    if (minutes + amount < 0) return; // Prevent negative time
    addMinutes(amount);
  };

  const reset = () => {
    const today = getTodayString();
    const currentWeekKey = getWeekKey(today);
    
    // Reset today's daily total
    setDailyTotals(prev => ({
      ...prev,
      [today]: 0,
    }));
    
    // Reset current week's total
    setWeeklyTotals(prev => ({
      ...prev,
      [currentWeekKey]: 0,
    }));
    
    localStorage.setItem(LAST_DATE_KEY, today);
  };

  // Get the currently viewed date
  const viewedDate = getDateOffset(dayOffset);
  const today = getTodayString();
  const viewedWeekKey = getWeekKey(viewedDate);
  const currentWeekKey = getWeekKey(today);
  
  // Calculate total for the viewed week from daily totals
  const viewedWeekDays = getWeekForDate(viewedDate);
  const viewedWeekTotal = viewedWeekDays.reduce((sum, date) => {
    return sum + (dailyTotals[date] || 0);
  }, 0);
  
  // For the current week, always calculate from daily totals for accuracy
  // For past weeks, use stored total if available, otherwise calculate from daily totals
  const displayedMinutes = (viewedWeekKey === currentWeekKey) 
    ? viewedWeekTotal 
    : (weeklyTotals[viewedWeekKey] !== undefined ? weeklyTotals[viewedWeekKey] : viewedWeekTotal);

  const hours = Math.floor(displayedMinutes / 60);
  const mins = displayedMinutes % 60;

  // Get weekly data for display (week containing the viewed date)
  const weeklyData = getWeekForDate(viewedDate).map(date => ({
    date,
    dayName: getDayName(date),
    minutes: dailyTotals[date] || 0,
    isToday: date === today,
    isViewed: date === viewedDate,
  }));

  // Find max minutes for scaling the bars
  const maxMinutes = Math.max(...weeklyData.map(d => d.minutes), 1);

  const navigateDay = (direction: number) => {
    setDayOffset(prev => prev + direction);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-neutral-100">
      <div className="w-80 rounded-2xl bg-white shadow-sm p-6 flex flex-col gap-6">
        <div className="text-center">
          <div className="flex items-center justify-center gap-2">
            <div className="text-4xl font-semibold tabular-nums">
              {hours}h {mins}m
            </div>
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => adjustMinutes(1)}
                disabled={dayOffset !== 0}
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
                onClick={() => adjustMinutes(-1)}
                disabled={dayOffset !== 0}
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
          </div>
          <div className="text-sm text-neutral-500 mt-1">Total Time</div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => addMinutes(10)}
            disabled={dayOffset !== 0}
            className="rounded-xl bg-neutral-900 text-white py-3 text-sm font-medium active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            +10 min
          </button>
          <button
            onClick={() => addMinutes(25)}
            disabled={dayOffset !== 0}
            className="rounded-xl bg-neutral-900 text-white py-3 text-sm font-medium active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            +25 min
          </button>
        </div>

        <button
          onClick={reset}
          disabled={dayOffset !== 0}
          className="rounded-xl border border-neutral-200 py-2 text-sm text-neutral-600 hover:bg-neutral-50 active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Reset
        </button>

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
            <div className="text-xs font-medium text-neutral-500 text-center">
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
          <div className="flex items-end justify-between gap-1.5">
            {weeklyData.map(({ date, dayName, minutes, isToday, isViewed }) => {
              const heightPercent = (minutes / maxMinutes) * 100;
              const hours = Math.floor(minutes / 60);
              const mins = minutes % 60;
              
              return (
                <div key={date} className="flex-1 flex flex-col items-center gap-1.5">
                  <div className="w-full flex flex-col items-center gap-1">
                    <div
                      className={`w-full rounded-t transition-all ${
                        isToday ? 'bg-neutral-900' : isViewed ? 'bg-neutral-700' : 'bg-neutral-200'
                      }`}
                      style={{ height: `${Math.max(heightPercent, 4)}%`, minHeight: '4px' }}
                      title={`${dayName}: ${hours}h ${mins}m`}
                    />
                    <div className={`text-[10px] font-medium ${
                      isToday ? 'text-neutral-900' : isViewed ? 'text-neutral-700' : 'text-neutral-400'
                    }`}>
                      {hours > 0 ? `${hours}h ${mins}m` : mins > 0 ? `${mins}m` : ''}
                    </div>
                  </div>
                  <div className={`text-[10px] ${
                    isToday ? 'text-neutral-900 font-semibold' : isViewed ? 'text-neutral-700 font-semibold' : 'text-neutral-400'
                  }`}>
                    {dayName}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

