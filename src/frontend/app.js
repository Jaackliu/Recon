// Extract user_id from URL path: /<user_id>/ or /<user_id>/index.html
const _pathParts = window.location.pathname.split("/").filter(Boolean);
const USER_ID = _pathParts[0] || null;

if (!USER_ID) {
  window.location.href = "/";
}

const DATA_PATHS = {
  accounts: "./data/config/accounts.json",
  currencies: "./data/config/currency.json",
  dailySeries: "./data/ui/ui_daily_series.json",
  staticCharts: "./data/ui/ui_static_charts.json",
  transactions: "./data/ui/ui_transactions_and_categories.json",
  currencyBreakdown: "./data/ui/ui_currency_breakdown.json",
  fxRates: "./data/database/fx_rate.json",
  multiLang: "./multi-lang.json"
};

const state = {
  view: "dashboard",
  account: null,
  currency: "default",
  language: localStorage.getItem("language") || "zh",
  dateFormat: localStorage.getItem("dateFormat") || "YYYY-MM-DD",
  theme: localStorage.getItem("theme") || "system",
  scheme: localStorage.getItem("scheme") || "modern",
  rangeMode: "90",
  customRange: {
    start: "",
    end: ""
  },
  customRangeOpen: false,
  rangeDraft: {
    start: "",
    end: "",
    active: false
  },
  rangeAnchor: null,
  categoryType: "expense",
  transactionSort: "date",
  transactionFilters: {
    income: true,
    expense: true,
    refund: true,
    transfer: true
  },
  detail: {
    mode: null,
    date: "",
    category: "",
    categoryType: "",
    sort: "date",
    filters: {
      income: true,
      expense: true,
      refund: true,
      transfer: true
    }
  },
  data: {
    accounts: [],
    currencies: [],
    dailySeries: {},
    staticCharts: {},
    transactions: {},
    currencyBreakdown: {},
    fxRates: {},
    fxUpdatedAt: "",
    translations: {}
  },
  charts: {}
};

const dom = {
  accountList: document.getElementById("accountList"),
  currencyList: document.getElementById("currencyList"),
  rangeButtons: document.getElementById("rangeButtons"),
  rangeInfo: document.getElementById("rangeInfo"),
  rangeSummary: document.getElementById("rangeSummary"),
  lastUpdated: document.getElementById("lastUpdated"),
  balanceTitle: document.getElementById("balanceTitle"),
  balanceValue: document.getElementById("balanceValue"),
  balanceDelta: document.getElementById("balanceDelta"),
  accountBreakdown: document.getElementById("accountBreakdown"),
  netflowValue: document.getElementById("netflowValue"),
  inflowValue: document.getElementById("inflowValue"),
  outflowValue: document.getElementById("outflowValue"),
  refundValue: document.getElementById("refundValue"),
  transferValue: document.getElementById("transferValue"),
  heatmapLegend: document.getElementById("heatmapLegend"),
  donutLegend: document.getElementById("donutLegend"),
  transactionSort: document.getElementById("transactionSort"),
  transactionsList: document.getElementById("transactionsList"),
  transactionFilters: document.getElementById("transactionFilters"),
  dashboardView: document.getElementById("dashboardView"),
  transactionsView: document.getElementById("transactionsView"),
  customRange: document.getElementById("customRange"),
  customRangePanel: document.getElementById("customRangePanel"),
  customStartInput: document.getElementById("customStartInput"),
  customEndInput: document.getElementById("customEndInput"),
  calendarPrev: document.getElementById("calendarPrev"),
  calendarNext: document.getElementById("calendarNext"),
  calendarStack: document.getElementById("calendarStack"),
  detailModal: document.getElementById("detailModal"),
  detailTitle: document.getElementById("detailTitle"),
  detailSubtitle: document.getElementById("detailSubtitle"),
  detailMetrics: document.getElementById("detailMetrics"),
  detailSort: document.getElementById("detailSort"),
  detailFilters: document.getElementById("detailFilters"),
  detailList: document.getElementById("detailList"),
  detailClose: document.getElementById("detailClose"),
  toast: document.getElementById("toast"),
  settingsButton: document.getElementById("settingsButton"),
  settingsModal: document.getElementById("settingsModal"),
  closeSettingsModal: document.getElementById("closeSettingsModal"),
  currencySelector: document.getElementById("currencySelector"),
  uploadFileBtn: document.getElementById("uploadFileBtn"),
  fileInput: document.getElementById("fileInput"),
  parsePdfBtn: document.getElementById("parsePdfBtn"),
  refreshDataBtn: document.getElementById("refreshDataBtn"),
  notificationButton: document.getElementById("notificationButton"),
  notificationModal: document.getElementById("notificationModal"),
  closeNotificationModal: document.getElementById("closeNotificationModal"),
  notificationList: document.getElementById("notificationList"),
  fxUpdatedTime: document.getElementById("fxUpdatedTime"),
  dateFormatList: document.getElementById("dateFormatList"),
  manageAccountsBtn: document.getElementById("manageAccountsBtn"),
  manageCurrenciesBtn: document.getElementById("manageCurrenciesBtn"),
  configListModal: document.getElementById("configListModal"),
  closeConfigListModal: document.getElementById("closeConfigListModal"),
  accountsList: document.getElementById("accountsList"),
  currenciesList: document.getElementById("currenciesList"),
  addAccountBtn: document.getElementById("addAccountBtn"),
  addCurrencyBtn: document.getElementById("addCurrencyBtn"),
  editConfigModal: document.getElementById("editConfigModal"),
  editConfigTitle: document.getElementById("editConfigTitle"),
  editConfigForm: document.getElementById("editConfigForm"),
  closeEditConfigModal: document.getElementById("closeEditConfigModal"),
  saveEditConfig: document.getElementById("saveEditConfig"),
  cancelEditConfig: document.getElementById("cancelEditConfig"),
  deleteConfigBtn: document.getElementById("deleteConfigBtn"),
  abortOverlay: document.getElementById("abortOverlay"),
  abortCancel: document.getElementById("abortCancel"),
  abortConfirm: document.getElementById("abortConfirm")
};

const palette = ["#ff385c", "#ff8b5a", "#f5c542", "#33b28a", "#2f80ed", "#222222", "#ff9aa7"];

let calendarAnimTimer = null;

function triggerCalendarAnimate(mode) {
  if (!dom.customRangePanel) return;
  dom.customRangePanel.classList.add("is-animate");
  if (mode) {
    dom.customRangePanel.setAttribute("data-calendar-motion", mode);
  }
  if (calendarAnimTimer) {
    window.clearTimeout(calendarAnimTimer);
  }
  calendarAnimTimer = window.setTimeout(() => {
    dom.customRangePanel.classList.remove("is-animate");
    dom.customRangePanel.removeAttribute("data-calendar-motion");
    calendarAnimTimer = null;
  }, 500);
}

/* ---- multi-lang helpers ---- */

function t(key) {
  const lang = state.language;
  const dict = state.data.translations[lang];
  if (dict && dict[key] !== undefined) return dict[key];
  const fallback = state.data.translations.en;
  if (fallback && fallback[key] !== undefined) return fallback[key];
  return key;
}

function getAlias(multilangObj) {
  if (!multilangObj) return "";
  if (typeof multilangObj === "string") return multilangObj;
  const lang = state.language;
  return multilangObj[lang] || multilangObj.en || multilangObj.zh || Object.values(multilangObj)[0] || "";
}

function translateCategory(englishKey) {
  return t("cat." + englishKey) || englishKey;
}

function untranslateCategory(displayName) {
  const catKeys = [
    "Transportation", "Food", "Living", "Shopping", "Housing", "Entertainment",
    "Subscription", "Telecom", "Administrative", "External Transfer", "Other",
    "Salary", "Scholarship", "Subsidy", "Tax & Interest", "Education"
  ];
  for (const key of catKeys) {
    if (t("cat." + key) === displayName) return key;
  }
  return displayName;
}

function getDirectionLabel(direction) {
  return t("direction." + direction) || "";
}

function formatDate(isoDate) {
  if (!isoDate || isoDate.length < 10) return isoDate || "";
  const y = isoDate.slice(0, 4);
  const m = isoDate.slice(5, 7);
  const d = isoDate.slice(8, 10);
  switch (state.dateFormat) {
    case "YYYY/MM/DD": return `${y}/${m}/${d}`;
    case "DD/MM/YYYY": return `${d}/${m}/${y}`;
    case "MM/DD/YYYY": return `${m}/${d}/${y}`;
    default: return `${y}-${m}-${d}`;
  }
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function isValidDateParts(year, month, day) {
  if (!year || !month || !day) return false;
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}

function parseDateInput(input) {
  const value = String(input || "").trim();
  if (!value) return "";
  let year = 0;
  let month = 0;
  let day = 0;
  if (state.dateFormat === "YYYY-MM-DD") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return "";
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else if (state.dateFormat === "YYYY/MM/DD") {
    const match = value.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
    if (!match) return "";
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else if (state.dateFormat === "DD/MM/YYYY") {
    const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return "";
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
  } else if (state.dateFormat === "MM/DD/YYYY") {
    const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return "";
    month = Number(match[1]);
    day = Number(match[2]);
    year = Number(match[3]);
  }
  if (!isValidDateParts(year, month, day)) return "";
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parseIsoDate(isoDate) {
  if (!isoDate) return null;
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!isValidDateParts(year, month, day)) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function toIsoDate(date) {
  if (!date) return "";
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function getMonthIndexFromIso(isoDate) {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) return 0;
  return parsed.getUTCFullYear() * 12 + parsed.getUTCMonth();
}

function monthIndexToYearMonth(index) {
  const year = Math.floor(index / 12);
  const month = index % 12;
  return { year, month };
}

function getMonthLabel(year, month) {
  return `${year}-${pad2(month + 1)}`;
}

function getWeekdayLabels() {
  return ["S", "M", "T", "W", "T", "F", "S"];
}

function setActiveDateFormatOption() {
  if (!dom.dateFormatList) return;
  dom.dateFormatList.querySelectorAll(".date-format-option").forEach((option) => {
    option.classList.toggle("is-active", option.dataset.format === state.dateFormat);
  });
}

function applyLanguage() {
  document.querySelectorAll("[data-multi-lang]").forEach((el) => {
    const key = el.getAttribute("data-multi-lang");
    const translated = t(key);
    if (el.tagName === "OPTION") {
      el.textContent = translated;
    } else {
      el.textContent = translated;
    }
  });
  document.documentElement.setAttribute("lang", state.language);
  if (state.data.accounts.length) {
    buildAccountList();
    updateCurrencyOptions();
    updateAll();
  }
}

function setActiveLanguageOption() {
  document.querySelectorAll(".language-option").forEach((option) => {
    option.classList.toggle("is-active", option.dataset.lang === state.language);
  });
}

function getChartTheme() {
  const s = getComputedStyle(document.documentElement);
  return {
    muted: s.getPropertyValue("--muted").trim(),
    hairline: s.getPropertyValue("--hairline").trim(),
    hairlineSoft: s.getPropertyValue("--hairline-soft").trim(),
    canvas: s.getPropertyValue("--canvas").trim(),
    ink: s.getPropertyValue("--ink").trim(),
    accent: s.getPropertyValue("--accent").trim(),
    heatmap: [
      s.getPropertyValue("--heatmap-0").trim(),
      s.getPropertyValue("--heatmap-1").trim(),
      s.getPropertyValue("--heatmap-2").trim(),
      s.getPropertyValue("--heatmap-3").trim(),
      s.getPropertyValue("--heatmap-4").trim()
    ],
    palette: [
      s.getPropertyValue("--palette-0").trim(),
      s.getPropertyValue("--palette-1").trim(),
      s.getPropertyValue("--palette-2").trim(),
      s.getPropertyValue("--palette-3").trim(),
      s.getPropertyValue("--palette-4").trim(),
      s.getPropertyValue("--palette-5").trim(),
      s.getPropertyValue("--palette-6").trim()
    ]
  };
}

init();

function applyTheme(mode) {
  let resolved = mode;
  if (mode === "system") {
    resolved = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", resolved);
}

function applyScheme(scheme) {
  document.documentElement.setAttribute("data-scheme", scheme);
}

function reinitCharts() {
  Object.values(state.charts).forEach((chart) => {
    if (chart) chart.dispose();
  });
  state.charts = {};
  initCharts();
  updateAll();
}

function setActiveThemeOption() {
  document.querySelectorAll(".theme-option").forEach((option) => {
    option.classList.toggle("is-active", option.dataset.theme === state.theme);
  });
}

function setActiveSchemeOption() {
  document.querySelectorAll(".scheme-option").forEach((option) => {
    option.classList.toggle("is-active", option.dataset.scheme === state.scheme);
  });
}

async function handleFileUpload() {
  const files = dom.fileInput.files;
  if (!files.length) return;

  const formData = new FormData();
  for (const file of files) formData.append("files", file);

  try {
    const res = await fetch(`/${USER_ID}/api/upload`, { method: "POST", body: formData });
    if (!res.ok) throw new Error();
    const data = await res.json();
    showToast(t("toast.uploadSuccess") + ` (${data.saved.length})`);
  } catch {
    showToast(t("toast.uploadFailed"));
  }
  dom.fileInput.value = "";
}

async function handleParsePdf() {
  setParseLoading(true);
  try {
    const res = await fetch(`/${USER_ID}/api/parse`, { method: "POST" });
    if (res.status === 409) {
      showToast(t("toast.parseAlreadyRunning"));
      setParseLoading(true);
      pollParseStatus();
      return;
    }
    if (!res.ok) throw new Error();
    showToast(t("toast.parseStarted"));
    pollParseStatus();
  } catch {
    showToast(t("toast.uploadFailed"));
    setParseLoading(false);
  }
}

async function handleAbortParse() {
  closeAbortConfirmModal();
  try {
    const res = await fetch(`/${USER_ID}/api/parse/abort`, { method: "POST" });
    if (!res.ok) throw new Error();
    showToast(t("toast.parseAborted"));
    setParseLoading(false);
  } catch {
    showToast(t("toast.abortParseFailed"), true);
  }
}

function showAbortConfirmModal() {
  dom.abortOverlay.style.display = "";
  dom.abortOverlay.setAttribute("aria-hidden", "false");
}

function closeAbortConfirmModal() {
  dom.abortOverlay.style.display = "none";
  dom.abortOverlay.setAttribute("aria-hidden", "true");
  dom.parsePdfBtn.classList.remove("is-aborting");
}

function setParseLoading(loading) {
  dom.parsePdfBtn.classList.toggle("is-loading", loading);
}

function pollParseStatus() {
  const interval = setInterval(async () => {
    try {
      const res = await fetch(`/${USER_ID}/api/parse/status`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.running) {
        clearInterval(interval);
        setParseLoading(false);
        // Check latest messages for result
        fetchMessages().then((msgs) => {
          if (!msgs.length) return;
          const latest = msgs[0];
          if (latest.key === "msg.parse_aborted") {
            showToast(formatNotification(latest.key, latest.params));
          } else if (latest.key === "msg.parse_error") {
            showToast(formatNotification(latest.key, latest.params), true);
          } else if (latest.key === "msg.manual_refresh") {
            // Full pipeline complete: parse + refresh → reload page
            // Check if there were parse failures before showing success toast
            const failureMsg = msgs.find((m) => m.key === "msg.parse_done_with_failures");
            if (failureMsg) {
              showToast(formatNotification(failureMsg.key, failureMsg.params), true);
            } else {
              showToast(t("toast.refreshDone"));
            }
            setTimeout(() => location.reload(), 600);
          } else if (latest.key === "msg.parse_done_with_failures") {
            // Refresh still running but parse had failures — show warning now
            showToast(formatNotification(latest.key, latest.params), true);
          }
          // If msg.parse_done but not msg.refresh_done yet,
          // the refresh is still running server-side; next manual
          // page load will pick up the new data.
        });
      }
    } catch {
      // ignore polling errors
    }
  }, 1000);
}

async function handleRefreshData() {
  dom.refreshDataBtn.disabled = true;
  try {
    const res = await fetch(`/${USER_ID}/api/refresh`, { method: "POST" });
    if (!res.ok) throw new Error();
    showToast(t("toast.refreshDone"));
    setTimeout(() => location.reload(), 600);
  } catch {
    showToast(t("toast.refreshFailed"));
    dom.refreshDataBtn.disabled = false;
  }
}

function formatNotification(key, params) {
  let tpl = t(key);
  for (const [k, v] of Object.entries(params)) {
    tpl = tpl.replace(`{${k}}`, v);
  }
  return tpl;
}

async function fetchMessages() {
  try {
    const res = await fetch(`/${USER_ID}/api/messages`);
    if (!res.ok) throw new Error();
    return await res.json();
  } catch {
    return [];
  }
}

async function openNotificationModal() {
  dom.notificationModal.classList.add("is-open");
  dom.notificationModal.setAttribute("aria-hidden", "false");
  dom.notificationList.innerHTML = '<div class="notification-loading">...</div>';

  const messages = await fetchMessages();
  if (!messages.length) {
    dom.notificationList.innerHTML = `<div class="notification-empty">${t("status.noData")}</div>`;
    return;
  }

  dom.notificationList.innerHTML = messages.map((m) => `
    <div class="notification-item">
      <span class="notification-time">${escapeHtml(m.timestamp)}</span>
      <span class="notification-text">${escapeHtml(formatNotification(m.key, m.params))}</span>
    </div>
  `).join("");
}

function closeNotificationModal() {
  dom.notificationModal.classList.remove("is-open");
  dom.notificationModal.setAttribute("aria-hidden", "true");
}

function openSettingsModal() {
  dom.settingsModal.classList.add("is-open");
  dom.settingsModal.setAttribute("aria-hidden", "false");
  dom.settingsButton.classList.add("is-spinning");
  buildCurrencySelector();
  setActiveThemeOption();
  setActiveSchemeOption();
  if (dom.fxUpdatedTime) {
    dom.fxUpdatedTime.textContent = state.data.fxUpdatedAt || "--";
  }
}

function closeSettingsModal() {
  dom.settingsModal.classList.remove("is-open");
  dom.settingsModal.setAttribute("aria-hidden", "true");
  dom.settingsButton.classList.remove("is-spinning");
}

function openConfigListModal(tab) {
  dom.configListModal.classList.add("is-open");
  dom.configListModal.setAttribute("aria-hidden", "false");
  switchConfigTab(tab || "accounts");
}

function closeConfigList() {
  dom.configListModal.classList.remove("is-open");
  dom.configListModal.setAttribute("aria-hidden", "true");
}

function switchConfigTab(tab) {
  dom.configListModal.querySelectorAll(".config-tab").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.tab === tab);
  });
  dom.configListModal.querySelectorAll(".config-panel").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.panel === tab);
  });
  if (tab === "accounts") renderAccountsList();
  else renderCurrenciesList();
}

function buildCurrencySelector() {
  if (!dom.currencySelector) return;

  const savedCurrency = localStorage.getItem("defaultCurrency") || "01";

  dom.currencySelector.innerHTML = "";
  state.data.currencies.forEach((currency) => {
    const button = document.createElement("button");
    button.className = "currency-option";
    button.dataset.currency = currency.currency_code;
    button.innerHTML = `<span class="currency-symbol">${escapeHtml(currency.currency_symbol)}</span><span class="currency-name">${escapeHtml(getAlias(currency.alias))}</span>`;
    button.addEventListener("click", () => {
      selectDefaultCurrency(currency.currency_code);
    });
    dom.currencySelector.appendChild(button);
  });

  dom.currencySelector.querySelectorAll(".currency-option").forEach((option) => {
    option.classList.toggle("is-active", option.dataset.currency === savedCurrency);
  });
}

function selectDefaultCurrency(currencyCode) {
  localStorage.setItem("defaultCurrency", currencyCode);

  dom.currencySelector.querySelectorAll(".currency-option").forEach((option) => {
    option.classList.toggle("is-active", option.dataset.currency === currencyCode);
  });

  updateCurrencyOptions();
  updateAll();
  showToast(t("toast.currencyUpdated"));
}

// ---------------------------------------------------------------------------
// Config management (accounts & currencies in Settings)
// ---------------------------------------------------------------------------

function renderAccountsList() {
  if (!dom.accountsList) return;
  dom.accountsList.innerHTML = "";
  state.data.accounts.forEach((acc) => {
    const row = document.createElement("div");
    row.className = "config-item";
    row.innerHTML = `
      <div class="config-item-info">
        <span class="config-item-name">${escapeHtml(getAlias(acc.alias) || acc.account_name)}</span>
        <span class="config-item-detail">${escapeHtml(acc.bank_name || "")} · ${escapeHtml(acc.account_code)}</span>
      </div>
      <button class="config-item-edit" data-code="${escapeHtml(acc.account_code)}" data-type="account">${t("modal.editConfig")}</button>
    `;
    dom.accountsList.appendChild(row);
  });
  if (!state.data.accounts.length) {
    dom.accountsList.innerHTML = `<div class="config-empty">${t("modal.noAccounts")}</div>`;
  }
}

function renderCurrenciesList() {
  if (!dom.currenciesList) return;
  dom.currenciesList.innerHTML = "";
  state.data.currencies.forEach((cur) => {
    const row = document.createElement("div");
    row.className = "config-item";
    row.innerHTML = `
      <div class="config-item-info">
        <span class="config-item-name">${escapeHtml(cur.currency_symbol)} ${escapeHtml(getAlias(cur.alias))}</span>
        <span class="config-item-detail">${escapeHtml(cur.currency_iso)} · ${escapeHtml(cur.currency_code)}</span>
      </div>
      <button class="config-item-edit" data-code="${escapeHtml(cur.currency_code)}" data-type="currency">${t("modal.editConfig")}</button>
    `;
    dom.currenciesList.appendChild(row);
  });
  if (!state.data.currencies.length) {
    dom.currenciesList.innerHTML = `<div class="config-empty">${t("modal.noCurrencies")}</div>`;
  }
}

let editConfigTarget = null; // { type: "account"|"currency", code: string|null (null = add new), data: object }

function openEditConfigModal(type, code) {
  editConfigTarget = { type, code };
  const isNew = code === null;

  if (type === "account") {
    const acc = isNew ? {} : state.data.accounts.find((a) => a.account_code === code) || {};
    dom.editConfigTitle.textContent = isNew ? t("modal.addAccount") : t("modal.editAccount");
    dom.editConfigForm.innerHTML = buildAccountForm(acc);
    dom.deleteConfigBtn.style.display = isNew ? "none" : "";
  } else {
    const cur = isNew ? {} : state.data.currencies.find((c) => c.currency_code === code) || {};
    dom.editConfigTitle.textContent = isNew ? t("modal.addCurrency") : t("modal.editCurrency");
    dom.editConfigForm.innerHTML = buildCurrencyForm(cur);
    dom.deleteConfigBtn.style.display = isNew ? "none" : "";
  }

  dom.editConfigModal.classList.add("is-open");
  dom.editConfigModal.setAttribute("aria-hidden", "false");
}

function closeEditConfig() {
  dom.editConfigModal.classList.remove("is-open");
  dom.editConfigModal.setAttribute("aria-hidden", "true");
  editConfigTarget = null;
}

function buildAccountForm(acc) {
  const alias = acc.alias || {};
  return `
    <label class="field"><span>${t("onboarding.accountCode")}</span><input type="text" id="efAccountCode" value="${escapeHtml(acc.account_code || "")}" ${acc.account_code ? "readonly style='opacity:0.6'" : ""} placeholder="001" /></label>
    <label class="field"><span>${t("onboarding.bankName")}</span><input type="text" id="efBankName" value="${escapeHtml(acc.bank_name || "")}" /></label>
    <label class="field"><span>${t("onboarding.accountName")}</span><input type="text" id="efAccountName" value="${escapeHtml(acc.account_name || "")}" /></label>
    <label class="field"><span>${t("onboarding.accountNumber")}</span><input type="text" id="efAccountNumber" value="${escapeHtml(acc.account_number || "")}" /></label>
    <label class="field"><span>${t("modal.aliasZh")}</span><input type="text" id="efAliasZh" value="${escapeHtml(alias.zh || "")}" /></label>
    <label class="field"><span>${t("modal.aliasEn")}</span><input type="text" id="efAliasEn" value="${escapeHtml(alias.en || "")}" /></label>
    <label class="field"><span>${t("modal.aliasFr")}</span><input type="text" id="efAliasFr" value="${escapeHtml(alias.fr || "")}" /></label>
    <label class="field"><span>${t("modal.defaultCurrencyLabel")}</span>
      <select id="efDefaultCurrency">${state.data.currencies.map((c) => `<option value="${c.currency_code}" ${c.currency_code === (acc.default_currency || "01") ? "selected" : ""}>${c.currency_symbol} ${getAlias(c.alias)}</option>`).join("")}</select>
    </label>
    <label class="field"><span>${t("modal.supportedCurrencies")}</span>
      <div class="checkbox-group" id="efSupportedCurrencies">${state.data.currencies.map((c) => `<label class="checkbox-label"><input type="checkbox" value="${c.currency_code}" ${(acc.supported_currencies || []).includes(c.currency_code) ? "checked" : ""} /> ${c.currency_symbol} ${getAlias(c.alias)}</label>`).join("")}</div>
    </label>
  `;
}

function buildCurrencyForm(cur) {
  const alias = cur.alias || {};
  return `
    <label class="field"><span>${t("modal.currencyCode")}</span><input type="text" id="efCurrencyCode" value="${escapeHtml(cur.currency_code || "")}" ${cur.currency_code ? "readonly style='opacity:0.6'" : ""} placeholder="06" /></label>
    <label class="field"><span>${t("modal.currencyIso")}</span><input type="text" id="efCurrencyIso" value="${escapeHtml(cur.currency_iso || "")}" ${cur.currency_iso ? "readonly style='opacity:0.6'" : ""} placeholder="GBP" /></label>
    <label class="field"><span>${t("modal.currencySymbol")}</span><input type="text" id="efCurrencySymbol" value="${escapeHtml(cur.currency_symbol || "")}" placeholder="£" /></label>
    <label class="field"><span>${t("modal.aliasZh")}</span><input type="text" id="efCurAliasZh" value="${escapeHtml(alias.zh || "")}" /></label>
    <label class="field"><span>${t("modal.aliasEn")}</span><input type="text" id="efCurAliasEn" value="${escapeHtml(alias.en || "")}" /></label>
    <label class="field"><span>${t("modal.aliasFr")}</span><input type="text" id="efCurAliasFr" value="${escapeHtml(alias.fr || "")}" /></label>
  `;
}

function saveEditConfig() {
  if (!editConfigTarget) return;
  const { type, code } = editConfigTarget;
  const isNew = code === null;

  if (type === "account") {
    const newCode = document.getElementById("efAccountCode").value.trim();
    if (!newCode) { showToast(t("toast.codeRequired")); return; }

    const newAcc = {
      account_code: newCode,
      alias: {
        zh: document.getElementById("efAliasZh").value.trim() || newCode,
        en: document.getElementById("efAliasEn").value.trim() || newCode,
        fr: document.getElementById("efAliasFr").value.trim() || newCode,
      },
      account_name: document.getElementById("efAccountName").value.trim(),
      bank_name: document.getElementById("efBankName").value.trim(),
      account_number: document.getElementById("efAccountNumber").value.trim(),
      default_currency: document.getElementById("efDefaultCurrency").value,
      supported_currencies: [...document.querySelectorAll("#efSupportedCurrencies input:checked")].map((cb) => cb.value),
    };

    let accounts = [...state.data.accounts];
    if (isNew) {
      if (accounts.find((a) => a.account_code === newCode)) { showToast(t("toast.codeDuplicate")); return; }
      accounts.push(newAcc);
    } else {
      accounts = accounts.map((a) => a.account_code === code ? newAcc : a);
    }
    saveAccountsToServer(accounts);
  } else {
    const newCode = document.getElementById("efCurrencyCode").value.trim();
    const newIso = document.getElementById("efCurrencyIso").value.trim().toUpperCase();
    if (!newCode || !newIso) { showToast(t("toast.codeRequired")); return; }

    const newCur = {
      currency_code: newCode,
      currency_iso: newIso,
      alias: {
        zh: document.getElementById("efCurAliasZh").value.trim() || newIso,
        en: document.getElementById("efCurAliasEn").value.trim() || newIso,
        fr: document.getElementById("efCurAliasFr").value.trim() || newIso,
      },
      currency_symbol: document.getElementById("efCurrencySymbol").value.trim() || newIso,
    };

    let currencies = [...state.data.currencies];
    if (isNew) {
      if (currencies.find((c) => c.currency_code === newCode)) { showToast(t("toast.codeDuplicate")); return; }
      currencies.push(newCur);
    } else {
      currencies = currencies.map((c) => c.currency_code === code ? newCur : c);
    }
    saveCurrenciesToServer(currencies);
  }
}

function deleteEditConfig() {
  if (!editConfigTarget) return;
  const { type, code } = editConfigTarget;
  if (!code) return;

  if (type === "account") {
    const accounts = state.data.accounts.filter((a) => a.account_code !== code);
    saveAccountsToServer(accounts);
  } else {
    const currencies = state.data.currencies.filter((c) => c.currency_code !== code);
    saveCurrenciesToServer(currencies);
  }
}

async function saveAccountsToServer(accounts) {
  try {
    const res = await fetch(`/${USER_ID}/api/config/accounts`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(accounts),
    });
    if (!res.ok) throw new Error();
    state.data.accounts = accounts;
    showToast(t("toast.configSaved"));
    closeEditConfig();
    renderAccountsList();
  } catch {
    showToast(t("toast.configSaveFailed"));
  }
}

async function saveCurrenciesToServer(currencies) {
  try {
    const res = await fetch(`/${USER_ID}/api/config/currencies`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(currencies),
    });
    if (!res.ok) throw new Error();
    state.data.currencies = currencies;
    showToast(t("toast.configSaved"));
    closeEditConfig();
    renderCurrenciesList();
  } catch {
    showToast(t("toast.configSaveFailed"));
  }
}

document.addEventListener("click", (event) => {
  const themeOption = event.target.closest(".theme-option");
  if (themeOption) {
    const theme = themeOption.dataset.theme;
    state.theme = theme;
    localStorage.setItem("theme", theme);
    applyTheme(theme);
    setActiveThemeOption();
    reinitCharts();
  }
  const schemeOption = event.target.closest(".scheme-option");
  if (schemeOption) {
    const scheme = schemeOption.dataset.scheme;
    state.scheme = scheme;
    localStorage.setItem("scheme", scheme);
    applyScheme(scheme);
    setActiveSchemeOption();
    reinitCharts();
  }
  const langOption = event.target.closest(".language-option");
  if (langOption) {
    const lang = langOption.dataset.lang;
    state.language = lang;
    localStorage.setItem("language", lang);
    setActiveLanguageOption();
    applyLanguage();
    reinitCharts();
    showToast(t("toast.languageUpdated"));
  }
  const dateFormatOption = event.target.closest(".date-format-option");
  if (dateFormatOption) {
    const format = dateFormatOption.dataset.format;
    state.dateFormat = format;
    localStorage.setItem("dateFormat", format);
    setActiveDateFormatOption();
    updateAll();
    syncCustomRangeInputs(true);
    renderRangeCalendars();
    showToast(t("toast.dateFormatUpdated"));
  }
});

async function init() {
  try {
    applyTheme(state.theme);
    applyScheme(state.scheme);

    // Try loading multi-lang first (always available, shared asset)
    const multiLang = await fetchJson(DATA_PATHS.multiLang).catch(() => ({}));
    state.data.translations = multiLang;
    applyLanguage();

    // Try loading config files — if accounts.json 404s, this is a new user
    let accounts = null;
    let currencies = null;
    try {
      [accounts, currencies] = await Promise.all([
        fetchJson(DATA_PATHS.accounts),
        fetchJson(DATA_PATHS.currencies),
      ]);
    } catch {
      // New user — no config files yet
    }

    if (!accounts || accounts.length === 0) {
      // New user: show onboarding
      showOnboarding(currencies || []);
      return;
    }

    // Existing user: load everything
    const [dailySeries, staticCharts, transactions, currencyBreakdown, fxRates] = await Promise.all([
      fetchJson(DATA_PATHS.dailySeries).catch(() => ({})),
      fetchJson(DATA_PATHS.staticCharts).catch(() => ({})),
      fetchJson(DATA_PATHS.transactions).catch(() => ({ default: { total: { transactions: [] } } })),
      fetchJson(DATA_PATHS.currencyBreakdown).catch(() => ({})),
      fetchJson(DATA_PATHS.fxRates).catch(() => ({ rates: {} })),
    ]);

    state.data.accounts = accounts;
    state.data.currencies = currencies;
    state.data.dailySeries = dailySeries;
    state.data.staticCharts = staticCharts;
    state.data.transactions = transactions;
    state.data.currencyBreakdown = currencyBreakdown;
    state.data.fxRates = fxRates.rates || {};
    state.data.fxUpdatedAt = fxRates.updated_at || "";

    buildAccountList();
    bindEvents();
    initCharts();
    setInitialSelections();
    updateAll();
    revealCards();
    createTxTooltip();

    // Auto-refresh FX if stale (>24h) — fire and forget
    checkAndAutoRefreshFx();
  } catch (error) {
    showToast(t("toast.failedToLoad"));
    console.error(error);
  }
}

function fetchJson(path) {
  return fetch(path).then((response) => {
    if (!response.ok) {
      throw new Error(`Failed to fetch ${path}`);
    }
    return response.json();
  });
}

async function checkAndAutoRefreshFx() {
  try {
    const status = await fetch(`/${USER_ID}/api/fx_status`).then((r) => r.json());
    if (!status.stale) return;

    // FX is stale — trigger auto-refresh in background
    console.log("FX rates stale, triggering auto-refresh:", status);
    const res = await fetch(`/${USER_ID}/api/auto_refresh`, { method: "POST" });
    if (res.ok) {
      // Auto-refresh succeeded — reload to show updated data
      setTimeout(() => location.reload(), 600);
    } else {
      // Auto-refresh failed — show notification
      showToast(t("toast.autoRefreshFailed"), true);
    }
  } catch {
    // Silently ignore — auto-refresh is best-effort
  }
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

const ONBOARDING_DEFAULT_CURRENCIES = [
  { currency_code: "01", currency_iso: "CNY", alias: { zh: "人民币", en: "Chinese Yuan", fr: "Yuan chinois" }, currency_symbol: "￥" },
  { currency_code: "02", currency_iso: "HKD", alias: { zh: "港币", en: "Hong Kong Dollar", fr: "Dollar hongkongais" }, currency_symbol: "HK$" },
  { currency_code: "03", currency_iso: "EUR", alias: { zh: "欧元", en: "Euro", fr: "Euro" }, currency_symbol: "€" },
  { currency_code: "04", currency_iso: "USD", alias: { zh: "美元", en: "US Dollar", fr: "Dollar américain" }, currency_symbol: "$" },
  { currency_code: "05", currency_iso: "JPY", alias: { zh: "日元", en: "Japanese Yen", fr: "Yen japonais" }, currency_symbol: "¥" },
];

let obState = { step: 1, selectedCurrency: "01", files: [] };

function showOnboarding(currencies) {
  const overlay = document.getElementById("onboardingOverlay");
  if (!overlay) return;
  overlay.style.display = "";

  const currs = currencies && currencies.length ? currencies : ONBOARDING_DEFAULT_CURRENCIES;

  // Build currency grid
  const grid = document.getElementById("onboardingCurrencyGrid");
  grid.innerHTML = "";
  currs.forEach((c) => {
    const btn = document.createElement("button");
    btn.className = "onboarding-currency-btn" + (c.currency_code === obState.selectedCurrency ? " is-selected" : "");
    btn.dataset.code = c.currency_code;
    const alias = c.alias || {};
    const label = alias[state.language] || alias.en || c.currency_iso;
    btn.innerHTML = `<span class="onboarding-currency-symbol">${escapeHtml(c.currency_symbol)}</span>${escapeHtml(label)}`;
    btn.addEventListener("click", () => {
      grid.querySelectorAll(".onboarding-currency-btn").forEach((b) => b.classList.remove("is-selected"));
      btn.classList.add("is-selected");
      obState.selectedCurrency = c.currency_code;
    });
    grid.appendChild(btn);
  });

  // Upload zone
  const uploadZone = document.getElementById("obUploadZone");
  const fileInput = document.getElementById("obFileInput");
  uploadZone.addEventListener("click", () => fileInput.click());
  uploadZone.addEventListener("dragover", (e) => { e.preventDefault(); uploadZone.style.borderColor = "var(--accent)"; });
  uploadZone.addEventListener("dragleave", () => { uploadZone.style.borderColor = ""; });
  uploadZone.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadZone.style.borderColor = "";
    obState.files = [...(e.dataTransfer.files || [])];
    renderObFileList();
  });
  fileInput.addEventListener("change", () => {
    obState.files = [...fileInput.files];
    renderObFileList();
  });

  // Step navigation
  document.getElementById("obNext").addEventListener("click", obNext);
  document.getElementById("obBack").addEventListener("click", obBack);
  document.getElementById("obSkip").addEventListener("click", obSkip);

  obUpdateUI();
}

function renderObFileList() {
  const list = document.getElementById("obFileList");
  const zone = document.getElementById("obUploadZone");
  if (!obState.files.length) {
    list.innerHTML = "";
    zone.classList.remove("has-files");
    return;
  }
  zone.classList.add("has-files");
  list.innerHTML = [...obState.files].map((f) => `<div class="onboarding-file-item">📄 ${escapeHtml(f.name)}</div>`).join("");
}

function obUpdateUI() {
  const { step } = obState;
  // Steps
  document.querySelectorAll(".onboarding-step").forEach((el) => {
    const s = parseInt(el.dataset.step);
    el.classList.toggle("is-active", s === step);
    el.classList.toggle("is-done", s < step);
  });
  // Panels
  document.querySelectorAll(".onboarding-panel").forEach((el) => {
    el.classList.toggle("is-active", parseInt(el.dataset.panel) === step);
  });
  // Buttons
  document.getElementById("obBack").style.display = step > 1 ? "" : "none";
  document.getElementById("obSkip").textContent = step === 3 ? t("onboarding.finish") : t("onboarding.skip");
  const nextBtn = document.getElementById("obNext");
  nextBtn.textContent = step === 3 ? t("onboarding.setupAndGo") : t("onboarding.next");
}

function obNext() {
  if (obState.step < 3) {
    obState.step++;
    obUpdateUI();
    return;
  }
  // Final step: call setup API, upload files, then reload
  obFinish();
}

function obBack() {
  if (obState.step > 1) {
    obState.step--;
    obUpdateUI();
  }
}

async function obSkip() {
  if (obState.step < 3) {
    // Skip to finish with minimal config
    await obFinish();
  } else {
    // On step 3, skip means finish without uploading
    await obFinish();
  }
}

async function obFinish() {
  const nextBtn = document.getElementById("obNext");
  nextBtn.disabled = true;
  nextBtn.textContent = "...";

  const bankName = (document.getElementById("obBankName")?.value || "").trim();
  const accountName = (document.getElementById("obAccountName")?.value || "").trim();
  const accountNumber = (document.getElementById("obAccountNumber")?.value || "").trim();

  // Build account data
  const accountCode = "001";
  const accountAlias = accountName || bankName || "Account 1";
  const account = {
    account_code: accountCode,
    alias: { zh: accountAlias, en: accountAlias, fr: accountAlias },
    account_name: accountName || bankName || "Account 1",
    bank_name: bankName,
    account_number: accountNumber,
    default_currency: obState.selectedCurrency,
    supported_currencies: [obState.selectedCurrency],
  };

  try {
    // Call setup API
    await fetch(`/${USER_ID}/api/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        default_currency: obState.selectedCurrency,
        account: account,
      }),
    });

    // Upload files if any
    if (obState.files.length) {
      const formData = new FormData();
      for (const file of obState.files) formData.append("files", file);
      await fetch(`/${USER_ID}/api/upload`, { method: "POST", body: formData });
    }

    // Reload to show the dashboard
    location.reload();
  } catch (err) {
    console.error("Setup failed:", err);
    showToast(t("toast.setupFailed"));
    nextBtn.disabled = false;
    nextBtn.textContent = t("onboarding.setupAndGo");
  }
}

function buildAccountList() {
  const list = [{ code: "total", label: t("status.totalAsset") }];

  state.data.accounts.forEach((account) => {
    list.push({ code: account.account_code, label: getAlias(account.alias) || account.account_name });
  });

  dom.accountList.innerHTML = "";
  list.forEach((account) => {
    const button = document.createElement("button");
    button.className = "account-pill";
    button.dataset.account = account.code;
    button.innerHTML = `<strong>${escapeHtml(account.label)}</strong><span>${account.code}</span>`;
    dom.accountList.appendChild(button);
  });

  if (list.length > 0) {
    state.account = list[0].code;
  }
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      setView(tab.dataset.view);
    });
  });

  dom.accountList.addEventListener("click", (event) => {
    const button = event.target.closest(".account-pill");
    if (!button) return;
    state.account = button.dataset.account;
    setActiveAccount();
    updateCurrencyOptions();
    updateAll();
  });

  dom.currencyList.addEventListener("click", (event) => {
    const button = event.target.closest(".pill");
    if (!button) return;
    state.currency = button.dataset.currency;
    setActiveCurrency();
    updateAll();
  });

  dom.rangeButtons.addEventListener("click", (event) => {
    const button = event.target.closest(".pill");
    if (!button) return;
    state.rangeMode = button.dataset.range;
    updateAll();
    setActiveRangeButton();
    closeCustomRangePanel();
  });

  dom.customRange.addEventListener("click", () => {
    toggleCustomRangePanel();
  });
  dom.customRange.setAttribute("aria-expanded", "false");
  dom.customRange.setAttribute("aria-controls", "customRangePanel");

  if (dom.customStartInput && dom.customEndInput) {
    const onInputCommit = () => handleManualRangeInput(true);
    const onInputChange = () => handleManualRangeInput(false);
    dom.customStartInput.addEventListener("change", onInputChange);
    dom.customEndInput.addEventListener("change", onInputChange);
    dom.customStartInput.addEventListener("blur", onInputCommit);
    dom.customEndInput.addEventListener("blur", onInputCommit);
    dom.customStartInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") onInputCommit();
    });
    dom.customEndInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") onInputCommit();
    });
  }

  if (dom.calendarPrev) {
    dom.calendarPrev.addEventListener("click", () => shiftCalendarAnchor(-1));
  }

  if (dom.calendarNext) {
    dom.calendarNext.addEventListener("click", () => shiftCalendarAnchor(1));
  }

  if (dom.calendarStack) {
    dom.calendarStack.addEventListener("click", (event) => {
      const target = event.target.closest(".calendar-day");
      if (!target || target.classList.contains("is-disabled")) return;
      const date = target.dataset.date;
      if (!date) return;
      handleCalendarSelect(date);
    });
  }

  dom.detailSort.addEventListener("change", () => {
    state.detail.sort = dom.detailSort.value;
    renderDetailList();
  });

  dom.detailFilters.addEventListener("click", (event) => {
    const button = event.target.closest(".filter-chip");
    if (!button) return;
    const filter = button.dataset.filter;
    const activeCount = Object.values(state.detail.filters).filter(Boolean).length;
    if (activeCount === 1 && state.detail.filters[filter]) {
      Object.keys(state.detail.filters).forEach((k) => { state.detail.filters[k] = true; });
    } else {
      state.detail.filters[filter] = !state.detail.filters[filter];
    }
    syncFilterButtons(state.detail.filters, dom.detailFilters);
    renderDetailList();
  });

  dom.detailFilters.addEventListener("dblclick", (event) => {
    const button = event.target.closest(".filter-chip");
    if (!button) return;
    const filter = button.dataset.filter;
    Object.keys(state.detail.filters).forEach((k) => { state.detail.filters[k] = k === filter; });
    syncFilterButtons(state.detail.filters, dom.detailFilters);
    renderDetailList();
  });

  dom.detailClose.addEventListener("click", closeDetailModal);
  dom.detailModal.addEventListener("click", (event) => {
    if (event.target === dom.detailModal) {
      closeDetailModal();
    }
  });

  document.querySelectorAll(".toggle-btn").forEach((button) => {
    button.addEventListener("click", () => {
      state.categoryType = button.dataset.type;
      setActiveCategoryToggle();
      updateCategoryPanel();
    });
  });

  dom.transactionSort.addEventListener("change", () => {
    state.transactionSort = dom.transactionSort.value;
    updateTransactionsView();
  });

  dom.transactionFilters.addEventListener("click", (event) => {
    const button = event.target.closest(".filter-chip");
    if (!button) return;
    const filter = button.dataset.filter;
    const activeCount = Object.values(state.transactionFilters).filter(Boolean).length;
    if (activeCount === 1 && state.transactionFilters[filter]) {
      Object.keys(state.transactionFilters).forEach((k) => { state.transactionFilters[k] = true; });
    } else {
      state.transactionFilters[filter] = !state.transactionFilters[filter];
    }
    syncFilterButtons(state.transactionFilters, dom.transactionFilters);
    updateTransactionsView();
  });

  dom.transactionFilters.addEventListener("dblclick", (event) => {
    const button = event.target.closest(".filter-chip");
    if (!button) return;
    const filter = button.dataset.filter;
    Object.keys(state.transactionFilters).forEach((k) => { state.transactionFilters[k] = k === filter; });
    syncFilterButtons(state.transactionFilters, dom.transactionFilters);
    updateTransactionsView();
  });

  dom.settingsButton.addEventListener("click", openSettingsModal);
  dom.closeSettingsModal.addEventListener("click", closeSettingsModal);
  dom.settingsModal.addEventListener("click", (event) => {
    if (event.target === dom.settingsModal) {
      closeSettingsModal();
    }
  });

  let uploadLongPressTimer = null;
  let uploadLongPressTriggered = false;

  function clearUploadLongPress() {
    if (uploadLongPressTimer) {
      clearTimeout(uploadLongPressTimer);
      uploadLongPressTimer = null;
    }
  }

  function handleUploadLongPress() {
    uploadLongPressTriggered = true;
    fetch(`/${USER_ID}/api/open_raw_input`, { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        if (data.opened) {
          showToast(t("toast.folderOpened"));
        } else if (data.path) {
          navigator.clipboard.writeText(data.path).then(
            () => showToast(t("toast.folderPathCopied") + ": " + data.path),
            () => showToast(t("toast.folderPathCopied") + ": " + data.path)
          );
        }
      })
      .catch(() => showToast(t("toast.folderOpenFailed"), true));
  }

  dom.uploadFileBtn.addEventListener("mousedown", (event) => {
    event.preventDefault();
    uploadLongPressTriggered = false;
    clearUploadLongPress();
    uploadLongPressTimer = setTimeout(handleUploadLongPress, 600);
  });

  dom.uploadFileBtn.addEventListener("mouseup", clearUploadLongPress);
  dom.uploadFileBtn.addEventListener("mouseleave", clearUploadLongPress);

  dom.uploadFileBtn.addEventListener("touchstart", (event) => {
    uploadLongPressTriggered = false;
    clearUploadLongPress();
    uploadLongPressTimer = setTimeout(handleUploadLongPress, 600);
  }, { passive: true });

  dom.uploadFileBtn.addEventListener("touchend", clearUploadLongPress);
  dom.uploadFileBtn.addEventListener("touchcancel", clearUploadLongPress);

  dom.uploadFileBtn.addEventListener("click", (event) => {
    if (uploadLongPressTriggered) {
      event.preventDefault();
      event.stopImmediatePropagation();
    } else {
      dom.fileInput.click();
    }
  });

  // Parse button long press → abort parsing
  let parseLongPressTimer = null;
  let parseLongPressTriggered = false;

  function clearParseLongPress() {
    if (parseLongPressTimer) {
      clearTimeout(parseLongPressTimer);
      parseLongPressTimer = null;
    }
    dom.parsePdfBtn.classList.remove("is-aborting");
  }

  function handleParseLongPress() {
    parseLongPressTriggered = true;
    dom.parsePdfBtn.classList.add("is-aborting");
    showAbortConfirmModal();
  }

  dom.parsePdfBtn.addEventListener("mousedown", (event) => {
    if (!dom.parsePdfBtn.classList.contains("is-loading")) return;
    parseLongPressTriggered = false;
    clearParseLongPress();
    parseLongPressTimer = setTimeout(handleParseLongPress, 600);
  });

  dom.parsePdfBtn.addEventListener("mouseup", clearParseLongPress);
  dom.parsePdfBtn.addEventListener("mouseleave", clearParseLongPress);

  dom.parsePdfBtn.addEventListener("touchstart", (event) => {
    if (!dom.parsePdfBtn.classList.contains("is-loading")) return;
    parseLongPressTriggered = false;
    clearParseLongPress();
    parseLongPressTimer = setTimeout(handleParseLongPress, 600);
  }, { passive: true });

  dom.parsePdfBtn.addEventListener("touchend", clearParseLongPress);
  dom.parsePdfBtn.addEventListener("touchcancel", clearParseLongPress);
  dom.fileInput.addEventListener("change", handleFileUpload);

  dom.parsePdfBtn.addEventListener("click", (event) => {
    if (parseLongPressTriggered) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (dom.parsePdfBtn.classList.contains("is-loading")) {
      showToast(t("toast.parseAlreadyRunning"));
      return;
    }
    handleParsePdf();
  });
  dom.refreshDataBtn.addEventListener("click", handleRefreshData);

  dom.notificationButton.addEventListener("click", openNotificationModal);
  dom.closeNotificationModal.addEventListener("click", closeNotificationModal);
  dom.notificationModal.addEventListener("click", (event) => {
    if (event.target === dom.notificationModal) closeNotificationModal();
  });

  // Config management — settings buttons open the list modal
  dom.manageAccountsBtn.addEventListener("click", () => {
    closeSettingsModal();
    openConfigListModal("accounts");
  });
  dom.manageCurrenciesBtn.addEventListener("click", () => {
    closeSettingsModal();
    openConfigListModal("currencies");
  });

  // Config list modal
  dom.closeConfigListModal.addEventListener("click", closeConfigList);
  dom.configListModal.addEventListener("click", (e) => {
    if (e.target === dom.configListModal) closeConfigList();
    const tab = e.target.closest(".config-tab");
    if (tab) switchConfigTab(tab.dataset.tab);
  });
  dom.addAccountBtn.addEventListener("click", () => openEditConfigModal("account", null));
  dom.addCurrencyBtn.addEventListener("click", () => openEditConfigModal("currency", null));
  dom.accountsList.addEventListener("click", (e) => {
    const btn = e.target.closest(".config-item-edit");
    if (btn) openEditConfigModal("account", btn.dataset.code);
  });
  dom.currenciesList.addEventListener("click", (e) => {
    const btn = e.target.closest(".config-item-edit");
    if (btn) openEditConfigModal("currency", btn.dataset.code);
  });

  // Edit config modal
  dom.saveEditConfig.addEventListener("click", saveEditConfig);
  dom.cancelEditConfig.addEventListener("click", closeEditConfig);
  dom.closeEditConfigModal.addEventListener("click", closeEditConfig);
  dom.deleteConfigBtn.addEventListener("click", deleteEditConfig);
  dom.editConfigModal.addEventListener("click", (event) => {
    if (event.target === dom.editConfigModal) closeEditConfig();
  });

  bindTxTooltipEvents(dom.transactionsList);
  bindTxTooltipEvents(dom.detailList);

  // Abort parse confirmation dialog
  dom.abortCancel.addEventListener("click", closeAbortConfirmModal);
  dom.abortConfirm.addEventListener("click", handleAbortParse);
  dom.abortOverlay.addEventListener("click", (event) => {
    if (event.target === dom.abortOverlay) closeAbortConfirmModal();
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (state.theme === "system") {
      applyTheme("system");
      reinitCharts();
    }
  });

  window.addEventListener("resize", () => {
    Object.values(state.charts).forEach((chart) => chart && chart.resize());
  });
}

function setInitialSelections() {
  setActiveAccount();
  updateCurrencyOptions();
  setActiveRangeButton();
  setActiveCategoryToggle();
  setActiveThemeOption();
  setActiveLanguageOption();
  setActiveDateFormatOption();
}

function setView(view) {
  state.view = view;
  document.querySelectorAll(".tab").forEach((tab) => {
    const isActive = tab.dataset.view === view;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  dom.dashboardView.classList.toggle("view-active", view === "dashboard");
  dom.transactionsView.classList.toggle("view-active", view === "transactions");
}

function setActiveAccount() {
  document.querySelectorAll(".account-pill").forEach((pill) => {
    pill.classList.toggle("is-active", pill.dataset.account === state.account);
  });
}

function setActiveRangeButton() {
  document.querySelectorAll(".range-buttons .pill").forEach((pill) => {
    pill.classList.toggle("is-active", pill.dataset.range === state.rangeMode);
  });
  dom.customRange.classList.toggle("is-active", state.rangeMode === "custom");
  if (state.rangeMode !== "custom") {
    closeCustomRangePanel();
  }
}

function setActiveCategoryToggle() {
  document.querySelectorAll(".toggle-btn").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.type === state.categoryType);
  });
}

function updateCurrencyOptions() {
  if (!dom.currencyList) return;
  const available = getAvailableCurrencies(state.account);
  const options = [
    { value: "default", label: t("currency.default") },
    ...available.map((code) => {
      const currency = getCurrencyByCode(code);
      return { value: code, label: currency ? getAlias(currency.alias) : code };
    })
  ];

  dom.currencyList.innerHTML = "";
  options.forEach((option) => {
    const item = document.createElement("button");
    item.className = "pill";
    item.dataset.currency = option.value;
    item.textContent = option.label;
    dom.currencyList.appendChild(item);
  });

  const isAllowed = options.some((option) => option.value === state.currency);
  if (!isAllowed) {
    state.currency = "default";
  }
  setActiveCurrency();
}

function setActiveCurrency() {
  if (!dom.currencyList) return;
  dom.currencyList.querySelectorAll(".pill").forEach((pill) => {
    pill.classList.toggle("is-active", pill.dataset.currency === state.currency);
  });
}

function updateAll() {
  updateRangeSummary();
  updateDashboard();
  updateTransactionsView();
}

function updateRangeSummary() {
  const series = getSeriesForAccount(state.account);
  if (!series || series.length === 0) {
    dom.rangeInfo.textContent = t("status.noData");
    return;
  }
  const range = getRange(series);
  dom.rangeInfo.textContent = `${formatDate(range.startDate)} — ${formatDate(range.endDate)}`;
  dom.rangeSummary.textContent = `${formatDate(range.startDate)} - ${formatDate(range.endDate)}`;
  dom.lastUpdated.textContent = `${t("status.dataUpTo")} ${formatDate(range.endDate)}`;
  syncCustomRangeInputs();
  if (state.customRangeOpen) {
    renderRangeCalendars();
  }
}

function updateDashboard() {
  const series = getSeriesForAccount(state.account);
  if (!series || series.length === 0) {
    showEmptyDashboard();
    return;
  }

  const range = getRange(series);
  const slice = sliceSeries(series, range.startDate, range.endDate);
  if (slice.length === 0) {
    showEmptyDashboard();
    return;
  }

  updateBalanceOverview(series, slice, range);
  updateCashflow(slice);
  updateHeatmap();
  updateMonthlyChart();
  updateDailyChart(slice);
  updateSankey();
  updateCategoryPanel();
}

function updateBalanceOverview(series, slice, range) {
  const lastEntry = slice[slice.length - 1];
  const accountLabel = getAccountLabel(state.account);
  dom.balanceTitle.textContent = accountLabel;
  dom.balanceValue.textContent = formatMoney(lastEntry.end_balance);

  const delta = getDelta(series, range);
  if (delta.label === t("balance.changeHidden")) {
    dom.balanceDelta.style.display = "none";
  } else {
    dom.balanceDelta.style.display = "";
    dom.balanceDelta.textContent = delta.label;
    dom.balanceDelta.className = "delta";
    if (delta.status !== "neutral") {
      dom.balanceDelta.classList.add(delta.status === "positive" ? "is-positive" : "is-negative");
    }
  }

  dom.accountBreakdown.innerHTML = "";
  if (state.account === "total") {
    const endDate = range.endDate;
    state.data.accounts.forEach((account) => {
      const accountSeries = getSeriesForAccount(account.account_code);
      if (!accountSeries || accountSeries.length === 0) return;
      const balanceAtDate = getBalanceAtDate(accountSeries, endDate);
      if (!balanceAtDate) return;
      const row = document.createElement("div");
      row.className = "account-row";
      row.innerHTML = `<span>${escapeHtml(getAlias(account.alias) || account.account_name)}</span><strong>${formatMoney(balanceAtDate.end_balance)}</strong>`;
      dom.accountBreakdown.appendChild(row);
    });
  } else if (state.currency === "default") {
    const breakdown = getCurrencyBreakdownForAccount(state.account);
    if (breakdown && breakdown.length > 0) {
      breakdown.forEach((item) => {
        const currency = getCurrencyByCode(item.currency);
        const name = currency ? getAlias(currency.alias) : item.currency;
        const row = document.createElement("div");
        row.className = "account-row";
        row.innerHTML = `<span>${escapeHtml(name)}</span><strong>${formatMoney(item.end_balance)}</strong>`;
        dom.accountBreakdown.appendChild(row);
      });
    }
  }
}

function updateCashflow(slice) {
  const inflow = sumBy(slice, "all_inflow");
  const outflow = sumBy(slice, "all_outflow");
  const netflow = round2(inflow + outflow);
  const refund = round2(sumBy(slice, "refund") / 2);
  const transferRaw = sumBy(slice, "internal_transfer");
  const transfer = state.account === "total" ? round2(transferRaw / 2) : transferRaw;

  dom.netflowValue.textContent = formatMoney(netflow);
  dom.inflowValue.textContent = formatMoney(inflow);
  dom.outflowValue.textContent = formatMoney(outflow);
  dom.refundValue.textContent = formatMoney(refund);
  dom.transferValue.textContent = formatMoney(transfer);
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function updateHeatmap() {
  const staticData = getStaticForAccount(state.account);
  if (!staticData || !staticData.heatmap || staticData.heatmap.length === 0) return;

  const data = staticData.heatmap.map((entry) => [entry.date, entry.net_inflow]);
  const values = staticData.heatmap.map((entry) => entry.net_inflow);

  const p5 = percentile(values, 5);
  const p95 = percentile(values, 95);
  const rangeAbs = Math.max(Math.abs(p5), Math.abs(p95), 1);

  const chartWidth = state.charts.heatmap.getWidth();
  const chartHeight = state.charts.heatmap.getHeight();
  const columns = Math.max(1, Math.ceil(staticData.heatmap.length / 7));
  const cellWidth = Math.floor((chartWidth - 20) / columns);
  const cellHeight = Math.floor((chartHeight - 28) / 7);
  const cellSize = Math.max(Math.min(cellWidth, cellHeight), 8);

  const theme = getChartTheme();
  const option = {
    tooltip: {
      confine: true,
      formatter: (params) => `${formatDate(params.data[0])}<br/>${formatMoney(params.data[1])}`
    },
    visualMap: {
      min: -rangeAbs,
      max: rangeAbs,
      show: false,
      inRange: {
        color: theme.heatmap
      }
    },
    calendar: {
      range: [staticData.heatmap[0].date, staticData.heatmap[staticData.heatmap.length - 1].date],
      cellSize: [cellSize, cellSize],
      top: 18,
      left: 6,
      right: 6,
      bottom: 6,
      orient: "horizontal",
      itemStyle: {
        borderColor: theme.canvas,
        borderWidth: 2,
        borderRadius: 2
      },
      splitLine: {
        show: false
      },
      yearLabel: { show: false },
      monthLabel: {
        show: true,
        color: theme.muted,
        fontSize: 10,
        margin: 4,
        nameMap: state.language,
        position: "start"
      },
      dayLabel: { show: false }
    },
    series: [{
      type: "heatmap",
      coordinateSystem: "calendar",
      data
    }],
    animation: true,
    animationDuration: 600,
    animationEasing: "cubicOut"
  };

  state.charts.heatmap.setOption(option, true);
}

function updateMonthlyChart() {
  const staticData = getStaticForAccount(state.account);
  if (!staticData || !staticData.monthly_combo) return;

  const months = staticData.monthly_combo.map((entry) => entry.month);
  const balances = staticData.monthly_combo.map((entry) => entry.end_balance);
  const inflow = staticData.monthly_combo.map((entry) => entry.inflow);
  const outflow = staticData.monthly_combo.map((entry) => entry.outflow);

  const theme = getChartTheme();
  const option = {
    tooltip: {
      trigger: "axis",
      confine: true,
      padding: [4, 8],
      textStyle: { fontSize: 11 },
      extraCssText: "max-width:200px; font-size:11px; line-height:1.4;",
      axisPointer: {
        type: "line",
        snap: true
      },
      formatter: (params) => {
        let result = params[0].axisValue + "<br/>";
        params.forEach((p) => {
          result += `${p.marker} ${p.seriesName}: ${formatMoney(p.value)}<br/>`;
        });
        return result;
      }
    },
    legend: { show: false },
    grid: { left: 1.5, right: 1.5, top: 16, bottom: -2, containLabel: true },
    xAxis: {
      type: "category",
      data: months,
      axisLine: { lineStyle: { color: theme.hairline } },
      axisLabel: {
        color: theme.muted,
        fontSize: 10,
        interval: 0,
        formatter: (val) => val.includes("-") ? val.split("-").pop() : val
      }
    },
    yAxis: [
      {
        type: "value",
        axisLabel: { color: theme.muted, fontSize: 10, formatter: formatK },
        splitLine: { lineStyle: { color: theme.hairlineSoft } }
      },
      {
        type: "value",
        axisLabel: { color: theme.muted, fontSize: 10, formatter: formatK },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: t("chart.inflow"),
        type: "bar",
        data: inflow,
        yAxisIndex: 1,
        itemStyle: { color: theme.accent },
        stack: "flow",
        barWidth: 4
      },
      {
        name: t("chart.outflow"),
        type: "bar",
        data: outflow,
        yAxisIndex: 1,
        itemStyle: { color: theme.ink, opacity: 0.35 },
        stack: "flow",
        barWidth: 4
      },
      {
        name: t("chart.balance"),
        type: "line",
        data: balances,
        smooth: true,
        itemStyle: { color: theme.ink },
        lineStyle: { width: 2 }
      }
    ],
    animation: true,
    animationDuration: 600,
    animationEasing: "cubicOut"
  };

  state.charts.monthly.setOption(option, true);
}

function updateDailyChart(slice) {
  const dates = slice.map((entry) => entry.date);
  const balances = slice.map((entry) => entry.end_balance);
  const inflow = slice.map((entry) => entry.all_inflow);
  const outflow = slice.map((entry) => entry.all_outflow);
  const balanceMin = Math.min(...balances);
  const balanceMax = Math.max(...balances);
  const balancePad = Math.max((balanceMax - balanceMin) * 0.08, balanceMax * 0.002, 1);

  const theme = getChartTheme();
  const option = {
    tooltip: {
      trigger: "axis",
      confine: true,
      axisPointer: {
        type: "line",
        snap: true
      },
      formatter: (params) => {
        let result = formatDate(params[0].axisValue) + "<br/>";
        params.forEach((p) => {
          result += `${p.marker} ${p.seriesName}: ${formatMoney(p.value)}<br/>`;
        });
        return result;
      }
    },
    grid: { left: 48, right: 28, top: 28, bottom: 30, containLabel: true },
    xAxis: {
      type: "category",
      data: dates,
      axisLine: { lineStyle: { color: theme.hairline } },
      axisLabel: { color: theme.muted }
    },
    yAxis: [
      {
        type: "value",
        min: Math.round((balanceMin - balancePad) * 100) / 100,
        max: Math.round((balanceMax + balancePad) * 100) / 100,
        scale: true,
        axisLabel: {
          color: theme.muted,
          formatter: (val) => {
            const rounded = Math.round(val * 100) / 100;
            return formatK(rounded);
          }
        },
        splitLine: { lineStyle: { color: theme.hairlineSoft } }
      },
      {
        type: "value",
        axisLabel: { color: theme.muted, formatter: formatK },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: t("chart.inflow"),
        type: "bar",
        data: inflow,
        yAxisIndex: 1,
        itemStyle: { color: theme.accent },
        stack: "daily",
        barMaxWidth: 6
      },
      {
        name: t("chart.outflow"),
        type: "bar",
        data: outflow,
        yAxisIndex: 1,
        itemStyle: { color: theme.ink, opacity: 0.35 },
        stack: "daily",
        barMaxWidth: 18
      },
      {
        name: t("chart.balance"),
        type: "line",
        data: balances,
        smooth: true,
        itemStyle: { color: theme.ink },
        lineStyle: { width: 2 }
      }
    ],
    animation: true,
    animationDuration: 600,
    animationEasing: "cubicOut"
  };

  state.charts.daily.setOption(option, true);
}

function updateSankey() {
  const series = getSeriesForAccount(state.account);
  if (!series) return;
  const transactions = getTransactionsForAccount(state.account);
  const range = getRange(series);
  const filtered = transactions
    .filter((item) => item.is_filtered)
    .filter((item) => item.type !== "refund" && item.type !== "transfer")
    .filter((item) => item.date >= range.startDate && item.date <= range.endDate);

  if (filtered.length === 0) {
    state.charts.sankey.setOption({ series: [{ data: [], links: [] }] }, true);
    return;
  }

  const income = groupByCategory(filtered.filter((item) => item.type === "income"));
  const expense = groupByCategory(filtered.filter((item) => item.type === "expense"));
  const sumIncome = sumValues(income);
  const sumExpense = sumValues(expense);
  const flowThrough = round2(Math.min(sumIncome, sumExpense));

  const incomePrefix = t("sankey.incomePrefix");
  const expensePrefix = t("sankey.expensePrefix");
  const totalIncome = t("sankey.totalIncome");
  const totalExpense = t("sankey.totalExpense");
  const useBalance = t("sankey.useBalance");
  const retained = t("sankey.retained");

  const data = [];
  const links = [];

  // Level 0: income categories
  Object.keys(income).forEach((category) => {
    const name = `${incomePrefix}${translateCategory(category)}`;
    data.push({ name, depth: 0 });
    links.push({ source: name, target: totalIncome, value: income[category] });
  });

  // Level 1: Total Income + Use Balance
  data.push({ name: totalIncome, depth: 1 });
  if (sumExpense > sumIncome) {
    data.push({ name: useBalance, depth: 1 });
    links.push({ source: useBalance, target: totalExpense, value: round2(sumExpense - sumIncome) });
  }
  if (flowThrough > 0) {
    links.push({ source: totalIncome, target: totalExpense, value: flowThrough });
  }

  // Level 2: Total Expense + Retained
  data.push({ name: totalExpense, depth: 2 });
  if (sumIncome > sumExpense) {
    data.push({ name: retained, depth: 2 });
    links.push({ source: totalIncome, target: retained, value: round2(sumIncome - sumExpense) });
  }

  // Level 3: expense categories
  Object.keys(expense).forEach((category) => {
    const name = `${expensePrefix}${translateCategory(category)}`;
    data.push({ name, depth: 3 });
    links.push({ source: totalExpense, target: name, value: expense[category] });
  });

  const option = {
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: (params) => {
        if (params.dataType === "edge") {
          return `${params.data.source} → ${params.data.target}<br/>${formatMoney(params.data.value)}`;
        }
        return `${params.name}<br/>${formatMoney(params.value)}`;
      }
    },
    series: [
      {
        type: "sankey",
        data,
        links,
        emphasis: { focus: "adjacency" },
        label: { color: getChartTheme().ink },
        edgeLabel: { color: getChartTheme().muted },
        lineStyle: { color: "gradient", curveness: 0.5 },
        itemStyle: { borderWidth: 0 },
        nodeAlign: "justify",
        color: getChartTheme().palette
      }
    ],
    animation: true,
    animationDuration: 600,
    animationEasing: "cubicOut"
  };

  state.charts.sankey.setOption(option, true);
}

function updateCategoryPanel() {
  const series = getSeriesForAccount(state.account);
  if (!series) return;
  const transactions = getTransactionsForAccount(state.account);
  const range = getRange(series);
  const filtered = transactions
    .filter((item) => item.is_filtered)
    .filter((item) => item.type !== "refund" && item.type !== "transfer")
    .filter((item) => item.type === state.categoryType)
    .filter((item) => item.date >= range.startDate && item.date <= range.endDate);

  const totals = groupByCategory(filtered);
  const themePalette = getChartTheme().palette;
  const donutData = Object.entries(totals).map(([name, value], index) => ({
    name: translateCategory(name),
    value,
    itemStyle: { color: themePalette[index % themePalette.length] }
  }));

  const option = {
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: (params) => `${params.name}<br/>${formatMoney(params.value)} (${params.percent}%)`
    },
    series: [
      {
        type: "pie",
        radius: ["45%", "70%"],
        data: donutData,
        label: { show: false },
        labelLine: { show: false }
      }
    ],
    animation: true,
    animationDuration: 600,
    animationEasing: "cubicOut"
  };

  state.charts.donut.setOption(option, true);
  renderDonutLegend(donutData);
}

function updateTransactionsView() {
  const transactions = getTransactionsForAccount(state.account);
  const series = getSeriesForAccount(state.account);
  if (!series) return;
  const range = getRange(series);

  const filtered = transactions
    .filter((item) => item.date >= range.startDate && item.date <= range.endDate)
    .filter((item) => state.transactionFilters[item.type]);

  if (state.transactionSort === "amount") {
    filtered.sort((a, b) => b.amount - a.amount);
  } else {
    filtered.sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  dom.transactionsList.innerHTML = "";
  if (filtered.length === 0) {
    dom.transactionsList.innerHTML = `<div class="card">${t("transactions.noTransactionsInRange")}</div>`;
    return;
  }

  filtered.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "transaction-row";
    row._txData = item;
    if (index < 15) row.style.animationDelay = `${index * 20}ms`;
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(item.description)}</strong>
        <div class="meta">${escapeHtml(formatDate(item.date))}</div>
      </div>
      <div class="meta">${escapeHtml(getAlias(item.alias))}</div>
      <div><span class="tag ${item.type}">${formatType(item.type)}</span></div>
      <div><span class="tag category">${escapeHtml(translateCategory(item.category))}</span></div>
      <div class="transaction-amount">${formatSignedMoney(item.amount, item.cashflow_direction)}</div>
      <div class="transaction-balance">${formatMoney(item.balance)}</div>
    `;
    dom.transactionsList.appendChild(row);
  });
}

function initCharts() {
  state.charts.heatmap = echarts.init(document.getElementById("heatmapChart"));
  state.charts.monthly = echarts.init(document.getElementById("monthlyChart"));
  state.charts.daily = echarts.init(document.getElementById("dailyChart"));
  state.charts.sankey = echarts.init(document.getElementById("sankeyChart"));
  state.charts.donut = echarts.init(document.getElementById("donutChart"));
  bindChartInteractions();
}

function bindChartInteractions() {
  state.charts.heatmap.on("click", (params) => {
    if (!params || !params.data || !params.data[0]) return;
    const date = params.data[0];
    setCustomRange(date, date);
  });

  // Module D: zr click captures ALL clicks on the canvas (not just on bar/line elements)
  state.charts.monthly.getZr().on("click", (event) => {
    const point = [event.offsetX, event.offsetY];
    if (!state.charts.monthly.containPixel("grid", point)) return;
    const month = getCategoryFromZrClick(state.charts.monthly, point);
    if (!month) return;
    const range = getMonthRange(month);
    if (!range) return;
    setCustomRange(range.start, range.end);
  });

  // Module E: zr click captures ALL clicks on the canvas (not just on bar/line elements)
  state.charts.daily.getZr().on("click", (event) => {
    const point = [event.offsetX, event.offsetY];
    if (!state.charts.daily.containPixel("grid", point)) return;
    const date = getCategoryFromZrClick(state.charts.daily, point);
    if (!date) return;
    openDayDetail(date);
  });

  state.charts.sankey.on("click", (params) => {
    if (!params || params.dataType !== "node") return;
    const name = params.name || "";
    const incomePrefix = t("sankey.incomePrefix");
    const expensePrefix = t("sankey.expensePrefix");
    if (name.startsWith(incomePrefix)) {
      const displayCat = name.slice(incomePrefix.length);
      const englishCat = untranslateCategory(displayCat);
      openCategoryDetail(englishCat, "income");
    }
    if (name.startsWith(expensePrefix)) {
      const displayCat = name.slice(expensePrefix.length);
      const englishCat = untranslateCategory(displayCat);
      openCategoryDetail(englishCat, "expense");
    }
  });

  state.charts.donut.on("click", (params) => {
    if (!params || !params.name) return;
    const englishCat = untranslateCategory(params.name);
    openCategoryDetail(englishCat, state.categoryType);
  });
}

function setCustomRange(startDate, endDate) {
  const series = getSeriesForAccount(state.account);
  if (!series || series.length === 0) return;
  const minDate = series[0].date;
  const maxDate = series[series.length - 1].date;
  const clampedStart = clampDate(startDate, minDate, maxDate);
  const clampedEnd = clampDate(endDate, minDate, maxDate);
  const finalStart = clampedStart <= clampedEnd ? clampedStart : clampedEnd;
  const finalEnd = clampedStart <= clampedEnd ? clampedEnd : clampedStart;

  state.customRange.start = finalStart;
  state.customRange.end = finalEnd;
  state.rangeMode = "custom";
  state.rangeDraft.start = finalStart;
  state.rangeDraft.end = finalEnd;
  state.rangeDraft.active = false;
  setActiveRangeButton();
  updateAll();
  syncCustomRangeInputs(true);
}

function openDayDetail(date) {
  const series = getSeriesForAccount(state.account);
  if (!series) return;
  const entry = series.find((item) => item.date === date);
  if (!entry) return;

  state.detail.mode = "day";
  state.detail.date = date;
  state.detail.category = "";
  state.detail.categoryType = "";

  const netflow = round2(entry.all_inflow + entry.all_outflow);
  dom.detailTitle.textContent = t("detail.dailyDetails");
  dom.detailSubtitle.textContent = `${formatDate(date)} · ${getAccountLabel(state.account)}`;
  renderDetailMetrics([
    { label: t("detail.date"), value: formatDate(date) },
    { label: t("detail.endBalance"), value: formatMoney(entry.end_balance) },
    { label: t("detail.netflow"), value: formatMoney(netflow) },
    { label: t("detail.inflow"), value: formatMoney(entry.all_inflow) },
    { label: t("detail.outflow"), value: formatMoney(entry.all_outflow) }
  ]);
  dom.detailFilters.style.display = "flex";
  syncDetailFilters();
  dom.detailSort.value = state.detail.sort;
  renderDetailList();
  openDetailModal();
}

function openCategoryDetail(category, categoryType) {
  const series = getSeriesForAccount(state.account);
  if (!series) return;

  state.detail.mode = "category";
  state.detail.category = category;
  state.detail.categoryType = categoryType;
  state.detail.date = "";

  const range = getRange(series);
  const transactions = getDetailTransactions();
  const total = sumBy(transactions, "amount");
  const typeLabel = formatType(categoryType);

  dom.detailTitle.textContent = `${typeLabel} ${t("detail.categorySuffix")}`;
  dom.detailSubtitle.textContent = `${translateCategory(category)} · ${formatDate(range.startDate)} — ${formatDate(range.endDate)}`;
  renderDetailMetrics([
    { label: t("detail.category"), value: translateCategory(category) },
    { label: t("detail.range"), value: `${formatDate(range.startDate)} — ${formatDate(range.endDate)}` },
    { label: t("detail.transactions"), value: String(transactions.length) },
    { label: t("detail.totalAmount"), value: formatMoney(total) }
  ]);
  dom.detailFilters.style.display = "none";
  dom.detailSort.value = state.detail.sort;
  renderDetailList();
  openDetailModal();
}

function renderDetailMetrics(metrics) {
  dom.detailMetrics.innerHTML = "";
  metrics.forEach((metric) => {
    const item = document.createElement("div");
    item.className = "detail-metric";
    item.innerHTML = `<span>${escapeHtml(metric.label)}</span><strong>${escapeHtml(metric.value)}</strong>`;
    dom.detailMetrics.appendChild(item);
  });
}

function renderDetailList() {
  const transactions = getDetailTransactions();
  dom.detailList.innerHTML = "";

  if (transactions.length === 0) {
    dom.detailList.innerHTML = `<div class="detail-empty">${t("transactions.noTransactions")}</div>`;
    return;
  }

  transactions.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "detail-row";
    row._txData = item;
    if (index < 15) row.style.animationDelay = `${index * 20}ms`;
    row.innerHTML = `
      <div><strong>${escapeHtml(item.description)}</strong><div class="meta">${escapeHtml(formatDate(item.date))}</div></div>
      <div><span class="tag category">${escapeHtml(translateCategory(item.category))}</span></div>
      <div><span class="tag ${item.type}">${formatType(item.type)}</span></div>
      <div class="detail-amount">${formatSignedMoney(item.amount, item.cashflow_direction)}</div>
      <div class="detail-account">${escapeHtml(getAlias(item.alias))}</div>
      <div class="detail-balance">${formatMoney(item.balance)}</div>
    `;
    dom.detailList.appendChild(row);
  });
}

function getDetailTransactions() {
  const transactions = getTransactionsForAccount(state.account);
  const series = getSeriesForAccount(state.account);
  if (!series) return [];

  let filtered = transactions;
  if (state.detail.mode === "day") {
    filtered = filtered.filter((item) => item.date === state.detail.date);
    filtered = filtered.filter((item) => state.detail.filters[item.type]);
  } else if (state.detail.mode === "category") {
    const range = getRange(series);
    filtered = filtered
      .filter((item) => item.category === state.detail.category)
      .filter((item) => item.type !== "refund" && item.type !== "transfer")
      .filter((item) => item.type === state.detail.categoryType)
      .filter((item) => item.date >= range.startDate && item.date <= range.endDate);
  }

  if (state.detail.sort === "amount") {
    filtered.sort((a, b) => b.amount - a.amount);
  } else {
    filtered.sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  return filtered;
}

function syncDetailFilters() {
  syncFilterButtons(state.detail.filters, dom.detailFilters);
}

function syncFilterButtons(filters, container) {
  container.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.classList.toggle("is-active", filters[chip.dataset.filter]);
  });
}

function openDetailModal() {
  dom.detailModal.classList.add("is-open");
  dom.detailModal.setAttribute("aria-hidden", "false");
}

function closeDetailModal() {
  dom.detailModal.classList.remove("is-open");
  dom.detailModal.setAttribute("aria-hidden", "true");
}

function getMonthRange(monthLabel) {
  const parts = monthLabel.split("-");
  if (parts.length !== 2) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (!year || !month) return null;
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return { start: toIsoDate(start), end: toIsoDate(end) };
}

function getCategoryFromZrClick(chart, pixelPoint) {
  if (!chart || !pixelPoint) return null;
  // convertFromPixel returns [xValue, yValue]; xValue is the category index for category axes
  const dataPoint = chart.convertFromPixel({ gridIndex: 0 }, pixelPoint);
  if (!dataPoint) return null;
  const index = Math.round(dataPoint[0]);
  const option = chart.getOption();
  const categories = (option.xAxis && option.xAxis[0] && option.xAxis[0].data) || [];
  if (index < 0 || index >= categories.length) return null;
  return categories[index];
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getSeriesForAccount(code) {
  const dataset = getDataset(state.data.dailySeries);
  return dataset[code];
}

function getTransactionsForAccount(code) {
  const dataset = getDataset(state.data.transactions);
  return (dataset[code] && dataset[code].transactions) || [];
}

function getStaticForAccount(code) {
  const dataset = getDataset(state.data.staticCharts);
  return dataset[code];
}

function getCurrencyBreakdownForAccount(code) {
  return state.data.currencyBreakdown[code] || null;
}

function getDataset(collection) {
  const key = getActiveDatasetKey();
  const raw = collection[key] || {};
  if (key === "default") {
    return applyGlobalCurrencyConversion(raw, collection);
  }
  return raw;
}

function getActiveDatasetKey() {
  if (state.currency === "default") {
    return state.account === "total" ? "default" : "default_local";
  }
  return state.currency;
}

function getProcessorDefaultCurrency(collection) {
  const meta = collection._meta;
  if (meta && meta.processor_default_currency) return meta.processor_default_currency;
  return getFallbackCurrencyCode();
}

function getUserDefaultCurrency() {
  return localStorage.getItem("defaultCurrency") || getFallbackCurrencyCode();
}

function getFxRate(fromCode, toCode) {
  if (fromCode === toCode) return 1;
  const rates = state.data.fxRates;
  if (rates[fromCode] && rates[fromCode][toCode] !== undefined) {
    return rates[fromCode][toCode];
  }
  return 1;
}

const conversionCache = new WeakMap();

function applyGlobalCurrencyConversion(dataset, collection) {
  const processorCurrency = getProcessorDefaultCurrency(collection);
  const userCurrency = getUserDefaultCurrency();
  if (processorCurrency === userCurrency) return dataset;
  const rate = getFxRate(processorCurrency, userCurrency);
  if (rate === 1) return dataset;
  const rateKey = `${processorCurrency}:${userCurrency}:${rate}`;
  let cache = conversionCache.get(collection);
  if (cache && cache.key === rateKey) return cache.result;
  const converted = convertDataset(dataset, rate);
  conversionCache.set(collection, { key: rateKey, result: converted });
  return converted;
}

function convertDataset(dataset, rate) {
  const result = {};
  for (const key of Object.keys(dataset)) {
    result[key] = convertValue(dataset[key], rate);
  }
  return result;
}

const AMOUNT_KEYS = new Set([
  "start_balance", "end_balance",
  "all_inflow", "all_outflow", "refund", "internal_transfer",
  "filtered_inflow", "filtered_outflow",
  "amount", "inflow", "outflow", "net_inflow",
  "balance"
]);

function convertValue(value, rate) {
  if (Array.isArray(value)) {
    return value.map((item) => convertValue(item, rate));
  }
  if (typeof value === "object" && value !== null) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (AMOUNT_KEYS.has(k) && typeof v === "number") {
        out[k] = round2(v * rate);
      } else if (typeof v === "object" && v !== null) {
        out[k] = convertValue(v, rate);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return value;
}

function getRange(series) {
  const endDate = series[series.length - 1].date;
  let startDate = series[0].date;

  if (state.rangeMode === "7") {
    startDate = series[Math.max(series.length - 7, 0)].date;
  } else if (state.rangeMode === "30") {
    startDate = series[Math.max(series.length - 30, 0)].date;
  } else if (state.rangeMode === "90") {
    startDate = series[Math.max(series.length - 90, 0)].date;
  } else if (state.rangeMode === "180") {
    startDate = series[Math.max(series.length - 180, 0)].date;
  } else if (state.rangeMode === "365") {
    startDate = series[Math.max(series.length - 365, 0)].date;
  } else if (state.rangeMode === "custom") {
    startDate = clampDate(state.customRange.start, series[0].date, endDate);
    const customEnd = clampDate(state.customRange.end, series[0].date, endDate);
    if (startDate > customEnd) {
      startDate = series[0].date;
    }
    return { startDate, endDate: customEnd };
  }

  return { startDate, endDate };
}

function clampDate(date, minDate, maxDate) {
  if (!date) return minDate;
  if (date < minDate) return minDate;
  if (date > maxDate) return maxDate;
  return date;
}

function sliceSeries(series, startDate, endDate) {
  return series.filter((entry) => entry.date >= startDate && entry.date <= endDate);
}

function getBalanceAtDate(series, date) {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (series[i].date <= date) {
      return series[i];
    }
  }
  return null;
}

function getDelta(series, range) {
  const daysMap = { "7": 7, "30": 30, "90": 90, "180": 180, "365": 365 };
  const days = daysMap[state.rangeMode];
  if (!days) {
    return { label: t("balance.changeHidden"), status: "neutral" };
  }

  const endIndex = series.findIndex((entry) => entry.date === range.endDate);
  const prevIndex = endIndex - days;
  if (endIndex < 0 || prevIndex < 0) {
    return { label: t("balance.changeHidden"), status: "neutral" };
  }

  const current = series[endIndex].end_balance;
  const prev = series[prevIndex].end_balance;
  if (prev === 0) {
    return { label: t("balance.changeHidden"), status: "neutral" };
  }

  const change = ((current - prev) / prev) * 100;
  const label = `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
  return { label, status: change >= 0 ? "positive" : "negative" };
}

function getAccountLabel(code) {
  if (code === "total") return t("status.totalAsset");
  const account = state.data.accounts.find((item) => item.account_code === code);
  return account ? getAlias(account.alias) || account.account_name : code;
}

function getAvailableCurrencies(accountCode) {
  if (accountCode === "total") {
    const union = new Set();
    state.data.accounts.forEach((account) => {
      (account.supported_currencies || []).forEach((code) => union.add(code));
    });
    return Array.from(union).sort();
  }

  const account = state.data.accounts.find((item) => item.account_code === accountCode);
  return account ? (account.supported_currencies || []) : [];
}

function getActiveCurrencyCode() {
  if (state.currency !== "default") return state.currency;

  if (state.account === "total") {
    return localStorage.getItem("defaultCurrency") || getFallbackCurrencyCode();
  }

  const account = state.data.accounts.find((item) => item.account_code === state.account);
  if (account && account.default_currency) {
    return account.default_currency;
  }
  return localStorage.getItem("defaultCurrency") || getFallbackCurrencyCode();
}

function getFallbackCurrencyCode() {
  if (state.data.currencies.length > 0) {
    return state.data.currencies[0].currency_code;
  }
  return "01";
}

function getCurrencyByCode(code) {
  return state.data.currencies.find((item) => item.currency_code === code);
}

function getCurrencySymbol(code) {
  const currency = getCurrencyByCode(code);
  return currency ? currency.currency_symbol : "¥";
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function sumBy(list, key) {
  return round2(list.reduce((sum, item) => sum + (Number(item[key]) || 0), 0));
}

function groupByCategory(items) {
  return items.reduce((acc, item) => {
    acc[item.category] = round2((acc[item.category] || 0) + item.amount);
    return acc;
  }, {});
}

function sumValues(map) {
  return round2(Object.values(map).reduce((sum, value) => sum + value, 0));
}

function formatMoney(value, currencyCode) {
  const amount = Number(value) || 0;
  const sign = amount < 0 ? "-" : "";
  const code = currencyCode || getActiveCurrencyCode();
  const symbol = getCurrencySymbol(code);
  return `${sign}${symbol}${Math.abs(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatSignedMoney(value, direction) {
  const sign = Number(direction) === 2 ? "-" : "+";
  return `${sign}${formatMoney(value)}`;
}


function formatType(type) {
  return t("type." + type) || type;
}

function formatK(value) {
  const rounded = Math.round(value * 100) / 100;
  const abs = Math.abs(rounded);
  if (abs >= 1000) {
    const k = rounded / 1000;
    const str = k % 1 === 0 ? k.toFixed(0) : parseFloat(k.toFixed(1)).toString();
    return str + "k";
  }
  return String(rounded);
}

function renderDonutLegend(data) {
  dom.donutLegend.innerHTML = "";
  data.forEach((item) => {
    const div = document.createElement("div");
    div.className = "legend-item";
    div.innerHTML = `<span class="legend-swatch" style="background:${item.itemStyle.color}"></span>${escapeHtml(item.name)}`;
    dom.donutLegend.appendChild(div);
  });
}

function showEmptyDashboard() {
  dom.balanceTitle.textContent = t("status.noData");
  dom.balanceValue.textContent = "--";
  dom.balanceDelta.textContent = "";
  dom.accountBreakdown.innerHTML = "";
  dom.netflowValue.textContent = "--";
  dom.inflowValue.textContent = "--";
  dom.outflowValue.textContent = "--";
  dom.refundValue.textContent = "--";
  dom.transferValue.textContent = "--";
}

function revealCards() {
  const cards = Array.from(document.querySelectorAll(".reveal"));
  cards.forEach((card, index) => {
    setTimeout(() => {
      card.classList.add("is-visible");
    }, 120 + index * 80);
  });
}

function toggleCustomRangePanel() {
  if (state.customRangeOpen) {
    closeCustomRangePanel();
  } else {
    openCustomRangePanel();
  }
}

function openCustomRangePanel() {
  if (!dom.customRangePanel) return;
  state.customRangeOpen = true;
  dom.customRangePanel.classList.add("is-open");
  dom.customRangePanel.setAttribute("aria-hidden", "false");
  if (dom.customRange) {
    dom.customRange.classList.add("is-open");
    dom.customRange.setAttribute("aria-expanded", "true");
  }
  triggerCalendarAnimate("open");
  syncRangeDraftFromCurrent();
  syncCustomRangeInputs(true);
  ensureCalendarAnchor();
  renderRangeCalendars();
}

function closeCustomRangePanel() {
  if (!dom.customRangePanel) return;
  state.customRangeOpen = false;
  dom.customRangePanel.classList.remove("is-open");
  dom.customRangePanel.classList.remove("is-animate");
  dom.customRangePanel.removeAttribute("data-calendar-motion");
  dom.customRangePanel.setAttribute("aria-hidden", "true");
  if (dom.customRange) {
    dom.customRange.classList.remove("is-open");
    dom.customRange.setAttribute("aria-expanded", "false");
  }
  if (calendarAnimTimer) {
    window.clearTimeout(calendarAnimTimer);
    calendarAnimTimer = null;
  }
  state.rangeDraft.active = false;
}

function syncRangeDraftFromCurrent() {
  const series = getSeriesForAccount(state.account);
  if (!series || series.length === 0) return;
  const range = getRange(series);
  state.rangeDraft.start = range.startDate;
  state.rangeDraft.end = range.endDate;
  state.rangeDraft.active = false;
}

function syncCustomRangeInputs(force) {
  if (!dom.customStartInput || !dom.customEndInput) return;
  const series = getSeriesForAccount(state.account);
  if (!series || series.length === 0) return;
  const range = getRange(series);
  const startValue = formatDate(range.startDate);
  const endValue = formatDate(range.endDate);
  const active = document.activeElement;
  if (force || active !== dom.customStartInput) {
    dom.customStartInput.value = startValue;
  }
  if (force || active !== dom.customEndInput) {
    dom.customEndInput.value = endValue;
  }
  dom.customStartInput.placeholder = state.dateFormat;
  dom.customEndInput.placeholder = state.dateFormat;
  if (force) {
    setInputValidity(dom.customStartInput, true);
    setInputValidity(dom.customEndInput, true);
  }
}

function setInputValidity(input, isValid) {
  if (!input) return;
  input.classList.toggle("is-invalid", !isValid);
}

function handleManualRangeInput(isCommit) {
  if (!dom.customStartInput || !dom.customEndInput) return;
  const startRaw = dom.customStartInput.value;
  const endRaw = dom.customEndInput.value;
  const startIso = parseDateInput(startRaw);
  const endIso = parseDateInput(endRaw);

  setInputValidity(dom.customStartInput, !startRaw || !!startIso);
  setInputValidity(dom.customEndInput, !endRaw || !!endIso);

  if (!startIso || !endIso) {
    if (isCommit && (startRaw || endRaw)) {
      showToast(t("toast.invalidDateRange"));
    }
    return;
  }

  if (startIso > endIso) {
    setInputValidity(dom.customStartInput, false);
    setInputValidity(dom.customEndInput, false);
    if (isCommit) {
      showToast(t("toast.invalidDateRange"));
    }
    return;
  }

  setCustomRange(startIso, endIso);
}

function ensureCalendarAnchor() {
  const series = getSeriesForAccount(state.account);
  if (!series || series.length === 0) return;
  const minIndex = getMonthIndexFromIso(series[0].date);
  const maxIndex = getMonthIndexFromIso(series[series.length - 1].date);
  const maxAnchor = maxIndex > minIndex ? maxIndex - 1 : maxIndex;
  let anchor = state.rangeAnchor;
  if (anchor === null || anchor < minIndex || anchor > maxAnchor) {
    const endDate = state.rangeDraft.end || getRange(series).endDate;
    const endIndex = getMonthIndexFromIso(endDate);
    anchor = endIndex - 1;
    if (anchor < minIndex) anchor = minIndex;
    if (anchor > maxAnchor) anchor = maxAnchor;
  }
  state.rangeAnchor = anchor;
  updateCalendarNavState(minIndex, maxAnchor);
}

function updateCalendarNavState(minIndex, maxAnchor) {
  if (!dom.calendarPrev || !dom.calendarNext) return;
  dom.calendarPrev.disabled = state.rangeAnchor <= minIndex;
  dom.calendarNext.disabled = state.rangeAnchor >= maxAnchor;
}

function shiftCalendarAnchor(delta) {
  const series = getSeriesForAccount(state.account);
  if (!series || series.length === 0) return;
  const minIndex = getMonthIndexFromIso(series[0].date);
  const maxIndex = getMonthIndexFromIso(series[series.length - 1].date);
  const maxAnchor = maxIndex > minIndex ? maxIndex - 1 : maxIndex;
  let next = (state.rangeAnchor ?? minIndex) + delta;
  if (next < minIndex) next = minIndex;
  if (next > maxAnchor) next = maxAnchor;
  state.rangeAnchor = next;
  updateCalendarNavState(minIndex, maxAnchor);
  triggerCalendarAnimate(delta > 0 ? "next" : "prev");
  renderRangeCalendars();
}

function getCalendarSelectionRange(series) {
  if (state.rangeDraft.active) {
    const start = state.rangeDraft.start;
    const end = state.rangeDraft.end || state.rangeDraft.start;
    if (start && end && start <= end) {
      return { start, end };
    }
    return { start: start || "", end: start || "" };
  }
  const range = getRange(series);
  return { start: range.startDate, end: range.endDate };
}

function renderRangeCalendars() {
  if (!dom.calendarStack) return;
  const series = getSeriesForAccount(state.account);
  if (!series || series.length === 0) {
    dom.calendarStack.innerHTML = "";
    return;
  }
  ensureCalendarAnchor();
  const minDate = series[0].date;
  const maxDate = series[series.length - 1].date;
  const maxIndex = getMonthIndexFromIso(maxDate);
  const anchorIndex = state.rangeAnchor ?? maxIndex;
  const secondIndex = Math.min(anchorIndex + 1, maxIndex);
  const selection = getCalendarSelectionRange(series);

  dom.calendarStack.innerHTML = "";
  const indices = [anchorIndex, secondIndex];
  indices.forEach((index, i) => {
    const { year, month } = monthIndexToYearMonth(index);
    const calendar = buildCalendarMonth(year, month, minDate, maxDate, selection);
    dom.calendarStack.appendChild(calendar);

    // Insert navigation buttons between the two calendars
    if (i === 0) {
      const nav = document.createElement("div");
      nav.className = "calendar-nav";

      const prevBtn = document.createElement("button");
      prevBtn.type = "button";
      prevBtn.className = "icon-button calendar-nav-btn";
      prevBtn.id = "calendarPrev";
      prevBtn.setAttribute("aria-label", "Previous month");
      prevBtn.textContent = "<";
      prevBtn.disabled = dom.calendarPrev ? dom.calendarPrev.disabled : state.rangeAnchor <= getMonthIndexFromIso(minDate);
      prevBtn.addEventListener("click", () => shiftCalendarAnchor(-1));

      const nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.className = "icon-button calendar-nav-btn";
      nextBtn.id = "calendarNext";
      nextBtn.setAttribute("aria-label", "Next month");
      nextBtn.textContent = ">";
      nextBtn.disabled = dom.calendarNext ? dom.calendarNext.disabled : state.rangeAnchor >= maxIndex - 1;
      nextBtn.addEventListener("click", () => shiftCalendarAnchor(1));

      nav.appendChild(prevBtn);
      nav.appendChild(nextBtn);
      dom.calendarStack.appendChild(nav);

      // Update dom references to the new buttons
      dom.calendarPrev = prevBtn;
      dom.calendarNext = nextBtn;
    }
  });
}

function buildCalendarMonth(year, month, minDate, maxDate, selection) {
  const calendar = document.createElement("div");
  calendar.className = "calendar";

  const header = document.createElement("div");
  header.className = "calendar-header";
  header.textContent = getMonthLabel(year, month);
  calendar.appendChild(header);

  const weekdays = document.createElement("div");
  weekdays.className = "calendar-weekdays";
  getWeekdayLabels().forEach((label) => {
    const cell = document.createElement("span");
    cell.textContent = label;
    weekdays.appendChild(cell);
  });
  calendar.appendChild(weekdays);

  const grid = document.createElement("div");
  grid.className = "calendar-grid";
  const firstDay = new Date(Date.UTC(year, month, 1));
  const offset = firstDay.getUTCDay();

  for (let i = 0; i < 42; i += 1) {
    const cellDate = new Date(Date.UTC(year, month, 1 - offset + i));
    const iso = toIsoDate(cellDate);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";
    button.dataset.date = iso;
    button.textContent = String(cellDate.getUTCDate());

    const isOtherMonth = cellDate.getUTCMonth() !== month;
    const isDisabled = iso < minDate || iso > maxDate;
    if (isOtherMonth) button.classList.add("is-other");
    if (isDisabled) button.classList.add("is-disabled");

    if (selection.start && selection.end && iso >= selection.start && iso <= selection.end) {
      button.classList.add("is-in-range");
    }
    if (selection.start && iso === selection.start) {
      button.classList.add("is-start");
    }
    if (selection.end && iso === selection.end) {
      button.classList.add("is-end");
    }

    grid.appendChild(button);
  }

  calendar.appendChild(grid);
  return calendar;
}

function handleCalendarSelect(date) {
  if (!state.rangeDraft.active) {
    state.rangeDraft.start = date;
    state.rangeDraft.end = "";
    state.rangeDraft.active = true;
    syncInputsFromDraft();
    renderRangeCalendars();
    return;
  }
  state.rangeDraft.end = date;
  state.rangeDraft.active = false;
  setCustomRange(state.rangeDraft.start, state.rangeDraft.end || state.rangeDraft.start);
  renderRangeCalendars();
  triggerCalendarAnimate("select");
}

function syncInputsFromDraft() {
  if (!dom.customStartInput || !dom.customEndInput) return;
  if (!state.rangeDraft.start) return;
  dom.customStartInput.value = formatDate(state.rangeDraft.start);
  dom.customEndInput.value = state.rangeDraft.end ? formatDate(state.rangeDraft.end) : "";
  setInputValidity(dom.customStartInput, true);
  setInputValidity(dom.customEndInput, true);
}

function showToast(message, isError) {
  dom.toast.textContent = message;
  dom.toast.classList.toggle("toast-error", !!isError);
  dom.toast.classList.add("is-visible");
  setTimeout(() => {
    dom.toast.classList.remove("is-visible");
    dom.toast.classList.remove("toast-error");
  }, isError ? 4000 : 2200);
}

function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  };
  return String(text).replace(/[&<>"']/g, (match) => map[match]);
}

/* ---- Transaction Tooltip ---- */

function createTxTooltip() {
  const el = document.createElement("div");
  el.id = "txTooltip";
  el.style.display = "none";
  document.body.appendChild(el);
}

function bindTxTooltipEvents(container) {
  if (!container) return;
  container.addEventListener("mouseover", (event) => {
    const row = event.target.closest(".transaction-row, .detail-row");
    if (!row || !row._txData) return;
    showTxTooltip(row._txData, event);
  });
  container.addEventListener("mouseout", (event) => {
    const row = event.target.closest(".transaction-row, .detail-row");
    if (!row) return;
    const related = event.relatedTarget;
    if (related && row.contains(related)) return;
    hideTxTooltip();
  });
  container.addEventListener("mousemove", moveTxTooltip);
}

function showTxTooltip(tx, event) {
  const el = document.getElementById("txTooltip");
  if (!el) return;
  const currency = getCurrencyByCode(tx.currency);
  const currencyLabel = currency ? `${getAlias(currency.alias)} (${currency.currency_symbol})` : tx.currency;
  const rows = [
    [t("tooltip.transactionId"), tx.id],
    [t("tooltip.date"), formatDate(tx.date)],
    [t("tooltip.accountCode"), tx.account_code],
    [t("tooltip.accountAlias"), getAlias(tx.alias)],
    [t("tooltip.typeCode"), `${tx.type_code} (${formatType(tx.type)})`],
    [t("tooltip.cashflowDirection"), `${tx.cashflow_direction} (${getDirectionLabel(tx.cashflow_direction)})`],
    [t("tooltip.currency"), currencyLabel],
    [t("tooltip.amount"), formatMoney(tx.amount, tx.currency)],
    [t("tooltip.balance"), formatMoney(tx.balance, tx.currency)],
    [t("tooltip.category"), translateCategory(tx.category)],
    [t("tooltip.description"), tx.description],
    [t("tooltip.rawText"), tx.raw_text || "-"],
    [t("tooltip.processedAt"), tx.processed_at || "-"],
    [t("tooltip.fileName"), tx.file_name || "-"],
  ];
  el.innerHTML = rows.map(([k, v]) => `<div class="tt-row"><span class="tt-key">${escapeHtml(k)}</span><span class="tt-val">${escapeHtml(String(v))}</span></div>`).join("");
  el.style.display = "block";
  positionTxTooltip(el, event);
}

function hideTxTooltip() {
  const el = document.getElementById("txTooltip");
  if (el) el.style.display = "none";
}

function moveTxTooltip(event) {
  const el = document.getElementById("txTooltip");
  if (!el || el.style.display === "none") return;
  positionTxTooltip(el, event);
}

function positionTxTooltip(el, event) {
  const pad = 12;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cx = event.clientX;
  const cy = event.clientY;

  let x = cx + pad;
  let y = cy - h - pad;

  // Not enough space above → show below
  if (y < 0) y = cy + pad;
  // Not enough space below → show above
  if (y + h > vh) y = cy - h - pad;
  // Not enough space on the right → show on the left
  if (x + w > vw) x = cx - w - pad;
  // Not enough space on the left → show on the right
  if (x < 0) x = cx + pad;

  el.style.left = x + "px";
  el.style.top = y + "px";
}
