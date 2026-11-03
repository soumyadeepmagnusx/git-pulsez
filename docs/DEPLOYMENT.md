# GitPulse Deployment Guide

GitPulse is a static single-page app. The frontend build has no backend dependency: every core feature (incident input, sample incidents, analysis, safety validation, recovery plan display, copy, reset, and history) works in Deterministic Fallback / Demo Mode (`fallback_demo`) with no server, no database, and no AWS credentials.

The optional Bedrock_Handler (`backend/lambda/analyzeIncident.ts`) adds Amazon Bedrock AI Mode (`bedrock_ai`). It is not required to deploy or use GitPulse. At the time of writing, the handler is not yet implemented in this repository; the contract below describes how it must behave once it is added.

Contents:

1. [Prerequisites](#prerequisites)
2. [Build locally](#build-locally)
3. [Deploy the static frontend on AWS Amplify Hosting](#deploy-the-static-frontend-on-aws-amplify-hosting)
4. [Vercel and Netlify](#vercel-and-netlify)
5. [Verify the public URL](#verify-the-public-url)
6. [Configure VITE_BEDROCK_ENDPOINT_URL](#configure-vite_bedrock_endpoint_url)
7. [Bedrock_Handler API contract](#bedrock_handler-api-contract)
8. [Bedrock_Handler environment variables](#bedrock_handler-environment-variables)
9. [Security checklist](#security-checklist)

## Prerequisites

- Node.js 20 or 22 (Vite 6 requires Node.js 18 or newer; 20 LTS or later is recommended) and npm.
- A Git repository with this project pushed to GitHub, GitLab, Bitbucket, or AWS CodeCommit, if you deploy through a hosting provider's Git integration.
- No AWS credentials are needed for the frontend. The build and the test suite run without the AWS SDK and without installing anything under `backend/`.

## Build locally

```sh
npm ci
npx vitest --run
npm run build
```

- `npm run build` runs `tsc -b && vite build` and writes the static site to `dist/`.
- After the build, the `postbuild` script (`scripts/check-dist-secrets.mjs`) scans every file in `dist/` for AWS access key IDs (`AKIA` followed by 16 uppercase letters or digits). If it finds one, it prints the file and line with the key redacted and exits with code 1, so the build fails. This check only catches that key pattern; it does not detect every kind of secret.
- `npm run preview` serves `dist/` locally so you can check the build before deploying.

## Deploy the static frontend on AWS Amplify Hosting

Settings:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Output (base) directory | `dist` |
| Install command | `npm ci` |
| Node.js version | 20 or 22 |
| Environment variables | None required. `VITE_BEDROCK_ENDPOINT_URL` is optional (see below). |

Steps:

1. Open the AWS Amplify console and choose **Create new app** (or **New app → Host web app**).
2. Connect your Git provider, then choose the GitPulse repository and the branch to deploy.
3. Amplify usually detects Vite. Confirm the build settings match the table above, or add the `amplify.yml` below to the repository root.
4. Leave environment variables empty for a `fallback_demo` deployment.
5. Choose **Save and deploy**. Wait for the Provision, Build, and Deploy phases to finish.
6. Open the generated URL (for example `https://main.<app-id>.amplifyapp.com`) and follow [Verify the public URL](#verify-the-public-url).

Example `amplify.yml`:

```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - nvm use 20
        - npm ci
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: dist
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*
```

Notes:

- `npm run build` includes the `postbuild` secret scan, so an Amplify build fails if `dist/` contains an AWS access key ID.
- GitPulse has a single page and no client-side routes, so no rewrite or redirect rules are needed.
- Do not add AWS credentials to the Amplify app's environment variables for the frontend. The frontend never needs them.

## Vercel and Netlify

Both providers serve the same `dist/` output. No server functions or adapters are needed.

**Vercel**

1. Import the repository in the Vercel dashboard.
2. Framework preset: **Vite**.
3. Build command: `npm run build`. Output directory: `dist`. Install command: `npm ci`.
4. Set the Node.js version to 20.x or 22.x in **Project Settings → General**.
5. Optionally add `VITE_BEDROCK_ENDPOINT_URL` under **Settings → Environment Variables**, then redeploy.

**Netlify**

1. Add a new site from Git and choose the repository.
2. Build command: `npm run build`. Publish directory: `dist`.
3. Set `NODE_VERSION` to `20` (or `22`) under **Site configuration → Environment variables**, or add it to `netlify.toml`:

   ```toml
   [build]
     command = "npm run build"
     publish = "dist"

   [build.environment]
     NODE_VERSION = "20"
   ```

4. Optionally add `VITE_BEDROCK_ENDPOINT_URL` as an environment variable, then trigger a new deploy.

## Verify the public URL

After the deployment finishes, check the public URL in a browser:

1. The dashboard loads with a dark theme, the incident text area, the "Analyze Incident" button, the `0 / 20,000` character counter, and 5 sample incident buttons.
2. Select a sample incident (for example **Rejected push**). The text area fills with sample terminal output and the button is marked active.
3. Choose **Analyze Incident**. A result appears with:
   - the mode badge **Deterministic Fallback / Demo Mode** (when `VITE_BEDROCK_ENDPOINT_URL` is not set),
   - an incident type that matches the sample (for example `rejected_push`),
   - "Detected Evidence" and "Assumptions" lists,
   - numbered recovery steps, each with a risk badge, a command, and a **Copy command** button.
4. Choose a copy button. It shows "Copied" for about 2 seconds. Clipboard access requires HTTPS, which all three providers serve by default.
5. Reload the page. The analysis appears in the history panel. Selecting it restores the incident text and the result without a new analysis.
6. Choose the reset control. The text area, validation message, and result are cleared.
7. Optional: open the browser developer tools **Network** tab and confirm that analysis makes no requests other than loading the site's own files (in `fallback_demo` mode).

If any step fails, check the hosting provider's build log first. The build log shows TypeScript errors, Vite errors, and the output of the secret scan.

## Configure VITE_BEDROCK_ENDPOINT_URL

`VITE_BEDROCK_ENDPOINT_URL` is the only frontend configuration value. It holds the HTTPS URL of a deployed Bedrock_Handler.

- **Build-time only.** Vite replaces `import.meta.env.VITE_BEDROCK_ENDPOINT_URL` with its value when `npm run build` runs. Changing the variable in the hosting console has no effect until you rebuild and redeploy.
- **Must be an absolute `https:` URL.** `src/config.ts` accepts the value only if it parses as an `https:` URL with a host name and no embedded user name or password. Any other value (empty, relative, `http:`, another scheme) is treated as not configured, and GitPulse uses `fallback_demo` mode.
- **Optional.** When the variable is missing or rejected, the full core workflow still works in `fallback_demo` mode.
- **Public value.** Every `VITE_*` variable is embedded in the JavaScript bundle and is readable by anyone who loads the site. Never put AWS access keys, secret keys, session tokens, or API keys in any `VITE_*` variable. The endpoint URL itself is not a secret.

Local example (`.env.local`, not committed):

```sh
VITE_BEDROCK_ENDPOINT_URL=https://abc123.lambda-url.us-east-1.on.aws/
```

Behavior when the variable is set:

- The Analyzer sends one `POST` request with the body `{ "incidentText": "..." }` and `Content-Type: application/json` to that URL. It sends no cookies or credentials.
- If the request fails, returns a non-2xx status, returns a body that is not valid JSON or fails the Analysis_Result contract, or does not respond within 15 seconds, the Analyzer uses the Fallback_Engine instead. The dashboard then shows a notice that Amazon Bedrock was unavailable and that the result came from Deterministic Fallback / Demo Mode.
- Every result, from either mode, passes through the frontend Safety_Validator before display. The handler does not need to be trusted for safety warnings or safeguard steps.

## Bedrock_Handler API contract

The Bedrock_Handler is an optional AWS Lambda function at `backend/lambda/analyzeIncident.ts`, exposed over HTTPS through a Lambda Function URL or an Amazon API Gateway HTTP API. It reads only the submitted `incidentText`. It executes no Git commands and has no access to any repository or file system.

### Request

```http
POST / HTTP/1.1
Content-Type: application/json

{ "incidentText": "To github.com:team/app.git\n ! [rejected]        main -> main (fetch first)\n..." }
```

| Field | Type | Rules |
|---|---|---|
| `incidentText` | string | Required. Must contain at least 1 non-whitespace character. At most 20,000 characters. |

`OPTIONS` requests return the CORS preflight response (see [CORS](#cors)).

### Responses

All response bodies are JSON with `Content-Type: application/json`.

| Status | When | Body |
|---|---|---|
| `200` | The request is valid, Amazon Bedrock returned output, and the output passes `isAnalysisResult` from `src/shared/analysisContract.ts`. | An Analysis_Result with `analysisMode` set to `"bedrock_ai"`. |
| `400` | The body is not valid JSON, `incidentText` is missing or not a string, `incidentText` is empty or whitespace-only, or `incidentText` is longer than 20,000 characters. | `{ "error": "<description>" }` |
| `502` | The Amazon Bedrock call fails, or the model output cannot be parsed or fails validation against the shared Analysis_Result interface. | `{ "error": "<description>" }` |

Error messages never include AWS credentials, request headers, or stack traces.

Example `200` body (shortened):

```json
{
  "incidentType": "rejected_push",
  "title": "Push rejected because the remote has new commits",
  "confidence": "medium",
  "severity": "medium",
  "analysisMode": "bedrock_ai",
  "summary": "The remote branch contains commits that your local branch does not have.",
  "detectedEvidence": ["! [rejected]        main -> main (fetch first)"],
  "assumptions": ["The remote is assumed to be origin."],
  "recoverySteps": [
    { "stepNumber": 1, "title": "Inspect local state", "explanation": "Shows your branch and uncommitted changes.", "command": "git status", "riskLevel": "safe" }
  ]
}
```

Contract rules enforced by `isAnalysisResult` (the frontend rejects anything else and falls back):

- `incidentType`: `rejected_push`, `merge_conflict`, `detached_head`, `stuck_rebase`, `lost_commits`, or `unknown`.
- `confidence`: `high`, `medium`, or `low`. `severity`: `low`, `medium`, or `high`.
- `analysisMode`: must be `bedrock_ai` for handler responses.
- `title`, `summary`: strings. `detectedEvidence`, `assumptions`: string arrays.
- `recoverySteps`: at least 1 step; `stepNumber` values are integers 1..n in array order; each step has string `title`, `explanation`, `command`, a `riskLevel` of `safe`, `caution`, or `destructive`, and optional string `warningMessage` and `backupPrerequisite`.
- No extra keys at either level.

The frontend also rejects a `200` response if a risky step's `title`, `explanation`, or `warningMessage` contains a safety overclaim phrase ("now safe", "makes it safe", "safe to run", "completely safe", "guarantees safety", "fully protected"), or if a `warningMessage` contains "Risk remains after safeguards" more than once.

### Model instructions

The handler's system prompt instructs the model to:

- return only JSON matching the Analysis_Result interface,
- put only text found in the incident text into `detectedEvidence`,
- put inferences (remote name, branch name, uncommitted changes) into `assumptions`,
- avoid claiming certainty when evidence is partial,
- include inspection steps before any risky command.

### CORS

Every response, including errors and the `OPTIONS` preflight, includes:

```http
Access-Control-Allow-Origin: <value of ALLOWED_ORIGIN>
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

Set `ALLOWED_ORIGIN` to the exact origin of the deployed frontend, for example `https://main.<app-id>.amplifyapp.com` (scheme and host, no path, no trailing slash). If you configure CORS on the Lambda Function URL or API Gateway as well, use the same origin and make sure the headers are not sent twice, because browsers reject duplicate `Access-Control-Allow-Origin` headers.

## Bedrock_Handler environment variables

| Variable | Required | Description |
|---|---|---|
| `BEDROCK_MODEL_ID` | Yes | Amazon Bedrock model ID or inference profile ID used with the Converse API, for example `anthropic.claude-3-haiku-20240307-v1:0`. The model must be enabled for your account in the chosen region. |
| `AWS_REGION` | Yes (set by Lambda) | Region for the Bedrock Runtime client. Lambda sets this reserved variable automatically to the function's region, so deploy the function in a region where the model is available. |
| `ALLOWED_ORIGIN` | Yes | Frontend origin returned in `Access-Control-Allow-Origin`. |

Credentials:

- The handler gets AWS credentials only from the Lambda execution role. Do not set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, or other key variables on the function, and never place credentials in frontend code or `VITE_*` variables.
- Give the execution role least-privilege access: `bedrock:InvokeModel` (the Converse API uses this permission) on the specific model ARN, plus the standard CloudWatch Logs permissions from `AWSLambdaBasicExecutionRole`.

Example policy statement:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "bedrock:InvokeModel",
      "Resource": "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-haiku-20240307-v1:0"
    }
  ]
}
```

If `BEDROCK_MODEL_ID` is a cross-region inference profile, also allow `bedrock:InvokeModel` on the inference profile ARN and on the foundation model ARNs in each region the profile routes to.

Backend packaging:

- The handler declares `@aws-sdk/client-bedrock-runtime` and its build tools in `backend/package.json`, separate from the frontend `package.json`. Installing the frontend dependencies installs no AWS SDK packages.
- The handler may import `src/shared/analysisContract.ts`; the backend bundler (esbuild) inlines it. The frontend never imports from `backend/`.

Connecting the handler to the frontend:

1. Deploy the Lambda function and expose it with a Lambda Function URL or an API Gateway HTTP API over HTTPS.
2. Set `ALLOWED_ORIGIN` on the function to the frontend origin.
3. Set `VITE_BEDROCK_ENDPOINT_URL` in the hosting provider to the function's HTTPS URL.
4. Rebuild and redeploy the frontend.
5. Analyze a sample incident. The mode badge shows **Amazon Bedrock AI** when the handler response is accepted. If it shows **Deterministic Fallback / Demo Mode** with the "Amazon Bedrock was unavailable" notice, check the function's CloudWatch logs, the CORS origin, and the model access settings.

## Security checklist

- [ ] The frontend deployment has no AWS credentials in its environment variables.
- [ ] No `VITE_*` variable contains a key, token, or password.
- [ ] `npm run build` passes, including the `postbuild` secret scan.
- [ ] `VITE_BEDROCK_ENDPOINT_URL`, if set, is an `https:` URL.
- [ ] The Lambda execution role allows `bedrock:InvokeModel` only on the model ARN you use.
- [ ] `ALLOWED_ORIGIN` is the exact frontend origin, not `*`.
