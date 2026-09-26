import L from "leaflet";
import { ZOOM_THRESHOLD } from "./constants.js";
import { mapState, requireMap } from "./state.js";

/**
 * 現在のズームを基準に Bound のピクセルサイズを取る。
 * @param {L.LatLngBounds} bounds
 */
function calcBoundsWidthHeightPixel(bounds) {
  const map = requireMap();
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const swPoint = map.latLngToContainerPoint(sw);
  const nePoint = map.latLngToContainerPoint(ne);
  return {
    width: Math.abs(nePoint.x - swPoint.x),
    height: Math.abs(nePoint.y - swPoint.y),
  };
}

/**
 * 階層画像の切り替えに合わせて部屋レイヤーを差し替える。
 * @param {string} newBaseLayerName
 */
export function changeLayerGroups(newBaseLayerName) {
  const map = requireMap();
  mapState.layerGroups.get(mapState.nowBaseLayerName)?.remove();
  mapState.layerGroups.get(newBaseLayerName)?.addTo(map);
  mapState.nowBaseLayerName = newBaseLayerName;
}

/**
 * ズーム量を見て部屋名ラベルの表示／非表示を切り替える。
 */
export function recheckRoomLabelShowStatus() {
  const currentZoom = requireMap().getZoom();
  const layerGroup = mapState.layerGroups.get(mapState.nowBaseLayerName);
  const roomLabelLayerGroup = mapState.roomLabelLayerGroups.get(
    mapState.nowBaseLayerName,
  );
  if (!layerGroup || !roomLabelLayerGroup) {
    throw new Error(
      `recheckRoomLabelShowStatus: layer group not found (floorName: ${mapState.nowBaseLayerName})`,
    );
  }
  if (currentZoom < ZOOM_THRESHOLD) roomLabelLayerGroup.remove();
  else roomLabelLayerGroup.addTo(layerGroup);
}

/**
 * ズームに合わせて部屋名ラベルのサイズを更新する。
 */
export function calculateRoomLabelArea() {
  const roomLabelLayerGroup = mapState.roomLabelLayerGroups.get(
    mapState.nowBaseLayerName,
  );
  if (!roomLabelLayerGroup) {
    throw new Error(
      `calculateRoomLabelArea: layer group not found (floorName: ${mapState.nowBaseLayerName})`,
    );
  }
  roomLabelLayerGroup.eachLayer((label) => {
    if (!(label instanceof L.Marker)) return;
    const bounds = mapState.roomLabelBounds.get(label);
    const icon = label.getIcon();
    if (!(icon instanceof L.DivIcon)) return;
    const optionsHtml = icon.options.html;
    const html =
      optionsHtml instanceof HTMLElement
        ? optionsHtml.innerHTML
        : optionsHtml || undefined;
    if (!bounds) throw new Error(`calculateRoomLabelArea: unknown bounds (${html})`);
    const { width, height } = calcBoundsWidthHeightPixel(bounds);

    label.setIcon(
      L.divIcon({
        className: "map-room-text",
        html,
        iconSize: [width, height],
        iconAnchor: [width / 2, height / 2],
      }),
    );
  });
}

export function refreshCurrentFloorDisplay() {
  recheckRoomLabelShowStatus();
  calculateRoomLabelArea();
}

/**
 * 階層変更・ズームに応じた表示更新をマップへ接続する。
 * @param {L.Map} map
 */
export function bindMapDisplayUpdates(map) {
  map.on("baselayerchange", function (e) {
    changeLayerGroups(e.name);
    refreshCurrentFloorDisplay();
  });

  map.on("zoomend", function () {
    refreshCurrentFloorDisplay();
  });
}

/**
 * 指定した階層の画像と部屋レイヤーを表示する。
 * @param {string} floorName
 */
export function showFloor(floorName) {
  const overlay = mapState.baseLayers[floorName];
  if (!overlay) {
    throw new Error(`showFloor: unknown floor (${floorName})`);
  }
  const map = requireMap();
  for (const otherOverlay of Object.values(mapState.baseLayers)) {
    if (otherOverlay !== overlay) map.removeLayer(otherOverlay);
  }
  overlay.addTo(requireMap());
  changeLayerGroups(floorName);
}
