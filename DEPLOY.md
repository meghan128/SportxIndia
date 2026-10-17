# Deploying SportX India to Vercel

This guide walks you through deploying your blog to Vercel (free) with a PostgreSQL database, admin CMS, newsletter system, and ad monetization.

## Prerequisites

1. A [Vercel account](https://vercel.com) (free)
2. A [GitHub account](https://github.com) (free)
3. Your domain (optional — Vercel gives you a free `*.vercel.app` URL)

## Step 1: Push the code to GitHub

```bash
cd /home/z/my-project

# Initialize git (if not already)
git init
git add .
git commit -m "SportX India — full CMS blog"

# Create a repo on GitHub first, then:
git remote add origin https://github.com/YOUR_USERNAME/sportx-india.git
git branch -M main
git push -u origin main
```

## Step 2: Create a Vercel Postgres database

1. Go to [vercel.com](https://vercel.com) → Sign up / Log in
2. Go to the **Storage** tab → **Create Database** → **Postgres** (free tier)
3. Name it `sportx-india-db`
4. Copy the `DATABASE_URL` connection string (you'll need it in Step 4)

## Step 3: Import the project on Vercel

1. Go to **Add New → Project**
2. Import your GitHub repo (`sportx-india`)
3. Vercel auto-detects Next.js — keep the defaults

## Step 4: Set environment variables

In the Vercel project settings → **Environment Variables**, add:

| Name | Value | Required |
|------|-------|----------|
| `DATABASE_URL` | Your Vercel Postgres connection string | ✅ Yes |
| `ADMIN_PASSWORD` | A strong password for the admin panel | ✅ Yes |
| `RESEND_API_KEY` | Your Resend API key (for newsletters) | ❌ Optional |
| `NEWSLETTER_FROM` | `newsletter@yourdomain.com` | ❌ Optional |

## Step 5: Deploy

1. Click **Deploy**
2. Wait for the build to complete (~2 minutes)
3. Vercel runs `prisma generate` automatically (see `vercel.json`)

## Step 6: Initialize the database

After the first deploy, you need to create the tables in Postgres and import your 89 articles.

**Option A — Run the seed script via Vercel:**
```bash
# Install Vercel CLI
npm i -g vercel

# Link your project
vercel link

# Set the DATABASE_URL env var locally
export DATABASE_URL="your-vercel-postgres-url"

# Push the schema (use the Vercel/Postgres schema)
npx prisma db push --schema prisma/schema.vercel.prisma

# Seed the database
bun run seed
```

**Option B — Use Prisma Studio:**
```bash
npx prisma studio --schema prisma/schema.vercel.prisma
```

## Step 7: Access the admin panel

1. Go to `your-site.vercel.app/admin`
2. Enter your `ADMIN_PASSWORD`
3. You'll see the dashboard with 5 tabs:
   - **Dashboard** — stats overview
   - **Posts** — manage all articles (publish/quarantine/delete)
   - **Write** — create new articles with the editor
   - **Ads** — paste Google AdSense code into 4 ad zones
   - **Newsletter** — send emails to all subscribers

## Step 8: Set up Google AdSense (monetization)

1. Apply at [adsense.google.com](https://adsense.google.com)
2. Get approved (may take a few days)
3. Create ad units in AdSense
4. Go to your `/admin` → **Ads** tab
5. Paste the ad code into the 4 zones (header, sidebar, in-article, footer)
6. Toggle "Active" → Save
7. Ads appear automatically on your site

## Step 9: Set up newsletter email delivery (optional)

1. Create a free account at [resend.com](https://resend.com) (3,000 emails/month free)
2. Get your API key
3. Add `RESEND_API_KEY` to Vercel env vars
4. Add `NEWSLETTER_FROM` (e.g., `newsletter@yourdomain.com`)
5. Go to `/admin` → **Newsletter** tab → write + send

## Step 10: Add your custom domain (optional)

1. In Vercel → Settings → Domains
2. Add your domain (e.g., `sportxindia.com`)
3. Vercel gives you DNS records to add at your registrar
4. Free SSL is automatic

---

## Cost Summary

| Item | Cost |
|------|------|
| Vercel hosting | $0 (hobby tier) |
| Vercel Postgres | $0 (free tier, 256MB) |
| Resend email | $0 (3,000 emails/month) |
| Google AdSense | $0 (they pay you) |
| Custom domain | ~$10/year |
| **Total monthly** | **$0** |

## Local Development

```bash
# Local dev uses SQLite (no Postgres needed)
bun run dev

# Admin panel at localhost:3000/admin
# Default password: admin123
```

## File Structure

```
prisma/
  schema.prisma          ← SQLite (local dev)
  schema.vercel.prisma   ← PostgreSQL (Vercel production)
  seed.ts                ← Imports 89 articles + moderation
src/
  app/
    admin/               ← Admin CMS (login + dashboard)
    api/admin/           ← Admin API routes (posts, ads, newsletter)
    api/ads/             ← Public ad-fetching API
    page.tsx             ← Public homepage
  components/
    ad-zone.tsx          ← Ad rendering component
  lib/
    admin-auth.ts        ← Password auth logic
```
