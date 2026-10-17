# VeilTranslate setup (Google Cloud + API keys)

Do this once on Mikki’s machine. No secrets belong in git.

## 1. Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project (e.g. `veil-translate`).
3. **APIs & Services → Library** → enable **YouTube Data API v3**.

## 2. OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. User type: **External**.
3. App name: `VeilTranslate` (or similar). Support email: your Gmail.
4. Publishing status: leave as **Testing**.
5. **Test users** → add Mikki’s Google account (the one that owns the YouTube channel).
6. Scopes: you can add manually later; the extension requests  
   `https://www.googleapis.com/auth/youtube.force-ssl` at runtime.

## 3. OAuth client (Web application) for the Chrome extension

Chrome’s `chrome.identity.launchWebAuthFlow` expects a **Web application** client with a Chromium app redirect URI.

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Name: `VeilTranslate Extension`.
4. **Authorized redirect URIs** — add (you need the extension ID first; see next section):

   ```
   https://<EXTENSION_ID>.chromiumapp.org/
   ```

5. Copy the **Client ID** (looks like `xxxx.apps.googleusercontent.com`).  
   Paste it into VeilTranslate **Options → OAuth Client ID**.  
   You do **not** need the client secret in the extension (implicit token flow).

### Find the extension ID

1. `npm run build`, then **Load unpacked** → `extension/dist`.
2. On `chrome://extensions`, copy the **ID** under VeilTranslate.
3. Put that ID into the redirect URI above and save the OAuth client.

### Pin a stable extension ID (recommended)

Unpacked extension IDs change if the path changes. To pin:

1. Generate a key once:

   ```bash
   openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out extension.pem
   openssl rsa -in extension.pem -pubout -outform DER | openssl base64 -A
   ```

2. Add to `extension/manifest.json` (and keep `extension.pem` **out of git** — already gitignored via `*.pem`):

   ```json
   "key": "<paste base64 public key from step 1>"
   ```

3. Rebuild, reload unpacked — ID stays stable. Update the Cloud redirect URI if needed.

The Options page also shows the live redirect URI via `chrome.identity.getRedirectURL()`.

## 4. Gemini API key (default engine)

1. Open [Google AI Studio](https://aistudio.google.com/).
2. Create an API key (free tier).
3. Paste into Options → **Gemini API key**.

## 5. DeepL Free (optional)

1. Sign up at [DeepL API Free](https://www.deepl.com/pro-api) (Free plan keys end with `:fx`).
2. Paste into Options → **DeepL Free API key**.
3. Unsupported languages fall back to Gemini if a Gemini key is also set.

## 6. LibreTranslate (optional, fully local)

```bash
docker run -d -p 5000:5000 libretranslate/libretranslate
```

Options → Engine **LibreTranslate**, URL `http://localhost:5000`.

## 7. First dry-run on a test video

1. Options: select a few languages, **Dry-run ON** (default).
2. Open an **unlisted** test video in Studio → **Translate**.
3. Confirm preview looks good.
4. Only then turn dry-run **off** and click **Publish** (Mikki OK required before real channel videos).

## 8. CLI secrets (optional)

```bash
cp .cli-secrets.example.json .cli-secrets.json
```

For CLI OAuth, create a second OAuth client (Desktop or Web) with redirect  
`http://127.0.0.1:7890/callback`, and put `oauthClientId` + `oauthClientSecret` in `.cli-secrets.json`.

## Quota notes

- `videos.list` ≈ 1 unit, `videos.update` ≈ 50 units.
- Default project quota 10 000 units/day is enough for normal localization batches.
