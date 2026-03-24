/**
 * styles-manager.ts
 *
 * Manages application styles selections and persistence.
 */
(function (): void {
  // --- Persistent State ------------------------------------------------------
  const savedShadow = localStorage.getItem("ember_styles_shadow_enabled");
  let isShadowEnabled = savedShadow !== null ? savedShadow === "true" : true;

  function saveStylesToDisk(): void {
    localStorage.setItem("ember_styles_shadow_enabled", isShadowEnabled.toString());
  }

  // --- Helper: Applies classes based on current state -------------------------
  function applyShadows(): void {
    const targets = [".dm-main-area", ".channel-list", ".messages-container"];
    targets.forEach(selector => {
      const el = document.querySelector(selector);
      if (el) {
        if (isShadowEnabled) el.classList.add("inset-shadow-active");
        else el.classList.remove("inset-shadow-active");
      }
    });
  }

  // --- Initialization --------------------------------------------------------
  function initStylesSettings(): void {
    applyShadows(); // <--- APPLY ON STARTUP
    renderStyleControls();
  }

  // --- UI Rendering ----------------------------------------------------------
  function renderStyleControls(): void {
    const container = document.getElementById("styles-settings-container");
    if (!container) return;
    container.replaceChildren();

    // ─── Corner Rounding Slider  ───
    /*const radiusRow = document.createElement("div");
    radiusRow.className = "theme-color-row";
    radiusRow.style.display = "flex";
    radiusRow.style.justifyContent = "space-between";
    radiusRow.style.alignItems = "center";
    radiusRow.innerHTML = `
      <label class="vv-label">Corner Rounding</label>
      <div style="display: flex; align-items: center; gap: 10px;">
        <input type="range" id="style-radius-slider" min="0" max="24" value="8" style="cursor: pointer;">
        <span id="style-radius-value" style="width: 35px; font-family: monospace; opacity: 0.7;">8px</span>
      </div>
    `;
    container.appendChild(radiusRow);

    const slider = radiusRow.querySelector("#style-radius-slider") as HTMLInputElement;
    const label = radiusRow.querySelector("#style-radius-value");

    slider?.addEventListener("input", (e) => {
      const val = (e.target as HTMLInputElement).value;
      if (label) label.textContent = `${val}px`;
      document.documentElement.style.setProperty('--main-radius', `${val}px`);
      const paddingVal = Math.floor(parseInt(val) / 2); 
      document.documentElement.style.setProperty('--main-padding', `${paddingVal}px`);
    }); */

    // ─── Style Preset Dropdown ───
    const styleRow = document.createElement("div");
    styleRow.className = "theme-color-row"; // Changed from "Styles" to match your other rows
    styleRow.style.display = "flex";
    styleRow.style.justifyContent = "space-between";
    styleRow.style.alignItems = "center";
    styleRow.style.marginTop = "10px";

    styleRow.innerHTML = `
      <label class="vv-label">UI Style</label>
      <select id="ui-style-select" style="cursor: pointer; padding: 4px; border-radius: 4px;">
        <option value="default">Default</option>
        <option value="modern">Modern</option>
      </select>
    `

;
    container.appendChild(styleRow);

    const styleSelect = styleRow.querySelector("#ui-style-select") as HTMLSelectElement;


    // ─── Inset Shadow Checkbox ───
    const shadowRow = document.createElement("div");
    shadowRow.className = "theme-color-row";
    shadowRow.style.display = "flex";
    shadowRow.style.justifyContent = "space-between";
    shadowRow.style.alignItems = "center";
    shadowRow.style.marginTop = "10px";
    shadowRow.innerHTML = `
      <label class="vv-label">Deep Inset Shadows</label>
      <input type="checkbox" id="style-shadow-check" style="width: 20px; height: 20px; cursor: pointer;">
    `;
    container.appendChild(shadowRow);

    const shadowCheck = shadowRow.querySelector("#style-shadow-check") as HTMLInputElement;

    if (shadowCheck) {
      shadowCheck.checked = isShadowEnabled;
      shadowCheck.addEventListener("change", (e) => {
        isShadowEnabled = (e.target as HTMLInputElement).checked;
        saveStylesToDisk();
        applyShadows(); 
      });
    }
    

    // Save Style
    styleSelect.addEventListener("change", () => {
        const selected = styleSelect.value;
        console.log("Dropdown changed to:", selected);
        
        applyUIStyle(selected);
        localStorage.setItem("ember_ui_style_pref", selected);
    });

    // ─── Sync Dropdown State on Render ───
    const saved = localStorage.getItem("ember_ui_style_pref") || "modern";
    styleSelect.value = saved;
    applyUIStyle(saved); // Apply it immediately in case the page refreshed
  }
  

// Load Style
  (window as any).initUIStyleState = function(): void {
      const savedStyle = localStorage.getItem("ember_ui_style_pref") || "modern";
      console.log("Global initUIStyleState loading:", savedStyle);
      applyUIStyle(savedStyle);
      
      const styleSelect = document.getElementById("ui-style-select") as HTMLSelectElement;
      if (styleSelect) styleSelect.value = savedStyle;
  };
// Apply Style 
function applyUIStyle(styleName: string): void {
    // We target 'body' because it's always available immediately at startup
    const body = document.body;

    if (styleName === "modern") {
        body.classList.add("modern-ui");
    } else {
        body.classList.remove("modern-ui");
    }

    console.log(`[Ember] UI Style set to: ${styleName}`);
}








  /*

  //  Load initial state
const savedMemberList = localStorage.getItem("ember_styles_memberlist_hidden");
let isMemberListHidden = savedMemberList === "true";


  // Hide members list
// Helper to apply the visual change
function applyMemberListState(): void {
  const memberList = document.querySelector(".member-list") as HTMLElement;
  const btn = document.getElementById("toggle-members-btn");

  if (memberList) {
    if (isMemberListHidden) {
      memberList.classList.add("hidden-sidebar");
      btn?.classList.add("inactive");
    } else {
      memberList.classList.remove("hidden-sidebar");
      btn?.classList.remove("inactive");
    }
  }
}

// Delegation Listener (This handles the "Dynamic" button)
document.addEventListener("mousedown", (e) => {
  const target = e.target as HTMLElement;
  console.log("Mouse down on:", target.className, target.id);

  const toggleBtn = target.closest("#toggle-members-btn");

  if (toggleBtn) {
    e.preventDefault();
    console.log("!!! TOGGLE BUTTON FOUND !!!");
    
    isMemberListHidden = !isMemberListHidden;
    localStorage.setItem("ember_styles_memberlist_hidden", isMemberListHidden.toString());
    
    const memberList = document.querySelector(".member-list");
    if (memberList) {
        memberList.classList.toggle("hidden-sidebar");
        console.log("Member list hidden state:", memberList.classList.contains("hidden-sidebar"));
    }
  }
}, true); 
 */




  applyShadows();
/*  applyMemberListState(); */



  (window as any).initStylesSettings = initStylesSettings;
})();



