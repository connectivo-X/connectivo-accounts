# Connectivo — Accounts and Cash Book

A lightweight web app that replaces the Excel cash book and monthly expense report.

## What is inside

| File | What it does |
|---|---|
| `index.html` | All the screens: login page, header, sidebar, cash book, expense report |
| `app.js` | All the logic: login, saving entries, ledger totals, report grid |
| `README.md` | This file |

No frameworks, no build step. Two files. If something breaks, it is in one of them.

## Screens

**Login** — real sign-in, using Supabase Authentication. Sign in with the
email and password created for each person in the Supabase dashboard
(Authentication → Users). There are no demo accounts anymore.

**Cash Book** — the Dr. / Cr. ledger, one page per month, with Balance B/D,
Sub total, Balance C/D and Total, exactly like the Excel sheet. The closing
balance of one month becomes the opening balance of the next automatically.

**Expense Report** — categories down the side, months (or days) across the top,
with group totals and a YTD column, exactly like the Excel report.

Both screens read the same entries, stored in Supabase — everyone who logs in
sees the same shared cash book and report. You record a transaction once and
it shows up in both, for every user.

## The database (Supabase)

Four files matter here:

| File | What it does |
|---|---|
| `index.html` | All the screens |
| `app.js` | All the logic — never needs your project keys edited into it |
| `config.js` | Your Supabase Project URL and anon key — the only file with project-specific values |
| `supabase-schema.sql` | Run once in the Supabase SQL Editor to create the tables |

If you ever move to a different Supabase project, only `config.js` needs to change.

**Never put the Supabase database password in any of these files.** The anon
key in `config.js` is safe to commit — it only works together with the Row
Level Security rules created by `supabase-schema.sql`, which require a
logged-in user for every read and write.

---

## Putting it on GitHub

### 1. Create the repository
1. Go to https://github.com and sign in (create a free account if you do not have one).
2. Click **+** in the top right, then **New repository**.
3. Name it `connectivo-accounts`.
4. Choose **Private** if you do not want the code public. (See the warning below about data.)
5. Click **Create repository**.

### 2. Upload the files
1. On the new repository page click **uploading an existing file**.
2. Drag `index.html`, `app.js` and `README.md` into the box.
3. Write a short message such as `first version` and click **Commit changes**.

### 3. Turn on GitHub Pages
1. Open the **Settings** tab of the repository.
2. Click **Pages** in the left menu.
3. Under **Source** choose **Deploy from a branch**.
4. Branch: `main`, folder: `/ (root)`. Click **Save**.
5. Wait one or two minutes, then refresh. GitHub shows the live address, something like
   `https://<your-username>.github.io/connectivo-accounts/`

That address is the live app. Open it in any browser, on desktop or phone.

### 4. Making a change later
Open the file on GitHub, click the pencil icon, edit, then **Commit changes**.
The live site updates by itself in about a minute.

---

## Two things to understand before the office starts using it

### Each person has their own separate copy of the data
Right now the entries are saved inside the browser of whoever is using the app.
The Account Manager's entries stay on the Account Manager's computer. The CEO
opening the same link sees an empty book, not the same numbers.

This is fine for testing the screens. It is **not** the shared office cash book yet.
Sharing needs a database, which is the next step (Supabase).

### The login screen does not protect anything yet
Anyone who opens the link can get past it, because the check happens in the
browser where anyone can read it. It is the correct layout, but not real security.
Real accounts and passwords come with Supabase too.

Because of both points: **do not put real salary figures or real bank balances in
this version**, and keep the repository **private** while testing.

---

## What comes next

1. **Supabase** — one shared database so everyone sees the same book, plus real
   logins and real roles (Developer / Account Manager / CEO).
2. **Role permissions** — CEO views reports, Account Manager records entries,
   Developer manages the system.
3. **Export** — download a month as Excel or PDF.
4. **Payable / receivable** — the fuller accounting you wanted, added step by step.
