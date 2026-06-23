const form = document.getElementById("convertForm");
const statusBadge = document.getElementById("statusBadge");
const convertBtn = document.getElementById("convertBtn");
const resultBox = document.getElementById("resultBox");
const resultUrl = document.getElementById("resultUrl");
const copySuccess = document.getElementById("copySuccess");
const copyBtn = document.getElementById("copyBtn");
const openBtn = document.getElementById("openBtn");
const targetFormat = document.getElementById("targetFormat");
const groupFilter = document.getElementById("groupFilter");
const keepAllGroups = document.getElementById("keepAllGroups");

document.addEventListener("DOMContentLoaded", () => {
  checkBackend();
  updateGroupFilterVisibility();
});
form.addEventListener("submit", handleConvert);
copyBtn.addEventListener("click", copyResult);
targetFormat.addEventListener("change", updateGroupFilterVisibility);
keepAllGroups.addEventListener("change", updateGroupFilterState);

async function checkBackend() {
  try {
    const response = await fetch("/api/convert/status", {
      cache: "no-store"
    });
    const data = await response.json();

    if (response.ok && data.status === "running") {
      statusBadge.textContent = data.version
        ? `● 后端运行中 · ${data.version}`
        : "● 后端运行中 · 可用";
      statusBadge.className = "badge online";
      convertBtn.disabled = false;
      return;
    }

    throw new Error(data.message || "后端不可用");
  } catch (error) {
    statusBadge.textContent = "● 后端离线";
    statusBadge.className = "badge offline";
    convertBtn.disabled = true;
  }
}

async function handleConvert(event) {
  event.preventDefault();

  const params = new URLSearchParams();
  const formData = new FormData(form);

  for (const [key, value] of formData.entries()) {
    const trimmed = String(value).trim();
    if (trimmed && key !== "source" && key !== "group") {
      params.set(key, trimmed);
    }
  }

  if (!params.has("emoji")) {
    params.set("emoji", "false");
  }

  if (params.get("target") === "clash") {
    if (keepAllGroups.checked) {
      params.set("groupPolicy", "all");
    } else {
      const groups = Array.from(form.querySelectorAll('input[name="group"]:checked'))
        .map((input) => input.value)
        .filter(Boolean);

      params.set("groupPolicy", "clean");
      params.set("groups", groups.join(","));
    }
  }

  const convertUrl = `/api/convert?${params.toString()}`;
  const absoluteUrl = new URL(convertUrl, window.location.origin).href;

  convertBtn.disabled = true;
  convertBtn.textContent = "转换中...";
  resultBox.classList.remove("show");
  copySuccess.style.display = "none";

  try {
    const testResponse = await fetch(convertUrl, {
      method: "GET",
      cache: "no-store"
    });

    if (!testResponse.ok) {
      const message = await testResponse.text();
      throw new Error(message || `后端返回 ${testResponse.status}`);
    }

    resultUrl.textContent = absoluteUrl;
    openBtn.href = absoluteUrl;
    resultBox.classList.add("show");
  } catch (error) {
    alert(`转换失败：${error.message}\n请检查订阅链接是否正确，后端是否运行。`);
  } finally {
    convertBtn.textContent = "开始转换";
    await checkBackend();
  }
}

async function copyResult() {
  const value = resultUrl.textContent;
  if (!value) {
    return;
  }

  await navigator.clipboard.writeText(value);
  copySuccess.style.display = "block";
}

function updateGroupFilterVisibility() {
  const isClash = targetFormat.value === "clash";
  groupFilter.hidden = !isClash;
  updateGroupFilterState();
}

function updateGroupFilterState() {
  const disabled = keepAllGroups.checked || targetFormat.value !== "clash";

  for (const input of groupFilter.querySelectorAll('input[name="group"]')) {
    if (!input.defaultChecked) {
      input.disabled = disabled;
    }
  }
}
