const auth = window.MindfulAuth;
const session = auth.requireRole("patient");

if (session) {
  const history = document.querySelector("#history");
  const doctorStatus = document.querySelector("#doctor-status");
  const doctorForm = document.querySelector("#doctor-form");
  const doctorCode = document.querySelector("#doctor-code");
  const unlinkButton = document.querySelector("#doctor-unlink");
  const doctorError = document.querySelector("#doctor-error");
  const deleteError = document.querySelector("#delete-error");

  function showDoctor(doctor) {
    const current = auth.getSession();
    if (current) {
      current.user.doctor = doctor;
      auth.setSession(current);
    }
    doctorStatus.textContent = doctor
      ? `Linked to ${doctor.name}. They can see your saved check-ins.`
      : "No doctor linked. Only you can see your check-ins. If your doctor gave you a code, enter it below.";
    unlinkButton.hidden = !doctor;
    doctorForm.querySelector('button[type="submit"]').textContent = doctor
      ? "Change doctor"
      : "Link doctor";
  }

  async function saveDoctor(code) {
    doctorError.hidden = true;
    try {
      const data = await auth.api("/api/patient/doctor", {
        method: "PUT",
        body: { doctorCode: code },
      });
      doctorCode.value = "";
      showDoctor(data.doctor);
    } catch (error) {
      doctorError.textContent = error.message;
      doctorError.hidden = false;
    }
  }

  doctorForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!doctorCode.value.trim()) {
      doctorError.textContent = "Please enter your doctor's code.";
      doctorError.hidden = false;
      return;
    }
    saveDoctor(doctorCode.value.trim());
  });
  unlinkButton.addEventListener("click", () => {
    if (window.confirm("Remove your doctor? They will no longer see your check-ins.")) {
      saveDoctor("");
    }
  });

  document.querySelector("#delete-account").addEventListener("click", async () => {
    if (!window.confirm("Permanently delete your account and all saved check-ins? This cannot be undone.")) {
      return;
    }
    try {
      await auth.api("/api/patient/account", {
        method: "DELETE",
        body: { confirm: "DELETE MY ACCOUNT" },
      });
      auth.clearSession();
      window.location.href = "./login.html";
    } catch (error) {
      deleteError.textContent = error.message;
      deleteError.hidden = false;
    }
  });

  async function load() {
    showDoctor(session.user.doctor ?? null);
    try {
      const data = await auth.api("/api/patient/submissions");
      history.replaceChildren();
      if (data.submissions.length === 0) {
        const empty = document.createElement("p");
        empty.className = "admin-note";
        empty.textContent = "You haven't completed a check-in yet.";
        history.append(empty);
        return;
      }
      for (const submission of data.submissions) {
        history.append(auth.renderSubmission(submission));
      }
    } catch (error) {
      if (error.status === 401) {
        window.location.replace("./login.html");
        return;
      }
      history.textContent = error.message;
    }
  }
  load();
}
