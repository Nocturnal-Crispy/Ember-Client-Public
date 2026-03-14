/**
 * Unit tests for src/renderer/components/messages-area.ts
 *
 * Tests URL detection and rendering in createBasicMessageElement:
 *   - Plain text creates no link elements
 *   - HTTP URLs create .message-link anchor elements
 *   - Image URLs (.png, .jpg, .gif, .webp) create .url-image-card elements
 *   - Mixed text+URL preserves surrounding text
 *   - Multiple URLs in one message all rendered
 */

// @jest-environment jsdom

beforeAll(() => {
  // 1. Populate window.App
  require("../../../src/renderer/managers/app-state");

  // 2. Mock window.electronAPI
  (window as any).electronAPI = {
    ipc: {
      invoke: jest.fn().mockResolvedValue(null),
      send: jest.fn(),
      on: jest.fn(),
    },
    crypto: {
      decryptFileBytes: jest.fn(),
    },
    messageService: {
      downloadAttachment: jest.fn(),
    },
    nacl: {},
    naclUtil: {},
  };

  // 3. Mock window.emberLog
  (window as any).emberLog = {
    createLogger: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  };

  // 4. Mock openExternalLinkModal
  (window as any).openExternalLinkModal = jest.fn();

  // 5. Mock openImageViewer
  (window as any).openImageViewer = jest.fn();

  // 6. Load the IIFE module
  require("../../../src/renderer/components/messages-area");
});

describe("createBasicMessageElement — URL rendering", () => {
  function createElement(text: string): HTMLElement {
    return window.createBasicMessageElement("Alice", text, undefined, "msg1");
  }

  function getTextEl(el: HTMLElement): HTMLElement {
    return el.querySelector(".message-text") as HTMLElement;
  }

  it("renders plain text without any link or image elements", () => {
    const el = createElement("Hello world");
    const textEl = getTextEl(el);
    expect(textEl.querySelector("a")).toBeNull();
    expect(textEl.querySelector(".url-image-card")).toBeNull();
    expect(textEl.textContent).toBe("Hello world");
  });

  it("renders an http URL as a .message-link anchor", () => {
    const el = createElement("Visit https://example.com for info");
    const textEl = getTextEl(el);
    const link = textEl.querySelector("a.message-link") as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.textContent).toBe("https://example.com");
    expect(link.getAttribute("href")).toBe("#");
  });

  it("renders text surrounding the URL correctly", () => {
    const el = createElement("Before https://example.com after");
    const textEl = getTextEl(el);
    const fullText = textEl.textContent;
    expect(fullText).toContain("Before ");
    expect(fullText).toContain(" after");
    expect(fullText).toContain("https://example.com");
  });

  it("clicking .message-link calls openExternalLinkModal with the URL", () => {
    const mockOpenModal = jest.fn();
    (window as any).openExternalLinkModal = mockOpenModal;

    const el = createElement("See https://example.com here");
    const link = el.querySelector("a.message-link") as HTMLAnchorElement;
    expect(link).not.toBeNull();

    link.click();

    expect(mockOpenModal).toHaveBeenCalledWith("https://example.com");
  });

  it("renders a .png URL as a .url-image-card", () => {
    const el = createElement("https://example.com/photo.png");
    const textEl = getTextEl(el);
    const imgCard = textEl.querySelector(".url-image-card");
    expect(imgCard).not.toBeNull();
    expect(textEl.querySelector("a.message-link")).toBeNull();
  });

  it("renders a .jpg URL as a .url-image-card", () => {
    const el = createElement("https://example.com/image.jpg");
    const textEl = getTextEl(el);
    expect(textEl.querySelector(".url-image-card")).not.toBeNull();
  });

  it("renders a .gif URL as a .url-image-card", () => {
    const el = createElement("https://example.com/anim.gif");
    const textEl = getTextEl(el);
    expect(textEl.querySelector(".url-image-card")).not.toBeNull();
  });

  it("renders a .webp URL as a .url-image-card", () => {
    const el = createElement("https://example.com/img.webp");
    const textEl = getTextEl(el);
    expect(textEl.querySelector(".url-image-card")).not.toBeNull();
  });

  it("renders a .jpeg URL as a .url-image-card", () => {
    const el = createElement("https://example.com/photo.jpeg");
    const textEl = getTextEl(el);
    expect(textEl.querySelector(".url-image-card")).not.toBeNull();
  });

  it("url-image-card contains an img element with the correct src", () => {
    const url = "https://example.com/photo.png";
    const el = createElement(url);
    const img = el.querySelector(".url-image-card img") as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toBe(url);
  });

  it("renders multiple URLs in one message", () => {
    const el = createElement(
      "Check https://example.com and https://other.org/pic.png"
    );
    const textEl = getTextEl(el);
    const links = textEl.querySelectorAll("a.message-link");
    const imgCards = textEl.querySelectorAll(".url-image-card");
    expect(links).toHaveLength(1);
    expect(imgCards).toHaveLength(1);
  });

  it("empty text produces empty message-text element", () => {
    const el = createElement("");
    const textEl = getTextEl(el);
    expect(textEl.textContent).toBe("");
    expect(textEl.childNodes.length).toBe(0);
  });

  it("URL with query string is rendered as a link", () => {
    const url = "https://example.com/search?q=hello&page=1";
    const el = createElement(url);
    const textEl = getTextEl(el);
    const link = textEl.querySelector("a.message-link");
    expect(link).not.toBeNull();
    expect(link!.textContent).toBe(url);
  });

  it("image URL with query string is still rendered as url-image-card", () => {
    const el = createElement("https://cdn.example.com/img.png?w=200");
    const textEl = getTextEl(el);
    expect(textEl.querySelector(".url-image-card")).not.toBeNull();
  });
});

describe("createActionToolbar", () => {
  beforeEach(() => {
    (window as any).App.ownedMessageIds = new Set<string>();
  });

  it("returns a div with class message-action-bar", () => {
    const toolbar = window.createActionToolbar("msg-1", false);
    expect(toolbar.tagName).toBe("DIV");
    expect(toolbar.className).toBe("message-action-bar");
  });

  it("does not include a react button", () => {
    const toolbar = window.createActionToolbar("msg-1", false);
    const buttons = toolbar.querySelectorAll("button");
    const titles = Array.from(buttons).map((b) => b.title);
    expect(titles).not.toContain("Add Reaction");
  });

  it("does not include a forward button", () => {
    const toolbar = window.createActionToolbar("msg-1", false);
    const buttons = toolbar.querySelectorAll("button");
    const titles = Array.from(buttons).map((b) => b.title);
    expect(titles).not.toContain("Forward");
  });

  it("does not include a delete button for non-owned messages (isOwn=false)", () => {
    const toolbar = window.createActionToolbar("msg-1", false);
    const buttons = toolbar.querySelectorAll("button");
    const titles = Array.from(buttons).map((b) => b.title);
    expect(titles).not.toContain("Delete");
  });

  it("includes a delete button for owned messages (isOwn=true)", () => {
    const toolbar = window.createActionToolbar("msg-1", true);
    const buttons = toolbar.querySelectorAll("button");
    const titles = Array.from(buttons).map((b) => b.title);
    expect(titles).toContain("Delete");
  });

  it("includes an edit button for owned messages (isOwn=true)", () => {
    const toolbar = window.createActionToolbar("msg-1", true);
    const buttons = toolbar.querySelectorAll("button");
    const titles = Array.from(buttons).map((b) => b.title);
    expect(titles).toContain("Edit");
  });

  it("does not include an edit button for non-owned messages (isOwn=false)", () => {
    const toolbar = window.createActionToolbar("msg-1", false);
    const buttons = toolbar.querySelectorAll("button");
    const titles = Array.from(buttons).map((b) => b.title);
    expect(titles).not.toContain("Edit");
  });

  it("falls back to App.ownedMessageIds when isOwn is omitted", () => {
    (window as any).App.ownedMessageIds.add("msg-owned");
    const toolbar = window.createActionToolbar("msg-owned");
    const buttons = toolbar.querySelectorAll("button");
    const titles = Array.from(buttons).map((b) => b.title);
    expect(titles).toContain("Delete");
  });

  it("shows no buttons for non-owned messages when isOwn is omitted", () => {
    const toolbar = window.createActionToolbar("msg-not-owned");
    const buttons = toolbar.querySelectorAll("button");
    expect(buttons.length).toBe(0);
  });
});
