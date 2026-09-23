# Applications URL Checker

A minimal Manifest V3 Chrome extension that checks whether the active tab's exact URL appears in `Applications!A2:A` in a private Google Sheet.

The extension is read-only. It retrieves only column A from the `Applications` tab, compares the active URL locally, and never sends the active URL to Google Sheets as a query or filter.

## Setup (non-expert friendly)

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project, or select an existing project you control.
2. In **APIs & Services → Library**, find **Google Sheets API** and click **Enable**.
3. In **APIs & Services → OAuth consent screen**, configure the consent screen for personal/testing use:
   - Select **External** unless your managed Google Workspace requires **Internal**.
   - Supply the required app name and contact email.
   - Keep the app in **Testing** if this is for personal use.
   - Add your Google account under **Test users**.
   - If Google asks for scopes, add only `https://www.googleapis.com/auth/spreadsheets.readonly`.
4. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select this `applications-url-checker` folder.
5. Copy the extension ID shown on the extension card.
6. Return to Google Cloud Console. Open **APIs & Services → Credentials → Create credentials → OAuth client ID**.
7. Choose application type **Chrome Extension** and enter the copied extension ID as the **Item ID**.
8. Copy the resulting OAuth client ID. Open `manifest.json` and replace exactly:

   ```text
   REPLACE_WITH_YOUR_CHROME_EXTENSION_OAUTH_CLIENT_ID.apps.googleusercontent.com
   ```

   Save the file. Do not add a client secret; Chrome extensions do not store one.
9. Return to `chrome://extensions` and click the extension card's **Reload** button.
10. Open a normal web page, click the extension, choose **Connect Google Account**, and select the Google account that already has permission to open the private spreadsheet.
11. Test one exact URL present in column A and one URL that is absent. The popup displays the current URL, and a match also displays the real spreadsheet row number.

## Matching rules

The active tab URL and each value in `Applications!A2:A` have leading and trailing whitespace removed, then are compared with strict string equality. Nothing else is changed: query parameters, parameter order, fragments, encoding, and trailing slashes all remain significant.

## Keeping an unpacked extension ID stable

Chrome normally derives an unpacked extension ID from the extension's path. Keep this folder in the same location and load that same folder to avoid an ID change. Moving or copying it to a different path/profile may produce a different ID, which no longer matches the OAuth client's Item ID.

For a path-independent stable ID, Chrome supports a manifest `key` containing the public key associated with an extension identity. Do not invent this value and do not put a private key in the extension. One safe route is to package the extension once through Chrome's **Pack extension** workflow, securely retain the generated `.pem` private key outside this project, derive/copy its public key value into the manifest's `key` field, then recreate the OAuth client using the resulting stable extension ID. This is optional for personal development; keeping the folder path stable is simpler.

## Troubleshooting

### `OAuth2 not granted or revoked`

Click **Connect Google Account** and approve access. If the consent screen is in Testing, confirm your account is listed as a test user. Reload the extension after changing OAuth settings.

### Invalid OAuth Client ID

Confirm that the full client ID from Google Cloud replaces the placeholder in `manifest.json`. It normally ends in `.apps.googleusercontent.com`. Do not paste a client secret, web-client ID, or API key.

### Extension ID mismatch

The ID in `chrome://extensions` must exactly match the OAuth Chrome Extension client's Item ID. If the unpacked extension ID changed, update or recreate the OAuth client for the new ID, paste its client ID into the manifest, and reload the extension.

### Google Sheets API not enabled

Enable **Google Sheets API** in the same Google Cloud project that owns the OAuth client. Wait a minute, then use **Check Again**.

### Spreadsheet access denied

Open the spreadsheet directly while signed into the same Google account. The account must already have at least viewer access. The extension never makes the sheet public and cannot grant access.

### Wrong Google account selected

Chrome Identity may reuse the Chrome profile's signed-in account. Ensure that account can open the sheet. If necessary, remove the app's access from the Google Account permissions page, confirm the intended Chrome profile/account, and connect again.

### Empty column

Confirm the sheet tab is named exactly `Applications`, cell A1 contains `Position Link`, and URL values begin in A2. An empty response is treated as an empty column and produces **Not found in Applications**.

### Restricted Chrome pages (`chrome://`, Chrome Web Store, and similar)

Chrome does not expose a usable page URL for some protected pages. Navigate to a normal `http://` or `https://` page and reopen the popup.

### Network or temporary Google API errors

Confirm the computer is online and use **Check Again**. HTTP 401 triggers one cached-token removal and one token refresh attempt; the extension does not retry indefinitely.

## Privacy and permissions

- `activeTab`: reads the URL of the tab only when you invoke the extension.
- `identity`: requests Google OAuth authorization.
- `https://sheets.googleapis.com/*`: calls only the Google Sheets API values endpoint.
- OAuth scope: `https://www.googleapis.com/auth/spreadsheets.readonly` only.

There are no content scripts, remote scripts, analytics, service-account credentials, passwords, embedded access tokens, or spreadsheet write operations.
