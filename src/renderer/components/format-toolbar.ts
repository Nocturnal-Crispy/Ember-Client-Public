/**
 * format-toolbar.ts — Floating markdown formatting toolbar.
 *
 * Appears above a `.message-input` textarea whenever text is selected.
 * Buttons wrap the selection with markdown syntax: Bold, Italic,
 * Strikethrough, Blockquote, Code, Spoiler.
 *
 * No exports — exposes nothing to global scope. Self-contained IIFE.
 * Load order: after app-state.js, before renderer.js.
 */
(function (): void {
  // ─── Format definitions ────────────────────────────────────────────────────

  interface WrapFormat {
    kind: "wrap";
    open: string;
    close: string;
  }

  interface LineFormat {
    kind: "line";
    prefix: string;
  }

  type FormatDef = {
    label: string;
    title: string;
    format: WrapFormat | LineFormat;
  };

  const FORMATS: FormatDef[] = [
    {
      label: "B",
      title: "Bold",
      format: { kind: "wrap", open: "**", close: "**" },
    },
    {
      label: "I",
      title: "Italic",
      format: { kind: "wrap", open: "*", close: "*" },
    },
    {
      label: "S",
      title: "Strikethrough",
      format: { kind: "wrap", open: "~~", close: "~~" },
    },
    {
      label: '"',
      title: "Blockquote",
      format: { kind: "line", prefix: "> " },
    },
    {
      label: "<>",
      title: "Code",
      format: { kind: "wrap", open: "`", close: "`" },
    },
    {
      label: "||",
      title: "Spoiler",
      format: { kind: "wrap", open: "||", close: "||" },
    },
  ];

  // ─── Build toolbar DOM ─────────────────────────────────────────────────────

  const toolbar = document.createElement("div");
  toolbar.id = "format-toolbar";
  toolbar.className = "format-toolbar format-toolbar--hidden";
  document.body.appendChild(toolbar);

  FORMATS.forEach((def) => {
    const btn = document.createElement("button");
    btn.className = "format-toolbar-btn";
    btn.title = def.title;
    btn.setAttribute("data-format", def.title.toLowerCase());
    btn.textContent = def.label;

    if (def.title === "Bold") btn.style.fontWeight = "bold";
    if (def.title === "Italic") btn.style.fontStyle = "italic";

    // mousedown (not click) prevents the textarea from losing focus/selection
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (activeInput) applyFormat(activeInput, def.format);
      hideToolbar();
    });

    toolbar.appendChild(btn);
  });

  // ─── State ─────────────────────────────────────────────────────────────────

  let activeInput: HTMLTextAreaElement | null = null;

  // ─── Show / hide ───────────────────────────────────────────────────────────

  function hideToolbar(): void {
    toolbar.classList.add("format-toolbar--hidden");
    activeInput = null;
  }

  function showToolbar(input: HTMLTextAreaElement, clientX: number, clientY: number): void {
    activeInput = input;
    toolbar.classList.remove("format-toolbar--hidden");

    // Measure after removing hidden so offsetWidth is accurate
    const tw = toolbar.offsetWidth || 230;
    const th = toolbar.offsetHeight || 36;

    let left = clientX - tw / 2;
    let top = clientY - th - 10;

    // Clamp to viewport
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    if (top < 8) top = clientY + 20; // flip below cursor if near top

    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${top}px`;
  }

  function showToolbarAboveTextarea(input: HTMLTextAreaElement): void {
    activeInput = input;
    toolbar.classList.remove("format-toolbar--hidden");

    const rect = input.getBoundingClientRect();
    const tw = toolbar.offsetWidth || 230;
    const th = toolbar.offsetHeight || 36;

    let left = rect.left + (rect.width - tw) / 2;
    let top = rect.top - th - 8;

    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    if (top < 8) top = rect.bottom + 8;

    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${top}px`;
  }

  // ─── Apply formatting ──────────────────────────────────────────────────────

  function applyFormat(input: HTMLTextAreaElement, fmt: WrapFormat | LineFormat): void {
    const { selectionStart: start, selectionEnd: end, value } = input;
    if (start === end) return;

    const selected = value.slice(start, end);
    let replacement: string;

    if (fmt.kind === "line") {
      // Prefix every line in the selection
      replacement = selected
        .split("\n")
        .map((line) => fmt.prefix + line)
        .join("\n");
    } else {
      const { open, close } = fmt;
      // Toggle: unwrap if already wrapped, otherwise wrap
      if (
        selected.startsWith(open) &&
        selected.endsWith(close) &&
        selected.length > open.length + close.length
      ) {
        replacement = selected.slice(open.length, -close.length);
      } else {
        replacement = open + selected + close;
      }
    }

    const newValue = value.slice(0, start) + replacement + value.slice(end);
    input.value = newValue;
    input.setSelectionRange(start, start + replacement.length);
    input.focus();

    // Notify auto-resize listener
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // ─── Event wiring ──────────────────────────────────────────────────────────

  function isMessageInput(el: EventTarget | null): el is HTMLTextAreaElement {
    return (
      el instanceof HTMLTextAreaElement &&
      el.classList.contains("message-input")
    );
  }

  // Mouse selection — show at cursor position
  document.addEventListener("mouseup", (e) => {
    if (toolbar.contains(e.target as Node)) return;

    if (!isMessageInput(e.target)) {
      hideToolbar();
      return;
    }

    const input = e.target;
    if (input.selectionStart === input.selectionEnd) {
      hideToolbar();
      return;
    }

    showToolbar(input, e.clientX, e.clientY);
  });

  // Keyboard selection — show above the textarea
  document.addEventListener("keyup", (e) => {
    if (!isMessageInput(e.target)) return;

    const input = e.target;
    if (input.selectionStart === input.selectionEnd) {
      hideToolbar();
    } else {
      showToolbarAboveTextarea(input);
    }
  });

  // Hide when clicking outside the toolbar
  document.addEventListener("mousedown", (e) => {
    if (!toolbar.classList.contains("format-toolbar--hidden") &&
        !toolbar.contains(e.target as Node)) {
      hideToolbar();
    }
  });

  // Hide on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideToolbar();
  });
})();
