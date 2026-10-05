// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-05

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

interface UnitSelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

interface UnitSelectProps<T extends string> {
  readonly options: readonly UnitSelectOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  /** The control's accessible name. */
  readonly label: string;
}

/** Vertical gap, in CSS pixels, between the button's bottom edge and the list below it. */
const LIST_GAP_PX = 4;

const CLOSED = { open: false, rect: null, suggestions: [], selectedIndex: 0 } as const;

/**
 * A dropdown whose open list is drawn by the address-bar suggestions
 * overlay, in its "menu" variant, rather than by this component. It can't be
 * chrome HTML: the tab beneath the toolbar is a native view that paints
 * above the chrome, so a list opening downward would be hidden behind the
 * History page (the reason `SuggestionsOverlay` exists). And it can't be a
 * native `<select>`, whose open list is the system's blue and ignores the
 * app's accent color. So this owns the button and the keyboard handling,
 * measures where the list belongs, and pushes it down with
 * `syncAddressSuggestions`; a row clicked in the overlay comes back by index
 * (`onAddressSuggestionSelected`), the same round trip the address bar uses.
 *
 * Opens on click or the arrow keys; Up/Down/Home/End move the highlight,
 * Enter or Space chooses, Escape or the button losing focus closes. Focus
 * stays on the button throughout.
 */
export function UnitSelect<T extends string>({ options, value, onChange, label }: UnitSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selectedLabel = options[selectedIndex]?.label ?? '';

  // Pushes the list's state to the overlay on every change: where it sits, which row the keyboard is on.
  useEffect(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!isOpen || !rect) {
      window.northstar.syncAddressSuggestions({ ...CLOSED });
      return;
    }
    window.northstar.syncAddressSuggestions({
      variant: 'menu',
      open: true,
      rect: { top: rect.bottom + LIST_GAP_PX, left: rect.left, width: rect.width },
      suggestions: options.map((option) => ({ id: option.value, title: option.label, url: '' })),
      selectedIndex: activeIndex,
    });
  }, [isOpen, activeIndex, options]);

  // A tab switch while open skips straight to unmount, so close the overlay here too.
  useEffect(
    () => () => {
      window.northstar.syncAddressSuggestions({ ...CLOSED });
    },
    [],
  );

  const choose = (index: number): void => {
    const option = options[index];
    if (option) {
      onChange(option.value);
    }
    setIsOpen(false);
  };

  // A row clicked in the overlay reports back by index. Re-subscribed as the options change so it resolves against the list actually shown.
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    return window.northstar.onAddressSuggestionSelected(choose);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `choose` only closes over `options` and a stable `onChange`; re-subscribing on every render would buy nothing.
  }, [isOpen, options]);

  const open = (): void => {
    setActiveIndex(selectedIndex);
    setIsOpen(true);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'Escape') {
      if (isOpen) {
        // Closes the list only; the chrome-level Escape handling is for tools.
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(false);
      }
      return;
    }
    if (!isOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        open();
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(activeIndex);
    }
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      className="history-toolbar__unit"
      role="combobox"
      aria-label={label}
      aria-haspopup="listbox"
      aria-expanded={isOpen}
      data-value={value}
      onClick={() => (isOpen ? setIsOpen(false) : open())}
      // A click on a row lands in the overlay's own view, which takes focus; its `select` message has already
      // reached us by then (it's sent on mousedown), so closing here is safe.
      onBlur={() => setIsOpen(false)}
      onKeyDown={handleKeyDown}
    >
      <span>{selectedLabel}</span>
      <svg className="history-toolbar__unit-chevron" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
        <path
          d="M2 4.2 6 8l4-3.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
