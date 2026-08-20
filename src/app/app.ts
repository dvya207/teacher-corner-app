import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Root component. Nothing but the outlet — the signed-in chrome lives in
 * Shell, which is itself a route, so the login page can render without it.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {}
