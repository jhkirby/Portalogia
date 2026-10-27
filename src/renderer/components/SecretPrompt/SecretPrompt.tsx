// Project: Northstar
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-27

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { SecretPromptAnswer, SecretPromptOffer } from '@shared/ipc-contract';
import { MAX_SECRET_NAME_CHARS } from '@shared/secrets';
import { LockIcon } from '../icons';

/** How many dots stand in for the password: the same for every one, so the prompt doesn't tell its length. */
const MASK = '•'.repeat(10);

/** The longest the slide out can take (`secret-prompt-out` in `secret-prompt.css`); the answer goes then even if it never reported ending. */
const EXIT_MS = 200;

/**
 * The whole of `secret-prompt.html`'s page: Chrome's "save password?" box,
 * shown by `SecretPromptOverlay` in the page area's top-right corner when a
 * web page sends a login. It slides in from the page's right edge, and back
 * out once answered. It shows the site, the username as typed and the
 * password as dots until they're hovered — none of them changeable here — and
 * a name box for each, which starts as `<domain> - Username` /
 * `<domain> - Password`. Accept saves them to the Secrets table under those
 * names; the × lets them go.
 */
export function SecretPrompt() {
  const [offer, setOffer] = useState<SecretPromptOffer | null>(null);
  const [usernameName, setUsernameName] = useState('');
  const [passwordName, setPasswordName] = useState('');
  const [passwordShown, setPasswordShown] = useState(false);
  /** The answer given, held while the card slides out; sent once it's gone. */
  const [leaving, setLeaving] = useState<SecretPromptAnswer | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      window.northstarSecretPrompt.onOffer((next) => {
        setOffer(next);
        setLeaving(null);
        setPasswordShown(false);
        // A new offer starts from its own names, not what was typed for the last one.
        if (next) {
          setUsernameName(next.usernameName);
          setPasswordName(next.passwordName);
        }
      }),
    [],
  );

  // Main sizes the view to the card, so the page around it stays clickable; told again whenever the card's height
  // changes. Per offer: each one's card is a fresh element (keyed, to slide in afresh).
  const offerId = offer?.id ?? null;
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) {
      return undefined;
    }
    const report = (): void => window.northstarSecretPrompt.reportHeight(card.getBoundingClientRect().height);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(card);
    return () => observer.disconnect();
  }, [offerId]);

  // The answer goes once the slide out ends — or after its length, should it never say so (reduced motion skips it).
  useEffect(() => {
    if (!leaving) {
      return undefined;
    }
    const timer = window.setTimeout(() => window.northstarSecretPrompt.answer(leaving), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  if (!offer) {
    return null;
  }

  const hasUsername = offer.username !== null;
  const canAccept = passwordName.trim().length > 0 && (!hasUsername || usernameName.trim().length > 0);

  const accept = (): void => {
    if (canAccept && !leaving) {
      setLeaving({
        id: offer.id,
        accept: true,
        // With no username, its name is never used; main still takes one, so it goes as it came.
        usernameName: hasUsername ? usernameName.trim() : offer.usernameName,
        passwordName: passwordName.trim(),
      });
    }
  };

  const deny = (): void => {
    if (!leaving) {
      setLeaving({ id: offer.id, accept: false });
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      deny();
    } else if (event.key === 'Enter' && canAccept) {
      event.preventDefault();
      accept();
    }
  };

  return (
    <div
      // Keyed by the offer, so a new one slides in afresh.
      key={offer.id}
      ref={cardRef}
      className={`secret-prompt${leaving ? ' secret-prompt--leaving' : ''}`}
      role="dialog"
      aria-label="Save login"
      onKeyDown={handleKeyDown}
    >
      <div className="secret-prompt__header">
        <span className="secret-prompt__icon" aria-hidden="true">
          <LockIcon size={15} />
        </span>
        <h2 className="secret-prompt__title">Save login?</h2>
        <button type="button" className="secret-prompt__close hover-grow" onClick={deny} aria-label="Don't save">
          ×
        </button>
      </div>

      <div className="secret-prompt__field">
        <span className="secret-prompt__label">Source</span>
        <span className="secret-prompt__fixed" title={offer.source}>
          {offer.source}
        </span>
      </div>

      {hasUsername && (
        <div className="secret-prompt__secret">
          <label className="secret-prompt__field">
            <span className="secret-prompt__label">Username</span>
            <input
              className="secret-prompt__input"
              value={usernameName}
              maxLength={MAX_SECRET_NAME_CHARS}
              onChange={(event) => setUsernameName(event.target.value)}
              spellCheck={false}
            />
          </label>
          <span className="secret-prompt__fixed" title={offer.username ?? undefined}>
            {offer.username}
          </span>
        </div>
      )}

      <div className="secret-prompt__secret">
        <label className="secret-prompt__field">
          <span className="secret-prompt__label">Password</span>
          <input
            className="secret-prompt__input"
            value={passwordName}
            maxLength={MAX_SECRET_NAME_CHARS}
            onChange={(event) => setPasswordName(event.target.value)}
            spellCheck={false}
          />
        </label>
        {/* Dots until the pointer is on them, then the password itself. */}
        <span
          className={`secret-prompt__fixed${passwordShown ? '' : ' secret-prompt__dots'}`}
          aria-label={passwordShown ? undefined : 'Password, hidden: hover to show'}
          onMouseEnter={() => setPasswordShown(true)}
          onMouseLeave={() => setPasswordShown(false)}
        >
          {passwordShown ? offer.password : MASK}
        </span>
      </div>

      <div className="secret-prompt__actions">
        <button type="button" className="secret-prompt__accept" onClick={accept} disabled={!canAccept}>
          Accept
        </button>
      </div>
    </div>
  );
}
