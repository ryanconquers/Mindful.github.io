const auth = window.MindfulAuth;
const session = auth.requireRole("doctor");

if (session) {
  const table = document.querySelector("#patients-table");
  const body = document.querySelector("#patients-body");
  const empty = document.querySelector("#patients-empty");
  const errorBox = document.querySelector("#patients-error");
  const detail = document.querySelector("#patient-detail");
  const detailRecords = document.querySelector("#detail-records");

  document.querySelector("#doctor-code").textContent = session.user.doctorCode || "—";

  function cell(content, className) {
    const td = document.createElement("td");
    if (content instanceof Node) td.append(content);
    else td.textContent = content;
    if (className) td.className = className;
    return td;
  }

  async function openPatient(patient) {
    detailRecords.replaceChildren();
    document.querySelector("#detail-title").textContent = patient.name;
    document.querySelector("#detail-email").textContent = patient.email;
    detail.hidden = false;
    detail.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      const data = await auth.api(`/api/doctor/patients/${patient.id}/submissions`);
      if (data.submissions.length === 0) {
        const note = document.createElement("p");
        note.className = "admin-note";
        note.textContent = "This patient has not completed a check-in yet.";
        detailRecords.append(note);
        return;
      }
      data.submissions.forEach((submission, index) => {
        const card = auth.renderSubmission(submission);
        if (index === 0) card.open = true;
        detailRecords.append(card);
      });
    } catch (error) {
      detailRecords.textContent = error.message;
    }
  }

  async function loadPatients() {
    errorBox.hidden = true;
    try {
      const data = await auth.api("/api/doctor/patients");
      body.replaceChildren();
      table.hidden = data.patients.length === 0;
      empty.hidden = data.patients.length !== 0;
      for (const patient of data.patients) {
        const row = document.createElement("tr");
        const name = document.createElement("div");
        name.className = "patient-name";
        name.textContent = patient.name;
        if (patient.everSafetySupport) {
          const badge = document.createElement("span");
          badge.className = "badge badge-alert";
          badge.textContent = "Safety flag";
          name.append(" ", badge);
        }
        const email = document.createElement("div");
        email.className = "patient-email";
        email.textContent = patient.email;
        const nameCell = cell("");
        nameCell.append(name, email);
        const open = document.createElement("button");
        open.type = "button";
        open.className = "button button-secondary button-small";
        open.textContent = "View records";
        open.addEventListener("click", () => openPatient(patient));
        const bands = patient.latestBands;
        row.append(
          nameCell,
          cell(String(patient.checkInCount)),
          cell(patient.lastCheckInAt ? new Date(patient.lastCheckInAt).toLocaleDateString() : "—"),
          cell(bands?.mood ?? "—"),
          cell(bands?.anxiety ?? "—"),
          cell(bands?.stress ?? "—"),
          cell(open),
        );
        body.append(row);
      }
    } catch (error) {
      if (error.status === 401) {
        window.location.replace("./login.html");
        return;
      }
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    }
  }

  document.querySelector("#refresh").addEventListener("click", loadPatients);
  document.querySelector("#detail-close").addEventListener("click", () => {
    detail.hidden = true;
  });
  loadPatients();
}
