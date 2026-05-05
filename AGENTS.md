# Project Working Rules

## Verification Rule

For every functional change, do not stop at API checks or unit tests.

Before calling the work done:

1. Start the local app server.
2. Open the app in a browser.
3. Click the specific UI button, tab, input, or control affected by the change.
4. Confirm the visible behavior matches the expected result.
5. Report what was clicked and what happened.

API tests, `node --check`, and unit tests are still required when relevant, but they are not enough by themselves for UI-facing changes.

If browser verification cannot be completed, say exactly why and do not claim the feature is fully verified.
