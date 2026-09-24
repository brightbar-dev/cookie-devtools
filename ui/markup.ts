// The cookie UI's markup, shared by the popup, the side panel and the DevTools panel. Text comes from
// public/_locales/<locale>/messages.json: data-i18n fills an element's text, data-i18n-title,
// data-i18n-aria-label and data-i18n-placeholder fill those attributes (see localize in ./dom).
export const APP_MARKUP = `
    <header>
      <h1 data-i18n="appName"></h1>
      <div class="header-actions">
        <button id="btn-sidepanel" class="icon-btn" data-i18n-title="openSidePanel" data-i18n-aria-label="openSidePanel" hidden>&#8677;</button>
        <button id="btn-theme" class="icon-btn" data-i18n-title="toggleDarkMode" data-i18n-aria-label="toggleDarkMode">&#9684;</button>
        <button id="btn-settings" class="icon-btn" data-i18n-title="settings" data-i18n-aria-label="settings">&#9881;</button>
      </div>
    </header>

    <nav class="tabs" role="tablist" data-i18n-aria-label="viewsLabel">
      <button class="tab active" data-tab="cookies" role="tab" aria-selected="true" aria-controls="tab-cookies" data-i18n="tabCookies"></button>
      <button class="tab" data-tab="monitor" role="tab" aria-selected="false" aria-controls="tab-monitor" tabindex="-1" data-i18n="tabMonitor"></button>
      <button class="tab" data-tab="profiles" role="tab" aria-selected="false" aria-controls="tab-profiles" tabindex="-1" data-i18n="tabProfiles"></button>
    </nav>

    <!-- Cookies Tab -->
    <section id="tab-cookies" class="tab-content active" role="tabpanel" data-i18n-aria-label="tabCookies">
      <div class="toolbar">
        <input type="text" id="search" autocomplete="off" data-i18n-placeholder="searchPlaceholder" data-i18n-aria-label="searchLabel">
        <div class="sort-group">
          <select id="sort-key" data-i18n-aria-label="sortByLabel" data-i18n-title="sortByTitle">
            <option value="name" data-i18n="sortName"></option>
            <option value="domain" data-i18n="sortDomain"></option>
            <option value="expiry" data-i18n="sortExpiry"></option>
            <option value="size" data-i18n="sortSize"></option>
          </select>
          <button id="btn-sort-dir" class="icon-btn small" data-i18n-aria-label="sortDirectionAscending" data-i18n-title="sortAscending">&#8593;</button>
        </div>
        <div class="toolbar-actions">
          <button id="btn-add" class="action-btn" data-i18n-title="addCookieTitle" data-i18n="actionAdd"></button>
          <button id="btn-import" class="action-btn" data-i18n-title="importCookiesTitle" data-i18n="actionImport"></button>
          <button id="btn-export" class="action-btn" data-i18n-title="actionExport" aria-haspopup="menu"><span data-i18n="actionExport"></span> &#9662;</button>
          <button id="btn-delete-all" class="action-btn danger" data-i18n-title="deleteAllTitle" data-i18n="actionClear"></button>
        </div>
      </div>
      <div id="chip-bar" class="chip-bar" role="group" data-i18n-aria-label="chipsLabel"></div>
      <div class="domain-info">
        <input type="checkbox" id="select-all" class="row-select" data-i18n-aria-label="selectAllLabel">
        <span id="domain-info" class="domain-name"></span>
        <span id="selection-info" class="selection-info" hidden>
          <span id="selection-count"></span>
          <button id="btn-delete-selected" class="action-btn danger" data-i18n="actionDelete"></button>
          <button id="btn-clear-selection" class="action-btn" data-i18n="actionClearSelection"></button>
        </span>
        <button id="btn-rules" class="rules-pill" data-i18n-title="rulesPillTitle" hidden></button>
        <span id="list-stats" class="list-stats"></span>
      </div>
      <div id="cookie-list" class="cookie-list" role="list" data-i18n-aria-label="tabCookies" data-i18n-title="listKeyboardHint"></div>
      <div id="cookie-empty" class="empty-state" style="display:none;" data-i18n="noCookiesFound"></div>
    </section>

    <!-- Monitor Tab -->
    <section id="tab-monitor" class="tab-content" role="tabpanel" data-i18n-aria-label="tabMonitor">
      <div class="toolbar">
        <label class="record-toggle">
          <input type="checkbox" id="monitor-record" role="switch">
          <span data-i18n="monitorRecord"></span>
        </label>
        <select id="monitor-scope" class="scope-select" data-i18n-aria-label="monitorScopeLabel"></select>
        <span class="monitor-status" id="monitor-status" aria-live="polite"></span>
        <button id="btn-clear-log" class="action-btn" data-i18n="monitorClearLog"></button>
      </div>
      <p id="monitor-note" class="monitor-note"></p>
      <div class="monitor-views" role="tablist" data-i18n-aria-label="monitorViewsLabel">
        <button type="button" role="tab" id="monitor-view-live" aria-selected="false"></button>
        <button type="button" role="tab" id="monitor-view-saved" aria-selected="true" data-i18n="monitorSavedLog"></button>
      </div>
      <div id="change-log" class="change-log"></div>
      <div id="monitor-empty" class="empty-state" style="display:none;"></div>
    </section>

    <!-- Profiles Tab -->
    <section id="tab-profiles" class="tab-content" role="tabpanel" data-i18n-aria-label="tabProfiles">
      <div class="toolbar">
        <input type="text" id="profile-name" autocomplete="off" data-i18n-placeholder="profileNamePlaceholder" data-i18n-aria-label="profileNameLabel">
        <button id="btn-save-profile" class="action-btn" data-i18n="profileSaveCurrent"></button>
      </div>
      <div id="profile-list" class="profile-list"></div>
      <div id="profiles-empty" class="empty-state" style="display:none;" data-i18n="profilesEmpty"></div>
    </section>

    <!-- Export Menu (hidden by default) -->
    <div id="export-menu" class="dropdown-menu export-menu" style="display:none;" role="menu">
      <p id="export-scope" class="menu-note"></p>
      <div id="export-rows"></div>
    </div>

    <!-- Cookie Editor -->
    <dialog id="cookie-editor" class="dialog" aria-labelledby="editor-title">
      <form id="editor-form" class="dialog-body" novalidate>
        <h2 id="editor-title" data-i18n="editorTitleAdd"></h2>
        <div class="form-grid">
          <div class="field">
            <label for="edit-name" data-i18n="fieldName"></label>
            <input type="text" id="edit-name" autocomplete="off" spellcheck="false" aria-describedby="msg-name">
            <small class="field-msg" id="msg-name"></small>
          </div>
          <div class="field">
            <div class="field-head">
              <label for="edit-value" data-i18n="fieldValue"></label>
              <span id="edit-size" class="size-meter"></span>
            </div>
            <textarea id="edit-value" rows="3" spellcheck="false" aria-describedby="msg-value edit-size"></textarea>
            <small class="field-msg" id="msg-value"></small>
          </div>
          <div id="value-inspector" class="inspector" hidden></div>
          <div class="field-row">
            <div class="field grow">
              <label for="edit-domain" data-i18n="fieldDomain"></label>
              <input type="text" id="edit-domain" autocomplete="off" spellcheck="false" aria-describedby="msg-domain">
            </div>
            <div class="field path-field">
              <label for="edit-path" data-i18n="fieldPath"></label>
              <input type="text" id="edit-path" value="/" autocomplete="off" spellcheck="false" aria-describedby="msg-path">
            </div>
          </div>
          <small class="field-msg" id="msg-domain"></small>
          <small class="field-msg" id="msg-path"></small>
          <label class="checkbox-label">
            <input type="checkbox" id="edit-hostonly"> <span data-i18n="attrHostOnly"></span>
            <span class="hint" data-i18n="editorHostOnlyHint"></span>
          </label>
          <div class="field-row">
            <div class="field grow">
              <label for="edit-expires" data-i18n="fieldExpires"></label>
              <input type="datetime-local" id="edit-expires" aria-describedby="msg-expires">
            </div>
            <div class="field">
              <label for="edit-samesite" data-i18n="fieldSameSite"></label>
              <select id="edit-samesite" aria-describedby="msg-sameSite">
                <option value="unspecified" data-i18n="sameSiteUnspecified"></option>
                <option value="lax" data-i18n="sameSiteLax"></option>
                <option value="strict" data-i18n="sameSiteStrict"></option>
                <option value="no_restriction" data-i18n="sameSiteNone"></option>
              </select>
            </div>
          </div>
          <small class="field-msg" id="msg-expires"></small>
          <small class="field-msg" id="msg-sameSite"></small>
          <div class="form-row">
            <label class="checkbox-label"><input type="checkbox" id="edit-session"> <span data-i18n="attrSession"></span></label>
            <label class="checkbox-label"><input type="checkbox" id="edit-secure"> <span data-i18n="attrSecure"></span></label>
            <label class="checkbox-label"><input type="checkbox" id="edit-httponly"> <span data-i18n="attrHttpOnly"></span></label>
          </div>
          <p id="edit-partition" class="field-note" hidden></p>
          <label class="checkbox-label">
            <input type="checkbox" id="edit-protect"> <span data-i18n="editorProtect"></span>
            <span class="hint" data-i18n="editorProtectHint"></span>
          </label>
        </div>
        <div id="editor-error" class="editor-error" role="alert" hidden></div>
        <div class="modal-actions">
          <button type="button" id="btn-editor-block" class="action-btn danger push-left" data-i18n-title="editorBlockTitle" data-i18n="editorBlock" hidden></button>
          <button type="button" id="btn-editor-cancel" class="action-btn" data-i18n="actionCancel"></button>
          <button type="submit" id="btn-editor-save" class="action-btn primary" data-i18n="actionSave"></button>
        </div>
      </form>
    </dialog>

    <!-- Import -->
    <dialog id="import-dialog" class="dialog dialog-wide" aria-labelledby="import-title">
      <form id="import-form" class="dialog-body" novalidate>
        <h2 id="import-title" data-i18n="importCookiesTitle"></h2>
        <p class="dialog-sub" data-i18n="importIntro"></p>
        <textarea id="import-text" class="import-text" rows="5" spellcheck="false" data-i18n-aria-label="importTextLabel" data-i18n-placeholder="importTextPlaceholder"></textarea>
        <div class="import-file-row">
          <button type="button" id="btn-import-file" class="action-btn" data-i18n="importOpenFile"></button>
          <input type="file" id="import-file" accept=".json,.txt,.har,text/plain,application/json" hidden>
          <button type="button" id="btn-import-tab" class="link-btn" data-i18n="importOpenInTab"></button>
          <span id="import-source" class="import-source"></span>
          <span id="import-format" class="import-format"></span>
        </div>
        <div id="import-preview" class="import-preview" aria-live="polite"></div>
        <div class="modal-actions">
          <button type="button" id="btn-import-cancel" class="action-btn" data-i18n="actionClose"></button>
          <button type="submit" id="btn-import-apply" class="action-btn primary" data-i18n="actionImport" disabled></button>
        </div>
      </form>
    </dialog>

    <!-- Rules for this site -->
    <dialog id="rules-dialog" class="dialog" aria-labelledby="rules-title">
      <form method="dialog" class="dialog-body">
        <h2 id="rules-title"></h2>
        <div id="rules-body"></div>
        <p class="dialog-sub rules-foot" data-i18n="rulesFoot"></p>
        <div class="modal-actions">
          <button value="close" class="action-btn" data-i18n="actionClose"></button>
        </div>
      </form>
    </dialog>

    <!-- Confirmation -->
    <dialog id="confirm-dialog" class="dialog dialog-small" aria-labelledby="confirm-message">
      <form method="dialog" class="dialog-body">
        <p id="confirm-message" class="confirm-message"></p>
        <p id="confirm-detail" class="confirm-detail"></p>
        <div class="modal-actions">
          <button value="cancel" id="btn-confirm-cancel" class="action-btn" data-i18n="actionCancel"></button>
          <button value="ok" id="btn-confirm-ok" class="action-btn danger-solid" data-i18n="actionDelete"></button>
        </div>
      </form>
    </dialog>

    <div id="toast-region" class="toast-region" aria-live="polite"></div>

    <div class="cross-promo">
      <span class="cross-promo-label" data-i18n="promoLabel"></span>
      <div class="cross-promo-links">
        <a href="https://chromewebstore.google.com/detail/json-viewer-pro/iodhhjpjemdfmmfffmejfnbbjbfafoac" target="_blank" rel="noopener" data-i18n-title="promoJsonViewerTitle" data-i18n="promoJsonViewer"></a>
        <a href="https://chromewebstore.google.com/detail/devtools-pro/lbgjfgdjjeiajkkcppdnclmkicihehkf" target="_blank" rel="noopener" data-i18n-title="promoDevtoolsProTitle" data-i18n="promoDevtoolsPro"></a>
        <a href="https://chromewebstore.google.com/detail/browser-api-client/gnfhfenegmjdjlfclcabfmajgaiaheij" target="_blank" rel="noopener" data-i18n-title="promoApiClientTitle" data-i18n="promoApiClient"></a>
      </div>
    </div>

    <div id="review-nudge" class="review-nudge"></div>

    <footer>
      <span id="version" class="version"></span>
      <span class="kbd-hint" aria-hidden="true"><kbd>/</kbd> <span data-i18n="kbdSearch"></span> · <kbd>↑</kbd><kbd>↓</kbd> <span data-i18n="kbdMove"></span> · <kbd data-i18n="kbdEnter"></kbd> <span data-i18n="kbdEdit"></span> · <kbd data-i18n="kbdDel"></kbd> <span data-i18n="kbdDelete"></span></span>
      <span id="cookie-count" class="cookie-count"></span>
    </footer>
`;
