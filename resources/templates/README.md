# Sitefinity Upgrade Verification Tests

Comprehensive Playwright test suite for verifying Sitefinity CMS upgrades.

## Quick Start

1. Install dependencies:
```bash
npm install
npx playwright install
```

2. Configure your Sitefinity connection in `settings.json`:
```json
{
  "SitefinityUrl": "https://your-site.com",
  "BackendCredentials": {
    "username": "admin@test.test",
    "password": "admin@2"
  }
}
```

3. Run tests:
```bash
npm test                    # Run all tests
npm run test:backend        # Backend functional tests only
npm run test:frontend       # Frontend tests (VRT + interactions)
npm run test:vrt:backend    # Backend VRT tests only
```

4. Update visual regression snapshots:
```bash
npm run update-snapshots:backend  # Regenerate backend VRT snapshots only
npm run update-snapshots          # Regenerate all snapshots (backend + frontend)
```

## Test Structure

### Backend File Naming Convention
- **VRT tests** (Visual Regression): Backend files ending with `-vrt.spec.ts` contain ONLY screenshot tests
  - Example: `dashboard-vrt.spec.ts`, `content-module-vrt.spec.ts`
  - Matched by `vrt-backend` project for selective snapshot regeneration
  - Organize per module/feature (not one monolithic file)
- **Functional tests**: Backend files ending with `.spec.ts` (no `-vrt`) contain interaction and assertion tests
  - Example: `auth.spec.ts`, `content.spec.ts`
  - Matched by `backend-chromium` project

### Frontend File Naming
- **No special naming required** - Frontend tests freely mix VRT + interactions
- Example: `homepage.spec.ts` can contain navigation, interactions, AND screenshots
- All matched by `frontend-chromium` project

### Directory Structure
- `tests/backend/` - Admin panel tests (authentication, content management, VRT)
- `tests/frontend/` - Public site tests (pages, navigation, interactions, VRT)
- `tests/utils/` - Shared Playwright utilities (screenshot helpers, stable navigation, overlay handling)
- `snapshots/backend/` - Backend visual regression baselines
- `snapshots/frontend/` - Frontend visual regression baselines

## Shared Utilities (tests/utils/playwright-utils.ts)

Import helpers for resilient navigation and screenshots:

```typescript
import {
  gotoStable,
  stabilizeForScreenshot,
  takeStableScreenshot,
  hideScrollbars,
  waitForImagesToLoad,
  assertEndpoint,
  EXTERNAL_TAG,
} from '../utils/playwright-utils';
```

### Key helpers
- **`gotoStable(page, url)`** - Navigate with networkidle + image wait + overlay dismiss
- **`stabilizeForScreenshot(page)`** - Stop carousels + hide scrollbars + wait for images
- **`takeStableScreenshot(page, name)`** - Full stabilization + `toHaveScreenshot`
- **`assertEndpoint(request, url)`** - Test non-HTML endpoints (sitemap, robots.txt)
- **`EXTERNAL_TAG`** - Tag tests that hit external sites (skipped by default)

### Environment variables
- `ENABLE_TRIAL_HANDLING=false` - Disable Sitefinity trial screen auto-dismiss
- `GREP="@external"` - Include external-tagged tests in the run

## Documentation

See README.md for full documentation.
