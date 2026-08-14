const CFG = window.APP_CONFIG;

/* ------------------------------------------------------------------ */
/* Location gate                                                       */
/* ------------------------------------------------------------------ */
function initLocationGate() {
  const statusEl = document.getElementById("location-status");
  const gate = document.getElementById("location-gate");
  const appRoot = document.getElementById("app-root");

  if (!navigator.geolocation) {
    statusEl.textContent = "❌ Geolocation is not supported by your browser.";
    statusEl.className = "status-msg error";
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      statusEl.textContent = `✅ Location received: ${lat}, ${lon}`;
      statusEl.className = "status-msg success";

      const res = await fetch("/api/verify-location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lon }),
      });
      const data = await res.json();

      if (!data.within_range) {
        statusEl.textContent = `❌ You are ${data.distance}m away from college. Attendance can only be marked within ${data.allowed_radius}m.`;
        statusEl.className = "status-msg error";
        return;
      }
      statusEl.textContent = `✅ Location verified (${data.distance}m from college)`;
      statusEl.className = "status-msg success";
      gate.classList.add("hidden");
      appRoot.classList.remove("hidden");
      initApp();
    },
    (err) => {
      statusEl.textContent = "⚠️ Waiting for location permission… please allow location access in your browser.";
      statusEl.className = "status-msg warning";
    },
    { enableHighAccuracy: true }
  );
}

/* ------------------------------------------------------------------ */
/* Speech Synthesis (Siri Voice)                                      */
/* ------------------------------------------------------------------ */
function speakText(text) {
  if (!('speechSynthesis' in window)) {
    console.warn("Speech synthesis not supported in this browser.");
    return;
  }

  // Cancel any ongoing speech to avoid overlaps
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);

  // Siri voice selection logic (prioritizes Siri, Samantha, Google, or any English voice)
  const voices = window.speechSynthesis.getVoices();
  let selectedVoice = voices.find(v => v.name.includes("Siri") && v.lang.startsWith("en"));
  if (!selectedVoice) {
    selectedVoice = voices.find(v => v.name.includes("Samantha") && v.lang.startsWith("en"));
  }
  if (!selectedVoice) {
    selectedVoice = voices.find(v => v.name.includes("Google US English") && v.lang.startsWith("en"));
  }
  if (!selectedVoice) {
    selectedVoice = voices.find(v => v.lang.startsWith("en"));
  }

  if (selectedVoice) {
    utterance.voice = selectedVoice;
  }

  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  window.speechSynthesis.speak(utterance);
}

// Pre-fetch voices for speechSynthesis to prevent delay on first call
if ('speechSynthesis' in window) {
  window.speechSynthesis.getVoices();
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.getVoices();
    };
  }
}

/* ------------------------------------------------------------------ */
/* Popup                                                                */
/* ------------------------------------------------------------------ */
function showPopup(success, message, rollNumber) {
  const overlay = document.getElementById("scan-popup");
  document.getElementById("popup-icon").textContent = success ? "✅" : "❌";
  document.getElementById("popup-icon").className = "modal-icon " + (success ? "success" : "error");
  document.getElementById("popup-heading").textContent = success ? "Attendance Marked" : "Attendance Failed";
  document.getElementById("popup-message").textContent = message;
  document.getElementById("popup-footer").innerHTML = rollNumber ? `Roll: <strong>${rollNumber}</strong>` : "";
  overlay.classList.remove("hidden");
  setTimeout(() => overlay.classList.add("hidden"), 3000);

  // Siri voice feedback
  const speakMessage = success
    ? (rollNumber ? `Attendance marked for ${rollNumber}.` : "Attendance marked successfully.")
    : `Attendance failed. ${message}`;
  speakText(speakMessage);
}

/* ------------------------------------------------------------------ */
/* Faculty auth                                                        */
/* ------------------------------------------------------------------ */
function initAuth() {
  // ── Logout (always present) ───────────────────────────────────────
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await fetch("/api/logout", { method: "POST" });
      window.location.href = "/";   // send back to portal
    });
  }

  // ── Faculty login panel (only exists if not using portal flow) ────
  const loginBtn  = document.getElementById("faculty-login-btn");
  const panel     = document.getElementById("faculty-login-panel");
  const cancelBtn = document.getElementById("faculty-cancel-btn");
  const signinBtn = document.getElementById("faculty-signin-btn");
  const errorEl   = document.getElementById("faculty-login-error");

  if (loginBtn && panel) {
    loginBtn.addEventListener("click", () => {
      panel.classList.toggle("hidden");
      const adminPanel = document.getElementById("admin-login-panel");
      if (adminPanel) adminPanel.classList.add("hidden");
    });
  }
  if (cancelBtn && panel) {
    cancelBtn.addEventListener("click", () => panel.classList.add("hidden"));
  }
  if (signinBtn) {
    signinBtn.addEventListener("click", async () => {
      const email    = document.getElementById("faculty-email")?.value || "";
      const password = document.getElementById("faculty-password")?.value || "";
      const res  = await fetch("/api/faculty-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        if (errorEl) { errorEl.textContent = data.message; errorEl.classList.remove("hidden"); }
        return;
      }
      window.location.reload();
    });
  }

  // ── Admin login panel (only exists if not using portal flow) ──────
  const adminLoginBtn  = document.getElementById("admin-login-btn");
  const adminPanel     = document.getElementById("admin-login-panel");
  const adminCancelBtn = document.getElementById("admin-cancel-btn");
  const adminSigninBtn = document.getElementById("admin-signin-btn");
  const adminErrorEl   = document.getElementById("admin-login-error");

  if (adminLoginBtn && adminPanel) {
    adminLoginBtn.addEventListener("click", () => {
      adminPanel.classList.toggle("hidden");
      if (panel) panel.classList.add("hidden");
    });
  }
  if (adminCancelBtn && adminPanel) {
    adminCancelBtn.addEventListener("click", () => adminPanel.classList.add("hidden"));
  }
  if (adminSigninBtn) {
    adminSigninBtn.addEventListener("click", async () => {
      const email    = document.getElementById("admin-email")?.value || "";
      const password = document.getElementById("admin-password")?.value || "";
      const res  = await fetch("/api/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        if (adminErrorEl) { adminErrorEl.textContent = data.message; adminErrorEl.classList.remove("hidden"); }
        return;
      }
      window.location.reload();
    });
  }
}


/* ------------------------------------------------------------------ */
/* Summary metrics                                                      */
/* ------------------------------------------------------------------ */
async function loadSummary() {
  const res = await fetch("/api/summary");
  const data = await res.json();
  document.getElementById("metric-total").textContent = data.total_records;
  document.getElementById("metric-today").textContent = data.today_count;
  document.getElementById("metric-unique").textContent = data.unique_students;
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                 */
/* ------------------------------------------------------------------ */
function tabDefinitions() {
  if (CFG.userRole === "admin") {
    return [
      { id: "admin-faculty", label: "👨‍🏫 Manage Faculty", render: renderAdminFacultyTab },
      { id: "admin-assign", label: "📚 Assign Faculty", render: renderAdminAssignTab },
      { id: "admin-students", label: "🎓 Student Records", render: renderAdminStudentsTab },
    ];
  }
  if (CFG.userRole === "student") {
    return [
      { id: "attendance", label: "👤 Face & QR Attendance", render: renderAttendanceTab },
      { id: "register-face", label: "👤 Register My Face", render: renderRegisterFaceTab },
      { id: "my-qr", label: "📇 My QR Code", render: renderMyQrTab },
      { id: "student-records", label: "📄 My Daily Record", render: renderStudentRecordsTab },
    ];
  }
  return [
    { id: "attendance", label: "👤 Face & QR Attendance", render: renderAttendanceTab },
    { id: "records", label: "📊 View Records", render: renderRecordsTab },
    { id: "manage", label: "🧑‍🎓 Manage Students & Faces", render: renderManageTab },
    { id: "live-class", label: "📡 Live Class", render: renderLiveClassTab },
  ];

}

function initTabs() {
  const tabs = tabDefinitions();
  const btnWrap = document.getElementById("tab-buttons");
  const panelWrap = document.getElementById("tab-panels");
  btnWrap.innerHTML = "";
  panelWrap.innerHTML = "";

  tabs.forEach((tab, idx) => {
    const btn = document.createElement("button");
    btn.className = "tab-btn" + (idx === 0 ? " active" : "");
    btn.textContent = tab.label;
    btn.addEventListener("click", () => activateTab(tab.id));
    btnWrap.appendChild(btn);

    const panel = document.createElement("div");
    panel.className = "tab-panel" + (idx === 0 ? " active" : "");
    panel.id = `panel-${tab.id}`;
    panelWrap.appendChild(panel);

    tab.render(panel);
  });
}

function activateTab(id) {
  document.querySelectorAll(".tab-btn").forEach((b, i) => {
    const tabs = tabDefinitions();
    b.classList.toggle("active", tabs[i].id === id);
  });
  document.querySelectorAll(".tab-panel").forEach((p) => {
    p.classList.toggle("active", p.id === `panel-${id}`);
  });
}

/* ------------------------------------------------------------------ */
/* Tab: Attendance (subject picker + face/QR/manual)                   */
/* ------------------------------------------------------------------ */
let selectedSubject = CFG.selectedSubject;

function renderAttendanceTab(panel) {
  const selectOptions = Object.entries(CFG.subjectsByYearSem).map(([year, sems]) => {
    return Object.entries(sems).map(([sem, subs]) => {
      const opts = subs.filter(Boolean).map((sub) => {
        const isSelected = sub === selectedSubject ? "selected" : "";
        return `<option value="${sub}" ${isSelected}>${sub}</option>`;
      }).join("");
      return `<optgroup label="${year} - ${sem}">${opts}</optgroup>`;
    }).join("");
  }).join("");

  panel.innerHTML = `
    <h2>👤 Face & QR Scanner Attendance</h2>
    <div class="form-row" style="margin-bottom: 12px;">
      <div style="flex: 1; max-width: 400px;">
        <label style="font-size:.8rem;color:var(--text-secondary);font-weight:600;text-transform:uppercase;letter-spacing:.03em;margin-bottom:4px;display:block">Select Lab Subject</label>
        <select id="attendance-subject-select" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border-light); background: var(--bg-card-2); color: var(--text-primary); font-size: .9rem;">
          <option value="">— Select Subject —</option>
          ${selectOptions}
        </select>
      </div>
    </div>
    
    <div id="faculty-quick-download" class="${CFG.userRole === 'faculty' || CFG.userRole === 'admin' ? '' : 'hidden'}" style="margin-bottom: 20px; padding: 12px; background: var(--bg-card-2); border-radius: 8px; border: 1px solid var(--border-light);">
      <p style="margin: 0 0 10px 0; font-size: 0.9rem; color: var(--text-secondary);">Lab Completed? Download today's attendance for the selected subject:</p>
      <button class="btn btn-secondary" id="quick-download-btn">Download Today's Lab Record</button>
    </div>

    <div class="section-note">Select the correct lab subject first, then use your face or QR Code to verify and mark attendance.</div>
    <hr style="border-color:var(--border-light); margin:16px 0">
    <div class="two-col">
      <div>
        <div class="form-row">
          <label><input type="radio" name="method" value="face" checked> Face Recognition</label>
          <label><input type="radio" name="method" value="qr"> QR Code Scanner</label>
        </div>
        <div id="method-face"></div>
        <div id="method-qr" class="hidden"></div>
      </div>
      <div>
        <h3>Manual Attendance (Faculty Bypass)</h3>
        ${CFG.userRole === "student"
      ? `<input type="text" id="manual-roll" value="${CFG.username}" disabled>`
      : `<input type="text" id="manual-roll" placeholder="Enter Roll Number Manually">`}
        <button class="btn btn-primary btn-block" id="manual-mark-btn" style="margin-top:10px">Submit Manual Entry</button>
        <p id="manual-status" class="status-msg hidden" style="margin-top:10px"></p>
      </div>
    </div>
  `;

  panel.querySelector("#attendance-subject-select").addEventListener("change", async (e) => {
    selectedSubject = e.target.value;
    await fetch("/api/select-subject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: selectedSubject }),
    });
  });

  const quickDownloadBtn = panel.querySelector("#quick-download-btn");
  if (quickDownloadBtn) {
    quickDownloadBtn.addEventListener("click", () => {
      if (!selectedSubject) {
        showPopup(false, "Please select a subject from the dropdown before downloading records.");
        return;
      }
      const today = new Date().toISOString().slice(0, 10);
      window.location.href = `/api/records/download?date=${today}&lab=${encodeURIComponent(selectedSubject)}&scope=filtered`;
    });
  }

  panel.querySelectorAll('input[name="method"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      document.getElementById("method-face").classList.toggle("hidden", e.target.value !== "face");
      document.getElementById("method-qr").classList.toggle("hidden", e.target.value !== "qr");
    });
  });

  renderFaceMethod(panel.querySelector("#method-face"));
  renderQrMethod(panel.querySelector("#method-qr"));

  panel.querySelector("#manual-mark-btn").addEventListener("click", async () => {
    const roll = panel.querySelector("#manual-roll").value.trim();
    const statusEl = panel.querySelector("#manual-status");
    if (!roll) {
      statusEl.textContent = "Please enter a roll number.";
      statusEl.className = "status-msg warning";
      return;
    }
    const res = await fetch("/api/mark-attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roll_number: roll, lab: selectedSubject }),
    });
    const data = await res.json();
    statusEl.textContent = data.message;
    statusEl.className = "status-msg " + (data.success ? "success" : "error");
    statusEl.classList.remove("hidden");
    showPopup(data.success, data.message, data.roll_number);
    loadSummary();
  });
}

function renderFaceMethod(container) {
  if (!CFG.faceRecognitionAvailable) {
    container.innerHTML = `<p class="status-msg warning">⚠️ Face recognition is not available. Please install the 'face_recognition' library or use QR Code mode.</p>`;
    return;
  }
  container.innerHTML = `
    <h3>👤 Secure Face Attendance Scanner</h3>
    <div class="section-note" style="border-left-color:var(--accent-green)">
      <strong>🛡️ Liveness verification:</strong> You'll be asked to complete 2–3 random challenges (blink, open mouth, turn head) to prove you're a real person. The camera will auto-capture your face once verified.
    </div>
    <div class="camera-wrap">
      <video id="face-video" autoplay playsinline></video>
      <canvas id="face-canvas" class="hidden"></canvas>
    </div>
    <button class="btn btn-primary btn-block" id="start-face-cam-btn">📷 Start Camera</button>
    <div id="liveness-zone" class="liveness-container hidden"></div>
    <button class="btn btn-warning btn-block hidden" id="liveness-btn" style="margin-top:8px">🛡️ Start Liveness Verification</button>
    <button class="btn btn-primary btn-block hidden" id="capture-face-btn" style="margin-top:8px">Capture & Verify</button>
    <p id="face-scan-status" class="status-msg hidden" style="margin-top:10px"></p>
  `;

  let stream = null;
  const video = container.querySelector("#face-video");
  const canvas = container.querySelector("#face-canvas");
  const startBtn = container.querySelector("#start-face-cam-btn");
  const livenessBtn = container.querySelector("#liveness-btn");
  const livenessZone = container.querySelector("#liveness-zone");
  const captureBtn = container.querySelector("#capture-face-btn");
  const statusEl = container.querySelector("#face-scan-status");

  startBtn.addEventListener("click", async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
      video.srcObject = stream;
      livenessBtn.classList.remove("hidden");
      startBtn.textContent = "📷 Camera Active";
      startBtn.disabled = true;
    } catch (e) {
      statusEl.textContent = "Unable to access camera: " + e.message;
      statusEl.className = "status-msg error";
      statusEl.classList.remove("hidden");
    }
  });

  // ---------- Challenge pool ----------
  const CHALLENGE_POOL = [
    {
      id: "blink",
      icon: "👁️",
      text: "Please BLINK your eyes",
      hint: "Close your eyes briefly, then open them",
      check: (d, state) => {
        if (d.ear === null || d.ear === undefined) return false;
        if (state.earHistory === undefined) state.earHistory = [];
        if (state.earHistory.length < 5) {
          state.earHistory.push(d.ear);
          return false;
        }
        if (!state.baselineEar) {
          state.baselineEar = Math.max(...state.earHistory);
          if (state.baselineEar < 0.20 || state.baselineEar > 0.45) {
            state.baselineEar = 0.30;
          }
        }
        const closeThreshold = state.baselineEar * 0.70;
        const openThreshold = state.baselineEar * 0.85;
        if (d.ear < closeThreshold) {
          state.eyesClosed = true;
        }
        if (state.eyesClosed && d.ear > openThreshold) {
          state.eyesClosed = false;
          return true;
        }
        return false;
      },
      initState: () => ({ eyesClosed: false, earHistory: [], baselineEar: null }),
    },
    {
      id: "open_mouth",
      icon: "👄",
      text: "Please OPEN your mouth wide",
      hint: "Open your mouth, then close it",
      check: (d, state) => {
        if (d.mar === null) return false;
        if (d.mar > 0.45) state.mouthOpened = true;
        if (state.mouthOpened && d.mar < 0.25) return true;
        return false;
      },
      initState: () => ({ mouthOpened: false }),
    },
    {
      id: "turn_left",
      icon: "⬅️",
      text: "Turn your head LEFT",
      hint: "Slowly turn your head to the left, then back",
      check: (d, state) => {
        if (d.yaw === null) return false;
        if (d.yaw < -8) state.turnedLeft = true;
        if (state.turnedLeft && d.yaw > -3) return true;
        return false;
      },
      initState: () => ({ turnedLeft: false }),
    },
    {
      id: "turn_right",
      icon: "➡️",
      text: "Turn your head RIGHT",
      hint: "Slowly turn your head to the right, then back",
      check: (d, state) => {
        if (d.yaw === null) return false;
        if (d.yaw > 8) state.turnedRight = true;
        if (state.turnedRight && d.yaw > -3 && d.yaw < 3) return true;
        return false;
      },
      initState: () => ({ turnedRight: false }),
    },
  ];

  function pickChallenges() {
    // Only return the blink challenge for liveness verification
    return [CHALLENGE_POOL.find(ch => ch.id === "blink")];
  }

  // ---------- Liveness flow ----------
  let isCheckingLiveness = false;

  livenessBtn.addEventListener("click", async () => {
    if (isCheckingLiveness) return;
    isCheckingLiveness = true;
    livenessBtn.disabled = true;
    livenessBtn.textContent = "🛡️ Verifying…";
    captureBtn.classList.add("hidden");

    const challenges = pickChallenges();
    const results = new Array(challenges.length).fill(null); // null=pending, true=pass, false=fail

    function renderProgress(activeIdx) {
      const steps = challenges.map((ch, i) => {
        let cls = "";
        let icon = ch.icon;
        if (results[i] === true) { cls = "done"; icon = "✅"; }
        else if (results[i] === false) { cls = "failed"; icon = "❌"; }
        else if (i === activeIdx) { cls = "active"; }
        const divider = i < challenges.length - 1 ? `<span class="liveness-step-divider">→</span>` : "";
        return `<span class="liveness-step ${cls}">${icon} ${ch.id.replace("_", " ")}</span>${divider}`;
      }).join("");
      return `<div class="liveness-progress">${steps}</div>`;
    }

    function renderInstruction(ch) {
      return `
        <div class="liveness-instruction">
          <div class="instruction-icon">${ch.icon}</div>
          <div class="instruction-text">${ch.text}</div>
          <div class="instruction-hint">${ch.hint}</div>
        </div>
      `;
    }

    function renderMetrics(data) {
      const ear = data.ear !== null && data.ear !== undefined ? data.ear.toFixed(3) : "–";
      const mar = data.mar !== null && data.mar !== undefined ? data.mar.toFixed(3) : "–";
      const yaw = data.yaw !== null && data.yaw !== undefined ? data.yaw.toFixed(1) + "°" : "–";
      return `
        <div class="liveness-metrics">
          <div class="liveness-metric"><div class="metric-label">EAR (Eyes)</div><div class="metric-val">${ear}</div></div>
          <div class="liveness-metric"><div class="metric-label">MAR (Mouth)</div><div class="metric-val">${mar}</div></div>
          <div class="liveness-metric"><div class="metric-label">Yaw (Head)</div><div class="metric-val">${yaw}</div></div>
        </div>
      `;
    }

    function renderTimer(elapsed, total) {
      const pct = Math.max(0, 100 - (elapsed / total) * 100);
      const remaining = Math.max(0, Math.ceil((total - elapsed) / 1000));
      return `
        <div class="liveness-timer">
          ${remaining}s remaining
          <div class="timer-bar"><div class="timer-fill" style="width:${pct}%"></div></div>
        </div>
      `;
    }

    livenessZone.classList.remove("hidden");
    statusEl.textContent = "Complete each challenge to verify liveness.";
    statusEl.className = "status-msg info";
    statusEl.classList.remove("hidden");

    let allPassed = true;

    for (let ci = 0; ci < challenges.length; ci++) {
      const ch = challenges[ci];
      const state = ch.initState();
      let passed = false;
      const TIMEOUT_MS = 7000;
      const INTERVAL_MS = 200;
      const startTime = Date.now();
      let lastData = { ear: null, mar: null, yaw: null };

      // Update UI for this challenge
      livenessZone.innerHTML = renderProgress(ci) + renderInstruction(ch) + renderMetrics(lastData) + renderTimer(0, TIMEOUT_MS);

      for (let elapsed = 0; elapsed < TIMEOUT_MS; elapsed += INTERVAL_MS) {
        if (!stream) break;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0);

        try {
          const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.7));
          const formData = new FormData();
          formData.append("image", blob, "liveness.jpg");

          const res = await fetch("/api/liveness-check", { method: "POST", body: formData });
          const data = await res.json();

          if (data.success) {
            lastData = data;
            if (ch.check(data, state)) {
              passed = true;
            }
          }
        } catch (e) { console.error(e); }

        const now = Date.now();
        const actualElapsed = now - startTime;
        livenessZone.innerHTML = renderProgress(ci) + renderInstruction(ch) + renderMetrics(lastData) + renderTimer(actualElapsed, TIMEOUT_MS);

        if (passed) break;
        await new Promise(r => setTimeout(r, INTERVAL_MS));
      }

      results[ci] = passed;

      // Brief visual feedback before moving to next challenge
      livenessZone.innerHTML = renderProgress(ci) + (passed
        ? `<div class="liveness-instruction"><div class="instruction-icon">✅</div><div class="instruction-text">Challenge passed!</div></div>`
        : `<div class="liveness-instruction"><div class="instruction-icon">❌</div><div class="instruction-text">Challenge failed — timed out</div></div>`
      );

      if (!passed) {
        allPassed = false;
        break;
      }

      await new Promise(r => setTimeout(r, 600));
    }

    // Final progress
    livenessZone.innerHTML = renderProgress(-1);

    isCheckingLiveness = false;
    livenessBtn.disabled = false;
    livenessBtn.textContent = "🛡️ Start Liveness Verification";

    if (allPassed) {
      // Notify backend to set the session liveness token
      try {
        await fetch("/api/liveness-complete", { method: "POST" });
      } catch (e) { console.error("Failed to set liveness token:", e); }

      statusEl.textContent = "✅ All liveness challenges passed! Auto-capturing face…";
      statusEl.className = "status-msg success";
      livenessBtn.classList.add("hidden");
      captureBtn.classList.remove("hidden");
      // Auto-trigger capture
      setTimeout(() => captureBtn.click(), 700);
    } else {
      statusEl.textContent = "❌ Liveness verification failed. Please try again.";
      statusEl.className = "status-msg error";
    }
  });

  captureBtn.addEventListener("click", async () => {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob(async (blob) => {
      const formData = new FormData();
      formData.append("image", blob, "capture.jpg");
      formData.append("lab", selectedSubject);
      statusEl.textContent = "Verifying face…";
      statusEl.className = "status-msg info";
      statusEl.classList.remove("hidden");

      const res = await fetch("/api/scan-face", { method: "POST", body: formData });
      const data = await res.json();
      statusEl.textContent = data.message;
      statusEl.className = "status-msg " + (data.success ? "success" : "error");
      showPopup(data.success, data.message, data.roll_number);
      loadSummary();

      // Reset liveness UI for next use
      livenessZone.innerHTML = "";
      livenessZone.classList.add("hidden");
      livenessBtn.classList.remove("hidden");
      captureBtn.classList.add("hidden");
    }, "image/jpeg");
  });
}

function renderQrMethod(container) {
  container.innerHTML = `
    <h3>📷 QR Code Scanner</h3>
    <p>Upload a QR code image or capture one with your camera.</p>
    <input type="file" id="qr-file-input" accept="image/png,image/jpeg">
    <p style="text-align:center; color:var(--text-secondary); margin:8px 0">— or —</p>
    <div class="camera-wrap">
      <video id="qr-video" autoplay playsinline></video>
      <canvas id="qr-canvas" class="hidden"></canvas>
    </div>
    <button class="btn btn-secondary btn-block" id="start-qr-cam-btn">Start Camera</button>
    <button class="btn btn-primary btn-block hidden" id="capture-qr-btn" style="margin-top:8px">Capture QR Snapshot</button>
    <p id="qr-scan-status" class="status-msg hidden" style="margin-top:10px"></p>
  `;

  const statusEl = container.querySelector("#qr-scan-status");
  const fileInput = container.querySelector("#qr-file-input");
  const video = container.querySelector("#qr-video");
  const canvas = container.querySelector("#qr-canvas");
  const startBtn = container.querySelector("#start-qr-cam-btn");
  const captureBtn = container.querySelector("#capture-qr-btn");

  async function submitQrBlob(blob) {
    const formData = new FormData();
    formData.append("image", blob, "qr.jpg");
    formData.append("lab", selectedSubject);
    statusEl.textContent = "Decoding QR code…";
    statusEl.className = "status-msg info";
    statusEl.classList.remove("hidden");

    const res = await fetch("/api/scan-qr", { method: "POST", body: formData });
    const data = await res.json();
    statusEl.textContent = data.message;
    statusEl.className = "status-msg " + (data.success ? "success" : "error");
    showPopup(data.success, data.message, data.roll_number);
    loadSummary();
  }

  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) submitQrBlob(fileInput.files[0]);
  });

  startBtn.addEventListener("click", async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      video.srcObject = stream;
      captureBtn.classList.remove("hidden");
      startBtn.disabled = true;
    } catch (e) {
      statusEl.textContent = "Unable to access camera: " + e.message;
      statusEl.className = "status-msg error";
      statusEl.classList.remove("hidden");
    }
  });

  captureBtn.addEventListener("click", () => {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob((blob) => submitQrBlob(blob), "image/jpeg");
  });
}

/* ------------------------------------------------------------------ */
/* Tab: Register My Face (student only)                                */
/* ------------------------------------------------------------------ */
function renderRegisterFaceTab(panel) {
  panel.innerHTML = `
    <h2>👤 Register My Face</h2>
    <p>Capture or upload a photo of your face to register in the student database.</p>
    <label>Confirm Your Roll Number:</label>
    <input type="text" id="reg-roll" value="${CFG.username !== "Student" ? CFG.username : ""}">
    <div class="camera-wrap">
      <video id="reg-video" autoplay playsinline></video>
      <canvas id="reg-canvas" class="hidden"></canvas>
    </div>
    <button class="btn btn-secondary btn-block" id="reg-start-cam-btn">Start Camera</button>
    <button class="btn btn-secondary btn-block hidden" id="reg-capture-btn" style="margin-top:8px">Capture Snapshot</button>
    <p style="text-align:center; color:var(--text-secondary); margin:8px 0">— or —</p>
    <input type="file" id="reg-file-input" accept="image/png,image/jpeg">
    <button class="btn btn-primary btn-block" id="reg-submit-btn" style="margin-top:12px">Register My Face</button>
    <p id="reg-status" class="status-msg hidden" style="margin-top:10px"></p>
  `;

  const video = panel.querySelector("#reg-video");
  const canvas = panel.querySelector("#reg-canvas");
  const startBtn = panel.querySelector("#reg-start-cam-btn");
  const captureBtn = panel.querySelector("#reg-capture-btn");
  const fileInput = panel.querySelector("#reg-file-input");
  const statusEl = panel.querySelector("#reg-status");
  let capturedBlob = null;

  startBtn.addEventListener("click", async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      video.srcObject = stream;
      captureBtn.classList.remove("hidden");
      startBtn.disabled = true;
    } catch (e) {
      statusEl.textContent = "Unable to access camera: " + e.message;
      statusEl.className = "status-msg error";
      statusEl.classList.remove("hidden");
    }
  });

  captureBtn.addEventListener("click", () => {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      capturedBlob = blob;
      statusEl.textContent = "Snapshot captured. Click 'Register My Face' to submit.";
      statusEl.className = "status-msg info";
      statusEl.classList.remove("hidden");
    }, "image/jpeg");
  });

  panel.querySelector("#reg-submit-btn").addEventListener("click", async () => {
    const roll = panel.querySelector("#reg-roll").value.trim();
    const imageBlob = fileInput.files[0] || capturedBlob;

    if (!roll) {
      statusEl.textContent = "Please enter your Roll Number.";
      statusEl.className = "status-msg warning";
      statusEl.classList.remove("hidden");
      return;
    }
    if (CFG.faceRecognitionAvailable && !imageBlob) {
      statusEl.textContent = "Please capture or upload a face picture.";
      statusEl.className = "status-msg warning";
      statusEl.classList.remove("hidden");
      return;
    }

    const formData = new FormData();
    formData.append("roll_number", roll);
    if (imageBlob) formData.append("face_image", imageBlob, "face.jpg");

    const res = await fetch("/api/enroll-student", { method: "POST", body: formData });
    const data = await res.json();
    statusEl.textContent = data.message;
    statusEl.className = "status-msg " + (data.success ? "success" : "error");
    statusEl.classList.remove("hidden");
  });
}

/* ------------------------------------------------------------------ */
/* Tab: My QR Code (student only)                                      */
/* ------------------------------------------------------------------ */
function renderMyQrTab(panel) {
  panel.innerHTML = `
    <h2>📇 Get My QR Code</h2>
    <p>Generate and download your personalized attendance QR Code.</p>
    <input type="text" id="qr-roll-input" placeholder="e.g. U16VH24S0208">
    <button class="btn btn-primary btn-block" id="qr-gen-btn" style="margin-top:10px">Generate My QR Code</button>
    <div id="qr-result" class="qr-preview"></div>
    <hr style="border-color:var(--border); margin:20px 0">
    <h3>How to use Face & QR Code Attendance</h3>
    <ul style="color:var(--text-secondary)">
      <li><strong>Register Face:</strong> Go to the "Register My Face" tab and capture/upload your face photo.</li>
      <li><strong>Generate QR Code:</strong> Download your personalized QR code as a secondary verification option.</li>
      <li><strong>Mark Attendance:</strong> Use either Face Recognition or QR Code Scanner to instantly verify identity.</li>
    </ul>
  `;

  panel.querySelector("#qr-gen-btn").addEventListener("click", () => {
    const roll = panel.querySelector("#qr-roll-input").value.trim();
    const resultEl = panel.querySelector("#qr-result");
    if (!roll) {
      resultEl.innerHTML = `<p class="status-msg warning">Please enter a valid Roll Number.</p>`;
      return;
    }
    resultEl.innerHTML = `
      <img src="/api/qr-code/${encodeURIComponent(roll)}" width="200" alt="QR Code for ${roll}"><br>
      <a class="btn btn-secondary" href="/api/qr-code/${encodeURIComponent(roll)}?download=1" style="margin-top:10px; display:inline-block">Download QR Code</a>
    `;
  });
}

/* ------------------------------------------------------------------ */
/* Tab: Student Records                                                */
/* ------------------------------------------------------------------ */
function renderStudentRecordsTab(panel) {
  const today = new Date().toISOString().slice(0, 10);
  panel.innerHTML = `
    <h2>📄 Daily Attendance Record</h2>
    <div class="section-note">Download attendance records for a specific date or month.</div>
    <div class="form-row">
      <div style="flex: 1;">
        <label>Roll Number (Leave blank for all)</label>
        <input type="text" id="student-record-roll" placeholder="e.g. U16VH24S0208">
      </div>
    </div>
    <div class="form-row">
      <div style="flex: 1;">
        <label>Select Date</label>
        <input type="date" id="student-record-date" value="${today}">
      </div>
      <div style="flex: 1;">
        <label>Filter by Subject</label>
        <select id="student-record-lab">
          <option value="All Subjects">All Subjects</option>
          ${CFG.allSubjects.map((s) => `<option>${s}</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="form-row">
      <button class="btn btn-primary" id="download-student-record-btn" style="margin-top:10px">Download Record (CSV)</button>
    </div>
    <p id="student-record-status" class="status-msg hidden" style="margin-top:10px"></p>
  `;

  panel.querySelector("#download-student-record-btn").addEventListener("click", () => {
    const roll = panel.querySelector("#student-record-roll").value.trim();
    const date = panel.querySelector("#student-record-date").value;
    const lab = panel.querySelector("#student-record-lab").value;
    const statusEl = panel.querySelector("#student-record-status");

    statusEl.classList.add("hidden");

    const url = `/api/admin/student-report/download?roll_number=${encodeURIComponent(roll)}&subject=${encodeURIComponent(lab)}&date=${encodeURIComponent(date)}`;
    window.location.href = url;
  });
}

/* ------------------------------------------------------------------ */
/* Tab: View Records (faculty only)                                    */
/* ------------------------------------------------------------------ */
function renderRecordsTab(panel) {
  const today = new Date().toISOString().slice(0, 10);
  panel.innerHTML = `
    <h2>Attendance Records</h2>
    <div class="section-note">Search and filter attendance entries. Download the current view or remove outdated entries safely.</div>
    <div class="form-row">
      <div><label>Select Date</label><input type="date" id="records-date" value="${today}"></div>
      <div><label>Filter by Subject</label>
        <select id="records-lab-filter">
          <option>All</option>
          ${CFG.allSubjects.map((s) => `<option>${s}</option>`).join("")}
        </select>
      </div>
    </div>
    <div id="records-summary"></div>
    <div class="form-row">
      <a class="btn btn-secondary" id="download-filtered-btn">Download Filtered Records as CSV</a>
    </div>
    <div id="records-by-subject"></div>
    <hr style="border-color:var(--border); margin:20px 0">
    <h3>Delete Records</h3>
    <div class="form-row">
      <button class="btn btn-danger" id="delete-date-btn">Delete all records for selected date</button>
    </div>
    <label><input type="checkbox" id="confirm-delete-all"> I understand this will permanently delete all attendance history.</label>
    <div id="delete-all-controls" class="hidden" style="margin-top:8px">
      <input type="text" id="delete-all-text" placeholder="Type DELETE to confirm">
      <button class="btn btn-danger" id="delete-all-btn" style="margin-top:8px">Delete all attendance history</button>
    </div>
    <p id="records-status" class="status-msg hidden" style="margin-top:10px"></p>
    <hr style="border-color:var(--border); margin:20px 0">
    <details>
      <summary style="cursor:pointer; font-weight:600">📋 View All Records (Historical View)</summary>
      <div class="form-row" style="margin-top:12px">
        <select id="all-records-lab-filter">
          <option>All</option>
          ${CFG.allSubjects.map((s) => `<option>${s}</option>`).join("")}
        </select>
        <a class="btn btn-secondary" id="download-all-btn">Download All Records as CSV</a>
      </div>
      <div id="all-records-container"></div>
    </details>
  `;

  const dateInput = panel.querySelector("#records-date");
  const labFilter = panel.querySelector("#records-lab-filter");
  const statusEl = panel.querySelector("#records-status");

  async function loadRecords() {
    const date = dateInput.value;
    const lab = labFilter.value;
    const res = await fetch(`/api/records?date=${date}&lab=${encodeURIComponent(lab)}`);
    const data = await res.json();

    panel.querySelector("#records-summary").innerHTML = `
      <p>📅 Records for ${data.date} (${data.total_records} total records) — Day: ${data.day_name}, Max allowed per student: ${data.max_allowed}</p>
    `;
    panel.querySelector("#download-filtered-btn").href = `/api/records/download?date=${date}&lab=${encodeURIComponent(lab)}&scope=filtered`;

    const container = panel.querySelector("#records-by-subject");
    const subjects = Object.keys(data.by_subject);
    if (subjects.length === 0) {
      container.innerHTML = `<p class="status-msg info">📭 No attendance records found for ${data.date}.${data.available_dates.length ? " Available dates: " + data.available_dates.join(", ") : ""}</p>`;
      return;
    }

    container.innerHTML = subjects.map((subject) => {
      const rows = data.by_subject[subject].map((r) => `
        <tr>
          <td>${r["Roll Number"]}</td><td>${r["Time"]}</td><td>${r["Lab"]}</td>
          <td><button class="btn btn-danger delete-record-btn" data-roll="${r["Roll Number"]}" data-time="${r["Time"]}" data-lab="${r["Lab"]}">Delete</button></td>
        </tr>`).join("");
      return `
        <div class="record-group">
          <div class="record-group-header">📚 ${subject} (${data.by_subject[subject].length} students)</div>
          <table class="record-table">
            <thead><tr><th>Roll Number</th><th>Time</th><th>Lab</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }).join("");

    container.querySelectorAll(".delete-record-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const res = await fetch("/api/records/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roll_number: btn.dataset.roll, time: btn.dataset.time, lab: btn.dataset.lab }),
        });
        const d = await res.json();
        statusEl.textContent = d.message;
        statusEl.className = "status-msg " + (d.success ? "success" : "error");
        statusEl.classList.remove("hidden");
        loadRecords();
      });
    });
  }

  async function loadAllRecords() {
    const lab = panel.querySelector("#all-records-lab-filter").value;
    const res = await fetch(`/api/records/all?lab=${encodeURIComponent(lab)}`);
    const data = await res.json();
    panel.querySelector("#download-all-btn").href = `/api/records/download?lab=${encodeURIComponent(lab)}&scope=all`;

    const container = panel.querySelector("#all-records-container");
    const dates = Object.keys(data.by_date);
    if (dates.length === 0) {
      container.innerHTML = `<p class="status-msg info">No records found.</p>`;
      return;
    }
    container.innerHTML = dates.map((date) => {
      const rows = data.by_date[date].map((r) => `<tr><td>${r["Roll Number"]}</td><td>${r["Time"]}</td><td>${r["Lab"]}</td></tr>`).join("");
      return `
        <details style="margin-top:10px">
          <summary style="cursor:pointer">📅 ${date} (${data.by_date[date].length} records)</summary>
          <table class="record-table"><thead><tr><th>Roll Number</th><th>Time</th><th>Lab</th></tr></thead><tbody>${rows}</tbody></table>
        </details>`;
    }).join("");
  }

  dateInput.addEventListener("change", loadRecords);
  labFilter.addEventListener("change", loadRecords);
  panel.querySelector("#all-records-lab-filter").addEventListener("change", loadAllRecords);

  panel.querySelector("#delete-date-btn").addEventListener("click", async () => {
    const res = await fetch("/api/records/delete-date", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: dateInput.value }),
    });
    const d = await res.json();
    statusEl.textContent = d.message;
    statusEl.className = "status-msg success";
    statusEl.classList.remove("hidden");
    loadRecords();
    loadSummary();
  });

  panel.querySelector("#confirm-delete-all").addEventListener("change", (e) => {
    panel.querySelector("#delete-all-controls").classList.toggle("hidden", !e.target.checked);
  });

  panel.querySelector("#delete-all-btn").addEventListener("click", async () => {
    const confirmText = panel.querySelector("#delete-all-text").value;
    const res = await fetch("/api/records/delete-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: confirmText }),
    });
    const d = await res.json();
    statusEl.textContent = d.message;
    statusEl.className = "status-msg " + (d.success ? "success" : "error");
    statusEl.classList.remove("hidden");
    if (d.success) {
      loadRecords();
      loadSummary();
    }
  });

  loadRecords();
  loadAllRecords();
}

/* ------------------------------------------------------------------ */
/* Tab: Manage Students & Faces (faculty only)                         */
/* ------------------------------------------------------------------ */
function renderManageTab(panel) {
  panel.innerHTML = `
    <h2>🧑‍🎓 Student Face &amp; QR Registry</h2>
    <div class="section-note">Register new student Roll Numbers along with their face photo, list all registered students, and generate/download their personalized QR codes.</div>

    <h3>Enroll New Student</h3>
    <input type="text" id="enroll-roll" placeholder="Enter Student Roll Number">
    <div class="camera-wrap">
      <video id="enroll-video" autoplay playsinline></video>
      <canvas id="enroll-canvas" class="hidden"></canvas>
    </div>
    <button class="btn btn-secondary btn-block" id="enroll-start-cam-btn">Start Camera</button>
    <button class="btn btn-secondary btn-block hidden" id="enroll-capture-btn" style="margin-top:8px">Capture Snapshot</button>
    <p style="text-align:center; color:var(--text-secondary); margin:8px 0">— or —</p>
    <input type="file" id="enroll-file-input" accept="image/png,image/jpeg">
    <button class="btn btn-primary btn-block" id="enroll-submit-btn" style="margin-top:12px">Register Student &amp; Save Face</button>
    <div id="enroll-qr-result" class="qr-preview"></div>
    <p id="enroll-status" class="status-msg hidden" style="margin-top:10px"></p>

    <hr style="border-color:var(--border); margin:20px 0">
    <h3>Registered Students List</h3>
    <div id="students-list"></div>

    <hr style="border-color:var(--border); margin:20px 0">
    <h3>Generate QR Code from Roll Number</h3>
    <input type="text" id="gen-qr-roll" placeholder="e.g. U16VH24S0208">
    <button class="btn btn-primary" id="gen-qr-btn" style="margin-top:10px">Generate QR Code</button>
    <div id="gen-qr-result" class="qr-preview"></div>
  `;

  const video = panel.querySelector("#enroll-video");
  const canvas = panel.querySelector("#enroll-canvas");
  const startBtn = panel.querySelector("#enroll-start-cam-btn");
  const captureBtn = panel.querySelector("#enroll-capture-btn");
  const fileInput = panel.querySelector("#enroll-file-input");
  const statusEl = panel.querySelector("#enroll-status");
  let capturedBlob = null;

  startBtn.addEventListener("click", async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      video.srcObject = stream;
      captureBtn.classList.remove("hidden");
      startBtn.disabled = true;
    } catch (e) {
      statusEl.textContent = "Unable to access camera: " + e.message;
      statusEl.className = "status-msg error";
      statusEl.classList.remove("hidden");
    }
  });

  captureBtn.addEventListener("click", () => {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      capturedBlob = blob;
      statusEl.textContent = "Snapshot captured.";
      statusEl.className = "status-msg info";
      statusEl.classList.remove("hidden");
    }, "image/jpeg");
  });

  panel.querySelector("#enroll-submit-btn").addEventListener("click", async () => {
    const roll = panel.querySelector("#enroll-roll").value.trim();
    const imageBlob = fileInput.files[0] || capturedBlob;

    if (!roll) {
      statusEl.textContent = "Please enter a valid Roll Number.";
      statusEl.className = "status-msg warning";
      statusEl.classList.remove("hidden");
      return;
    }
    if (CFG.faceRecognitionAvailable && !imageBlob) {
      statusEl.textContent = "Please capture or upload a face photo for the student.";
      statusEl.className = "status-msg warning";
      statusEl.classList.remove("hidden");
      return;
    }

    const formData = new FormData();
    formData.append("roll_number", roll);
    if (imageBlob) formData.append("face_image", imageBlob, "face.jpg");

    const res = await fetch("/api/enroll-student", { method: "POST", body: formData });
    const data = await res.json();
    statusEl.textContent = data.message;
    statusEl.className = "status-msg " + (data.success ? "success" : "error");
    statusEl.classList.remove("hidden");

    if (data.success) {
      panel.querySelector("#enroll-qr-result").innerHTML = `
        <img src="/api/qr-code/${encodeURIComponent(data.roll_number)}" width="200" alt="QR Code"><br>
        <a class="btn btn-secondary" href="/api/qr-code/${encodeURIComponent(data.roll_number)}?download=1" style="margin-top:10px; display:inline-block">Download QR Code</a>
      `;
      loadStudentsList();
    }
  });

  async function loadStudentsList() {
    const res = await fetch("/api/students");
    const data = await res.json();
    const container = panel.querySelector("#students-list");
    if (data.students.length === 0) {
      container.innerHTML = `<p class="status-msg info">No students registered yet. Enroll a student above to get started!</p>`;
      return;
    }
    const rows = data.students.map((s) => `
      <tr>
        <td>${s.roll_number}</td>
        <td>${s.registration_date}</td>
        <td>${s.face_registered ? "🟢 Registered" : "🔴 Missing"}</td>
        <td><a href="/api/qr-code/${encodeURIComponent(s.roll_number)}?download=1">Download QR</a></td>
      </tr>`).join("");
    container.innerHTML = `
      <p>Total registered students: <strong>${data.students.length}</strong></p>
      <table class="record-table">
        <thead><tr><th>Roll Number</th><th>Registration Date</th><th>Face Registered</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  panel.querySelector("#gen-qr-btn").addEventListener("click", () => {
    const roll = panel.querySelector("#gen-qr-roll").value.trim();
    const resultEl = panel.querySelector("#gen-qr-result");
    if (!roll) {
      resultEl.innerHTML = `<p class="status-msg warning">Please enter a roll number to generate a QR code.</p>`;
      return;
    }
    resultEl.innerHTML = `
      <img src="/api/qr-code/${encodeURIComponent(roll)}" width="240" alt="QR Code for ${roll}"><br>
      <a class="btn btn-secondary" href="/api/qr-code/${encodeURIComponent(roll)}?download=1" style="margin-top:10px; display:inline-block">Download Generated QR Code</a>
    `;
  });

  loadStudentsList();
}

/* ------------------------------------------------------------------ */
/* Tab: Admin — Manage Faculty                                         */
/* ------------------------------------------------------------------ */
function renderAdminFacultyTab(panel) {
  panel.innerHTML = `
    <h2>👨‍🏫 Manage Faculty</h2>
    <div class="section-note" style="border-left-color: var(--accent-purple)">
      Add, view, and remove faculty members. Deleting a faculty also removes all their class assignments.
    </div>

    <div class="admin-form-card">
      <h3>➕ Add New Faculty</h3>
      <div class="form-row">
        <input type="text" id="fac-name" placeholder="Faculty Full Name">
        <input type="email" id="fac-email" placeholder="faculty@college.edu">
      </div>
      <div class="form-row">
        <input type="text" id="fac-dept" placeholder="Department (e.g. Computer Science)">
        <button class="btn btn-admin" id="fac-add-btn">➕ Add Faculty</button>
      </div>
      <p id="fac-status" class="status-msg hidden" style="margin-top:10px"></p>
    </div>

    <hr class="admin-divider">
    <h3>📋 Registered Faculty</h3>
    <div id="faculty-list-container"></div>
  `;

  const statusEl = panel.querySelector("#fac-status");

  panel.querySelector("#fac-add-btn").addEventListener("click", async () => {
    const name = panel.querySelector("#fac-name").value.trim();
    const email = panel.querySelector("#fac-email").value.trim();
    const department = panel.querySelector("#fac-dept").value.trim();

    if (!name || !email) {
      statusEl.textContent = "Name and Email are required.";
      statusEl.className = "status-msg warning";
      statusEl.classList.remove("hidden");
      return;
    }

    const res = await fetch("/api/admin/faculty", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, department }),
    });
    const data = await res.json();
    statusEl.textContent = data.message;
    statusEl.className = "status-msg " + (data.success ? "success" : "error");
    statusEl.classList.remove("hidden");

    if (data.success) {
      panel.querySelector("#fac-name").value = "";
      panel.querySelector("#fac-email").value = "";
      panel.querySelector("#fac-dept").value = "";
      loadFacultyList();
    }
  });

  async function loadFacultyList() {
    const res = await fetch("/api/admin/faculty");
    const data = await res.json();
    const container = panel.querySelector("#faculty-list-container");

    if (data.faculty.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">👨‍🏫</div>
          <div class="empty-text">No faculty registered yet. Add one above to get started!</div>
        </div>`;
      return;
    }

    container.innerHTML = data.faculty.map(f => `
      <div class="faculty-card">
        <div class="faculty-info">
          <div class="faculty-name">${f.name}</div>
          <div class="faculty-email">📧 ${f.email}</div>
          <div class="faculty-dept">🏛️ ${f.department || 'No department'}</div>
        </div>
        <button class="btn btn-danger btn-sm" data-id="${f.id}" title="Delete faculty">🗑️ Remove</button>
      </div>
    `).join("");

    container.querySelectorAll(".btn-danger").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Are you sure you want to delete this faculty and their assignments?")) return;
        const res = await fetch(`/api/admin/faculty/${btn.dataset.id}/delete`, { method: "POST" });
        const d = await res.json();
        statusEl.textContent = d.message;
        statusEl.className = "status-msg " + (d.success ? "success" : "error");
        statusEl.classList.remove("hidden");
        loadFacultyList();
      });
    });
  }

  loadFacultyList();
}

/* ------------------------------------------------------------------ */
/* Tab: Admin — Assign Faculty to Class                                */
/* ------------------------------------------------------------------ */
function renderAdminAssignTab(panel) {
  const yearOptions = Object.keys(CFG.subjectsByYearSem).map(y => `<option value="${y}">${y}</option>`).join("");

  panel.innerHTML = `
    <h2>📚 Assign Faculty to Class</h2>
    <div class="section-note" style="border-left-color: var(--accent-purple)">
      Map faculty members to specific Year → Semester → Subject combinations. Each subject can only have one assigned faculty.
    </div>

    <div class="admin-form-card">
      <h3>🔗 Create Assignment</h3>
      <div class="form-row">
        <div>
          <label style="font-size:.8rem;color:var(--text-secondary);font-weight:600;text-transform:uppercase;letter-spacing:.03em;margin-bottom:4px;display:block">Faculty</label>
          <select id="assign-faculty"><option value="">— Select Faculty —</option></select>
        </div>
        <div>
          <label style="font-size:.8rem;color:var(--text-secondary);font-weight:600;text-transform:uppercase;letter-spacing:.03em;margin-bottom:4px;display:block">Year</label>
          <select id="assign-year"><option value="">— Select Year —</option>${yearOptions}</select>
        </div>
      </div>
      <div class="form-row">
        <div>
          <label style="font-size:.8rem;color:var(--text-secondary);font-weight:600;text-transform:uppercase;letter-spacing:.03em;margin-bottom:4px;display:block">Semester</label>
          <select id="assign-sem"><option value="">— Select Semester —</option></select>
        </div>
        <div>
          <label style="font-size:.8rem;color:var(--text-secondary);font-weight:600;text-transform:uppercase;letter-spacing:.03em;margin-bottom:4px;display:block">Subject</label>
          <select id="assign-subject"><option value="">— Select Subject —</option></select>
        </div>
      </div>
      <button class="btn btn-admin" id="assign-btn" style="margin-top:8px">📌 Assign Faculty</button>
      <p id="assign-status" class="status-msg hidden" style="margin-top:10px"></p>
    </div>

    <hr class="admin-divider">
    <h3>📋 Current Assignments</h3>
    <div id="assignments-container"></div>
  `;

  const yearSelect = panel.querySelector("#assign-year");
  const semSelect = panel.querySelector("#assign-sem");
  const subjectSelect = panel.querySelector("#assign-subject");
  const facultySelect = panel.querySelector("#assign-faculty");
  const statusEl = panel.querySelector("#assign-status");

  // Populate semesters when year changes
  yearSelect.addEventListener("change", () => {
    const year = yearSelect.value;
    semSelect.innerHTML = '<option value="">— Select Semester —</option>';
    subjectSelect.innerHTML = '<option value="">— Select Subject —</option>';
    if (year && CFG.subjectsByYearSem[year]) {
      Object.keys(CFG.subjectsByYearSem[year]).forEach(sem => {
        semSelect.innerHTML += `<option value="${sem}">${sem}</option>`;
      });
    }
  });

  // Populate subjects when semester changes
  semSelect.addEventListener("change", () => {
    const year = yearSelect.value;
    const sem = semSelect.value;
    subjectSelect.innerHTML = '<option value="">— Select Subject —</option>';
    if (year && sem && CFG.subjectsByYearSem[year] && CFG.subjectsByYearSem[year][sem]) {
      CFG.subjectsByYearSem[year][sem].forEach(sub => {
        subjectSelect.innerHTML += `<option value="${sub}">${sub}</option>`;
      });
    }
  });

  // Load faculty for dropdown
  async function loadFacultyDropdown() {
    const res = await fetch("/api/admin/faculty");
    const data = await res.json();
    facultySelect.innerHTML = '<option value="">— Select Faculty —</option>';
    data.faculty.forEach(f => {
      facultySelect.innerHTML += `<option value="${f.id}">${f.name} (${f.department || 'N/A'})</option>`;
    });
  }

  // Assign button
  panel.querySelector("#assign-btn").addEventListener("click", async () => {
    const faculty_id = facultySelect.value;
    const year = yearSelect.value;
    const semester = semSelect.value;
    const subject = subjectSelect.value;

    if (!faculty_id || !year || !semester || !subject) {
      statusEl.textContent = "Please select all fields.";
      statusEl.className = "status-msg warning";
      statusEl.classList.remove("hidden");
      return;
    }

    const res = await fetch("/api/admin/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faculty_id, year, semester, subject }),
    });
    const data = await res.json();
    statusEl.textContent = data.message;
    statusEl.className = "status-msg " + (data.success ? "success" : "error");
    statusEl.classList.remove("hidden");
    if (data.success) loadAssignments();
  });

  async function loadAssignments() {
    const res = await fetch("/api/admin/assignments");
    const data = await res.json();
    const container = panel.querySelector("#assignments-container");

    if (data.assignments.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📚</div>
          <div class="empty-text">No assignments yet. Assign a faculty to a class above.</div>
        </div>`;
      return;
    }

    container.innerHTML = data.assignments.map(a => `
      <div class="assignment-card">
        <div class="assignment-info">
          <div class="assignment-faculty">👨‍🏫 ${a.faculty_name}</div>
          <div class="assignment-detail">📅 ${a.year} → ${a.semester}</div>
          <span class="assignment-subject">${a.subject}</span>
        </div>
        <button class="btn btn-danger" data-id="${a.id}" title="Remove assignment">✖️ Remove</button>
      </div>
    `).join("");

    container.querySelectorAll(".btn-danger").forEach(btn => {
      btn.addEventListener("click", async () => {
        const res = await fetch(`/api/admin/assignments/${btn.dataset.id}/delete`, { method: "POST" });
        const d = await res.json();
        statusEl.textContent = d.message;
        statusEl.className = "status-msg " + (d.success ? "success" : "error");
        statusEl.classList.remove("hidden");
        loadAssignments();
      });
    });
  }

  loadFacultyDropdown();
  loadAssignments();
}

/* ------------------------------------------------------------------ */
/* Tab: Admin — Student Records by Year & Semester                     */
/* ------------------------------------------------------------------ */
function renderAdminStudentsTab(panel) {
  const yearOptions = Object.keys(CFG.subjectsByYearSem).map(y => `<option value="${y}">${y}</option>`).join("");

  panel.innerHTML = `
    <h2>🎓 Student Attendance Records</h2>
    <div class="section-note" style="border-left-color: var(--accent-purple)">
      View all student attendance records filtered by academic year and semester.
    </div>

    <div class="filter-bar">
      <div>
        <label>Year</label>
        <select id="admin-filter-year">
          <option value="">All Years</option>
          ${yearOptions}
        </select>
      </div>
      <div>
        <label>Semester</label>
        <select id="admin-filter-sem">
          <option value="">All Semesters</option>
        </select>
      </div>
      <div>
        <button class="btn btn-admin btn-block" id="admin-filter-btn" style="margin-top:18px">🔍 Load Records</button>
      </div>
      <div>
        <a class="btn btn-secondary btn-block" id="admin-download-btn" style="margin-top:18px;text-align:center;text-decoration:none" href="#">📥 Download CSV</a>
      </div>
    </div>

    <hr class="admin-divider">
    <h3>📥 Download Specific Student Report</h3>
    <div class="filter-bar">
      <div>
        <label>Roll Number</label>
        <input type="text" id="admin-report-roll" placeholder="e.g. U16VH24S0208">
      </div>
      <div>
        <label>Subject</label>
        <select id="admin-report-subject">
          <option value="">All Subjects</option>
          ${CFG.allSubjects.map(s => `<option value="${s}">${s}</option>`).join("")}
        </select>
      </div>
      <div>
        <label>Month (YYYY-MM)</label>
        <input type="month" id="admin-report-month">
      </div>
      <div>
        <button class="btn btn-admin btn-block" id="admin-report-download-btn" style="margin-top:18px">Download Report</button>
      </div>
    </div>
    <p id="admin-report-status" class="status-msg hidden" style="margin-top:10px"></p>
    <hr class="admin-divider">

    <div id="admin-records-stats" class="admin-stats"></div>
    <div id="admin-records-container"></div>
  `;

  const yearSelect = panel.querySelector("#admin-filter-year");
  const semSelect = panel.querySelector("#admin-filter-sem");

  yearSelect.addEventListener("change", () => {
    const year = yearSelect.value;
    semSelect.innerHTML = '<option value="">All Semesters</option>';
    if (year && CFG.subjectsByYearSem[year]) {
      Object.keys(CFG.subjectsByYearSem[year]).forEach(sem => {
        semSelect.innerHTML += `<option value="${sem}">${sem}</option>`;
      });
    }
  });

  async function loadAdminRecords() {
    const year = yearSelect.value;
    const semester = semSelect.value;
    const res = await fetch(`/api/admin/students?year=${encodeURIComponent(year)}&semester=${encodeURIComponent(semester)}`);
    const data = await res.json();

    // Update download link
    panel.querySelector("#admin-download-btn").href = `/api/admin/students/download?year=${encodeURIComponent(year)}&semester=${encodeURIComponent(semester)}`;

    // Stats
    const statsContainer = panel.querySelector("#admin-records-stats");
    statsContainer.innerHTML = `
      <div class="admin-stat">
        <div class="stat-value">${data.total || 0}</div>
        <div class="stat-label">Total Records</div>
      </div>
      <div class="admin-stat">
        <div class="stat-value">${data.unique_students || 0}</div>
        <div class="stat-label">Unique Students</div>
      </div>
      <div class="admin-stat">
        <div class="stat-value">${Object.keys(data.records || {}).length}</div>
        <div class="stat-label">Subjects</div>
      </div>
    `;

    // Records
    const container = panel.querySelector("#admin-records-container");
    const subjects = Object.keys(data.records || {});

    if (subjects.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📭</div>
          <div class="empty-text">No attendance records found for the selected filter.</div>
        </div>`;
      return;
    }

    container.innerHTML = subjects.map(subject => {
      const records = data.records[subject];
      const rows = records.map(r => `
        <tr>
          <td>${r["Roll Number"]}</td>
          <td>${r["Date"]}</td>
          <td>${r["Time"]}</td>
          <td>${r["Lab"]}</td>
        </tr>`).join("");
      return `
        <div class="record-group">
          <div class="record-group-header">📚 ${subject} (${records.length} records)</div>
          <table class="record-table">
            <thead><tr><th>Roll Number</th><th>Date</th><th>Time</th><th>Subject</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }).join("");
  }

  panel.querySelector("#admin-filter-btn").addEventListener("click", loadAdminRecords);
  semSelect.addEventListener("change", loadAdminRecords);

  panel.querySelector("#admin-report-download-btn").addEventListener("click", () => {
    const roll = panel.querySelector("#admin-report-roll").value.trim();
    const subject = panel.querySelector("#admin-report-subject").value;
    const month = panel.querySelector("#admin-report-month").value;
    const statusEl = panel.querySelector("#admin-report-status");

    if (!roll) {
      statusEl.textContent = "Please enter a Roll Number.";
      statusEl.className = "status-msg warning";
      statusEl.classList.remove("hidden");
      return;
    }
    statusEl.classList.add("hidden");

    const url = `/api/admin/student-report/download?roll_number=${encodeURIComponent(roll)}&subject=${encodeURIComponent(subject)}&month=${encodeURIComponent(month)}`;
    window.location.href = url;
  });

  // Initial load
  loadAdminRecords();
}

/* ------------------------------------------------------------------ */
/* Tab: Live Class (Faculty)                                            */
/* ------------------------------------------------------------------ */
function renderLiveClassTab(panel) {
  const subjectsByYearSem = CFG.subjectsByYearSem || {};

  panel.innerHTML = `
    <div class="section-note" style="border-left-color:#a78bfa">
      📡 <strong>Live Class Session</strong> — Open a session so students can mark attendance from their dashboard in real time.
    </div>

    <!-- Open Session Form -->
    <div class="card" style="margin-top:18px">
      <h3 style="margin-bottom:14px">➕ Open a New Session</h3>
      <div class="form-row" style="flex-wrap:wrap;gap:10px">
        <select id="lc-year" style="flex:1;min-width:130px">
          <option value="">-- Year --</option>
          ${Object.keys(subjectsByYearSem).map(y => `<option value="${y}">${y}</option>`).join("")}
        </select>
        <select id="lc-sem" style="flex:1;min-width:130px" disabled>
          <option value="">-- Semester --</option>
        </select>
        <select id="lc-subject" style="flex:1;min-width:160px" disabled>
          <option value="">-- Subject --</option>
        </select>
        <button id="lc-open-btn" class="btn btn-primary" disabled style="white-space:nowrap">
          📡 Open Session
        </button>
      </div>
      <p id="lc-open-msg" class="status-msg hidden" style="margin-top:10px"></p>
    </div>

    <!-- Active Sessions -->
    <div class="card" style="margin-top:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <h3>🟢 Active Sessions</h3>
        <button id="lc-refresh-btn" class="btn btn-secondary" style="padding:6px 14px;font-size:0.82rem">🔄 Refresh</button>
      </div>
      <div id="lc-active-list"><p class="status-msg info">Loading…</p></div>
    </div>

    <!-- Today's Session History -->
    <div class="card" style="margin-top:16px">
      <h3 style="margin-bottom:14px">📋 Today's Session History</h3>
      <div id="lc-history-list"><p class="status-msg info">Loading…</p></div>
    </div>
  `;

  // ── Dropdown cascade ──────────────────────────────────────────────
  const yearSel    = panel.querySelector("#lc-year");
  const semSel     = panel.querySelector("#lc-sem");
  const subjectSel = panel.querySelector("#lc-subject");
  const openBtn    = panel.querySelector("#lc-open-btn");
  const openMsg    = panel.querySelector("#lc-open-msg");

  yearSel.addEventListener("change", () => {
    const year = yearSel.value;
    semSel.innerHTML = '<option value="">-- Semester --</option>';
    subjectSel.innerHTML = '<option value="">-- Subject --</option>';
    semSel.disabled = !year;
    subjectSel.disabled = true;
    openBtn.disabled = true;
    if (!year) return;
    Object.keys(subjectsByYearSem[year] || {}).forEach(sem => {
      semSel.add(new Option(sem, sem));
    });
  });

  semSel.addEventListener("change", () => {
    const year = yearSel.value;
    const sem  = semSel.value;
    subjectSel.innerHTML = '<option value="">-- Subject --</option>';
    subjectSel.disabled = !sem;
    openBtn.disabled = true;
    if (!sem) return;
    (subjectsByYearSem[year][sem] || []).forEach(s => subjectSel.add(new Option(s, s)));
  });

  subjectSel.addEventListener("change", () => {
    openBtn.disabled = !subjectSel.value;
  });

  // ── Open session ──────────────────────────────────────────────────
  openBtn.addEventListener("click", async () => {
    const subject  = subjectSel.value;
    const year     = yearSel.value;
    const semester = semSel.value;
    if (!subject) return;

    openBtn.disabled = true;
    openMsg.className = "status-msg info";
    openMsg.textContent = "Opening session…";
    openMsg.classList.remove("hidden");

    try {
      const res  = await fetch("/api/faculty/sessions/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, year, semester }),
      });
      const data = await res.json();
      openMsg.className = data.success ? "status-msg success" : "status-msg error";
      openMsg.textContent = data.message;
      if (data.success) {
        // reset form
        yearSel.value = ""; semSel.innerHTML = '<option value="">-- Semester --</option>';
        subjectSel.innerHTML = '<option value="">-- Subject --</option>';
        semSel.disabled = true; subjectSel.disabled = true;
      }
      loadSessions();
    } catch (e) {
      openMsg.className = "status-msg error";
      openMsg.textContent = "Network error. Please try again.";
    }
    openBtn.disabled = false;
  });

  // ── Load sessions ─────────────────────────────────────────────────
  async function loadSessions() {
    try {
      const res  = await fetch("/api/faculty/sessions");
      const data = await res.json();
      if (!data.success) return;

      const active  = data.sessions.filter(s => s.is_active);
      const history = data.sessions.filter(s => !s.is_active);

      renderActive(active);
      renderHistory(history);
    } catch (e) { /* silent */ }
  }

  function renderActive(sessions) {
    const el = panel.querySelector("#lc-active-list");
    if (!sessions.length) {
      el.innerHTML = `<p class="status-msg" style="color:#6b7280">No active sessions right now. Open one above.</p>`;
      return;
    }
    el.innerHTML = sessions.map(s => `
      <div class="live-session-card" id="lcs-${s.id}" style="
        display:flex;align-items:center;justify-content:space-between;
        background:rgba(167,139,250,0.08);
        border:1px solid rgba(167,139,250,0.3);
        border-radius:12px;padding:14px 18px;margin-bottom:10px;flex-wrap:wrap;gap:12px
      ">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:10px;height:10px;border-radius:50%;background:#4ade80;
            box-shadow:0 0 8px #4ade80;animation:livePulse 1.5s ease-in-out infinite"></div>
          <div>
            <div style="font-weight:700;font-size:1rem">${s.subject}</div>
            <div style="font-size:0.78rem;color:#9ca3af">${s.year} ${s.semester} • Opened: ${s.opened_at} •
              <span style="color:#4ade80">${s.attendance_count} student${s.attendance_count!==1?'s':''} marked</span>
            </div>
          </div>
        </div>
        <button class="btn btn-secondary lc-close-btn" data-id="${s.id}" data-subject="${s.subject}"
          style="border-color:#f87171;color:#f87171;padding:7px 16px;font-size:0.82rem">
          ⏹ Close Session
        </button>
      </div>
    `).join("");

    // Attach close handlers
    el.querySelectorAll(".lc-close-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id  = btn.dataset.id;
        const sub = btn.dataset.subject;
        if (!confirm(`Close live session for "${sub}"?`)) return;
        btn.disabled = true;
        btn.textContent = "Closing…";
        const res  = await fetch(`/api/faculty/sessions/${id}/close`, { method: "POST" });
        const data = await res.json();
        if (data.success) {
          openMsg.className = "status-msg success";
          openMsg.textContent = `✅ Session closed. ${data.attendance_count} attendance record(s) for ${data.subject}.`;
          openMsg.classList.remove("hidden");
        }
        loadSessions();
      });
    });
  }

  function renderHistory(sessions) {
    const el = panel.querySelector("#lc-history-list");
    if (!sessions.length) {
      el.innerHTML = `<p style="color:#6b7280;font-size:0.85rem">No closed sessions today yet.</p>`;
      return;
    }
    el.innerHTML = `<table class="records-table"><thead><tr>
      <th>Subject</th><th>Year / Sem</th><th>Opened</th><th>Closed</th><th>Students</th>
    </tr></thead><tbody>
      ${sessions.map(s => `<tr>
        <td><strong>${s.subject}</strong></td>
        <td>${s.year} ${s.semester}</td>
        <td>${s.opened_at}</td>
        <td>${s.closed_at || "–"}</td>
        <td><span style="color:#4ade80;font-weight:700">${s.attendance_count}</span></td>
      </tr>`).join("")}
    </tbody></table>`;
  }

  panel.querySelector("#lc-refresh-btn").addEventListener("click", loadSessions);

  // Auto-refresh every 15 seconds while tab is visible
  const autoRefresh = setInterval(() => {
    if (document.getElementById("panel-live-class") &&
        document.getElementById("panel-live-class").classList.contains("active")) {
      loadSessions();
    }
  }, 15000);

  loadSessions();
}

/* ------------------------------------------------------------------ */
/* Boot                                                                 */
/* ------------------------------------------------------------------ */
function initApp() {
  initAuth();
  loadSummary();
  initTabs();
}

document.addEventListener("DOMContentLoaded", initLocationGate);

