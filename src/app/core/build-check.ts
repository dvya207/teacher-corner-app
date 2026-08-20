/**
 * Reloads the tab when a newer build has been deployed.
 *
 * WHY THIS EXISTS. An Angular app keeps running the JavaScript it loaded until
 * the page is reloaded. A tab left open across a deploy therefore goes on
 * executing the OLD code indefinitely — and because it still writes happily, it
 * produces documents in the old shape carrying today's timestamps. That is
 * genuinely hard to diagnose: the data looks like a live bug in code that no
 * longer exists.
 *
 * HOW IT DETECTS ONE. index.html is served no-cache and names the hashed entry
 * bundle, which changes on every build. Fetching it and comparing that name with
 * the one this tab actually loaded is enough — no build id to thread through, and
 * nothing to keep in step by hand.
 *
 * RELOADS AT MOST ONCE per tab. A wrong comparison would otherwise loop, and a
 * reload loop is worse than a stale tab: the flag is set BEFORE reloading, so
 * even a bad match costs one reload rather than an endless run.
 */

const RELOADED_FLAG = 'tc.reloadedForNewBuild';

/** The hashed entry bundle this tab is running, or '' if it cannot be told. */
function loadedEntryBundle(): string {
  const scripts = Array.from(document.querySelectorAll('script[src]'));

  for (const script of scripts) {
    const match = /(?:^|\/)(main-[A-Z0-9]+\.js)/.exec(script.getAttribute('src') ?? '');

    if (match) {
      return match[1];
    }
  }

  return '';
}

/** The hashed entry bundle the server is currently serving, or ''. */
async function deployedEntryBundle(): Promise<string> {
  // cache: 'no-store' as well as the no-cache header, so a proxy in between
  // cannot answer this from its own copy.
  const response = await fetch(`/?buildcheck=${Date.now()}`, { cache: 'no-store' });

  if (!response.ok) {
    return '';
  }

  const match = /(main-[A-Z0-9]+\.js)/.exec(await response.text());

  return match ? match[1] : '';
}

/**
 * Checks again when the tab is brought back to the front.
 *
 * The boot check only catches a deploy that happened BEFORE the tab was opened.
 * The case that actually bites is a tab left open while a deploy lands, so the
 * check repeats whenever the tab becomes visible again — which is exactly when
 * somebody is about to use it.
 */
export function watchForNewBuild(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void reloadIfStale();
    }
  });
}

export async function reloadIfStale(): Promise<void> {
  // Only meaningful where a deploy can have happened under us.
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    return;
  }

  if (sessionStorage.getItem(RELOADED_FLAG) === '1') {
    return;
  }

  try {
    const loaded = loadedEntryBundle();
    const deployed = await deployedEntryBundle();

    // Either unreadable: do nothing rather than guess.
    if (!loaded || !deployed) {
      return;
    }

    if (loaded === deployed) {
      /*
       * SAID OUT LOUD, because the alternative was unfalsifiable. A stale tab
       * writes documents in the old shape carrying today's timestamps, and there
       * was no way to tell from the app which build had produced them. Now one
       * line in the console answers it.
       */
      console.info(`Teacher Corner: running the current build (${loaded}).`);
      return;
    }

    console.info(`A newer build is deployed (${deployed}); reloading to leave ${loaded}.`);

    // BEFORE the reload, so a mistaken comparison cannot loop.
    sessionStorage.setItem(RELOADED_FLAG, '1');
    location.reload();
  } catch (error) {
    // A failed check must never stop the app: the cost is a stale tab, which is
    // exactly the state we were already in.
    console.error('Could not check for a newer build.', error);
  }
}
