# Firebase setup (sign-in and cloud projects)

Media to Desmos works without an account. Signing in is optional, free, and only unlocks the BETA features.
The site uses Firebase Authentication for sign-in, and Firestore for the cloud projects BETA feature.

Until the steps below are done, `src/account/firebase-config.ts` holds `null`. Sign-in then shows "Sign-in is
not configured yet" and every BETA feature stays locked. Nothing else on the site changes.

## Steps for the site owner

1. **Create a Firebase project.** Open <https://console.firebase.google.com>, choose **Create a project** and
   name it (for example `mediatodesmos`). Google Analytics is not needed, so you can turn it off.

2. **Register the web app.** On the project overview, choose **Add app**, then the **Web** platform. Give it a
   nickname such as `Media to Desmos` and leave **Firebase Hosting** unticked (the site is hosted on GitHub
   Pages). Choose **Register app**. Firebase then shows a `firebaseConfig` object. Keep that page open for step 5.

3. **Turn on the sign-in providers.** Go to **Build > Authentication**, choose **Get started**, then open the
   **Sign-in method** tab.
   - **Google:** choose it, switch **Enable** on, pick a support email, and save.
   - **Email/Password:** choose it, switch the first option (**Email/Password**) on, and save. Leave
     **Email link (passwordless sign-in)** off: the site does not use it.

4. **Add the authorised domains.** In **Authentication > Settings > Authorized domains**, choose **Add domain**
   and add `mediatodesmos.github.io`. Check that `localhost` is in the list too (Firebase adds it by default, so
   add it only if it is missing). Leave the `<your-project>.firebaseapp.com` entry in place: the Google sign-in
   window runs on it.

5. **Paste the config.** In `src/account/firebase-config.ts`, replace `null` with the object from step 2:

   ```ts
   export const firebaseConfig: FirebaseOptions | null = {
     apiKey: 'AIza...',
     authDomain: 'your-project.firebaseapp.com',
     projectId: 'your-project',
     storageBucket: 'your-project.firebasestorage.app',
     messagingSenderId: '1234567890',
     appId: '1:1234567890:web:abc123',
   };
   ```

   This config only identifies the project and is meant to be public, so it is safe to commit. Who can sign in
   and what they can read or write is decided by Authentication and by the Firestore rules in step 7.

6. **Create the Firestore database** (needed for cloud projects). Go to **Build > Firestore Database** and
   choose **Create database**. Pick a location close to most visitors (it cannot be changed later) and start in
   **production mode**.

7. **Publish the rules.** Open the **Rules** tab of Firestore, replace everything with the contents of
   [`firestore.rules`](firestore.rules), and choose **Publish**.

   Or use the Firebase CLI from this folder (`firebase.json` here points the CLI at the rules):

   ```bash
   cd firebase
   npx firebase-tools login
   npx firebase-tools deploy --only firestore:rules --project your-project
   ```

   The rules let each signed-in person read and write only `users/{their uid}` and everything under it, such as
   `users/{uid}/projects/{id}`. Everything else is denied.

8. **Try it locally.** Run `npm run dev`, open <http://localhost:5180> and choose **Sign in** in the header.
   Sign in with Google, then sign out and create an account with an email and password. When you are signed in,
   the header shows your avatar, and its menu says "BETA features unlocked".

9. **Deploy.** Commit and push to `main`. The GitHub Actions workflow tests, builds and publishes the site to
   GitHub Pages. Then sign in once on <https://mediatodesmos.github.io> to confirm.

## Optional

- **Password reset email:** under **Authentication > Templates**, set the sender name and the app name shown in
  the reset email.
- **Email enumeration protection** is on by default for new projects (**Authentication > Settings > User
  actions**). Keep it on. The site already gives the same reply to a reset request whether or not the address has
  an account.
- **API key restriction:** in the Google Cloud console (**APIs & Services > Credentials**), you can limit the
  browser key to these websites: `https://mediatodesmos.github.io/*`, `http://localhost:5180/*` and
  `https://your-project.firebaseapp.com/*`. If you leave out the `firebaseapp.com` entry, Google sign-in stops
  working.

## Troubleshooting

| What the site says | Why | Fix |
|---|---|---|
| Sign-in is not configured yet. | `src/account/firebase-config.ts` still holds `null`, or the live site was built before you pasted the config. | Do step 5, then deploy. |
| Sign-in isn't set up for this web address yet. | The domain is not authorised (`auth/unauthorized-domain`). | Do step 4. |
| This sign-in method isn't turned on yet. | The provider is off (`auth/operation-not-allowed`). | Do step 3. |
| Sign-in isn't set up correctly on this site yet. | The API key or project in the config is wrong. | Copy the config again from step 2. |
| Google sign-in didn't finish. Allow pop-ups for this site, then try again. | The browser blocked the Google window, so the site tried a full-page redirect instead. Browsers that partition third-party storage can lose the result of that redirect, because the sign-in helper runs on `firebaseapp.com` rather than on `github.io`. | Allow pop-ups for the site. The pop-up is the main sign-in path. |

## What the BETA gate is, and what it is not

- BETA features unlock for any signed-in account. The check runs in the browser: it decides what the interface
  offers, but it is not DRM.
- Data in Firestore is protected by the rules above, not by the gate.
- Signing in sends the account details to Firebase Authentication: the email, plus the name and photo for Google
  accounts.
