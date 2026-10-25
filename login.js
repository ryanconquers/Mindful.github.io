const auth = window.MindfulAuth;

const tabLogin = document.querySelector("#tab-login");
const tabRegister = document.querySelector("#tab-register");
const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#register-form");
const loginError = document.querySelector("#login-error");
const registerError = document.querySelector("#register-error");
const patientFields = document.querySelector("#patient-fields");
const doctorFields = document.querySelector("#doctor-fields");

const existing = auth.getSession();
if (existing) window.location.replace(auth.home(existing.user.role));

function showMode(mode) {
  const registering = mode === "register";
  loginForm.hidden = registering;
  registerForm.hidden = !registering;
  tabLogin.classList.toggle("is-active", !registering);
  tabRegister.classList.toggle("is-active", registering);
  tabLogin.setAttribute("aria-selected", String(!registering));
  tabRegister.setAttribute("aria-selected", String(registering));
}

function selectedRole() {
  return registerForm.elements.role.value;
}

function showRole() {
  const doctor = selectedRole() === "doctor";
  patientFields.hidden = doctor;
  doctorFields.hidden = !doctor;
}

tabLogin.addEventListener("click", () => showMode("login"));
tabRegister.addEventListener("click", () => showMode("register"));
registerForm.addEventListener("change", showRole);

const params = new URLSearchParams(window.location.search);
if (params.get("mode") === "register") showMode("register");
if (params.get("role") === "doctor") {
  registerForm.elements.role.value = "doctor";
  showRole();
}

function finish(session) {
  auth.setSession(session);
  window.location.href = auth.home(session.user.role);
}

async function submit(form, errorBox, work) {
  errorBox.hidden = true;
  const button = form.querySelector('button[type="submit"]');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Please wait…";
  try {
    await work();
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
    button.disabled = false;
    button.textContent = label;
  }
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submit(loginForm, loginError, async () => {
    const email = document.querySelector("#login-email").value.trim();
    const password = document.querySelector("#login-password").value;
    if (!email || !password) throw new Error("Please enter your email and password.");
    finish(await auth.api("/api/auth/login", { method: "POST", auth: false, body: { email, password } }));
  });
});

registerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submit(registerForm, registerError, async () => {
    const role = selectedRole();
    const body = {
      role,
      name: document.querySelector("#reg-name").value,
      email: document.querySelector("#reg-email").value,
      password: document.querySelector("#reg-password").value,
    };
    if (!body.name.trim() || !body.email.trim()) {
      throw new Error("Please enter your name and email.");
    }
    if (body.password.length < 10) {
      throw new Error("Your password must be at least 10 characters.");
    }
    if (role === "patient") {
      body.doctorCode = document.querySelector("#reg-doctor-code").value.trim();
      body.confirmAdult = document.querySelector("#reg-adult").checked;
      body.consentToShare = document.querySelector("#reg-consent").checked;
      if (!body.confirmAdult || !body.consentToShare) {
        throw new Error("Please tick both confirmations to create a patient account.");
      }
    } else {
      body.inviteCode = document.querySelector("#reg-invite").value;
    }
    finish(await auth.api("/api/auth/register", { method: "POST", auth: false, body }));
  });
});
