# CUBE Tuition mobile app (iOS + Android)

The portal ships as a native app using **Capacitor**: a native shell that loads
the live portal (`https://portal.cubetuition.com.au`) with native push
notifications. Web deploys update the app instantly — the stores are only
needed again when the native shell itself changes.

**In this repo**

| Piece | Where |
|---|---|
| Capacitor config (app id `au.com.cubetuition.portal`, name "CUBE Tuition") | `capacitor.config.json` |
| iOS Xcode project | `ios/` |
| Android Gradle project | `android/` |
| App icons + splash screens (generated from `app/icon.svg`) | inside `ios/` & `android/`; source in `assets/logo.png` |
| Push registration on the web side (no-op in normal browsers) | `components/NativePushRegistrar.js`, mounted in `app/layout.js` |
| Device-token table + RLS | `migrations/20260727_device_push_tokens.sql` |

Regenerate icons after a logo change: `npx capacitor-assets generate` (see
flags in git history). After changing `capacitor.config.json`: `npx cap sync`.

---

## 1. Accounts to register (one-time)

1. **Apple Developer Program** — https://developer.apple.com/programs/enroll/
   - US$99/year. Enrol as an **organisation** (needs an ABN + D-U-N-S number —
     free, but organisation verification can take a few days) or as an
     individual to start faster (the seller name then shows a person, not
     "CUBE Tuition"; you can migrate later).
2. **Google Play Console** — https://play.google.com/console/signup
   - US$25 once. Organisation accounts also ask for identity verification.
3. **Firebase** (free) — https://console.firebase.google.com
   - Create a project "CUBE Tuition". This powers push delivery (FCM) for
     Android **and** iOS.

## 2. Machine setup (this Mac)

- **Xcode** from the Mac App Store (large download), then open it once to
  accept the licence. CocoaPods is **not** needed — Capacitor 8 uses Swift
  Package Manager.
- **Android Studio** from https://developer.android.com/studio (installs the
  Android SDK).

## 3. Push notification wiring (once accounts exist)

**Android**: Firebase console → project settings → *Add app* → Android, package
`au.com.cubetuition.portal` → download **`google-services.json`** into
`android/app/`. (The Gradle template auto-applies the plugin when the file
exists.)

**iOS**: Apple developer portal → Keys → create an **APNs Auth Key** (.p8).
Upload it in Firebase → project settings → Cloud Messaging → Apple app
configuration (add an iOS app with the same bundle id first). In Xcode, select
the App target → *Signing & Capabilities* → **+ Capability → Push
Notifications** (one click).

**Database**: apply `migrations/20260727_device_push_tokens.sql` (table +
RLS). Signed-in app users then upsert their device token automatically via
`NativePushRegistrar`.

**Sending**: an edge function reads `device_push_tokens` and calls the FCM
HTTP v1 API with the Firebase service-account key (store it as a function
secret). Build this when the first notification use-case lands (e.g. invoice
issued, homework posted) — trigger it from the existing flows.

## 4. Build & run locally

```sh
npx cap open ios       # opens Xcode — pick your team under Signing, run on a device/simulator
npx cap open android   # opens Android Studio — run on emulator/device
```

The app loads the live portal, so there's nothing to "build" web-side; sign in
as any user and the full portal works. Test on a phone: login, booklets/PDFs,
payments pages, notification permission prompt after login.

## 5. Store submission

**App Store (via Xcode → Product → Archive → Distribute):**
- App Store Connect listing: name "CUBE Tuition", subtitle, screenshots
  (6.7" iPhone + 12.9" iPad if iPad enabled), privacy policy URL (host one on
  cubetuition.com.au), support URL, category *Education*.
- **App Privacy** questionnaire: you collect name, email, user content tied to
  identity (from the portal accounts).
- **Review notes: include a demo student login and a demo admin login** —
  Apple must be able to sign in. Mention notifications are for class/homework
  /billing updates.
- Wrapper-app rejection risk (guideline 4.2) is mitigated by native push +
  the app being a private client portal (not a repackaged public website) —
  say exactly that in the review notes.

**Play Store (Android Studio → Build → Generate Signed App Bundle):**
- Create an upload keystore when prompted — **back it up**; losing it is
  permanent. Upload the `.aab` in Play Console, fill the listing + Data safety
  form, add the same demo logins.

## 6. Not done yet / gotchas

- `device_push_tokens` migration is **written but not applied** to production.
- Firebase files (`google-services.json`, APNs key) are **not** in the repo —
  add them after account setup. Never commit the `.p8` key or the Firebase
  service-account JSON.
- Magic-link / OAuth logins would need deep-link handling; the portal's
  password logins work as-is.
- Wide admin tables (Master DB, payroll) are desktop-oriented; usable but
  cramped on a phone. Worth a mobile pass on the top admin tasks later.
