# Genpong Online

Browser beer pong (drag to throw). Static site: GitHub Pages serves it as is.

## Modes
- **Solo**: 15 throws, chase a high score.
- **Same screen**: 2 players on one device.
- **Online**: 1v1 on your own devices via a 4-letter code / invite link.
- **Tournament**: GenPong 2025 format for many players (see below).

## Running a tournament (organizer)
1. Open the game → **Tournament** tab → *Organizer: start a tournament* → enter the organizer passphrase.
2. Share the invite link (or the 5-letter code). Players open it, enter a name, pick a drink, tap **Join**.
3. **Start elimination round**: everyone throws 8 balls on their own device; cups hit go on the ladder.
4. **Close elimination round**: the top 8 (or 4 / 2) go through. Ties on the cut line play a 2-ball sudden death.
5. Knockout: quarter-finals and semi-finals (10 minutes, then most cups hit wins), final without time limit.
   Every knockout match starts with best-of-3 rock-paper-scissors. Bounce shot: the thrower picks the extra cup.
   One re-rack per player per game.
6. Your device is the referee: keep it open. If you close it, the tournament pauses; resume from the Tournament tab.
   You can award or reset any match from the bracket (e.g. after a disconnect).

Change the organizer passphrase by putting the SHA-256 of a new one in `config.js` (`printf 'new phrase' | sha256sum`).
This is a speed bump, not real security: the check runs in the browser.

## Intro video
Put a video in the repo (MP4/H.264, ideally < 10 MB) and set `introVideo: 'media/intro.mp4'` in `config.js`.
It plays once per browser, muted (browsers block autoplay with sound), with *Sound on* and *Skip* buttons.

Unofficial fan project.
