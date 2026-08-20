import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { reloadIfStale, watchForNewBuild } from './app/core/build-check';

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));

/*
 * AFTER bootstrap, and not awaited. A tab left open across a deploy keeps running
 * the old bundle and writes documents in the old shape with today's timestamps,
 * which reads as a live bug in code that no longer exists. This ends that.
 */
void reloadIfStale();
watchForNewBuild();
