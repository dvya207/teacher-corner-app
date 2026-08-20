/**
 * Static content for the dashboard's action tiles.
 *
 * The dashboard's "What's new" card, and the two large expandable Quick Action
 * cards that used to sit beside these tiles, were removed from the UI and
 * deleted from here with them. The four tiles below are what remains.
 *
 * The notifications placeholder that used to live here is gone: the topbar's feed
 * is now real, read from users/{uid}/notifications. It needed no new top-level
 * collection and no rules change, because that path is already covered by
 * `users/{uid}/{document=**}` — see core/firestore-paths.ts.
 */
