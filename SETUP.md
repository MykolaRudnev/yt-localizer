# Setup guide

Step-by-step credentials for VeilTranslate. **No secrets belong in git** — paste keys only into the extension Options page (or a local `.cli-secrets.json` for the CLI).

## 1. Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project (e.g. `veil-translate`).
3. **APIs & Services → Library** → enable **YouTube Data API v3**.

## 2. OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. User type: **External**.
3. App name: `VeilTranslate` (or similar). Support email: your Google account email.
4. Publishing status: leave as **Testing** (fine for personal / small-team use).
5. **Test users** → add **every** Google account you will connect (each channel or Brand Account login). While the app is in Testing, Google only allows listed test users — add each account before **Add channel** in the popup.
6. Scopes: the extension requests  
   `https://www.googleapis.com/auth/youtube.force-ssl` at runtime (you can add it on the consent screen if prompted).

## 3. OAuth client (Web application) for the Chrome extension

Chrome’s `chrome.identity.launchWebAuthFlow` expects a **Web application** client (not “Chrome Extension”) with a Chromium app redirect URI.

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Name: `VeilTranslate Extension`.
4. **Authorized redirect URIs** — add (you need the extension ID first; see below):

   ```
   https://<EXTENSION_ID>.chromiumapp.org/
   ```

5. Copy the **Client ID** only (looks like `xxxx.apps.googleusercontent.com`).  
   Paste it into VeilTranslate **Options → Google OAuth Client ID**.  
   You do **not** need the client secret in the extension (token flow via `chrome.identity`).

The Options page shows the live redirect URI via `chrome.identity.getRedirectURL()` once the extension is loaded.

### Find the extension ID

1. `npm run build`, then **Load unpacked** → `extension/dist`.
2. On `chrome://extensions`, copy the **ID** under VeilTranslate.
3. Put that ID into the redirect URI above and save the OAuth client.

### Pin a stable extension ID (recommended)

Unpacked extension IDs change if the install path changes. This repo ships a Manifest `"key"` (a **public** key only) so the ID stays stable for the upstream project.

**Forks should either:**

- **Remove** the `"key"` field from `extension/manifest.json` and use whatever ID Chrome assigns after load unpacked, **or**
- **Generate your own** key pair and pin your ID:

```bash
openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out extension.pem
openssl rsa -in extension.pem -pubout -outform DER | openssl base64 -A
```

1. Paste the base64 public key into `"key"` in `extension/manifest.json`.
2. Keep `extension.pem` **out of git** (`*.pem` is gitignored).
3. Rebuild, reload unpacked — note the new ID on `chrome://extensions`.
4. Set the Cloud Console redirect URI to:

   ```
   https://<YOUR_EXTENSION_ID>.chromiumapp.org/
   ```

Using the upstream `"key"` without changing it keeps the author’s extension ID; that is fine for local testing but forks that publish their own build should use their own key and redirect URI.

## 4. DeepL Free API key (recommended primary)

1. Sign up at [DeepL API](https://www.deepl.com/pro-api) and choose the **Free** plan (keys end with `:fx`).
2. Paste into Options → **DeepL Free API key**.
3. Languages DeepL does not support fall back to Gemini when a Gemini key is also set.

## 5. Gemini API key (fallback / or primary)

1. Open [Google AI Studio](https://aistudio.google.com/).
2. Create an API key (free tier).
3. Paste into Options → **Gemini API key**. Leave model empty for auto-pick of the newest `*-flash` model.

## 6. LibreTranslate (optional, fully local)

```bash
docker run -d -p 5000:5000 libretranslate/libretranslate
```

Options → Engine **LibreTranslate**, URL `http://localhost:5000`.

## 7. Load unpacked and first run

1. `npm ci && npm run build && npm test`
2. Chrome → `chrome://extensions` → **Developer mode** → **Load unpacked** → select `extension/dist`
3. Open the toolbar popup (or Options) and complete the checklist:
   - OAuth Client ID
   - At least one translation key (DeepL and/or Gemini)
4. Popup → **Add channel** → sign in with a test-user account
5. Open an **unlisted** test video in YouTube Studio → **Auto Titles & Description**
6. Keep **Dry-run** ON for the first run → preview → only then turn dry-run off and **Publish**

## 8. Adding more channels / accounts

1. Popup → **Add channel** → pick another Google account or Brand Account (`prompt=select_account`).
2. Each account must already be listed under OAuth **Test users**.
3. Tokens are stored per channel id in `chrome.storage.local`.
4. Options → **Per-channel settings**: languages, protected terms (channel title is seeded automatically), default source language, auto-publish. Engine/API keys stay global.
5. In Studio, VeilTranslate matches the video’s `snippet.channelId` to the connected token — it never writes with another channel’s token.

## 9. CLI secrets (optional)

```bash
cp .cli-secrets.example.json .cli-secrets.json
```

Create a second OAuth client (Desktop or Web) with redirect `http://127.0.0.1:7890/callback`, and put `oauthClientId` + `oauthClientSecret` in `.cli-secrets.json`. See [docs/CLI.md](./docs/CLI.md).

## Quota notes

| API | Typical cost |
|-----|----------------|
| YouTube `videos.list` | ~1 unit |
| YouTube `videos.update` | ~50 units |
| Default YouTube project quota | 10 000 units/day |
| DeepL Free | 500 000 characters/month |
| Gemini free tier | Limits vary by model / region |

See the costs table in [README.md](./README.md).
