'use strict';

const SPREADSHEET_ID = '1eOy1Z9wXGy3W7rVR-b-eqK7M47-xSkw_Co-u9a7H_3c';
const READ_RANGE = 'Applications!A2:A';
const FIRST_DATA_ROW = 2;
const SHEETS_VALUES_URL =
  `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(READ_RANGE)}`;

const elements = {
  currentUrl: document.getElementById('current-url'),
  status: document.getElementById('status'),
  statusTitle: document.getElementById('status-title'),
  statusMessage: document.getElementById('status-message'),
  connectButton: document.getElementById('connect-button'),
  checkButton: document.getElementById('check-button')
};

let currentUrl = null;
let requestInProgress = false;

function setStatus(kind, title, message) {
  elements.status.className = `status status--${kind}`;
  elements.statusTitle.textContent = title;
  elements.statusMessage.textContent = message;
}

function setButtons({ showConnect = false, showCheck = false, disabled = false } = {}) {
  elements.connectButton.hidden = !showConnect;
  elements.checkButton.hidden = !showCheck;
  elements.connectButton.disabled = disabled;
  elements.checkButton.disabled = disabled;
}

function queryActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(Array.isArray(tabs) ? tabs[0] : undefined);
    });
  });
}

function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      // Chrome versions expose either the legacy token string or a
      // GetAuthTokenResult object to callback-based callers.
      const token = typeof result === 'string' ? result : result?.token;
      if (typeof token !== 'string' || token.length === 0) {
        reject(new Error('Google did not return an OAuth token.'));
        return;
      }

      resolve(token);
    });
  });
}

function removeCachedAuthToken(token) {
  return new Promise((resolve, reject) => {
    chrome.identity.removeCachedAuthToken({ token }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve();
    });
  });
}

async function readResponseBody(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function googleErrorDetails(body) {
  const error = body && typeof body === 'object' ? body.error : null;
  const message = error && typeof error.message === 'string' ? error.message : '';
  const errors = error && Array.isArray(error.errors) ? error.errors : [];
  const reasons = errors
    .map((item) => (item && typeof item.reason === 'string' ? item.reason : ''))
    .filter(Boolean);

  if (Array.isArray(error?.details)) {
    for (const detail of error.details) {
      if (detail && typeof detail.reason === 'string') {
        reasons.push(detail.reason);
      }
    }
  }

  return { message, reasons };
}

function classifyApiError(status, body) {
  const { message, reasons } = googleErrorDetails(body);
  const combined = `${message} ${reasons.join(' ')}`.toLowerCase();

  if (
    status === 403 &&
    (combined.includes('accessnotconfigured') ||
      combined.includes('servicedisabled') ||
      combined.includes('api has not been used') ||
      combined.includes('api is disabled'))
  ) {
    return {
      title: 'Google Sheets API unavailable',
      message: 'Enable Google Sheets API in the OAuth client’s Google Cloud project, then try again.'
    };
  }

  if (status === 403 || status === 404) {
    return {
      title: 'Spreadsheet permission denied',
      message: 'Use a Google account that can open the private spreadsheet and confirm the Applications tab exists.'
    };
  }

  if (status >= 500) {
    return {
      title: 'Google Sheets API unavailable',
      message: 'Google Sheets could not complete the request. Please try again shortly.'
    };
  }

  return {
    title: 'Unexpected API response',
    message: `Google Sheets returned HTTP ${status}. Please try again.`
  };
}

async function fetchColumn(token) {
  return fetch(SHEETS_VALUES_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    },
    cache: 'no-store'
  });
}

async function fetchColumnWithOneAuthRetry(initialToken, interactive) {
  let token = initialToken;
  let response = await fetchColumn(token);

  if (response.status !== 401) {
    return response;
  }

  await removeCachedAuthToken(token);
  token = await getAuthToken(interactive);
  response = await fetchColumn(token);

  if (response.status === 401) {
    await removeCachedAuthToken(token).catch(() => {});
  }

  return response;
}

function findMatchingRow(values, activeUrl) {
  const target = activeUrl.trim();

  for (let index = 0; index < values.length; index += 1) {
    const row = values[index];
    if (!Array.isArray(row) || typeof row[0] !== 'string') {
      continue;
    }

    if (row[0].trim() === target) {
      return FIRST_DATA_ROW + index;
    }
  }

  return null;
}

function isUsableTabUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isAuthorizationUnavailable(error) {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return (
    message.includes('oauth2 not granted') ||
    message.includes('oauth2 request failed') ||
    message.includes('user did not approve') ||
    message.includes('not signed in') ||
    message.includes('interaction required')
  );
}

function showAuthError(error) {
  const message = error instanceof Error ? error.message : 'Unknown authorization error.';
  setStatus(
    'error',
    'Google authorization failed',
    `${message} Check the OAuth client ID and extension ID, then try again.`
  );
  setButtons({ showConnect: true, showCheck: true });
}

async function runCheck({ interactive }) {
  if (requestInProgress || !currentUrl) {
    return;
  }

  requestInProgress = true;
  setButtons({ disabled: true });
  setStatus(
    interactive ? 'loading' : 'checking',
    interactive ? 'Connecting Google account' : 'Checking the current page',
    interactive ? 'Complete the Google authorization prompt.' : 'Looking for an existing Google authorization.'
  );

  try {
    let token;
    try {
      token = await getAuthToken(interactive);
    } catch (error) {
      if (!interactive && isAuthorizationUnavailable(error)) {
        setStatus(
          'connected',
          'Google account not connected',
          'Connect the Google account that has read access to the private spreadsheet.'
        );
        setButtons({ showConnect: true, showCheck: true });
        return;
      }

      showAuthError(error);
      return;
    }

    setStatus('loading', 'Loading Applications', 'Reading only the Position Link column from Google Sheets.');

    let response;
    try {
      response = await fetchColumnWithOneAuthRetry(token, interactive);
    } catch (error) {
      if (error instanceof TypeError) {
        setStatus('error', 'Network error', 'Could not reach Google Sheets. Check your connection and try again.');
        setButtons({ showCheck: true });
        return;
      }

      showAuthError(error);
      return;
    }

    const body = await readResponseBody(response);

    if (!response.ok) {
      if (response.status === 401) {
        setStatus(
          'error',
          'Google authorization expired',
          'The cached authorization was rejected and could not be refreshed. Connect your Google account again.'
        );
        setButtons({ showConnect: true, showCheck: true });
        return;
      }

      const apiError = classifyApiError(response.status, body);
      setStatus('error', apiError.title, apiError.message);
      setButtons({ showCheck: true });
      return;
    }

    if (!body || typeof body !== 'object') {
      setStatus('error', 'Unexpected API response', 'Google Sheets returned data in an unexpected format.');
      setButtons({ showCheck: true });
      return;
    }

    const values = body.values === undefined ? [] : body.values;
    if (!Array.isArray(values) || values.some((row) => !Array.isArray(row))) {
      setStatus('error', 'Unexpected API response', 'The Position Link column was not returned in the expected format.');
      setButtons({ showCheck: true });
      return;
    }

    const matchingRow = findMatchingRow(values, currentUrl);
    if (matchingRow !== null) {
      setStatus('found', 'Found in Applications', `Exact match in spreadsheet row ${matchingRow}.`);
    } else {
      const detail = values.length === 0
        ? 'The Position Link column is empty.'
        : 'No exact trimmed match was found in the Position Link column.';
      setStatus('not-found', 'Not found in Applications', detail);
    }

    setButtons({ showCheck: true });
  } finally {
    requestInProgress = false;
    elements.connectButton.disabled = false;
    elements.checkButton.disabled = false;
  }
}

async function initialize() {
  setButtons({ disabled: true });

  try {
    const activeTab = await queryActiveTab();
    const tabUrl = activeTab && typeof activeTab.url === 'string' ? activeTab.url : '';
    elements.currentUrl.textContent = tabUrl || 'Unavailable';

    if (!isUsableTabUrl(tabUrl)) {
      setStatus(
        'error',
        'Active page URL unavailable',
        'Open a regular http:// or https:// page. Chrome blocks access to restricted pages such as chrome:// URLs.'
      );
      setButtons();
      return;
    }

    currentUrl = tabUrl;
    await runCheck({ interactive: false });
  } catch (error) {
    elements.currentUrl.textContent = 'Unavailable';
    const message = error instanceof Error ? error.message : 'Chrome did not provide the active tab URL.';
    setStatus('error', 'Active page URL unavailable', message);
    setButtons();
  }
}

elements.connectButton.addEventListener('click', () => {
  void runCheck({ interactive: true });
});

elements.checkButton.addEventListener('click', () => {
  void runCheck({ interactive: false });
});

void initialize();
