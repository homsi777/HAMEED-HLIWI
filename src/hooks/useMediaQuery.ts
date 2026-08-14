import { useEffect, useState } from 'react';

/**
 * Renders a surface for one viewport only. Using this instead of `hidden lg:block` keeps a
 * single component mounted, so a phone never carries a second fixed-position panel behind
 * the one it is showing.
 */
export const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState(() => (typeof window === 'undefined' ? false : window.matchMedia(query).matches));
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
};

export const useIsLargeScreen = () => useMediaQuery('(min-width: 1024px)');
