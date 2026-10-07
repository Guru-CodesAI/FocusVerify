# Deploy FocusVerify on Render

This guide covers both deployment options: deploying the checked-in `render.yaml` Blueprint, or configuring the web and API services manually. Create and operate the Render resources yourself; no deployment is triggered by these instructions.

## Before you start

- Push this project to a GitHub repository that your Render account can access. Ensure `render.yaml` is at the repository root and the latest changes are pushed.
- Have a Render account and decide whether free web-service sleep is acceptable. The Blueprint uses free web services and a paid PostgreSQL database; free web services may sleep while idle and take time to wake. Upgrade the web services in Render for continuous availability.
- Choose a dedicated reviewer email and a unique password of at least 16 characters. Do not use the local demo credentials.

Never commit production secrets or paste them into this guide, issues, or logs.

## Option A: Deploy with the Blueprint (recommended)

1. In the Render dashboard, choose **New +** → **Blueprint**.
2. Connect the GitHub repository containing FocusVerify and select the branch you pushed.
3. Review the resources from `render.yaml`: `focusverify-api`, `focusverify-web`, and `focusverify-db`. The database uses the paid `basic-256mb` plan. Confirm the plan and any costs shown by Render before applying.
4. When prompted for unsynced values, enter `REVIEWER_EMAIL` and `REVIEWER_PASSWORD`. Use the dedicated account and a strong, unique password.
5. Apply the Blueprint. Render generates and stores `AUTH_SECRET`; do not replace it with a committed or shared value. Keep it stable across deploys so unexpired tokens remain valid.

The Blueprint wires the API to the managed database, configures the web origin for CORS, and builds the frontend with the API's HTTPS host. Do not manually set `DATABASE_URL`, `WEB_ORIGIN`, or `NEXT_PUBLIC_API_BASE_URL` for the default `onrender.com` domains.

## Option B: Configure Render services manually

Use this option if you created a Render Web Service directly instead of creating a Blueprint. The repository root contains `package.json`; there is no separate frontend subdirectory.

### 1. Create and deploy the API first

Create a Python Web Service from the same GitHub repository and `main` branch:

- **Root Directory:** repository root (leave blank, or use `.` if Render requires a value)
- **Build Command:** `pip install -r backend/requirements.txt`
- **Start Command:** `uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT`
- **Health Check Path:** `/api/health`

Connect a managed PostgreSQL database and set `DATABASE_URL` to its internal connection string. Also set `PYTHONPATH` to `.`, `APP_ENV` to `production`, `WEB_ORIGIN` to the exact HTTPS URL of the web service (you can set this after creating the web service), and `REVIEWER_EMAIL` and `REVIEWER_PASSWORD`. Use a unique reviewer password of at least 16 characters. Generate a private `AUTH_SECRET` of at least 32 characters; do not use the development values from `.env.example`.

Wait for the API deployment and confirm `https://<api-service>.onrender.com/api/health` returns HTTP 200 before building the frontend.

### 2. Create the frontend Web Service

Create a Node Web Service from the same repository and branch:

- **Root Directory:** repository root (leave blank, or use `.` if Render requires a value)
- **Build Command:** `npm ci && npm run build`
- **Start Command:** `npx next start -H 0.0.0.0 -p $PORT`
- **Environment variable `NODE_VERSION`:** `22.14.0`
- **Environment variable `NEXT_PUBLIC_API_BASE_URL`:** the API's public HTTPS origin, such as `https://<api-service>.onrender.com` (no path or trailing slash)

Set `NEXT_PUBLIC_API_BASE_URL` before the first build. Next.js validates and embeds this public URL during the production build; if it is missing, `next build` fails with `NEXT_PUBLIC_API_BASE_URL must be set for production builds.` Adding or changing it later requires a new frontend deployment.

### 3. Finish API CORS configuration and verify

Copy the frontend's exact public HTTPS origin into the API's `WEB_ORIGIN` environment variable, then redeploy the API. Do not include a path or trailing slash. Check the API health endpoint again, then smoke-test `/setup`, a complete test session, `/report`, and reviewer sign-in as described below.

Do not mix the manual and Blueprint approaches: with the Blueprint, service references set these values automatically; with manual services, configure the URLs explicitly as above.

## Wait for services and check logs

Wait until all three resources have completed their initial deployment. In particular:

- The API build installs `backend/requirements.txt`; its start command binds Uvicorn to Render's `$PORT`.
- The API health check is `https://<api-service>.onrender.com/api/health`. It should return HTTP 200 with `"status":"ok"`. A 503 means the API is not ready; inspect API logs and verify its database and required environment variables.
- The web build runs `npm ci` and `npm run build` on Node 22.14.0. Its start command binds Next.js to Render's `$PORT`.
- The PostgreSQL service should be available and connected before API health checks pass.

Do not share log output containing environment values, tokens, or database connection details.

## Smoke-test the deployed application

1. Open `https://<web-service>.onrender.com/` and confirm the home page loads.
2. Open `/setup`, create a test candidate session, and complete the sample session flow.
3. Open `/reviewer`, sign in with the configured reviewer email and password, and confirm the test session appears in the queue.
4. Open the candidate report and reviewer detail, then verify the events and review history persist after reloading.
5. Sign out and confirm reviewer-only endpoints/pages do not display reviewer data without authentication.

Use test data only. Browser events are client-reported observations, not proof of misconduct. The app does not upload camera frames or infer identity, gaze, or cheating.

## Custom domains

The default service-to-service host references assume Render's `onrender.com` domains. If you add custom domains, update both sides of the origin wiring before relying on them:

- Set the API `WEB_ORIGIN` to the exact HTTPS origin of the frontend custom domain.
- Set the frontend build-time `NEXT_PUBLIC_API_BASE_URL` to the HTTPS origin of the API custom domain, without a path, query, or fragment.
- Update the corresponding `fromService` environment entries in `render.yaml` to those values, then sync/deploy the Blueprint and rebuild the frontend.
- Verify the API health URL and sign-in/session flows again. Browser requests from an origin other than `WEB_ORIGIN` are intentionally blocked by CORS.

## Ongoing operations

- Keep `AUTH_SECRET` stable and private. Rotating it invalidates all active bearer tokens.
- Rotate the reviewer password through Render environment settings; existing reviewer tokens are invalidated when that password changes.
- Review Render database backup/retention settings and establish a data-retention policy before using real assessment data.
- Monitor deploy logs, API health, database usage, and rate-limit behavior. The current throttles are not a distributed abuse-prevention service.
- Free web services can sleep; choose an appropriate paid instance if candidate sessions require predictable availability.
- For high-stakes use, add managed reviewer identity, operational alerting, retention controls, and a formal privacy/security review. This prototype is not an enterprise-grade proctoring system.
