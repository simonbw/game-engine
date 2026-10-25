# E2E Testing Guidelines

## Philosophy

E2E tests are inherently slow due to:

- Browser startup overhead
- Game initialization (renderer setup, asset loading)
- Network and rendering latency

Because of this, we follow a **"fat test"** philosophy rather than a unit-test-style approach:

- **Prefer fewer tests with more assertions** over many isolated single-assertion tests
- Each test should verify multiple related behaviors once the expensive setup is done
- Group assertions that share the same preconditions into a single test

This keeps the test suite fast while still providing meaningful coverage.

## When to Add a New Test vs. Extending an Existing One

**Extend an existing test when:**

- The new assertion shares the same setup (e.g., game needs to be initialized and running)
- It's testing a related aspect of the same flow

**Create a new test when:**

- It requires fundamentally different setup (e.g., testing the entity studio vs. the game)
- The test name would become confusing if you added more assertions

## Test Structure

Each test should:

1. Set up error/warning collection early
2. Perform the minimal setup needed
3. Make multiple assertions with clear comments explaining what each checks
4. Log useful diagnostic info (e.g., timing data) for debugging

## Unit Tests

Code that doesn't need a browser (physics, math, tooling) is tested in Node with `node:test` and `node:assert/strict`, in `tests/<area>/*.test.ts`. They run in about a second. The fat-test advice above is for the browser tests; unit tests can be as small as they like.

## Browser Tests

`tests/*.spec.ts` run in headless Chrome against the dev server, via Playwright. Collect page errors and `console.error`s and fail on any.

The dev server serves source modules by path, so a test can `import("/core/...")` inside `page.evaluate` and get the same module instances the running game uses. `tests/e2e.spec.ts` does this to set up physics bodies.

## Running Tests

- `npm test` - Run the unit tests, then the browser tests
- `npm run test:unit` / `npm run test:e2e` - Run one kind
- `npm run test:electron` - The desktop app (`tests/electron/`, its own Playwright config, not part of `npm test`). Packages the app first, then launches the built app hidden with a throwaway user data folder (boots over `app://`, has the bridge, keeps localStorage across a relaunch, quits) and smoke-launches the packaged `.app`
- The browser tests start their own dev server on port 3466. Set `TEST_PORT` to use another (for running tests in several checkouts at once), and `TEST_REUSE_SERVER=1` to use a dev server already running on that port.
