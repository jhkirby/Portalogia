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

/**
 * A dropdown drawn in the page instead of a native `<select>`. A native
 * select's open list is an OS widget: its highlighted row is the system's
 * blue, which no stylesheet can change, so it ignored the app's accent
 * color. This one paints the highlight with the same accent-derived
 * `--color-selection-bg` the address bar's suggestions use.
 *
 * Opens on click, Enter, Space or the arrow keys; Up/Down/Home/End move the
 * highlight, Enter or Space chooses it, Escape or a click elsewhere closes
 * it. Focus stays on the button throughout (`aria-activedescendant` points
 * at the highlighted row), so the keyboard never leaves it.
 */
export function UnitSelect<T extends string>({ options, value, onChange, label }: UnitSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selectedLabel = options[selectedIndex]?.label ?? '';

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const closeOnOutsidePress = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePress);
  }, [isOpen]);

  const open = (): void => {
    setActiveIndex(selectedIndex);
    setIsOpen(true);
  };

  const choose = (index: number): void => {
    const option = options[index];
    if (option) {
      onChange(option.value);
    }
    setIsOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'Escape') {
      if (isOpen) {
        event.preventDefault();
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
    <div ref={rootRef} className="history__unit-wrap">
      <button
        type="button"
        className="history__unit"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls="history-unit-list"
        aria-activedescendant={isOpen ? `history-unit-option-${activeIndex}` : undefined}
        data-value={value}
        onClick={() => (isOpen ? setIsOpen(false) : open())}
        onKeyDown={handleKeyDown}
      >
        <span>{selectedLabel}</span>
        <svg className="history__unit-chevron" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
          <path d="M2 4.2 6 8l4-3.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {isOpen && (
        <ul id="history-unit-list" className="history__unit-list" role="listbox" aria-label={label}>
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`history-unit-option-${index}`}
              role="option"
              aria-selected={option.value === value}
              className={`history__unit-option${index === activeIndex ? ' history__unit-option--active' : ''}`}
              // Pressing a row mustn't take focus off the button, or the keyboard handling above would stop hearing.
              onMouseDown={(event) => event.preventDefault()}
              // Movement, not entry: a list that opens under a resting pointer must not steal the keyboard's highlight.
              onMouseMove={() => setActiveIndex(index)}
              onClick={() => choose(index)}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
