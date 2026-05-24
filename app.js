const STORAGE_KEY = "flow-studio-diagrams-v1";
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.6;
const canvas = document.getElementById("canvas");
const canvasWrap = document.querySelector(".canvas-wrap");
const svg = document.getElementById("connectionsSvg");
const edgesLayer = document.getElementById("edgesLayer");
const diagramList = document.getElementById("diagramList");
const diagramTitle = document.getElementById("diagramTitle");
const diagramCount = document.getElementById("diagramCount");
const statusPill = document.getElementById("statusPill");
const addNodeBtn = document.getElementById("addNodeBtn");
const connectBtn = document.getElementById("connectBtn");
const deleteBtn = document.getElementById("deleteBtn");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const zoomReadout = document.getElementById("zoomReadout");
const zoomInBtn = document.getElementById("zoomInBtn");
const resetViewBtn = document.getElementById("resetViewBtn");
const saveBtn = document.getElementById("saveBtn");
const exportJsonBtn = document.getElementById("exportJsonBtn");
const exportSvgBtn = document.getElementById("exportSvgBtn");

let state = loadState();
let selected = { type: null, id: null };
let connectMode = false;
let connectSource = null;
let drag = null;
let panDrag = null;
let resizeObserver = null;

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultDiagram() {
  return {
    id: uid("diagram"),
    name: "新的流程图",
    nodes: [
      { id: uid("node"), x: 120, y: 110, width: 160, height: 78, text: "开始" },
      { id: uid("node"), x: 380, y: 110, width: 180, height: 78, text: "处理步骤" },
    ],
    edges: [],
    viewport: { x: 0, y: 0, scale: 1 },
    updatedAt: new Date().toISOString(),
  };
}

function loadState() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed.diagrams?.length) {
        parsed.diagrams.forEach(normalizeDiagram);
        return parsed;
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
  const diagram = defaultDiagram();
  diagram.edges = [{ id: uid("edge"), from: diagram.nodes[0].id, to: diagram.nodes[1].id }];
  return { activeId: diagram.id, diagrams: [diagram] };
}

function activeDiagram() {
  return state.diagrams.find((diagram) => diagram.id === state.activeId) || state.diagrams[0];
}

function normalizeDiagram(diagram) {
  diagram.viewport ||= { x: 0, y: 0, scale: 1 };
  diagram.viewport.x = Number.isFinite(diagram.viewport.x) ? diagram.viewport.x : 0;
  diagram.viewport.y = Number.isFinite(diagram.viewport.y) ? diagram.viewport.y : 0;
  diagram.viewport.scale = clampZoom(diagram.viewport.scale || 1);
  diagram.nodes ||= [];
  diagram.edges ||= [];
}

function saveState(showMessage = true) {
  const diagram = activeDiagram();
  diagram.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderSidebar();
  if (showMessage) setStatus("已保存");
}

function setStatus(message) {
  statusPill.textContent = message;
  window.clearTimeout(setStatus.timer);
  setStatus.timer = window.setTimeout(() => {
    statusPill.textContent = connectMode ? "连接模式" : "就绪";
  }, 1600);
}

function selectItem(type, id) {
  selected = { type, id };
  updateSelectionClasses();
  renderEdges();
}

function toggleConnectMode(force) {
  connectMode = typeof force === "boolean" ? force : !connectMode;
  connectSource = null;
  connectBtn.classList.toggle("active", connectMode);
  canvas.querySelectorAll(".node").forEach((node) => node.classList.remove("connect-source"));
  setStatus(connectMode ? "连接模式：依次点击两个方框" : "就绪");
}

function renderSidebar() {
  diagramCount.textContent = `${state.diagrams.length} 个流程图`;
  diagramList.replaceChildren();
  state.diagrams.forEach((diagram) => {
    const item = document.createElement("div");
    item.className = `diagram-item${diagram.id === state.activeId ? " active" : ""}`;
    item.dataset.id = diagram.id;

    const label = document.createElement("button");
    label.className = "diagram-select";
    label.type = "button";
    label.innerHTML = `<span class="diagram-name"></span><span class="diagram-meta">${diagram.nodes.length} 方框 · ${diagram.edges.length} 连线</span>`;
    label.querySelector(".diagram-name").textContent = diagram.name;

    const remove = document.createElement("button");
    remove.className = "remove-diagram";
    remove.type = "button";
    remove.title = "删除流程图";
    remove.setAttribute("aria-label", `删除 ${diagram.name}`);
    remove.textContent = "×";

    label.addEventListener("click", () => {
      state.activeId = diagram.id;
      selected = { type: null, id: null };
      toggleConnectMode(false);
      render();
    });
    item.append(label, remove);
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.diagrams.length === 1) {
        setStatus("至少保留一个流程图");
        return;
      }
      state.diagrams = state.diagrams.filter((entry) => entry.id !== diagram.id);
      state.activeId = state.diagrams[0].id;
      selected = { type: null, id: null };
      saveState(false);
      render();
      setStatus("已删除");
    });

    diagramList.append(item);
  });
}

function renderCanvas() {
  const diagram = activeDiagram();
  normalizeDiagram(diagram);
  diagramTitle.value = diagram.name;
  canvas.replaceChildren();

  diagram.nodes.forEach((node) => {
    const element = document.createElement("div");
    element.className = "node";
    element.dataset.id = node.id;
    element.style.left = `${node.x}px`;
    element.style.top = `${node.y}px`;
    element.style.width = `${node.width}px`;
    element.style.height = `${node.height}px`;
    element.classList.toggle("selected", selected.type === "node" && selected.id === node.id);
    element.classList.toggle("connect-source", connectSource === node.id);

    const handle = document.createElement("button");
    handle.className = "node-handle";
    handle.type = "button";
    handle.title = "移动方框";
    handle.setAttribute("aria-label", "移动方框");
    handle.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M7 8l5-5 5 5M7 16l5 5 5-5"></path></svg>`;
    handle.addEventListener("pointerdown", (event) => startNodePointer(event, node, element));
    handle.addEventListener("click", (event) => {
      event.stopPropagation();
      selectItem("node", node.id);
    });

    const textarea = document.createElement("textarea");
    textarea.value = node.text;
    textarea.placeholder = "输入文字";
    textarea.addEventListener("input", () => {
      node.text = textarea.value;
      saveState(false);
    });
    textarea.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      selectItem("node", node.id);
    });
    textarea.addEventListener("click", (event) => {
      if (!connectMode) return;
      handleNodeClick(event, node);
    });

    element.addEventListener("pointerdown", (event) => startNodePointer(event, node, element));
    element.addEventListener("click", (event) => handleNodeClick(event, node));
    element.append(handle, textarea);
    canvas.append(element);
  });

  watchNodeSizes();
  applyViewport();
  renderEdges();
}

function watchNodeSizes() {
  if (resizeObserver) resizeObserver.disconnect();
  resizeObserver = new ResizeObserver((entries) => {
    const diagram = activeDiagram();
    let changed = false;
    entries.forEach((entry) => {
      const node = diagram.nodes.find((candidate) => candidate.id === entry.target.dataset.id);
      if (!node) return;
      const width = Math.round(entry.target.offsetWidth);
      const height = Math.round(entry.target.offsetHeight);
      if (Math.abs(node.width - width) > 1 || Math.abs(node.height - height) > 1) {
        node.width = width;
        node.height = height;
        changed = true;
      }
    });
    if (changed) {
      renderEdges();
      saveState(false);
    }
  });
  canvas.querySelectorAll(".node").forEach((node) => resizeObserver.observe(node));
}

function renderEdges() {
  const diagram = activeDiagram();
  edgesLayer.querySelectorAll("path.edge").forEach((path) => path.remove());
  diagram.edges.forEach((edge) => {
    const from = diagram.nodes.find((node) => node.id === edge.from);
    const to = diagram.nodes.find((node) => node.id === edge.to);
    if (!from || !to) return;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.classList.add("edge");
    path.classList.toggle("selected", selected.type === "edge" && selected.id === edge.id);
    path.dataset.id = edge.id;
    path.setAttribute("d", edgePath(from, to));
    path.style.pointerEvents = "stroke";
    path.addEventListener("click", (event) => {
      event.stopPropagation();
      selectItem("edge", edge.id);
    });
    edgesLayer.append(path);
  });
}

function updateSelectionClasses() {
  canvas.querySelectorAll(".node").forEach((element) => {
    element.classList.toggle("selected", selected.type === "node" && selected.id === element.dataset.id);
    element.classList.toggle("connect-source", connectSource === element.dataset.id);
  });
}

function edgePath(from, to) {
  const start = anchorPoint(from, to);
  const end = anchorPoint(to, from);
  const midX = (start.x + end.x) / 2;
  return `M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`;
}

function anchorPoint(node, target) {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const tx = target.x + target.width / 2;
  const ty = target.y + target.height / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (Math.abs(dx) / node.width > Math.abs(dy) / node.height) {
    return { x: cx + Math.sign(dx || 1) * node.width / 2, y: cy };
  }
  return { x: cx, y: cy + Math.sign(dy || 1) * node.height / 2 };
}

function startNodePointer(event, node, element) {
  if ((event.target.tagName === "TEXTAREA" && !event.target.classList.contains("node-handle")) || connectMode) return;
  selectItem("node", node.id);
  const rect = element.getBoundingClientRect();
  const nearResizeCorner = event.clientX > rect.right - 18 && event.clientY > rect.bottom - 18;
  if (nearResizeCorner) return;

  const point = screenToWorld(event.clientX, event.clientY);
  drag = {
    node,
    pointerId: event.pointerId,
    offsetX: point.x - node.x,
    offsetY: point.y - node.y,
  };
  element.setPointerCapture(event.pointerId);
  event.stopPropagation();
}

function handleNodeClick(event, node) {
  event.stopPropagation();
  if (!connectMode) {
    selectItem("node", node.id);
    return;
  }
  if (!connectSource) {
    connectSource = node.id;
    updateSelectionClasses();
    setStatus("请选择目标方框");
    return;
  }
  if (connectSource === node.id) {
    connectSource = null;
    updateSelectionClasses();
    setStatus("已取消起点");
    return;
  }
  const diagram = activeDiagram();
  const exists = diagram.edges.some((edge) => edge.from === connectSource && edge.to === node.id);
  if (!exists) {
    diagram.edges.push({ id: uid("edge"), from: connectSource, to: node.id });
    saveState(false);
    setStatus("已连接");
  } else {
    setStatus("连线已存在");
  }
  connectSource = null;
  updateSelectionClasses();
  renderEdges();
}

function addNode() {
  const diagram = activeDiagram();
  const count = diagram.nodes.length + 1;
  const wrapRect = canvasWrap.getBoundingClientRect();
  const center = screenToWorld(wrapRect.left + wrapRect.width / 2, wrapRect.top + wrapRect.height / 2);
  const node = {
    id: uid("node"),
    x: Math.max(0, Math.round(center.x - 85 + count * 10)),
    y: Math.max(0, Math.round(center.y - 41 + count * 8)),
    width: 170,
    height: 82,
    text: `步骤 ${count}`,
  };
  diagram.nodes.push(node);
  selected = { type: "node", id: node.id };
  saveState(false);
  renderCanvas();
  renderSidebar();
  setStatus("已创建方框");
}

function deleteSelected() {
  const diagram = activeDiagram();
  if (selected.type === "node") {
    diagram.nodes = diagram.nodes.filter((node) => node.id !== selected.id);
    diagram.edges = diagram.edges.filter((edge) => edge.from !== selected.id && edge.to !== selected.id);
    selected = { type: null, id: null };
    saveState(false);
    render();
    setStatus("已删除方框");
    return;
  }
  if (selected.type === "edge") {
    diagram.edges = diagram.edges.filter((edge) => edge.id !== selected.id);
    selected = { type: null, id: null };
    saveState(false);
    render();
    setStatus("已删除连线");
    return;
  }
  setStatus("未选择内容");
}

function createDiagram() {
  const diagram = defaultDiagram();
  state.diagrams.push(diagram);
  state.activeId = diagram.id;
  selected = { type: null, id: null };
  toggleConnectMode(false);
  saveState(false);
  render();
  setStatus("已新建流程图");
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function exportJson() {
  const diagram = activeDiagram();
  download(`${safeFilename(diagram.name)}.json`, JSON.stringify(diagram, null, 2), "application/json");
  setStatus("已导出 JSON");
}

function exportSvg() {
  const diagram = activeDiagram();
  const bounds = diagramBounds(diagram);
  const nodeMarkup = diagram.nodes
    .map((node) => {
      const textLines = escapeXml(node.text || "").split(/\n/);
      const lines = textLines
        .map((line, index) => `<tspan x="${node.x + node.width / 2}" dy="${index === 0 ? 0 : 19}">${line}</tspan>`)
        .join("");
      return `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="8" fill="#fffdf9" stroke="#50606e" stroke-width="2"/><text x="${node.x + node.width / 2}" y="${node.y + node.height / 2 - (textLines.length - 1) * 9}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="#20242a">${lines}</text>`;
    })
    .join("");
  const edgeMarkup = diagram.edges
    .map((edge) => {
      const from = diagram.nodes.find((node) => node.id === edge.from);
      const to = diagram.nodes.find((node) => node.id === edge.to);
      return from && to ? `<path d="${edgePath(from, to)}" fill="none" stroke="#54606c" stroke-width="2.4" marker-end="url(#arrow)"/>` : "";
    })
    .join("");
  const svgText = `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}">
  <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z" fill="#54606c"/></marker></defs>
  <rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="#eef2f6"/>
  ${edgeMarkup}
  ${nodeMarkup}
</svg>`;
  download(`${safeFilename(diagram.name)}.svg`, svgText, "image/svg+xml");
  setStatus("已导出 SVG");
}

function diagramBounds(diagram) {
  if (!diagram.nodes.length) return { x: 0, y: 0, width: 1200, height: 800 };
  const pad = 56;
  const left = Math.min(...diagram.nodes.map((node) => node.x)) - pad;
  const top = Math.min(...diagram.nodes.map((node) => node.y)) - pad;
  const right = Math.max(...diagram.nodes.map((node) => node.x + node.width)) + pad;
  const bottom = Math.max(...diagram.nodes.map((node) => node.y + node.height)) + pad;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function safeFilename(name) {
  return name.trim().replace(/[\\/:*?"<>|]+/g, "-") || "flowchart";
}

function escapeXml(value) {
  return value.replace(/[<>&'"]/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;",
  })[char]);
}

function render() {
  renderSidebar();
  renderCanvas();
}

function applyViewport() {
  const { x, y, scale } = activeDiagram().viewport;
  const transform = `translate(${x}px, ${y}px) scale(${scale})`;
  canvas.style.transform = transform;
  edgesLayer.setAttribute("transform", `translate(${x} ${y}) scale(${scale})`);
  const grid = 24 * scale;
  canvasWrap.style.backgroundSize = `${grid}px ${grid}px`;
  canvasWrap.style.backgroundPosition = `${mod(x, grid)}px ${mod(y, grid)}px`;
  zoomReadout.textContent = `${Math.round(scale * 100)}%`;
}

function screenToWorld(clientX, clientY) {
  const rect = canvasWrap.getBoundingClientRect();
  const { x, y, scale } = activeDiagram().viewport;
  return {
    x: (clientX - rect.left - x) / scale,
    y: (clientY - rect.top - y) / scale,
  };
}

function zoomAt(clientX, clientY, nextScale) {
  const diagram = activeDiagram();
  const viewport = diagram.viewport;
  const before = screenToWorld(clientX, clientY);
  viewport.scale = clampZoom(nextScale);
  const rect = canvasWrap.getBoundingClientRect();
  viewport.x = clientX - rect.left - before.x * viewport.scale;
  viewport.y = clientY - rect.top - before.y * viewport.scale;
  applyViewport();
  saveState(false);
}

function zoomBy(factor) {
  const rect = canvasWrap.getBoundingClientRect();
  zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, activeDiagram().viewport.scale * factor);
}

function resetView() {
  activeDiagram().viewport = { x: 0, y: 0, scale: 1 };
  applyViewport();
  saveState(false);
  setStatus("视图已重置");
}

function clampZoom(value) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

addNodeBtn.addEventListener("click", addNode);
connectBtn.addEventListener("click", () => toggleConnectMode());
deleteBtn.addEventListener("click", deleteSelected);
zoomOutBtn.addEventListener("click", () => zoomBy(0.85));
zoomInBtn.addEventListener("click", () => zoomBy(1.18));
resetViewBtn.addEventListener("click", resetView);
saveBtn.addEventListener("click", () => saveState(true));
exportJsonBtn.addEventListener("click", exportJson);
exportSvgBtn.addEventListener("click", exportSvg);
document.getElementById("newDiagramBtn").addEventListener("click", createDiagram);

diagramTitle.addEventListener("input", () => {
  activeDiagram().name = diagramTitle.value.trim() || "未命名流程图";
  saveState(false);
});

canvasWrap.addEventListener("pointerdown", (event) => {
  if (event.target !== canvasWrap && event.target !== canvas) return;
  if (connectMode) return;
  selected = { type: null, id: null };
  renderCanvas();
  panDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    viewportX: activeDiagram().viewport.x,
    viewportY: activeDiagram().viewport.y,
    moved: false,
  };
  canvasWrap.classList.add("panning");
  canvasWrap.setPointerCapture(event.pointerId);
});

canvasWrap.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const point = screenToWorld(event.clientX, event.clientY);
  drag.node.x = Math.max(0, Math.round(point.x - drag.offsetX));
  drag.node.y = Math.max(0, Math.round(point.y - drag.offsetY));
  const element = canvas.querySelector(`[data-id="${drag.node.id}"]`);
  if (element) {
    element.style.left = `${drag.node.x}px`;
    element.style.top = `${drag.node.y}px`;
  }
  renderEdges();
});

canvasWrap.addEventListener("pointermove", (event) => {
  if (!panDrag) return;
  const diagram = activeDiagram();
  diagram.viewport.x = panDrag.viewportX + event.clientX - panDrag.startX;
  diagram.viewport.y = panDrag.viewportY + event.clientY - panDrag.startY;
  panDrag.moved = true;
  applyViewport();
});

canvasWrap.addEventListener("pointerup", () => {
  if (drag) {
    drag = null;
    saveState(false);
  }
  if (panDrag) {
    panDrag = null;
    canvasWrap.classList.remove("panning");
    saveState(false);
  }
});

canvasWrap.addEventListener("pointercancel", () => {
  drag = null;
  panDrag = null;
  canvasWrap.classList.remove("panning");
});

canvasWrap.addEventListener("click", (event) => {
  if (event.target !== canvasWrap && event.target !== canvas) return;
  if (connectMode) return;
  selected = { type: null, id: null };
  renderCanvas();
});

canvasWrap.addEventListener("wheel", (event) => {
  event.preventDefault();
  const factor = event.deltaY > 0 ? 0.9 : 1.1;
  zoomAt(event.clientX, event.clientY, activeDiagram().viewport.scale * factor);
}, { passive: false });

document.addEventListener("keydown", (event) => {
  if (event.target.tagName === "TEXTAREA" || event.target.tagName === "INPUT") return;
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    deleteSelected();
  }
  if (event.key === "Escape") {
    toggleConnectMode(false);
    selected = { type: null, id: null };
    renderCanvas();
  }
});

window.addEventListener("resize", renderEdges);

render();
saveState(false);
