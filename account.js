const accountGate = document.querySelector("#account-gate");
const questionnaireContent = document.querySelector("#questionnaire-content");
const accountTitle = document.querySelector("#account-title");
const loginView = document.querySelector("#account-login-view");
const registerView = document.querySelector("#account-register-view");
const forgotView = document.querySelector("#account-forgot-view");
const resetView = document.querySelector("#account-reset-view");
const accountMessage = document.querySelector("#account-message");
const accountEmail = document.querySelector("#account-email");
const sessionKey = "mindful-checkin-session";
let resetToken = "";
let authenticated = false;

function apiUrl(path) {
  const base = (window.MIND_CHECKIN_API_BASE || "").replace(/\/+$/, "");
  return `${base}${path}`;
}

function currentToken() {
  return sessionStorage.getItem(sessionKey) || "";
}

function showAccountMessage(message, isError = false) {
  accountMessage.textContent = message;
  accountMessage.classList.toggle("account-message-error", isError);
  accountMessage.hidden = false;
}

function clearAccountMessage() {
  accountMessage.textContent = "";
  accountMessage.hidden = true;
  accountMessage.classList.remove("account-message-error");
}

function showLogin(message = "", isError = false) {
  accountGate.hidden = false;
  questionnaireContent.hidden = true;
  accountTitle.textContent = "Welcome back";
  loginView.hidden = false;
  registerView.hidden = true;
  forgotView.hidden = true;
  resetView.hidden = true;
  authenticated = false;
  if (message) showAccountMessage(message, isError);
  else clearAccountMessage();
}

function showRegistration() {
  clearAccountMessage();
  accountTitle.textContent = "Create your account";
  loginView.hidden = true;
  registerView.hidden = false;
  forgotView.hidden = true;
  resetView.hidden = true;
}

function showForgotPassword() {
  clearAccountMessage();
  accountTitle.textContent = "Reset your password";
  loginView.hidden = true;
  registerView.hidden = true;
  forgotView.hidden = false;
  resetView.hidden = true;
}

function openQuestionnaire(email) {
  authenticated = true;
  accountEmail.textContent = email;
  accountGate.hidden = true;
  questionnaireContent.hidden = false;
  clearAccountMessage();
  window.scrollTo(0, 0);
}

async function authRequest(path, body, token = "") {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(apiUrl(path), {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("The account service returned an unreadable response.");
  }
  if (!response.ok) throw new Error(data.error || "The account request failed.");
  return data;
}

async function runForm(form, action) {
  clearAccountMessage();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await action(new FormData(form));
  } catch (error) {
    showAccountMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
}

document.querySelector("#show-register").addEventListener("click", showRegistration);
document.querySelector("#show-login").addEventListener("click", () => showLogin());
document.querySelector("#show-forgot").addEventListener("click", showForgotPassword);
document.querySelector("[data-show-login]").addEventListener("click", () => showLogin());

document.querySelector("#account-register").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  runForm(form, async (data) => {
    const result = await authRequest("/api/auth/register", {
      email: data.get("email"),
      password: data.get("password"),
    });
    form.reset();
    showLogin(result.message);
  });
});

document.querySelector("#account-login").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  runForm(form, async (data) => {
    const result = await authRequest("/api/auth/login", {
      email: data.get("email"),
      password: data.get("password"),
    });
    sessionStorage.setItem(sessionKey, result.token);
    form.reset();
    openQuestionnaire(result.account.email);
  });
});

document.querySelector("#account-forgot").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  runForm(form, async (data) => {
    const result = await authRequest("/api/auth/forgot-password", {
      email: data.get("email"),
    });
    showAccountMessage(result.message);
    form.reset();
  });
});

document.querySelector("#account-reset").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  runForm(form, async (data) => {
    const result = await authRequest("/api/auth/reset-password", {
      token: resetToken,
      password: data.get("password"),
    });
    resetToken = "";
    sessionStorage.removeItem(sessionKey);
    form.reset();
    showLogin(result.message);
  });
});

document.querySelector("#account-logout").addEventListener("click", async () => {
  const token = currentToken();
  try {
    await authRequest("/api/auth/logout", {}, token);
    sessionStorage.removeItem(sessionKey);
    window.location.reload();
  } catch (error) {
    sessionStorage.removeItem(sessionKey);
    sessionStorage.setItem(
      "mindful-signout-notice",
      `${error.message} You have been signed out on this device; the server session will expire within 12 hours.`,
    );
    window.location.reload();
  }
});

const query = new URLSearchParams(window.location.search);
const verificationToken = query.get("verify");
resetToken = query.get("reset") || "";
if (verificationToken || resetToken) {
  window.history.replaceState(null, "", window.location.pathname);
}

if (resetToken) {
  accountTitle.textContent = "Choose a new password";
  loginView.hidden = true;
  registerView.hidden = true;
  forgotView.hidden = true;
  resetView.hidden = false;
  showAccountMessage("Use at least 12 characters for your new password.");
} else if (verificationToken) {
  showLogin("Verifying your email address…");
  authRequest("/api/auth/verify", { token: verificationToken })
    .then((result) => showLogin(result.message))
    .catch((error) => showLogin(error.message, true));
}

if (!resetToken && !verificationToken && currentToken()) {
  showAccountMessage("Checking your sign-in…");
  loginView.hidden = true;
  authRequest("/api/auth/me", undefined, currentToken())
    .then(({ account }) => openQuestionnaire(account.email))
    .catch((error) => {
      sessionStorage.removeItem(sessionKey);
      showLogin(`${error.message} Please sign in again.`, true);
    });
} else if (!resetToken && !verificationToken) {
  const notice = sessionStorage.getItem("mindful-signout-notice") || "";
  sessionStorage.removeItem("mindful-signout-notice");
  showLogin(notice, Boolean(notice));
}

window.MindfulAccount = {
  get token() {
    return currentToken();
  },
  get isSignedIn() {
    return authenticated;
  },
};
