'use client';

import { useCallback, useRef } from 'react';

/**
 * Roving-tabindex keyboard support for an ARIA radiogroup.
 *
 * Native radio semantics: only the checked option is in the tab order, arrow
 * keys move focus *and* selection, Home/End jump to the ends. This is what
 * screen-reader and keyboard users expect from `role="radiogroup"`, and it
 * avoids every option being a separate tab stop.
 */
export function useRadioGroup(count: number) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const register = useCallback(
    (index: number) => (el: HTMLButtonElement | null) => {
      refs.current[index] = el;
    },
    [],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent, activeIndex: number, select: (index: number) => void) => {
      const last = count - 1;
      let next: number | null = null;

      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          next = activeIndex >= last ? 0 : activeIndex + 1;
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          next = activeIndex <= 0 ? last : activeIndex - 1;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = last;
          break;
        case ' ':
        case 'Enter':
          // A button already fires click, so only prevent the scroll that a
          // space keypress would otherwise cause.
          if (event.key === ' ') event.preventDefault();
          select(activeIndex);
          return;
        default:
          return;
      }

      event.preventDefault();
      select(next);
      refs.current[next]?.focus();
    },
    [count],
  );

  return { register, onKeyDown };
}