import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Uses the runner's installed Chrome and native Node APIs; no production target,
// extra package download, browser profile, or authentication bypass is accepted.
export async function verifyBrowser(origin, cookie) {
  if (process.env.CI !== "true" || origin !== "http://127.0.0.1:3107") throw new Error("Browser verification requires the isolated CI server");
  const binary = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);
  if (!binary) throw new Error("The CI runner requires installed Chrome");
  const profile = await mkdtemp(join(tmpdir(), "stride-browser-"));
  const chrome = spawn(binary, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-background-networking", "--disable-extensions", "--no-first-run", "--no-default-browser-check", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=9337", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let socket;
  let stage = "chrome-start";
  const pending = new Map();
  const runtimeErrors = [];
  let sequence = 0;
  async function call(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("Browser operation timed out")); }, 10_000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const response = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error("Browser expression failed");
    return response.result.value;
  }
  async function waitFor(expression) {
    for (let attempt = 0; attempt < 80; attempt++) { if (await evaluate(expression)) return; await delay(100); }
    throw new Error("Browser state did not settle");
  }
  async function clickButton(label, selector = "button") {
    const expression = `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(el => el.offsetWidth && (el.getAttribute('aria-label') === ${JSON.stringify(label)} || el.textContent.trim() === ${JSON.stringify(label)}))`;
    await waitFor(`Boolean(${expression})`);
    assert.equal(await evaluate(`(() => { const el = ${expression}; if (!el || el.disabled) return false; el.click(); return true; })()`), true);
  }
  async function fill(selector, value) {
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.select(); })()`);
    await call("Input.insertText", { text: value });
  }
  const editorClosed = "!document.querySelector('.task-sheet')";
  try {
    let target;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const response = await fetch("http://127.0.0.1:9337/json/list", { signal: AbortSignal.timeout(1000) });
        target = (await response.json()).find(item => item.type === "page"); if (target) break;
      } catch {}
      if (chrome.exitCode !== null) break;
      await delay(100);
    }
    assert.ok(target?.webSocketDebuggerUrl);
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    socket.addEventListener("message", event => {
      const data = JSON.parse(event.data);
      if (data.id) {
        const operation = pending.get(data.id); if (!operation) return;
        clearTimeout(operation.timer); pending.delete(data.id);
        if (data.error) operation.reject(new Error("Browser protocol failed")); else operation.resolve(data.result);
      } else if (data.method === "Runtime.exceptionThrown" || (data.method === "Runtime.consoleAPICalled" && data.params.type === "error")) runtimeErrors.push(data.method);
    });
    await call("Page.enable"); await call("Runtime.enable"); await call("Network.enable");
    await call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    for (const pair of cookie.split("; ")) {
      const separator = pair.indexOf("=");
      if (separator > 0) await call("Network.setCookie", { name: pair.slice(0, separator), value: pair.slice(separator + 1), url: origin, httpOnly: true, sameSite: "Lax" });
    }
    stage = "daily-view";
    await call("Page.navigate", { url: origin });
    await waitFor("document.querySelector('h1')?.textContent === 'My Tasks' && document.querySelector('[aria-label=\"New task title\"]')?.disabled === false");
    const title = `Browser acceptance ${crypto.randomUUID().slice(0, 8)}`;
    await fill('[aria-label="New task title"]', title);
    await clickButton("Create task");
    await waitFor(`Array.from(document.querySelectorAll('.task-open strong')).some(el => el.textContent === ${JSON.stringify(title)})`);
    await evaluate(`Array.from(document.querySelectorAll('.task-open')).find(el => el.querySelector('strong')?.textContent === ${JSON.stringify(title)}).click()`);
    stage = "comments-and-mentions";
    const body = "Review <img src=x onerror=window.__strideXss=true> @";
    await fill("#task-comment", body);
    await waitFor("Boolean(document.querySelector('.mention-picker button'))");
    await evaluate("document.querySelector('.mention-picker button').click()");
    await clickButton("Post comment");
    await waitFor("Boolean(document.querySelector('.comment-body')) && document.querySelector('#task-comment')?.value === ''");
    assert.equal(await evaluate("document.querySelector('.comment-body').textContent.includes('<img src=x') && !document.querySelector('.comment-body img') && !window.__strideXss"), true);
    await fill("#task-comment", "Unsent comment stays here");
    await clickButton("Close", ".task-sheet button");
    await clickButton("Keep editing");
    assert.equal(await evaluate("document.querySelector('#task-comment').value"), "Unsent comment stays here");
    await clickButton("Close", ".task-sheet button");
    await clickButton("Discard changes");
    await waitFor(editorClosed);
    stage = "board-transitions-and-trash";
    await clickButton("Project board", '[data-slot="sidebar-menu-button"]');
    await waitFor(`Array.from(document.querySelectorAll('.board-task-title')).some(el => el.textContent === ${JSON.stringify(title)})`);
    await clickButton(`Start ${title}`);
    await waitFor(`Array.from(document.querySelectorAll('.column-in_progress .board-task-title')).some(el => el.textContent === ${JSON.stringify(title)})`);
    await clickButton(`Complete ${title}`);
    await waitFor(`Array.from(document.querySelectorAll('.column-done .board-task-title')).some(el => el.textContent === ${JSON.stringify(title)})`);
    await clickButton(title, ".board-task-title");
    await waitFor("Boolean(document.querySelector('.comment-body'))");
    await clickButton("Move to trash"); await waitFor(editorClosed);
    await evaluate("document.querySelector('#show-archived').click()");
    await waitFor(`Array.from(document.querySelectorAll('.board-task-title')).some(el => el.textContent === ${JSON.stringify(title)})`);
    await clickButton("Restore");
    await clickButton("My open tasks");
    await waitFor("document.querySelector('h1')?.textContent === 'My Tasks' && document.querySelector('#show-archived')?.getAttribute('data-state') === 'unchecked'");
    stage = "inbox";
    await evaluate("document.querySelector('button[aria-label^=\"Notifications\"]').click()");
    await waitFor("Boolean(document.querySelector('.notification-item'))");
    await evaluate("document.querySelector('.notification-item').click()");
    await waitFor("Boolean(document.querySelector('.task-sheet')) && !document.querySelector('.notification-sheet')");
    await clickButton("Close", ".task-sheet button"); await waitFor(editorClosed);
    stage = "small-screen-and-keyboard";
    await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await delay(200);
    assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), true);
    await evaluate("document.querySelector('[aria-label=\"New task title\"]').focus()");
    await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    assert.equal(await evaluate("document.activeElement !== document.body"), true);
    assert.deepEqual(runtimeErrors, []);
    console.log("Browser task, comment, mention, inbox, draft and 390px layout checks passed.");
  } catch (error) {
    console.error(JSON.stringify({ event: "browser_check_failed", stage })); throw error;
  } finally {
    for (const operation of pending.values()) { clearTimeout(operation.timer); operation.reject(new Error("Browser closed")); }
    socket?.close(); chrome.kill("SIGTERM");
    if (chrome.exitCode === null) await Promise.race([new Promise(resolve => chrome.once("exit", resolve)), delay(3000)]);
    if (chrome.exitCode === null) chrome.kill("SIGKILL");
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
