// The current time, renewed every `intervalMs`: relative times ("5m") stay true while nothing else
// re-renders.

import { useEffect, useState } from "react";

export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
