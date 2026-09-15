// The cookie UI's markup, shared by the popup and the side panel.
export const APP_MARKUP = `
    <header>
      <h1>Cookie DevTools</h1>
      <div class="header-actions">
        <button id="btn-sidepanel" class="icon-btn" title="Open in side panel" aria-label="Open in side panel" hidden>&#8677;</button>
        <button id="btn-theme" class="icon-btn" title="Toggle dark mode" aria-label="Toggle dark mode">&#9684;</button>
        <button id="btn-settings" class="icon-btn" title="Settings" aria-label="Settings">&#9881;</button>
      </div>
    </header>

    <nav class="tabs">
      <button class="tab active" data-tab="cookies">Cookies</button>
      <button class="tab" data-tab="monitor">Monitor</button>
      <button class="tab" data-tab="profiles">Profiles</button>
    </nav>

    <!-- Cookies Tab -->
    <section id="tab-cookies" class="tab-content active">
      <div class="toolbar">
        <input type="text" id="search" placeholder="Filter cookies..." autocomplete="off" aria-label="Filter cookies">
        <div class="sort-group">
          <select id="sort-key" aria-label="Sort cookies by" title="Sort by">
            <option value="name">Name</option>
            <option value="domain">Domain</option>
            <option value="expiry">Expiry</option>
            <option value="size">Size</option>
          </select>
          <button id="btn-sort-dir" class="icon-btn small" aria-label="Sort direction: ascending" title="Ascending">&#8593;</button>
        </div>
        <div class="toolbar-actions">
          <button id="btn-add" class="action-btn" title="Add cookie">+ Add</button>
          <button id="btn-import" class="action-btn" title="Import cookies">Import</button>
          <button id="btn-export" class="action-btn" title="Export" aria-haspopup="menu">Export &#9662;</button>
          <button id="btn-delete-all" class="action-btn danger" title="Delete all cookies for this site">Clear</button>
        </div>
      </div>
      <div id="chip-bar" class="chip-bar" role="group" aria-label="Show only cookies that are"></div>
      <div class="domain-info">
        <input type="checkbox" id="select-all" class="row-select" aria-label="Select all shown cookies">
        <span id="domain-info" class="domain-name"></span>
        <span id="selection-info" class="selection-info" hidden>
          <span id="selection-count"></span>
          <button id="btn-delete-selected" class="action-btn danger">Delete</button>
          <button id="btn-clear-selection" class="action-btn">Clear selection</button>
        </span>
        <button id="btn-rules" class="rules-pill" title="Protected and blocked cookies for this site" hidden></button>
        <span id="list-stats" class="list-stats"></span>
      </div>
      <div id="cookie-list" class="cookie-list"></div>
      <div id="cookie-empty" class="empty-state" style="display:none;">No cookies found for this site.</div>
    </section>

    <!-- Monitor Tab -->
    <section id="tab-monitor" class="tab-content">
      <div class="toolbar">
        <label class="record-toggle">
          <input type="checkbox" id="monitor-record" role="switch">
          <span>Record</span>
        </label>
        <select id="monitor-scope" class="scope-select" aria-label="Which cookie changes to record"></select>
        <span class="monitor-status" id="monitor-status" aria-live="polite"></span>
        <button id="btn-clear-log" class="action-btn">Clear log</button>
      </div>
      <p id="monitor-note" class="monitor-note"></p>
      <div class="monitor-views" role="tablist" aria-label="Monitor view">
        <button type="button" role="tab" id="monitor-view-live" aria-selected="false">Live on <span id="live-site"></span></button>
        <button type="button" role="tab" id="monitor-view-saved" aria-selected="true">Saved log</button>
      </div>
      <div id="change-log" class="change-log"></div>
      <div id="monitor-empty" class="empty-state" style="display:none;"></div>
    </section>

    <!-- Profiles Tab -->
    <section id="tab-profiles" class="tab-content">
      <div class="toolbar">
        <input type="text" id="profile-name" placeholder="Profile name..." autocomplete="off" aria-label="Profile name">
        <button id="btn-save-profile" class="action-btn">Save Current</button>
      </div>
      <div id="profile-list" class="profile-list"></div>
      <div id="profiles-empty" class="empty-state" style="display:none;">No saved profiles. Save your current cookies as a named profile for quick switching.</div>
    </section>

    <!-- Export Menu (hidden by default) -->
    <div id="export-menu" class="dropdown-menu export-menu" style="display:none;" role="menu">
      <p id="export-scope" class="menu-note"></p>
      <div id="export-rows"></div>
    </div>

    <!-- Cookie Editor -->
    <dialog id="cookie-editor" class="dialog" aria-labelledby="editor-title">
      <form id="editor-form" class="dialog-body" novalidate>
        <h2 id="editor-title">Add Cookie</h2>
        <div class="form-grid">
          <div class="field">
            <label for="edit-name">Name</label>
            <input type="text" id="edit-name" autocomplete="off" spellcheck="false" aria-describedby="msg-name">
            <small class="field-msg" id="msg-name"></small>
          </div>
          <div class="field">
            <div class="field-head">
              <label for="edit-value">Value</label>
              <span id="edit-size" class="size-meter"></span>
            </div>
            <textarea id="edit-value" rows="3" spellcheck="false" aria-describedby="msg-value edit-size"></textarea>
            <small class="field-msg" id="msg-value"></small>
          </div>
          <div id="value-inspector" class="inspector" hidden></div>
          <div class="field-row">
            <div class="field grow">
              <label for="edit-domain">Domain</label>
              <input type="text" id="edit-domain" autocomplete="off" spellcheck="false" aria-describedby="msg-domain">
            </div>
            <div class="field path-field">
              <label for="edit-path">Path</label>
              <input type="text" id="edit-path" value="/" autocomplete="off" spellcheck="false" aria-describedby="msg-path">
            </div>
          </div>
          <small class="field-msg" id="msg-domain"></small>
          <small class="field-msg" id="msg-path"></small>
          <label class="checkbox-label">
            <input type="checkbox" id="edit-hostonly"> Host-only
            <span class="hint">no Domain attribute — sent to this exact host, not its subdomains</span>
          </label>
          <div class="field-row">
            <div class="field grow">
              <label for="edit-expires">Expires</label>
              <input type="datetime-local" id="edit-expires" aria-describedby="msg-expires">
            </div>
            <div class="field">
              <label for="edit-samesite">SameSite</label>
              <select id="edit-samesite" aria-describedby="msg-sameSite">
                <option value="unspecified">Unspecified</option>
                <option value="lax">Lax</option>
                <option value="strict">Strict</option>
                <option value="no_restriction">None</option>
              </select>
            </div>
          </div>
          <small class="field-msg" id="msg-expires"></small>
          <small class="field-msg" id="msg-sameSite"></small>
          <div class="form-row">
            <label class="checkbox-label"><input type="checkbox" id="edit-session"> Session</label>
            <label class="checkbox-label"><input type="checkbox" id="edit-secure"> Secure</label>
            <label class="checkbox-label"><input type="checkbox" id="edit-httponly"> HttpOnly</label>
          </div>
          <p id="edit-partition" class="field-note" hidden></p>
          <label class="checkbox-label">
            <input type="checkbox" id="edit-protect"> Protect
            <span class="hint">keep what you save: put it back whenever a site changes or deletes it</span>
          </label>
        </div>
        <div id="editor-error" class="editor-error" role="alert" hidden></div>
        <div class="modal-actions">
          <button type="button" id="btn-editor-block" class="action-btn danger push-left" title="Delete this cookie now and whenever a site sets it" hidden>Block…</button>
          <button type="button" id="btn-editor-cancel" class="action-btn">Cancel</button>
          <button type="submit" id="btn-editor-save" class="action-btn primary">Save</button>
        </div>
      </form>
    </dialog>

    <!-- Import -->
    <dialog id="import-dialog" class="dialog dialog-wide" aria-labelledby="import-title">
      <form id="import-form" class="dialog-body" novalidate>
        <h2 id="import-title">Import cookies</h2>
        <p class="dialog-sub">Paste, open or drop JSON (Cookie DevTools, Cookie-Editor, EditThisCookie, Playwright), a Netscape cookies.txt, a Cookie or Set-Cookie header, or a curl command. Nothing is written until you import.</p>
        <textarea id="import-text" class="import-text" rows="5" spellcheck="false" aria-label="Cookies to import" placeholder="Paste here, or drop a file"></textarea>
        <div class="import-file-row">
          <button type="button" id="btn-import-file" class="action-btn">Open file…</button>
          <input type="file" id="import-file" accept=".json,.txt,.har,text/plain,application/json" hidden>
          <button type="button" id="btn-import-tab" class="link-btn">Open in a tab</button>
          <span id="import-source" class="import-source"></span>
          <span id="import-format" class="import-format"></span>
        </div>
        <div id="import-preview" class="import-preview" aria-live="polite"></div>
        <div class="modal-actions">
          <button type="button" id="btn-import-cancel" class="action-btn">Close</button>
          <button type="submit" id="btn-import-apply" class="action-btn primary" disabled>Import</button>
        </div>
      </form>
    </dialog>

    <!-- Rules for this site -->
    <dialog id="rules-dialog" class="dialog" aria-labelledby="rules-title">
      <form method="dialog" class="dialog-body">
        <h2 id="rules-title">Rules for <span id="rules-site"></span></h2>
        <div id="rules-body"></div>
        <p class="dialog-sub rules-foot">Protected cookies are put back whenever a site changes or deletes them. Blocked cookies are deleted whenever a site sets them. Every site's rules are listed in Settings.</p>
        <div class="modal-actions">
          <button value="close" class="action-btn">Close</button>
        </div>
      </form>
    </dialog>

    <!-- Confirmation -->
    <dialog id="confirm-dialog" class="dialog dialog-small" aria-labelledby="confirm-message">
      <form method="dialog" class="dialog-body">
        <p id="confirm-message" class="confirm-message"></p>
        <p id="confirm-detail" class="confirm-detail"></p>
        <div class="modal-actions">
          <button value="cancel" id="btn-confirm-cancel" class="action-btn">Cancel</button>
          <button value="ok" id="btn-confirm-ok" class="action-btn danger-solid">Delete</button>
        </div>
      </form>
    </dialog>

    <div id="toast-region" class="toast-region" aria-live="polite"></div>

    <div class="cross-promo">
      <span class="cross-promo-label">More from Brightbar</span>
      <div class="cross-promo-links">
        <a href="https://chromewebstore.google.com/detail/json-viewer-pro/iodhhjpjemdfmmfffmejfnbbjbfafoac" target="_blank" rel="noopener" title="JSON Viewer Pro — JSON tree viewer">JSON Viewer Pro</a>
        <a href="https://chromewebstore.google.com/detail/devtools-pro/lbgjfgdjjeiajkkcppdnclmkicihehkf" target="_blank" rel="noopener" title="DevTools Pro — 12 dev tools in one">DevTools Pro</a>
        <a href="https://chromewebstore.google.com/detail/browser-api-client/gnfhfenegmjdjlfclcabfmajgaiaheij" target="_blank" rel="noopener" title="Browser API Client — API client in your browser">API Client</a>
      </div>
    </div>

    <footer>
      <span id="version" class="version"></span>
      <span id="cookie-count" class="cookie-count"></span>
    </footer>
`;
