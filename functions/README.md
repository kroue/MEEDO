# Account-management Cloud Functions

These are **not deployed**. The admin console currently creates accounts in the
browser instead — see `lib/firebase/accountBackend.ts`. Everything here is ready
to switch on when you want it.

## What switching to them buys you

The browser path works, but it needs Identity Platform to accept self-service
sign-up, and the web API key ships in the JavaScript bundle by design. So anyone
who opens the login page can register themselves a Firebase account.

Today that account is useless — every Firestore rule requires a `users/{uid}`
role document, which only an admin can create, so a self-registered account can
authenticate and then read nothing. But the account exists, and it counts
against your Auth quota.

Deploying these functions lets you turn sign-up off completely. It also unlocks
two things the client SDK genuinely cannot do:

- **Disabling an Auth account outright**, revoking its refresh tokens so a
  signed-in device stops working immediately. Without them, "Revoke access"
  writes a `disabled` flag that the security rules enforce — which does cut the
  device off from all data, but the Auth session itself survives.
- **Setting a field reader's password directly.** Readers sign in with a
  username mapped to a synthetic `@meedo.local` address, which receives no mail,
  so Firebase's reset email can never reach them. Right now a forgotten reader
  password means creating the account again.

## Cost

Cloud Functions require the **Blaze (pay-as-you-go)** plan, which needs a
billing account. Blaze includes a free tier of 2M invocations per month; these
four functions run only when an admin creates or changes an account, so realistic
usage here is a few dozen calls a month — comfortably inside it. You are billed
only past the free tier.

## Switching them on

```bash
cd functions && npm install
cd .. && firebase deploy --only functions,firestore:rules
```

Then set this in `.env.local` and rebuild the console:

```
NEXT_PUBLIC_ACCOUNT_ADMIN_BACKEND=functions
```

Finally, in the Firebase console: **Authentication → Settings → User actions**,
uncheck **Enable create (sign-up)**. Verify by creating an account from the Team
page — it should still work, because it now runs as an admin on the server.

## Switching back

Remove `NEXT_PUBLIC_ACCOUNT_ADMIN_BACKEND` (or set it to `client`), rebuild, and
re-enable sign-up in the Firebase console. Deployed functions can stay; nothing
calls them.
