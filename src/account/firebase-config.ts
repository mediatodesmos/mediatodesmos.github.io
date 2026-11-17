import type { FirebaseOptions } from 'firebase/app';

/**
 * The Firebase web app config for Media to Desmos.
 *
 * Site owner: paste the public web config from the Firebase console here
 * (Project settings > General > Your apps > SDK setup and configuration > Config),
 * replacing `null` with the object. firebase/README.md has the full steps.
 *
 * This config only identifies the project, so it is safe to commit. Firebase Auth and
 * the Firestore rules in firebase/firestore.rules decide who can do what.
 *
 * While this is `null`, sign-in reports "Sign-in is not configured yet" and BETA features stay locked.
 */
export const firebaseConfig: FirebaseOptions | null = null;
