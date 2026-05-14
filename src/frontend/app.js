const DATA_PATHS = {
  accounts: "../../data/config/accounts.json",
  currencies: "../../data/config/currency.json",
  dailySeries: "../../data/ui/ui_daily_series.json",
  staticCharts: "../../data/ui/ui_static_charts.json",
  transactions: "../../data/ui/ui_transactions_and_categories.json",
  currencyBreakdown: "../../data/ui/ui_currency_breakdown.json",
  fxRates: "../../data/database/fx_rate.json",
  multiLang: "multi-lang.json"
};

const state = {
  view: "dashboard",
  account: null,
  currency: "default",
  language: localStorage.getItem("language") || "zh",
  theme: localStorage.getItem("theme") || "system",
  rangeMode: "90",
  customRange: {
    start: "",
    end: ""
  },
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
  balanceMeta: document.getElementById("balanceMeta"),
  balanceDelta: document.getElementById("balanceDelta"),
  accountBreakdown: document.getElementById("accountBreakdown"),
  netflowValue: document.getElementById("netflowValue"),
  inflowValue: document.getElementById("inflowValue"),
  outflowValue: document.getElementById("outflowValue"),
  inflowRatio: document.getElementById("inflowRatio"),
  outflowRatio: document.getElementById("outflowRatio"),
  transferValue: document.getElementById("transferValue"),
  heatmapLegend: document.getElementById("heatmapLegend"),
  donutLegend: document.getElementById("donutLegend"),
  transactionSort: document.getElementById("transactionSort"),
  transactionsList: document.getElementById("transactionsList"),
  transactionFilters: document.getElementById("transactionFilters"),
  dashboardView: document.getElementById("dashboardView"),
  transactionsView: document.getElementById("transactionsView"),
  rangeModal: document.getElementById("rangeModal"),
  rangeStart: document.getElementById("rangeStart"),
  rangeEnd: document.getElementById("rangeEnd"),
  applyRange: document.getElementById("applyRange"),
  closeRangeModal: document.getElementById("closeRangeModal"),
  customRange: document.getElementById("customRange"),
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
  currencySelector: document.getElementById("currencySelector")
};

const palette = ["#ff385c", "#ff8b5a", "#f5c542", "#33b28a", "#2f80ed", "#222222", "#ff9aa7"];

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
    rausch: s.getPropertyValue("--rausch").trim(),
    heatmap: [
      s.getPropertyValue("--heatmap-0").trim(),
      s.getPropertyValue("--heatmap-1").trim(),
      s.getPropertyValue("--heatmap-2").trim(),
      s.getPropertyValue("--heatmap-3").trim(),
      s.getPropertyValue("--heatmap-4").trim()
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

function openSettingsModal() {
  dom.settingsModal.classList.add("is-open");
  dom.settingsModal.setAttribute("aria-hidden", "false");
  buildCurrencySelector();
  setActiveThemeOption();
}

function closeSettingsModal() {
  dom.settingsModal.classList.remove("is-open");
  dom.settingsModal.setAttribute("aria-hidden", "true");
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
});

async function init() {
  try {
    applyTheme(state.theme);
    const [accounts, currencies, dailySeries, staticCharts, transactions, currencyBreakdown, fxRates, multiLang] = await Promise.all([
      fetchJson(DATA_PATHS.accounts),
      fetchJson(DATA_PATHS.currencies),
      fetchJson(DATA_PATHS.dailySeries),
      fetchJson(DATA_PATHS.staticCharts),
      fetchJson(DATA_PATHS.transactions),
      fetchJson(DATA_PATHS.currencyBreakdown).catch(() => ({})),
      fetchJson(DATA_PATHS.fxRates).catch(() => ({ rates: {} })),
      fetchJson(DATA_PATHS.multiLang).catch(() => ({}))
    ]);

    state.data.accounts = accounts;
    state.data.currencies = currencies;
    state.data.dailySeries = dailySeries;
    state.data.staticCharts = staticCharts;
    state.data.transactions = transactions;
    state.data.currencyBreakdown = currencyBreakdown;
    state.data.fxRates = fxRates.rates || {};
    state.data.translations = multiLang;

    buildAccountList();
    bindEvents();
    initCharts();
    setInitialSelections();
    applyLanguage();
    updateAll();
    revealCards();
    createTxTooltip();
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
  });

  dom.customRange.addEventListener("click", () => {
    openRangeModal();
  });

  dom.applyRange.addEventListener("click", () => {
    const start = dom.rangeStart.value;
    const end = dom.rangeEnd.value;
    if (!start || !end || start > end) {
      showToast(t("toast.invalidDateRange"));
      return;
    }
    setCustomRange(start, end);
    closeRangeModal();
  });

  dom.closeRangeModal.addEventListener("click", closeRangeModal);
  dom.rangeModal.addEventListener("click", (event) => {
    if (event.target === dom.rangeModal) {
      closeRangeModal();
    }
  });

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

  bindTxTooltipEvents(dom.transactionsList);
  bindTxTooltipEvents(dom.detailList);

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
  dom.rangeInfo.textContent = `${range.startDate} — ${range.endDate}`;
  dom.rangeSummary.textContent = `${range.startDate} - ${range.endDate}`;
  dom.lastUpdated.textContent = `${t("status.dataUpTo")} ${range.endDate}`;
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
  dom.balanceMeta.textContent = `${t("balance.endBalanceOn")} ${range.endDate}`;

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
  const transfer = sumBy(slice, "net_internal_transfer");

  dom.netflowValue.textContent = formatMoney(netflow);
  dom.inflowValue.textContent = formatMoney(inflow);
  dom.outflowValue.textContent = formatMoney(outflow);
  dom.transferValue.textContent = formatMoney(transfer);

  const startBalance = slice[0].start_balance;
  dom.inflowRatio.textContent = formatRatio(inflow, startBalance, "+");
  dom.outflowRatio.textContent = formatRatio(outflow, startBalance, "-");
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
      formatter: (params) => `${params.data[0]}<br/>${formatMoney(params.data[1])}`
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
    }]
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
        itemStyle: { color: theme.rausch },
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
    ]
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
        itemStyle: { color: theme.rausch },
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
    ]
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
        color: palette
      }
    ]
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
    .filter((item) => item.type === state.categoryType)
    .filter((item) => item.date >= range.startDate && item.date <= range.endDate);

  const totals = groupByCategory(filtered);
  const donutData = Object.entries(totals).map(([name, value], index) => ({
    name: translateCategory(name),
    value,
    itemStyle: { color: palette[index % palette.length] }
  }));

  const option = {
    tooltip: {
      trigger: "item",
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
    ]
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

  filtered.forEach((item) => {
    const row = document.createElement("div");
    row.className = "transaction-row";
    row._txData = item;
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(item.description)}</strong>
        <div class="meta">${escapeHtml(item.date)}</div>
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
    openCategoryDetail(params.name, state.categoryType);
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
  setActiveRangeButton();
  updateAll();
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
  dom.detailSubtitle.textContent = `${date} · ${getAccountLabel(state.account)}`;
  renderDetailMetrics([
    { label: t("detail.date"), value: date },
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
  dom.detailSubtitle.textContent = `${translateCategory(category)} · ${range.startDate} — ${range.endDate}`;
  renderDetailMetrics([
    { label: t("detail.category"), value: translateCategory(category) },
    { label: t("detail.range"), value: `${range.startDate} — ${range.endDate}` },
    { label: t("detail.transactions"), value: String(transactions.length) },
    { label: t("detail.totalAmount"), value: formatMoney(total) }
  ]);
  dom.detailFilters.style.display = "flex";
  syncDetailFilters();
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

  transactions.forEach((item) => {
    const row = document.createElement("div");
    row.className = "detail-row";
    row._txData = item;
    row.innerHTML = `
      <div><strong>${escapeHtml(item.description)}</strong><div class="meta">${escapeHtml(item.date)}</div></div>
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
      .filter((item) => item.date >= range.startDate && item.date <= range.endDate)
      .filter((item) => state.detail.filters[item.type]);
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
  "all_inflow", "all_outflow", "net_internal_transfer",
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

function formatRatio(value, base, sign) {
  if (!base) return "--";
  const ratio = (value / base) * 100;
  const prefix = sign === "+" && ratio >= 0 ? "+" : "";
  return `${prefix}${ratio.toFixed(1)}%`;
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
  dom.balanceMeta.textContent = "";
  dom.balanceDelta.textContent = "";
  dom.accountBreakdown.innerHTML = "";
  dom.netflowValue.textContent = "--";
  dom.inflowValue.textContent = "--";
  dom.outflowValue.textContent = "--";
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

function openRangeModal() {
  dom.rangeModal.classList.add("is-open");
  dom.rangeModal.setAttribute("aria-hidden", "false");
  const series = getSeriesForAccount(state.account);
  if (series && series.length > 0) {
    dom.rangeStart.value = state.customRange.start || series[0].date;
    dom.rangeEnd.value = state.customRange.end || series[series.length - 1].date;
  }
}

function closeRangeModal() {
  dom.rangeModal.classList.remove("is-open");
  dom.rangeModal.setAttribute("aria-hidden", "true");
}

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("is-visible");
  setTimeout(() => {
    dom.toast.classList.remove("is-visible");
  }, 2200);
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
    [t("tooltip.date"), tx.date],
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
  let x = event.clientX + pad;
  let y = event.clientY - h - pad;
  if (y < 0) y = event.clientY + pad;
  if (x + w > vw) x = event.clientX - w - pad;
  el.style.left = x + "px";
  el.style.top = y + "px";
}
