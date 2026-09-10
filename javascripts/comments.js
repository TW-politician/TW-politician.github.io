/**
 * 留言前端元件。
 *
 * 後端是 comments/src/worker.js（Cloudflare Worker + D1）。
 * 只在有 #pltc-comments 容器的頁面啟動——容器由 overrides/main.html 依
 * hooks/post_links.py 設的 page.meta.comments_page 決定，所以只有文章頁與
 * 議題明細頁會有。
 *
 * 安全性：所有留言內容一律用 textContent 寫入，絕不用 innerHTML，
 * 避免讀者送出的內容變成可執行的 HTML。
 */
(function () {
  "use strict";

  // 設定放在載入本檔的 <script> 標籤上（見 overrides/main.html）。
  // 該標籤只會出現在文章頁與議題明細頁，所以其他頁面直接結束。
  const tag = document.querySelector("script[data-pltc-comments]");
  if (!tag) return;

  const api = (tag.dataset.api || "").replace(/\/$/, "");
  if (!api) return; // 未設定 extra.comments.api（例如本機預覽）就不啟動

  const turnstileKey = tag.dataset.turnstile || "";

  // 容器由腳本插入內容區末端。不在樣板產生，是因為 Material 的 blog plugin
  // 覆寫了 content block，文章頁吃不到；也避免留言區被文章摘要帶進列表頁。
  const host =
    document.querySelector(".md-content__inner") ||
    document.querySelector("article") ||
    document.body;
  const root = document.createElement("div");
  root.id = "pltc-comments";
  host.appendChild(root);
  const page = location.pathname;
  const pageTitle = document.title;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  function formatDate(value) {
    // 後端存的是 UTC 的 'YYYY-MM-DD HH:MM:SS'
    const d = new Date(String(value).replace(" ", "T") + "Z");
    return isNaN(d) ? value : d.toLocaleString("zh-TW", { hour12: false });
  }

  // ------------------------------------------------------------ 顯示留言

  function renderComment(c, replyTargets) {
    const item = el("li", "cm-item" + (c.is_admin ? " cm-item--admin" : ""));

    const head = el("div", "cm-head");
    head.appendChild(el("span", "cm-author", c.author + (c.is_admin ? "（站長）" : "")));
    head.appendChild(el("time", "cm-time", formatDate(c.created_at)));
    item.appendChild(head);

    item.appendChild(el("div", "cm-body", c.body));

    if (!c.is_admin) {
      const replyBtn = el("button", "cm-reply-btn", "回覆");
      replyBtn.type = "button";
      replyBtn.addEventListener("click", () => {
        form.dataset.parentId = String(c.id);
        replyHint.textContent = `正在回覆 ${c.author}`;
        replyHint.hidden = false;
        form.querySelector(".cm-body-input").focus();
      });
      item.appendChild(replyBtn);
    }

    const children = replyTargets.get(c.id) || [];
    if (children.length) {
      const sub = el("ul", "cm-list cm-list--nested");
      children.forEach((child) => sub.appendChild(renderComment(child, replyTargets)));
      item.appendChild(sub);
    }
    return item;
  }

  function renderAll(comments) {
    listBox.textContent = "";
    if (!comments.length) {
      listBox.appendChild(el("p", "cm-empty", "還沒有留言。"));
      return;
    }
    const byParent = new Map();
    comments.forEach((c) => {
      if (c.parent_id) {
        if (!byParent.has(c.parent_id)) byParent.set(c.parent_id, []);
        byParent.get(c.parent_id).push(c);
      }
    });
    const list = el("ul", "cm-list");
    comments
      .filter((c) => !c.parent_id)
      .forEach((c) => list.appendChild(renderComment(c, byParent)));
    listBox.appendChild(list);
  }

  async function load() {
    try {
      const res = await fetch(`${api}/api/comments?page=${encodeURIComponent(page)}`);
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      // 後端把留言功能關掉時，整區移除（不留空標題與表單）。
      // 這是不必重新部署站台就能立刻關閉的那條路徑。
      if (data.disabled) {
        root.remove();
        return;
      }
      renderAll(data.comments || []);
    } catch {
      listBox.textContent = "";
      listBox.appendChild(el("p", "cm-empty", "留言載入失敗，請稍後再試。"));
    }
  }

  // ------------------------------------------------------------ 版面

  root.appendChild(el("h2", "cm-title", "留言"));
  root.appendChild(
    el("p", "cm-note", "留言經站長審核後才會公開顯示。本站不使用 cookie 追蹤，也不會公開你的 IP。")
  );

  const listBox = el("div", "cm-listbox");
  root.appendChild(listBox);

  const form = el("form", "cm-form");
  const replyHint = el("p", "cm-reply-hint");
  replyHint.hidden = true;
  const cancelReply = el("button", "cm-cancel", "取消回覆");
  cancelReply.type = "button";
  cancelReply.addEventListener("click", () => {
    delete form.dataset.parentId;
    replyHint.hidden = true;
  });
  replyHint.appendChild(cancelReply);
  form.appendChild(replyHint);

  const nameInput = el("input", "cm-name-input");
  nameInput.type = "text";
  nameInput.placeholder = "暱稱";
  nameInput.maxLength = 40;
  nameInput.required = true;
  form.appendChild(nameInput);

  const bodyInput = el("textarea", "cm-body-input");
  bodyInput.placeholder = "留言內容";
  bodyInput.maxLength = 2000;
  bodyInput.required = true;
  form.appendChild(bodyInput);

  // 蜜罐：真人看不到，機器人常會自動填滿所有欄位
  const honey = el("input", "cm-hp");
  honey.type = "text";
  honey.name = "website";
  honey.tabIndex = -1;
  honey.autocomplete = "off";
  honey.setAttribute("aria-hidden", "true");
  form.appendChild(honey);

  let turnstileBox = null;
  if (turnstileKey) {
    turnstileBox = el("div", "cf-turnstile");
    turnstileBox.dataset.sitekey = turnstileKey;
    form.appendChild(turnstileBox);
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
  }

  const submit = el("button", "cm-submit", "送出留言");
  submit.type = "submit";
  form.appendChild(submit);

  const status = el("p", "cm-status");
  form.appendChild(status);
  root.appendChild(form);

  // ------------------------------------------------------------ 送出

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = "送出中…";

    const payload = {
      page,
      page_title: pageTitle,
      author: nameInput.value,
      body: bodyInput.value,
      website: honey.value,
    };
    if (form.dataset.parentId) payload.parent_id = Number(form.dataset.parentId);
    if (turnstileKey && window.turnstile) {
      payload.turnstile_token = window.turnstile.getResponse();
    }

    try {
      const res = await fetch(`${api}/api/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      // 送出成功後留言不會馬上出現，這是預期行為——講清楚，否則讀者會重複送出
      status.textContent = "已送出，經站長審核後才會顯示。";
      bodyInput.value = "";
      delete form.dataset.parentId;
      replyHint.hidden = true;
      if (window.turnstile) window.turnstile.reset();
    } catch (err) {
      status.textContent = "送出失敗：" + err.message;
    } finally {
      submit.disabled = false;
    }
  });

  load();
})();
