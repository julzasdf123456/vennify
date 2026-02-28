# Deploy Vennify to Vercel + Render + Neon

This guide deploys:
- Frontend (`Vite + React`) to Vercel
- API (`Express + Socket.IO + Prisma`) to Render
- PostgreSQL to Neon
- Domain via Cloudflare (`venify.hashed.it.com` + `api.venify.hashed.it.com`)

## 1) Neon database

1. Create a Neon project and database.
2. Copy the connection string and save it for Render:
```env
DATABASE_URL=postgresql://...
```

## 2) Deploy API to Render

Create a new **Web Service** from this repo.

Recommended Render settings:
- `Root Directory`: repo root
- `Build Command`: `npm install && npx prisma generate && npx prisma migrate deploy`
- `Start Command`: `npm run start:api`

Set these Render environment variables:
```env
DATABASE_URL=postgresql://...
PORT=10000
SESSION_SECRET=<long-random-secret>
GOOGLE_CLIENT_ID=<google-client-id>
GOOGLE_CLIENT_SECRET=<google-client-secret>
GOOGLE_CALLBACK_URL=https://api.venify.hashed.it.com/auth/google/callback
CORS_ORIGIN=https://venify.hashed.it.com
NODE_ENV=production
COOKIE_SECURE=true
COOKIE_SAME_SITE=none
```

Notes:
- `CORS_ORIGIN` supports comma-separated values. Add staging/frontends like:
  `https://venify.hashed.it.com,https://vennify-preview.vercel.app`
- If you only use the custom domain, keep just one value.

## 3) Deploy frontend to Vercel

Import the same repo in Vercel.

This repo includes `vercel.json` with:
- `buildCommand`: `npm run build:web`
- `outputDirectory`: `dist`
- SPA rewrite to `index.html`

Set Vercel environment variable:
```env
VITE_API_URL=https://api.venify.hashed.it.com
```

## 4) Add domains in Cloudflare

Create DNS records:

1. Frontend
- Type: `CNAME`
- Name: `venify`
- Target: Vercel CNAME target (from Vercel domain settings)

2. API
- Type: `CNAME`
- Name: `api.venify`
- Target: Render service domain

After records propagate:
- Add `venify.hashed.it.com` in Vercel project domains
- Add `api.venify.hashed.it.com` as custom domain in Render

## 5) Configure Google OAuth

Google Cloud Console OAuth client:

1. Authorized JavaScript origins:
- `https://venify.hashed.it.com`

2. Authorized redirect URIs:
- `https://api.venify.hashed.it.com/auth/google/callback`

## 6) Production checks

1. Open `https://venify.hashed.it.com`
2. Login with Google
3. Create module and item
4. Refresh and confirm persistence
5. Open a second account in invited workspace and confirm realtime sync

## 7) Troubleshooting

### OAuth `redirect_uri_mismatch`
- Verify `GOOGLE_CALLBACK_URL` exactly matches Google Console redirect URI.

### CORS or cookie issues
- Confirm:
  - frontend origin is in `CORS_ORIGIN`
  - `COOKIE_SECURE=true`
  - `COOKIE_SAME_SITE=none`
  - both domains use HTTPS

### Prisma migration issues
- Run manually in Render Shell:
```bash
npx prisma migrate deploy
```

### Vercel build fails
- This repo currently uses `npm run build:web` for Vercel (`vite build`) to avoid strict TypeScript checks from `npm run build`.
