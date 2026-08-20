import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { User } from 'firebase/auth';

import { AuthService } from '../../services/auth.service';
import { Welcome } from './welcome';

/**
 * Welcome splash — where it sends the user once Firebase has answered.
 *
 * AuthService and Router are both stubbed, so these run without Firebase and
 * without a router outlet. The signed-in branch is the reason this file exists:
 * it cannot be exercised in a browser without real credentials, and it is the
 * branch that would silently strand a returning teacher on /login.
 */

class StubAuthService {
  constructor(private user: User | null) {}

  /** Resolves on a later tick, like the real session rehydration. */
  ready(): Promise<User | null> {
    return new Promise(resolve => setTimeout(() => resolve(this.user), 0));
  }
}

class StubRouter {
  calls: { commands: unknown[]; extras: unknown }[] = [];

  async navigate(commands: unknown[], extras?: unknown): Promise<boolean> {
    this.calls.push({ commands, extras });
    return true;
  }
}

async function run(user: User | null): Promise<StubRouter> {
  const router = new StubRouter();

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [Welcome],
    providers: [
      { provide: AuthService, useValue: new StubAuthService(user) },
      { provide: Router, useValue: router }
    ]
  }).compileComponents();

  const fixture = TestBed.createComponent(Welcome);

  // ngOnInit awaits the minimum-visible timer as well as the auth check, so the
  // navigation has not happened yet at this point — that is what the fake clock
  // below is for.
  fixture.detectChanges();

  await vi.advanceTimersByTimeAsync(2000);

  return router;
}

describe('Welcome', () => {

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends a signed-in user to the dashboard', async () => {
    const router = await run({ uid: 'alice' } as User);

    expect(router.calls.length).toBe(1);
    expect(router.calls[0].commands).toEqual(['/dashboard']);
  });

  it('sends a signed-out user to login', async () => {
    const router = await run(null);

    expect(router.calls.length).toBe(1);
    expect(router.calls[0].commands).toEqual(['/login']);
  });

  it('replaces the URL so the splash is not a back-button destination', async () => {
    const router = await run(null);

    expect(router.calls[0].extras).toEqual({ replaceUrl: true });
  });

  it('holds the splash for the minimum visible time before navigating', async () => {
    const router = new StubRouter();

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Welcome],
      providers: [
        { provide: AuthService, useValue: new StubAuthService(null) },
        { provide: Router, useValue: router }
      ]
    }).compileComponents();

    TestBed.createComponent(Welcome).detectChanges();

    // Auth has resolved well before this, so anything still pending is the floor.
    await vi.advanceTimersByTimeAsync(1000);
    expect(router.calls.length).toBe(0);

    await vi.advanceTimersByTimeAsync(400);
    expect(router.calls.length).toBe(1);
  });
});
