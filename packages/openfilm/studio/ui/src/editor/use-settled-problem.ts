import { useEffect, useState } from 'react';

/** Give an outside writer time to finish. A new failure or an agent at work restarts the grace period. */
const GRACE_MS = 2000;

export function useSettledProblem(problem: string | null, waiting: boolean): boolean {
  const [settled, setSettled] = useState<string | null>(null);
  useEffect(() => {
    setSettled(null);
    if (problem === null || waiting) return;
    const timer = setTimeout(() => setSettled(problem), GRACE_MS);
    return () => clearTimeout(timer);
  }, [problem, waiting]);
  return problem !== null && !waiting && settled === problem;
}
