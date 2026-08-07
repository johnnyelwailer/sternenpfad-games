# Funkel-Flotte — Design-Prinzipien

These principles grew out of playtesting feedback with the target audience
(children around 7). Every new feature, spell, mode, or UI element MUST be
checked against them before shipping. When a principle and a mechanic
conflict, redesign the mechanic.

## 1. Magic is always visible ("projective visualization")

Every effect must show what it does the moment it happens, on the board,
in a way a non-reader understands.

- **No invisible state changes.** If a spell only changes hidden state
  (a balloon appears somewhere secret, a creature moves silently), it is
  broken. Either make the change visible to its owner (camera flies to the
  own board, spotlight on the new balloon, the creature visibly hops to its
  new spot) — or the spell may not exist.
- **The initiator interacts or watches.** Prefer spells the player aims
  (tap a row, a cell, one of their own creatures). Auto-cast spells must
  produce an immediate, unmistakable animation.
- **Delayed effects get persistent badges.** Anything that waits
  (Seerosen-Schild, Doppelschuss, Extra-Zug, Glücksklee) shows a badge in
  the powers tray until it fires — with a countdown when it has charges
  ("Glücksklee 3×").
- **Hints linger.** Information hints (Kompass/Trommel arrow, Glocke
  orientation ghost) stay on the board, gently animated, until the next
  shot supersedes them. A hint that fades after seconds is a hint missed.
- **Teach by demonstration.** When a passive gain needs explanation, show
  a demo (Glücksklee flashes real distance numbers over a few free cells).
  A one-line `use` text on the gain card reinforces, never replaces, the
  animation.

## 2. Both players see what concerns them

- When a spell affects the opponent's knowledge (Wirbelwind wipes their
  hit marks), the opponent gets a clear animation (marks swirl up and
  vanish) and a toast — they must understand *that* something escaped,
  never *where it went*.
- Treasure chests are visible to both players once surfaced; digging one
  is a real, observable choice.

## 3. Hidden-information spells are cards-only

Spells whose whole point is secrecy (Extra-Ballon, the aimed
Sternschnuppen-Salve, Wirbelwind) never come out of treasures — treasures
auto-cast, and an auto-cast secret reads as "nothing happened". Such
spells exist only in the opt-in card hand, where playing them is a
deliberate decision. The legend tags them "(nur als 🃏 Karte)".

## 4. Immediate reward beats deferred promise

A treasure should feel great the second it opens. Doppelschuss from a
chest means "you search TWICE right now", not "some future miss will be
forgiven". Prefer effects that act in the current moment.

Concretely: digging a chest is a GIFT, not the digger's shot — EVERY
chest spell keeps the turn, so the fresh knowledge (or buff) can be
used immediately. A spell that fires and then hands the enemy the
board reads as a punishment to kids, however balanced it may be.

## 5. Kid-fit language and naming

- German UI, short sentences, no jargon, no cutesy filler names that
  don't describe anything ("Kuschel/Knuddel" → "Enge Verstecke",
  "Groß & Klein"). A name should let a child guess the effect.
- Every option in the options screen carries a one-line description of
  what it changes in play.

## 6. Modes stay optional, features stay flagged

- Every feature ships behind a flag in `flags.js`, ON by default, so
  anything misbehaving can be disabled without a rollback.
- Extra modes and rule twists are opt-in for the player; the classic game
  is always reachable in two taps.
- The Weltreise is the guided path: a story that introduces each spell
  one by one (a `teach` chest, visible from the start, containing exactly
  that spell).

## 7. Fair play, honest marks

- Board marks never lie: auto-reveal only exists where the no-touch rule
  guarantees it; spells that move creatures may only move them to unshot
  cells; wiped marks become genuinely unknown again.
- Solo difficulty is kind by default ("Robo Sanft" uses no spells; the
  robo monster is big and slow). "Schlau" is the labeled exception.

## 8. Resilience without hijacking

- Interruptions (refresh, crash, connection drop) must be recoverable —
  but recovery is *offered* (resume banner, retry loops that keep the
  checkpoint), never forced on the player.
- Failed reconnects keep the saved game so players can try again.

## 9. Sound mirrors sight

Every visible effect has a matching sound; own-vs-enemy events and each
world have distinct timbres. A spell without a sound is as unfinished as
a spell without an animation.

## 10. Test what a child would notice

New mechanics get unit tests for the rules AND an e2e test for the
visible flow (the badge appears, the banner shows, the marks vanish).
If the visible part isn't testable, it probably isn't visible enough.
