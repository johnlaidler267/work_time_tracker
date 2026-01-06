import { useState, useEffect } from "react";

const STORAGE_KEY = "workTimeMinutes";
const DAILY_STORAGE_KEY = "workTimeDaily";
const LAST_DATE_KEY = "workTimeLastDate";

// Get today's date as YYYY-MM-DD string
const getTodayString = () => {
  const today = new Date();
  return today.toISOString().split('T')[0];
};

// Get the last 7 days as date strings
const getLast7Days = () => {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    days.push(date.toISOString().split('T')[0]);
  }
  return days;
};

// Get day name abbreviation
const getDayName = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { weekday: 'short' });
};

export default function TimeAccumulator() {
  // Load initial value from localStorage
  const [minutes, setMinutes] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? parseInt(saved, 10) : 0;
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
        const last7Days = getLast7Days();
        const filtered: Record<string, number> = {};
        last7Days.forEach(day => {
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

  // Save to localStorage whenever minutes changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, minutes.toString());
  }, [minutes]);

  // Save daily totals to localStorage
  useEffect(() => {
    localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(dailyTotals));
  }, [dailyTotals]);

  // Check if it's a new day and reset daily tracking
  useEffect(() => {
    const today = getTodayString();
    const lastDate = localStorage.getItem(LAST_DATE_KEY);
    if (lastDate !== today) {
      const last7Days = getLast7Days();
      const filtered: Record<string, number> = {};
      last7Days.forEach(day => {
        if (dailyTotals[day] !== undefined) {
          filtered[day] = dailyTotals[day];
        }
      });
      filtered[today] = 0;
      localStorage.setItem(LAST_DATE_KEY, today);
      setDailyTotals(filtered);
    }
  }, [dailyTotals]);

  const addMinutes = (amount: number) => {
    setMinutes(m => m + amount);
    const today = getTodayString();
    setDailyTotals(prev => ({
      ...prev,
      [today]: (prev[today] || 0) + amount,
    }));
  };

  const adjustMinutes = (amount: number) => {
    if (minutes + amount < 0) return; // Prevent negative time
    addMinutes(amount);
  };

  const reset = () => {
    setMinutes(0);
    localStorage.removeItem(STORAGE_KEY);
    const today = getTodayString();
    setDailyTotals({ [today]: 0 });
    localStorage.setItem(LAST_DATE_KEY, today);
  };

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  // Get weekly data for display
  const weeklyData = getLast7Days().map(date => ({
    date,
    dayName: getDayName(date),
    minutes: dailyTotals[date] || 0,
    isToday: date === getTodayString(),
  }));

  // Find max minutes for scaling the bars
  const maxMinutes = Math.max(...weeklyData.map(d => d.minutes), 1);

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
                className="text-neutral-400 hover:text-neutral-600 active:text-neutral-900 transition-colors p-0.5 rounded hover:bg-neutral-100 active:scale-95"
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
                className="text-neutral-400 hover:text-neutral-600 active:text-neutral-900 transition-colors p-0.5 rounded hover:bg-neutral-100 active:scale-95"
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
            className="rounded-xl bg-neutral-900 text-white py-3 text-sm font-medium active:scale-95 transition"
          >
            +10 min
          </button>
          <button
            onClick={() => addMinutes(25)}
            className="rounded-xl bg-neutral-900 text-white py-3 text-sm font-medium active:scale-95 transition"
          >
            +25 min
          </button>
        </div>

        <button
          onClick={reset}
          className="rounded-xl border border-neutral-200 py-2 text-sm text-neutral-600 hover:bg-neutral-50 active:scale-95 transition"
        >
          Reset
        </button>

        {/* Weekly Daily Time Indicator */}
        <div className="pt-4 border-t border-neutral-100">
          <div className="text-xs font-medium text-neutral-500 mb-3 text-center">
            This Week
          </div>
          <div className="flex items-end justify-between gap-1.5">
            {weeklyData.map(({ date, dayName, minutes, isToday }) => {
              const heightPercent = (minutes / maxMinutes) * 100;
              const hours = Math.floor(minutes / 60);
              const mins = minutes % 60;
              
              return (
                <div key={date} className="flex-1 flex flex-col items-center gap-1.5">
                  <div className="w-full flex flex-col items-center gap-1">
                    <div
                      className={`w-full rounded-t transition-all ${
                        isToday ? 'bg-neutral-900' : 'bg-neutral-200'
                      }`}
                      style={{ height: `${Math.max(heightPercent, 4)}%`, minHeight: '4px' }}
                      title={`${dayName}: ${hours}h ${mins}m`}
                    />
                    <div className={`text-[10px] font-medium ${
                      isToday ? 'text-neutral-900' : 'text-neutral-400'
                    }`}>
                      {hours > 0 ? `${hours}h ${mins}m` : mins > 0 ? `${mins}m` : ''}
                    </div>
                  </div>
                  <div className={`text-[10px] ${
                    isToday ? 'text-neutral-900 font-semibold' : 'text-neutral-400'
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

