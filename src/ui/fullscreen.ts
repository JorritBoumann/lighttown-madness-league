/**
 * Takes a phone's whole screen for play.
 *
 * In landscape the browser's address bar and tab strip take a third of a
 * 375-pixel-tall screen, which is a third of the pitch. Fullscreen gives that
 * back, and locking the orientation stops the game turning on its side when a
 * thumb tilts the phone mid-boost.
 *
 * Only on touch: a desktop player chose their window size, and going
 * fullscreen at them uninvited is rude. Both calls need a user gesture, so
 * this is only called from a tap on a menu item. Where either is not
 * supported -- an iPhone's Safari has neither for a page -- nothing happens and
 * the game plays in the window it has.
 */
export function takeScreen(): void {
  if (document.fullscreenElement) return;
  const root = document.documentElement;
  if (typeof root.requestFullscreen !== 'function') return;
  root
    .requestFullscreen({ navigationUI: 'hide' })
    .then(() => lockLandscape())
    .catch(() => {
      // Refused (no gesture, or the browser said no). The game still plays.
    });
}

function lockLandscape(): void {
  // Not in the DOM typings everywhere, and missing on most desktop browsers.
  const orientation = screen.orientation as ScreenOrientation & {
    lock?: (o: string) => Promise<void>;
  };
  orientation.lock?.('landscape').catch(() => {
    // Locking is a nicety; the portrait hint covers a browser that refuses.
  });
}
