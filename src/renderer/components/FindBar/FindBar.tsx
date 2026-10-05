// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-05

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { DEFAULT_FIND_OPTIONS, MAX_FIND_MATCHES, type FindOptions } from '@shared/find';
import type { FindResult } from '@shared/ipc-contract';

/** How long typing must pause before a search runs — a search per keystroke is wasted work on a big page. */
const SEARCH_DEBOUNCE_MS = 60;

const NO_RESULT: FindResult = { index: 0, total: 0, capped: false, invalid: false };

/** One of the three switches, as a small toggle button. */
interface SwitchProps {
  readonly label: string;
  readonly title: string;
  readonly pressed: boolean;
  readonly onToggle: () => void;
  readonly className?: string;
}

function Switch({ label, title, pressed, onToggle, className }: SwitchProps) {
  return (
    <button
      type="button"
      className={`find-bar__switch${className ? ` ${className}` : ''}`}
      aria-pressed={pressed}
      aria-label={title}
      title={title}
      // The press must not pull focus off the query: it's where the next keystroke goes.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onToggle}
    >
      {label}
    </button>
  );
}

function Chevron({ direction }: { readonly direction: 'up' | 'down' }) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <path
        d={direction === 'up' ? 'M2.5 7.5 6 4l3.5 3.5' : 'M2.5 4.5 6 8l3.5-3.5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The find bar's whole page (`find.html`): a search box with three switches
 * (match case, whole word, regular expression), a fraction showing which
 * occurrence is current out of how many — its numerator editable, to jump to
 * an occurrence by number — and arrows to step through them, like VS Code's.
 * Enter steps to the next match and Shift+Enter to the previous, looping at
 * either end; Escape closes.
 *
 * It only draws and reports input. Main runs the search in whichever tab is
 * active and sends back the count; the query and switches are held here
 * between openings (the view persists), seeded from main's copy the first time.
 */
export function FindBar() {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<FindOptions>(DEFAULT_FIND_OPTIONS);
  const [result, setResult] = useState<FindResult>(NO_RESULT);
  /** Whether main's stored query and switches have been taken up — searching before that would overwrite them with an empty box. */
  const [ready, setReady] = useState(false);
  /** The numerator while it's being edited; `null` shows the live current occurrence. */
  const [numeratorDraft, setNumeratorDraft] = useState<string | null>(null);
  const queryRef = useRef<HTMLInputElement>(null);
  const seeded = useRef(false);

  useEffect(
    () =>
      window.northstarFind.onState((state) => {
        if (!seeded.current) {
          seeded.current = true;
          setQuery(state.query);
          setOptions(state.options);
          setReady(true);
        }
        setResult(state.result);
      }),
    [],
  );

  // Ctrl+F while the bar is open: take the keyboard and select the query, ready to type over.
  useEffect(
    () =>
      window.northstarFind.onFocus(() => {
        queryRef.current?.focus();
        queryRef.current?.select();
      }),
    [],
  );

  // Runs the search whenever the query or a switch changes, once typing pauses.
  useEffect(() => {
    if (!ready) {
      return undefined;
    }
    const timer = window.setTimeout(() => window.northstarFind.search(query, options), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [ready, query, options]);

  const toggle = (key: keyof FindOptions): void => setOptions((previous) => ({ ...previous, [key]: !previous[key] }));

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      window.northstarFind.close();
    } else if (event.altKey && !event.ctrlKey && !event.metaKey) {
      // VS Code's own shortcuts for the switches.
      const key = event.key.toLowerCase();
      const target: keyof FindOptions | null = key === 'c' ? 'matchCase' : key === 'w' ? 'wholeWord' : key === 'r' ? 'regex' : null;
      if (target) {
        event.preventDefault();
        toggle(target);
      }
    }
  };

  const hasMatches = result.total > 0;
  const totalText = result.capped ? `${MAX_FIND_MATCHES}+` : String(result.total);

  const commitNumerator = (): void => {
    const requested = Number.parseInt(numeratorDraft ?? '', 10);
    setNumeratorDraft(null);
    if (Number.isInteger(requested) && hasMatches) {
      window.northstarFind.goTo(requested);
    }
  };

  return (
    <div className="find-bar" role="search" aria-label="Find" onKeyDown={handleKeyDown}>
      <input
        ref={queryRef}
        autoFocus
        className={`find-bar__input${result.invalid ? ' find-bar__input--invalid' : ''}`}
        type="text"
        value={query}
        placeholder="Find"
        aria-label="Find"
        aria-invalid={result.invalid}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            window.northstarFind.step(event.shiftKey ? -1 : 1);
          }
        }}
      />
      <Switch label="Aa" title="Match Case (Alt+C)" pressed={options.matchCase} onToggle={() => toggle('matchCase')} />
      <Switch
        label="ab"
        className="find-bar__switch--word"
        title="Match Whole Word (Alt+W)"
        pressed={options.wholeWord}
        onToggle={() => toggle('wholeWord')}
      />
      <Switch label=".*" title="Use Regular Expression (Alt+R)" pressed={options.regex} onToggle={() => toggle('regex')} />

      <div className={`find-bar__count${result.invalid ? ' find-bar__count--invalid' : ''}`}>
        {result.invalid ? (
          'Invalid regex'
        ) : (
          <>
            <input
              className="find-bar__numerator"
              type="text"
              inputMode="numeric"
              aria-label="Current occurrence"
              size={Math.max(1, String(hasMatches ? result.index : 0).length)}
              value={numeratorDraft ?? String(hasMatches ? result.index : 0)}
              disabled={!hasMatches}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setNumeratorDraft(event.target.value.replace(/\D/g, ''))}
              onBlur={() => setNumeratorDraft(null)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.stopPropagation();
                  commitNumerator();
                  queryRef.current?.focus();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  setNumeratorDraft(null);
                  queryRef.current?.focus();
                }
              }}
            />
            <span className="find-bar__total">/ {totalText}</span>
          </>
        )}
      </div>

      <button
        type="button"
        className="find-bar__step"
        aria-label="Previous Match (Shift+Enter)"
        title="Previous Match (Shift+Enter)"
        disabled={!hasMatches}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => window.northstarFind.step(-1)}
      >
        <Chevron direction="up" />
      </button>
      <button
        type="button"
        className="find-bar__step"
        aria-label="Next Match (Enter)"
        title="Next Match (Enter)"
        disabled={!hasMatches}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => window.northstarFind.step(1)}
      >
        <Chevron direction="down" />
      </button>
      <button
        type="button"
        className="find-bar__close"
        aria-label="Close (Escape)"
        title="Close (Escape)"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => window.northstarFind.close()}
      >
        ×
      </button>
    </div>
  );
}
