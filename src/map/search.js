import L from "leaflet";
import mapInfo from "../../env/mapinfo.js";
import { mapState, refreshRoomHighlights, requireMap } from "./state.js";
import { showFloor } from "./update.js";
import { SVG_HEIGHT } from "./constants.js";
import { parseSvgPathRings } from "./navmesh.js";

// Set window.ROUTE_GRID_CELL_SIZE before initialization to inspect coarser grids.
const GRID_CELL_SIZE = Number(globalThis.ROUTE_GRID_CELL_SIZE ?? 2);
const defaultCurrentRoom = mapInfo.floors
  .flatMap((floor) => floor.rooms.map((room) => ({ floor, room })))
  .find(({ room }) => room.name === "昇降口");
const currentLocation = {
  name: "昇降口",
  floorName: defaultCurrentRoom?.floor.floorName ?? "1階",
  point: defaultCurrentRoom?.room.lineDot ?? [212, 284],
};
let destinationLocation = null;
let searchMode = "destination";
let routeLayer = null;
const routeSegments = new Map();
let routeRequestId = 0;
const floorGridCache = new Map();

const pointInRing = (p, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};
const windingNumber = (p, ring) => {
  let winding = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (a.y <= p.y) {
      if (b.y > p.y && (b.x - a.x) * (p.y - a.y) -
        (p.x - a.x) * (b.y - a.y) > 0) winding++;
    } else if (b.y <= p.y && (b.x - a.x) * (p.y - a.y) -
      (p.x - a.x) * (b.y - a.y) < 0) {
      winding--;
    }
  }
  return winding;
};
const area = (ring) => Math.abs(ring.reduce((sum, p, i) => {
  const n = ring[(i + 1) % ring.length];
  return sum + p.x * n.y - n.x * p.y;
}, 0) / 2);
const centerOf = (room) => {
  const [[a, b], [c, d]] = room.bounds;
  return L.latLng((a + c) / 2, (b + d) / 2);
};
const roomContains = (room, p) => {
  const [[a, b], [c, d]] = room.bounds;
  return p.lat > Math.min(a, c) && p.lat < Math.max(a, c) &&
    p.lng > Math.min(b, d) && p.lng < Math.max(b, d);
};
const roomContainsWithTolerance = (room, p, tolerance = GRID_CELL_SIZE * 6) => {
  const [[a, b], [c, d]] = room.bounds;
  return p.lat > Math.min(a, c) - tolerance && p.lat < Math.max(a, c) + tolerance &&
    p.lng > Math.min(b, d) - tolerance && p.lng < Math.max(b, d) + tolerance;
};
const roomBoundaryDistance = (room, point) => {
  const [[a, b], [c, d]] = room.bounds;
  const north = Math.min(a, c), south = Math.max(a, c);
  const west = Math.min(b, d), east = Math.max(b, d);
  const dx = Math.max(west - point.lng, 0, point.lng - east);
  const dy = Math.max(north - point.lat, 0, point.lat - south);
  return Math.hypot(dx, dy);
};

function normalize(value) {
  return value.trim().toLocaleLowerCase("ja-JP").replace(/[　\s]+/g, "")
    .replace(/コンピューター/g, "コンピュータ")
    .replace(/(\d+)[年ｰー−-]?(\d+)[組クラス]*$/u, "$1-$2");
}
function getRoomMatches(query) {
  const q = normalize(query);
  if (!q) return [];
  return mapInfo.floors.flatMap((floor) => floor.rooms
    .filter((room) => [room.name, ...(room.searchTerms ?? room.aliases ?? [])]
      .some((value) => {
        const n = normalize(value);
        return n.includes(q) || (q.includes("-") && n.includes(q.replace("-", "")));
      }))
    .map((room) => ({ room, floor })));
}

function updateNavigationBanner() {
  document.getElementById("current-location")?.replaceChildren(
    `${currentLocation.name}（${currentLocation.floorName}）`);
  document.getElementById("destination-location")?.replaceChildren(
    destinationLocation ? `${destinationLocation.room.name}（${destinationLocation.floor.floorName}）` : "目的地を選択");
}
function renderRouteForFloor(name) {
  routeLayer?.remove();
  const segment = routeSegments.get(name);
  routeLayer = segment ? L.layerGroup(segment.layers()).addTo(requireMap()) : null;
}
function handleRouteFloorChange(event) { renderRouteForFloor(event.name); }

function parseStyles(document) {
  const styles = new Map();
  for (const style of document.querySelectorAll("style")) {
    for (const m of style.textContent.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const declarations = Object.fromEntries(m[2].split(";").map((x) => x.split(":").map((v) => v.trim().toLowerCase()))
        .filter(([a, b]) => a && b));
      for (const selector of m[1].split(",")) {
        const name = selector.trim().match(/^\.([\w-]+)$/)?.[1];
        if (name) styles.set(name, declarations);
      }
    }
  }
  return styles;
}
function color(value) {
  const m = value?.trim().toLowerCase().match(/^#([\da-f]{6})$/i);
  return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4), 16)] : null;
}
function ringFromElement(element, scaleX, scaleY) {
  const raw = element.tagName.toLowerCase() === "path"
    ? parseSvgPathRings(element.getAttribute("d") ?? "")
    : [[...(element.getAttribute("points") ?? "").matchAll(/(-?(?:\d*\.)?\d+)[,\s]+(-?(?:\d*\.)?\d+)/g)]
      .map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))];
  // SVG は上が y=0、地図座標 (lat) は下が 0 なので上下を反転する
  return raw.map((ring) => ring.map((p) => ({ x: p.x * scaleX, y: SVG_HEIGHT - p.y * scaleY })))
    .filter((ring) => ring.length > 2 && area(ring) > 10);
}

async function buildFloorGrid(floor) {
  const cached = floorGridCache.get(floor.floorName);
  if (cached) return cached;
  const response = await fetch(`/env/${floor.floorFile}`);
  if (!response.ok) throw new Error("歩行可能エリアを読み込めません");
  const document = new DOMParser().parseFromString(await response.text(), "image/svg+xml");
  const vb = (document.documentElement.getAttribute("viewBox") ?? "0 0 595.28 841.89").split(/\s+/).map(Number);
  const sx = 700 / (vb[2] || 700), sy = 800 / (vb[3] || 800);
  const styles = parseStyles(document);
  const rings = [...document.querySelectorAll("path,polygon")].flatMap((el) => {
    const attrs = {};
    for (const cls of el.getAttribute("class")?.split(/\s+/) ?? []) Object.assign(attrs, styles.get(cls));
    Object.assign(attrs, el.dataset, { fill: el.getAttribute("fill") ?? attrs.fill, stroke: el.getAttribute("stroke") ?? attrs.stroke });
    const c = color(attrs.fill);
    const walkable = c && ((c[0] === 202 && c[1] === 255 && c[2] === 209) ||
      (c[0] === 0 && c[1] === 122 && c[2] === 232));
    return walkable ? ringFromElement(el, sx, sy) : [];
  });
  const boundary = [...document.querySelectorAll("path,polygon")].flatMap((el) => {
    const stroke = el.getAttribute("stroke") ?? [...el.getAttribute("class")?.split(/\s+/) ?? []]
      .map((c) => styles.get(c)?.stroke).find(Boolean);
    return stroke?.toLowerCase() === "#13ae67" ? ringFromElement(el, sx, sy) : [];
  });
  const walkableRings = rings.length ? rings : boundary;
  const outer = walkableRings.sort((a, b) => area(b) - area(a))[0];
  if (!outer) throw new Error(`${floor.floorName} の歩行可能ポリゴンがありません`);
  const roomHoles = floor.rooms.map((room) => {
      const [[a, b], [c, d]] = room.bounds;
      return [{ x: Math.min(b, d), y: Math.min(a, c) }, { x: Math.max(b, d), y: Math.min(a, c) },
        { x: Math.max(b, d), y: Math.max(a, c) }, { x: Math.min(b, d), y: Math.max(a, c) }];
    });
  const holes = roomHoles;
  const minX = Math.floor(Math.min(...walkableRings.flat().map((p) => p.x)) / GRID_CELL_SIZE) - 1;
  const maxX = Math.ceil(Math.max(...walkableRings.flat().map((p) => p.x)) / GRID_CELL_SIZE) + 1;
  const minY = Math.floor(Math.min(...walkableRings.flat().map((p) => p.y)) / GRID_CELL_SIZE) - 1;
  const maxY = Math.ceil(Math.max(...walkableRings.flat().map((p) => p.y)) / GRID_CELL_SIZE) + 1;
  const walkable = (x, y) => {
    const point = { x, y };
    const insideWalkableFill = rings.length
      ? rings.reduce((sum, ring) => sum + windingNumber(point, ring), 0) !== 0
      : pointInRing(point, outer);
    return insideWalkableFill && !holes.some((hole) => pointInRing(point, hole));
  };
  const componentIds = new Map();
  const componentSizes = [];
  const grid = {
    floor, outer, holes, minX, maxX, minY, maxY, walkable,
    components: 0,
    componentSizes,
    componentAt: (x, y) => componentIds.get(`${x}:${y}`) ?? null,
  };
  const visited = new Set(), key = (x, y) => `${x}:${y}`;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const k = key(x, y); if (visited.has(k) || !walkable(x * GRID_CELL_SIZE, y * GRID_CELL_SIZE)) continue;
    const component = grid.components++; const queue = [[x, y]]; visited.add(k); componentIds.set(k, component);
    let componentSize = 0;
    while (queue.length) {
      componentSize++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = queue[0][0] + dx, ny = queue[0][1] + dy, nk = key(nx, ny);
        if (!visited.has(nk) && nx >= minX && nx <= maxX && ny >= minY && ny <= maxY &&
          walkable(nx * GRID_CELL_SIZE, ny * GRID_CELL_SIZE)) {
          visited.add(nk); componentIds.set(nk, component); queue.push([nx, ny]);
        }
      }
      queue.shift();
    }
    componentSizes[component] = componentSize;
  }
  console.info("[route-grid] floor", floor.floorName, {
    cellSize: GRID_CELL_SIZE,
    scale: { x: sx, y: sy },
    svgViewBox: vb,
    components: grid.components,
    componentSizes,
  });
  const traceName = globalThis.ROUTE_GRID_TRACE_ROOM ?? "2-6";
  const traceRoom = floor.rooms.find((room) => room.name === traceName);
  if (traceRoom) {
    const [[a, b], [c, d]] = traceRoom.bounds;
    const center = centerOf(traceRoom);
    const traceCell = {
      x: Math.round(center.lng / GRID_CELL_SIZE),
      y: Math.round(center.lat / GRID_CELL_SIZE),
    };
    console.info("[route-grid] raster trace", {
      room: traceRoom.name,
      roomSvgLikeBounds: traceRoom.bounds,
      roomCenter: { lat: center.lat, lng: center.lng },
      cell: traceCell,
      transformed: {
        x: traceCell.x * GRID_CELL_SIZE,
        y: traceCell.y * GRID_CELL_SIZE,
      },
      walkable: walkable(
        traceCell.x * GRID_CELL_SIZE,
        traceCell.y * GRID_CELL_SIZE,
      ),
      roomBoundsExtents: { north: a, west: b, south: c, east: d },
    });
  }
  const isolatedRooms = floor.rooms.map((room) => {
    try {
      const cell = nearestBoundaryCell(grid, centerOf(room), room);
      return {
        name: room.name,
        component: grid.componentAt(cell.x, cell.y),
        distancePx: cell.distance,
        grid: { x: cell.x, y: cell.y },
      };
    } catch (error) {
      return { name: room.name, component: null, reason: error.message };
    }
  }).filter(Boolean);
  console.info("[route-grid] room components", floor.floorName, isolatedRooms);
  const isolated = isolatedRooms.filter((room) => room.component === null);
  if (isolated.length) console.warn("[route-grid] isolated rooms", floor.floorName, isolated);
  floorGridCache.set(floor.floorName, grid);
  return grid;
}

function nearestBoundaryCell(grid, point, room) {
  const candidates = [];
  const mainComponent = grid.componentSizes.reduce(
    (largest, size, index) => size > (grid.componentSizes[largest] ?? 0) ? index : largest,
    0,
  );
  for (let y = grid.minY; y <= grid.maxY; y++) for (let x = grid.minX; x <= grid.maxX; x++) {
    const p = L.latLng(y * GRID_CELL_SIZE, x * GRID_CELL_SIZE);
    if (grid.walkable(p.lng, p.lat) && (!room || !roomContains(room, p))) {
      const distance = room ? roomBoundaryDistance(room, p) : p.distanceTo(point);
      candidates.push({
        x,
        y,
        distance,
        component: grid.componentAt(x, y),
        mainComponent: grid.componentAt(x, y) === mainComponent,
      });
    }
  }
  candidates.sort((a, b) =>
    Number(b.mainComponent) - Number(a.mainComponent) || a.distance - b.distance);
  if (!candidates[0]) {
    const bounds = room?.bounds ?? null;
    console.warn("[route-grid] no boundary cell", {
      floor: grid.floor.floorName,
      room: room?.name,
      searchCells: {
        x: grid.maxX - grid.minX + 1,
        y: grid.maxY - grid.minY + 1,
      },
      searchPixels: {
        x: (grid.maxX - grid.minX + 1) * GRID_CELL_SIZE,
        y: (grid.maxY - grid.minY + 1) * GRID_CELL_SIZE,
      },
      roomBounds: bounds,
    });
    throw new Error("接続できる歩行可能セルがありません");
  }
  console.debug("[route-grid] nearest boundary cell", {
    floor: grid.floor.floorName,
    room: room?.name,
    distancePx: candidates[0].distance,
    cell: candidates[0],
    transformed: {
      x: candidates[0].x * GRID_CELL_SIZE,
      y: candidates[0].y * GRID_CELL_SIZE,
    },
    walkable: grid.walkable(
      candidates[0].x * GRID_CELL_SIZE,
      candidates[0].y * GRID_CELL_SIZE,
    ),
  });
  return candidates[0];
}
function walkableSegment(grid, from, to) {
  const distance = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  const samples = Math.max(2, distance * 4);
  for (let index = 0; index <= samples; index++) {
    const ratio = index / samples;
    const x = (from.x + (to.x - from.x) * ratio) * GRID_CELL_SIZE;
    const y = (from.y + (to.y - from.y) * ratio) * GRID_CELL_SIZE;
    if (!grid.walkable(x, y)) return false;
  }
  return true;
}
function walkableLine(grid, from, to, allowedRoom = null) {
  const distance = Math.max(Math.abs(to.lat - from.lat), Math.abs(to.lng - from.lng));
  const samples = Math.max(2, Math.ceil(distance * 4));
  for (let index = 0; index <= samples; index++) {
    const ratio = index / samples;
    const lat = from.lat + (to.lat - from.lat) * ratio;
    const lng = from.lng + (to.lng - from.lng) * ratio;
    const point = L.latLng(lat, lng);
    if (!grid.walkable(lng, lat) && !(allowedRoom && roomContainsWithTolerance(allowedRoom, point))) return false;
  }
  return true;
}
function orthogonalCandidates(from, to) {
  const cornerA = L.latLng(from.lat, to.lng);
  const cornerB = L.latLng(to.lat, from.lng);
  return [
    [from, cornerA, to],
    [from, cornerB, to],
  ];
}
function validOrthogonalPath(grid, points, startRoom = null, goalRoom = null) {
  return points.every((point, index) => index === 0 || walkableLine(
    grid,
    points[index - 1],
    point,
    index === 1 ? startRoom : index === points.length - 1 ? goalRoom : null,
  ));
}
function simplifyOrthogonal(points) {
  const result = [];
  for (const point of points) {
    const previous = result[result.length - 1];
    const beforePrevious = result[result.length - 2];
    if (previous && point.lat === previous.lat && point.lng === previous.lng) continue;
    if (beforePrevious && previous &&
      ((beforePrevious.lat === previous.lat && previous.lat === point.lat) ||
        (beforePrevious.lng === previous.lng && previous.lng === point.lng))) {
      result[result.length - 1] = point;
    } else result.push(point);
  }
  return result;
}
function gridPointCandidates(point) {
  const x = point.lng / GRID_CELL_SIZE, y = point.lat / GRID_CELL_SIZE;
  return [...new Set([
    Math.floor(x), Math.ceil(x), Math.round(x),
  ])].flatMap((gridX) => [...new Set([
    Math.floor(y), Math.ceil(y), Math.round(y),
  ])].map((gridY) => ({ x: gridX, y: gridY })));
}
function connectPointToGrid(grid, point, room) {
  const nearbyCandidates = [];
  const center = {
    x: Math.round(point.lng / GRID_CELL_SIZE),
    y: Math.round(point.lat / GRID_CELL_SIZE),
  };
  for (let y = center.y - 32; y <= center.y + 32; y++) {
    for (let x = center.x - 32; x <= center.x + 32; x++) nearbyCandidates.push({ x, y });
  }
  return nearbyCandidates.flatMap((candidate) => {
    const node = L.latLng(candidate.y * GRID_CELL_SIZE, candidate.x * GRID_CELL_SIZE);
    return orthogonalCandidates(point, node)
      .filter((path) => validOrthogonalPath(grid, path, room))
      .map((path) => ({ node: candidate, path }));
  });
}
function aStar(grid, start, goal) {
  const key = (n) => `${n.x}:${n.y}`, open = [{ ...start, f: 0 }], came = new Map(), cost = new Map([[key(start), 0]]);
  while (open.length) {
    open.sort((a, b) => a.f - b.f); const current = open.shift();
    if (current.x === goal.x && current.y === goal.y) {
      const result = []; let cursor = key(current);
      while (cursor) { const [x, y] = cursor.split(":").map(Number); result.unshift(L.latLng(y * GRID_CELL_SIZE, x * GRID_CELL_SIZE)); cursor = came.get(cursor); }
      return result;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: current.x + dx, y: current.y + dy };
      if (next.x < grid.minX || next.x > grid.maxX || next.y < grid.minY || next.y > grid.maxY ||
        !grid.walkable(next.x * GRID_CELL_SIZE, next.y * GRID_CELL_SIZE) ||
        !walkableSegment(grid, current, next)) continue;
      const nk = key(next), score = (cost.get(key(current)) ?? Infinity) + 1;
      if (score >= (cost.get(nk) ?? Infinity)) continue;
      came.set(nk, key(current)); cost.set(nk, score);
      open.push({ ...next, f: score + Math.abs(next.x - goal.x) + Math.abs(next.y - goal.y) });
    }
  }
  return null;
}
function simplify(points) {
  return points.filter((p, i) => i === 0 || i === points.length - 1 ||
    !(p.lat === points[i - 1].lat && p.lat === points[i + 1].lat) &&
    !(p.lng === points[i - 1].lng && p.lng === points[i + 1].lng));
}
async function calculateWalkablePath(floor, start, goal, startRoom, goalRoom) {
  const grid = await buildFloorGrid(floor);
  const startPoint = L.latLng(start), goalPoint = L.latLng(goal);
  const directPaths = orthogonalCandidates(startPoint, goalPoint)
    .filter((path) => validOrthogonalPath(grid, path, startRoom, goalRoom));
  if (directPaths.length) {
    return directPaths.sort((a, b) => a.length - b.length)[0];
  }
  const starts = connectPointToGrid(grid, startPoint, startRoom);
  const goals = connectPointToGrid(grid, goalPoint, goalRoom);
  const a = starts.sort((left, right) => left.path.length - right.path.length)[0];
  const b = goals.sort((left, right) => left.path.length - right.path.length)[0];
  if (!a || !b) {
    console.warn("[route] lineDot connector fallback", {
      floor: floor.floorName,
      start: startPoint,
      goal: goalPoint,
    });
    return orthogonalCandidates(startPoint, goalPoint)[0];
  }
  console.info("[route-grid] route endpoints", {
    floor: floor.floorName, start: { room: startRoom?.name, cell: a.node }, goal: { room: goalRoom?.name, cell: b.node },
  });
  const path = aStar(grid, a.node, b.node);
  if (!path) {
    console.warn("[route] grid path fallback", {
      floor: floor.floorName,
      start: startRoom?.name,
      goal: goalRoom?.name,
    });
    return orthogonalCandidates(startPoint, goalPoint)[0];
  }
  const gridPath = path.map((point) => L.latLng(point));
  return simplifyOrthogonal([...a.path, ...gridPath, ...b.path.slice().reverse()]);
}
function findStairPair(sourceFloor, destinationFloor, sourcePoint, destinationPoint) {
  const sourceStairs = sourceFloor.rooms.filter((room) => room.StairID);
  const destinationStairs = destinationFloor.rooms.filter((room) => room.StairID);
  return sourceStairs.flatMap((sourceRoom) => destinationStairs
    .filter((destinationRoom) => destinationRoom.StairID === sourceRoom.StairID)
    .map((destinationRoom) => ({
      source: { room: sourceRoom, point: L.latLng(sourceRoom.lineDot ?? centerOf(sourceRoom)) },
      destination: { room: destinationRoom, point: L.latLng(destinationRoom.lineDot ?? centerOf(destinationRoom)) },
      distance: L.latLng(sourceRoom.lineDot ?? centerOf(sourceRoom)).distanceTo(sourcePoint) +
        L.latLng(destinationRoom.lineDot ?? centerOf(destinationRoom)).distanceTo(destinationPoint),
    })))
    .sort((a, b) => a.distance - b.distance)[0];
}
export async function validateAllRoomPairs() {
  let success = 0, failure = 0, outOfGrid = 0;
  for (const floor of mapInfo.floors) {
    const grid = await buildFloorGrid(floor);
    for (const room of floor.rooms) for (const other of floor.rooms) {
      if (room === other) continue;
      try {
        const a = nearestBoundaryCell(grid, centerOf(room), room), b = nearestBoundaryCell(grid, centerOf(other), other);
        if (!grid.walkable(a.x * GRID_CELL_SIZE, a.y * GRID_CELL_SIZE) || !grid.walkable(b.x * GRID_CELL_SIZE, b.y * GRID_CELL_SIZE)) outOfGrid++;
        if (aStar(grid, a, b)) success++; else failure++;
      } catch { failure++; }
    }
  }
  console.info("[route-grid] validation", { success, failure, outOfGrid });
  return { success, failure, outOfGrid };
}
if (typeof window !== "undefined") window.validateRoomRoutes = validateAllRoomPairs;

async function setRoute() {
  if (!destinationLocation) return;
  const id = ++routeRequestId, destination = destinationLocation, definitions = [];
  const destinationPoint = destination.room.lineDot
    ? L.latLng(destination.room.lineDot)
    : centerOf(destination.room);
  const sourceFloor = mapInfo.floors.find((f) => f.floorName === currentLocation.floorName);
  if (!sourceFloor) throw new Error("現在地の階が見つかりません");
  if (destination.floor.floorName === sourceFloor.floorName) definitions.push({
    floor: destination.floor, start: L.latLng(currentLocation.point), goal: destinationPoint,
    startRoom: mapState.currentRoom, goalRoom: destination.room, startMarker: ["現在地", currentLocation.point, "#2980b9"], endMarker: [destination.room.name, destinationPoint, "#d35400"],
  });
  else {
    const pair = findStairPair(sourceFloor, destination.floor, L.latLng(currentLocation.point), destinationPoint);
    if (!pair) throw new Error("階段経由の経路を構築できません");
    definitions.push({ floor: sourceFloor, start: L.latLng(currentLocation.point), goal: pair.source.point, startRoom: mapState.currentRoom, goalRoom: pair.source.room, startMarker: ["現在地", currentLocation.point, "#2980b9"], endMarker: [pair.source.room.name, pair.source.point, "#e67e22"] });
    definitions.push({ floor: destination.floor, start: pair.destination.point, goal: destinationPoint, startRoom: pair.destination.room, goalRoom: destination.room, startMarker: [pair.destination.room.name, pair.destination.point, "#e67e22"], endMarker: [destination.room.name, destinationPoint, "#d35400"] });
  }
  const next = new Map();
  try {
    for (const d of definitions) {
      const points = await calculateWalkablePath(d.floor, d.start, d.goal, d.startRoom, d.goalRoom);
      if (id !== routeRequestId) return;
      next.set(d.floor.floorName, { points, startMarker: d.startMarker, endMarker: d.endMarker });
    }
  } catch (error) {
    console.error("[route] no route", error);
    document.getElementById("route-error")?.replaceChildren(`経路を見つけられませんでした：${error.message}`);
    return;
  }
  routeSegments.clear(); for (const [name, segment] of next) routeSegments.set(name, { layers: () => [
    L.polyline(segment.points, { color: "#d35400", weight: 5, dashArray: "10 8", className: "navigation-route" }),
    L.circleMarker(segment.startMarker[1], { radius: 9, color: "#fff", weight: 3, fillColor: segment.startMarker[2], fillOpacity: 1 }).bindTooltip(segment.startMarker[0], { permanent: true }),
    L.circleMarker(segment.endMarker[1], { radius: 11, color: "#fff", weight: 3, fillColor: segment.endMarker[2], fillOpacity: 1 }).bindTooltip(segment.endMarker[0], { permanent: true }),
  ] });
  if (mapState.nowBaseLayerName !== destination.floor.floorName) showFloor(destination.floor.floorName);
  document.getElementById("route-error")?.replaceChildren();
  renderRouteForFloor(mapState.nowBaseLayerName); updateNavigationBanner();
}
function updateUrl() {
  const params = new URLSearchParams(window.location.search); params.set("current", currentLocation.name);
  if (destinationLocation) params.set("destination", destinationLocation.room.name);
  window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
}
function selectSelection(selection) {
  if (searchMode === "current") {
    currentLocation.name = selection.room.name; currentLocation.floorName = selection.floor.floorName;
    currentLocation.point = selection.room.lineDot ?? centerOf(selection.room);
    mapState.currentRoom = selection.room;
  } else { destinationLocation = selection; mapState.destinationRoom = selection.room; }
  refreshRoomHighlights(); updateNavigationBanner(); updateUrl(); void setRoute();
  document.getElementById("room-search-panel").hidden = true;
}
function renderResults(results, pane) {
  pane.replaceChildren();
  if (!results.length) { pane.textContent = "該当する教室が見つかりません。"; return; }
  for (const result of results) {
    const button = document.createElement("button"); button.type = "button"; button.className = "room-result";
    const icon = document.createElement("span"); icon.className = "material-symbols-outlined"; icon.textContent = "meeting_room";
    const roomName = document.createElement("span"); roomName.textContent = result.room.name;
    const floorName = document.createElement("small"); floorName.textContent = result.floor.floorName;
    button.append(icon, roomName, floorName);
    button.addEventListener("click", () => selectSelection(result)); pane.append(button);
  }
}
export function bindRoomSearch() {
  const panel = document.getElementById("room-search-panel"), input = document.getElementById("room-search-input"), currentInput = document.getElementById("current-room-search-input"), results = document.getElementById("room-search-results");
  if (!panel || !input || !results) return;
  requireMap().on("baselayerchange", handleRouteFloorChange);
  const setMode = (mode) => { searchMode = mode; document.querySelectorAll("[data-search-mode]").forEach((b) => b.classList.toggle("active", b.dataset.searchMode === mode)); document.getElementById("current-search-field").hidden = mode !== "current"; document.getElementById("destination-search-field").hidden = mode !== "destination"; };
  const open = (mode) => { setMode(mode); panel.hidden = false; (mode === "current" ? currentInput : input)?.focus(); };
  document.querySelectorAll("[data-open-search]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      open(button.dataset.openSearch);
    });
  });
  document.getElementById("room-search-close")?.addEventListener("click", () => { panel.hidden = true; });
  panel.addEventListener("click", (e) => { if (e.target === panel) panel.hidden = true; });
  for (const field of [input, currentInput]) {
    field?.addEventListener("input", () => renderResults(getRoomMatches(field.value), results));
  }
  document.getElementById("room-search-submit")?.addEventListener("click", () => {
    setMode("destination");
    input.focus();
    renderResults(getRoomMatches(input.value), results);
  });
  document.getElementById("current-room-search-submit")?.addEventListener("click", () => {
    setMode("current");
    currentInput.focus();
    renderResults(getRoomMatches(currentInput.value), results);
  });
  document.querySelectorAll("[data-search-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.searchMode)));
  const params = new URLSearchParams(window.location.search);
  for (const [key, mode, field] of [["current", "current", currentInput], ["destination", "destination", input]]) {
    const found = getRoomMatches(params.get(key) ?? "")[0]; if (found) { field.value = found.room.name; setMode(mode); selectSelection(found); }
  }
}
export function selectRoom(room) {
  const floor = mapInfo.floors.find((f) => f.rooms.includes(room)); if (floor) selectSelection({ room, floor });
}
