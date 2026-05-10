const DATA_PATHS = {
  accounts: "../../data/database/accounts.json",
  dailySeries: "../../data/ui/ui_daily_series.json",
  staticCharts: "../../data/ui/ui_static_charts.json",
  transactions: "../../data/ui/ui_transactions_and_categories.json"
};

const state = {
  view: "dashboard",
  account: null,
  rangeMode: "30",
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
  data: {
    accounts: [],
    dailySeries: {},
    staticCharts: {},
    transactions: {}
  },
  charts: {}
};

const dom = {
  accountList: document.getElementById("accountList"),
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
  toast: document.getElementById("toast"),
  toggleMotion: document.getElementById("toggleMotion")
};

const palette = ["#ff385c", "#ff8b5a", "#f5c542", "#33b28a", "#2f80ed", "#222222", "#ff9aa7"];

init();

async function init() {
  try {
    const [accounts, dailySeries, staticCharts, transactions] = await Promise.all([
      fetchJson(DATA_PATHS.accounts),
      fetchJson(DATA_PATHS.dailySeries),
      fetchJson(DATA_PATHS.staticCharts),
      fetchJson(DATA_PATHS.transactions)
    ]);

    state.data.accounts = accounts;
    state.data.dailySeries = dailySeries;
    state.data.staticCharts = staticCharts;
    state.data.transactions = transactions;

    buildAccountList();
    bindEvents();
    initCharts();
    setInitialSelections();
    updateAll();
    revealCards();
  } catch (error) {
    showToast("Failed to load data. Use a local server.");
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
  const list = [];
  if (state.data.dailySeries.total) {
    list.push({ code: "total", label: "Total Asset" });
  }

  state.data.accounts.forEach((account) => {
    if (state.data.dailySeries[account.account_code]) {
      list.push({ code: account.account_code, label: account.alias || account.account_name });
    }
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
    updateAll();
    setActiveAccount();
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
      showToast("Select a valid date range.");
      return;
    }
    state.customRange.start = start;
    state.customRange.end = end;
    state.rangeMode = "custom";
    closeRangeModal();
    setActiveRangeButton();
    updateAll();
  });

  dom.closeRangeModal.addEventListener("click", closeRangeModal);
  dom.rangeModal.addEventListener("click", (event) => {
    if (event.target === dom.rangeModal) {
      closeRangeModal();
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
    state.transactionFilters[filter] = !state.transactionFilters[filter];
    button.classList.toggle("is-active", state.transactionFilters[filter]);
    updateTransactionsView();
  });

  dom.toggleMotion.addEventListener("change", () => {
    if (!dom.toggleMotion.checked) {
      document.querySelectorAll(".reveal").forEach((card) => {
        card.classList.add("is-visible");
      });
    } else {
      revealCards();
    }
  });

  window.addEventListener("resize", () => {
    Object.values(state.charts).forEach((chart) => chart && chart.resize());
  });
}

function setInitialSelections() {
  setActiveAccount();
  setActiveRangeButton();
  setActiveCategoryToggle();
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
}

function setActiveCategoryToggle() {
  document.querySelectorAll(".toggle-btn").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.type === state.categoryType);
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
    dom.rangeInfo.textContent = "No data";
    return;
  }
  const range = getRange(series);
  dom.rangeInfo.textContent = `${range.startDate} to ${range.endDate}`;
  dom.rangeSummary.textContent = `${range.startDate} - ${range.endDate}`;
  dom.lastUpdated.textContent = `Data up to ${range.endDate}`;
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
  dom.balanceMeta.textContent = `End balance on ${range.endDate}`;

  const delta = getDelta(series, range);
  dom.balanceDelta.textContent = delta.label;
  dom.balanceDelta.className = "delta";
  if (delta.status !== "neutral") {
    dom.balanceDelta.classList.add(delta.status === "positive" ? "is-positive" : "is-negative");
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
      row.innerHTML = `<span>${escapeHtml(account.alias || account.account_name)}</span><strong>${formatMoney(balanceAtDate.end_balance)}</strong>`;
      dom.accountBreakdown.appendChild(row);
    });
  }
}

function updateCashflow(slice) {
  const inflow = sumBy(slice, "all_inflow");
  const outflow = sumBy(slice, "all_outflow");
  const netflow = inflow + outflow;
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
  const staticData = state.data.staticCharts[state.account];
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

  const option = {
    tooltip: {
      formatter: (params) => `${params.data[0]}<br/>${formatMoney(params.data[1])}`
    },
    visualMap: {
      min: -rangeAbs,
      max: rangeAbs,
      show: false,
      inRange: {
        color: ["#2f80ed", "#9fc2ff", "#ebedf0", "#ff9aa7", "#ff385c"]
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
        borderColor: "#ffffff",
        borderWidth: 2,
        borderRadius: 2
      },
      splitLine: {
        show: false
      },
      yearLabel: { show: false },
      monthLabel: {
        show: true,
        color: "#6a6a6a",
        fontSize: 10,
        margin: 4,
        nameMap: "en",
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
  const staticData = state.data.staticCharts[state.account];
  if (!staticData || !staticData.monthly_combo) return;

  const months = staticData.monthly_combo.map((entry) => entry.month);
  const balances = staticData.monthly_combo.map((entry) => entry.end_balance);
  const inflow = staticData.monthly_combo.map((entry) => entry.inflow);
  const outflow = staticData.monthly_combo.map((entry) => entry.outflow);

  const option = {
    tooltip: { trigger: "axis" },
    legend: { show: false },
    grid: { left: 38, right: 16, top: 22, bottom: 26, containLabel: true },
    xAxis: {
      type: "category",
      data: months,
      axisLine: { lineStyle: { color: "#dddddd" } },
      axisLabel: { color: "#6a6a6a", fontSize: 10 }
    },
    yAxis: [
      {
        type: "value",
        axisLabel: { color: "#6a6a6a", fontSize: 10 },
        splitLine: { lineStyle: { color: "#ebebeb" } }
      },
      {
        type: "value",
        axisLabel: { color: "#6a6a6a", fontSize: 10 },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: "Inflow",
        type: "bar",
        data: inflow,
        yAxisIndex: 1,
        itemStyle: { color: "#ff385c" },
        stack: "flow",
        barWidth: 24
      },
      {
        name: "Outflow",
        type: "bar",
        data: outflow,
        yAxisIndex: 1,
        itemStyle: { color: "rgba(34,34,34,0.35)" },
        stack: "flow",
        barWidth: 24
      },
      {
        name: "Balance",
        type: "line",
        data: balances,
        smooth: true,
        itemStyle: { color: "#222222" },
        lineStyle: { width: 2 }
      }
    ]
  };

  state.charts.monthly.setOption(option, true);
}

function updateDailyChart(slice) {
  const dates = slice.map((entry) => entry.date);
  const balances = slice.map((entry) => entry.end_balance);
  const inflow = slice.map((entry) => entry.filtered_inflow);
  const outflow = slice.map((entry) => entry.filtered_outflow);
  const balanceMin = Math.min(...balances);
  const balanceMax = Math.max(...balances);
  const balancePad = Math.max((balanceMax - balanceMin) * 0.08, balanceMax * 0.002, 1);

  const option = {
    tooltip: { trigger: "axis" },
    grid: { left: 48, right: 28, top: 28, bottom: 30, containLabel: true },
    xAxis: {
      type: "category",
      data: dates,
      axisLine: { lineStyle: { color: "#dddddd" } },
      axisLabel: { color: "#6a6a6a" }
    },
    yAxis: [
      {
        type: "value",
        min: balanceMin - balancePad,
        max: balanceMax + balancePad,
        scale: true,
        axisLabel: { color: "#6a6a6a" },
        splitLine: { lineStyle: { color: "#ebebeb" } }
      },
      {
        type: "value",
        axisLabel: { color: "#6a6a6a" },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: "Inflow",
        type: "bar",
        data: inflow,
        yAxisIndex: 1,
        itemStyle: { color: "#ff385c" },
        stack: "daily"
      },
      {
        name: "Outflow",
        type: "bar",
        data: outflow,
        yAxisIndex: 1,
        itemStyle: { color: "rgba(34,34,34,0.35)" },
        stack: "daily"
      },
      {
        name: "Balance",
        type: "line",
        data: balances,
        smooth: true,
        itemStyle: { color: "#222222" },
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
  const flowThrough = Math.min(sumIncome, sumExpense);

  const nodes = new Set();
  const links = [];

  Object.keys(income).forEach((category) => {
    nodes.add(category);
    links.push({ source: category, target: "Total Income", value: income[category] });
  });

  nodes.add("Total Income");
  nodes.add("Total Expense");

  if (flowThrough > 0) {
    links.push({ source: "Total Income", target: "Total Expense", value: flowThrough });
  }

  if (sumExpense > sumIncome) {
    nodes.add("Use Balance");
    links.push({ source: "Use Balance", target: "Total Expense", value: sumExpense - sumIncome });
  }

  if (sumIncome > sumExpense) {
    nodes.add("Retained");
    links.push({ source: "Total Income", target: "Retained", value: sumIncome - sumExpense });
  }

  Object.keys(expense).forEach((category) => {
    nodes.add(category);
    links.push({ source: "Total Expense", target: category, value: expense[category] });
  });

  const option = {
    tooltip: { trigger: "item" },
    series: [
      {
        type: "sankey",
        data: Array.from(nodes).map((name) => ({ name })),
        links,
        emphasis: { focus: "adjacency" },
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
    name,
    value,
    itemStyle: { color: palette[index % palette.length] }
  }));

  const option = {
    tooltip: { trigger: "item" },
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
    dom.transactionsList.innerHTML = `<div class="card">No transactions in range.</div>`;
    return;
  }

  filtered.forEach((item) => {
    const row = document.createElement("div");
    row.className = "transaction-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(item.description)}</strong>
        <div class="meta">${escapeHtml(item.category)} - ${escapeHtml(item.date)}</div>
      </div>
      <div class="meta">${escapeHtml(item.id)}</div>
      <div><span class="tag ${item.type}">${formatType(item.type)}</span></div>
      <div class="transaction-amount">${formatSignedMoney(item.amount, item.type)}</div>
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
}

function getSeriesForAccount(code) {
  return state.data.dailySeries[code];
}

function getTransactionsForAccount(code) {
  return (state.data.transactions[code] && state.data.transactions[code].transactions) || [];
}

function getRange(series) {
  const endDate = series[series.length - 1].date;
  let startDate = series[0].date;

  if (state.rangeMode === "7") {
    startDate = series[Math.max(series.length - 7, 0)].date;
  } else if (state.rangeMode === "30") {
    startDate = series[Math.max(series.length - 30, 0)].date;
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
  if (state.rangeMode !== "7" && state.rangeMode !== "30") {
    return { label: "Change hidden", status: "neutral" };
  }

  const endIndex = series.findIndex((entry) => entry.date === range.endDate);
  const days = state.rangeMode === "7" ? 7 : 30;
  const prevIndex = endIndex - days;
  if (endIndex < 0 || prevIndex < 0) {
    return { label: "Change hidden", status: "neutral" };
  }

  const current = series[endIndex].end_balance;
  const prev = series[prevIndex].end_balance;
  if (prev === 0) {
    return { label: "Change hidden", status: "neutral" };
  }

  const change = ((current - prev) / prev) * 100;
  const label = `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
  return { label, status: change >= 0 ? "positive" : "negative" };
}

function getAccountLabel(code) {
  if (code === "total") return "Total Asset";
  const account = state.data.accounts.find((item) => item.account_code === code);
  return account ? account.alias || account.account_name : code;
}

function sumBy(list, key) {
  return list.reduce((sum, item) => sum + (Number(item[key]) || 0), 0);
}

function groupByCategory(items) {
  return items.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + item.amount;
    return acc;
  }, {});
}

function sumValues(map) {
  return Object.values(map).reduce((sum, value) => sum + value, 0);
}

function formatMoney(value) {
  const amount = Number(value) || 0;
  const sign = amount < 0 ? "-" : "";
  return `${sign}CNY ${Math.abs(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatSignedMoney(value, type) {
  const sign = type === "expense" || type === "transfer" ? "-" : "+";
  return `${sign}${formatMoney(value)}`;
}

function formatRatio(value, base, sign) {
  if (!base) return "--";
  const ratio = (value / base) * 100;
  const prefix = sign === "+" && ratio >= 0 ? "+" : "";
  return `${prefix}${ratio.toFixed(1)}%`;
}

function formatType(type) {
  return type.charAt(0).toUpperCase() + type.slice(1);
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
  dom.balanceTitle.textContent = "No data";
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
  if (!dom.toggleMotion.checked) return;
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
