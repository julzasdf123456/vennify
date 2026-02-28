# Installation & Deployment Guide (Vennify)

This guide covers local setup for the Vennify app (frontend + API + Postgres).

For production deployment on Vercel + Render + Neon, see:
- `docs/DEPLOY_VERCEL_RENDER_NEON.md`

## Prerequisites
- Node.js 18+ (recommended 20+)
- npm 9+
- PostgreSQL 14+

## Local Setup

1. Install dependencies
```bash
npm install
```

2. Create the database (if it does not exist)
```bash
createdb vennify
```

3. Configure environment variables
Create a `.env` file in the project root:
```env
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/vennify?schema=public"
PORT=4000
SESSION_SECRET="replace-with-a-long-random-string"
GOOGLE_CLIENT_ID="replace-with-your-google-client-id"
GOOGLE_CLIENT_SECRET="replace-with-your-google-client-secret"
GOOGLE_CALLBACK_URL="http://localhost:4000/auth/google/callback"
CORS_ORIGIN="http://localhost:5173"
```
Notes:
- If your password has special characters, URL-encode them (e.g. `@` becomes `%40`).
- Example: `bl@ck` -> `bl%40ck`

4. Run Prisma migrations
```bash
npx prisma migrate dev --name init
```

5. Start the API server
```bash
npm run dev:api
```

6. Start the frontend (new terminal)
```bash
npm run dev
```

Frontend: http://localhost:5173  
API: http://localhost:4000

## Local Sanity Check
- Open the app in the browser.
- Drag modules/items, refresh, and confirm state persists.

## Cloud Migration Checklist

### 1) Provision a Postgres Database
Set up a managed Postgres instance (e.g. Neon, Supabase, Render, Railway, RDS).
Copy the connection string and set it as `DATABASE_URL`.

### 2) Configure API Environment
Required:
- `DATABASE_URL` (cloud connection string)
- `PORT` (whatever your host provides; if fixed, set to `4000`)
- `SESSION_SECRET` (long random string)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (Google OAuth credentials)
- `GOOGLE_CALLBACK_URL` (public API callback URL)
- `CORS_ORIGIN` (public frontend URL)

Optional:
- `CORS_ORIGIN` (recommended when you deploy frontend + API separately)

### 3) Run Migrations in the Cloud
From your deployment environment (CI/CD or SSH):
```bash
npx prisma migrate deploy
```

### 4) Deploy the API
Recommended build command (if your host needs it):
```bash
npm install
```
Run command:
```bash
npm run dev:api
```
For production, swap to a process manager (e.g. `node server/index.js` after compiling) or keep `tsx` if your host allows it.

### 5) Deploy the Frontend
Build:
```bash
npm run build
```
Host the `dist/` folder (Vercel, Netlify, or any static host).

Set the API URL for the frontend in your hosting environment:
```env
VITE_API_URL="https://your-api-domain.com"
```

### 6) Validate
- Load the app
- Create a module/item
- Refresh
- Confirm data persists across sessions

## Common Issues

- **Cannot connect to Postgres**
  - Verify host, port, username, password, and database name.
  - Ensure your DB allows inbound connections from your API host.

- **Password errors with special characters**
  - URL-encode special characters in `DATABASE_URL`.

- **CORS errors**
  - Update API CORS config to allow your frontend domain.

## Optional Next Steps
- Add authentication (Google OAuth)
- Add workspace/project routing (per team/project slug)
- Add user and team RBAC
