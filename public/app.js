const statusDetails = {
  unread: { label: "未阅读", className: "chip-unread" },
  reading: { label: "阅读中", className: "chip-reading" },
  completed: { label: "已完成", className: "chip-completed" },
};

const THEME_STORAGE_KEY = "learning-tracker-theme";
const SETTINGS_TAB_STORAGE_KEY = "learning-tracker-settings-tab";
const availableThemes = new Set([
  "warm", "ocean", "forest", "sunset", "latte", "solarized",
  "midnight", "nord", "mocha", "dracula", "gruvbox",
]);
const darkThemes = new Set(["midnight", "nord", "mocha", "dracula", "gruvbox"]);
const availableSettingsTabs = new Set(["model", "network", "labels", "appearance"]);

function readLocalPreference(key, fallback) {
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function saveLocalPreference(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The UI still works when storage is unavailable.
  }
}

function applyTheme(theme, persist = true) {
  const selectedTheme = availableThemes.has(theme) ? theme : "warm";
  document.documentElement.dataset.theme = selectedTheme;
  document.documentElement.dataset.colorScheme = darkThemes.has(selectedTheme) ? "dark" : "light";
  document.querySelectorAll('input[name="app-theme"]').forEach((input) => {
    input.checked = input.value === selectedTheme;
  });
  if (persist) saveLocalPreference(THEME_STORAGE_KEY, selectedTheme);
}

applyTheme(readLocalPreference(THEME_STORAGE_KEY, "warm"), false);

const state = {
  articles: [],
  labels: [],
  allLabels: [],
  counts: { all: 0, unread: 0, reading: 0, completed: 0 },
  search: "",
  status: "all",
  labelId: null,
  importItems: [],
  pendingDeleteId: null,
  editingId: null,
  classificationPoll: null,
};

const elements = {
  body: document.querySelector("#article-body"),
  empty: document.querySelector("#empty-state"),
  table: document.querySelector(".table-wrap"),
  toastRegion: document.querySelector("#toast-region"),
  labelFilter: document.querySelector("#label-filter"),
  importDialog: document.querySelector("#import-dialog"),
  pasteStep: document.querySelector("#paste-step"),
  previewStep: document.querySelector("#preview-step"),
  linkInput: document.querySelector("#link-input"),
  linkCount: document.querySelector("#link-count"),
  previewButton: document.querySelector("#preview-links"),
  confirmButton: document.querySelector("#confirm-import"),
  previewList: document.querySelector("#preview-list"),
  editDialog: document.querySelector("#edit-dialog"),
  editForm: document.querySelector("#edit-form"),
  editTitle: document.querySelector("#edit-article-title"),
  editUrl: document.querySelector("#edit-article-url"),
  editStatus: document.querySelector("#edit-article-status"),
  editLabels: document.querySelector("#edit-label-list"),
  editSave: document.querySelector("#edit-save"),
  settingsDialog: document.querySelector("#settings-dialog"),
  settingsTabs: document.querySelector(".settings-tabs"),
  settingsContent: document.querySelector(".settings-content"),
  themePicker: document.querySelector(".theme-picker"),
  llmForm: document.querySelector("#llm-settings-form"),
  llmBaseUrl: document.querySelector("#llm-base-url"),
  llmModel: document.querySelector("#llm-model"),
  llmApiKey: document.querySelector("#llm-api-key"),
  llmSubscriptionHeader: document.querySelector("#llm-subscription-header"),
  llmSubscriptionKey: document.querySelector("#llm-subscription-key"),
  llmUserHeader: document.querySelector("#llm-user-header"),
  llmUserValue: document.querySelector("#llm-user-value"),
  llmTimeout: document.querySelector("#llm-timeout"),
  llmMaxLabels: document.querySelector("#llm-max-labels"),
  llmAutoLabel: document.querySelector("#llm-auto-label"),
  apiKeyState: document.querySelector("#api-key-state"),
  secretHint: document.querySelector("#secret-hint"),
  connectionResult: document.querySelector("#connection-result"),
  networkForm: document.querySelector("#network-settings-form"),
  networkUseProxy: document.querySelector("#network-use-proxy"),
  networkHttpProxy: document.querySelector("#network-http-proxy"),
  networkSocksProxy: document.querySelector("#network-socks-proxy"),
  networkFallbackDirect: document.querySelector("#network-fallback-direct"),
  networkTestUrl: document.querySelector("#network-test-url"),
  networkModeState: document.querySelector("#network-mode-state"),
  networkCapabilityHint: document.querySelector("#network-capability-hint"),
  networkTestResult: document.querySelector("#network-test-result"),
  managedLabels: document.querySelector("#managed-label-list"),
  labelForm: document.querySelector("#label-form"),
};

function activateSettingsTab(tabName, { focus = false, persist = true } = {}) {
  const selectedTab = availableSettingsTabs.has(tabName) ? tabName : "model";
  document.querySelectorAll("[data-settings-tab]").forEach((tab) => {
    const active = tab.dataset.settingsTab === selectedTab;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focus) tab.focus();
  });
  document.querySelectorAll("[data-settings-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.settingsPanel !== selectedTab;
  });
  elements.settingsContent.scrollTop = 0;
  if (persist) saveLocalPreference(SETTINGS_TAB_STORAGE_KEY, selectedTab);
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json", ...options.headers } : options.headers,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "操作失败，请稍后再试");
  return payload;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  const date = new Date(value);
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startToday - startDate) / 86_400_000);
  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  if (date.getFullYear() === today.getFullYear()) {
    return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date);
  }
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function labelChip(label) {
  return `<span class="article-label" style="--label-color:${escapeHtml(label.color)}" title="${escapeHtml(label.description)}">${escapeHtml(label.name)}</span>`;
}

function labelCell(article) {
  const chips = article.labels.map(labelChip).join("");
  let stateIndicator = "";
  if (article.labelStatus === "pending") {
    stateIndicator = `<span class="classification-state pending"><span class="mini-spinner"></span>分类中</span>`;
  } else if (article.labelStatus === "error") {
    stateIndicator = `<span class="classification-state failed" title="${escapeHtml(article.labelError || "自动分类失败")}">分类失败</span>`;
  } else if (!chips) {
    stateIndicator = `<span class="classification-state">待分类</span>`;
  }
  return `<div class="article-labels">${chips}${stateIndicator}</div>`;
}

function articleRow(article) {
  const status = statusDetails[article.status] || statusDetails.unread;
  return `
    <tr data-article-id="${article.id}">
      <td>
        <a class="article-title" href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(article.title)}">${escapeHtml(article.title)}</a>
        <div class="article-subline">
          <span class="article-domain">${escapeHtml(article.domain)}</span>
          ${labelCell(article)}
        </div>
      </td>
      <td>
        <select class="status-select ${status.className}" data-action="status" aria-label="修改《${escapeHtml(article.title)}》的阅读状态">
          <option value="unread" ${article.status === "unread" ? "selected" : ""}>未阅读</option>
          <option value="reading" ${article.status === "reading" ? "selected" : ""}>阅读中</option>
          <option value="completed" ${article.status === "completed" ? "selected" : ""}>已完成</option>
        </select>
      </td>
      <td class="date-cell">${formatDate(article.createdAt)}</td>
      <td><div class="row-actions">
        <button class="row-action-button classify-button" type="button" data-action="classify" aria-label="自动分类《${escapeHtml(article.title)}》" title="${article.labelStatus === "error" ? escapeHtml(article.labelError) : "使用大模型重新分类"}" ${article.labelStatus === "pending" ? "disabled" : ""}>
          <svg viewBox="0 0 18 18" aria-hidden="true"><path d="m9 2 .7 2.8L12.5 6 9.7 7.2 9 10l-.7-2.8L5.5 6l2.8-1.2L9 2ZM14 10l.5 1.8 1.5.7-1.5.7L14 15l-.5-1.8-1.5-.7 1.5-.7L14 10Z"/></svg>
        </button>
        <button class="row-action-button edit-button" type="button" data-action="edit" aria-label="修改《${escapeHtml(article.title)}》">
          <svg viewBox="0 0 18 18" aria-hidden="true"><path d="m4 13.5.7-3.1 7.4-7.4 2.9 2.9-7.4 7.4-3.1.7L4 13.5Z"/><path d="m10.9 4.2 2.9 2.9M4.7 10.4l2.9 2.9"/></svg>
        </button>
        <button class="row-action-button delete-button" type="button" data-action="delete" aria-label="删除《${escapeHtml(article.title)}》">
          <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M4.5 6h9M7 3.5h4L12 6H6l1-2.5ZM6 6l.5 8h5L12 6M8 8.5v3M10 8.5v3"/></svg>
        </button>
      </div></td>
    </tr>`;
}

function render() {
  for (const key of Object.keys(state.counts)) {
    const count = document.querySelector(`#count-${key}`);
    if (count) count.textContent = state.counts[key];
  }
  const isEmpty = state.articles.length === 0;
  elements.table.hidden = isEmpty;
  elements.empty.hidden = !isEmpty;
  if (isEmpty) {
    const filtered = state.status !== "all" || state.search || state.labelId;
    document.querySelector("#empty-title").textContent = filtered ? "没有找到符合条件的文章" : "阅读清单还是空的";
    document.querySelector("#empty-copy").textContent = filtered
      ? "试试更换筛选条件或搜索关键词。"
      : "粘贴一些最近想读的文章，从这里开始积累。";
    document.querySelector("#empty-import").hidden = filtered;
  }
  elements.body.innerHTML = state.articles.map(articleRow).join("");
  scheduleClassificationPoll();
}

function scheduleClassificationPoll() {
  clearTimeout(state.classificationPoll);
  if (!state.articles.some((article) => article.labelStatus === "pending")) return;
  state.classificationPoll = setTimeout(() => void loadArticles(), 1_800);
}

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  const openDialogs = [...document.querySelectorAll("dialog[open]")];
  const activeDialog = openDialogs.at(-1);
  let region = elements.toastRegion;
  if (activeDialog) {
    const host = activeDialog.querySelector(".dialog-card, .confirm-card") || activeDialog;
    region = host.querySelector(".dialog-toast-region");
    if (!region) {
      region = document.createElement("div");
      region.className = "dialog-toast-region";
      region.setAttribute("aria-live", "polite");
      region.setAttribute("aria-atomic", "true");
      host.append(region);
    }
  }
  region.append(toast);
  setTimeout(() => {
    toast.remove();
    if (region.classList.contains("dialog-toast-region") && !region.children.length) region.remove();
  }, 3_800);
}

function setButtonLoading(button, loading, loadingText = "") {
  button.disabled = loading;
  const label = button.querySelector(".button-label");
  const loader = button.querySelector(".button-loader");
  if (label) {
    if (!button.dataset.label) button.dataset.label = label.textContent;
    label.textContent = loading ? loadingText : button.dataset.label;
  } else {
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.textContent = loading ? loadingText : button.dataset.label;
  }
  if (loader) loader.hidden = !loading;
}

function renderLabelFilter() {
  const selected = state.labelId ? String(state.labelId) : "";
  const groups = new Map();
  for (const label of state.labels) {
    if (!groups.has(label.group)) groups.set(label.group, []);
    groups.get(label.group).push(label);
  }
  elements.labelFilter.innerHTML = `<option value="">全部标签</option>${[...groups.entries()].map(([group, labels]) => `
    <optgroup label="${escapeHtml(group)}">${labels.map((label) => `<option value="${label.id}">${escapeHtml(label.name)} (${label.articleCount})</option>`).join("")}</optgroup>
  `).join("")}`;
  elements.labelFilter.value = selected;
}

async function loadLabels() {
  const payload = await apiRequest("/api/labels?includeDisabled=true");
  state.allLabels = payload.labels;
  state.labels = payload.labels.filter((label) => label.enabled);
  if (state.labelId && !state.labels.some((label) => label.id === state.labelId)) state.labelId = null;
  renderLabelFilter();
  renderManagedLabels();
}

async function loadArticles() {
  const wasPollingClassification = state.articles.some((article) => article.labelStatus === "pending");
  const params = new URLSearchParams({ status: state.status });
  if (state.search) params.set("search", state.search);
  if (state.labelId) params.set("label", state.labelId);
  try {
    const payload = await apiRequest(`/api/articles?${params}`);
    state.articles = payload.articles;
    state.counts = payload.counts;
    render();
    if (wasPollingClassification && !state.articles.some((article) => article.labelStatus === "pending")) {
      void loadLabels();
    }
  } catch (error) {
    elements.body.innerHTML = `<tr class="loading-row"><td colspan="4">无法读取本地数据</td></tr>`;
    showToast(error.message, "error");
  }
}

function resetImportDialog() {
  state.importItems = [];
  elements.linkInput.value = "";
  elements.linkCount.textContent = "0 个链接";
  elements.previewButton.disabled = true;
  elements.previewList.innerHTML = "";
  elements.pasteStep.hidden = false;
  elements.previewStep.hidden = true;
}

function openImportDialog() {
  resetImportDialog();
  elements.importDialog.showModal();
  requestAnimationFrame(() => elements.linkInput.focus());
}

function closeImportDialog() {
  elements.importDialog.close();
}

function approximateLinkCount(value) {
  return (value.match(/https?:\/\/[^\s<>"']+/giu) || []).length;
}

function labelPickerMarkup(selectedLabelIds = [], inputAttributes = "") {
  const selected = new Set(selectedLabelIds.map(Number));
  const groups = new Map();
  for (const label of state.labels) {
    if (!groups.has(label.group)) groups.set(label.group, []);
    groups.get(label.group).push(label);
  }
  return [...groups.entries()].map(([group, labels]) => `
    <div class="label-picker-group"><strong>${escapeHtml(group)}</strong><div>${labels.map((label) => `
      <label class="label-choice" style="--label-color:${escapeHtml(label.color)}">
        <input type="checkbox" value="${label.id}" ${inputAttributes} ${selected.has(label.id) ? "checked" : ""} />
        <span>${escapeHtml(label.name)}</span>
      </label>`).join("")}</div></div>`).join("");
}

function renderImportPreview() {
  document.querySelector("#preview-count").textContent = state.importItems.length;
  elements.confirmButton.disabled = state.importItems.length === 0;
  elements.previewList.innerHTML = state.importItems.map((item, index) => `
    <article class="preview-item" data-preview-index="${index}">
      <div class="preview-item-row">
        <span class="preview-index">${index + 1}</span>
        <input class="preview-title${item.fetched ? "" : " manual-required"}" data-action="preview-title" value="${escapeHtml(item.title)}" placeholder="${item.fetched ? "文章标题" : "请手动填写文章标题"}" aria-label="第 ${index + 1} 篇文章的标题" maxlength="500" />
        <button class="remove-preview" type="button" data-action="remove-preview" aria-label="移除第 ${index + 1} 篇文章">
          <svg viewBox="0 0 18 18"><path d="m5 5 8 8M13 5l-8 8"/></svg>
        </button>
      </div>
      <div class="preview-meta">
        <span class="preview-domain" title="${escapeHtml(item.url)}">${escapeHtml(item.domain)}</span><span>·</span>
        <span class="${item.fetched ? "fetch-success" : "fetch-warning"}">${item.fetched ? "标题已获取" : item.errorType === "timeout" ? "抓取超时" : "抓取失败"}</span>
      </div>
      ${item.fetched ? "" : `<div class="preview-error" role="status">
        <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 2.5 16 15H2L9 2.5Z"/><path d="M9 7v3.5M9 13h.01"/></svg>
        <span>${escapeHtml(item.error || "标题提取失败，请手动填写标题")}</span>
      </div>`}
      <fieldset class="label-picker-field preview-label-field">
        <legend>文章标签 <span>可选，最多选择 5 个</span></legend>
        <div class="label-picker preview-label-picker">${labelPickerMarkup(item.labelIds, 'data-action="preview-label"')}</div>
      </fieldset>
    </article>`).join("");
}

async function previewLinks() {
  const text = elements.linkInput.value.trim();
  if (!text) return;
  setButtonLoading(elements.previewButton, true, "正在抓取标题...");
  try {
    const payload = await apiRequest("/api/links/preview", { method: "POST", body: JSON.stringify({ text }) });
    state.importItems = payload.items.map((item) => ({
      ...item,
      title: item.fetched ? item.title : "",
      labelIds: [],
    }));
    renderImportPreview();
    elements.pasteStep.hidden = true;
    elements.previewStep.hidden = false;
    const manualTitle = elements.previewList.querySelector(".preview-title.manual-required");
    if (manualTitle) requestAnimationFrame(() => manualTitle.focus());
    if (payload.truncated) showToast("单次最多处理 50 个链接，已保留前 50 个", "error");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setButtonLoading(elements.previewButton, false);
    elements.previewButton.disabled = !elements.linkInput.value.trim();
  }
}

async function confirmImport() {
  const items = state.importItems.map(({ title, url, description, labelIds }) => ({
    title: title.trim(),
    url,
    description,
    labelIds,
  }));
  if (items.some((item) => !item.title)) {
    showToast("请补全所有文章标题", "error");
    const missingIndex = items.findIndex((item) => !item.title);
    elements.previewList.querySelector(`[data-preview-index="${missingIndex}"] .preview-title`)?.focus();
    return;
  }
  setButtonLoading(elements.confirmButton, true, "正在保存...");
  try {
    const payload = await apiRequest("/api/articles/import", { method: "POST", body: JSON.stringify({ items }) });
    closeImportDialog();
    await Promise.all([loadLabels(), loadArticles()]);
    const duplicateText = payload.duplicates ? `，跳过 ${payload.duplicates} 条重复链接` : "";
    const classifyText = payload.classificationQueued ? `，${payload.classificationQueued} 篇正在自动分类` : "";
    showToast(`已加入 ${payload.inserted.length} 篇文章${duplicateText}${classifyText}`);
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setButtonLoading(elements.confirmButton, false);
  }
}

function renderEditLabels(article) {
  elements.editLabels.innerHTML = labelPickerMarkup(article.labels.map((label) => label.id));
}

function openEditDialog(article) {
  state.editingId = article.id;
  elements.editTitle.value = article.title;
  elements.editUrl.value = article.url;
  elements.editStatus.value = article.status;
  renderEditLabels(article);
  elements.editDialog.showModal();
  requestAnimationFrame(() => elements.editTitle.focus());
}

function closeEditDialog() {
  elements.editDialog.close();
  state.editingId = null;
}

async function classifyArticle(article) {
  try {
    await apiRequest(`/api/articles/${article.id}/classify`, { method: "POST" });
    article.labelStatus = "pending";
    article.labelError = null;
    render();
    showToast("已开始自动分类");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function loadLlmSettings() {
  const payload = await apiRequest("/api/settings/llm");
  const { settings, apiKey, subscriptionKey } = payload;
  elements.llmBaseUrl.value = settings.baseUrl;
  elements.llmModel.value = settings.model;
  elements.llmApiKey.value = "";
  elements.llmSubscriptionHeader.value = settings.subscriptionHeaderName || "";
  elements.llmSubscriptionKey.value = "";
  elements.llmUserHeader.value = settings.userHeaderName || "";
  elements.llmUserValue.value = settings.userHeaderValue || "";
  elements.llmUserValue.dataset.systemUsername = payload.systemUsername || "";
  elements.llmUserValue.placeholder = payload.systemUsername
    ? `当前系统用户：${payload.systemUsername}`
    : "例如 Windows 用户名";
  elements.llmTimeout.value = String(settings.timeoutMs);
  elements.llmMaxLabels.value = String(settings.maxLabels);
  elements.llmAutoLabel.checked = settings.autoLabel;
  updateSecretState(apiKey, subscriptionKey);
  elements.secretHint.textContent = apiKey.persistent
    ? "Bearer Key 和订阅密钥均使用操作系统加密后保存在本机，不会出现在导出备份或 Git 仓库中。"
    : "当前是浏览器运行模式：密钥只保存在本次服务进程；也可使用 LEARNING_TRACKER_API_KEY 和 LEARNING_TRACKER_SUBSCRIPTION_KEY 环境变量。";
}

function updateSecretState(apiKey, subscriptionKey) {
  const configured = [apiKey?.configured, subscriptionKey?.configured].filter(Boolean).length;
  elements.apiKeyState.textContent = configured === 2
    ? "2 个密钥已配置"
    : configured === 1
      ? apiKey?.configured ? "Bearer Key 已配置" : "订阅 Key 已配置"
      : "密钥未配置";
  elements.apiKeyState.classList.toggle("configured", configured > 0);
}

function llmSettingsPayload(extra = {}) {
  return {
    baseUrl: elements.llmBaseUrl.value.trim(),
    model: elements.llmModel.value.trim(),
    timeoutMs: Number(elements.llmTimeout.value),
    maxLabels: Number(elements.llmMaxLabels.value),
    autoLabel: elements.llmAutoLabel.checked,
    subscriptionHeaderName: elements.llmSubscriptionHeader.value.trim(),
    userHeaderName: elements.llmUserHeader.value.trim(),
    userHeaderValue: elements.llmUserValue.value.trim(),
    ...(elements.llmApiKey.value.trim() ? { apiKey: elements.llmApiKey.value.trim() } : {}),
    ...(elements.llmSubscriptionKey.value.trim()
      ? { subscriptionKey: elements.llmSubscriptionKey.value.trim() }
      : {}),
    ...extra,
  };
}

async function saveLlmSettings(extra = {}) {
  const payload = await apiRequest("/api/settings/llm", {
    method: "PATCH",
    body: JSON.stringify(llmSettingsPayload(extra)),
  });
  elements.llmApiKey.value = "";
  elements.llmSubscriptionKey.value = "";
  updateSecretState(payload.apiKey, payload.subscriptionKey);
  return payload;
}

function showConnectionResult(message, type = "success") {
  elements.connectionResult.hidden = false;
  elements.connectionResult.className = `connection-result ${type}`;
  elements.connectionResult.textContent = message;
}

function syncNetworkFields() {
  const enabled = elements.networkUseProxy.checked;
  elements.networkHttpProxy.disabled = !enabled;
  elements.networkSocksProxy.disabled = !enabled;
  elements.networkFallbackDirect.disabled = !enabled;
  elements.networkModeState.textContent = enabled ? "代理模式" : "直连模式";
  elements.networkModeState.classList.toggle("configured", enabled);
}

async function loadNetworkSettings() {
  const payload = await apiRequest("/api/settings/network");
  const { settings, capabilities } = payload;
  elements.networkUseProxy.checked = settings.useProxy;
  elements.networkHttpProxy.value = settings.httpProxy || "";
  elements.networkSocksProxy.value = settings.socksProxy || "";
  elements.networkFallbackDirect.checked = settings.fallbackToDirect;
  elements.networkCapabilityHint.textContent = capabilities.socks5
    ? "桌面版支持 HTTP 与 SOCKS5 代理。代理地址只保存在本机数据库中。"
    : "当前网页运行模式支持直连和 HTTP 代理；SOCKS5 代理请使用桌面版。";
  syncNetworkFields();
}

function networkSettingsPayload() {
  return {
    useProxy: elements.networkUseProxy.checked,
    httpProxy: elements.networkHttpProxy.value.trim(),
    socksProxy: elements.networkSocksProxy.value.trim(),
    fallbackToDirect: elements.networkFallbackDirect.checked,
  };
}

async function saveNetworkSettings() {
  const payload = await apiRequest("/api/settings/network", {
    method: "PATCH",
    body: JSON.stringify(networkSettingsPayload()),
  });
  elements.networkUseProxy.checked = payload.settings.useProxy;
  elements.networkHttpProxy.value = payload.settings.httpProxy || "";
  elements.networkSocksProxy.value = payload.settings.socksProxy || "";
  elements.networkFallbackDirect.checked = payload.settings.fallbackToDirect;
  syncNetworkFields();
  return payload;
}

function showNetworkTestResult(message, type = "success") {
  elements.networkTestResult.hidden = false;
  elements.networkTestResult.className = `connection-result ${type}`;
  elements.networkTestResult.textContent = message;
}

function renderManagedLabels() {
  if (!elements.managedLabels || !state.allLabels.length) return;
  elements.managedLabels.innerHTML = state.allLabels.map((label) => `
    <article class="managed-label ${label.enabled ? "" : "disabled"}" data-label-id="${label.id}">
      <span class="managed-label-dot" style="--label-color:${escapeHtml(label.color)}"></span>
      <div class="managed-label-copy">
        <div><strong>${escapeHtml(label.name)}</strong><span>${escapeHtml(label.group)}</span>${label.enabled ? "" : "<em>已停用</em>"}</div>
        <p>${escapeHtml(label.description || "暂无分类说明")}</p>
      </div>
      <span class="managed-label-count">${label.articleCount} 篇</span>
      <div class="managed-label-actions">
        <button type="button" data-label-action="edit">编辑</button>
        <button type="button" data-label-action="toggle">${label.enabled ? "停用" : "启用"}</button>
      </div>
    </article>`).join("");
}

function resetLabelForm() {
  document.querySelector("#label-edit-id").value = "";
  document.querySelector("#label-name").value = "";
  document.querySelector("#label-group").value = "自定义";
  document.querySelector("#label-description").value = "";
  document.querySelector("#label-aliases").value = "";
  document.querySelector("#label-color").value = "#5b5bd6";
  document.querySelector("#label-save").textContent = "新增标签";
  document.querySelector("#label-edit-cancel").hidden = true;
}

function editManagedLabel(label) {
  document.querySelector("#label-edit-id").value = String(label.id);
  document.querySelector("#label-name").value = label.name;
  document.querySelector("#label-group").value = label.group;
  document.querySelector("#label-description").value = label.description;
  document.querySelector("#label-aliases").value = label.aliases.join(", ");
  document.querySelector("#label-color").value = label.color;
  document.querySelector("#label-save").textContent = "保存标签";
  document.querySelector("#label-edit-cancel").hidden = false;
  document.querySelector("#label-name").focus();
}

async function openSettings() {
  try {
    await Promise.all([loadLlmSettings(), loadNetworkSettings(), loadLabels()]);
    elements.connectionResult.hidden = true;
    elements.networkTestResult.hidden = true;
    resetLabelForm();
    applyTheme(readLocalPreference(THEME_STORAGE_KEY, "warm"), false);
    activateSettingsTab(readLocalPreference(SETTINGS_TAB_STORAGE_KEY, "model"), { persist: false });
    elements.settingsDialog.showModal();
  } catch (error) {
    showToast(error.message, "error");
  }
}

let searchTimer;
document.querySelector("#search-input").addEventListener("input", (event) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = event.target.value.trim();
    void loadArticles();
  }, 240);
});

document.querySelector(".filters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-status]");
  if (!button || button.dataset.status === state.status) return;
  state.status = button.dataset.status;
  document.querySelectorAll("[data-status]").forEach((item) => item.classList.toggle("active", item === button));
  void loadArticles();
});

elements.labelFilter.addEventListener("change", () => {
  state.labelId = elements.labelFilter.value ? Number(elements.labelFilter.value) : null;
  void loadArticles();
});

elements.body.addEventListener("change", async (event) => {
  const select = event.target.closest('[data-action="status"]');
  if (!select) return;
  const row = select.closest("[data-article-id]");
  const article = state.articles.find((item) => item.id === Number(row.dataset.articleId));
  const previousStatus = article.status;
  select.disabled = true;
  try {
    await apiRequest(`/api/articles/${article.id}`, { method: "PATCH", body: JSON.stringify({ status: select.value }) });
    await loadArticles();
    showToast("阅读状态已更新");
  } catch (error) {
    select.value = previousStatus;
    select.disabled = false;
    showToast(error.message, "error");
  }
});

elements.body.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const row = button.closest("[data-article-id]");
  const article = state.articles.find((item) => item.id === Number(row.dataset.articleId));
  if (button.dataset.action === "edit") return openEditDialog(article);
  if (button.dataset.action === "classify") return void classifyArticle(article);
  if (button.dataset.action !== "delete") return;
  state.pendingDeleteId = article.id;
  document.querySelector("#delete-copy").textContent = `《${article.title}》将从本地清单中移除，原文章网页不会受到影响。`;
  document.querySelector("#delete-dialog").showModal();
});

document.querySelector("#edit-close").addEventListener("click", closeEditDialog);
document.querySelector("#edit-cancel").addEventListener("click", closeEditDialog);

elements.editLabels.addEventListener("change", (event) => {
  const selected = [...elements.editLabels.querySelectorAll('input[type="checkbox"]:checked')];
  if (selected.length <= 5) return;
  event.target.checked = false;
  showToast("每篇文章最多选择 5 个标签", "error");
});

elements.editForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.editingId) return;
  const title = elements.editTitle.value.trim();
  const url = elements.editUrl.value.trim();
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error();
  } catch {
    showToast("请输入有效的 HTTP 或 HTTPS 链接", "error");
    elements.editUrl.focus();
    return;
  }
  if (!title) {
    showToast("文章标题不能为空", "error");
    elements.editTitle.focus();
    return;
  }
  const labelIds = [...elements.editLabels.querySelectorAll('input[type="checkbox"]:checked')].map((input) => Number(input.value));
  setButtonLoading(elements.editSave, true, "正在保存...");
  try {
    await apiRequest(`/api/articles/${state.editingId}`, {
      method: "PATCH",
      body: JSON.stringify({ title, url: parsedUrl.href, status: elements.editStatus.value, labelIds }),
    });
    closeEditDialog();
    await Promise.all([loadLabels(), loadArticles()]);
    showToast("文章信息和标签已更新");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setButtonLoading(elements.editSave, false);
  }
});

document.querySelector("#delete-cancel").addEventListener("click", () => {
  document.querySelector("#delete-dialog").close();
  state.pendingDeleteId = null;
});

document.querySelector("#delete-confirm").addEventListener("click", async (event) => {
  if (!state.pendingDeleteId) return;
  const button = event.currentTarget;
  setButtonLoading(button, true, "正在删除...");
  try {
    await apiRequest(`/api/articles/${state.pendingDeleteId}`, { method: "DELETE" });
    document.querySelector("#delete-dialog").close();
    state.pendingDeleteId = null;
    await Promise.all([loadLabels(), loadArticles()]);
    showToast("文章已删除");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setButtonLoading(button, false);
  }
});

document.querySelector("#import-open").addEventListener("click", openImportDialog);
document.querySelector("#empty-import").addEventListener("click", openImportDialog);
document.querySelector("#import-close").addEventListener("click", closeImportDialog);
document.querySelector("#paste-cancel").addEventListener("click", closeImportDialog);
document.querySelector("#preview-links").addEventListener("click", previewLinks);
document.querySelector("#confirm-import").addEventListener("click", confirmImport);
document.querySelector("#preview-back").addEventListener("click", () => {
  elements.previewStep.hidden = true;
  elements.pasteStep.hidden = false;
  elements.linkInput.focus();
});

elements.linkInput.addEventListener("input", () => {
  const count = approximateLinkCount(elements.linkInput.value);
  elements.linkCount.textContent = `${count} 个链接`;
  elements.previewButton.disabled = count === 0;
});

elements.previewList.addEventListener("input", (event) => {
  const input = event.target.closest('[data-action="preview-title"]');
  if (!input) return;
  const item = input.closest("[data-preview-index]");
  const importItem = state.importItems[Number(item.dataset.previewIndex)];
  importItem.title = input.value;
  input.classList.toggle("manual-required", !importItem.fetched && !input.value.trim());
});

elements.previewList.addEventListener("change", (event) => {
  const input = event.target.closest('[data-action="preview-label"]');
  if (!input) return;
  const item = input.closest("[data-preview-index]");
  const selected = [...item.querySelectorAll('[data-action="preview-label"]:checked')];
  if (selected.length > 5) {
    input.checked = false;
    showToast("每篇文章最多选择 5 个标签", "error");
  }
  state.importItems[Number(item.dataset.previewIndex)].labelIds = [
    ...item.querySelectorAll('[data-action="preview-label"]:checked'),
  ].map((checkbox) => Number(checkbox.value));
});

elements.previewList.addEventListener("click", (event) => {
  const button = event.target.closest('[data-action="remove-preview"]');
  if (!button) return;
  const item = button.closest("[data-preview-index]");
  state.importItems.splice(Number(item.dataset.previewIndex), 1);
  renderImportPreview();
});

document.querySelector("#settings-open").addEventListener("click", () => void openSettings());
document.querySelector("#settings-close").addEventListener("click", () => elements.settingsDialog.close());

elements.settingsTabs.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-settings-tab]");
  if (tab) activateSettingsTab(tab.dataset.settingsTab);
});

elements.settingsTabs.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [...elements.settingsTabs.querySelectorAll("[data-settings-tab]")];
  const currentIndex = tabs.indexOf(document.activeElement);
  if (currentIndex < 0) return;
  event.preventDefault();
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? tabs.length - 1
      : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  activateSettingsTab(tabs[nextIndex].dataset.settingsTab, { focus: true });
});

elements.themePicker.addEventListener("change", (event) => {
  const input = event.target.closest('input[name="app-theme"]');
  if (!input) return;
  applyTheme(input.value);
  showToast(`已切换为${input.closest(".theme-option").querySelector("strong").textContent}`);
});

elements.networkUseProxy.addEventListener("change", syncNetworkFields);

elements.networkForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#save-network");
  setButtonLoading(button, true, "正在保存...");
  try {
    await saveNetworkSettings();
    showToast(elements.networkUseProxy.checked ? "代理设置已保存并立即生效" : "已切换为网页直连模式");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setButtonLoading(button, false);
  }
});

document.querySelector("#test-network").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  setButtonLoading(button, true, "正在测试...");
  elements.networkTestResult.hidden = true;
  try {
    await saveNetworkSettings();
    const payload = await apiRequest("/api/settings/network/test", {
      method: "POST",
      body: JSON.stringify({ url: elements.networkTestUrl.value.trim() }),
    });
    if (payload.ok) {
      const title = payload.result.title ? ` · ${payload.result.title}` : "";
      showNetworkTestResult(`连接成功${title}`);
    } else {
      showNetworkTestResult(payload.result.error || "网页抓取测试失败", "error");
    }
  } catch (error) {
    showNetworkTestResult(error.message, "error");
  } finally {
    setButtonLoading(button, false);
  }
});

elements.llmForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#save-llm");
  setButtonLoading(button, true, "正在保存...");
  try {
    await saveLlmSettings();
    showToast("模型设置已保存");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setButtonLoading(button, false);
  }
});

document.querySelector("#test-llm").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  setButtonLoading(button, true, "正在测试...");
  elements.connectionResult.hidden = true;
  try {
    await saveLlmSettings();
    const result = await apiRequest("/api/settings/llm/test", { method: "POST" });
    showConnectionResult(`连接成功 · ${result.latencyMs} ms · 示例标签：${result.labels.join("、")}`);
  } catch (error) {
    showConnectionResult(error.message, "error");
  } finally {
    setButtonLoading(button, false);
  }
});

document.querySelector("#use-system-user").addEventListener("click", () => {
  const username = elements.llmUserValue.dataset.systemUsername || "";
  if (!username) {
    showToast("没有读取到当前系统用户名", "error");
    return;
  }
  elements.llmUserValue.value = username;
});

document.querySelector("#clear-secrets").addEventListener("click", async () => {
  if (!window.confirm("确定清除本机保存的 Bearer Key 和订阅密钥？")) return;
  try {
    await saveLlmSettings({ clearApiKey: true, clearSubscriptionKey: true });
    showToast("模型密钥已清除");
  } catch (error) {
    showToast(error.message, "error");
  }
});

document.querySelector("#classify-unread").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  setButtonLoading(button, true, "正在创建任务...");
  try {
    const result = await apiRequest("/api/classification/unread", { method: "POST" });
    await loadArticles();
    showToast(result.queued ? `已开始分类 ${result.queued} 篇未读文章` : "没有需要分类的未读文章");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setButtonLoading(button, false);
  }
});

elements.labelForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = Number(document.querySelector("#label-edit-id").value) || null;
  const input = {
    name: document.querySelector("#label-name").value.trim(),
    group: document.querySelector("#label-group").value.trim(),
    description: document.querySelector("#label-description").value.trim(),
    aliases: document.querySelector("#label-aliases").value.split(/[,，]/u).map((value) => value.trim()).filter(Boolean),
    color: document.querySelector("#label-color").value,
  };
  try {
    await apiRequest(id ? `/api/labels/${id}` : "/api/labels", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(input),
    });
    resetLabelForm();
    await Promise.all([loadLabels(), loadArticles()]);
    showToast(id ? "标签已更新" : "标签已创建");
  } catch (error) {
    showToast(error.message, "error");
  }
});

document.querySelector("#label-edit-cancel").addEventListener("click", resetLabelForm);

elements.managedLabels.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-label-action]");
  if (!button) return;
  const row = button.closest("[data-label-id]");
  const label = state.allLabels.find((item) => item.id === Number(row.dataset.labelId));
  if (button.dataset.labelAction === "edit") return editManagedLabel(label);
  if (label.enabled && !window.confirm(`停用标签“${label.name}”？历史文章上的标签会保留。`)) return;
  try {
    await apiRequest(`/api/labels/${label.id}`, {
      method: label.enabled ? "DELETE" : "PATCH",
      ...(label.enabled ? {} : { body: JSON.stringify({ enabled: true }) }),
    });
    await Promise.all([loadLabels(), loadArticles()]);
    showToast(label.enabled ? "标签已停用" : "标签已启用");
  } catch (error) {
    showToast(error.message, "error");
  }
});

Promise.all([loadLabels(), loadArticles()]).catch((error) => showToast(error.message, "error"));
