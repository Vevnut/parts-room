# Parts Room

Phone-first parts inventory for clearing out the old parts room and moving parts back into labeled bins. Replaces `Parts_Room_Master_List.xlsx`; the status, placement and summary rules match that sheet's formulas (see `src/domain/rules.ts`).

Every device keeps its own copy of the data, so the app works with no signal. When signed in, changes sync between devices through a small API on Vercel and a Neon Postgres database. The newest edit wins; a Part ID taken by another device is flagged for you to rename instead of being overwritten.

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:5173. To use sync locally, copy `.env.example` to `.env.local` and fill in the three values (see Setup). To try it on a phone on the same Wi-Fi, open the "Network" address Vite prints.

## Test

```bash
npm test
```

`server/pgStore.int.test.ts` runs against real Postgres only when `TEST_DATABASE_URL` is set. It deletes all rows in that database, so point it at a separate Neon branch, never production.

## Setup (one time)

1. Import this repo into a new Vercel project (framework: Vite; defaults are fine).
2. In the Vercel project, open Storage, create a Neon Postgres database and connect it. This adds `DATABASE_URL`.
3. Run `npm run make-password` on your computer. Type the app password you want (12+ characters). It prints `APP_PASSWORD_HASH` and `SESSION_SECRET`. Add both in Vercel under Settings → Environment Variables (Production), then redeploy.
4. Put the same three values in `.env.local` and run `npm run db:migrate` to create the tables.
5. Open the site on each device, go to the Sync tab and sign in.

To sign every device out, change `SESSION_SECRET` and redeploy. To change the password, rerun step 3.

## Layout

- `src/` the app (screens, local database, sync engine)
- `server/` sync and sign-in logic shared by the API functions
- `api/` Vercel functions: `/api/login`, `/api/logout`, `/api/session`, `/api/sync`
- `db/schema.sql` Postgres tables
