import { IconName } from '../components/icon/icon';

/**
 * Static marketing copy for the login hero.
 *
 * This is NOT data and is not read from Firestore on purpose — it is copy on a
 * signed-out page, where there is no user to scope a query to and no session to
 * authorise one with. Edit it here.
 *
 * The four floating stat cards that used to live here — Learning Units, Active
 * Teachers, Avg Rating, Student Impact — were removed from the hero, and their
 * hardcoded figures with them. Anything similar added later should come from a
 * real source rather than from constants in this file, because a signed-out
 * page has no way to keep an invented number honest.
 */

/**
 * The three modules, under the hero headline.
 *
 * THE THREE THIS APP ACTUALLY HAS. Tactivities, Contest Management, Progress
 * Analytics and WhatsApp Sync were removed on instruction: none of them exists
 * here, and a signed-out page advertising four features that are not behind the
 * sign-in is a promise the app cannot keep. 'Smart Classrooms' went with them
 * rather than being kept alongside 'Classrooms', which read as two things.
 *
 * RENDERED AS CHIPS, one line each, matching the production hero's chip row.
 *
 * `summary` is therefore NOT rendered at present. It is kept rather than deleted
 * because it is the user's wording and the two-line layout it belongs to is one
 * template change away: a chip is a single line at this width, which is why the
 * previous layout put the name over its summary instead. Restoring that means
 * editing login.html, not retyping this copy.
 */
export interface HeroModule {
  name: string;
  summary: string;
  /**
   * The chip's icon. An IconName, so a typo is a compile error rather than a blank
   * square at runtime, and so the set cannot drift from what Icon actually draws.
   */
  icon: IconName;
}

export const HERO_MODULES: HeroModule[] = [
  { name: 'Institutions', summary: 'schools, boards and locations',   icon: 'building' },
  { name: 'Classrooms',   summary: 'regular classes and STEM clubs',  icon: 'classroom' },
  { name: 'Programmes',   summary: 'templates and learning units',    icon: 'programme' }
];
