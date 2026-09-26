import { closeCard } from "../card";
import { pageState } from "../pageState";
import mapInfo from "../../env/mapinfo.js";
import L from "leaflet";
import {
  changeLayerGroups,
  refreshCurrentFloorDisplay,
  showFloor,
} from "./update";
import { mapState, requireMap } from "./state";

/**
 * マップへ向かう。
 * @param {string} id
 * @param {"booth"|"event"} type
 */
export function goMap(id, type) {
  const map = requireMap();
  closeCard();
  pageState.page = "map";

  for (const floor of mapInfo.floors) {
    const room = floor.rooms.find((r) => {
      if (type === "booth" && (r.searchTerms ?? r.aliases ?? []).includes(id))
        return true;
      if (type === "event" && r.eventIds && r.eventIds.includes(id))
        return true;
      return false;
    });
    if (!room) continue;
    const bounds = L.latLngBounds(
      L.latLng(...room.bounds[0]),
      L.latLng(...room.bounds[1]),
    );
    if (mapState.nowBaseLayerName !== floor.floorName) {
      showFloor(floor.floorName);
    }
    map.setZoom(2);
    const marker = L.marker(bounds.getCenter()).addTo(map);
    setTimeout(() => {
      map.panTo(bounds.getCenter());
    }, 300);
    setTimeout(() => {
      marker.remove();
    }, 5000);
  }
}

