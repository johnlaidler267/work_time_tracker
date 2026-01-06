import { useState } from "react";

export default function TimeAccumulator() {
  const [minutes, setMinutes] = useState(0);

  const addMinutes = (amount: number) => {
    setMinutes(m => m + amount);
  };

  const reset = () => setMinutes(0);

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  return (
    <div className="flex items-center justify-center min-h-screen bg-neutral-100">
      <div className="w-80 rounded-2xl bg-white shadow-sm p-6 flex flex-col gap-6">
        <div className="text-center">
          <div className="text-4xl font-semibold tabular-nums">
            {hours}h {mins}m
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
      </div>
    </div>
  );
}

