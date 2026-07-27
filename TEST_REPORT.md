# HANZ Trade v2.1 — Verification Report

## Passed locally

- Exactly 3 GitHub workflow files exist and validate:
  - `Build HANZ-TRADE APK`
  - `Update HANZ market data`
  - `Update HANZ BEI candidates`
- All workflow YAML files parse successfully.
- All workflow names, triggers, jobs and Ubuntu runners validate.
- Market engine deterministic self-test passes.
- BEI updater deterministic self-test passes.
- Market JSON validation passes.
- BEI JSON validation passes.
- All Node.js scripts pass syntax checks.
- All Android XML resources and Manifest parse successfully.
- Widget endpoint is correctly set to `https://hanz-trade.netlify.app/widget-data.json`.
- Android version and APK artifact name are aligned to v2.1.
- Obsolete crashing Netlify Function was removed.
- Existing BEI bootstrap JSON was repaired to the schema expected by the updater.
- Full `npm run test-all` passes.

## External runtime boundary

This sandbox blocks outbound DNS, so live HTTP provider calls and the Android Gradle build cannot be executed here. The supplied GitHub workflows perform those steps on GitHub-hosted runners. The updater keeps last-known-good values if every live provider is temporarily unavailable.
