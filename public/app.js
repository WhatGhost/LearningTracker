const statusDetails = {
  unread: { label: "未阅读", className: "chip-unread" },
  reading: { label: "阅读中", className: "chip-reading" },
  completed: { label: "已完成", className: "chip-completed" },
};

const state = {
  articles: [],
  counts: { all: 0, unread: 0, reading: 0, completed: 0 },
  search: "",
  status: "all",
  importItems: [],
  pendingDeleteId: null,
  editingId: null,
};

const elements = {
  body: document.querySelector("#article-body"),
  empty: document.querySelector("#empty-state"),
  table: document.querySelector(".table-wrap"),
  toastRegion: document.querySelector("#toast-region"),
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
  editSave: document.querySelector("#edit-save"),
};

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
  return String(value)
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

function articleRow(article) {
  const status = statusDetails[article.status] || statusDetails.unread;
  return `
    <tr data-article-id="${article.id}">
      <td>
        <a class="article-title" href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(article.title)}">${escapeHtml(article.title)}</a>
        <span class="article-domain">${escapeHtml(article.domain)}</span>
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
    const filtered = state.status !== "all" || state.search;
    document.querySelector("#empty-title").textContent = filtered ? "没有找到符合条件的文章" : "阅读清单还是空的";
    document.querySelector("#empty-copy").textContent = filtered
      ? "试试更换筛选条件或搜索关键词。"
      : "粘贴一些最近想读的文章，从这里开始积累。";
    document.querySelector("#empty-import").hidden = filtered;
  }
  elements.body.innerHTML = state.articles.map(articleRow).join("");
}

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  elements.toastRegion.append(toast);
  setTimeout(() => toast.remove(), 3200);
}

function setButtonLoading(button, loading, loadingText) {
  button.disabled = loading;
  const label = button.querySelector(".button-label");
  const loader = button.querySelector(".button-loader");
  if (!button.dataset.label) button.dataset.label = label.textContent;
  label.textContent = loading ? loadingText : button.dataset.label;
  loader.hidden = !loading;
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

function renderImportPreview() {
  document.querySelector("#preview-count").textContent = state.importItems.length;
  elements.confirmButton.disabled = state.importItems.length === 0;
  elements.previewList.innerHTML = state.importItems
    .map(
      (item, index) => `
        <article class="preview-item" data-preview-index="${index}">
          <div class="preview-item-row">
            <span class="preview-index">${index + 1}</span>
            <input class="preview-title" data-action="preview-title" value="${escapeHtml(item.title)}" aria-label="第 ${index + 1} 篇文章的标题" maxlength="500" />
            <button class="remove-preview" type="button" data-action="remove-preview" aria-label="移除第 ${index + 1} 篇文章">
              <svg viewBox="0 0 18 18"><path d="m5 5 8 8M13 5l-8 8"/></svg>
            </button>
          </div>
          <div class="preview-meta">
            <span class="preview-domain" title="${escapeHtml(item.url)}">${escapeHtml(item.domain)}</span>
            <span>·</span>
            <span class="${item.fetched ? "fetch-success" : "fetch-warning"}">${item.fetched ? "标题已获取" : item.errorType === "timeout" ? "抓取超时" : "抓取失败"}</span>
          </div>
          ${item.fetched ? "" : `
            <div class="preview-error" role="status">
              <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 2.5 16 15H2L9 2.5Z"/><path d="M9 7v3.5M9 13h.01"/></svg>
              <span>${escapeHtml(item.error || "标题提取失败，请手动填写标题")}</span>
            </div>`}
        </article>`,
    )
    .join("");
}

async function previewLinks() {
  const text = elements.linkInput.value.trim();
  if (!text) return;
  setButtonLoading(elements.previewButton, true, "正在抓取标题...");
  try {
    const payload = await apiRequest("/api/links/preview", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    state.importItems = payload.items;
    renderImportPreview();
    elements.pasteStep.hidden = true;
    elements.previewStep.hidden = false;
    if (payload.truncated) showToast("单次最多处理 50 个链接，已保留前 50 个", "error");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setButtonLoading(elements.previewButton, false, "");
    elements.previewButton.disabled = !elements.linkInput.value.trim();
  }
}

async function confirmImport() {
  const items = state.importItems.map(({ title, url }) => ({ title: title.trim(), url }));
  if (items.some((item) => !item.title)) {
    showToast("请补全所有文章标题", "error");
    return;
  }
  setButtonLoading(elements.confirmButton, true, "正在保存...");
  try {
    const payload = await apiRequest("/api/articles/import", {
      method: "POST",
      body: JSON.stringify({ items }),
    });
    closeImportDialog();
    await loadArticles();
    const added = payload.inserted.length;
    const duplicateText = payload.duplicates ? `，跳过 ${payload.duplicates} 条重复链接` : "";
    showToast(`已加入 ${added} 篇文章${duplicateText}`);
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setButtonLoading(elements.confirmButton, false, "");
  }
}

async function loadArticles() {
  const params = new URLSearchParams({ status: state.status });
  if (state.search) params.set("search", state.search);
  try {
    const payload = await apiRequest(`/api/articles?${params}`);
    state.articles = payload.articles;
    state.counts = payload.counts;
    render();
  } catch (error) {
    elements.body.innerHTML = `<tr class="loading-row"><td colspan="4">无法读取本地数据</td></tr>`;
    showToast(error.message, "error");
  }
}

let searchTimer;
document.querySelector("#search-input").addEventListener("input", (event) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = event.target.value.trim();
    loadArticles();
  }, 240);
});

document.querySelector(".filters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-status]");
  if (!button || button.dataset.status === state.status) return;
  state.status = button.dataset.status;
  document.querySelectorAll("[data-status]").forEach((item) => item.classList.toggle("active", item === button));
  loadArticles();
});

elements.body.addEventListener("change", async (event) => {
  const select = event.target.closest('[data-action="status"]');
  if (!select) return;
  const row = select.closest("[data-article-id]");
  const article = state.articles.find((item) => item.id === Number(row.dataset.articleId));
  const previousStatus = article.status;
  select.disabled = true;
  try {
    await apiRequest(`/api/articles/${article.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: select.value }),
    });
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
  if (button.dataset.action === "edit") {
    state.editingId = article.id;
    elements.editTitle.value = article.title;
    elements.editUrl.value = article.url;
    elements.editStatus.value = article.status;
    elements.editDialog.showModal();
    requestAnimationFrame(() => elements.editTitle.focus());
    return;
  }
  if (button.dataset.action !== "delete") return;
  state.pendingDeleteId = article.id;
  document.querySelector("#delete-copy").textContent = `《${article.title}》将从本地清单中移除，原文章网页不会受到影响。`;
  document.querySelector("#delete-dialog").showModal();
});

function closeEditDialog() {
  elements.editDialog.close();
  state.editingId = null;
}

document.querySelector("#edit-close").addEventListener("click", closeEditDialog);
document.querySelector("#edit-cancel").addEventListener("click", closeEditDialog);

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

  setButtonLoading(elements.editSave, true, "正在保存...");
  try {
    await apiRequest(`/api/articles/${state.editingId}`, {
      method: "PATCH",
      body: JSON.stringify({ title, url: parsedUrl.href, status: elements.editStatus.value }),
    });
    closeEditDialog();
    await loadArticles();
    showToast("文章信息已更新");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setButtonLoading(elements.editSave, false, "");
  }
});

document.querySelector("#delete-cancel").addEventListener("click", () => {
  document.querySelector("#delete-dialog").close();
  state.pendingDeleteId = null;
});

document.querySelector("#delete-confirm").addEventListener("click", async (event) => {
  if (!state.pendingDeleteId) return;
  const button = event.currentTarget;
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = "正在删除...";
  try {
    await apiRequest(`/api/articles/${state.pendingDeleteId}`, { method: "DELETE" });
    document.querySelector("#delete-dialog").close();
    state.pendingDeleteId = null;
    await loadArticles();
    showToast("文章已删除");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
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
  state.importItems[Number(item.dataset.previewIndex)].title = input.value;
});

elements.previewList.addEventListener("click", (event) => {
  const button = event.target.closest('[data-action="remove-preview"]');
  if (!button) return;
  const item = button.closest("[data-preview-index]");
  state.importItems.splice(Number(item.dataset.previewIndex), 1);
  renderImportPreview();
});

loadArticles();
