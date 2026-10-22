const $ = (selector) => document.querySelector(selector);
const labels = { planned: "On the horizon", active: "In the making", done: "Made it happen" };
const nextStatus = { planned: "active", active: "done", done: "planned" };
let tasks = [];
let editing = null;
let toastTimer;

async function api(path = "", options = {}) {
  const response = await fetch(`/api/tasks${path}`, {
    ...options,
    headers: { "Content-Type": "application/json" },
  });
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not save. Please try again.");
  return data;
}

function showError(error, target = "#error") {
  $(target).textContent = error.message || "Something went wrong. Please try again.";
  $(target).hidden = false;
}

function toast(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  toastTimer = setTimeout(() => { $("#toast").hidden = true; }, 3000);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function render() {
  const search = $("#search").value.toLowerCase();
  $("#total").textContent = `${tasks.length} ${tasks.length === 1 ? "note" : "notes"}`;
  for (const status of Object.keys(labels)) {
    const group = tasks.filter((t) => t.status === status && `${t.title} ${t.body}`.toLowerCase().includes(search));
    $(`#count-${status}`).textContent = group.length;
    const list = $(`#${status}`);
    list.replaceChildren();
    if (!group.length) list.append(element("div", "empty", search ? "No matching notes here." : "Room for the next little thing."));
    for (const task of group) {
      const card = element("article", "card");
      card.dataset.id = task.id;
      const top = element("div", "card-top");
      const edit = element("button", "edit-card", "↗");
      edit.setAttribute("aria-label", `Edit ${task.title}`);
      edit.addEventListener("click", () => openEditor(task));
      top.append(element("h3", "", task.title), edit);
      card.append(top);
      if (task.body) card.append(element("p", "", task.body));
      const footer = element("div", "card-footer");
      const date = element("time", "", new Date(task.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
      date.dateTime = task.updated_at;
      date.title = `Updated ${new Date(task.updated_at).toLocaleString()}`;
      const move = element("button", "move-card", status === "planned" ? "Start making →" : status === "active" ? "Mark complete ✓" : "Begin again ↻");
      move.setAttribute("aria-label", `Move ${task.title} to ${labels[nextStatus[status]]}`);
      move.addEventListener("click", async () => {
        move.disabled = true;
        try {
          await api(`/${task.id}`, { method: "PUT", body: JSON.stringify({ ...task, status: nextStatus[status] }) });
          await load();
          toast(`Moved to ${labels[nextStatus[status]].toLowerCase()}.`);
        } catch (error) { showError(error); move.disabled = false; }
      });
      footer.append(date, move);
      card.append(footer);
      list.append(card);
    }
  }
}

async function load() {
  $("#board").setAttribute("aria-busy", "true");
  try {
    tasks = await api();
    $("#connection").className = "connection online";
    $("#connection").replaceChildren(element("i"), document.createTextNode("Saved on this machine"));
    $("#error").hidden = true;
    render();
  } catch (error) {
    $("#connection").className = "connection offline";
    $("#connection").replaceChildren(element("i"), document.createTextNode("Connection lost"));
    showError(error);
    throw error;
  } finally { $("#board").setAttribute("aria-busy", "false"); }
}

function openEditor(task = null, status = "planned") {
  editing = task;
  $("#editor-title").textContent = task ? "A little more detail" : "A new note";
  $("#title").value = task?.title ?? "";
  $("#body").value = task?.body ?? "";
  $("#status").value = task?.status ?? status;
  $("#delete-task").hidden = !task;
  $("#form-error").hidden = true;
  $("#editor").showModal();
  $("#title").focus();
}

$("#new-task").addEventListener("click", () => openEditor());
for (const button of document.querySelectorAll("[data-add]")) button.addEventListener("click", () => openEditor(null, button.dataset.add));
$("#close-editor").addEventListener("click", () => $("#editor").close());
$("#search").addEventListener("input", render);
$("#task-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#save-task").disabled = true;
  $("#form-error").hidden = true;
  const task = { title: $("#title").value, body: $("#body").value, status: $("#status").value };
  try {
    await api(editing ? `/${editing.id}` : "", { method: editing ? "PUT" : "POST", body: JSON.stringify(task) });
    $("#editor").close();
    await load();
    toast(editing ? "Note updated." : "A small step, saved.");
  } catch (error) { showError(error, $("#editor").open ? "#form-error" : "#error"); }
  finally { $("#save-task").disabled = false; }
});
$("#delete-task").addEventListener("click", async () => {
  if (!editing || !confirm(`Delete “${editing.title}”? This cannot be undone.`)) return;
  $("#delete-task").disabled = true;
  try {
    await api(`/${editing.id}`, { method: "DELETE" });
    $("#editor").close();
    await load();
    toast("Note deleted.");
  } catch (error) { showError(error, $("#editor").open ? "#form-error" : "#error"); }
  finally { $("#delete-task").disabled = false; }
});
load().catch(() => {});
