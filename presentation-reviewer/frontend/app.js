
// Use the deployed backend by default; local hosts use the local server.
const API_URL = 'https://project-invent-codeday.vercel.app/';
const LOCAL_API_URL = 'http://localhost:3000';
const REQUEST_API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? LOCAL_API_URL
  : API_URL;
 
const form = document.getElementById("upload-form");
const fileInput = document.getElementById("deck");
const dropzone = document.getElementById("dropzone");
const dropzoneLabel = document.getElementById("dropzone-label");
const submitBtn = document.getElementById("submit-btn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const metersEl = document.getElementById("meters");
const ringEl = document.getElementById("ring");
const overallNumEl = document.getElementById("overall-num");
const gradeLabelEl = document.getElementById("grade-label");
const gradeSubEl = document.getElementById("grade-sub");
const feedbackList = document.getElementById("feedback-list");
const complianceEl = document.getElementById("compliance-checklist");
const downloadReportBtn = document.getElementById("download-report");
const themeToggle = document.getElementById("theme-toggle");
 
const RUBRIC_LABELS = {
  organization: "Organization",
  clarity: "Clarity",
  content_quality: "Content Quality",
  professionalism: "Professionalism",
  overall_impression: "Overall Impression",
};
 
// Project Invent's official Demo Day pitch criteria — every deck should
// cover these 8 elements. This is separate from the quality rubric above.
const COMPLIANCE_LABELS = {
  team_name: "Team Name",
  problem: "Problem",
  solution: "Solution",
  demo: "Demo",
  product_features: "Product Features",
  user_testing: "User Testing",
  competitor_matrix: "Competitor Matrix",
  next_steps: "Next Steps",
};
 
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const isDark = theme === "dark";
  themeToggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
  themeToggle.setAttribute("title", isDark ? "Switch to light mode" : "Switch to dark mode");
}
 
const savedTheme = localStorage.getItem("presentation-reviewer-theme");
applyTheme(savedTheme === "light" || savedTheme === "dark" ? savedTheme : "dark");
 
themeToggle.addEventListener("click", () => {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  localStorage.setItem("presentation-reviewer-theme", nextTheme);
});
 
fileInput.addEventListener("change", () => {
  dropzoneLabel.textContent = fileInput.files[0]?.name || "Choose a file or drag it here";
});
 
["dragover", "dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropzone.classList.toggle("dragover", eventName === "dragover");
  });
});
 
dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) {
    fileInput.files = e.dataTransfer.files;
    dropzoneLabel.textContent = file.name;
  }
});
 
function setStatus(message, isError = false) {
  statusEl.hidden = !message;
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}
 
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
 
function downloadReport(data, total, grade) {
  const rubricRows = Object.entries(RUBRIC_LABELS)
    .map(([key, label]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(data.scores[key])} / 10</td></tr>`)
    .join("");
  const feedbackItems = data.feedback
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  const complianceRows = data.compliance
    ? Object.entries(COMPLIANCE_LABELS)
        .map(([key, label]) => {
          const item = data.compliance[key];
          const mark = item?.present ? "✓" : "✗";
          const note = item?.note ? escapeHtml(item.note) : "";
          return `<tr><td>${mark} ${escapeHtml(label)}</td><td>${note}</td></tr>`;
        })
        .join("")
    : "";
  const complianceSection = data.compliance
    ? `<h2>Pitch criteria checklist</h2><table>${complianceRows}</table>`
    : "";
  const report = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>AI Presentation Reviewer Report</title>
<style>body{max-width:760px;margin:40px auto;padding:0 24px;color:#17212b;font:16px/1.6 Arial,sans-serif}h1{margin-bottom:4px;color:#12608b}h2{margin-top:32px;color:#12608b}p{color:#536575}.summary{padding:20px;border:1px solid #b8d8e8;border-radius:10px;background:#eef9ff}.score{font-size:32px;font-weight:700;color:#12608b}table{width:100%;border-collapse:collapse}td{padding:10px;border-bottom:1px solid #d9e5eb}td:last-child{text-align:left}li{margin:10px 0}</style>
</head><body><h1>AI Presentation Reviewer</h1><p>Project Invent - Codeday</p>
<div class="summary"><div class="score">${escapeHtml(total)} / 50</div><strong>${escapeHtml(grade)}</strong><p>${escapeHtml(data.slide_count)} slide(s) evaluated</p></div>
<h2>Rubric breakdown</h2><table>${rubricRows}</table>
${complianceSection}
<h2>Feedback</h2><ul>${feedbackItems}</ul>
<p>Generated by AI Presentation Reviewer.</p></body></html>`;
  const blob = new Blob([report], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ai-presentation-reviewer-report.html";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
 
function renderCompliance(compliance) {
  if (!complianceEl) return; // HTML container not added yet — safe no-op
  complianceEl.innerHTML = "";
  if (!compliance) {
    complianceEl.hidden = true;
    return;
  }
  complianceEl.hidden = false;
  for (const [key, label] of Object.entries(COMPLIANCE_LABELS)) {
    const item = compliance[key];
    const row = document.createElement("div");
    row.className = "compliance-item" + (item?.present ? " present" : " missing");
    row.innerHTML = `
      <div class="compliance-head">
        <span class="compliance-icon">${item?.present ? "✓" : "✗"}</span>
        <span class="compliance-label">${escapeHtml(label)}</span>
      </div>
      <p class="compliance-note">${escapeHtml(item?.note || "")}</p>`;
    complianceEl.appendChild(row);
  }
}
 
function renderResults(data) {
  const total = Object.keys(RUBRIC_LABELS).reduce(
    (sum, key) => sum + data.scores[key],
    0
  );
  const percentage = (total / 50) * 100;
  const grade = total >= 45 ? "Excellent" : total >= 35 ? "Strong" : total >= 25 ? "Developing" : "Needs work";
 
  overallNumEl.textContent = total;
  gradeLabelEl.textContent = grade;
  gradeSubEl.textContent = `${total} out of 50 points across ${data.slide_count} slide(s)`;
  ringEl.style.setProperty("--score", `${percentage}%`);
  downloadReportBtn.hidden = false;
  downloadReportBtn.onclick = () => downloadReport(data, total, grade);
 
  metersEl.innerHTML = "";
  for (const [key, label] of Object.entries(RUBRIC_LABELS)) {
    const meter = document.createElement("div");
    meter.className = "meter";
    meter.innerHTML = `
      <div class="meter-head"><span>${label}</span><strong>${data.scores[key]} / 10</strong></div>
      <div class="meter-track"><span style="width: ${data.scores[key] * 10}%"></span></div>`;
    metersEl.appendChild(meter);
  }
 
  feedbackList.innerHTML = "";
  for (const item of data.feedback) {
    const li = document.createElement("li");
    li.textContent = item;
    feedbackList.appendChild(li);
  }
 
  renderCompliance(data.compliance);
 
  resultsEl.hidden = false;
}
 
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = fileInput.files[0];
  if (!file) return;
 
  resultsEl.hidden = true;
  submitBtn.disabled = true;
  setStatus("Uploading and evaluating — this can take up to a few minutes");
 
  const formData = new FormData();
  formData.append("deck", file);
 
  try {
    const evaluateUrl = new URL("/api/evaluate", `${REQUEST_API_URL}/`);
    const res = await fetch(evaluateUrl, {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
 
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
 
    setStatus(`Done — evaluated ${data.slide_count} slide(s).`);
    renderResults(data);
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    submitBtn.disabled = false;
  }
});