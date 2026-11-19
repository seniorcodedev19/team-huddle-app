/* The connect screen: first run, "Change server", and "can't reach the
   server". One page, because all three end the same way: an address that
   answers, and the app behind it. */
(() => {
  const bridge = window.huddleDesktop;
  const $ = (id) => document.getElementById(id);
  const title = $("title");
  const lead = $("lead");
  const problem = $("problem");
  const retryRow = $("retry-row");
  const retry = $("retry");
  const other = $("other");
  const form = $("form");
  const address = $("address");
  const error = $("error");
  const go = $("go");
  const cancel = $("cancel");
  const foot = $("foot");

  /* While the server is down the page asks again by itself, so the app
     comes back without anyone having to notice that it can. */
  const AUTO_RETRY_MS = 20_000;
  let timer = null;

  const showError = (text) => {
    error.textContent = text ?? "";
    error.hidden = !text;
  };

  function showForm(state, withCancel) {
    clearInterval(timer);
    retryRow.hidden = true;
    form.hidden = false;
    cancel.hidden = !withCancel;
    address.value = state.serverUrl ?? state.suggestion ?? "";
    address.focus();
    address.select();
  }

  async function tryAgain(quiet) {
    if (!quiet) {
      retry.disabled = true;
      retry.textContent = "Trying…";
    }
    const res = await bridge.retry();
    if (res && res.ok) return; // The app is loading; this page is on its way out.
    if (!quiet) {
      retry.disabled = false;
      retry.textContent = "Try again";
      if (res && res.error) problem.textContent = res.error;
    }
  }

  async function init() {
    const state = await bridge.state();
    if (!state) return;
    foot.textContent = `Team Huddle ${state.version}`;

    if (state.mode === "unreachable") {
      title.textContent = "Can't reach Team Huddle";
      lead.textContent = "The app will reconnect by itself as soon as the server answers.";
      problem.textContent = state.error ?? "The server isn't answering.";
      problem.hidden = false;
      form.hidden = true;
      retryRow.hidden = false;
      retry.addEventListener("click", () => void tryAgain(false));
      other.addEventListener("click", () => {
        problem.hidden = true;
        title.textContent = "Connect to Team Huddle";
        lead.textContent = "Enter the address of your team's Team Huddle server.";
        showForm(state, false);
      });
      timer = setInterval(() => void tryAgain(true), AUTO_RETRY_MS);
      return;
    }

    if (state.mode === "change") {
      title.textContent = "Change server";
      lead.textContent = "Connecting to a different server signs you out of the current one.";
      cancel.addEventListener("click", () => void bridge.retry());
    }
    showForm(state, state.mode === "change" && Boolean(state.serverUrl));
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError(null);
    go.disabled = true;
    go.textContent = "Connecting…";
    let res;
    try {
      res = await bridge.connect(address.value);
    } catch {
      res = { ok: false, error: "Something went wrong. Try again." };
    }
    if (res && res.ok) return; // The app is loading.
    go.disabled = false;
    go.textContent = "Connect";
    showError((res && res.error) || "That address didn't work.");
    address.focus();
  });

  void init();
})();
