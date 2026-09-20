# Deploying the console

Three ways, in the order they are worth reaching for:

- **[Vercel](#hosted-on-vercel)** — builds from the GitHub repository and hosts
  it. Nothing to configure: this console is a Next.js app and Vercel runs those
  as they are. Start here.
- **[Cloudflare Workers](#hosted-on-cloudflare-workers)** — also builds from the
  repository, but a Worker is not Node, so the console has to be repackaged for
  it and a few things have to be bent to fit. Kept here because it works, not
  because it is easier.
- **[A tunnel from an office PC](#running-the-console-in-the-office)** — the
  console runs on a machine in the office and Cloudflare publishes it. Worth it
  only if the app has to stay on office hardware.

Either way the records live in the cloud database, and either way staff install
the console as a desktop app from the address, which needs HTTPS — both of
these provide it.

---

## Hosted on Vercel

Nothing in the repository needs changing: Vercel builds Next.js apps the way
this one is written, including the pages rendered per request.

### 1. Import the repository

**vercel.com → Add New → Project → Import** `kroue/MEEDO`. Leave the framework
preset, build command and output directory as detected.

### 2. Set the variables

**Settings → Environment Variables**, ticked for Production, Preview and
Development. Next bakes these into the JavaScript at build time, so a build
without them produces a console that loads and then refuses to start:

```
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
```

Copy the values from `.env.local`. They are the public web config — visible in
the browser by design. What protects the records is the security rules.

### 3. Deploy, then let the sign-in know its address

Once the first deployment finishes, add the address Vercel gives you — and any
custom domain — under **Firebase console → Authentication → Settings →
Authorized domains**. Until then the console loads and every sign-in is
refused.

### 4. Install it on the office PCs

Open the address in Edge on each PC: the install page appears, and **Install
MEEDO Admin** puts it on the desktop and in the Start menu.

### After that

Every push to `master` deploys itself. A pull request gets its own preview
address, which is a safe place to try a change before the office sees it.

---

## Hosted on Cloudflare Workers

The console renders some pages per request — an account, a bill, a printed
receipt — so it is not a folder of files that can be uploaded. `npm run cf:build`
packages it into a Worker (see `open-next.config.ts` and `wrangler.jsonc`), with
the static files served from Cloudflare's edge alongside it.

### Settings in the dashboard

| Setting | Value |
|---|---|
| Build command | `npm run cf:build` |
| Deploy command | `npx wrangler deploy` |
| Worker name | `meedo-admin` (from `wrangler.jsonc` — rename there if you use another) |

### Variables the build needs

Next bakes these into the JavaScript **at build time**, so they must be set on
the build environment, not only at runtime. Copy the values from `.env.local`:

```
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
```

They are the public web config — visible in the browser by design. What
protects the records is the security rules, not these values.

Without them the build still succeeds, and the console then refuses to start in
the browser saying which variables are missing.

### Then let the sign-in know its address

Firebase Authentication refuses sign-ins from an address it doesn't recognise,
so the console will load and nobody will be able to log in until you add the
deployed hostname under **Authentication → Settings → Authorized domains**.

### Things worth knowing

- **"Retry deployment" rebuilds the same commit**, not the newest one. After
  pushing a fix, start a fresh deployment or push again — retrying will keep
  failing on the old code.
- **The build uses webpack, not Turbopack**, and takes a minute or two longer
  because of it. The Worker needs a webpack resolution step (browser builds of
  the backend SDK, which a Worker can run and the Node ones it cannot), and
  Turbopack does not run it.
- **`npm warn allow-scripts` in the log is fine.** Those packages ship their
  binaries as platform packages rather than relying on install scripts.

### Checking a change before pushing it

```bash
npm run cf:build     # package it exactly as Cloudflare does
npx wrangler dev     # run that Worker locally, http://localhost:8787
```

---

# Running the console in the office

The console runs on one office PC and is reached by the other machines over a
Cloudflare Tunnel. The tunnel makes an **outbound** connection to Cloudflare, so
nothing has to be opened on the office firewall and the PC needs no fixed public
IP. Cloudflare terminates HTTPS, which is what lets staff install the console as
a desktop app — browsers only offer that over `https://`.

```
Office PC                          Cloudflare                     Staff PCs
┌──────────────────────┐           ┌──────────┐                   ┌─────────┐
│ next start  :3000    │◀─────────▶│  tunnel  │◀───── https ─────▶│  Edge   │
│ cloudflared (service)│  outbound │   edge    │   meedo.example   │ (app)   │
└──────────────────────┘           └──────────┘                   └─────────┘
```

The records themselves stay where they are — in the cloud database — so the
office PC being off means the console is unreachable, not that anything is lost.

---

## What you need first

| Thing | Why | Who |
|---|---|---|
| A Cloudflare account (free) | Runs the tunnel | You |
| A domain in that account | Gives a fixed address like `meedo.example.ph`. Without one the tunnel gets a random address that changes on every restart, which is no good for staff | You |
| `cloudflared` on the office PC | The tunnel itself | Installed once |
| The console built and running | What the tunnel points at | `npm run build` then `npm start` |

> A domain is the one thing with a cost — roughly ₱600–1,200 a year. If the
> office already has one for its email or website, it can be used: only the
> subdomain (`meedo.`) is taken, the rest is untouched.

---

## 1. Install the tunnel

```powershell
winget install --id Cloudflare.cloudflared
```

Close and reopen the terminal afterwards so `cloudflared` is on the PATH.

## 2. Sign in and create the tunnel

```powershell
cloudflared tunnel login
```

This opens a browser. Sign in and pick the domain the console should sit under.

```powershell
cloudflared tunnel create meedo-console
cloudflared tunnel route dns meedo-console meedo.<your-domain>
```

The first command prints a tunnel ID and writes a credentials file under
`C:\Users\<you>\.cloudflared\`. The second points the address at it.

## 3. Point the tunnel at the console

Copy `deploy/cloudflared-config.yml` from this repository to
`C:\Users\<you>\.cloudflared\config.yml` and fill in the two placeholders — the
tunnel ID and the hostname.

## 4. Run both as services

So the console survives a reboot and doesn't depend on anyone staying logged in.

**The tunnel:**

```powershell
cloudflared service install
```

**The console:** register `deploy\start-console.cmd` as a scheduled task that
runs at startup, as the machine account:

```powershell
schtasks /create /tn "MEEDO Console" /tr "\"C:\path\to\water-billing-admin\deploy\start-console.cmd\"" /sc onstart /ru SYSTEM /rl HIGHEST /f
schtasks /run /tn "MEEDO Console"
```

## 5. Let the sign-in know its new address

Firebase Authentication refuses sign-ins from an address it doesn't recognise,
so the console will load but nobody can log in until you add it:

**Firebase console → Authentication → Settings → Authorized domains → Add
domain** → `meedo.<your-domain>`.

## 6. Check it

From another PC, open `https://meedo.<your-domain>`. You should get the install
page, then be able to sign in. Install it from there: **⋯ → Apps → Install this
site as an app**.

---

## Putting a lock on the door

The tunnel address is public: anyone who knows it reaches the sign-in page. The
records are protected by the security rules and by needing an account, but for a
government office it is worth not showing the door at all.

**Cloudflare Zero Trust → Access → Applications → Add an application** →
Self-hosted → your hostname → policy: *Allow* → *Emails* → list the staff
addresses. They then get a one-time code by email before the console even loads.
Free for up to 50 users.

---

## Shipping an update

The console is a **built** app: editing the code changes nothing until it is
rebuilt and restarted. This is the step that has caught us out before.

```powershell
cd C:\path\to\water-billing-admin
git pull                 # if the code comes from the repository
npm ci                   # only when dependencies changed
npm run build
schtasks /end /tn "MEEDO Console"
schtasks /run /tn "MEEDO Console"
```

`deploy\update-console.cmd` does all of that in one go.

Then, in the Cloudflare dashboard, **Caching → Configuration → Purge
Everything**, so no PC is served yesterday's files.

---

## When something is wrong

| What you see | Usually means |
|---|---|
| The address doesn't resolve | The DNS route wasn't created, or the domain isn't on Cloudflare |
| "Error 1033" / tunnel error page | `cloudflared` isn't running on the office PC |
| The page loads but sign-in fails | The hostname isn't in Firebase's authorized domains (step 5) |
| Staff see an old version | The console wasn't rebuilt, or Cloudflare's cache wasn't purged |
| No install option in Edge | Not on `https://`, or the service worker didn't register — check the browser console |

Useful checks on the office PC:

```powershell
cloudflared tunnel info meedo-console     # is the tunnel connected
curl http://localhost:3000/login          # is the console itself up
Get-Service cloudflared                   # is the service running
```
